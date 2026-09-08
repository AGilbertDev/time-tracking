import { resolveDaySettings } from '~~/server/utils/resolveDaySettings'
import { describe, expect, it } from 'vitest'

import type { ResolvedSchedule, WorkScheduleRecord } from '#shared/planning'

import { DEFAULT_SCHEDULE, resolveSchedule } from '#shared/planning'

// The day settings resolver, from AC6 and AC8 of docs/specs/planning/day-settings-snapshot.md.
//
//   AC6. "The resolution order for any date is the day's own row, then the effective-dated
//   work_schedule through the shipped resolveSchedule, then the user's current settings row, then
//   DEFAULT_SCHEDULE. A day nobody worked has no row and still resolves."
//
// The current settings tier is the one the 2026-09-07 amendment added, and AC6 records why: nothing
// in the app writes work_schedule, so an unstamped day answered with the shipped 7 h 30 rather than
// with the hours the user had actually set, overstating every leftover on such a day. The quote above
// is the amended wording. The blocks below that were written against the three-tier order keep their
// case names, because their assertions are unchanged; only the tier they are numbered as moved.
//
//   AC8. "The resolver is pure and database-free, taking a date, a day row or null, and the schedule
//   records, so every criterion above is testable against fixtures with no database."
//
//   AC9. "work_days is stored as JSON text and read through the same defensive coercion
//   loadWorkSchedule already applies, so a corrupt value falls back rather than reaching the engine."
//
// So the signature these fixtures are written against is
// resolveDaySettings(date, row, records, current), which is the argument order AC8 states with the
// amended AC6's third tier appended, and the answer is a ResolvedSchedule carrying the three values
// in force on that date. `current` is the user's live work settings as a ResolvedSchedule-shaped
// value, or null / undefined when they have no settings row, which is why every case written before
// the amendment can omit it and still resolve the way it did.
//
// The day row is modelled with work_days as the JSON text the column holds rather than as a parsed
// array, because AC9 puts the coercion on the read of the row and a resolver handed an array would
// have nothing to coerce. That is a reading of the spec rather than a statement in it, and it is
// recorded here so the choice is visible.
//
// The second tier is asserted against the shipped resolveSchedule rather than against a copy of its
// answer wherever the two can be compared, because AC6 names that function specifically. A resolver
// that reimplemented the effective-dated lookup would satisfy a literal and still be the second copy
// of a rule this project keeps once.

// A day row as the column values arrive. workDays is the raw stored text.
type DayRow = {
  bufferMinutes: number
  workDays: string
  workMinutes: number
}

function dayRow(overrides: Partial<DayRow> = {}): DayRow {
  return { bufferMinutes: 60, workDays: '[1,2,3,4,5]', workMinutes: 450, ...overrides }
}

// A schedule history whose values are visibly none of the defaults, so a result matching it cannot
// also be a result that fell through to DEFAULT_SCHEDULE.
const SCHEDULE: WorkScheduleRecord[] = [
  { bufferMinutes: 30, effectiveFrom: '2026-01-01', workDays: [1, 2, 3], workMinutes: 300 },
  { bufferMinutes: 45, effectiveFrom: '2026-06-01', workDays: [1, 2, 3, 4], workMinutes: 360 }
]

// The user's live settings row, as the caller resolves it before handing it over. Every figure is
// visibly none of the other three tiers', so on 2026-09-09 the four candidate answers are the stamp
// (400 / [1,2,3,4,5,6] / 90), the schedule record in force (360 / [1,2,3,4] / 45), these current
// settings (480 / [0,6] / 15) and DEFAULT_SCHEDULE (450 / [1,2,3,4,5] / 60). No two agree on any
// field, so a result matching one tier cannot also be a result that fell through to another.
//
// ABOUT bufferMinutes, WHICH THE SETTINGS ROW HAS NO COLUMN FOR. The parameter is
// ResolvedSchedule-shaped, so it carries a buffer whatever the table holds, and AC5 settles what the
// caller is expected to put there: "buffer_minutes is stamped even though settings carries no such
// column today. The value is DEFAULT_SCHEDULE's 60 until a real setting exists." That is a rule about
// the caller and not about the resolver, so the cases below assert two separate things and invent
// neither. The resolver returns whatever buffer it is handed, and a caller following AC5 therefore
// resolves 60. This fixture uses 15 only so the tier it stands for stays distinguishable.
const CURRENT: ResolvedSchedule = { bufferMinutes: 15, workDays: [0, 6], workMinutes: 480 }

describe('resolveDaySettings', () => {
  describe("the first tier: the day's own row (AC6)", () => {
    it('returns the values stamped on the day', () => {
      const resolved = resolveDaySettings(
        '2026-09-09',
        dayRow({ bufferMinutes: 90, workDays: '[1,2,3,4,5,6]', workMinutes: 400 }),
        SCHEDULE
      )

      expect(resolved).toEqual({
        bufferMinutes: 90,
        workDays: [1, 2, 3, 4, 5, 6],
        workMinutes: 400
      })
    })

    // The whole point of the snapshot. A schedule record that took effect on the very day being
    // resolved still loses to the stamp, because the stamp is what the day was measured against and a
    // later settings change must not reach backward.
    it('outranks a schedule record effective on that same date', () => {
      const records: WorkScheduleRecord[] = [
        { bufferMinutes: 15, effectiveFrom: '2026-09-09', workDays: [0, 6], workMinutes: 600 }
      ]

      expect(
        resolveDaySettings('2026-09-09', dayRow({ workMinutes: 400 }), records).workMinutes
      ).toBe(400)
    })

    // A stamped day whose length is zero is a real stamped value rather than a missing one, so it
    // must not read as absent and fall through to the schedule.
    it('keeps a stamped zero rather than treating it as no value', () => {
      expect(
        resolveDaySettings('2026-09-09', dayRow({ workMinutes: 0 }), SCHEDULE).workMinutes
      ).toBe(0)
    })

    // An empty stamped work_days set is a day the user marked as no work days at all, which is a
    // legitimate stored value the shipped coercion preserves rather than replacing with the default.
    it('keeps a stamped empty work_days set', () => {
      expect(
        resolveDaySettings('2026-09-09', dayRow({ workDays: '[]' }), SCHEDULE).workDays
      ).toEqual([])
    })
  })

  describe('the second tier: the effective-dated schedule (AC6)', () => {
    it('resolves through the shipped resolveSchedule when the day has no row', () => {
      expect(resolveDaySettings('2026-09-09', null, SCHEDULE)).toEqual(
        resolveSchedule(SCHEDULE, '2026-09-09')
      )
    })

    it('returns the record in force on the date rather than the latest one', () => {
      expect(resolveDaySettings('2026-03-15', null, SCHEDULE)).toEqual({
        bufferMinutes: 30,
        workDays: [1, 2, 3],
        workMinutes: 300
      })
    })

    it('takes a record effective on the date itself, an inclusive lower bound', () => {
      expect(resolveDaySettings('2026-06-01', null, SCHEDULE).workMinutes).toBe(360)
    })

    // A date before every record has no schedule to read, so it falls past this tier rather than
    // borrowing the earliest record. With no current settings handed over, the next tier that can
    // answer is DEFAULT_SCHEDULE, which is why this case still expects the defaults after the
    // amendment. The same date with current settings is covered in the third-tier block below.
    it('falls through to the defaults for a date preceding every record', () => {
      expect(resolveDaySettings('2025-12-31', null, SCHEDULE)).toEqual({
        bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
        workDays: [...DEFAULT_SCHEDULE.workDays],
        workMinutes: DEFAULT_SCHEDULE.workMinutes
      })
    })
  })

  describe('the last tier: DEFAULT_SCHEDULE (AC6)', () => {
    // "A day nobody worked has no row and still resolves." No row and no history at all is the state
    // every day worked before this feature shipped is in, since the spec out-of-scope section refuses
    // to backfill them.
    it('resolves a day with no row and no schedule history', () => {
      expect(resolveDaySettings('2026-09-09', null, [])).toEqual({
        bufferMinutes: 60,
        workDays: [1, 2, 3, 4, 5],
        workMinutes: 450
      })
    })

    it('agrees with the shipped DEFAULT_SCHEDULE rather than with a second copy of it', () => {
      expect(resolveDaySettings('2026-09-09', null, [])).toEqual({
        bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
        workDays: [...DEFAULT_SCHEDULE.workDays],
        workMinutes: DEFAULT_SCHEDULE.workMinutes
      })
    })

    // The constant is shared by every caller, so handing out its own array would let one caller's
    // mutation change what every later caller resolves.
    it('returns a fresh work_days array rather than the constant own array', () => {
      const resolved = resolveDaySettings('2026-09-09', null, [])
      resolved.workDays.push(6)

      expect(DEFAULT_SCHEDULE.workDays).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('AC9: the stored work_days text is coerced defensively', () => {
    // The same coercion loadWorkSchedule applies, which falls back to Monday through Friday for a
    // value that is not a JSON array, drops any entry that is not an integer 0 through 6, removes
    // duplicates, and preserves a legitimately empty array.
    //
    // WHERE THE FALLBACK GOES IS NOW SETTLED, so the mixed case that was deliberately left out has
    // its own cases below. AC9: "It falls back to that coercion's own default set and never to the
    // next AC6 tier, because a row that exists is not a missing row. A legitimately empty array stays
    // empty, meaning a week with no work days, which is a real setting rather than a corrupt one."
    //
    // The cases in this first table run with an empty schedule history, where the two candidate
    // answers agree, and the pair after it runs with a history that disagrees, which is what actually
    // pins the rule.
    it.each([
      { label: 'text that is not JSON at all', stored: '{oops' },
      { label: 'a JSON object rather than an array', stored: '{"1":true}' },
      { label: 'a JSON null', stored: 'null' },
      { label: 'a JSON number', stored: '5' },
      { label: 'a JSON string', stored: '"[1,2,3]"' },
      { label: 'an empty string', stored: '' }
    ])('falls back to the default set for $label', ({ stored }) => {
      expect(resolveDaySettings('2026-09-09', dayRow({ workDays: stored }), []).workDays).toEqual([
        1, 2, 3, 4, 5
      ])
    })

    // The mixed case, which is the discriminating one. SCHEDULE's record in force on this date works
    // Monday through Thursday, so the coercion's own default set and the next AC6 tier give visibly
    // different answers, and AC9 says the coercion's own set wins. A resolver that treated a corrupt
    // value as a missing row would answer [1, 2, 3, 4] here.
    it('falls back to the coercion default set rather than to the schedule work days', () => {
      const resolved = resolveDaySettings(
        '2026-09-09',
        dayRow({ workDays: 'not json', workMinutes: 400 }),
        SCHEDULE
      )

      expect(resolved.workDays).toEqual([1, 2, 3, 4, 5])
      expect(resolved.workDays).not.toEqual([1, 2, 3, 4])
    })

    // The rest of the row survives the same way, so a corrupt work_days does not send the whole row
    // to the schedule tier. The stamped 400 minutes and 15 minute buffer are what the day was
    // measured against, and the schedule's 360 and 45 are not.
    it('keeps the rest of a corrupt row rather than falling to the schedule tier', () => {
      const resolved = resolveDaySettings(
        '2026-09-09',
        dayRow({ bufferMinutes: 15, workDays: '{"1":true}', workMinutes: 400 }),
        SCHEDULE
      )

      expect(resolved).toEqual({ bufferMinutes: 15, workDays: [1, 2, 3, 4, 5], workMinutes: 400 })
    })

    // The other half of the settled rule. An empty array is a real setting rather than a corrupt one,
    // so it stays empty even when the schedule tier would have supplied work days, and the day it
    // describes is a day with no work days at all.
    it('keeps an empty array empty rather than reading it as corrupt', () => {
      const resolved = resolveDaySettings('2026-09-09', dayRow({ workDays: '[]' }), SCHEDULE)

      expect(resolved.workDays).toEqual([])
      expect(resolved.workDays).not.toEqual([1, 2, 3])
      expect(resolved.workDays).not.toEqual([1, 2, 3, 4, 5])
    })

    it('drops entries that are not integers 0 through 6 and removes duplicates', () => {
      expect(
        resolveDaySettings('2026-09-09', dayRow({ workDays: '[1,"2",3,9,-1,3.5,3]' }), []).workDays
      ).toEqual([1, 3])
    })

    it('keeps a valid weekend set, including 0 for Sunday and 6 for Saturday', () => {
      expect(resolveDaySettings('2026-09-09', dayRow({ workDays: '[6,0]' }), []).workDays).toEqual([
        6, 0
      ])
    })

    // A corrupt work_days must not discard the rest of the stamp. The minutes and the buffer on that
    // row are perfectly good stored values and the day was measured against them.
    it('keeps the work minutes and the buffer from a row whose work_days is corrupt', () => {
      const resolved = resolveDaySettings(
        '2026-09-09',
        dayRow({ bufferMinutes: 15, workDays: 'not json', workMinutes: 375 }),
        []
      )

      expect(resolved.workMinutes).toBe(375)
      expect(resolved.bufferMinutes).toBe(15)
    })

    it('never returns a work_days entry outside 0 through 6', () => {
      const resolved = resolveDaySettings('2026-09-09', dayRow({ workDays: '[0,6,7,-2]' }), [])

      for (const day of resolved.workDays) {
        expect(Number.isInteger(day)).toBe(true)
        expect(day).toBeGreaterThanOrEqual(0)
        expect(day).toBeLessThanOrEqual(6)
      }
    })
  })

  describe('all four AC6 tiers, each reached and each distinguishable', () => {
    // One date, one set of inputs per tier, and four answers that share no field. Read together
    // these four cases are the amended resolution order in full.
    it("resolves the day's own row when every tier could have answered", () => {
      expect(
        resolveDaySettings(
          '2026-09-09',
          dayRow({ bufferMinutes: 90, workDays: '[1,2,3,4,5,6]', workMinutes: 400 }),
          SCHEDULE,
          CURRENT
        )
      ).toEqual({ bufferMinutes: 90, workDays: [1, 2, 3, 4, 5, 6], workMinutes: 400 })
    })

    it('resolves the applicable schedule record when the day has no row', () => {
      expect(resolveDaySettings('2026-09-09', null, SCHEDULE, CURRENT)).toEqual({
        bufferMinutes: 45,
        workDays: [1, 2, 3, 4],
        workMinutes: 360
      })
    })

    it('resolves the current settings when no row and no record can answer', () => {
      expect(resolveDaySettings('2026-09-09', null, [], CURRENT)).toEqual({
        bufferMinutes: 15,
        workDays: [0, 6],
        workMinutes: 480
      })
    })

    it('resolves DEFAULT_SCHEDULE when no tier above it can answer', () => {
      expect(resolveDaySettings('2026-09-09', null, [], null)).toEqual({
        bufferMinutes: 60,
        workDays: [1, 2, 3, 4, 5],
        workMinutes: 450
      })
    })
  })

  describe("the third tier: the user's current settings row (AC6)", () => {
    // THE CASE THE AMENDMENT EXISTS FOR. Every record postdates the date being resolved, so no
    // record applies and resolveSchedule answers with DEFAULT_SCHEDULE, which is exactly why its
    // answer alone cannot say whether a record actually applied. The current settings must win here.
    it('resolves the current settings for a date every schedule record postdates', () => {
      expect(resolveDaySettings('2025-12-31', null, SCHEDULE, CURRENT)).toEqual({
        bufferMinutes: 15,
        workDays: [0, 6],
        workMinutes: 480
      })
    })

    it('resolves the current settings rather than the defaults resolveSchedule would supply', () => {
      const resolved = resolveDaySettings('2025-12-31', null, SCHEDULE, CURRENT)

      expect(resolved).not.toEqual(resolveSchedule(SCHEDULE, '2025-12-31'))
      expect(resolved.workMinutes).not.toBe(DEFAULT_SCHEDULE.workMinutes)
    })

    it('resolves the current settings when the schedule history is empty', () => {
      expect(resolveDaySettings('2026-09-09', null, [], CURRENT).workMinutes).toBe(480)
    })

    it('resolves the current work days rather than the shipped Monday-to-Friday set', () => {
      expect(resolveDaySettings('2026-09-09', null, [], CURRENT).workDays).toEqual([0, 6])
    })

    // A settings row that exists is what puts this tier in reach, so its values are read as stored
    // rather than tested for truthiness. Same reasoning as the stamped-zero case in the first tier.
    it('keeps a current work minutes of zero rather than falling through to the defaults', () => {
      const current: ResolvedSchedule = { bufferMinutes: 15, workDays: [0, 6], workMinutes: 0 }

      expect(resolveDaySettings('2026-09-09', null, [], current).workMinutes).toBe(0)
    })

    it('keeps an empty current work days set rather than falling through to the defaults', () => {
      const current: ResolvedSchedule = { bufferMinutes: 15, workDays: [], workMinutes: 480 }

      expect(resolveDaySettings('2026-09-09', null, [], current).workDays).toEqual([])
    })

    // A user with no settings row at all. AC6 puts DEFAULT_SCHEDULE behind this tier for exactly
    // that case, and both absences mean the same thing.
    it.each([
      { current: null, label: 'null' },
      { current: undefined, label: 'undefined' }
    ])('treats a $label current settings as no settings row', ({ current }) => {
      expect(resolveDaySettings('2026-09-09', null, [], current)).toEqual({
        bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
        workDays: [...DEFAULT_SCHEDULE.workDays],
        workMinutes: DEFAULT_SCHEDULE.workMinutes
      })
    })

    // The two halves of the buffer question the fixture header sets out. The resolver has no rule of
    // its own, and AC5 fixes what the caller passes.
    it('returns the bufferMinutes it was handed, having no buffer rule of its own', () => {
      const current: ResolvedSchedule = { bufferMinutes: 15, workDays: [0, 6], workMinutes: 480 }

      expect(resolveDaySettings('2026-09-09', null, [], current).bufferMinutes).toBe(15)
    })

    it("resolves 60 for a caller passing DEFAULT_SCHEDULE's buffer, as AC5 says it will", () => {
      const current: ResolvedSchedule = {
        bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
        workDays: [0, 6],
        workMinutes: 480
      }

      expect(resolveDaySettings('2026-09-09', null, [], current).bufferMinutes).toBe(60)
    })

    // NAMED FOR THE FAILURE MESSAGE. This is the reported bug, in the numbers the spec's amendment
    // uses: a translator whose settings say six hours had every unstamped day measured against the
    // shipped 7 h 30, so each one overstated the leftover by 90 minutes, and the same day read 7 h 30
    // before its first task and 360 after it.
    it('resolves a stored six-hour day as 360 minutes and not the shipped 450 for an unstamped day with no schedule history', () => {
      const sixHourDay: ResolvedSchedule = {
        bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
        workDays: [1, 2, 3, 4, 5],
        workMinutes: 360
      }

      const resolved = resolveDaySettings('2026-09-09', null, [], sixHourDay)

      expect(resolved.workMinutes).toBe(360)
      expect(resolved.workMinutes).not.toBe(450)
    })
  })

  describe('the second tier still beats the third (AC6)', () => {
    // A dated record is a recorded fact and the live row is only the best remaining guess, so a
    // record that applies wins.
    it('prefers a schedule record that applies over the current settings', () => {
      expect(resolveDaySettings('2026-09-09', null, SCHEDULE, CURRENT)).toEqual(
        resolveSchedule(SCHEDULE, '2026-09-09')
      )
    })

    it('prefers a record effective on the date itself over the current settings', () => {
      expect(resolveDaySettings('2026-06-01', null, SCHEDULE, CURRENT).workMinutes).toBe(360)
    })

    it('prefers the record in force over the current settings, not the latest record', () => {
      expect(resolveDaySettings('2026-03-15', null, SCHEDULE, CURRENT)).toEqual({
        bufferMinutes: 30,
        workDays: [1, 2, 3],
        workMinutes: 300
      })
    })

    // And the first tier still beats both. A stamp is what the day was measured against, so a later
    // settings change reaching the live row must not reach backward through it.
    it('prefers the stamped row over the current settings', () => {
      expect(
        resolveDaySettings('2026-09-09', dayRow({ workMinutes: 400 }), [], CURRENT).workMinutes
      ).toBe(400)
    })

    // AC9, now that a further tier exists to be wrongly fallen to: "It falls back to that coercion's
    // own default set and never to the next AC6 tier, because a row that exists is not a missing
    // row." A resolver treating a corrupt work_days as a missing row would answer [0, 6] here.
    it('falls back to the coercion default set rather than to the current work days', () => {
      const resolved = resolveDaySettings(
        '2026-09-09',
        dayRow({ workDays: 'not json', workMinutes: 400 }),
        [],
        CURRENT
      )

      expect(resolved.workDays).toEqual([1, 2, 3, 4, 5])
      expect(resolved.workDays).not.toEqual([0, 6])
    })
  })

  describe('the last tier survives the amendment (AC6)', () => {
    it('resolves DEFAULT_SCHEDULE with no row, no applicable record and no current settings', () => {
      expect(resolveDaySettings('2025-12-31', null, SCHEDULE, null)).toEqual({
        bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
        workDays: [...DEFAULT_SCHEDULE.workDays],
        workMinutes: DEFAULT_SCHEDULE.workMinutes
      })
    })

    // The constant is shared by every caller, so the fourth tier must still hand out its own array
    // rather than the constant's, the same way the block above checks it for the three-argument call.
    it('returns a fresh work_days array when it falls to the defaults past an absent current row', () => {
      const resolved = resolveDaySettings('2026-09-09', null, [], null)
      resolved.workDays.push(6)

      expect(DEFAULT_SCHEDULE.workDays).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('AC8: pure and database-free', () => {
    it('leaves the day row it was handed untouched', () => {
      const row = dayRow({ workDays: '[1,2,3,4,5]' })
      const before = { ...row }

      resolveDaySettings('2026-09-09', row, SCHEDULE)

      expect(row).toEqual(before)
    })

    it('leaves the schedule records it was handed untouched', () => {
      const records: WorkScheduleRecord[] = SCHEDULE.map((record) => ({
        ...record,
        workDays: [...record.workDays]
      }))
      const before = JSON.stringify(records)

      resolveDaySettings('2026-09-09', null, records)

      expect(JSON.stringify(records)).toBe(before)
    })

    it('leaves the current settings object it was handed untouched', () => {
      const current: ResolvedSchedule = { bufferMinutes: 15, workDays: [0, 6], workMinutes: 480 }
      const before = JSON.stringify(current)

      resolveDaySettings('2026-09-09', null, [], current)

      expect(JSON.stringify(current)).toBe(before)
    })

    it('returns the same answer for the same inputs, so nothing reads a clock', () => {
      const row = dayRow({ workMinutes: 420 })

      expect(resolveDaySettings('2026-09-09', row, SCHEDULE)).toEqual(
        resolveDaySettings('2026-09-09', row, SCHEDULE)
      )
    })

    it('is independent of the order the schedule records arrive in', () => {
      const reversed = [...SCHEDULE].reverse()

      expect(resolveDaySettings('2026-09-09', null, reversed)).toEqual(
        resolveDaySettings('2026-09-09', null, SCHEDULE)
      )
    })
  })
})
