import { z } from 'zod'

import type { StatusKey } from '#shared/planning'

// The list endpoint is reused by the month and year views later, so the cap is generous rather
// than tight. 366 days admits a full leap year and bounds the scan so a malformed or hostile
// query can never ask for an unbounded range. A wider span is a 422.
export const MAX_RANGE_DAYS = 366

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

// The inclusive day count of a range whose ends are both valid calendar days, so a single day is
// 1 and a Sunday-to-Saturday week is 7. Both ends are parsed as UTC midnight, so the difference is
// a whole number of days with no daylight-saving drift.
function rangeSpanDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`)
  return Math.round((toMs - fromMs) / 86_400_000) + 1
}

// A single calendar-day query field. Reused for both ends so the shape and real-date rules cannot
// drift between them. A missing or non-string value fails the base z.string() with its own issue,
// so an absent from or to is a 422 rather than a crash.
const calendarDaySchema = z
  .string()
  .refine(isValidCalendarDay, { message: 'Must be a real calendar day in the YYYY-MM-DD format.' })

// Query schema for GET /api/tasks. Both ends are required. The object-level refinements run only
// after both fields are valid calendar days, so an inverted or over-wide range is reported with a
// per-field message on `to` and never a 500. Lexicographic order equals chronological order for a
// valid 'YYYY-MM-DD', so from <= to is a plain string comparison. An equal from and to is valid
// and returns a single day.
export const TaskListQuerySchema = z
  .object({
    from: calendarDaySchema,
    to: calendarDaySchema
  })
  .refine((range) => range.from <= range.to, {
    message: 'The start of the range must not be after its end.',
    path: ['to']
  })
  .refine((range) => rangeSpanDays(range.from, range.to) <= MAX_RANGE_DAYS, {
    message: `The range must not span more than ${MAX_RANGE_DAYS} days.`,
    path: ['to']
  })

export type TaskListQuery = z.infer<typeof TaskListQuerySchema>

// The stored task fields the read-only planning row needs, in the order the spec lists them. There
// is no project-manager field because PLAN-01 never added that column. The two lifecycle instants
// (createdAt, updatedAt) are deliberately not returned; they are not row data. Nullability mirrors
// the tasks table exactly, with one derived field at the end that no column backs.
export type TaskListItem = {
  id: string
  date: string
  client: string | null
  project: string | null
  category: string
  deliveryDate: string | null
  deliveryTime: string | null
  projectWordCount: number | null
  wordsDone: number | null
  quotaWphOverride: number | null
  estimatedMinutes: number | null
  actualMinutes: number | null
  status: string | null
  instructions: string | null
  splitGroupId: string | null
  sortOrder: number
  // Derived, not stored. The resolved status the row draws, including the 'retard' pseudo-status the
  // list query decides for a task that is not finished and whose delivery deadline has passed. It is
  // computed server-side because it depends on the current instant in the user's timezone, so the
  // client is handed the verdict instead of recomputing it. Mirrors PlanningTask in shared/planning.ts.
  statusKey: StatusKey
}
