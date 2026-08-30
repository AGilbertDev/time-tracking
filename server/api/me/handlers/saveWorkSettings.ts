import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import type { WorkSettingsPatch } from '../../../models/work-settings'
import type { WorkSettings } from '../../../utils/loadWorkSettings'

import { useDb } from '../../../db/index'
import { settings } from '../../../db/schema'

// Writes the provided work-setting fields to the current user's settings row and returns the
// full current set so the client can reconcile. Only the provided fields are written, so a
// partial save leaves the other columns untouched. If the row is missing, it is inserted with
// the provided fields and the column defaults fill the rest rather than failing the write,
// matching savePreferences. The write is always scoped to the session user.
export async function saveWorkSettings(
  event: H3Event,
  body: WorkSettingsPatch
): Promise<WorkSettings> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Map only the provided fields onto their columns. workDays is serialized to JSON text because
  // the column stores text; a full replacement array, never an element-wise merge.
  const values: {
    dailyWorkMinutes?: number
    workDays?: string
    timezone?: string
  } = {}
  if (body.dailyWorkMinutes !== undefined) values.dailyWorkMinutes = body.dailyWorkMinutes
  if (body.timezone !== undefined) values.timezone = body.timezone
  if (body.workDays !== undefined) values.workDays = JSON.stringify(body.workDays)

  const existing = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.userId, user.id))
    .get()

  if (existing) {
    await db.update(settings).set(values).where(eq(settings.userId, user.id))
  } else {
    await db.insert(settings).values({ userId: user.id, ...values })
  }

  // Read back through the single read path so the response reflects exactly what the database
  // now holds, including the columns filled by defaults on an insert.
  return loadWorkSettings(user.id)
}
