import { z } from 'zod'

import { LOCALES, THEME_IDS } from '#shared/theme'

// Partial PATCH body for /api/me/preferences. Every field is optional so the client
// sends only what changed, and the refine rejects an empty object so a client bug cannot
// send a meaningless write. An unknown theme id or a locale outside fr/en fails the enum
// and returns a 422 through sendZodError.
export const PreferencesPatchSchema = z
  .object({
    lightTheme: z.enum(THEME_IDS).optional(),
    darkTheme: z.enum(THEME_IDS).optional(),
    locale: z.enum(LOCALES).optional()
  })
  .refine(
    (body) =>
      body.lightTheme !== undefined || body.darkTheme !== undefined || body.locale !== undefined,
    { message: 'At least one preference must be provided.' }
  )

export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>
