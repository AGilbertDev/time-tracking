import { describe, expect, it } from 'vitest'

import type { WorkScheduleRecord } from '#shared/planning'

import {
  addDays,
  chipVariant,
  computeCapacity,
  DEFAULT_SCHEDULE,
  effectiveDuration,
  formatCount,
  formatDayLabel,
  formatDuration,
  formatWeekLabel,
  getWeekDays,
  getWeekRange,
  isWorkDay,
  nowInZone,
  resolveSchedule,
  statusKey,
  sumEffectiveDuration,
  todayInZone
} from '#shared/planning'

// The planning-week spec (docs/specs/planning/week-with-task-rows.md) locks the pure date and
// formatting helpers in its "Pure helpers to unit-test" section, and the PLAN-06 / PLAN-07
// acceptance criteria carry the concrete examples used below. Every expected value here is derived
// from that spec, not from the implementation. The spec anchors the calendar: 2026-07-19 is a
// Sunday and 2026-07-20 is a Monday. From that single anchor the other weekday facts asserted here
// follow (2026-01-01 is a Thursday, 2026-07-01 is a Wednesday, 2026-12-25 is a Friday).

// The French connective words and month names the i18n `planning` namespace supplies to
// formatWeekLabel, per the spec's i18n and copy section.
const FR_MONTHS_FULL = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre'
] as const

// The full English month names for the English-locale branch of formatDayLabel. Per the spec's
// "Day-label month, folded in" section the day header now uses the full month name in both locales,
// consistent with the week label, so the English case supplies full names too (index 0 is January).
const EN_MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

// The French connectives the spec locks: prefix `Semaine du`, separator `au`.
const FR_WEEK_PARTS = {
  locale: 'fr',
  prefix: 'Semaine du',
  separator: 'au',
  months: FR_MONTHS_FULL
} as const

// The spec (helpers section) requires a "non-breaking-style space" as the French thousands
// separator, never a regular ASCII space. Both the narrow no-break space (U+202F) and the plain
// no-break space (U+00A0) satisfy that wording; the Intl fr-CA locale on this runtime emits U+00A0.
const REGULAR_SPACE = 0x20
const NON_BREAKING_SPACES = [0x00a0, 0x202f]

describe('todayInZone', () => {
  // Spec: returns the 'YYYY-MM-DD' calendar day of `now` as seen in `timeZone`.
  it('returns the calendar day for a midday UTC instant in America/Toronto', () => {
    expect(todayInZone(new Date('2026-07-20T12:00:00Z'), 'America/Toronto')).toBe('2026-07-20')
  })

  // Spec edge case (timezone non-drift): a late-UTC instant that is still the previous day in
  // America/Toronto must stay on the earlier date. 2026-07-21T03:00Z is 2026-07-20 23:00 in EDT.
  it('does not drift a day for a late-UTC instant still on the previous day in Toronto', () => {
    expect(todayInZone(new Date('2026-07-21T03:00:00Z'), 'America/Toronto')).toBe('2026-07-20')
  })

  // Forward crossing: an evening-UTC instant is already the next day in a positive-offset zone.
  it('reads the next day for a positive-offset zone that has already rolled over', () => {
    expect(todayInZone(new Date('2026-07-20T20:00:00Z'), 'Asia/Tokyo')).toBe('2026-07-21')
  })

  // In UTC the calendar day is the raw UTC day, even at the last minute before midnight.
  it('returns the raw UTC day for the UTC zone at the last minute of the day', () => {
    expect(todayInZone(new Date('2026-07-20T23:59:00Z'), 'UTC')).toBe('2026-07-20')
  })
})

describe('nowInZone', () => {
  // The late comparison joins a task's delivery date and time into 'YYYY-MM-DDTHH:MM' and compares it
  // as a plain string, so this has to produce exactly that shape and zero-pad every field.
  it('returns the local date and time in the requested zone', () => {
    expect(nowInZone(new Date('2026-07-20T16:30:00Z'), 'America/Toronto')).toBe('2026-07-20T12:30')
  })

  // The same non-drift guarantee todayInZone gives, carried through with the clock attached.
  it('does not drift a day for a late-UTC instant still on the previous day in Toronto', () => {
    expect(nowInZone(new Date('2026-07-21T03:00:00Z'), 'America/Toronto')).toBe('2026-07-20T23:00')
  })

  it('reads the next day for a positive-offset zone that has already rolled over', () => {
    expect(nowInZone(new Date('2026-07-20T20:00:00Z'), 'Asia/Tokyo')).toBe('2026-07-21T05:00')
  })

  // hourCycle h23 has to render midnight as 00, not the 24 an hour12:false format can emit, or a
  // deadline string would sort after every time on its own day.
  it('renders midnight as 00 rather than 24', () => {
    expect(nowInZone(new Date('2026-07-20T00:00:00Z'), 'UTC')).toBe('2026-07-20T00:00')
  })

  it('zero-pads a single-digit month, day, hour, and minute', () => {
    expect(nowInZone(new Date('2026-01-02T03:04:00Z'), 'UTC')).toBe('2026-01-02T03:04')
  })

  // The whole point of the string shape: a deadline that has passed sorts below the current instant.
  it('sorts chronologically against a joined delivery deadline', () => {
    const now = nowInZone(new Date('2026-07-20T16:30:00Z'), 'America/Toronto')
    expect('2026-07-20T11:00' < now).toBe(true)
    expect('2026-07-20T23:59' < now).toBe(false)
  })
})

describe('getWeekRange', () => {
  // Spec: for any date in the week of 2026-07-20 (a Monday) it returns from 2026-07-19 (Sunday)
  // and to 2026-07-25 (Saturday).
  it('returns Sunday-to-Saturday for a Monday in the week', () => {
    expect(getWeekRange('2026-07-20')).toEqual({ from: '2026-07-19', to: '2026-07-25' })
  })

  // Spec: a date that is itself a Sunday returns that Sunday as `from`.
  it('returns the Sunday itself as `from` when the date is a Sunday', () => {
    expect(getWeekRange('2026-07-19')).toEqual({ from: '2026-07-19', to: '2026-07-25' })
  })

  // Boundary: the Saturday end of the week resolves to the same range.
  it('returns the same range for the Saturday at the end of the week', () => {
    expect(getWeekRange('2026-07-25')).toEqual({ from: '2026-07-19', to: '2026-07-25' })
  })

  // Cross-month: the week containing Wednesday 2026-07-01 starts in June.
  it('crosses a month boundary correctly', () => {
    expect(getWeekRange('2026-07-01')).toEqual({ from: '2026-06-28', to: '2026-07-04' })
  })

  // Cross-year: the week containing Thursday 2026-01-01 starts in December 2025.
  it('crosses a year boundary correctly', () => {
    expect(getWeekRange('2026-01-01')).toEqual({ from: '2025-12-28', to: '2026-01-03' })
  })
})

describe('getWeekDays', () => {
  // Spec: seven 'YYYY-MM-DD' strings from Sunday through Saturday, in order.
  it('returns the seven days from Sunday through Saturday in order', () => {
    expect(getWeekDays('2026-07-20')).toEqual([
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
      '2026-07-25'
    ])
  })

  it('returns exactly seven days', () => {
    expect(getWeekDays('2026-07-20')).toHaveLength(7)
  })

  // Spec: its first element equals getWeekRange(date).from and its last equals `.to`.
  it('has a first element equal to the range `from` and last equal to `to`', () => {
    const days = getWeekDays('2026-07-22')
    const { from, to } = getWeekRange('2026-07-22')
    expect(days[0]).toBe(from)
    expect(days[6]).toBe(to)
  })

  // Cross-year continuity: the seven days step cleanly across the 2025/2026 boundary.
  it('crosses the year boundary as seven consecutive days', () => {
    expect(getWeekDays('2026-01-01')).toEqual([
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03'
    ])
  })
})

describe('addDays', () => {
  // Spec: addDays('2026-12-29', 7) is '2027-01-05'.
  it('adds across a year boundary', () => {
    expect(addDays('2026-12-29', 7)).toBe('2027-01-05')
  })

  it('returns the same date for n = 0', () => {
    expect(addDays('2026-07-20', 0)).toBe('2026-07-20')
  })

  it('adds a single day across a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('moves backward for a negative n across a year boundary', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  // Non-leap February 2026: Feb 28 + 1 rolls to March.
  it('rolls a non-leap February 28 forward to March 1', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  // Leap February 2028: Feb 28 + 1 lands on Feb 29.
  it('lands on Feb 29 in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('isWorkDay', () => {
  const weekdays = [1, 2, 3, 4, 5]

  // Spec: with [1,2,3,4,5] a Wednesday is a work day.
  it('returns true for a Wednesday with a Monday-to-Friday schedule', () => {
    expect(isWorkDay('2026-07-22', weekdays)).toBe(true)
  })

  // Spec: with [1,2,3,4,5] a Saturday is not a work day.
  it('returns false for a Saturday with a Monday-to-Friday schedule', () => {
    expect(isWorkDay('2026-07-25', weekdays)).toBe(false)
  })

  // Spec: with [1,2,3,4,5] a Sunday is not a work day.
  it('returns false for a Sunday with a Monday-to-Friday schedule', () => {
    expect(isWorkDay('2026-07-19', weekdays)).toBe(false)
  })

  it('returns true for the Monday boundary of the schedule', () => {
    expect(isWorkDay('2026-07-20', weekdays)).toBe(true)
  })

  // Spec: an empty workDays is all false.
  it('returns false for every day when workDays is empty', () => {
    expect(isWorkDay('2026-07-20', [])).toBe(false)
  })

  // A weekend-only schedule flips the result: Saturday and Sunday are work days.
  it('honours a weekend-only schedule', () => {
    expect(isWorkDay('2026-07-19', [0, 6])).toBe(true)
    expect(isWorkDay('2026-07-25', [0, 6])).toBe(true)
    expect(isWorkDay('2026-07-20', [0, 6])).toBe(false)
  })
})

describe('effectiveDuration', () => {
  // Spec: returns actualMinutes when it is a number.
  it('returns actualMinutes when present', () => {
    expect(effectiveDuration({ actualMinutes: 120, estimatedMinutes: 90 })).toBe(120)
  })

  // Spec: falls back to estimatedMinutes when actual is absent.
  it('falls back to estimatedMinutes when actual is null', () => {
    expect(effectiveDuration({ actualMinutes: null, estimatedMinutes: 90 })).toBe(90)
  })

  // Spec: returns 0 when neither is a number, so the row renders 0 h 00 rather than throwing.
  it('returns 0 when both are null', () => {
    expect(effectiveDuration({ actualMinutes: null, estimatedMinutes: null })).toBe(0)
  })

  // Edge case: zero actual minutes is a number, so it wins over the estimate.
  it('treats a zero actual as present and returns 0 over the estimate', () => {
    expect(effectiveDuration({ actualMinutes: 0, estimatedMinutes: 90 })).toBe(0)
  })

  // Edge case: a zero estimate is still a number and is returned when actual is absent.
  it('returns a zero estimate when actual is null', () => {
    expect(effectiveDuration({ actualMinutes: null, estimatedMinutes: 0 })).toBe(0)
  })
})

describe('formatDuration', () => {
  // Spec examples: 180 -> 3 h 00, 30 -> 0 h 30, 45 -> 0 h 45, with minutes zero-padded.
  it.each([
    [0, '0 h 00'],
    [30, '0 h 30'],
    [45, '0 h 45'],
    [90, '1 h 30'],
    [180, '3 h 00'],
    [600, '10 h 00'],
    [630, '10 h 30']
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(formatDuration(minutes, 'fr')).toBe(expected)
  })

  // Spec: English uses the same numeric layout, so the shape does not change with the locale.
  it('uses the same layout in English', () => {
    expect(formatDuration(180, 'en')).toBe('3 h 00')
  })

  // The locale argument is optional per the signature and does not change the shape.
  it('works without a locale argument', () => {
    expect(formatDuration(180)).toBe('3 h 00')
  })
})

describe('formatCount', () => {
  // Spec: 1350 is `1 350` in French. The grouping character must be a non-breaking-style space
  // (U+00A0 or U+202F), never a regular ASCII space. The digits themselves must be 1, 3, 5, 0.
  it('groups thousands with a non-breaking-style space, not a regular space, in French', () => {
    const formatted = formatCount(1350, 'fr')
    expect(formatted).toHaveLength(5)
    expect(formatted[0]).toBe('1')
    expect(formatted.slice(2)).toBe('350')
    const separator = formatted.charCodeAt(1)
    expect(separator).not.toBe(REGULAR_SPACE)
    expect(NON_BREAKING_SPACES).toContain(separator)
  })

  // Spec: 600 is `600` with no separator.
  it('renders a three-digit value without a separator in French', () => {
    expect(formatCount(600, 'fr')).toBe('600')
  })

  // English uses its own grouping (a comma), showing the locale branch.
  it('groups thousands with a comma in English', () => {
    expect(formatCount(1350, 'en')).toBe('1,350')
  })
})

describe('formatDayLabel', () => {
  // Spec "Day-label month, folded in": the day header now uses the FULL month name, so 2026-07-20 in
  // French is `lundi 20 juillet` (not the abbreviated `juill.`), consistent with the week label.
  it('formats the spec example in French with the full month name', () => {
    expect(formatDayLabel('2026-07-20', 'fr', FR_MONTHS_FULL)).toBe('lundi 20 juillet')
  })

  // Sunday, the first day of the week stack.
  it('formats a Sunday in French', () => {
    expect(formatDayLabel('2026-07-19', 'fr', FR_MONTHS_FULL)).toBe('dimanche 19 juillet')
  })

  // Saturday, the last day of the week stack.
  it('formats a Saturday in French', () => {
    expect(formatDayLabel('2026-07-25', 'fr', FR_MONTHS_FULL)).toBe('samedi 25 juillet')
  })

  // A January date exercises the first full month name and no leading zero on the day number.
  it('formats a January date without a leading zero on the day', () => {
    expect(formatDayLabel('2026-01-01', 'fr', FR_MONTHS_FULL)).toBe('jeudi 1 janvier')
  })

  // A December date exercises the last full month name.
  it('formats a December date in French', () => {
    expect(formatDayLabel('2026-12-25', 'fr', FR_MONTHS_FULL)).toBe('vendredi 25 décembre')
  })

  // Spec: English uses the full English month name; the weekday is lowercased, the month is as
  // supplied, so 2026-07-20 in English is `monday 20 July`.
  it('formats a date in English with the full month name', () => {
    expect(formatDayLabel('2026-07-20', 'en', EN_MONTHS_FULL)).toBe('monday 20 July')
  })
})

describe('formatWeekLabel', () => {
  // Spec: same-month week names the month once at the end.
  it('formats a same-month week in French', () => {
    expect(formatWeekLabel('2026-07-19', '2026-07-25', FR_WEEK_PARTS)).toBe(
      'Semaine du 19 au 25 juillet 2026'
    )
  })

  // Spec: a two-month week carries each day part's month with the year once at the end.
  it('formats a week spanning two months', () => {
    expect(formatWeekLabel('2026-06-29', '2026-07-05', FR_WEEK_PARTS)).toBe(
      'Semaine du 29 juin au 5 juillet 2026'
    )
  })

  // Spec: a two-year week carries each end's own year.
  it('formats a week spanning two years', () => {
    expect(formatWeekLabel('2025-12-29', '2026-01-04', FR_WEEK_PARTS)).toBe(
      'Semaine du 29 décembre 2025 au 4 janvier 2026'
    )
  })
})

describe('statusKey', () => {
  // Spec: for a trackable task the three confirmed status names map to their keys.
  it.each([
    ['Accepté', 'accepte'],
    ['En cours', 'encours'],
    ['Terminé', 'termine']
  ])('maps trackable status %s to %s', (status, expected) => {
    expect(statusKey(status, true)).toBe(expected)
  })

  // Spec: an unknown value on a trackable task gives `na`.
  it('maps an unknown trackable status to na', () => {
    expect(statusKey('Brouillon', true)).toBe('na')
  })

  it('maps a null trackable status to na', () => {
    expect(statusKey(null, true)).toBe('na')
  })

  it('maps an undefined trackable status to na', () => {
    expect(statusKey(undefined, true)).toBe('na')
  })

  // Spec: a non-trackable task always gives `na` regardless of the stored status, so a stray
  // status never colours a meeting or a break.
  it.each([['Accepté'], ['En cours'], ['Terminé'], ['Brouillon']])(
    'forces na for a non-trackable task with stored status %s',
    (status) => {
      expect(statusKey(status, false)).toBe('na')
    }
  )

  it('maps a null non-trackable status to na', () => {
    expect(statusKey(null, false)).toBe('na')
  })

  // The late pseudo-status. The flag comes from the list query, which decides lateness against the
  // user's own clock; these cover how the flag interacts with the guards it has to respect.
  it('omitting the overdue flag leaves the stored status untouched', () => {
    expect(statusKey('En cours', true)).toBe('encours')
  })

  it.each([['Accepté'], ['En cours'], ['Brouillon'], [null], [undefined]])(
    'maps an overdue trackable task with stored status %s to retard',
    (status) => {
      expect(statusKey(status, true, true)).toBe('retard')
    }
  )

  // A finished task is never late, however long ago its delivery was, so Terminé outranks the flag.
  it('never reports a finished task as retard', () => {
    expect(statusKey('Terminé', true, true)).toBe('termine')
  })

  // A break or a meeting has no delivery to miss, so non-trackable stays na even if the flag is set.
  it.each([['Accepté'], ['En cours'], ['Terminé'], [null]])(
    'forces na for an overdue non-trackable task with stored status %s',
    (status) => {
      expect(statusKey(status, false, true)).toBe('na')
    }
  )
})

describe('chipVariant', () => {
  // Spec: trad for translation, rev for revision, neutral for every other id.
  it('returns trad for translation', () => {
    expect(chipVariant('translation')).toBe('trad')
  })

  it('returns rev for revision', () => {
    expect(chipVariant('revision')).toBe('rev')
  })

  it.each([['terminology'], ['meetings'], ['breaks'], ['admin']])(
    'returns neutral for the non-trackable category %s',
    (id) => {
      expect(chipVariant(id)).toBe('neutral')
    }
  )

  // A coerced/unknown or empty id is neutral, since the chip colour is derived from the raw id here.
  it('returns neutral for an unknown or stale category id', () => {
    expect(chipVariant('proofreading')).toBe('neutral')
  })

  it('returns neutral for the empty string', () => {
    expect(chipVariant('')).toBe('neutral')
  })
})

// The read-only week capacity spec (docs/specs/planning/read-only-week-capacity-and-nav.md) locks
// the three capacity helpers in its "Pure helpers to unit-test" section, with the concrete numbers
// carried by AC2, AC3, AC4, AC7-AC12. Every expected value below is derived from that spec, never
// from the implementation. PLAN-03's documented defaults are 450 work minutes, work days
// [1,2,3,4,5], and a 60-minute buffer.

describe('resolveSchedule', () => {
  // AC3 fixture, verbatim from the spec: a record effective 2026-01-01 (450 work minutes) and a
  // later one effective 2026-07-01 (480). Distinct workDays and bufferMinutes on the second record
  // let a resolution be told apart from the default by more than its work minutes alone.
  const history: WorkScheduleRecord[] = [
    { workMinutes: 450, workDays: [1, 2, 3, 4, 5], bufferMinutes: 60, effectiveFrom: '2026-01-01' },
    { workMinutes: 480, workDays: [1, 2, 3, 4], bufferMinutes: 90, effectiveFrom: '2026-07-01' }
  ]

  // AC2: an empty history resolves to the documented defaults (450 / [1,2,3,4,5] / 60).
  it('returns DEFAULT_SCHEDULE for an empty history', () => {
    expect(resolveSchedule([], '2026-07-20')).toEqual({
      workMinutes: 450,
      workDays: [1, 2, 3, 4, 5],
      bufferMinutes: 60
    })
  })

  // AC2: the returned workDays is a fresh copy, so mutating it never changes the exported constant.
  it('does not mutate the DEFAULT_SCHEDULE constant when the returned workDays is mutated', () => {
    const resolved = resolveSchedule([], '2026-07-20')
    resolved.workDays.push(6)
    expect(DEFAULT_SCHEDULE.workDays).toEqual([1, 2, 3, 4, 5])
  })

  // The returned workDays must also not alias the winning record's own array, so a caller mutating
  // the result cannot corrupt the source record.
  it('returns a workDays copy that does not alias the winning record array', () => {
    const record: WorkScheduleRecord = {
      workMinutes: 480,
      workDays: [2, 3, 4],
      bufferMinutes: 30,
      effectiveFrom: '2026-01-01'
    }
    const resolved = resolveSchedule([record], '2026-05-01')
    resolved.workDays.push(6)
    expect(record.workDays).toEqual([2, 3, 4])
  })

  // AC3: a date before the change resolves the old record.
  it('resolves the old record for a date before the change (2026-06-30)', () => {
    expect(resolveSchedule(history, '2026-06-30').workMinutes).toBe(450)
  })

  // AC3: the exact effective-date boundary resolves the NEW record (inclusive lower bound).
  it('resolves the new record on its exact effective date (2026-07-01)', () => {
    expect(resolveSchedule(history, '2026-07-01')).toEqual({
      workMinutes: 480,
      workDays: [1, 2, 3, 4],
      bufferMinutes: 90
    })
  })

  // AC3: a date well after the change resolves the new record.
  it('resolves the new record for a date after the change (2026-08-15)', () => {
    expect(resolveSchedule(history, '2026-08-15').workMinutes).toBe(480)
  })

  // AC3: a date before the first record's effectiveFrom falls back to DEFAULT_SCHEDULE.
  it('returns DEFAULT_SCHEDULE for a date before the first record (2025-12-31)', () => {
    expect(resolveSchedule(history, '2025-12-31')).toEqual({
      workMinutes: 450,
      workDays: [1, 2, 3, 4, 5],
      bufferMinutes: 60
    })
  })

  // AC4: the resolver is order-independent. The same records in reverse order resolve identically.
  it('is order-independent of the input array', () => {
    const reversed = [...history].reverse()
    expect(resolveSchedule(reversed, '2026-06-30').workMinutes).toBe(450)
    expect(resolveSchedule(reversed, '2026-07-01').workMinutes).toBe(480)
    expect(resolveSchedule(reversed, '2026-08-15').workMinutes).toBe(480)
    expect(resolveSchedule(reversed, '2025-12-31')).toEqual(resolveSchedule(history, '2025-12-31'))
  })
})

describe('sumEffectiveDuration', () => {
  // AC7 / spec: an empty list sums to 0.
  it('returns 0 for an empty list', () => {
    expect(sumEffectiveDuration([])).toBe(0)
  })

  // Spec: sums effectiveDuration across a mix. Actual wins over estimate on the first task (120),
  // the second contributes its estimate (45), and the third has neither and contributes 0. The
  // helper reads only actual/estimated, so trackable and non-trackable tasks are summed alike: the
  // fourth task stands in for a non-trackable meeting whose actual minutes still eat the day (30).
  it('sums actual-over-estimate, estimate-only, neither, and a non-trackable duration', () => {
    const tasks = [
      { actualMinutes: 120, estimatedMinutes: 90 },
      { actualMinutes: null, estimatedMinutes: 45 },
      { actualMinutes: null, estimatedMinutes: null },
      { actualMinutes: 30, estimatedMinutes: null }
    ]
    expect(sumEffectiveDuration(tasks)).toBe(195)
  })

  // A single task with neither actual nor estimated minutes contributes 0, so the sum never breaks
  // on a null duration.
  it('contributes 0 for a task with neither actual nor estimated minutes', () => {
    expect(sumEffectiveDuration([{ actualMinutes: null, estimatedMinutes: null }])).toBe(0)
  })
})

describe('computeCapacity', () => {
  // Every case below is against the spec's worked example schedule: 450 work minutes, 60 buffer.
  const WORK = 450
  const BUFFER = 60

  // AC9: the four state bands, including both boundary cases resolving to warn.
  it.each([
    ['good', 300, 'remaining 150 > buffer 60'],
    ['warn', 390, 'remaining 60 == buffer (into the buffer)'],
    ['warn', 450, 'remaining 0 (not overbooked)'],
    ['bad', 500, 'remaining -50 < 0 (overbooked)']
  ])('is %s when booked is %i minutes (%s)', (expectedState, booked) => {
    expect(computeCapacity(booked, WORK, BUFFER).state).toBe(expectedState)
  })

  // AC9 neighbours: one minute either side of the good/warn boundary confirms the strict `>`.
  it('is good one minute above the buffer boundary and warn one minute below', () => {
    expect(computeCapacity(389, WORK, BUFFER).state).toBe('good') // remaining 61 > 60
    expect(computeCapacity(391, WORK, BUFFER).state).toBe('warn') // remaining 59 <= 60
  })

  // AC8: remaining = workMinutes - booked, and excess = max(0, booked - workMinutes). Not overbooked.
  it('computes remaining and a zero excess when not overbooked', () => {
    const capacity = computeCapacity(300, WORK, BUFFER)
    expect(capacity.remaining).toBe(150)
    expect(capacity.excess).toBe(0)
  })

  // AC8: an overbooked day yields a negative remaining and a positive excess.
  it('computes a negative remaining and a positive excess when overbooked', () => {
    const capacity = computeCapacity(500, WORK, BUFFER)
    expect(capacity.remaining).toBe(-50)
    expect(capacity.excess).toBe(50)
  })

  // AC11: fillPct is the correct percentage below full.
  it('computes fillPct as the booked percentage below full', () => {
    expect(computeCapacity(225, WORK, BUFFER).fillPct).toBe(50)
  })

  // AC11: fillPct clamps at 100 when booked meets or exceeds workMinutes.
  it('clamps fillPct at 100 when booked equals workMinutes', () => {
    expect(computeCapacity(450, WORK, BUFFER).fillPct).toBe(100)
  })

  it('clamps fillPct at 100 when booked exceeds workMinutes', () => {
    expect(computeCapacity(500, WORK, BUFFER).fillPct).toBe(100)
  })

  // AC11: bufferPct is (bufferMinutes / workMinutes) * 100, 13.3 % for the spec's 60 / 450.
  it('computes bufferPct as the buffer percentage of the work day', () => {
    expect(computeCapacity(300, WORK, BUFFER).bufferPct).toBeCloseTo(13.333, 3)
  })

  // Divide-by-zero guard (AC/edge): a degenerate workMinutes of 0 with work booked is bad, with
  // fillPct forced to 100 and bufferPct to 0.
  it('guards a zero workMinutes with booked work: bad, fillPct 100, bufferPct 0', () => {
    const capacity = computeCapacity(100, 0, BUFFER)
    expect(capacity.state).toBe('bad')
    expect(capacity.fillPct).toBe(100)
    expect(capacity.bufferPct).toBe(0)
  })

  // Divide-by-zero guard: a zero workMinutes with nothing booked is warn (remaining 0), fillPct 0.
  it('guards a zero workMinutes with nothing booked: warn, fillPct 0, bufferPct 0', () => {
    const capacity = computeCapacity(0, 0, BUFFER)
    expect(capacity.state).toBe('warn')
    expect(capacity.fillPct).toBe(0)
    expect(capacity.bufferPct).toBe(0)
  })

  // AC12: a work day with zero tasks gives booked 0, remaining == workMinutes, and the good state.
  it('reports a full remaining and the good state for a work day with zero tasks', () => {
    const capacity = computeCapacity(0, WORK, BUFFER)
    expect(capacity.booked).toBe(0)
    expect(capacity.remaining).toBe(WORK)
    expect(capacity.excess).toBe(0)
    expect(capacity.state).toBe('good')
    expect(capacity.fillPct).toBe(0)
  })
})
