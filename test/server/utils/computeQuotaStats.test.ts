import { computeQuotaStats, foldBucket } from '~~/server/utils/computeQuotaStats'
import { describe, expect, it } from 'vitest'

import { getWeekRange } from '#shared/planning'

// The quota calculation engine, from docs/specs/planning/quota-engine.md. Every criterion from AC1
// through AC13 is covered here, plus the edge-case list at the foot of that document.
//
// AC13 is what makes this file possible and it is asserted rather than assumed: "The engine is pure
// and database-free, taking tasks, quota records, day rows and schedule records as arguments, so
// every criterion above is unit-testable against fixtures with no database." There is no vi.mock in
// this file and there is no database. If the engine ever needs one, this whole suite stops importing.
//
// THE ARGUMENT AND RESULT SHAPES ARE A READING OF THE SPEC, NOT A QUOTE FROM IT. AC13 names the four
// inputs and AC2, AC7 and AC10 name every reported field, but neither says how they are grouped. So
// the engine is called with one object carrying { anchor, tasks, quotas, daySettings, schedule } and
// answers { day, week, month, year }, each period carrying { from, to, categories, headline,
// scheduledMinutes, consumedMinutes, unaccountedMinutes } and each bucket carrying the seven figures
// AC2 and AC7 name. The range on a period is reported because AC1 says an anchor resolves four
// periods and a caller cannot label a card without knowing which dates it covers.
//
// EVERY EXPECTED NUMBER BELOW WAS WORKED OUT BY HAND AND IS WRITTEN AS A LITERAL. Nothing is derived
// in the test body from the same arithmetic the engine performs, because a test that recomputes the
// answer the same way agrees with any bug both copies share. The words-per-hour figures are compared
// with toBeCloseTo to six decimals rather than exactly, because words / (minutes / 60) and
// words * 60 / minutes are the same number in real arithmetic and can differ in the last bit of a
// double, and pinning a formulation is not what any criterion asks for.
//
// The fixtures use real category ids and the shipped quota figures from shared/categories.ts. The
// four trackable categories are translation at 240 words per hour, revision_internal at 1000,
// revision_external at 1300 and proofreading at 2000. Word counts and quotas were chosen so that
// words / quota lands on a whole or a half hour, which keeps every hand-computed target minute exact
// in binary floating point whichever way round the engine writes the division.

// The anchor every fixture uses unless it says otherwise. 2026-09-09 is a Wednesday, so its week is
// Sunday 2026-09-06 through Saturday 2026-09-12, its month is the 30 days of September 2026, and its
// year is the 365 days of 2026, which is not a leap year.
const ANCHOR = '2026-09-09'

// The stored task fields the engine reads, in the camelCase shape the read path already returns.
type EngineTask = {
  actualMinutes: number | null
  category: string
  date: string
  estimatedMinutes: number | null
  excludeFromStats: boolean
  projectWordCount: number | null
  quotaWphOverride: number | null
}

// One day settings row as the snapshot stores it. work_days is the raw JSON text of the column, the
// same shape the day settings resolver consumes, per AC9 of the snapshot spec.
type EngineDayRow = {
  bufferMinutes: number
  date: string
  workDays: string
  workMinutes: number
}

// A task carrying nothing but a date and a category, so each fixture states only the fields its own
// criterion is about and an unset field is an honest null rather than an inherited number.
function task(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    actualMinutes: null,
    category: 'translation',
    date: ANCHOR,
    estimatedMinutes: null,
    excludeFromStats: false,
    projectWordCount: null,
    quotaWphOverride: null,
    ...overrides
  }
}

function dayRow(date: string, overrides: Partial<EngineDayRow> = {}): EngineDayRow {
  return { bufferMinutes: 60, date, workDays: '[1,2,3,4,5]', workMinutes: 450, ...overrides }
}

// The engine call with everything empty by default, so a fixture supplies only what it is about. An
// empty schedule history and no day rows mean every date resolves through DEFAULT_SCHEDULE, which is
// 450 minutes on Monday through Friday.
function compute(overrides: Record<string, unknown> = {}) {
  return computeQuotaStats({
    anchor: ANCHOR,
    daySettings: [],
    quotas: [],
    schedule: [],
    tasks: [],
    ...overrides
  })
}

// The seven figures AC2 and AC7 name on a bucket, written down here so this file states the shape it
// expects rather than inferring it from an implementation that does not exist yet. The three that can
// be null are exactly the three AC8, AC9 and AC11 say can be.
type Bucket = {
  achievedWph: number | null
  assumedMinutes: number
  attainment: number | null
  measuredMinutes: number
  minutes: number
  targetWph: number | null
  words: number
}

type CategoryBucket = Bucket & { categoryId: string }

// One entry as the exported fold consumes it, which is the seam AC11's null branch is tested through.
// The engine resolves each task down to this before folding, so `quotaWph` here is already the answer
// resolveTaskQuota gave and `measured` is already the answer effectiveDuration gave: true when the
// minutes came from `actual_minutes` and false when they fell back to the estimate, which is the split
// AC7 reports.
type BucketEntry = {
  measured: boolean
  minutes: number
  quotaWph: number | null
  words: number
}

type Period = {
  categories: CategoryBucket[]
  consumedMinutes: number
  from: string
  headline: Bucket
  scheduledMinutes: number
  to: string
  unaccountedMinutes: number
}

// The row for one category in a period, or a failure naming what was there instead. Returning
// undefined and letting an assertion read a property off it would report "cannot read words of
// undefined" instead of which categories the period actually held.
function row(period: Period, categoryId: string): CategoryBucket {
  const found = period.categories.find((entry) => entry.categoryId === categoryId)
  if (!found) {
    const present = period.categories.map((entry) => entry.categoryId).join(', ') || 'none'
    throw new Error(`no ${categoryId} row in the period, which held: ${present}`)
  }
  return found
}

function categoryIds(period: Period): string[] {
  return period.categories.map((entry) => entry.categoryId).sort()
}

// Every number anywhere in the result, paired with the path it was found at, so AC8's "no path
// returns Infinity, NaN, or a division by zero" can be checked over the whole answer rather than over
// the two or three fields a case happens to name.
function numbersIn(value: unknown, path = 'stats'): [string, number][] {
  if (typeof value === 'number') return [[path, value]]
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => numbersIn(entry, `${path}[${index}]`))
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => numbersIn(entry, `${path}.${key}`))
  }
  return []
}

function expectEveryNumberFinite(stats: unknown): void {
  const numbers = numbersIn(stats)

  // The sweep concludes from an absence, so it is worthless if it never saw a number.
  expect(numbers.length).toBeGreaterThan(0)

  for (const [path, value] of numbers) {
    expect(Number.isFinite(value), `${path} is ${value}`).toBe(true)
  }
}

// The fixture most of the arithmetic criteria read, worked out once here because AC2, AC4, AC5, AC6,
// AC7 and AC10 all describe different views of the same period.
//
// Five tasks, all on the anchor date.
//
//   t1  translation, 600 words, 100 actual minutes. No stored figure anywhere, so it resolves the
//       shipped default of 240 words per hour and its target is 600 / 240 = 2.5 h = 150 minutes.
//   t2  translation, 240 words, no actual and a 60 minute estimate, carrying its own figure of 480
//       words per hour. Its target is 240 / 480 = 0.5 h = 30 minutes.
//   t3  revision_internal, 1000 words, 80 actual minutes. The user's own stored figure for that
//       category is 500 words per hour, so its target is 1000 / 500 = 2 h = 120 minutes.
//   t4  meetings, non-trackable, 40 actual minutes and a deliberate 500 word count that must reach
//       nothing.
//   t5  translation, excluded from stats, 9999 words and 300 actual minutes.
//
// translation:        words 840, minutes 160 (100 measured, 60 assumed), target 180 minutes.
//                     achieved 840 * 60 / 160 = 315 wph. target 840 * 60 / 180 = 280 wph.
//                     attainment 180 / 160 = 1.125.
// revision_internal:  words 1000, minutes 80 (all measured), target 120 minutes.
//                     achieved 1000 * 60 / 80 = 750 wph. target 1000 * 60 / 120 = 500 wph.
//                     attainment 120 / 80 = 1.5.
// headline:           words 1840, minutes 240 (180 measured, 60 assumed), target 300 minutes.
//                     achieved 1840 * 60 / 240 = 460 wph. target 1840 * 60 / 300 = 368 wph.
//                     attainment 300 / 240 = 1.25.
// consumed:           100 + 60 + 80 + 40 + 300 = 580 minutes.
const MAIN = {
  anchor: ANCHOR,
  daySettings: [dayRow(ANCHOR, { workMinutes: 400 })],
  quotas: [{ categoryId: 'revision_internal', quotaWph: 500 }],
  schedule: [],
  tasks: [
    task({ actualMinutes: 100, projectWordCount: 600 }),
    task({ estimatedMinutes: 60, projectWordCount: 240, quotaWphOverride: 480 }),
    task({ actualMinutes: 80, category: 'revision_internal', projectWordCount: 1000 }),
    task({ actualMinutes: 40, category: 'meetings', projectWordCount: 500 }),
    task({ actualMinutes: 300, excludeFromStats: true, projectWordCount: 9999 })
  ]
}

describe('computeQuotaStats', () => {
  describe('AC1: one anchor date resolves four periods', () => {
    it('reports a day period covering the anchor date alone', () => {
      const stats = compute(MAIN)

      expect(stats.day.from).toBe('2026-09-09')
      expect(stats.day.to).toBe('2026-09-09')
    })

    // The week is the shipped getWeekRange rather than a second copy of the Sunday-to-Saturday rule.
    it('reports the week through the shipped getWeekRange', () => {
      const stats = compute(MAIN)

      expect({ from: stats.week.from, to: stats.week.to }).toEqual(getWeekRange(ANCHOR))
      expect(stats.week.from).toBe('2026-09-06')
      expect(stats.week.to).toBe('2026-09-12')
    })

    it('reports the calendar month of the anchor', () => {
      const stats = compute(MAIN)

      expect(stats.month.from).toBe('2026-09-01')
      expect(stats.month.to).toBe('2026-09-30')
    })

    it('reports the calendar year of the anchor', () => {
      const stats = compute(MAIN)

      expect(stats.year.from).toBe('2026-01-01')
      expect(stats.year.to).toBe('2026-12-31')
    })

    // "Each period carries a row for every trackable category holding at least one task in range,
    // and no row for a category holding none." The fixture holds tasks in two trackable categories
    // and one non-trackable one, so exactly two rows are correct and a row of zeroes for the other
    // eight categories is not.
    it('carries a row for each trackable category holding a task and no other', () => {
      const stats = compute(MAIN)

      for (const period of [stats.day, stats.week, stats.month, stats.year]) {
        expect(categoryIds(period)).toEqual(['revision_internal', 'translation'])
      }
    })

    it('carries no rows at all for a period holding no tasks', () => {
      const stats = compute({ ...MAIN, tasks: [] })

      expect(stats.day.categories).toEqual([])
      expect(stats.year.categories).toEqual([])
    })
  })

  describe('AC2: what a category row reports', () => {
    it('reports words, minutes, achievedWph, targetWph and attainment on every row', () => {
      const stats = compute(MAIN)

      for (const entry of stats.day.categories) {
        for (const field of ['words', 'minutes', 'achievedWph', 'targetWph', 'attainment']) {
          expect(entry, `${entry.categoryId} is missing ${field}`).toHaveProperty(field)
        }
      }
    })

    it('sums the words and the minutes of the rows own tasks', () => {
      const translation = row(compute(MAIN).day, 'translation')

      expect(translation.words).toBe(840)
      expect(translation.minutes).toBe(160)
    })

    // Words over minutes expressed in hours: 840 words over 160 minutes is 840 * 60 / 160.
    it('reports achievedWph as words over minutes expressed in hours', () => {
      expect(row(compute(MAIN).day, 'translation').achievedWph).toBeCloseTo(315, 6)
    })

    // Summed target minutes over summed effective minutes: 180 / 160.
    it('reports attainment as summed target minutes over summed effective minutes', () => {
      expect(row(compute(MAIN).day, 'translation').attainment).toBeCloseTo(1.125, 6)
    })

    // The hours-weighted target rather than any single stored figure. The row holds one task at 240
    // words per hour and one at 480, and 280 is neither of them: it is 840 words over the 180 target
    // minutes those two figures produce.
    it('reports targetWph as words over the summed target minutes, not as a stored figure', () => {
      const translation = row(compute(MAIN).day, 'translation')

      expect(translation.targetWph).toBeCloseTo(280, 6)
      expect(translation.targetWph).not.toBeCloseTo(240, 6)
      expect(translation.targetWph).not.toBeCloseTo(480, 6)
    })

    it('reports the second category from its own tasks alone', () => {
      const revision = row(compute(MAIN).day, 'revision_internal')

      expect(revision.words).toBe(1000)
      expect(revision.minutes).toBe(80)
      expect(revision.achievedWph).toBeCloseTo(750, 6)
      expect(revision.targetWph).toBeCloseTo(500, 6)
      expect(revision.attainment).toBeCloseTo(1.5, 6)
    })

    // The user's own stored figure wins over the shipped default, which is the resolution order
    // resolveTaskQuota owns. Under the shipped 1000 words per hour the target would be 60 minutes and
    // the attainment 0.75, so the two readings cannot be confused.
    it('reads the user stored category figure rather than the shipped default', () => {
      const revision = row(compute(MAIN).day, 'revision_internal')

      expect(revision.attainment).toBeCloseTo(1.5, 6)
      expect(revision.attainment).not.toBeCloseTo(0.75, 6)
    })
  })

  describe('AC3: the target is recomputed from words over the resolved quota', () => {
    // The criterion that catches a lying implementation. This task's stored estimate of 999 minutes
    // is deliberately inconsistent with its own words over its own quota, which is
    // 600 / 240 = 150 minutes. An engine reading estimated_minutes as the target would report
    // 999 / 120 = 8.325 and a target of 600 * 60 / 999 = 36.04 words per hour.
    it('ignores an estimated_minutes that disagrees with words over the quota', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 120, estimatedMinutes: 999, projectWordCount: 600 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.attainment).toBeCloseTo(1.25, 6)
      expect(translation.attainment).not.toBeCloseTo(8.325, 3)
      expect(translation.targetWph).toBeCloseTo(240, 6)
    })

    // The same lie in the other direction, where the estimate is the denominator because there is no
    // actual duration but is still not the target. The target stays 150 minutes over an effective 300,
    // so the attainment is 0.5. An engine using the estimate as both would report exactly 1 and look
    // perfectly plausible.
    it('uses the estimate as the denominator without using it as the target', () => {
      const stats = compute({
        tasks: [task({ estimatedMinutes: 300, projectWordCount: 600 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.minutes).toBe(300)
      expect(translation.attainment).toBeCloseTo(0.5, 6)
      expect(translation.attainment).not.toBeCloseTo(1, 6)
    })

    // The task's own figure is the first tier of resolveTaskQuota, so a task carrying 300 words per
    // hour is measured against 600 / 300 = 120 minutes rather than the category's 150.
    it('resolves the task own stored figure ahead of the category', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 120, projectWordCount: 600, quotaWphOverride: 300 })]
      })

      expect(row(stats.day, 'translation').attainment).toBeCloseTo(1, 6)
    })

    // A stored figure that is not a usable divisor is treated as no figure at all and falls through to
    // the category, which is the guard resolveTaskQuota already carries. So this task is measured
    // against the shipped 240 and reports 150 / 120 = 1.25.
    it.each([
      { label: 'zero', stored: 0 },
      { label: 'negative', stored: -240 }
    ])('falls through to the category for a $label stored figure', ({ stored }) => {
      const stats = compute({
        tasks: [task({ actualMinutes: 120, projectWordCount: 600, quotaWphOverride: stored })]
      })

      expect(row(stats.day, 'translation').attainment).toBeCloseTo(1.25, 6)
    })
  })

  describe('AC4: the period headline is the same arithmetic without the category filter', () => {
    it('sums target minutes over effective minutes across every counted task', () => {
      const headline = compute(MAIN).day.headline

      expect(headline.words).toBe(1840)
      expect(headline.minutes).toBe(240)
      expect(headline.attainment).toBeCloseTo(1.25, 6)
    })

    it('reports the same five figures the category rows report', () => {
      const headline = compute(MAIN).day.headline

      expect(headline.achievedWph).toBeCloseTo(460, 6)
      expect(headline.targetWph).toBeCloseTo(368, 6)
    })

    // There is no separate blending rule. The headline is not the mean of the two category
    // attainments, which would be (1.125 + 1.5) / 2 = 1.3125, and it is not the better or the worse of
    // them either.
    it('is not an average of the category attainments', () => {
      const headline = compute(MAIN).day.headline

      expect(headline.attainment).not.toBeCloseTo(1.3125, 4)
      expect(headline.attainment).not.toBeCloseTo(1.125, 4)
      expect(headline.attainment).not.toBeCloseTo(1.5, 4)
    })

    it('reports a headline for every one of the four periods', () => {
      const stats = compute(MAIN)

      for (const period of [stats.day, stats.week, stats.month, stats.year]) {
        expect(period.headline.words).toBe(1840)
        expect(period.headline.attainment).toBeCloseTo(1.25, 6)
      }
    })
  })

  describe('AC5: a non-trackable task contributes no words and no minutes', () => {
    it('gives a non-trackable category no row of its own', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 60, category: 'meetings', projectWordCount: 500 })]
      })

      expect(stats.day.categories).toEqual([])
    })

    it('keeps a non-trackable word count out of the headline', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 60, category: 'meetings', projectWordCount: 500 })]
      })

      expect(stats.day.headline.words).toBe(0)
      expect(stats.day.headline.minutes).toBe(0)
    })

    // "Its effective duration still counts as consumed time under AC10, because a meeting still eats
    // the day."
    it('still counts its effective duration as consumed', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 60, category: 'meetings', projectWordCount: 500 })]
      })

      expect(stats.day.consumedMinutes).toBe(60)
    })

    it.each(['terminology', 'meetings', 'breaks', 'admin', 'dtp', 'other'])(
      'gives %s no category row',
      (category) => {
        const stats = compute({
          tasks: [task({ actualMinutes: 60, category, projectWordCount: 500 })]
        })

        expect(stats.day.categories).toEqual([])
        expect(stats.day.consumedMinutes).toBe(60)
      }
    )
  })

  describe('AC6: an excluded task contributes neither words nor minutes', () => {
    // Both halves in one assertion, because keeping the minutes while dropping the words is the
    // specific defect the criterion names: it would drag the category's figure down, which is the
    // opposite of what the flag is for.
    it('drops both the words and the minutes of an excluded task from its category row', () => {
      const stats = compute({
        tasks: [
          task({ actualMinutes: 100, projectWordCount: 600 }),
          task({ actualMinutes: 300, excludeFromStats: true, projectWordCount: 9999 })
        ]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.words).toBe(600)
      expect(translation.minutes).toBe(100)
      expect(translation.attainment).toBeCloseTo(1.5, 6)
    })

    it('keeps the excluded duration in consumed time', () => {
      const stats = compute({
        tasks: [
          task({ actualMinutes: 100, projectWordCount: 600 }),
          task({ actualMinutes: 300, excludeFromStats: true, projectWordCount: 9999 })
        ]
      })

      expect(stats.day.consumedMinutes).toBe(400)
    })

    it('drops an excluded task from the headline as well', () => {
      const stats = compute({
        tasks: [
          task({ actualMinutes: 100, projectWordCount: 600 }),
          task({ actualMinutes: 300, excludeFromStats: true, projectWordCount: 9999 })
        ]
      })

      expect(stats.day.headline.words).toBe(600)
      expect(stats.day.headline.minutes).toBe(100)
    })

    // Settled by AC1, which now says it outright: "The row keys on a task being present rather than
    // on one contributing, so a category whose every task is excluded under AC6 still gets a row of
    // zeroes and null ratios. Hiding a zero row is presentation and belongs to PLAN-23." So the row
    // is present here and its ratios are null through AC8, because the bucket has no minutes.
    it('still carries a row for a category whose only task is excluded', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 300, excludeFromStats: true, projectWordCount: 9999 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.words).toBe(0)
      expect(translation.minutes).toBe(0)
      expect(translation.achievedWph).toBeNull()
      expect(translation.attainment).toBeNull()
    })
  })

  describe('AC7: the shipped effectiveDuration is the denominator, and the split is reported', () => {
    it('falls back to the estimate for a task with no actual minutes', () => {
      const stats = compute({
        tasks: [task({ estimatedMinutes: 90, projectWordCount: 480 })]
      })

      expect(row(stats.day, 'translation').minutes).toBe(90)
    })

    it('prefers the actual minutes when both are stored', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 100, estimatedMinutes: 90, projectWordCount: 480 })]
      })

      expect(row(stats.day, 'translation').minutes).toBe(100)
    })

    it('counts a task with neither figure as zero minutes', () => {
      const stats = compute({ tasks: [task({ projectWordCount: 480 })] })

      expect(row(stats.day, 'translation').minutes).toBe(0)
    })

    it('reports measuredMinutes and assumedMinutes separately on a category row', () => {
      const translation = row(compute(MAIN).day, 'translation')

      expect(translation.measuredMinutes).toBe(100)
      expect(translation.assumedMinutes).toBe(60)
    })

    it('reports the same split on the headline', () => {
      const headline = compute(MAIN).day.headline

      expect(headline.measuredMinutes).toBe(180)
      expect(headline.assumedMinutes).toBe(60)
    })

    it('has the split add up to the reported minutes', () => {
      const translation = row(compute(MAIN).day, 'translation')

      expect(translation.measuredMinutes + translation.assumedMinutes).toBe(translation.minutes)
    })

    // The degenerate case the criterion calls out. This task's estimate is exactly its words over its
    // quota, 480 / 240 = 2 h = 120 minutes, which is what PLAN-12 will fill the field with. So the
    // target and the denominator are the same number and the attainment is 1 by construction rather
    // than because anything was achieved.
    it('reports an attainment of 1 for a period nobody measured', () => {
      const stats = compute({
        tasks: [task({ estimatedMinutes: 120, projectWordCount: 480 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.attainment).toBeCloseTo(1, 6)
      expect(translation.achievedWph).toBeCloseTo(240, 6)
      expect(translation.targetWph).toBeCloseTo(240, 6)
    })

    // The split is what lets a caller mark that figure as assumed rather than achieved, so it has to
    // be readable from the row alone with no second query.
    it('makes an unmeasured period detectable from the split alone', () => {
      const stats = compute({
        tasks: [task({ estimatedMinutes: 120, projectWordCount: 480 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.measuredMinutes).toBe(0)
      expect(translation.assumedMinutes).toBe(120)
    })

    it('makes a fully measured period detectable from the same split', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 120, projectWordCount: 480 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.measuredMinutes).toBe(120)
      expect(translation.assumedMinutes).toBe(0)
    })

    // A hand-typed estimate that is not the derived one moves the attainment off 1, so the figure is
    // not pinned at 1 for every unmeasured period. The target is still 120 minutes over an assumed 90,
    // which is 1.3333.
    it('does not pin an unmeasured period at exactly 1 when the estimate was not derived', () => {
      const stats = compute({
        tasks: [task({ estimatedMinutes: 90, projectWordCount: 480 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.attainment).toBeCloseTo(1.333333, 5)
      expect(translation.measuredMinutes).toBe(0)
    })
  })

  describe('AC8: zero minutes yields null rather than a division by zero', () => {
    it('reports null achievedWph and null attainment for a bucket with no minutes', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 0, projectWordCount: 480 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.minutes).toBe(0)
      expect(translation.achievedWph).toBeNull()
      expect(translation.attainment).toBeNull()
    })

    it('still reports the words of a bucket with no minutes', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 0, projectWordCount: 480 })]
      })

      expect(row(stats.day, 'translation').words).toBe(480)
    })

    // targetWph does not divide by the minutes, so it survives a zero denominator. 480 words over the
    // 120 target minutes the quota produces is 240 words per hour whether or not any time was logged.
    it('still reports targetWph, which does not divide by the minutes', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 0, projectWordCount: 480 })]
      })

      expect(row(stats.day, 'translation').targetWph).toBeCloseTo(240, 6)
    })

    it('reports null on the headline of a period with no minutes', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 0, projectWordCount: 480 })]
      })

      expect(stats.day.headline.achievedWph).toBeNull()
      expect(stats.day.headline.attainment).toBeNull()
    })

    it('reports null on the headline of a period with no tasks at all', () => {
      const stats = compute({ daySettings: MAIN.daySettings })

      expect(stats.day.headline.words).toBe(0)
      expect(stats.day.headline.minutes).toBe(0)
      expect(stats.day.headline.achievedWph).toBeNull()
      expect(stats.day.headline.attainment).toBeNull()
    })

    it.each([
      { fixture: MAIN, label: 'the mixed fixture' },
      {
        fixture: { tasks: [task({ actualMinutes: 0, projectWordCount: 480 })] },
        label: 'no minutes'
      },
      { fixture: { tasks: [task({ actualMinutes: 90 })] }, label: 'no words' },
      { fixture: { tasks: [] }, label: 'no tasks' },
      { fixture: { tasks: [task({})] }, label: 'a task with neither words nor minutes' }
    ])('returns no Infinity and no NaN anywhere for $label', ({ fixture }) => {
      expectEveryNumberFinite(compute(fixture))
    })
  })

  describe('AC9: zero words against non-zero minutes is a real reading of zero', () => {
    it('reports achievedWph 0 and attainment 0 rather than null', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 90, projectWordCount: 0 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.achievedWph).toBe(0)
      expect(translation.attainment).toBe(0)
    })

    // "projectWordCount null. Reads as zero words", from the edge-case list, which is the same reading
    // arriving through an absent value rather than a stored zero.
    it('reads a null word count as zero words', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 90, projectWordCount: null })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.words).toBe(0)
      expect(translation.minutes).toBe(90)
      expect(translation.achievedWph).toBe(0)
      expect(translation.attainment).toBe(0)
    })

    // A READING RECORDED RATHER THAN QUOTED. AC9 names achievedWph and attainment and says nothing
    // about targetWph, and AC8 forbids a NaN. Zero words produce zero target minutes, so the only two
    // non-NaN answers available are null and 0, and a target of 0 words per hour is not a reading
    // anybody can act on. Null is what AC11 already uses for "no target", so null is what is asserted
    // here.
    it('reports a null targetWph, since zero words produce no target', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 90, projectWordCount: 0 })]
      })

      expect(row(stats.day, 'translation').targetWph).toBeNull()
    })

    it('tells zero words apart from zero minutes rather than reporting both as null', () => {
      const zeroWords = compute({ tasks: [task({ actualMinutes: 90, projectWordCount: 0 })] })
      const zeroMinutes = compute({ tasks: [task({ actualMinutes: 0, projectWordCount: 480 })] })

      expect(row(zeroWords.day, 'translation').attainment).toBe(0)
      expect(row(zeroMinutes.day, 'translation').attainment).toBeNull()
    })
  })

  describe('AC10: scheduled, consumed and unaccounted minutes', () => {
    // Every figure below is counted by hand from the calendar. September 2026 has 22 weekdays, 2026
    // has 261, and the week of the anchor has 5. Under DEFAULT_SCHEDULE each is worth 450 minutes,
    // and the anchor's own day row replaces one of those 450s with 400.
    //
    //   day    400
    //   week   4 * 450 + 400 = 2200
    //   month  22 * 450 - 450 + 400 = 9850
    //   year   261 * 450 - 450 + 400 = 117400
    it.each([
      { expected: 400, period: 'day' },
      { expected: 2200, period: 'week' },
      { expected: 9850, period: 'month' },
      { expected: 117400, period: 'year' }
    ])('sums the scheduled minutes of the $period', ({ expected, period }) => {
      expect(compute(MAIN)[period].scheduledMinutes).toBe(expected)
    })

    it('sums the effective duration of every task in range as consumed, trackable or not', () => {
      const stats = compute(MAIN)

      for (const period of [stats.day, stats.week, stats.month, stats.year]) {
        expect(period.consumedMinutes).toBe(580)
      }
    })

    it('counts a non-trackable and an excluded task in consumed but not in the headline', () => {
      const stats = compute({
        tasks: [
          task({ actualMinutes: 15, projectWordCount: 60 }),
          task({ actualMinutes: 30, category: 'breaks' }),
          task({ actualMinutes: 45, excludeFromStats: true, projectWordCount: 900 })
        ]
      })

      expect(stats.day.consumedMinutes).toBe(90)
      expect(stats.day.headline.minutes).toBe(15)
    })

    it.each([
      { expected: -180, period: 'day' },
      { expected: 1620, period: 'week' },
      { expected: 9270, period: 'month' },
      { expected: 116820, period: 'year' }
    ])(
      'reports unaccounted as scheduled minus consumed for the $period',
      ({ expected, period }) => {
        expect(compute(MAIN)[period].unaccountedMinutes).toBe(expected)
      }
    )

    // "Unaccounted is scheduled minus consumed, and it may be negative, which reads as working past
    // the schedule." The day above is exactly that case, 400 scheduled against 580 consumed.
    it('lets unaccounted go negative rather than clamping it at zero', () => {
      expect(compute(MAIN).day.unaccountedMinutes).toBeLessThan(0)
    })

    // "Scheduled minutes ... counting only dates that are work days under the settings resolved for
    // them." 2026-09-12 is a Saturday and DEFAULT_SCHEDULE works Monday through Friday.
    it('counts no scheduled minutes on a non-work day', () => {
      const stats = compute({
        anchor: '2026-09-12',
        tasks: [task({ actualMinutes: 120, date: '2026-09-12', projectWordCount: 480 })]
      })

      expect(stats.day.scheduledMinutes).toBe(0)
      expect(stats.day.consumedMinutes).toBe(120)
      expect(stats.day.unaccountedMinutes).toBe(-120)
    })

    // "A task on a non-work day. It joins its category bucket normally."
    it('still buckets a task logged on a non-work day', () => {
      const stats = compute({
        anchor: '2026-09-12',
        tasks: [task({ actualMinutes: 120, date: '2026-09-12', projectWordCount: 480 })]
      })

      expect(row(stats.day, 'translation').words).toBe(480)
      expect(row(stats.day, 'translation').minutes).toBe(120)
    })

    // The work days come from the settings resolved for that date, so a day stamped as a Saturday
    // work day is scheduled and one stamped without it is not.
    it('counts a Saturday whose own stamped settings make it a work day', () => {
      const stats = compute({
        anchor: '2026-09-12',
        daySettings: [dayRow('2026-09-12', { workDays: '[6]', workMinutes: 200 })]
      })

      expect(stats.day.scheduledMinutes).toBe(200)
    })

    it('counts no minutes for a Wednesday whose own stamped settings exclude it', () => {
      const stats = compute({
        daySettings: [dayRow(ANCHOR, { workDays: '[0,6]', workMinutes: 400 })]
      })

      expect(stats.day.scheduledMinutes).toBe(0)
    })

    // An empty stamped work_days set is a real setting rather than a corrupt value, which the
    // snapshot spec's AC9 now says outright, and what it describes is a day with no work days. So the
    // day is scheduled for nothing however many minutes the row carries.
    it('counts no minutes for a day stamped with an empty work_days set', () => {
      const stats = compute({
        daySettings: [dayRow(ANCHOR, { workDays: '[]', workMinutes: 400 })]
      })

      expect(stats.day.scheduledMinutes).toBe(0)
    })

    // The same setting across a whole week, which is what "a week with no work days" reads as. The
    // week is scheduled for nothing and every logged minute becomes negative leftover.
    it('schedules nothing for a week whose every day is stamped with no work days', () => {
      const week = ['06', '07', '08', '09', '10', '11', '12'].map((day) =>
        dayRow(`2026-09-${day}`, { workDays: '[]', workMinutes: 400 })
      )
      const stats = compute({
        daySettings: week,
        tasks: [task({ actualMinutes: 120, projectWordCount: 480 })]
      })

      expect(stats.week.scheduledMinutes).toBe(0)
      expect(stats.week.unaccountedMinutes).toBe(-120)
    })

    // The second tier of the snapshot spec's AC6. With no day row, the date resolves through the
    // effective-dated schedule, so the day is worth 300 minutes and the week 5 * 300.
    it('resolves a date with no day row through the effective-dated schedule', () => {
      const stats = compute({
        schedule: [
          {
            bufferMinutes: 60,
            effectiveFrom: '2026-01-01',
            workDays: [1, 2, 3, 4, 5],
            workMinutes: 300
          }
        ]
      })

      expect(stats.day.scheduledMinutes).toBe(300)
      expect(stats.week.scheduledMinutes).toBe(1500)
    })

    // The third tier. Every day worked before this feature shipped is in this state and is
    // deliberately not backfilled.
    it('resolves a date with no day row and no schedule through DEFAULT_SCHEDULE', () => {
      const stats = compute({})

      expect(stats.day.scheduledMinutes).toBe(450)
      expect(stats.week.scheduledMinutes).toBe(2250)
      expect(stats.month.scheduledMinutes).toBe(9900)
      expect(stats.year.scheduledMinutes).toBe(117450)
    })

    // "An empty period. Zero category rows rather than a row of zeroes for every category, with its
    // scheduled minutes intact and a leftover equal to them."
    it('leaves an empty period its scheduled minutes and a leftover equal to them', () => {
      const stats = compute({})

      expect(stats.day.categories).toEqual([])
      expect(stats.day.consumedMinutes).toBe(0)
      expect(stats.day.unaccountedMinutes).toBe(450)
    })

    // A corrupt stored work_days must not decide whether the day counts. The coercion falls back to
    // Monday through Friday, so a Wednesday still counts its 400 minutes.
    it('resolves a day row whose work_days text is corrupt', () => {
      const stats = compute({
        daySettings: [dayRow(ANCHOR, { workDays: 'not json', workMinutes: 400 })]
      })

      expect(stats.day.scheduledMinutes).toBe(400)
    })
  })

  describe('AC11: a task whose quota resolves to null', () => {
    // AC11's own branch is tested through the exported fold, in the nested describe at the end of this
    // block, and the criterion says why it has to be: "The branch is unreachable through today's
    // contract, because isTrackableCategory coerces any unknown id to the non-trackable `other` and
    // all four trackable defaults carry a figure. PLAN-30 makes it reachable. It is built and tested
    // now anyway, at the resolver seam rather than through the real contract."
    //
    // The whole-engine cases below cannot reach it. AC13 fixes the engine's arguments as the tasks, the
    // quota records, the day rows and the schedule records, and none of those four can express a
    // trackable category with no figure, since a quota record carries a number and the trackable gate
    // reads the shipped contract. Mocking resolveTaskQuota is not the way in either, it being a pure
    // function. So the engine exports the fold it uses per bucket, which takes an already-resolved
    // quota and therefore takes a null, and that is where the branch lives.
    //
    // What the whole-engine cases assert instead is the one thing that used to be offered as a proxy
    // for AC11 and is now its opposite, because the ride-along fix recorded in the quota engine's
    // edge-case list changed the answer. A stored category_quotas figure of zero no longer reaches the
    // division: it falls through as the task-level override already does, so this task resolves the
    // shipped 240, its target is 600 / 240 = 2.5 h = 150 minutes over 120 actual minutes, and the
    // attainment is 1.25. Before the fix the same fixture produced a null target and an Infinity in
    // targetWph.
    it('falls through to the shipped figure when the stored category figure cannot divide', () => {
      const stats = compute({
        quotas: [{ categoryId: 'translation', quotaWph: 0 }],
        tasks: [task({ actualMinutes: 120, projectWordCount: 600 })]
      })
      const translation = row(stats.day, 'translation')

      expect(translation.words).toBe(600)
      expect(translation.minutes).toBe(120)
      expect(translation.targetWph).toBeCloseTo(240, 6)
      expect(translation.attainment).toBeCloseTo(1.25, 6)
    })

    it('reports the achieved figure alongside the recovered target', () => {
      const stats = compute({
        quotas: [{ categoryId: 'translation', quotaWph: 0 }],
        tasks: [task({ actualMinutes: 120, projectWordCount: 600 })]
      })

      expect(row(stats.day, 'translation').achievedWph).toBeCloseTo(300, 6)
    })

    // AC8 over the same fixture, which is the criterion the unguarded division would have broken.
    it.each([
      { label: 'zero', stored: 0 },
      { label: 'a negative figure', stored: -240 }
    ])('returns no Infinity and no NaN for a stored figure of $label', ({ stored }) => {
      expectEveryNumberFinite(
        compute({
          quotas: [{ categoryId: 'translation', quotaWph: stored }],
          tasks: [task({ actualMinutes: 120, projectWordCount: 600 })]
        })
      )
    })

    it('resolves a negative stored figure to the shipped figure as well', () => {
      const stats = compute({
        quotas: [{ categoryId: 'translation', quotaWph: -240 }],
        tasks: [task({ actualMinutes: 120, projectWordCount: 600 })]
      })

      expect(row(stats.day, 'translation').attainment).toBeCloseTo(1.25, 6)
    })

    // The time is never lost, which is the sentence the criterion ends on, and it holds whatever the
    // stored figure says.
    it('never loses the time of a category whose stored figure is unusable', () => {
      const stats = compute({
        quotas: [{ categoryId: 'translation', quotaWph: 0 }],
        tasks: [task({ actualMinutes: 120, projectWordCount: 600 })]
      })

      expect(stats.day.consumedMinutes).toBe(120)
    })

    // The branch itself, at the exported fold. AC11: "A task in a trackable category whose quota
    // resolves to null reports its words and minutes with a null target and a null attainment, so the
    // time is never lost and no target is invented for work nobody has described."
    //
    // The trackable qualifier is enforced upstream of this seam rather than inside it, and the
    // criterion is explicit about why it matters, which is that resolveTaskQuota also returns null for
    // a non-trackable task and AC5 puts that one in no bucket at all. So the fold never sees a
    // non-trackable task, and the half of the rule that keeps one out is asserted in the AC5 block
    // above rather than here. What arrives here is an entry that belongs in a bucket and has no figure
    // to be measured against, which is the PLAN-30 category carrying no quota.
    //
    // Every figure below is worked out by hand. A null entry contributes its words and its minutes and
    // adds nothing to the target, so a bucket holding one has no honest target at all and both
    // target-dependent figures are null.
    describe('foldBucket, the seam the branch is reachable through', () => {
      // The control, first, because every case after it concludes from a null. A fold that returned
      // null targets unconditionally would satisfy all of them, so this shows the two figures moving.
      // These are the same numbers the MAIN fixture's translation row reports, which is also how the
      // exported fold is shown to be the unit the engine folds with rather than a second copy.
      it('reports a real target when every entry carries a quota', () => {
        const bucket = foldBucket([
          { measured: true, minutes: 100, quotaWph: 240, words: 600 },
          { measured: false, minutes: 60, quotaWph: 480, words: 240 }
        ])

        expect(bucket.words).toBe(840)
        expect(bucket.minutes).toBe(160)
        expect(bucket.achievedWph).toBeCloseTo(315, 6)
        expect(bucket.targetWph).toBeCloseTo(280, 6)
        expect(bucket.attainment).toBeCloseTo(1.125, 6)
      })

      // The total case. One entry, no quota, so there is no target to report and nothing to compare
      // the 120 minutes against. The achieved figure still stands, since it needs no target.
      it('reports a null target and a null attainment for a bucket of only null quotas', () => {
        const bucket = foldBucket([{ measured: true, minutes: 120, quotaWph: null, words: 600 }])

        expect(bucket.targetWph).toBeNull()
        expect(bucket.attainment).toBeNull()
        expect(bucket.achievedWph).toBeCloseTo(300, 6)
      })

      it('still reports the words and the minutes of a null-quota entry in full', () => {
        const bucket = foldBucket([{ measured: true, minutes: 120, quotaWph: null, words: 600 }])

        expect(bucket.words).toBe(600)
        expect(bucket.minutes).toBe(120)
      })

      // The partial case, which is the one an implementation gets wrong. A null entry alongside a
      // resolved one contributes its 600 words and its 120 minutes, so the bucket reports 1080 words
      // over 200 minutes, which is 324 words per hour achieved. The target is null for the whole
      // bucket, because 120 of those 200 minutes have no figure behind them and a target computed from
      // the other 80 would describe a different bucket than the one being reported.
      it('reports a null target for a bucket where only some entries carry a quota', () => {
        const bucket = foldBucket([
          { measured: true, minutes: 120, quotaWph: null, words: 600 },
          { measured: false, minutes: 80, quotaWph: 240, words: 480 }
        ])

        expect(bucket.words).toBe(1080)
        expect(bucket.minutes).toBe(200)
        expect(bucket.achievedWph).toBeCloseTo(324, 6)
        expect(bucket.targetWph).toBeNull()
        expect(bucket.attainment).toBeNull()
      })

      // The two wrong answers the partial case invites, named so a regression says which one happened.
      // Counting only the resolved entry's target against every minute gives an attainment of
      // 120 / 200 = 0.6 and a target of 1080 * 60 / 120 = 540 words per hour, which reads as a real
      // measurement and is not one. Dropping the null entry altogether would lose its words and its
      // minutes, which is the "the time is never lost" half of the criterion.
      it('neither prices the resolved entry target against every minute nor drops the null entry', () => {
        const bucket = foldBucket([
          { measured: true, minutes: 120, quotaWph: null, words: 600 },
          { measured: false, minutes: 80, quotaWph: 240, words: 480 }
        ])

        expect(bucket.attainment).not.toBe(0.6)
        expect(bucket.targetWph).not.toBe(540)
        expect(bucket.words).not.toBe(480)
        expect(bucket.minutes).not.toBe(80)
      })

      // AC7's split survives a null quota, so a caller can still tell a measured bucket from an
      // assumed one even when it has no target. 120 measured minutes and 80 assumed, adding to the 200
      // reported.
      it('reports the measured and assumed split on a partially null bucket', () => {
        const bucket = foldBucket([
          { measured: true, minutes: 120, quotaWph: null, words: 600 },
          { measured: false, minutes: 80, quotaWph: 240, words: 480 }
        ])

        expect(bucket.measuredMinutes).toBe(120)
        expect(bucket.assumedMinutes).toBe(80)
        expect(bucket.measuredMinutes + bucket.assumedMinutes).toBe(bucket.minutes)
      })

      // One null entry is enough whichever end of the bucket it sits at, so the rule is not an
      // artefact of the fold's order.
      it('is independent of where the null-quota entry sits', () => {
        const resolved = { measured: false, minutes: 80, quotaWph: 240, words: 480 }
        const unresolved = { measured: true, minutes: 120, quotaWph: null, words: 600 }

        expect(foldBucket([unresolved, resolved])).toEqual(foldBucket([resolved, unresolved]))
      })

      // An empty bucket, which is what a category whose every task is excluded under AC6 folds to, and
      // it has no target for a different reason: there is nothing in it at all.
      it('reports a null target for an empty bucket', () => {
        const bucket = foldBucket([])

        expect(bucket.words).toBe(0)
        expect(bucket.minutes).toBe(0)
        expect(bucket.achievedWph).toBeNull()
        expect(bucket.attainment).toBeNull()
        expect(bucket.targetWph).toBeNull()
      })

      // WHERE AC9 AND AC11 MEET, AC11 WINS, AND THE REASON IS WHY RATHER THAN WHICH CRITERION IS
      // LOUDER. AC9's zero is a real reading precisely because the target is known: zero words against
      // a usable quota is zero target minutes, so the attainment genuinely is zero and the user
      // achieved nothing against a target that existed. A null quota removes the target itself, so a
      // zero there would claim no progress against a target that was never defined, which is a
      // different statement and a false one. Null means not measurable and zero means measured and it
      // was nothing, and a missing divisor is the first of those. It is also the fail-closed direction
      // this codebase takes everywhere else a divisor goes missing, which is the same reasoning
      // resolveTaskQuota records for its own guard.
      //
      // So the rule is that a missing quota anywhere in a bucket makes the target and the attainment
      // null whatever the words say, and AC9's zero applies only to a bucket where every entry carries
      // a usable quota. The achieved figure is untouched by any of this, because it divides by the
      // minutes rather than by the quota, so it stays a real zero here.
      it('reports a null attainment for a null-quota entry with no words', () => {
        const bucket = foldBucket([{ measured: true, minutes: 90, quotaWph: null, words: 0 }])

        expect(bucket.words).toBe(0)
        expect(bucket.minutes).toBe(90)
        expect(bucket.achievedWph).toBe(0)
        expect(bucket.attainment).toBeNull()
        expect(bucket.targetWph).toBeNull()
      })

      // The other side of that rule, so the null above is the missing quota talking rather than the
      // zero words. The same zero-words entry with a usable quota is AC9's real zero: 0 words at 240
      // words per hour is 0 target minutes over 90 effective, which is an attainment of 0.
      it('reports AC9 zero attainment for the same entry once its quota is usable', () => {
        const bucket = foldBucket([{ measured: true, minutes: 90, quotaWph: 240, words: 0 }])

        expect(bucket.achievedWph).toBe(0)
        expect(bucket.attainment).toBe(0)
      })

      // AC8 over every fold above, since a null quota is the one input that could put an Infinity in
      // the target had it reached the division.
      it.each([
        { entries: [], label: 'an empty bucket' },
        {
          entries: [{ measured: true, minutes: 120, quotaWph: null, words: 600 }],
          label: 'a wholly null bucket'
        },
        {
          entries: [
            { measured: true, minutes: 120, quotaWph: null, words: 600 },
            { measured: false, minutes: 80, quotaWph: 240, words: 480 }
          ],
          label: 'a partially null bucket'
        },
        {
          entries: [{ measured: true, minutes: 0, quotaWph: null, words: 600 }],
          label: 'a null bucket with no minutes'
        },
        {
          entries: [{ measured: true, minutes: 90, quotaWph: null, words: 0 }],
          label: 'a null bucket with no words'
        }
      ])('returns no Infinity and no NaN for $label', ({ entries }) => {
        expectEveryNumberFinite(foldBucket(entries))
      })

      // Pure, like everything else in this file, so the entries it is handed come back untouched.
      it('leaves the entries it was handed untouched', () => {
        const entries: BucketEntry[] = [
          { measured: true, minutes: 120, quotaWph: null, words: 600 },
          { measured: false, minutes: 80, quotaWph: 240, words: 480 }
        ]
        const before = JSON.stringify(entries)

        foldBucket(entries)

        expect(JSON.stringify(entries)).toBe(before)
      })
    })
  })

  describe('AC12: a period counts only the tasks dated inside it', () => {
    it('excludes a task dated earlier in the same week from the day', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 100, date: '2026-09-08', projectWordCount: 600 })]
      })

      expect(stats.day.categories).toEqual([])
      expect(row(stats.week, 'translation').words).toBe(600)
      expect(row(stats.month, 'translation').words).toBe(600)
      expect(row(stats.year, 'translation').words).toBe(600)
    })

    it('excludes a task from another month from the day, the week and the month', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 100, date: '2026-08-31', projectWordCount: 600 })]
      })

      expect(stats.day.categories).toEqual([])
      expect(stats.week.categories).toEqual([])
      expect(stats.month.categories).toEqual([])
      expect(row(stats.year, 'translation').words).toBe(600)
    })

    it('excludes a task from another year from every period', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 100, date: '2025-12-31', projectWordCount: 600 })]
      })

      for (const period of [stats.day, stats.week, stats.month, stats.year]) {
        expect(period.categories).toEqual([])
        expect(period.consumedMinutes).toBe(0)
      }
    })

    // "Editing a past task restates that period and reaches no other." The edited task is dated in
    // March, so the year moves and the other three periods are untouched.
    it('restates only the periods a changed task falls inside', () => {
      const before = compute({
        tasks: [
          task({ actualMinutes: 100, projectWordCount: 600 }),
          task({ actualMinutes: 100, date: '2026-03-10', projectWordCount: 600 })
        ]
      })
      const after = compute({
        tasks: [
          task({ actualMinutes: 100, projectWordCount: 600 }),
          task({ actualMinutes: 100, date: '2026-03-10', projectWordCount: 1200 })
        ]
      })

      expect(after.day).toEqual(before.day)
      expect(after.week).toEqual(before.week)
      expect(after.month).toEqual(before.month)
      expect(row(after.year, 'translation').words).toBe(1800)
      expect(row(before.year, 'translation').words).toBe(1200)
    })

    // "A settings change reaches no past period at all, which is what the day settings snapshot
    // guarantees." A schedule record taking effect after the anchor cannot move the anchor's day.
    it('leaves a past day alone when a later schedule record exists', () => {
      const stats = compute({
        schedule: [
          {
            bufferMinutes: 60,
            effectiveFrom: '2026-10-01',
            workDays: [1, 2, 3, 4, 5],
            workMinutes: 600
          }
        ]
      })

      expect(stats.day.scheduledMinutes).toBe(450)
    })

    it('leaves a stamped day alone when the current schedule says otherwise', () => {
      const stats = compute({
        daySettings: [dayRow(ANCHOR, { workMinutes: 400 })],
        schedule: [
          {
            bufferMinutes: 60,
            effectiveFrom: '2026-01-01',
            workDays: [1, 2, 3, 4, 5],
            workMinutes: 600
          }
        ]
      })

      expect(stats.day.scheduledMinutes).toBe(400)
    })
  })

  describe('AC13: pure and database-free', () => {
    it('returns the same answer twice for the same inputs, so nothing reads a clock', () => {
      expect(compute(MAIN)).toEqual(compute(MAIN))
    })

    it('leaves every input array untouched', () => {
      const input = {
        anchor: ANCHOR,
        daySettings: [dayRow(ANCHOR, { workMinutes: 400 })],
        quotas: [{ categoryId: 'revision_internal', quotaWph: 500 }],
        schedule: [
          {
            bufferMinutes: 60,
            effectiveFrom: '2026-01-01',
            workDays: [1, 2, 3, 4, 5],
            workMinutes: 300
          }
        ],
        tasks: [task({ actualMinutes: 100, projectWordCount: 600 })]
      }
      const before = JSON.stringify(input)

      computeQuotaStats(input)

      expect(JSON.stringify(input)).toBe(before)
    })

    it('accepts frozen inputs, so it writes to nothing it was handed', () => {
      const frozen = {
        anchor: ANCHOR,
        daySettings: Object.freeze([Object.freeze(dayRow(ANCHOR, { workMinutes: 400 }))]),
        quotas: Object.freeze([Object.freeze({ categoryId: 'translation', quotaWph: 300 })]),
        schedule: Object.freeze([]),
        tasks: Object.freeze([Object.freeze(task({ actualMinutes: 100, projectWordCount: 600 }))])
      }

      expect(() => computeQuotaStats(frozen)).not.toThrow()
    })

    it('is independent of the order the tasks arrive in', () => {
      const forward = compute(MAIN)
      const reversed = compute({ ...MAIN, tasks: [...MAIN.tasks].reverse() })

      expect(reversed.day.headline).toEqual(forward.day.headline)
      expect(reversed.day.consumedMinutes).toBe(forward.day.consumedMinutes)
      expect(categoryIds(reversed.day)).toEqual(categoryIds(forward.day))
    })

    it('is independent of the order the day rows arrive in', () => {
      const rows = [
        dayRow('2026-09-07', { workMinutes: 100 }),
        dayRow('2026-09-08', { workMinutes: 200 }),
        dayRow(ANCHOR, { workMinutes: 400 })
      ]
      const forward = compute({ daySettings: rows })
      const reversed = compute({ daySettings: [...rows].reverse() })

      expect(reversed.week.scheduledMinutes).toBe(forward.week.scheduledMinutes)
      expect(reversed.day.scheduledMinutes).toBe(400)
    })
  })

  describe('the edge cases the spec lists', () => {
    // "A stored category id the contract no longer knows. coerceCategory resolves it to the
    // non-trackable fallback, so it reaches consumed time and no bucket." `revision` is the real
    // example: it is the id the earlier six-member set carried.
    it('folds a retired category id into consumed time and no bucket', () => {
      const stats = compute({
        tasks: [task({ actualMinutes: 60, category: 'revision', projectWordCount: 900 })]
      })

      expect(stats.day.categories).toEqual([])
      expect(stats.day.consumedMinutes).toBe(60)
      expect(stats.day.headline.words).toBe(0)
    })

    it.each(['', 'not_a_category', 'TRANSLATION'])(
      'folds the unknown category id %p the same way',
      (category) => {
        const stats = compute({
          tasks: [task({ actualMinutes: 60, category, projectWordCount: 900 })]
        })

        expect(stats.day.categories).toEqual([])
        expect(stats.day.consumedMinutes).toBe(60)
      }
    )

    // "A week crossing a month or a year boundary. The union range above covers it and each period
    // counts only its own dates." 2026-09-01 is a Tuesday, so its week reaches back to Sunday
    // 2026-08-30 and a task on 2026-08-31 is in the week but not in the month.
    //
    // The union range is the endpoint's single query per table, which was AC15 until the criterion
    // was withdrawn for being a query count rather than a behaviour. It is a code-review item in the
    // spec's Verification section now, so nothing here asserts it and no query spy exists.
    it('counts a task in a week that reaches into the previous month', () => {
      const stats = compute({
        anchor: '2026-09-01',
        tasks: [task({ actualMinutes: 100, date: '2026-08-31', projectWordCount: 600 })]
      })

      expect(stats.week.from).toBe('2026-08-30')
      expect(row(stats.week, 'translation').words).toBe(600)
      expect(stats.month.categories).toEqual([])
    })

    // The same across a year boundary. 2026-01-01 is a Thursday, so its week starts on 2025-12-28 and
    // a task on 2025-12-30 counts in the week and in no other period.
    it('counts a task in a week that reaches into the previous year', () => {
      const stats = compute({
        anchor: '2026-01-01',
        tasks: [task({ actualMinutes: 100, date: '2025-12-30', projectWordCount: 600 })]
      })

      expect(stats.week.from).toBe('2025-12-28')
      expect(row(stats.week, 'translation').words).toBe(600)
      expect(stats.month.categories).toEqual([])
      expect(stats.year.categories).toEqual([])
    })

    // "29 February and a leap year. Month and year ranges are derived rather than assumed to be fixed
    // lengths."
    it('counts a task on 29 February in its month and its year', () => {
      const stats = compute({
        anchor: '2028-02-29',
        tasks: [task({ actualMinutes: 100, date: '2028-02-29', projectWordCount: 600 })]
      })

      expect(stats.month.to).toBe('2028-02-29')
      expect(row(stats.month, 'translation').words).toBe(600)
      expect(row(stats.year, 'translation').words).toBe(600)
    })

    it('reaches 29 February from another date in the same leap month', () => {
      const stats = compute({
        anchor: '2028-02-01',
        tasks: [task({ actualMinutes: 100, date: '2028-02-29', projectWordCount: 600 })]
      })

      expect(row(stats.month, 'translation').words).toBe(600)
      expect(stats.week.categories).toEqual([])
    })

    // A day with no day settings row, which is every day worked before this feature shipped, resolves
    // through the fallback chain rather than contributing nothing.
    it('schedules a day with no row through the fallback chain rather than as zero', () => {
      const stats = compute({
        daySettings: [dayRow('2026-09-07', { workMinutes: 100 })],
        tasks: [task({ actualMinutes: 60, projectWordCount: 480 })]
      })

      expect(stats.day.scheduledMinutes).toBe(450)
      expect(stats.week.scheduledMinutes).toBe(1900)
    })
  })
})
