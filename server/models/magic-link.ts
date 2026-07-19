import { z } from 'zod'

import { DEFAULT_LOCALE, LOCALES } from '#shared/theme'

export const RequestSchema = z.object({
  email: z.email(),
  // Sent by the signup form as its active UI locale so the magic-link email arrives in that
  // language. It falls back to the default only if a caller omits it, and uses the shared LOCALES
  // contract so the accepted set cannot drift from the rest of the app.
  locale: z.enum(LOCALES).default(DEFAULT_LOCALE)
})

export const VerifySchema = z.object({
  token: z.uuid()
})
