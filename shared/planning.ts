// Pure, framework-free planning helpers shared by the client page and the server (and the dev
// seed). Nuxt 4 auto-shares everything under shared/ with both the app and Nitro, so the date,
// duration, and formatting logic lives here once and is never reimplemented on two sides. Every
// function is pure and DB-free so the unit-test stage can cover it in isolation. All calendar-day
// math is done in UTC so a single day is always a whole number of days apart, with no
// daylight-saving drift, since a 'YYYY-MM-DD' carries no time or zone of its own.

// The read-only shape a planning row consumes. It mirrors the list endpoint's TaskListItem (defined
// in server/models/tasks.ts) so the client has its own contract without importing server code across
// the boundary. The two agree by the PLAN-04 spec; a change to the API shape is reflected here.
export type PlanningTask = {
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
}

// The colour and CSS key a status maps to. A non-trackable task is always 'na'.
export type StatusKey = 'accepte' | 'encours' | 'termine' | 'na'

// The category chip colour role. Translation and revision get their own washes; everything else is
// the neutral chip.
export type ChipVariant = 'trad' | 'rev' | 'neutral'

// The inclusive week range as calendar-day strings.
export type WeekRange = { from: string; to: string }

// The connective words and month names formatWeekLabel needs. They come from the i18n `planning`
// namespace so the label is localized without this module reaching into vue-i18n.
export type WeekLabelParts = {
  locale: string
  prefix: string
  separator: string
  months: readonly string[]
}

// --- internal date utilities ---------------------------------------------------------------------

// Two-digit zero padding for a month or day component.
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

// Parses a 'YYYY-MM-DD' as UTC midnight so every calendar computation is zone-free.
function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

// Formats a Date back to its UTC calendar day as 'YYYY-MM-DD'.
function toYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

// Maps an app locale ('fr' / 'en') to the Canadian BCP-47 tag used for number and weekday
// formatting, so French counts group thousands with a no-break space (U+00A0, what the fr-CA Intl
// locale emits on this runtime) and weekdays read in Québec French. An unknown locale falls back to
// English.
function localeTag(locale: string): string {
  return locale === 'fr' ? 'fr-CA' : 'en-CA'
}

// --- exported helpers ----------------------------------------------------------------------------

// The 'YYYY-MM-DD' calendar day of the instant `now` as seen in `timeZone`, so an instant late on
// July 20 UTC still reads as July 20 in America/Toronto rather than drifting to the 21st. This is
// what keeps today and the current week correct for the user's own zone.
export function todayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const lookup = new Map(parts.map((part) => [part.type, part.value]))
  return `${lookup.get('year') ?? ''}-${lookup.get('month') ?? ''}-${lookup.get('day') ?? ''}`
}

// The 'YYYY-MM-DD' that is `n` days after `date`, negative moving backward, correct across month and
// year boundaries.
export function addDays(date: string, n: number): string {
  const shifted = toUtcDate(date)
  shifted.setUTCDate(shifted.getUTCDate() + n)
  return toYmd(shifted)
}

// The Sunday-to-Saturday week containing `date`, in the North American convention. `from` is the
// week's Sunday and `to` its Saturday. A date that is itself a Sunday returns that Sunday as `from`.
export function getWeekRange(date: string): WeekRange {
  const weekday = toUtcDate(date).getUTCDay()
  const from = addDays(date, -weekday)
  return { from, to: addDays(from, 6) }
}

// The seven calendar days of the week containing `date`, Sunday first through Saturday. The first
// element equals getWeekRange(date).from and the last equals its `to`.
export function getWeekDays(date: string): string[] {
  const { from } = getWeekRange(date)
  return Array.from({ length: 7 }, (_unused, index) => addDays(from, index))
}

// Whether the weekday of `date`, numbered 0 for Sunday through 6 for Saturday, is one of the user's
// work days. An empty `workDays` makes every day an off day.
export function isWorkDay(date: string, workDays: readonly number[]): boolean {
  return workDays.includes(toUtcDate(date).getUTCDay())
}

// The effective duration in minutes the row shows: the actual minutes when present, otherwise the
// estimate, otherwise zero. Never throws on a task with neither.
export function effectiveDuration(
  task: Pick<PlanningTask, 'actualMinutes' | 'estimatedMinutes'>
): number {
  if (typeof task.actualMinutes === 'number') return task.actualMinutes
  if (typeof task.estimatedMinutes === 'number') return task.estimatedMinutes
  return 0
}

// Whole minutes formatted as hours and minutes, so 180 is `3 h 00`, 30 is `0 h 30`, and 45 is
// `0 h 45`, with the minutes zero-padded to two digits. The numeric layout is the same in both
// locales, so the locale is accepted for a consistent signature but does not change the shape.
export function formatDuration(minutes: number, _locale?: string): string {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return `${hours} h ${pad2(mins)}`
}

// An integer with the locale thousands separator, so 1350 is `1 350` in French with a no-break space
// (U+00A0, the fr-CA Intl grouping character on this runtime; the spec only requires a
// non-breaking-style space, which this satisfies) and 600 is `600`.
export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(localeTag(locale)).format(n)
}

// The lowercase weekday, the day number, and the abbreviated month with its period, so 2026-07-20 in
// French is `lundi 20 juill.`. The weekday is derived from the date; the abbreviated month name comes
// from the caller's localized array (index 0 is January), keeping the month copy in the i18n layer.
export function formatDayLabel(
  date: string,
  locale: string,
  monthsShort: readonly string[]
): string {
  const parsed = toUtcDate(date)
  const weekday = new Intl.DateTimeFormat(localeTag(locale), {
    weekday: 'long',
    timeZone: 'UTC'
  })
    .format(parsed)
    .toLowerCase()
  const month = monthsShort[parsed.getUTCMonth()] ?? ''
  return `${weekday} ${parsed.getUTCDate()} ${month}`
}

// The localized week label composed from the range and the i18n connective words, using the full
// month name. Same-month weeks name the month once at the end (`Semaine du 19 au 25 juillet 2026`).
// A two-month week carries each day's month with the year once at the end
// (`Semaine du 29 juin au 5 juillet 2026`). A two-year week carries each end's year
// (`Semaine du 29 décembre 2025 au 4 janvier 2026`).
export function formatWeekLabel(from: string, to: string, parts: WeekLabelParts): string {
  const start = toUtcDate(from)
  const end = toUtcDate(to)
  const { prefix, separator, months } = parts

  const d1 = start.getUTCDate()
  const d2 = end.getUTCDate()
  const y1 = start.getUTCFullYear()
  const y2 = end.getUTCFullYear()
  const m1 = months[start.getUTCMonth()] ?? ''
  const m2 = months[end.getUTCMonth()] ?? ''

  if (y1 !== y2) return `${prefix} ${d1} ${m1} ${y1} ${separator} ${d2} ${m2} ${y2}`
  if (start.getUTCMonth() !== end.getUTCMonth())
    return `${prefix} ${d1} ${m1} ${separator} ${d2} ${m2} ${y2}`
  return `${prefix} ${d1} ${separator} ${d2} ${m2} ${y2}`
}

// The colour and CSS key for a stored status. A trackable task maps the three confirmed status names
// to their keys and an unknown value to `na`. A non-trackable task is always `na`, so a stray status
// left on a meeting or a break never colours the row.
export function statusKey(status: string | null | undefined, trackable: boolean): StatusKey {
  if (!trackable) return 'na'
  switch (status) {
    case 'Accepté':
      return 'accepte'
    case 'En cours':
      return 'encours'
    case 'Terminé':
      return 'termine'
    default:
      return 'na'
  }
}

// The chip colour role for a category id, derived once here rather than at each call site.
export function chipVariant(categoryId: string): ChipVariant {
  if (categoryId === 'translation') return 'trad'
  if (categoryId === 'revision') return 'rev'
  return 'neutral'
}

// --- work-schedule resolver (PLAN-03) ------------------------------------------------------------

// One effective-dated work-schedule record as the resolver consumes it. It mirrors the coerced
// shape the read path returns (server/utils/loadWorkSchedule.ts), so the client and the server
// resolve the schedule against this one implementation. effectiveFrom is a 'YYYY-MM-DD'.
export type WorkScheduleRecord = {
  workMinutes: number
  workDays: number[]
  bufferMinutes: number
  effectiveFrom: string // 'YYYY-MM-DD'
}

// The resolved schedule for a single date: the values in effect on that day, with no effective
// date of their own because a resolved schedule is already tied to the date it was resolved for.
export type ResolvedSchedule = {
  workMinutes: number
  workDays: number[]
  bufferMinutes: number
}

// The documented defaults, derived from the settings column defaults and the overview's buffer
// default, so an empty history resolves to the same figures the mockup's day length uses and there
// is no discontinuity before the first record. 450 minutes is 7 h 30; work days are Monday through
// Friday; the buffer is 60 minutes.
export const DEFAULT_SCHEDULE: ResolvedSchedule = {
  workMinutes: 450,
  workDays: [1, 2, 3, 4, 5],
  bufferMinutes: 60
}

// The work schedule in effect on `date`, resolved from the user's history. A record applies from
// its effectiveFrom up to but not including the next record's, so the value for a date is the
// record with the greatest effectiveFrom that is on or before that date (an inclusive lower bound,
// so a record takes effect on its own effective date). Since 'YYYY-MM-DD' sorts chronologically as
// a plain string, the comparison is a string comparison. The function is pure, DB-free, and
// order-independent of the input array. It returns a fresh copy of DEFAULT_SCHEDULE (so a caller
// cannot mutate the constant's workDays) when the history is empty or `date` precedes every
// record. If two records somehow shared the greatest qualifying effectiveFrom (which the DB unique
// index prevents), a stable ascending sort makes the last one win deterministically, so the
// function never throws and never returns undefined.
export function resolveSchedule(
  records: readonly WorkScheduleRecord[],
  date: string
): ResolvedSchedule {
  const qualifying = records
    .filter((record) => record.effectiveFrom <= date)
    .sort((a, b) =>
      a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0
    )

  const winner = qualifying.at(-1)
  if (!winner) {
    return { ...DEFAULT_SCHEDULE, workDays: [...DEFAULT_SCHEDULE.workDays] }
  }

  return {
    workMinutes: winner.workMinutes,
    workDays: [...winner.workDays],
    bufferMinutes: winner.bufferMinutes
  }
}

// --- day capacity (PLAN-05) ----------------------------------------------------------------------

// The total booked minutes on a day: the sum of every task's effective duration, both trackable and
// non-trackable, because a meeting or a break still eats the day. Reduces over the existing
// effectiveDuration helper, so a task with neither an actual nor an estimate contributes 0 and an
// empty list is 0.
export function sumEffectiveDuration(
  tasks: readonly Pick<PlanningTask, 'actualMinutes' | 'estimatedMinutes'>[]
): number {
  return tasks.reduce((total, task) => total + effectiveDuration(task), 0)
}

// The colour band a day's capacity falls into: comfortable, into the buffer, or overbooked.
export type CapacityState = 'good' | 'warn' | 'bad'

// Everything the capacity header needs to render, computed once here so the component holds no
// capacity logic of its own. booked / remaining / excess are whole minutes (remaining may be
// negative); fillPct / bufferPct are percentages already clamped to 100.
export type DayCapacity = {
  booked: number
  remaining: number
  excess: number
  state: CapacityState
  fillPct: number
  bufferPct: number
}

// The capacity of a single day from its booked minutes and the schedule resolved for its date. The
// state bands are evaluated in order: overbooked first (remaining < 0), then comfortable
// (remaining strictly greater than the buffer), otherwise into the buffer. So remaining exactly
// equal to bufferMinutes and remaining exactly 0 are both 'warn', and overbooked begins only when
// booked strictly exceeds workMinutes. The meter geometry clamps the fill at 100 % and guards a
// degenerate workMinutes of 0 against a divide-by-zero. Pure and DB-free.
export function computeCapacity(
  booked: number,
  workMinutes: number,
  bufferMinutes: number
): DayCapacity {
  const remaining = workMinutes - booked
  const excess = booked > workMinutes ? booked - workMinutes : 0

  let state: CapacityState
  if (remaining < 0) state = 'bad'
  else if (remaining > bufferMinutes) state = 'good'
  else state = 'warn'

  const fillPct =
    workMinutes > 0 ? Math.min(100, (booked / workMinutes) * 100) : booked > 0 ? 100 : 0
  const bufferPct = workMinutes > 0 ? Math.min(100, (bufferMinutes / workMinutes) * 100) : 0

  return { booked, remaining, excess, state, fillPct, bufferPct }
}
