import { z } from 'zod'

import { LOCALES, THEME_IDS } from '#shared/theme'

// A conservative IANA zone shape used only when the runtime cannot enumerate its own
// timezone list. It matches an Area/Location identifier such as America/Toronto or
// Europe/Paris, including the multi-segment forms like America/Argentina/Ushuaia.
const IANA_TIMEZONE_PATTERN = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/

// Validates a timezone against the runtime's own IANA list when Intl.supportedValuesOf is
// available, which cannot drift from what the platform accepts. Falls back to the Area/Location
// pattern only on a runtime that lacks that API, so a legitimate zone is never rejected there.
function isValidTimezone(value: string): boolean {
  const supportedValues = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[]
    }
  ).supportedValuesOf

  if (typeof supportedValues === 'function') {
    return supportedValues('timeZone').includes(value)
  }

  return IANA_TIMEZONE_PATTERN.test(value)
}

// Password policy per NIST SP 800-63B. An 8-character floor and a generous max,
// with no composition rules. Strength comes from length plus a breach check
// against Have I Been Pwned, handled in the onboarding handler.
//
// The appearance and work fields are the settings the wizard persists atomically on the
// single Finish submit. Theme and locale reuse the shared THEME_IDS and LOCALES contracts so
// their allowed values cannot drift from what the client offers or the read path returns.
export const CompleteOnboardingSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(200, 'Password is too long.'),
  // Appearance preferences. Each maps to a settings column and falls back to the schema
  // default when the wizard sends the pre-populated value.
  lightTheme: z.enum(THEME_IDS),
  darkTheme: z.enum(THEME_IDS),
  locale: z.enum(LOCALES),
  // Work settings. Minutes and quota are positive integers within sane bounds. The minutes
  // ceiling is one full day, and the quota ceiling is a generous upper limit for words per hour.
  dailyWorkMinutes: z.number().int().min(1).max(1440),
  quotaWph: z.number().int().min(1).max(10000),
  // Days of the week worked, as day numbers 0 through 6. An empty array is allowed because the
  // app records reality and does not force a schedule. Duplicate day numbers are rejected so the
  // stored JSON holds each day at most once.
  workDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine((days) => new Set(days).size === days.length, {
      message: 'Work days must not contain duplicates.'
    }),
  // The user's IANA timezone, validated against the runtime's own list when available.
  timezone: z.string().refine(isValidTimezone, { message: 'Timezone must be a valid IANA zone.' })
})
