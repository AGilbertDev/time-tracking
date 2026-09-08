import type { ResolvedSchedule, WorkScheduleRecord } from '#shared/planning'

import { coerceCategory, DEFAULT_CATEGORY_IDS, isTrackableCategory } from '#shared/categories'
import {
  addDays,
  effectiveDuration,
  getMonthRange,
  getWeekRange,
  getYearRange,
  isWorkDay
} from '#shared/planning'

import type { CategoryQuotaRecord } from './resolveCategoryQuota'
import type { DaySettingsRecord } from './resolveDaySettings'

import { resolveTaskQuota } from './resolveCategoryQuota'
import { resolveDaySettings } from './resolveDaySettings'

// The quota calculation engine (the quota engine spec). Pure and database-free, so every criterion in
// that document is testable against fixtures.
//
// The shape of the answer is buckets, one per trackable category, decided 2026-07-29. A category's
// figure is the words in that category over the hours spent in that category, because those are the
// only two numbers that belong to a single kind of work. Nothing here divides by scheduled hours;
// that model was superseded and scheduled hours now reach only the leftover.
//
// Three things this deliberately does not do.
//
// It never reads estimated_minutes as the target. That column is copied straight from the request
// body by server/api/tasks/handlers/write.ts and no server path derives it, so a hand-edited estimate
// would otherwise rewrite the attainment. The target is recomputed from words over the task's own
// resolved quota every time.
//
// It stores nothing and caches nothing, so a period is only ever the sum of the facts dated inside
// it. That is what makes editing a past task restate that period and reach no other.
//
// It resolves the day's settings through resolveDaySettings rather than reading the settings row, so
// a settings change made today cannot reach a past day's scheduled minutes.
//
// One note for review, since the backend convention prefers pushing a decision into the query rather
// than looping in application code. That is not available here. The scheduled total resolves each
// date through a three-tier fallback and parses a JSON work_days array to decide whether the date
// counts at all, which SQL cannot express, and the whole engine is required to be pure so that every
// criterion is testable with no database. So the loop is deliberate. The queries still do the work
// they can, which is the indexed range scan that selects only the rows in the period.

// The stored task fields the engine reads, in the camelCase shape the read path already returns.
export interface StatsTask {
  actualMinutes: number | null
  category: string
  date: string
  estimatedMinutes: number | null
  excludeFromStats: boolean
  projectWordCount: number | null
  quotaWphOverride: number | null
}

// One day_settings row plus the date it belongs to, as the range read returns it.
export type StatsDayRow = DaySettingsRecord & { date: string }

export interface QuotaStatsInput {
  anchor: string
  // The user's live work settings, the third tier of the day settings resolution. Optional, and a
  // caller omitting it gets the shipped defaults for any date with neither a stamp nor an applicable
  // schedule record, which is what every fixture in the engine's own suite relies on.
  current?: ResolvedSchedule | null
  daySettings: readonly StatsDayRow[]
  quotas: readonly CategoryQuotaRecord[]
  schedule: readonly WorkScheduleRecord[]
  tasks: readonly StatsTask[]
}

// One task reduced to the four numbers a bucket is folded from. This is the seam the null-quota case
// is tested through: the engine cannot currently produce one, because an unknown category coerces to
// the non-trackable `other` and all four trackable defaults carry a figure, so PLAN-30 is what makes
// it reachable. Folding is exported rather than injected so that branch can be read directly.
//
// `measured` true means the minutes came from actual_minutes, false that they fell back to the
// estimate. That is the split the spec reports so a caller can mark a figure as assumed rather than
// achieved.
export interface BucketEntry {
  measured: boolean
  minutes: number
  quotaWph: number | null
  words: number
}

export interface Bucket {
  achievedWph: number | null
  assumedMinutes: number
  attainment: number | null
  measuredMinutes: number
  minutes: number
  targetWph: number | null
  words: number
}

export type CategoryBucket = Bucket & { categoryId: string }

export interface StatsPeriod {
  categories: CategoryBucket[]
  consumedMinutes: number
  from: string
  headline: Bucket
  scheduledMinutes: number
  to: string
  unaccountedMinutes: number
}

export interface QuotaStats {
  day: StatsPeriod
  month: StatsPeriod
  week: StatsPeriod
  year: StatsPeriod
}

// Words per hour from whole words and whole minutes. Null rather than Infinity when there is no time
// to divide by, which is the one arithmetic guard every criterion about an empty bucket rests on.
function wordsPerHour(words: number, minutes: number): number | null {
  if (minutes <= 0) return null
  return (words * 60) / minutes
}

// Folds entries into one bucket. Used for a category row and, with the category filter removed, for
// the period headline, which is why there is no separate blending rule for the headline.
//
// The target is the sum of each entry's ideal minutes, words over its own quota, so the bucket's
// reported target is hours-weighted rather than an average of rates.
//
// An entry with no quota makes the whole bucket's target and attainment null, and that is fail-closed
// on purpose. A target summed over only the entries that had one looks like a real figure and
// understates the work, so a partial target is refused rather than reported. The words and the
// minutes are still reported in full, so the time is never lost.
export function foldBucket(entries: readonly BucketEntry[]): Bucket {
  let words = 0
  let minutes = 0
  let measuredMinutes = 0
  let targetMinutes = 0
  let everyEntryHasQuota = true

  for (const entry of entries) {
    words += entry.words
    minutes += entry.minutes
    if (entry.measured) measuredMinutes += entry.minutes

    if (entry.quotaWph === null || entry.quotaWph <= 0) {
      everyEntryHasQuota = false
      continue
    }
    targetMinutes += (entry.words / entry.quotaWph) * 60
  }

  // Attainment is the target over what it actually took, which is the same number as achieved over
  // target words per hour, in minutes instead of rates. Null when there is no time to compare
  // against, and null when the target is incomplete.
  const attainment = !everyEntryHasQuota || minutes <= 0 ? null : targetMinutes / minutes

  return {
    achievedWph: wordsPerHour(words, minutes),
    assumedMinutes: minutes - measuredMinutes,
    attainment,
    measuredMinutes,
    minutes,
    targetWph: everyEntryHasQuota ? wordsPerHour(words, targetMinutes) : null,
    words
  }
}

// The contract's own order, so two categories always come back in the same sequence and a caller never
// sorts.
//
// Every key this is asked about came through coerceCategory, which answers with one of the ten known
// ids and never with anything else, so indexOf always finds it and the order is always unique. There
// is deliberately no not-found branch and no tiebreak: both were written first, both were unreachable
// by construction, and unreachable code that cannot be tested is worse than an assumption written
// down. PLAN-30 is what breaks the assumption, since a user-created category has no place in the
// shipped order, and it has to revisit this rather than inherit it.
function categoryOrder(categoryId: string): number {
  return DEFAULT_CATEGORY_IDS.indexOf(categoryId as never)
}

// Every calendar day from `from` to `to`, both inclusive.
function datesInRange(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date)
  return dates
}

function computePeriod(
  from: string,
  to: string,
  tasks: readonly StatsTask[],
  quotas: readonly CategoryQuotaRecord[],
  dayRows: ReadonlyMap<string, StatsDayRow>,
  schedule: readonly WorkScheduleRecord[],
  current: ResolvedSchedule | null | undefined
): StatsPeriod {
  const inRange = tasks.filter((task) => task.date >= from && task.date <= to)

  // Consumed counts every task in range, trackable or not and excluded or not, because a meeting and
  // a task the user took out of the statistics both still ate the day.
  const consumedMinutes = inRange.reduce((total, task) => total + effectiveDuration(task), 0)

  // A bucket per trackable category. An excluded task still opens its category's row, because the
  // row keys on a task being present rather than on one contributing, and it contributes nothing to
  // that row once it is there.
  const buckets = new Map<string, BucketEntry[]>()
  for (const task of inRange) {
    const categoryId = coerceCategory(task.category)
    if (!isTrackableCategory(categoryId)) continue

    const entries = buckets.get(categoryId) ?? []
    if (!buckets.has(categoryId)) buckets.set(categoryId, entries)
    if (task.excludeFromStats) continue

    entries.push({
      measured: typeof task.actualMinutes === 'number',
      minutes: effectiveDuration(task),
      // The null side of this is unreachable from here and is not dead. The category is already
      // through the trackable gate above and all four trackable defaults carry a figure, so
      // resolveTaskQuota cannot answer null today, and PLAN-30's user-created categories are what
      // make it possible. What a null quota does to a bucket is covered against foldBucket instead,
      // which is why that fold is exported.
      quotaWph: resolveTaskQuota(task, quotas)?.quotaWph ?? null,
      words: task.projectWordCount ?? 0
    })
  }

  const categories = [...buckets.entries()]
    .sort(([a], [b]) => categoryOrder(a) - categoryOrder(b))
    .map(([categoryId, entries]) => ({ categoryId, ...foldBucket(entries) }))

  // The headline is the same fold with the category filter removed rather than a blend of the rows,
  // so it is hours-weighted by construction and needs no rule of its own.
  const headline = foldBucket([...buckets.values()].flat())

  // Scheduled minutes ask each date what its own settings were, so a day stamped before a settings
  // change keeps the length it was worked at. A date that is not a work day under the settings
  // resolved for it contributes nothing.
  let scheduledMinutes = 0
  for (const date of datesInRange(from, to)) {
    const resolved: ResolvedSchedule = resolveDaySettings(
      date,
      dayRows.get(date),
      schedule,
      current
    )
    if (isWorkDay(date, resolved.workDays)) scheduledMinutes += resolved.workMinutes
  }

  return {
    categories,
    consumedMinutes,
    from,
    headline,
    scheduledMinutes,
    to,
    // May be negative, which reads as working past the schedule rather than as an error.
    unaccountedMinutes: scheduledMinutes - consumedMinutes
  }
}

// The four periods one anchor date resolves, each carrying a row per trackable category with a task
// in it, a headline, and the scheduled, consumed and unaccounted minutes.
export function computeQuotaStats(input: QuotaStatsInput): QuotaStats {
  const { anchor, current, daySettings, quotas, schedule, tasks } = input

  const dayRows = new Map(daySettings.map((row) => [row.date, row]))
  const week = getWeekRange(anchor)
  const month = getMonthRange(anchor)
  const year = getYearRange(anchor)

  const period = (from: string, to: string): StatsPeriod =>
    computePeriod(from, to, tasks, quotas, dayRows, schedule, current)

  return {
    day: period(anchor, anchor),
    month: period(month.from, month.to),
    week: period(week.from, week.to),
    year: period(year.from, year.to)
  }
}
