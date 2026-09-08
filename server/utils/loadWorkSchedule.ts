import { asc, eq } from 'drizzle-orm'

import type { WorkScheduleRecord } from '../../shared/planning'

import { coerceWorkDays } from '../../shared/planning'
import { useDb } from '../db/index'
import { workSchedule } from '../db/schema'

// Reads a user's effective-dated work-schedule history and returns it coerced to the
// WorkScheduleRecord shape the shared resolveSchedule consumes, ordered by effective_from
// ascending. This is the single read path behind GET /api/me/work-schedule, mirroring
// loadWorkSettings so the work_days coercion lives in one place. An empty history returns an empty
// array; the caller never special-cases "no schedule" because resolveSchedule then supplies the
// documented defaults for any date.
export async function loadWorkSchedule(userId: string): Promise<WorkScheduleRecord[]> {
  const db = useDb()

  const rows = await db
    .select({
      workMinutes: workSchedule.workMinutes,
      workDays: workSchedule.workDays,
      bufferMinutes: workSchedule.bufferMinutes,
      effectiveFrom: workSchedule.effectiveFrom
    })
    .from(workSchedule)
    .where(eq(workSchedule.userId, userId))
    .orderBy(asc(workSchedule.effectiveFrom))
    .all()

  return rows.map((row) => ({
    workMinutes: row.workMinutes,
    workDays: coerceWorkDays(row.workDays),
    bufferMinutes: row.bufferMinutes,
    effectiveFrom: row.effectiveFrom
  }))
}
