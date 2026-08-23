import { z } from 'zod'

import { LOCALES, THEME_IDS } from '#shared/theme'

import { PasswordSchema } from './password'
import { nameFieldSchema } from './profile'
import { dailyWorkMinutesSchema, timezoneSchema, workDaysSchema } from './work-settings'

// The onboarding wizard persists identity, appearance, and work settings atomically on the
// single Finish submit. Every field validator is imported from the shared model that owns it,
// so the identity bounds, the password policy, and the work ranges live in one place and cannot
// drift between onboarding and the profile and settings pages. Theme and locale reuse the shared
// THEME_IDS and LOCALES contracts so their allowed values cannot drift from what the client
// offers or the read path returns.
export const CompleteOnboardingSchema = z.object({
  firstName: nameFieldSchema,
  lastName: nameFieldSchema,
  password: PasswordSchema,
  // Appearance preferences. Each maps to a settings column and falls back to the schema
  // default when the wizard sends the pre-populated value.
  lightTheme: z.enum(THEME_IDS),
  darkTheme: z.enum(THEME_IDS),
  locale: z.enum(LOCALES),
  // Work settings, from the shared work-field validators. The wizard asks no quota, because a quota
  // is per category now and four numbers before the user has seen a single task is a worse first run
  // than four sensible defaults they can change on the settings page whenever they like.
  dailyWorkMinutes: dailyWorkMinutesSchema,
  workDays: workDaysSchema,
  timezone: timezoneSchema
})
