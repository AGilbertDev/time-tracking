import { z } from 'zod'

// A conservative IANA zone shape used only when the runtime cannot enumerate its own
// timezone list. It matches an Area/Location identifier such as America/Toronto or
// Europe/Paris, including the multi-segment forms like America/Argentina/Ushuaia.
const IANA_TIMEZONE_PATTERN = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/

// Validates a timezone against the runtime's own IANA list when Intl.supportedValuesOf is
// available, which cannot drift from what the platform accepts. Falls back to the Area/Location
// pattern only on a runtime that lacks that API, so a legitimate zone is never rejected there.
export function isValidTimezone(value: string): boolean {
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

// The per-user work-field validators, extracted so onboarding and the settings page share one source
// and the ranges cannot drift between them. The bounds are the onboarding ones, unchanged: minutes are
// a positive integer up to one full day, work days are day numbers 0 through 6 with no duplicates (an
// empty array is allowed because the app records reality and does not force a schedule), and the
// timezone is validated against the runtime's own IANA list when available.
export const dailyWorkMinutesSchema = z.number().int().min(1).max(1440)

// A words-per-hour figure, a generous upper limit with a floor of 1. It no longer validates a work
// setting of its own, since the global quota_wph column retired in migration 0011, and it stays here
// because two live boundaries reuse it. The per-task quota override on the task write schemas is one,
// and the per-category quota write in models/category-quotas.ts is the other. The floor of 1 is
// load-bearing on both, because the quota is the divisor in words over quota and a stored 0 would
// divide by zero the moment PLAN-12 reads it.
export const quotaWphSchema = z.number().int().min(1).max(10000)

export const workDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: 'Work days must not contain duplicates.'
  })

export const timezoneSchema = z
  .string()
  .refine(isValidTimezone, { message: 'Timezone must be a valid IANA zone.' })

// Partial PATCH body for /api/me/work-settings. Every field is optional so the client sends
// only what changed, each reusing the shared field validator, and the refine rejects an empty
// object so a client bug cannot send a meaningless write. Mirrors PreferencesPatchSchema.
export const WorkSettingsPatchSchema = z
  .object({
    dailyWorkMinutes: dailyWorkMinutesSchema.optional(),
    workDays: workDaysSchema.optional(),
    timezone: timezoneSchema.optional()
  })
  .refine(
    (body) =>
      body.dailyWorkMinutes !== undefined ||
      body.workDays !== undefined ||
      body.timezone !== undefined,
    { message: 'At least one work setting must be provided.' }
  )

export type WorkSettingsPatch = z.infer<typeof WorkSettingsPatchSchema>
