import { z } from 'zod'

import { DEFAULT_LOCALE, LOCALES } from '#shared/theme'

export const RequestSchema = z.object({
  // Normalize before validating (trim, lowercase, then check the email format) so the allowlist
  // key written by the admin invite and the key this signup lookup reads always match. SQLite
  // text comparison is case-sensitive, so a mixed-case address would otherwise diverge from the
  // lowercased allowlist entry and hit the neutral no-send path, leaving the invitee unable to
  // sign up. Matches the emailSchema style in server/models/admin.ts.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // Sent by the signup form as its active UI locale so the magic-link email arrives in that
  // language. It falls back to the default only if a caller omits it, and uses the shared LOCALES
  // contract so the accepted set cannot drift from the rest of the app.
  locale: z.enum(LOCALES).default(DEFAULT_LOCALE)
})

export const VerifySchema = z.object({
  token: z.uuid()
})
