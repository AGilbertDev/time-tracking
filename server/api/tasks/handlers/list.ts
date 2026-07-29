import type { H3Event } from 'h3'

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'

import { isTrackableCategory } from '#shared/categories'
import { nowInZone, statusKey } from '#shared/planning'

import type { TaskListItem, TaskListQuery } from '../../../models/tasks'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'
import { loadWorkSettings } from '../../../utils/loadWorkSettings'

// The stored status that means the work is done. A task carrying it is never late, however long ago
// its delivery was, so it is the one status the late decision excludes.
const DONE_STATUS = 'Terminé'

// The deadline a task with a delivery date but no delivery time is measured against. An untimed
// delivery is due by the end of its day rather than at its first minute, so a task due today with no
// time set is not reported late all day.
const END_OF_DAY = '23:59'

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
// to render. The page draws what it is given.
export async function listTasks(event: H3Event, query: TaskListQuery): Promise<TaskListItem[]> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // The late comparison is made against the user's own wall clock, so a task is late when it is late
  // where they are, not where the server happens to run.
  const { timezone } = await loadWorkSettings(user.id)
  const now = nowInZone(new Date(), timezone)

  // The late decision, made by the database. A task is late when it has a delivery date, carries a
  // status at all (a non-trackable break or meeting has none and no delivery to miss), is not
  // finished, and its deadline has already passed. Joining the stored date and time gives the same
  // 'YYYY-MM-DDTHH:MM' shape as `now`, and both sort chronologically as plain strings, so this is a
  // string comparison rather than any date arithmetic. SQLite has no boolean, so it yields 1 or 0.
  const isOverdue = sql<number>`
    CASE
      WHEN ${tasks.deliveryDate} IS NOT NULL
        AND ${tasks.status} IS NOT NULL
        AND ${tasks.status} <> ${DONE_STATUS}
        AND (${tasks.deliveryDate} || 'T' || COALESCE(${tasks.deliveryTime}, ${END_OF_DAY})) < ${now}
      THEN 1
      ELSE 0
    END
  `

  const rows = await db
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
      sortOrder: tasks.sortOrder,
      isOverdue
    })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), gte(tasks.date, query.from), lte(tasks.date, query.to)))
    .orderBy(asc(tasks.date), asc(tasks.sortOrder), asc(tasks.id))
    .all()

  // Name the database's verdict, using the same pure mapper the contract documents. The flag is only
  // ever set on a row the query already proved late, and the mapper re-checks the finished and
  // non-trackable guards anyway, so a stale or odd stored value cannot produce a late row.
  return rows.map(({ isOverdue: overdue, ...task }) => ({
    ...task,
    statusKey: statusKey(task.status, isTrackableCategory(task.category), overdue === 1)
  }))
}
