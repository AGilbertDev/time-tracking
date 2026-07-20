import { asc, eq } from 'drizzle-orm'

import type { WorkScheduleRecord } from '../../shared/planning'

import { useDb } from '../db/index'
import { workSchedule } from '../db/schema'

// The default work_days set, matching the settings column default and DEFAULT_SCHEDULE, used when a
// stored work_days value is corrupt or not an array so a broken shape never reaches the resolver.
const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5]

// The work_days column stores JSON text, so a stored value can be corrupted or legacy. Parse
// defensively, the same discipline as loadWorkSettings.coerceWorkDays: a non-JSON or non-array
// value falls back to the default set, any entry that is not an integer 0 through 6 is dropped,
// duplicates are removed, and a legitimately empty array is preserved as an empty set.
function coerceWorkDays(raw: string): number[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [...DEFAULT_WORK_DAYS]
  }

  if (!Array.isArray(parsed)) return [...DEFAULT_WORK_DAYS]

  const seen = new Set<number>()
  const days: number[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 6) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    days.push(entry)
  }
  return days
}

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
