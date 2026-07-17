import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import type { PreferencesPatch } from '../../../models/preferences'
import type { UserPreferences } from '../../../utils/loadUserPreferences'

import { useDb } from '../../../db/index'
import { settings } from '../../../db/schema'

// Writes the provided preference fields to the current user's settings row, refreshes the
// session, mirrors the cookies, and returns the full updated set. The write is always
// scoped to the session user so a user can never write another user's preferences.
export async function savePreferences(
  event: H3Event,
  body: PreferencesPatch
): Promise<UserPreferences> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Update only the provided fields. If the row is missing (the edge the backfill and
  // onboarding creation are meant to prevent), insert it with the provided fields and let
  // the column defaults fill the rest, rather than failing the write.
  const existing = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.userId, user.id))
    .get()

  if (existing) {
    await db.update(settings).set(body).where(eq(settings.userId, user.id))
  } else {
    await db.insert(settings).values({ userId: user.id, ...body })
  }

  // Read back through the single read path so the response, session, and cookies all
  // reflect exactly what the database now holds.
  const preferences = await loadUserPreferences(user.id)

  // Refresh the session so the next render carries the new values without a re-login,
  // merging the preferences onto the existing user rather than rebuilding it.
  await setUserSession(event, { user: { ...user, ...preferences } })

  // Mirror the affected preferences into the client-readable cookies the no-flash guard reads.
  applyPreferenceCookies(event, preferences)

  return preferences
}
