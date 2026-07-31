import type { CategoryId } from '#shared/categories'
import type { PlanningTask, TaskStatus } from '#shared/planning'

import { coerceCategory, DEFAULT_CATEGORY_ID, isDeliverableCategory } from '#shared/categories'
import { normalizeFreeText } from '#shared/planning'

// The pure half of the inline task editor: the shape the form holds, the comparison that decides
// whether anything changed, the request body that comparison produces, and the lookup that turns a
// 422's field names into copy keys. None of it touches Vue or the network, so the unit-test stage can
// cover it from the acceptance criteria rather than from the implementation.
//
// The editor validates exactly one thing and nothing else lives here either: that something changed.
// It used to validate a second, that a category had been chosen, and that check is gone because there
// is no longer a categoryless state to catch. Every other rule (a real calendar day, the HH:MM shape,
// the numeric bounds, whether a status fits its category) is the server's, and the client does not
// carry a second copy of any of them.

// The request body both write endpoints accept, as the client sends it. Every field is optional
// because a PATCH is a genuine partial patch, and the nullable ones are nullable because an explicit
// null clears a column while an absent key leaves it alone.
//
// It mirrors the server's TaskWritableSchema the same way PlanningTask mirrors TaskListItem: the
// client keeps its own statement of the contract rather than importing server code across the
// boundary. The server is still the only thing that validates it.
export type TaskWritePayload = {
  actualMinutes?: number | null
  category?: CategoryId
  client?: string | null
  date?: string
  deliveryDate?: string | null
  deliveryTime?: string | null
  estimatedMinutes?: number | null
  excludeFromStats?: boolean
  notes?: string | null
  project?: string | null
  projectWordCount?: number | null
  quotaWphOverride?: number | null
  status?: TaskStatus | null
}

// The editor's own state, one member per control. Text and date fields are held as strings because
// that is what an input models, and an empty string is what an emptied box gives; the normalization
// to null happens once, in the comparison below, through the shared rule the server's own schemas
// read. Numeric fields are held as number or null because UInputNumber emits null for an empty box,
// and that null is the difference between an unmeasured duration and a measured zero.
//
// The category is not nullable, and that is the type saying what the feature decided rather than a
// convenience. A loaded row's category is coerced, a draft's is the shared default, and the selector
// offers no way to clear one, so there is no moment at which the form holds no category and nothing
// downstream has to ask whether one has been chosen yet.
export type TaskEditorState = {
  actualMinutes: number | null
  category: CategoryId
  client: string
  date: string
  deliveryDate: string
  deliveryTime: string
  estimatedMinutes: number | null
  excludeFromStats: boolean
  notes: string
  project: string
  projectWordCount: number | null
  quotaWphOverride: number | null
  status: TaskStatus | null
}

// The two free-text bounds the editor needs to say how long a value may be. They are declared in
// shared/planning.ts and the server's own Zod schemas read the same two declarations, so the number
// this module quotes in a character counter is by construction the number the server enforces. They
// are re-exported rather than re-imported at each call site only so the editor component keeps
// reaching for the editor's own module for everything it needs; the values live in exactly one place.
export { TASK_NOTES_MAX, TASK_TEXT_MAX } from '#shared/planning'

// Which editor is open, if any, as one value: an edit of a task id, a draft on a date, or nothing.
// Exactly one is open across the whole week, so it lives on app/pages/index.vue rather than in a day
// card, which cannot express exclusivity across sibling rows or across cards. Like a card's own open
// state, this is the narrow presentation exception the backend-logic rule carves out by name: it is
// not persisted, not in the URL, and never sent to the server.
export type OpenEditorTarget =
  | { date: string; kind: 'draft' }
  | { date: string; kind: 'edit'; taskId: string }

// Whether two targets name the same editor, which is what makes pressing an already-open row or add
// control collapse it rather than reopen it.
export function isSameEditorTarget(
  a: null | OpenEditorTarget,
  b: null | OpenEditorTarget
): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'edit' && b.kind === 'edit') return a.taskId === b.taskId
  return a.date === b.date
}

// A blank editor, which is what a draft starts from and what a draft's changes are measured against.
// The day is filled because a draft always opens inside a day card and that card's date is the one
// thing the user did not have to type.
//
// The category is filled too, from DEFAULT_CATEGORY_ID rather than from a literal, so a draft opens
// on the value that will be stored if the user saves without touching the field. That is the whole of
// why a save can no longer be blocked by a dropdown nobody opened. The earlier reasoning for leaving
// it empty was that both plausible defaults corrupt statistics, translation by labelling a break as
// translation work and admin by taking real work out of the quota, and it was right about those two
// and does not reach this one: the default is non-trackable, so it produces no words and moves no
// quota figure, and a figure it cannot move is a figure it cannot corrupt.
export function emptyEditorState(date: string): TaskEditorState {
  return {
    actualMinutes: null,
    category: DEFAULT_CATEGORY_ID,
    client: '',
    date,
    deliveryDate: '',
    deliveryTime: '',
    estimatedMinutes: null,
    excludeFromStats: false,
    notes: '',
    project: '',
    projectWordCount: null,
    quotaWphOverride: null,
    status: null
  }
}

// The editor filled from a loaded row. A null contract field becomes an empty control rather than the
// string 'null'.
//
// The category is coerced, so a row left holding a retired id displays a valid category instead of
// nothing. That coerced value is also the baseline the comparison uses, which is what keeps a stale
// row patchable: an edit that only touches the client name sends no category key at all, so the
// strict enum on the write boundary never sees the stale id. Picking a category in the selector is
// what repairs the row, and the one case that cannot be told from not touching the field is picking
// the very id the coercion already displays.
export function taskToEditorState(task: PlanningTask): TaskEditorState {
  return {
    actualMinutes: task.actualMinutes,
    category: coerceCategory(task.category),
    client: task.client ?? '',
    date: task.date,
    deliveryDate: task.deliveryDate ?? '',
    deliveryTime: task.deliveryTime ?? '',
    estimatedMinutes: task.estimatedMinutes,
    excludeFromStats: task.excludeFromStats,
    notes: task.notes ?? '',
    project: task.project ?? '',
    projectWordCount: task.projectWordCount,
    quotaWphOverride: task.quotaWphOverride,
    status: (task.status as TaskStatus | null) ?? null
  }
}

// The status the Statut control shows, which is by construction the status that will be stored.
//
// The form holds the user's choice and this derives what may be displayed from it, rather than the
// control holding a value of its own. That is what closes the defect where flipping the category to
// one that carries no status left the disabled control still printing `Terminé` while the write
// silently cleared it: the screen made a claim about the row that the save then contradicted, and the
// user's own action two controls away had caused it.
//
// It is deliberately derived rather than cleared in place. Clearing state.status on a category change
// would lose a value the user never asked to lose, so flipping to a statusless category and back would
// come back empty and a round trip would report itself as a change. Deriving means the pending
// category decides what is shown, the stored choice survives underneath, and flipping back shows the
// value that is still going to be stored.
//
// It reads isDeliverableCategory, the same function diffEditorState reads below, which is what keeps
// the displayed value and the sent value from ever disagreeing. It is not isTrackableCategory: a
// status is not a quota question, and `other` is the one category where the two answers differ.
export function displayedStatus(state: TaskEditorState): null | TaskStatus {
  return isDeliverableCategory(state.category) ? state.status : null
}

// The changed fields between a loaded row and what the form now holds, which is at once the dirty
// verdict and the request body. One function settles all three of those, so the editor cannot decide
// that something changed and then send a patch that says otherwise.
//
// Text and date fields are compared on their normalized value, read from the shared normalizeFreeText
// the server's own free-text and notes schemas read, so typing a space into an empty box and deleting
// it again is not a change and never produces a patch the server has nothing to do with.
//
// Status is omitted entirely when the pending category carries no status, rather than sent as null.
// The server clears the stored value itself as part of the same write, so there is one place that
// clears it. The pending selection is what decides, not the row's server-resolved flag, because the
// selection can differ from the stored category before a save. That is the one derived value the
// editor computes and it is legitimate because isDeliverableCategory lives once in shared/ and both
// sides import it.
//
// The question is whether the category carries a status, so the guard reads isDeliverableCategory and
// never isTrackableCategory. The two were one function until `other` arrived, and `other` is the
// member where they disagree: it is not trackable, so it moves no quota figure, and it is deliverable,
// so it does carry a status. Reading trackability here would clear a status the moment the user chose
// `Autre`, which is a data-loss path rather than the defect this guard exists for.
export function diffEditorState(
  baseline: TaskEditorState,
  current: TaskEditorState
): TaskWritePayload {
  const payload: TaskWritePayload = {}

  if (current.date !== baseline.date) payload.date = current.date
  if (current.category !== baseline.category) payload.category = current.category

  assignText(payload, 'client', baseline.client, current.client)
  assignText(payload, 'project', baseline.project, current.project)
  assignText(payload, 'notes', baseline.notes, current.notes)
  assignText(payload, 'deliveryDate', baseline.deliveryDate, current.deliveryDate)
  assignText(payload, 'deliveryTime', baseline.deliveryTime, current.deliveryTime)

  if (current.projectWordCount !== baseline.projectWordCount) {
    payload.projectWordCount = current.projectWordCount
  }
  if (current.quotaWphOverride !== baseline.quotaWphOverride) {
    payload.quotaWphOverride = current.quotaWphOverride
  }
  if (current.estimatedMinutes !== baseline.estimatedMinutes) {
    payload.estimatedMinutes = current.estimatedMinutes
  }
  if (current.actualMinutes !== baseline.actualMinutes) {
    payload.actualMinutes = current.actualMinutes
  }
  if (current.excludeFromStats !== baseline.excludeFromStats) {
    payload.excludeFromStats = current.excludeFromStats
  }

  if (isDeliverableCategory(current.category) && current.status !== baseline.status) {
    payload.status = current.status
  }

  return payload
}

// Whether anything the user typed differs from what was loaded. It reads the same comparison the
// patch body comes from, so the save control can never be enabled with nothing to send.
export function isEditorDirty(baseline: TaskEditorState, current: TaskEditorState): boolean {
  return Object.keys(diffEditorState(baseline, current)).length > 0
}

// The create body for a draft: every field the user filled, plus the day and the category. It is the
// same comparison against a blank editor, so a field left alone is absent rather than sent as null,
// and one function still settles what a change is.
//
// The day is stated because the create schema requires it, and the category is stated because it is
// the value the user was shown. An untouched selector matches the blank editor and so produces no key
// from the comparison, and the boundary would supply the same id anyway, but a body that names what
// the panel printed is honest about it rather than leaning on a default the user never saw. Both
// routes are legal and reach the same stored value, and neither retypes the id: it comes from the
// shared constant through the blank editor.
export function buildCreatePayload(current: TaskEditorState): TaskWritePayload {
  const payload = diffEditorState(emptyEditorState(current.date), current)

  payload.category = current.category
  payload.date = current.date

  return payload
}

// The copy key each field of a 422's `data` maps to. The client renders these and never the server's
// developer-facing English. A key that is not here, including `_form` and anything a later schema
// adds, falls back to the form-level message the editor shows in its alert.
export const TASK_FIELD_ERROR_KEYS: Readonly<Record<string, string>> = {
  actualMinutes: 'planning.editor.validation.durationInvalid',
  category: 'planning.editor.validation.invalid',
  client: 'planning.editor.validation.textTooLong',
  date: 'planning.editor.validation.dayInvalid',
  deliveryDate: 'planning.editor.validation.deliveryDateInvalid',
  deliveryTime: 'planning.editor.validation.timeInvalid',
  estimatedMinutes: 'planning.editor.validation.durationInvalid',
  notes: 'planning.editor.validation.notesTooLong',
  project: 'planning.editor.validation.textTooLong',
  projectWordCount: 'planning.editor.validation.wordsInvalid',
  quotaWphOverride: 'planning.editor.validation.quotaInvalid',
  status: 'planning.editor.validation.statusNotDeliverable'
}

// How a failed save is recovered from. Each member is a different recovery rather than a different
// message: a validation failure points at fields, an expired session needs a sign-in that does not
// unmount the form, a deleted row can only be recreated, and everything else is worth retrying.
export type TaskWriteFailure =
  | { fields: Record<string, string>; kind: 'validation' }
  | { kind: 'gone' }
  | { kind: 'retryable' }
  | { kind: 'unauthenticated' }

type FetchFailure = {
  data?: { data?: unknown } | null
  status?: number
  statusCode?: number
}

// Classifies whatever $fetch threw. Both status shapes are read because ofetch reports the code on
// `status` and h3's serialized body repeats it on `statusCode`, and a network failure carries
// neither, which lands on the retryable branch where it belongs.
export function classifyTaskWriteError(error: unknown): TaskWriteFailure {
  const failure = (error ?? {}) as FetchFailure
  const status = failure.statusCode ?? failure.status

  if (status === 401) return { kind: 'unauthenticated' }
  if (status === 404) return { kind: 'gone' }
  if (status === 422) return { fields: readFieldErrors(failure.data?.data), kind: 'validation' }

  return { kind: 'retryable' }
}

// The `data` map sendZodError returns, narrowed to the string values the editor can key copy off.
// A 422 whose body is any other shape yields an empty map, which the editor surfaces as its
// form-level message rather than as nothing at all.
function readFieldErrors(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {}

  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'string') fields[key] = value
  }
  return fields
}

// One free-text or date field, compared and written normalized. Both sides go through the shared
// rule, so '' and '   ' and null are one absence on both sides of the boundary.
function assignText(
  payload: TaskWritePayload,
  field: 'client' | 'deliveryDate' | 'deliveryTime' | 'notes' | 'project',
  baseline: string,
  current: string
) {
  const next = normalizeFreeText(current)
  if (next === normalizeFreeText(baseline)) return

  payload[field] = next
}
