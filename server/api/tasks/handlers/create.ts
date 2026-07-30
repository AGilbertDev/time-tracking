import type { H3Event } from 'h3'

import type { TaskCreateInput, TaskListItem } from '../../../models/tasks'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'
import { readTaskForUser } from './projection'
import { assertStatusFitsCategory, nextSortOrder, toTaskColumns } from './write'

// Creates one task for the session user and returns it in the exact shape the list endpoint
// returns, so the client can splice the response straight into the list it already holds with no
// second request and no derivation of its own.
//
// The owning user comes from the session and never from the request. A userId in the body is
// already a 422 at the schema, and even if one arrived it could not reach a column, because the
// insert reads user.id here.
//
// One thing this deliberately does not write. actual_minutes is left alone unless the user sent it,
// so a create carrying only an estimate stores NULL and the read path resolves the fallback through
// effectiveDuration.
export async function createTask(event: H3Event, body: TaskCreateInput): Promise<TaskListItem> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Refuse a body that asserts a status its own category cannot carry, before anything is written.
  assertStatusFitsCategory(body.category, body.status)

  // Read the day's highest sort_order before inserting, so a new task lands at the end of its day.
  // This is the one multi-statement path in the feature, and a failure between the two writes
  // nothing at all, so there is no partial state to unwind.
  const sortOrder = await nextSortOrder(user.id, body.date)

  // date and category are restated rather than left to the spread because their columns are NOT
  // NULL, and userId is set from the session right here so the one authority over ownership is
  // visible at the point of the write.
  const inserted = await db
    .insert(tasks)
    .values({
      ...toTaskColumns(body),
      userId: user.id,
      date: body.date,
      category: body.category,
      sortOrder
    })
    .returning({ id: tasks.id })
    .get()

  const created = await readTaskForUser(user.id, inserted.id)

  // Unreachable in practice, since the insert above just committed this row under this user. It
  // throws rather than asserting so a future change that makes the read conditional cannot return
  // a half-shaped response instead of failing.
  if (!created) throw createError({ statusCode: 404, statusMessage: 'task_not_found' })

  return created
}
