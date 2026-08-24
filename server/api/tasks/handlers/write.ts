import { and, eq, max } from 'drizzle-orm'

import { isDeliverableCategory, isTrackableCategory } from '#shared/categories'

import type { TaskWritableInput } from '../../../models/tasks'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'
import { loadCategoryQuotas } from '../../../utils/loadCategoryQuotas'
import { resolveCategoryQuota } from '../../../utils/resolveCategoryQuota'

// What create and update both need. One copy of each rule, because the two handlers apply the same
// field mapping, the same status-against-category check, and the same sort-order rule, and two
// copies of any of them would drift the moment one endpoint changed.

// The columns a write may set. It is deliberately not the full insert shape. id, userId, createdAt,
// and splitGroupId have no entry here at all, so no request can reach them however the body is
// shaped, and sortOrder and updatedAt are present but are only ever filled by the server.
export type TaskColumnValues = {
  date?: string
  client?: string | null
  project?: string | null
  category?: string
  deliveryDate?: string | null
  deliveryTime?: string | null
  projectWordCount?: number | null
  quotaWphOverride?: number | null
  estimatedMinutes?: number | null
  actualMinutes?: number | null
  status?: string | null
  excludeFromStats?: boolean
  // Already trimmed and emptied-to-null by the schema, so what lands here is either real text or a
  // deliberate NULL. Nothing further is done to it: the app does not warn about, reformat, or police
  // what the user writes in a note.
  notes?: string | null
  // Server-assigned, never mapped from a body. Reordering is PLAN-15 and gets its own endpoint,
  // which it needs regardless because moving one row renumbers others.
  sortOrder?: number
}

// Maps the provided fields of a validated body onto their columns, checking `!== undefined` per
// field so an absent field is left out entirely and an explicit null is passed through.
//
// That distinction is the whole point of a patch and it is not a detail. effectiveDuration reads
// actualMinutes as "the user measured this" and NULL as "the user did not", so a user who typed a
// wrong duration needs a way back to unmeasured, and clearing to 0 is not that, because zero minutes
// is itself a measurement. On a create the same discipline keeps an omitted field on its column
// default rather than writing an explicit NULL over it, which is how excludeFromStats ends up false.
//
// actualMinutes is copied from the body and from nowhere else. No path here reads estimatedMinutes
// in order to write it, on either endpoint. Auto-filling looks like a convenience and the old app
// did exactly that, but storing the copy makes a duration the user confirmed and a duration the app
// assumed into identical rows, and nothing downstream could tell them apart afterwards.
export function toTaskColumns(body: TaskWritableInput): TaskColumnValues {
  const values: TaskColumnValues = {}

  if (body.date !== undefined) values.date = body.date
  if (body.client !== undefined) values.client = body.client
  if (body.project !== undefined) values.project = body.project
  if (body.category !== undefined) values.category = body.category
  if (body.deliveryDate !== undefined) values.deliveryDate = body.deliveryDate
  if (body.deliveryTime !== undefined) values.deliveryTime = body.deliveryTime
  if (body.projectWordCount !== undefined) values.projectWordCount = body.projectWordCount
  if (body.quotaWphOverride !== undefined) values.quotaWphOverride = body.quotaWphOverride
  if (body.estimatedMinutes !== undefined) values.estimatedMinutes = body.estimatedMinutes
  if (body.actualMinutes !== undefined) values.actualMinutes = body.actualMinutes
  if (body.status !== undefined) values.status = body.status
  if (body.excludeFromStats !== undefined) values.excludeFromStats = body.excludeFromStats
  if (body.notes !== undefined) values.notes = body.notes

  return values
}

// The message a contradicting body gets back. Developer-facing English, like every other message
// from this API, because nothing here is shown to a user. The client renders its own copy keyed off
// the status code and the field name.
const STATUS_NOT_DELIVERABLE = 'A task in a category that carries no status cannot carry a status.'

// Refuses a request whose resulting row would carry a status its category cannot hold. The three
// stored statuses apply to categories that are a piece of work capable of being in progress, and a
// non-deliverable task reads as N/A everywhere, so a status stored on one would contradict what
// every reader reports about it.
//
// The rule reads `deliverable` and not `trackable`, and that is the whole point of the two flags
// being separate. A status is refused when the category cannot be in progress, never when the
// category simply contributes nothing to the quota. `other` is non-trackable and does carry a
// status, so { category: 'other', status: 'Terminé' } is a legal write on both endpoints. Keying
// this on `trackable` would refuse the most ordinary thing a user will do with an unclassified row,
// which is mark it finished.
//
// Only an asserted status is refused. A body that moves a task to a non-deliverable category and
// says nothing about status is not an error, and update.ts clears the stored value itself as part of
// the same write. Refusing that case instead would force the editor to know which categories carry a
// status in order to compose a valid request, which is the backend rule leaking into the frontend
// that the conventions forbid.
//
// The check runs against the resulting row rather than against the body, which is why it is here and
// not in Zod. An update sending only { category: 'breaks' } on a task holding 'En cours' has a
// perfectly valid body and produces an invalid row, and Zod only ever sees the request.
//
// The flag is read from the shared contract rather than from a list of category ids written out
// again, so a category whose flag changes changes here too.
export function assertStatusFitsCategory(
  category: string,
  status: string | null | undefined
): void {
  if (status === null || status === undefined) return
  if (isDeliverableCategory(category)) return

  throw createError({
    statusCode: 422,
    statusMessage: STATUS_NOT_DELIVERABLE,
    data: { status: STATUS_NOT_DELIVERABLE }
  })
}

// Why a task written into a given category has no figure, when it has none (PLAN-32b AC12).
//
// The three reasons are kept apart rather than folded into one `null`, because the callers do not want
// the same thing from them. Collapsing them is exactly the defect this type was introduced to fix: a
// failed read and a category that has no quota by definition arrived at update.ts as the same value, and
// the branch that correctly leaves a figure alone for the second was silently also leaving it alone for
// the first, which kept the *previous* category's number on a task that had just been moved to a new one.
export type QuotaSnapshot =
  // A figure was resolved and should be stored.
  | { outcome: 'resolved'; quotaWph: number }
  // The category carries no quota at all, because it is not trackable. This is a fact about the category
  // rather than a failure, and it is the one outcome that means "leave whatever is stored alone".
  | { outcome: 'no-quota-for-category' }
  // The category is trackable and still resolved to nothing. No shipped category reaches this today,
  // since all four trackable ids carry a defaultQuotaWph, and PLAN-30 makes it reachable the moment a
  // user creates a trackable category without one.
  | { outcome: 'unresolved' }
  // The read threw. Distinct from `unresolved` because it is a fault rather than a state, and it is the
  // one outcome that is logged.
  | { outcome: 'read-failed' }

// The quota figure a task written into a given category is measured against, or why there is none
// (PLAN-32b AC12).
//
// This is the whole of the snapshot model's write side. A category quota is a current setting rather
// than a dated history, so what keeps a past period accurate is the figure stored on the task itself,
// the way an invoice line stores the price it was sold at. Both endpoints call this and store what it
// resolves in tasks.quota_wph_override, and after that an edit to the category setting can never move
// a number on a task that already exists.
//
// It resolves rather than computes. Nothing here divides, multiplies, or rounds, because deriving an
// estimate from a quota is PLAN-12's ground and summing a bucket is PLAN-22's, and neither of them is
// this feature. One number is read and handed back.
//
// The trackable gate is checked here rather than left to the resolver, so that a non-trackable category
// is answered without a database read and, more importantly, so its "no figure" is a different value
// from a read that failed. The resolver returns null for both and the difference is not recoverable
// downstream, which is why it is made here instead.
//
// A failure resolves to no figure rather than failing the write, and that direction is deliberate. The
// app records reality and never blocks, so a task must never be refused because a quota could not be
// read. The error is logged rather than swallowed, because a quota read failing repeatedly is worth
// seeing even though it is not worth losing a task over.
//
// **The fail-open justification is about the create path and does not carry to the update path.** On a
// create the argument is complete: the row is written with no figure, resolves through the user's current
// setting and then the shipped default like any task written before this feature, and the user can type a
// figure in the editor, so nothing is lost and nothing is wrong. On a recategorising update the premise is
// false, because the row is not a row with no figure. It already holds the number resolved for the category
// it is leaving, and a fail-open that simply declines to write leaves that number in place on a task that
// is now a different kind of work. That is a wrong figure rather than a missing one, and the trackable gate
// will not screen it out, because the new category is trackable. update.ts therefore writes NULL for both
// failure outcomes rather than leaving the stale figure, which is the create path's safe fallback applied
// to the update path instead of the create path's reasoning being assumed to hold there.
//
// So this fail-open direction is not in tension with the trackable gate's fail-closed one, but the reason
// is narrower than "one is about quotas and one is about records". A figure resolved for one category is
// never correct on a task in another, so the only question a failure leaves open is whether the row ends
// up holding a stale figure the gate ignores, which is harmless, or one the gate will happily use, which
// is the defect. Answering that question is what the outcomes above exist for.
export async function resolveQuotaSnapshot(
  userId: string,
  category: string
): Promise<QuotaSnapshot> {
  if (!isTrackableCategory(category)) return { outcome: 'no-quota-for-category' }

  try {
    const records = await loadCategoryQuotas(userId)
    const resolved = resolveCategoryQuota(category, records)

    if (!resolved) return { outcome: 'unresolved' }

    return { outcome: 'resolved', quotaWph: resolved.quotaWph }
  } catch (error) {
    console.error('category quota read failed during a task write; storing no figure', {
      userId,
      category,
      error
    })

    return { outcome: 'read-failed' }
  }
}

// The sort_order a task takes at the end of a given day, so max + 1 across that user's tasks on that
// date, or 0 when the day has none. The server assigns it because the correct value depends on rows
// the client may not have loaded, which makes it a backend decision by the same rule that puts
// filtering and ordering on the server. The scan is scoped to the session user, so another user's
// tasks on the same date cannot move it.
//
// No transaction and no lock. Two creates racing on the same day can produce two rows sharing a
// sort_order, and that is not an invalid state: the list orders by (date, sortOrder, id) with the id
// as a stable tie-break, so a collision degrades to a deterministic order rather than a bug.
export async function nextSortOrder(userId: string, date: string): Promise<number> {
  const db = useDb()

  const row = await db
    .select({ highest: max(tasks.sortOrder) })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.date, date)))
    .get()

  // An empty day aggregates to NULL, which is the 0 case rather than a missing one.
  return (row?.highest ?? -1) + 1
}
