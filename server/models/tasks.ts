import { z } from 'zod'

import type { StatusKey } from '#shared/planning'

import { DEFAULT_CATEGORY_ID, DEFAULT_CATEGORY_IDS } from '#shared/categories'
import { normalizeFreeText, TASK_NOTES_MAX, TASK_STATUSES, TASK_TEXT_MAX } from '#shared/planning'

import { quotaWphSchema } from './work-settings'

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
  // This row's own words total, which is the whole project's total only when the work is not split
  // across days. There is no second words figure: words_done was dropped by migration 0008.
  projectWordCount: number | null
  quotaWphOverride: number | null
  estimatedMinutes: number | null
  actualMinutes: number | null
  status: string | null
  excludeFromStats: boolean
  // Free multiline text. Null rather than '' when cleared, which normalizeFreeText guarantees on the
  // way in, so a reader has one absent case rather than two.
  notes: string | null
  splitGroupId: string | null
  sortOrder: number
  // Derived, not stored. The resolved status the row draws, including the 'retard' pseudo-status the
  // list query decides for a task that is not finished and whose delivery deadline has passed. It is
  // computed server-side because it depends on the current instant in the user's timezone, so the
  // client is handed the verdict instead of recomputing it. Mirrors PlanningTask in shared/planning.ts.
  statusKey: StatusKey
  // Derived, not stored. Whether this task's category produces words that count toward the quota,
  // resolved from the PLAN-02 contract server-side so the row is handed the verdict rather than the
  // raw category plus the rule for reading it. The raw `category` above stays on the contract
  // uncoerced, because PLAN-11 round-trips it on save and a coerced value would silently rewrite a
  // stale category the user never touched.
  trackable: boolean
  // Derived, not stored, and a second field rather than a reuse of `trackable` above. Whether this
  // task is a piece of work that can be in progress, so whether a status and a word count mean
  // anything on it. The two flags answer different questions and disagree on `other`, which
  // contributes nothing to a quota and does carry a status, so a reader that wants the N/A rule
  // takes this one. Also resolved server-side from the same contract, in the same place, so the two
  // can never be decided from different values of the same row's category.
  deliverable: boolean
}

// --- the write boundary (PLAN-09) -----------------------------------------------------------------

// The tasks table was written permissive on purpose, with almost every column nullable and category
// and status left as free text, and the schema comments name this feature as the place the meaning
// gets enforced instead. So everything below is the only thing standing between a request and what
// the database holds forever. Two rules are worth stating before the fields, because both look like
// missing conveniences rather than decisions.
//
// Nothing here writes actual_minutes from estimated_minutes. Storing the copy would make a duration
// the user confirmed and a duration the app assumed into identical rows, and nothing downstream
// could tell them apart afterwards. The fallback is resolved at read time by effectiveDuration.
//
// Nothing here derives estimated_minutes from a word count and a quota either. That derivation is
// PLAN-12's and it needs a per-category quota that does not exist yet, and because the estimate is
// frozen by definition a value derived from today's wrong global quota would never self-correct.
//
// wordsDone is in neither body and no longer exists as a column: migration 0008 dropped it, which
// keeping it off the request contract is exactly what made an internal cleanup rather than a
// breaking change. The key is still a 422 on both endpoints, now as an unknown key refused by
// strict() rather than as a named exclusion.

// A clock time is 'HH:MM' on a 24-hour clock, matching what tasks.delivery_time stores. The pattern
// pins the ranges as well as the widths, so 24:00 and 12:60 are refused without any parsing.
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

// Reports whether a string is a real 24-hour clock time in the 'HH:MM' form. Pure and DB-free, and
// the companion to isValidCalendarDay above.
export function isValidClockTime(value: string): boolean {
  return CLOCK_TIME_PATTERN.test(value)
}

// Free text on a task, so client and project. Trimmed first, so surrounding whitespace never reaches
// a column, then bounded, and an emptied value becomes null. Without that last step the database
// ends up holding a cleared field in two forms, and a row with client = '' renders as a blank cell
// where a row with client = NULL renders as missing, which are the same thing to the user and two
// different things to every reader.
//
// Neither the bound nor the trim-and-empty-to-null step is declared here. TASK_TEXT_MAX and
// normalizeFreeText both come from shared/planning.ts, because the editor needs the same two facts,
// the bound for its character counter and its own `{max}` copy and the normalization to decide
// whether a typed value differs from the loaded row. Both sides importing one declaration is the
// conventions' single acceptable form of sharing a pure rule. A second copy on the client would go
// stale the moment this bound was tightened, and nothing would fail to reveal it, because the counter
// would simply keep quoting a number the server no longer enforces. The trim() before max() is what
// measures the bound after trimming rather than before.
const freeTextSchema = z
  .string()
  .trim()
  .max(TASK_TEXT_MAX, { message: `Must be at most ${TASK_TEXT_MAX} characters.` })
  .transform(normalizeFreeText)
  .nullable()

// A note on a task. Its own bound, TASK_NOTES_MAX, rather than TASK_TEXT_MAX, and the reasoning for
// the two being separate lives with them in shared/planning.ts rather than twice.
//
// Same trimming and same emptied-to-null rule as the free-text fields above, read from the same
// shared function, so a note of nothing but whitespace and newlines is a cleared note and stores
// NULL. Interior newlines survive, because trim() only touches the ends, so a multiline note is
// stored with its lines intact. The bound is measured after trimming.
const notesSchema = z
  .string()
  .trim()
  .max(TASK_NOTES_MAX, { message: `Must be at most ${TASK_NOTES_MAX} characters.` })
  .transform(normalizeFreeText)
  .nullable()

const clockTimeSchema = z
  .string()
  .refine(isValidClockTime, { message: 'Must be a time of day in the 24-hour HH:MM format.' })

// Anti-garbage bounds, not policy bounds, and the distinction decides how they were picked. The app
// signals and never blocks, so a forgotten timer producing a sixty-hour Monday is a number the user
// corrects rather than one the API refuses. 100000 minutes is about seventy days, far past any
// honest entry, and exists only so a garbage or overflowing value cannot land in the column. A tight
// cap of one day would be the app policing the user and would reject the very case to allow.
const MAX_PROJECT_WORDS = 10_000_000
const MAX_DURATION_MINUTES = 100_000

const projectWordCountSchema = z.number().int().min(0).max(MAX_PROJECT_WORDS)

const durationMinutesSchema = z.number().int().min(0).max(MAX_DURATION_MINUTES)

// The category must be one of the ten the contract declares, read from there rather than retyped,
// so adding a category makes it writable with no change here. This validates and deliberately does
// not call coerceCategory. That function defends the read path against ids already sitting in the
// database, left behind by a renamed or retired category. At the write boundary the client picked
// from a list the server gave it, so an unknown id is a client bug or a hostile request rather than
// history, and silently storing some other category on a task the user labelled as translation would
// be data corruption dressed as robustness. PLAN-30 turns this static set into a per-user lookup.
const categorySchema = z.enum(DEFAULT_CATEGORY_IDS)

// The stored status vocabulary, read from the shared tuple so the write boundary, the late
// comparison, and the dev seed can never disagree about the spelling. The accents are load-bearing.
// N/A is absent on purpose: it is a display value the read path derives and never a stored one.
const storedStatusSchema = z.enum(TASK_STATUSES)

// Every writable field, all optional. This is the update body on its own, and the create body is
// this with date made required and category given a default. One declaration rather than two,
// because two field lists drift and the copy further from the schema is the one that goes stale.
//
// Nullable is not decoration on a patch. An absent field leaves its column alone and an explicit
// null clears it, and that distinction is the only way back from a wrong actualMinutes to
// unmeasured, since effectiveDuration reads NULL as "the user did not measure this" and 0 as a
// measurement of zero. date and category are not nullable because their columns are NOT NULL.
//
// Types are not coerced anywhere here. A number sent as "12000" is a 422 rather than a parsed
// integer, and a boolean sent as "true" is a 422 rather than a true, because a body that is loose
// about its own types is usually a client bug worth surfacing.
const TaskWritableSchema = z.object({
  date: calendarDaySchema.optional(),
  client: freeTextSchema.optional(),
  project: freeTextSchema.optional(),
  category: categorySchema.optional(),
  deliveryDate: calendarDaySchema.nullable().optional(),
  deliveryTime: clockTimeSchema.nullable().optional(),
  projectWordCount: projectWordCountSchema.nullable().optional(),
  // The same quantity as the global setting, so it takes the same validator rather than inventing a
  // second opinion about what a plausible words-per-hour figure is. Its floor of 1 is not merely a
  // range: the override is the divisor in estimated = words / quota, so admitting 0 would store a
  // row that divides by zero the moment PLAN-12 reads it.
  quotaWphOverride: quotaWphSchema.nullable().optional(),
  // Stored verbatim, never computed here. The derivation needs a per-category quota that does not
  // exist yet, and because the estimate is frozen by definition a value derived from today's wrong
  // global quota would never self-correct. Writing nothing is recoverable, writing a wrong frozen
  // estimate is not. PLAN-12 owns the derivation and takes this field off the writable list.
  estimatedMinutes: durationMinutesSchema.nullable().optional(),
  actualMinutes: durationMinutesSchema.nullable().optional(),
  status: storedStatusSchema.nullable().optional(),
  excludeFromStats: z.boolean().optional(),
  // Writable on both endpoints, and it has to be declared here rather than on either body, because
  // both bodies are strict(): a field absent from this base is an unknown key and every request
  // carrying it would be a 422. Optional and nullable like client and project, so an absent notes on
  // a PATCH leaves the column alone and an explicit null clears it.
  notes: notesSchema.optional()
})

// POST /api/tasks. Only date is required, so the smallest legal request is a day. Category is no
// longer required because the boundary supplies it, which is the single place that decision is made.
//
// The rule this follows is the one already written above, that a field is required when its column
// is NOT NULL and has no default. Category still has a NOT NULL column, and what changed is that it
// now has a default, supplied here rather than by the DDL. So it stops being required by the rule
// already in force rather than by an exception to it.
//
// The default is declared rather than branched. There is no `if (!body.category)` in create.ts and
// no nullish coalescing anywhere down the write path, because the value is attached to the schema
// both endpoints already draw from. It is read from DEFAULT_CATEGORY_ID rather than retyped as a
// literal, so the fallback id and the create default cannot drift apart, and this feature is itself
// the proof that the fallback id can change.
//
// The default lives here and not in the database on purpose. SQLite cannot add a default to an
// existing column, so a DDL default would mean a create-copy-drop-rename rebuild of the app's main
// table for a behaviour difference of zero. It would also be a second copy of the fallback id in a
// file that cannot import the contract, which is exactly the drift the shared module exists to
// prevent. tasks.category therefore stays text NOT NULL with no DDL default and this feature adds no
// migration.
//
// A default applies to an absent key and not to an explicit null, which is the behaviour wanted
// here. Omitting category means "you decide" and is a 201 storing `other`. Sending category: null
// means "store nothing" against a NOT NULL column and stays a 422, because only the first of those
// is a question the server can answer.
//
// strict() is the mass-assignment protection, and an unknown or server-owned key is an error rather
// than a silent drop on purpose. A client that sends userId and gets a 201 has been told its write
// succeeded as sent, which is false. The owning user always comes from the session regardless of
// what the body claims, and id, createdAt, updatedAt, sortOrder, and splitGroupId are all refused
// the same way, each owned by the server or by another feature. wordsDone is refused too, now for
// the plainer reason that the column no longer exists.
export const TaskCreateSchema = TaskWritableSchema.extend({
  date: calendarDaySchema,
  category: categorySchema.default(DEFAULT_CATEGORY_ID)
}).strict()

// PATCH /api/tasks/[id]. A genuine partial patch, so every writable field is optional, but it must
// carry at least one that actually says something. An empty patch is a meaningless write and almost
// always a client bug, which is the same reason WorkSettingsPatchSchema refuses one.
//
// The check reads the values rather than counting the keys, and that is not a style choice. Zod
// keeps a present-but-undefined optional key in its output, so a body of { client: undefined }
// parses to an object with one key and nothing in it, and a key count would admit it. toTaskColumns
// then maps no column and the write degrades to a bare updatedAt bump, which is the meaningless
// write this refine exists to refuse. Reading the values still means a field added above cannot be
// forgotten here, because no field is named twice. An explicit null is a real instruction to clear a
// column, so it counts as a field being provided.
//
// The id travels in the path and never in the body, so there is no second place it can appear and no
// way for the two to disagree.
export const TaskUpdateSchema = TaskWritableSchema.strict().refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: 'At least one task field must be provided.' }
)

// The [id] path parameter, validated because a path parameter is untrusted input like any other, so
// a missing or malformed id fails at the boundary instead of reaching the database. It is checked as
// a non-empty string and not as a uuid: the id column is free text with a uuid default rather than a
// constrained type, so the write path does not assert a shape it cannot rely on, and a well-formed
// id matching no row simply fails the lookup and reads as not found.
export const TaskIdParamSchema = z.object({
  id: z.string().min(1, { message: 'A task id is required.' })
})

// The writable field set both bodies draw from, which is what the shared column mapper takes. A
// create body and an update body are both assignable to it, so the mapping exists once.
export type TaskWritableInput = z.infer<typeof TaskWritableSchema>

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>
export type TaskUpdateInput = z.infer<typeof TaskUpdateSchema>
export type TaskIdParam = z.infer<typeof TaskIdParamSchema>
