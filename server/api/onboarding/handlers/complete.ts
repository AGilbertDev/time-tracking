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

  // Onboarding completes exactly once. If this account already has a password hash it is
  // onboarded, so a second submit (for example by reopening the wizard URL) is rejected rather
  // than allowed to overwrite the existing profile.
  const existing = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .get()
  if (existing?.passwordHash) {
    throw createError({ statusCode: 409, statusMessage: 'already_onboarded' })
  }

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

  // Upsert the settings row with every submitted appearance and work value. The work_days
  // array is serialized to its JSON text form because the column stores text. The settings
  // userId has no unique constraint to conflict on, so the row is updated when one already
  // exists (for example a backfilled user) and inserted otherwise (the common magic-link case
  // that reaches onboarding without a row). Both branches write the same full set of columns.
  const settingsValues = {
    lightTheme: body.lightTheme,
    darkTheme: body.darkTheme,
    locale: body.locale,
    dailyWorkMinutes: body.dailyWorkMinutes,
    workDays: JSON.stringify(body.workDays),
    timezone: body.timezone
  }

  const existingSettings = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.userId, user.id))
    .get()

  if (existingSettings) {
    await db.update(settings).set(settingsValues).where(eq(settings.userId, user.id))
  } else {
    await db.insert(settings).values({ userId: user.id, ...settingsValues })
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
      // Onboarding never changes the avatar, so carry forward whatever the session minted at
      // magic-link verify holds (null for a brand-new user).
      avatarUrl: user.avatarUrl,
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
