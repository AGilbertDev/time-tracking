import type { H3Event } from 'h3'
import type { z } from 'zod'

import { eq } from 'drizzle-orm'

import type { LoginSchema } from '../../../models/auth'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'

export async function loginWithPassword(event: H3Event, body: z.infer<typeof LoginSchema>) {
  const db = useDb()
  const user = await db.select().from(users).where(eq(users.email, body.email)).get()

  // One generic failure for unknown email, no password set, or wrong password, so the
  // response never reveals which emails have accounts.
  const invalidCredentials = () =>
    createError({ statusCode: 401, statusMessage: 'invalid_credentials' })

  if (!user || !user.passwordHash) throw invalidCredentials()

  const passwordMatches = await verifyPassword(user.passwordHash, body.password)
  if (!passwordMatches) throw invalidCredentials()

  // Only after correct credentials do we disclose deactivation, so it is not an enumeration vector.
  if (user.deactivatedAt) {
    throw createError({ statusCode: 403, statusMessage: 'account_deactivated' })
  }

  // Load the persisted preferences so the session and the client cookies carry them
  // from the first render, matching the atmosphere and locale across devices.
  const preferences = await loadUserPreferences(user.id)

  // The onboarded flag comes from the stored users.onboarded_at column rather than from a literal
  // true. The literal was sound while this handler was unreachable without a verified password, but
  // an account can now have a password and still not be through setup, which is exactly what an
  // admin who reset their own onboarding looks like. Reading the column is what lets that admin sign
  // in from another device and be routed to the wizard instead of to a dashboard they have no
  // settings for. Note that password_hash is still what this handler authenticates against a few
  // lines above, because "has credentials" and "has finished setup" are two separate facts.
  const onboarded = !!user.onboardedAt

  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      onboarded,
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
