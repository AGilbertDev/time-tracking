import { and, eq, sql } from 'drizzle-orm'

import { isTrackableCategory } from '#shared/categories'
import { nowInZone, statusKey, TASK_STATUS_DONE } from '#shared/planning'

import type { TaskListItem } from '../../../models/tasks'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'
import { loadWorkSettings } from '../../../utils/loadWorkSettings'

// The one place a task row becomes a TaskListItem. The list endpoint, the create endpoint, and the
// update endpoint all return the same shape, and reproducing it three times would mean three copies
// of the late comparison drifting apart. So the select column list, the overdue expression, and the
// row mapper live here and every task read goes through them.

// The deadline a task with a delivery date but no delivery time is measured against. An untimed
// delivery is due by the end of its day rather than at its first minute, so a task due today with no
// time set is not reported late all day.
const END_OF_DAY = '23:59'

// The stored columns every task response carries, in contract order. createdAt and updatedAt are
// deliberately absent: they are lifecycle instants rather than row data, and the contract type does
// not carry them.
const TASK_COLUMNS = {
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
  excludeFromStats: tasks.excludeFromStats,
  splitGroupId: tasks.splitGroupId,
  sortOrder: tasks.sortOrder
}

// A selected row before the derived fields are named. SQLite has no boolean, so the database's late
// verdict arrives as 1 or 0.
export type TaskProjectionRow = Omit<TaskListItem, 'statusKey' | 'trackable'> & {
  isOverdue: number
}

// The user's current wall-clock instant as 'YYYY-MM-DDTHH:MM'. The late comparison is made against
// the user's own clock, so a task is late when it is late where they are and not where the server
// happens to run.
export async function resolveUserNow(userId: string): Promise<string> {
  const { timezone } = await loadWorkSettings(userId)
  return nowInZone(new Date(), timezone)
}

// The select shape for any task read, the stored columns plus the late decision made by the
// database. A task is late when it has a delivery date, carries a status at all (a non-trackable
// break or meeting has none and no delivery to miss), is not finished, and its deadline has already
// passed. Joining the stored date and time gives the same 'YYYY-MM-DDTHH:MM' shape as `now`, and
// both sort chronologically as plain strings, so this is a string comparison rather than any date
// arithmetic. `now` is passed as a bound parameter because the database cannot know the user's zone.
//
// The finished status is imported by name from the shared vocabulary. It used to be destructured out
// of TASK_STATUSES by position here, which took the spelling from the shared tuple but not the
// index, so reordering the cycle would have rebound it to a different status while this expression
// went on compiling and every finished task reported as overdue forever.
export function taskSelection(now: string) {
  return {
    ...TASK_COLUMNS,
    isOverdue: sql<number>`
      CASE
        WHEN ${tasks.deliveryDate} IS NOT NULL
          AND ${tasks.status} IS NOT NULL
          AND ${tasks.status} <> ${TASK_STATUS_DONE}
          AND (${tasks.deliveryDate} || 'T' || COALESCE(${tasks.deliveryTime}, ${END_OF_DAY})) < ${now}
        THEN 1
        ELSE 0
      END
    `
  }
}

// Names the database's verdict, handing the client a finished row rather than a raw row plus the
// rules for reading it. The late flag is only ever set on a row the query already proved late, and
// statusKey re-checks the finished and non-trackable guards anyway, so a stale or odd stored value
// cannot produce a late row.
//
// `trackable` is resolved from the same lookup, so the row carries the answer and the page never
// reads the category contract itself. Resolving it once per row also means the value the client
// draws and the value statusKey was decided from can never disagree.
export function toTaskListItem({ isOverdue, ...task }: TaskProjectionRow): TaskListItem {
  const trackable = isTrackableCategory(task.category)
  return {
    ...task,
    statusKey: statusKey(task.status, trackable, isOverdue === 1),
    trackable
  }
}

// One task in response shape, or undefined when the id matches no row the user owns. Both write
// endpoints read their result back through this, so a created or updated task comes back resolved
// exactly as the list endpoint would have returned it and the client never needs a second read.
//
// Ownership is a WHERE clause rather than a check after the fact, so a row belonging to someone else
// is simply not found. The caller reports the missing case and the not-yours case identically, which
// leaks nothing: a 403 on someone else's id would confirm that the id exists, and a caller holding a
// session could then enumerate ids and learn which ones are real.
export async function readTaskForUser(
  userId: string,
  id: string
): Promise<TaskListItem | undefined> {
  const db = useDb()
  const now = await resolveUserNow(userId)

  const row = await db
    .select(taskSelection(now))
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
    .get()

  return row ? toTaskListItem(row) : undefined
}
