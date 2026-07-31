import type { H3Event } from 'h3'

import { and, eq } from 'drizzle-orm'

import { isDeliverableCategory } from '#shared/categories'

import type { TaskListItem, TaskUpdateInput } from '../../../models/tasks'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'
import { readTaskForUser } from './projection'
import { assertStatusFitsCategory, nextSortOrder, toTaskColumns } from './write'

// The message both not-found cases return. A missing id and another user's id are deliberately
// indistinguishable from outside, same status and same body, so a caller holding a session cannot
// learn which ids are real by probing them.
const NOT_FOUND = 'task_not_found'

// Applies a partial patch to one task the session user owns and returns the row in the exact shape
// the list endpoint returns. An absent field leaves its column alone and an explicit null clears it.
//
// This is never an upsert. A patch on an id that matches no row the user owns is a 404 and writes
// nothing, which is what a second tab having already deleted the row looks like from here.
export async function updateTask(
  event: H3Event,
  id: string,
  body: TaskUpdateInput
): Promise<TaskListItem> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Load the row first, scoped to the session user in the WHERE clause so ownership is enforced by
  // the query rather than by a check that could be forgotten. Only the three fields the merge needs
  // are read: the resulting category and status decide the status rule, and the stored date decides
  // whether the task is moving day.
  const existing = await db
    .select({ category: tasks.category, date: tasks.date, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .get()

  if (!existing) throw createError({ statusCode: 404, statusMessage: NOT_FOUND })

  const values = toTaskColumns(body)

  // The status rule is checked against the merged row rather than against the body, because a body
  // can be perfectly valid and still produce an invalid row. A patch sending only
  // { category: 'breaks' } on a task holding 'En cours' is exactly that case, which is why Zod
  // cannot make this call: it only ever sees the request.
  const category = body.category ?? existing.category
  assertStatusFitsCategory(category, body.status)

  // The patch moved the task to a category that carries no status and said nothing about status, so
  // the server clears the stored value itself and keeps the row valid. Refusing until the client
  // sent status: null too would force the editor to know which categories carry a status in order to
  // compose a valid request, which is the backend rule leaking into the frontend.
  //
  // The guard reads `deliverable` rather than `trackable`, and getting this one wrong in the other
  // direction would be worse than the defect it replaces. `other` is non-trackable and does carry a
  // status, so a version still keyed on `trackable` would silently wipe a stored status the moment a
  // user moved a row to Autre, which is a data-loss path this feature would have created rather than
  // inherited. Moving a task to `other` leaves its status alone. Moving it to `breaks` still clears.
  if (body.status === undefined && existing.status !== null && !isDeliverableCategory(category)) {
    values.status = null
  }

  // A task changing date is moving to another day, where its old sort_order was an ordinal in a
  // different list and means nothing, so carrying it over would drop the task at an arbitrary
  // position. Reassigning keeps one invariant true everywhere: sort_order is always the server's
  // answer relative to the row's own day.
  if (values.date !== undefined && values.date !== existing.date) {
    values.sortOrder = await nextSortOrder(user.id, values.date)
  }

  // updatedAt is set by hand on every mutation. $defaultFn fires on insert only, so an update that
  // forgets it leaves a stale instant, which is the mistake deactivate.ts avoids the same way.
  await db
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))

  const updated = await readTaskForUser(user.id, id)

  // The row was there a moment ago, so this only fires if another tab deleted it between the two
  // statements. A 404 is the honest answer, and it is the same one the client already handles.
  if (!updated) throw createError({ statusCode: 404, statusMessage: NOT_FOUND })

  return updated
}
