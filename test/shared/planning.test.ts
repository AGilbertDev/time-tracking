import { describe, expect, it } from 'vitest'

import type { WorkScheduleRecord } from '#shared/planning'

import {
  addDays,
  computeCapacity,
  DEFAULT_SCHEDULE,
  effectiveDuration,
  formatCount,
  formatDayLabel,
  formatDeadline,
  formatDeliveryDate,
  formatDuration,
  formatWeekLabel,
  getWeekDays,
  getWeekRange,
  isWorkDay,
  nowInZone,
  resolveSchedule,
  statusKey,
  sumEffectiveDuration,
  TASK_STATUS_DONE,
  TASK_STATUSES,
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

// The abbreviated French month names the i18n `planning.monthsShort` array supplies to
// formatDeliveryDate, listed verbatim in the progressive-disclosure spec
// (docs/specs/planning/extend-tasks.md, "Copy / i18n changes"). `mars`, `mai`, `juin`, and `août`
// carry no trailing period because they are already short enough to print whole, which is a copy
// decision the spec researched rather than a formatting rule this module could derive.
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

// The abbreviated English month names from the same spec section. `May` is the one that carries no
// period in English, for the same reason the four French ones do not.
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

// The progressive-disclosure spec (docs/specs/planning/extend-tasks.md) adds formatDeliveryDate and
// locks it in AC28, with AC19 carrying the rest of the deadline contract. The two worked examples
// there are `16 juill.` for a same-year delivery and `4 janv. 2027` for a cross-year one, and the
// month names come from the caller's localized array exactly as formatDayLabel and formatWeekLabel
// take one. Every expected value below is derived from those criteria, not from the implementation.

describe('formatDeliveryDate', () => {
  // AC28's same-year example, verbatim. The task and the delivery are the same day, which is the
  // common case for a task due the day it is planned.
  it('formats the spec example as the day number and the abbreviated month', () => {
    expect(formatDeliveryDate('2026-07-16', '2026-07-16', FR_MONTHS_SHORT)).toBe('16 juill.')
  })

  // Still the same year, so still no year suffix, even though the delivery is months away from the
  // task. The year is about ambiguity, not about distance.
  it('omits the year for a delivery months later in the same year', () => {
    expect(formatDeliveryDate('2026-09-03', '2026-07-20', FR_MONTHS_SHORT)).toBe('3 sept.')
  })

  // A delivery that already passed is the `En retard` case, and it reads the same way. Nothing about
  // lateness belongs to this helper, since the status carries it.
  it('omits the year for a delivery earlier in the same year than the task', () => {
    expect(formatDeliveryDate('2026-03-02', '2026-07-20', FR_MONTHS_SHORT)).toBe('2 mars')
  })

  // AC28: the day number carries no leading zero, matching how formatDayLabel prints it.
  it('prints a single-digit day with no leading zero', () => {
    expect(formatDeliveryDate('2026-07-04', '2026-07-20', FR_MONTHS_SHORT)).toBe('4 juill.')
  })

  // AC28's reason for the whole year suffix: a December task with a January deadline. Without the
  // year, `4 janv.` on a December row reads as a date eleven months in the past.
  it('appends the year for a December task with a January deadline', () => {
    expect(formatDeliveryDate('2027-01-04', '2026-12-28', FR_MONTHS_SHORT)).toBe('4 janv. 2027')
  })

  // The same boundary crossed the other way. A task planned in early January can carry a deadline
  // left over from December, and that one is ambiguous too.
  it('appends the year for a January task with a December deadline in the previous year', () => {
    expect(formatDeliveryDate('2026-12-31', '2027-01-04', FR_MONTHS_SHORT)).toBe('31 déc. 2026')
  })

  // The comparison is on the calendar year, not on how far apart the two dates are, so a delivery
  // more than a year out still gets exactly one year suffix.
  it('appends the year for a delivery more than a full year after the task', () => {
    expect(formatDeliveryDate('2028-05-10', '2026-07-20', FR_MONTHS_SHORT)).toBe('10 mai 2028')
  })

  // AC28: the year is appended only when it says something. A same-year delivery must not carry the
  // digits at all, or every row in a normal week would print a year that adds nothing.
  it('never prints the year digits for a same-year delivery', () => {
    expect(formatDeliveryDate('2026-12-31', '2026-01-01', FR_MONTHS_SHORT)).not.toContain('2026')
  })

  // The four French months the spec keeps unabbreviated because they are already short. They are the
  // cases most likely to grow a wrong trailing period, so each one is asserted whole.
  it.each([
    ['2026-03-15', '15 mars'],
    ['2026-05-15', '15 mai'],
    ['2026-06-15', '15 juin'],
    ['2026-08-15', '15 août']
  ])('prints %s with its unabbreviated French month as %s', (deliveryDate, expected) => {
    expect(formatDeliveryDate(deliveryDate, '2026-07-20', FR_MONTHS_SHORT)).toBe(expected)
  })

  // The same four months keep their unabbreviated form when the year is appended too, so the year
  // branch reads the array the same way the same-year branch does.
  it('keeps an unabbreviated French month in the cross-year form', () => {
    expect(formatDeliveryDate('2027-08-15', '2026-07-20', FR_MONTHS_SHORT)).toBe('15 août 2027')
  })

  // Index 0 is January and index 11 is December, which is the contract formatDayLabel and
  // formatWeekLabel already hold the caller to.
  it('reads the month array with January at index 0 and December at index 11', () => {
    expect(formatDeliveryDate('2026-01-09', '2026-07-20', FR_MONTHS_SHORT)).toBe('9 janv.')
    expect(formatDeliveryDate('2026-12-09', '2026-07-20', FR_MONTHS_SHORT)).toBe('9 déc.')
  })

  // English is the same shape with the caller's own array, since the helper holds no month copy.
  it('formats an English delivery from the English month array', () => {
    expect(formatDeliveryDate('2026-07-16', '2026-07-16', EN_MONTHS_SHORT)).toBe('16 Jul.')
  })

  it('appends the year in English for a cross-year delivery', () => {
    expect(formatDeliveryDate('2027-01-04', '2026-12-28', EN_MONTHS_SHORT)).toBe('4 Jan. 2027')
  })

  // AC19 gives a task with no delivery date the em dash, and that guard is the row's rather than
  // this helper's, because AC28 types the parameter as a plain string. This case exists so the
  // helper is known to stay total if that guard is ever lost: it must not throw, and it must not
  // invent a date that would read as a real deadline.
  it('does not throw and produces no readable date when a null delivery slips past the row guard', () => {
    const nullDelivery = null as unknown as string
    expect(() => formatDeliveryDate(nullDelivery, '2026-07-20', FR_MONTHS_SHORT)).not.toThrow()
    expect(formatDeliveryDate(nullDelivery, '2026-07-20', FR_MONTHS_SHORT)).not.toMatch(/\d/)
  })

  // The delivery time never reaches this helper. AC19 makes the date and the time one field on
  // screen, but the row composes them, so nothing here may print a clock.
  it('returns the date alone with no time joined to it', () => {
    expect(formatDeliveryDate('2026-07-16', '2026-07-16', FR_MONTHS_SHORT)).not.toContain(':')
  })
})

// The coloured-names spec (docs/specs/planning/category-column-coloured-names.md) AC9 adds
// formatDeadline, and Decision 7 of its design blueprint fixes the behaviour asserted below. The row
// printed `29 Jul. 202612:00`, the year running into the hour, because Vue's condenseWhitespace drops
// a whitespace-only text node that has no previous sibling, so the space written in the template
// never reached the DOM. The separator moved into this function, where the compiler cannot reach it
// and where a node-environment suite can assert on it. Every expected value below is the blueprint's
// behaviour table, row for row, not the implementation's output.
//
// The separator is a plain space and never a glyph, because the date and the time read as one
// deadline. The function returns the two parts rather than one string so the row keeps printing them
// in two tones.

describe('formatDeadline', () => {
  // Blueprint row 1. A same-year French delivery with a time, which is the common case in a normal
  // week. The date half is formatDeliveryDate's, so no year, and the time half carries the space.
  it('composes a same-year French delivery and its time', () => {
    expect(formatDeadline('2026-07-29', '2026-07-29', FR_MONTHS_SHORT, '12:00')).toEqual({
      date: '29 juill.',
      timeSuffix: ' 12:00'
    })
  })

  // Blueprint row 2. The English case from the owner's own screen, where the failure was digit
  // against digit.
  it('composes a same-year English delivery and its time', () => {
    expect(formatDeadline('2026-07-29', '2026-07-29', EN_MONTHS_SHORT, '12:00')).toEqual({
      date: '29 Jul.',
      timeSuffix: ' 12:00'
    })
  })

  // Blueprint row 3. The cross-year French case, which is the one that fails the same digit-against-
  // digit way English does, `4 janv. 202712:00`. Both cases exist in the same seeded week, so both
  // are asserted rather than one standing in for the other.
  it('composes a cross-year French delivery with its year and its time', () => {
    expect(formatDeadline('2027-01-04', '2026-07-29', FR_MONTHS_SHORT, '12:00')).toEqual({
      date: '4 janv. 2027',
      timeSuffix: ' 12:00'
    })
  })

  // Blueprint row 4. A delivery date with no time at all. The suffix is empty rather than a lone
  // space, so the row's `v-if` on it renders nothing and no stray space is printed after the date.
  it('returns an empty time suffix for a delivery with no time', () => {
    expect(formatDeadline('2026-07-29', '2026-07-29', FR_MONTHS_SHORT, null)).toEqual({
      date: '29 juill.',
      timeSuffix: ''
    })
  })

  it('returns an empty time suffix when the delivery time is undefined', () => {
    expect(formatDeadline('2026-07-29', '2026-07-29', FR_MONTHS_SHORT, undefined)).toEqual({
      date: '29 juill.',
      timeSuffix: ''
    })
  })

  // Blueprint row 5. No delivery date means there is no deadline to print, and null is what tells the
  // row to show the em dash instead. The em dash is i18n copy, so the choice of what to print stays
  // out of this module.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the empty string', '']
  ])('returns null for %s as the delivery date', (_label, deliveryDate) => {
    expect(formatDeadline(deliveryDate, '2026-07-29', FR_MONTHS_SHORT, '12:00')).toBeNull()
  })

  // Blueprint row 6, and the reason it is a row rather than an oversight. formatDeliveryDate returns
  // an empty string for an unparseable date, so composing anyway would leave a lone `12:00` under a
  // header that reads Livraison, which looks like a real deadline. Null is the only safe answer.
  it('returns null rather than a lone time when the delivery date cannot be parsed', () => {
    const deadline = formatDeadline('not-a-date', '2026-07-29', FR_MONTHS_SHORT, '12:00')
    expect(deadline).toBeNull()
    expect(deadline?.timeSuffix).toBeUndefined()
  })

  // The single most important assertion in this feature. The leading space on timeSuffix is the
  // separator between the date and the time, and it is the whole bug being fixed. It is asserted
  // directly rather than only as a side effect of an object comparison, because someone will
  // eventually be tempted to trim this string and this test is what stands in the way. A trimmed
  // suffix puts the row straight back to printing `29 Jul. 202612:00`.
  it.each([
    ['French, same year', '2026-07-29', FR_MONTHS_SHORT],
    ['English, same year', '2026-07-29', EN_MONTHS_SHORT],
    ['French, cross year', '2027-01-04', FR_MONTHS_SHORT],
    ['English, cross year', '2027-01-04', EN_MONTHS_SHORT]
  ] as Array<[string, string, readonly string[]]>)(
    'begins the time suffix with the separator space (%s)',
    (_label, deliveryDate, months) => {
      const deadline = formatDeadline(deliveryDate, '2026-07-29', months, '12:00')
      expect(deadline?.timeSuffix.startsWith(' ')).toBe(true)
      expect(deadline?.timeSuffix).toBe(' 12:00')
    }
  )

  // The same rule read from the joined string, which is what the eye actually sees in the cell. The
  // year or the abbreviation period must never sit against the first digit of the hour. FR without a
  // year fails as a period against a digit, `29 juill.12:00`, and EN with a year fails as digit
  // against digit, `29 Jul. 202612:00`, so both shapes are checked.
  it.each([
    ['2026-07-29', FR_MONTHS_SHORT, '29 juill. 12:00'],
    ['2026-07-29', EN_MONTHS_SHORT, '29 Jul. 12:00'],
    ['2027-01-04', FR_MONTHS_SHORT, '4 janv. 2027 12:00'],
    ['2027-01-04', EN_MONTHS_SHORT, '4 Jan. 2027 12:00']
  ] as Array<[string, readonly string[], string]>)(
    'reads as %s with a space before the hour',
    (deliveryDate, months, expected) => {
      const deadline = formatDeadline(deliveryDate, '2026-07-29', months, '12:00')
      expect(`${deadline?.date}${deadline?.timeSuffix}`).toBe(expected)
    }
  )

  // The separator is a plain space, decided in Decision 7 and not a glyph, so no comma, bullet, or
  // middle dot may creep into the suffix. The comment on the row already argues the deadline reads as
  // one fact, and this feature vindicates that argument rather than overriding it.
  it('separates the date and the time with a plain space and no glyph', () => {
    const deadline = formatDeadline('2026-07-29', '2026-07-29', FR_MONTHS_SHORT, '12:00')
    expect(deadline?.timeSuffix).toMatch(/^ \d/)
    expect(deadline?.timeSuffix).not.toMatch(/[,·•–—]/)
  })

  // The date half is formatDeliveryDate's output unchanged, which is what AC28 of extend-tasks.md
  // keeps byte for byte. So the composed date and the helper's own result must never disagree, or a
  // second copy of the date rule has appeared.
  it.each([
    ['2026-07-29', '2026-07-29'],
    ['2027-01-04', '2026-07-29'],
    ['2026-03-15', '2026-07-20']
  ])('reuses formatDeliveryDate for the date half of %s', (deliveryDate, taskDate) => {
    const deadline = formatDeadline(deliveryDate, taskDate, FR_MONTHS_SHORT, '12:00')
    expect(deadline?.date).toBe(formatDeliveryDate(deliveryDate, taskDate, FR_MONTHS_SHORT))
  })

  // The clock is printed as stored and this module holds no copy, so nothing reformats `HH:MM` and
  // nothing inserts the French space before a colon, which governs `? ! : ;` as punctuation rather
  // than a numeric time separator.
  it.each(['09:30', '00:00', '23:59'])('prints the stored time %s unchanged', (time) => {
    expect(formatDeadline('2026-07-29', '2026-07-29', FR_MONTHS_SHORT, time)?.timeSuffix).toBe(
      ` ${time}`
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

// --- the stored status vocabulary (PLAN-09) ------------------------------------------------------

// TASK_STATUSES is the export PLAN-09 added, and docs/specs/planning/task-write-api.md AC44 is what
// these cases come from. The three values used to be written out in three places in executable code,
// the statusKey switch, the done comparison in list.ts, and STATUS_BY_PHASE in the dev seed, and the
// write boundary needed them a fourth time. Four copies of a domain vocabulary drift, and the seed's
// copy is the dangerous one because it is the one that writes these values into the database.
//
// Every expectation here is a literal string rather than a read of the constant. AC44 asks for
// exactly that and explains why, which is that a test reading the same constant as the code under
// test proves the wiring and never the value. These assertions are the only thing in the suite that
// pins what the vocabulary actually is.
describe('TASK_STATUSES', () => {
  // The accents are load-bearing rather than cosmetic. The late comparison in the list query matches
  // the finished value as a literal string, so a row storing a de-accented Termine would never match
  // and would read as late forever with nothing on screen to explain why.
  it('holds the three stored status values with their exact accents', () => {
    expect(TASK_STATUSES).toEqual(['Accepté', 'En cours', 'Terminé'])
  })

  // The order is not incidental. AC44 fixes it as the cycle order so PLAN-14 reads the sequence from
  // the contract instead of hardcoding the three values a fourth time. A reordering here would
  // silently change what the status cycle does on click.
  it('is ordered as the status cycle runs, accepted then in progress then finished', () => {
    expect(TASK_STATUSES[0]).toBe('Accepté')
    expect(TASK_STATUSES[1]).toBe('En cours')
    expect(TASK_STATUSES[2]).toBe('Terminé')
  })

  it('carries exactly three values, since N/A is derived at read time and never stored', () => {
    expect(TASK_STATUSES).toHaveLength(3)
    expect(TASK_STATUSES as readonly string[]).not.toContain('N/A')
  })

  // statusKey is the first of the four readers, so its switch and the tuple must still agree. This is
  // the wiring half of AC44 and it is worth having only because the case above pins the values.
  it('maps each of its own values through statusKey, so the switch and the tuple agree', () => {
    const [accepted, inProgress, done] = TASK_STATUSES

    expect(statusKey(accepted, true)).toBe('accepte')
    expect(statusKey(inProgress, true)).toBe('encours')
    expect(statusKey(done, true)).toBe('termine')
  })
})

// TASK_STATUS_DONE is read out of the tuple by index, which is the one thing about it worth testing.
// The overdue expression in server/api/tasks/handlers/projection.ts compares against it, so if a
// reorder of the cycle rebinds it the late rule keeps compiling and every finished task reports as
// overdue forever, with nothing on screen to say why. That failure is silent by nature, so these
// cases are what makes it loud: the value is pinned as a literal, exactly as AC44 pins the tuple,
// because a test that reads the same export as the code under test proves the wiring and never the
// value.
describe('TASK_STATUS_DONE', () => {
  it('is the finished status, spelled with its accent', () => {
    expect(TASK_STATUS_DONE).toBe('Terminé')
  })

  it('is not either of the two unfinished statuses', () => {
    expect(TASK_STATUS_DONE).not.toBe('Accepté')
    expect(TASK_STATUS_DONE).not.toBe('En cours')
  })

  // The reason the constant exists at all. statusKey and the overdue comparison both have to agree
  // about which value means finished, and this is the one that says they do.
  it('is the value statusKey resolves to termine', () => {
    expect(statusKey(TASK_STATUS_DONE, true)).toBe('termine')
  })

  // A finished task is never late, however long ago its delivery was, so the late flag is ignored
  // for this value and only for this value.
  it('outranks the overdue flag, which no other status does', () => {
    expect(statusKey(TASK_STATUS_DONE, true, true)).toBe('termine')
    expect(statusKey('Accepté', true, true)).toBe('retard')
    expect(statusKey('En cours', true, true)).toBe('retard')
  })
})
