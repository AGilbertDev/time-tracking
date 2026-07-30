import type { H3Event } from 'h3'

import { and, asc, eq, gte, lte } from 'drizzle-orm'

import type { TaskListItem, TaskListQuery } from '../../../models/tasks'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'
import { resolveUserNow, taskSelection, toTaskListItem } from './projection'

// Returns the caller's task rows whose date falls in [from, to] inclusive. The scope is always the
// session user read from the session, never an id from the request, so another user's rows can
// never be returned even if a user id is smuggled into the query. The query is the single indexed
// range scan the (user_id, date) index was built for: an equality match on user_id and a range on
// date. Ordered by date, then sortOrder, then id for a stable tie-break, so a week with several
// tasks on the same day renders in a deterministic order. An empty range is a normal empty array,
// not an error.
//
// The row's `statusKey` is resolved here rather than in the page. The late pseudo-status depends on
// the current instant in the user's own timezone, which no stored column holds and no client should
// be trusted to decide, so the comparison is made in the query and the row is handed a finished key
// to render. The page draws what it is given. The select list, the late expression, and the mapper
// come from the shared projection so this endpoint and the two write endpoints answer identically.
export async function listTasks(event: H3Event, query: TaskListQuery): Promise<TaskListItem[]> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const now = await resolveUserNow(user.id)

  const rows = await db
    .select(taskSelection(now))
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), gte(tasks.date, query.from), lte(tasks.date, query.to)))
    .orderBy(asc(tasks.date), asc(tasks.sortOrder), asc(tasks.id))
    .all()

  return rows.map(toTaskListItem)
}
