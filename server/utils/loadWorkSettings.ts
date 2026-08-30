import { eq } from 'drizzle-orm'

import { useDb } from '../db/index'
import { settings } from '../db/schema'

export interface WorkSettings {
  dailyWorkMinutes: number
  timezone: string
  workDays: number[]
}

// There is no quota here. The single global quota_wph column this used to read retired in migration
// 0011, because a quota belongs to a kind of work rather than to a person. The per-category figures
// live in the category_quotas table and are read through loadCategoryQuotas.

// Coded defaults matching the settings column defaults, returned when no row exists yet so a
// user who reaches the settings page before any settings write still sees a coherent set.
const DEFAULT_DAILY_WORK_MINUTES = 450
const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5]
const DEFAULT_TIMEZONE = 'America/Toronto'

// The work_days column stores JSON text, so a stored value can be corrupted or legacy. Parse
// defensively: a non-JSON or non-array value falls back to the default set, and any entry that
// is not an integer 0 through 6 is dropped, with duplicates removed, so a broken shape can never
// reach the client. An empty array is a valid stored value and is preserved as an empty set.
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

// Reads a user's persisted work settings from their settings row. Returns the coded defaults
// when no row exists yet, mirroring loadUserPreferences. This is the single read path reused by
// the GET handler and by the PATCH handler's read-back so the fallback and the work_days
// coercion live in one place.
export async function loadWorkSettings(userId: string): Promise<WorkSettings> {
  const db = useDb()

  const row = await db
    .select({
      dailyWorkMinutes: settings.dailyWorkMinutes,
      workDays: settings.workDays,
      timezone: settings.timezone
    })
    .from(settings)
    .where(eq(settings.userId, userId))
    .get()

  if (!row) {
    return {
      dailyWorkMinutes: DEFAULT_DAILY_WORK_MINUTES,
      workDays: [...DEFAULT_WORK_DAYS],
      timezone: DEFAULT_TIMEZONE
    }
  }

  return {
    dailyWorkMinutes: row.dailyWorkMinutes ?? DEFAULT_DAILY_WORK_MINUTES,
    workDays: coerceWorkDays(row.workDays),
    timezone: row.timezone
  }
}
