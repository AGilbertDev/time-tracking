import type { H3Event } from 'h3'

import { and, eq } from 'drizzle-orm'

import { useDb } from '../../../db/index'
import { tasks } from '../../../db/schema'

// The id of the row that went, so a client reconciling an optimistic removal can confirm which one
// it was. A small result object rather than a bare 204, matching the house habit.
export type TaskRemoveResult = { id: string }

// Deletes one task the session user owns. A hard delete: there is no deleted_at column on tasks and
// adding one is a schema change this feature may not make, and a soft delete would silently change
// every existing read path, because listTasks has no deleted-row filter and would start returning
// them until it got one.
//
// The recovery the conventions ask for does not need the column. A task row is small and entirely
// client-known at the moment of deletion, so an undo is a re-create from the row the client already
// holds. That affordance belongs to PLAN-13. One property of it to state plainly: re-creating
// produces a new id, so an undo is a re-create and not a restore. That is fine while nothing else
// points at a task by id, and PLAN-34's running-timer task id would be the first thing that does.
//
// Split siblings are untouched. Deleting one slice of a split group deletes that row only and the
// others keep their split_group_id, including when exactly one is left, which the schema already
// defines as a valid state rather than an orphan needing cleanup.
export async function removeTask(event: H3Event, id: string): Promise<TaskRemoveResult> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Ownership is the WHERE clause, so another user's row is simply not deleted and reads as not
  // found. One statement touching one row, so there is no partial write to unwind.
  const deleted = await db
    .delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .returning({ id: tasks.id })
    .get()

  // A row that is already gone is a 404, the same answer another user's id gets. A uniform 204 would
  // read as more idempotent, but to avoid leaking existence it would have to cover the not-yours
  // case too, and then delete always succeeds and the client can never learn that anything went
  // wrong. The endpoint stays idempotent in effect, since the row is gone either way and a repeated
  // call changes nothing. The client rule that makes this safe is that a 404 on delete means the row
  // is already absent, which is the outcome the user asked for, so it is a success plus a refresh.
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'task_not_found' })

  return { id: deleted.id }
}
