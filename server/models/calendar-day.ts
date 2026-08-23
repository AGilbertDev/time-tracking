import { z } from 'zod'

// The calendar-day validator, extracted so every server boundary that takes a 'YYYY-MM-DD' shares one
// source and the shape and real-date rules cannot drift between them. It lived in models/tasks.ts
// while the task write boundary was its only caller, and it moved here when the per-category quota
// write needed the same rule, because a quotas model importing the task model would say the two
// features depend on each other when they only share a date format. This is what the work-field
// validators did when they moved into models/work-settings.ts.

// A calendar day is 'YYYY-MM-DD'. The shape check is the first gate; a value that passes the shape
// but is not a real date, such as 2026-02-31, is rejected by the round-trip below.
const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Reports whether a string is a real calendar day in the 'YYYY-MM-DD' form. It checks the shape,
// then constructs the date in UTC and confirms each component round-trips, so an out-of-range day
// that JavaScript would silently roll into the next month (2026-02-31 becoming March 3) is caught
// rather than accepted. Pure and DB-free.
export function isValidCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY_PATTERN.test(value)) return false

  // The pattern fixes the field widths, so slicing reads each part without any possibly-undefined
  // array element, which a split-and-destructure would introduce under strict index access.
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

// A single calendar-day field. A missing or non-string value fails the base z.string() with its own
// issue, so an absent value is a 422 rather than a crash.
export const calendarDaySchema = z
  .string()
  .refine(isValidCalendarDay, { message: 'Must be a real calendar day in the YYYY-MM-DD format.' })
