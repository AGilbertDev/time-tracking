import type { H3Event } from 'h3'

import { and, asc, eq, gte, lte } from 'drizzle-orm'

import type { TaskListItem, TaskListQuery } from '../../../models/tasks'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'

// Returns the caller's task rows whose date falls in [from, to] inclusive. The scope is always the
// session user read from the session, never an id from the request, so another user's rows can
// never be returned even if a user id is smuggled into the query. The query is the single indexed
// range scan the (user_id, date) index was built for: an equality match on user_id and a range on
// date. Ordered by date, then sortOrder, then id for a stable tie-break, so a week with several
// tasks on the same day renders in a deterministic order. An empty range is a normal empty array,
// not an error.
export async function listTasks(event: H3Event, query: TaskListQuery): Promise<TaskListItem[]> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  return db
    .select({
      id: tasks.id,
      date: tasks.date,
      client: tasks.client,
      project: tasks.project,
      category: tasks.category,
      deliveryDate: tasks.deliveryDate,
      deliveryTime: tasks.deliveryTime,
      projectWordCount: tasks.projectWordCount,
      wordsDone: tasks.wordsDone,
      quotaWphOverride: tasks.quotaWphOverride,
      estimatedMinutes: tasks.estimatedMinutes,
      actualMinutes: tasks.actualMinutes,
      status: tasks.status,
      instructions: tasks.instructions,
      splitGroupId: tasks.splitGroupId,
      sortOrder: tasks.sortOrder
    })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), gte(tasks.date, query.from), lte(tasks.date, query.to)))
    .orderBy(asc(tasks.date), asc(tasks.sortOrder), asc(tasks.id))
    .all()
}
