import type { H3Event } from 'h3'
import type { z } from 'zod'

import { and, eq, gt } from 'drizzle-orm'

import type { VerifySchema } from '../../../models/magic-link'

import { useDb } from '../../../db/index'
import { magicLinkTokens, users } from '../../../db/schema'

export async function verifyMagicLink(event: H3Event, query: z.infer<typeof VerifySchema>) {
  const db = useDb()
  const { token } = query

  // Validate that the token exists, has not been used, and has not expired.
  const record = await db
    .select()
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.token, token),
        eq(magicLinkTokens.used, false),
        gt(magicLinkTokens.expiresAt, new Date())
      )
    )
    .get()

  if (!record) {
    // An expired, used, or unknown token is a dead end. Rather than strand the user on a bare
    // error, send them to the sign-up page with a flag so it can invite them to request a fresh
    // link. This is the recovery path for an abandoned onboarding or a natural token expiry. The
    // redirect grants no session and reveals nothing about whether the account exists, and the
    // locale follows the persisted i18n cookie.
    const locale = getCookie(event, 'i18n_redirected')
    return sendRedirect(event, `${locale === 'en' ? '/signup' : '/inscription'}?expired=1`, 302)
  }

  // Mark the token as used immediately to prevent replay attacks.
  await db.update(magicLinkTokens).set({ used: true }).where(eq(magicLinkTokens.token, token))

  // Find or create the user row for this email.
  let user = await db.select().from(users).where(eq(users.email, record.email)).get()
  if (!user) {
    const [created] = await db.insert(users).values({ email: record.email }).returning()
    user = created
  }

  // A magic link cannot grant a session once the account has a password. This keeps a leaked or
  // replayed link inert after onboarding. Send them to sign in with their password instead.
  if (user!.passwordHash) {
    return sendRedirect(event, '/')
  }

  // Load the persisted preferences so the session and the client cookies carry them
  // from the first render. A brand-new user has no settings row yet, so this returns
  // the coded defaults until onboarding creates the row.
  const preferences = await loadUserPreferences(user!.id)

  // Set the session cookie so subsequent requests are authenticated.
  await setUserSession(event, {
    user: {
      id: user!.id,
      email: user!.email,
      firstName: user!.firstName,
      lastName: user!.lastName,
      onboarded: !!user!.passwordHash,
      role: user!.role,
      lightTheme: preferences.lightTheme,
      darkTheme: preferences.darkTheme,
      locale: preferences.locale
    }
  })

  // Mirror the preferences into the client-readable cookies the no-flash guard reads.
  applyPreferenceCookies(event, preferences)

  return sendRedirect(event, '/')
}
