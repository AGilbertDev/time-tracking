import type { H3Event } from 'h3'
import type { z } from 'zod'

import { eq } from 'drizzle-orm'

import type { CompleteOnboardingSchema } from '../../../models/onboarding'

import { useDb } from '../../../db/index'
import { settings, users } from '../../../db/schema'
import { isPasswordBreached } from '../../../utils/checkPasswordBreached'

export async function completeOnboarding(
  event: H3Event,
  body: z.infer<typeof CompleteOnboardingSchema>
) {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Reject passwords known to be compromised. statusMessage is a stable code the client maps to a localized message.
  if (await isPasswordBreached(body.password)) {
    throw createError({ statusCode: 422, statusMessage: 'password_breached' })
  }

  // Hash the password so the raw value is never stored.
  const passwordHash = await hashPassword(body.password)

  // Persist the profile. Setting passwordHash is what marks onboarding complete.
  await db
    .update(users)
    .set({
      firstName: body.firstName,
      lastName: body.lastName,
      passwordHash,
      updatedAt: new Date()
    })
    .where(eq(users.id, user.id))

  // Create the settings row so every user onboarded after this migration has exactly one
  // from the start, and the preference read paths can assume a row exists. Carry the
  // session's current preferences onto it, which are the defaults plus whatever locale the
  // user is already on, so an in-session choice is not discarded. Skip the insert if a row
  // already exists, since the settings userId has no unique constraint to conflict on.
  const existingSettings = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.userId, user.id))
    .get()

  if (!existingSettings) {
    await db.insert(settings).values({
      userId: user.id,
      lightTheme: user.lightTheme,
      darkTheme: user.darkTheme,
      locale: user.locale
    })
  }

  // Read back the persisted preferences through the single read path so the session and
  // cookies reflect exactly what the database holds.
  const preferences = await loadUserPreferences(user.id)

  // Refresh the session so the middleware stops redirecting to onboarding.
  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      firstName: body.firstName,
      lastName: body.lastName,
      onboarded: true,
      // Carry the real role forward from the session minted at magic-link verify. Onboarding
      // never changes the role, so the session value is the user's true role.
      role: user.role,
      lightTheme: preferences.lightTheme,
      darkTheme: preferences.darkTheme,
      locale: preferences.locale
    }
  })

  // Mirror the preferences into the client-readable cookies the no-flash guard reads.
  applyPreferenceCookies(event, preferences)

  return { success: true }
}
