import { describe, expect, it } from 'vitest'

import {
  addDays,
  chipVariant,
  effectiveDuration,
  formatCount,
  formatDayLabel,
  formatDuration,
  formatWeekLabel,
  getWeekDays,
  getWeekRange,
  isWorkDay,
  statusKey,
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

// The French month abbreviations for formatDayLabel, taken verbatim from the spec's helpers section.
const FR_MONTHS_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juill.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.'
] as const

// English abbreviations for the English-locale branch of formatDayLabel.
const EN_MONTHS_SHORT = [
  'Jan.',
  'Feb.',
  'Mar.',
  'Apr.',
  'May',
  'Jun.',
  'Jul.',
  'Aug.',
  'Sep.',
  'Oct.',
  'Nov.',
  'Dec.'
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
  // Spec example: 2026-07-20 in French is `lundi 20 juill.`.
  it('formats the spec example in French', () => {
    expect(formatDayLabel('2026-07-20', 'fr', FR_MONTHS_SHORT)).toBe('lundi 20 juill.')
  })

  // Sunday, the first day of the week stack.
  it('formats a Sunday in French', () => {
    expect(formatDayLabel('2026-07-19', 'fr', FR_MONTHS_SHORT)).toBe('dimanche 19 juill.')
  })

  // Saturday, the last day of the week stack.
  it('formats a Saturday in French', () => {
    expect(formatDayLabel('2026-07-25', 'fr', FR_MONTHS_SHORT)).toBe('samedi 25 juill.')
  })

  // A January date exercises the first month abbreviation and no leading zero on the day number.
  it('formats a January date without a leading zero on the day', () => {
    expect(formatDayLabel('2026-01-01', 'fr', FR_MONTHS_SHORT)).toBe('jeudi 1 janv.')
  })

  // A December date exercises the last month abbreviation.
  it('formats a December date in French', () => {
    expect(formatDayLabel('2026-12-25', 'fr', FR_MONTHS_SHORT)).toBe('vendredi 25 déc.')
  })

  // Spec: English uses its own abbreviations; the weekday is lowercased, the month is as supplied.
  it('formats a date in English with the supplied abbreviations', () => {
    expect(formatDayLabel('2026-07-20', 'en', EN_MONTHS_SHORT)).toBe('monday 20 Jul.')
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
