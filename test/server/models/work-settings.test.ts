import {
  dailyWorkMinutesSchema,
  isValidTimezone,
  quotaWphSchema,
  timezoneSchema,
  workDaysSchema,
  WorkSettingsPatchSchema
} from '~~/server/models/work-settings'
import { describe, expect, it } from 'vitest'

// The work-field validators and WorkSettingsPatchSchema are the validation boundary for
// PATCH /api/me/work-settings. Every bound, message, and rule below is derived from
// docs/specs/settings/settings-page.md (the "Shared validator extraction", the "PATCH
// /api/me/work-settings" contract, and acceptance criteria 5, 6, 7, 8, 21), not from the
// implementation. The spec fixes: dailyWorkMinutes int 1-1440, quotaWph int 1-10000 (the column is
// quota_wph, default 450), workDays an array of ints 0-6 with no duplicates and max length 7 (empty
// array explicitly allowed), timezone a valid IANA zone, every field optional (partial PATCH), and
// a .refine rejecting an empty object. A drift from any of these fails here.

describe('dailyWorkMinutesSchema (int 1-1440)', () => {
  it('accepts the lower boundary of 1', () => {
    expect(dailyWorkMinutesSchema.safeParse(1).success).toBe(true)
  })

  it('accepts the upper boundary of 1440', () => {
    expect(dailyWorkMinutesSchema.safeParse(1440).success).toBe(true)
  })

  it('rejects 0 which is below the minimum', () => {
    expect(dailyWorkMinutesSchema.safeParse(0).success).toBe(false)
  })

  it('rejects 1441 which is above the maximum', () => {
    expect(dailyWorkMinutesSchema.safeParse(1441).success).toBe(false)
  })

  it('rejects a non-integer value', () => {
    expect(dailyWorkMinutesSchema.safeParse(90.5).success).toBe(false)
  })
})

describe('quotaWphSchema (int 1-10000)', () => {
  it('accepts the lower boundary of 1', () => {
    expect(quotaWphSchema.safeParse(1).success).toBe(true)
  })

  // The column default is 450; it must be a valid quota.
  it('accepts the default value of 450', () => {
    expect(quotaWphSchema.safeParse(450).success).toBe(true)
  })

  it('accepts the upper boundary of 10000', () => {
    expect(quotaWphSchema.safeParse(10000).success).toBe(true)
  })

  it('rejects 0 which is below the minimum', () => {
    expect(quotaWphSchema.safeParse(0).success).toBe(false)
  })

  it('rejects 10001 which is above the maximum', () => {
    expect(quotaWphSchema.safeParse(10001).success).toBe(false)
  })

  it('rejects a non-integer value', () => {
    expect(quotaWphSchema.safeParse(450.25).success).toBe(false)
  })
})

describe('workDaysSchema (array of ints 0-6, no duplicates, max 7, empty allowed)', () => {
  it('accepts an in-range unique array', () => {
    expect(workDaysSchema.safeParse([1, 2, 3, 4, 5]).success).toBe(true)
  })

  // Spec AC6: an empty selection is allowed and persists as []. The app records reality and does
  // not force a schedule, so [] must pass on its own.
  it('accepts the empty array', () => {
    expect(workDaysSchema.safeParse([]).success).toBe(true)
  })

  it('accepts the full week of all seven distinct days', () => {
    expect(workDaysSchema.safeParse([0, 1, 2, 3, 4, 5, 6]).success).toBe(true)
  })

  it('rejects a weekday below 0', () => {
    expect(workDaysSchema.safeParse([-1, 2]).success).toBe(false)
  })

  it('rejects a weekday above 6', () => {
    expect(workDaysSchema.safeParse([5, 7]).success).toBe(false)
  })

  it('rejects a non-integer weekday', () => {
    expect(workDaysSchema.safeParse([1, 2.5]).success).toBe(false)
  })

  it('rejects a duplicate weekday with the contract message', () => {
    const result = workDaysSchema.safeParse([1, 1, 2])
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Work days must not contain duplicates.')
  })

  it('rejects more than seven entries', () => {
    expect(workDaysSchema.safeParse([0, 1, 2, 3, 4, 5, 6, 0]).success).toBe(false)
  })
})

// isValidTimezone underpins timezoneSchema. On this Node runtime Intl.supportedValuesOf exists, so
// validation is against the runtime's own IANA list and cannot drift from what the platform accepts.
describe('isValidTimezone', () => {
  it('accepts a real IANA zone', () => {
    expect(isValidTimezone('America/Toronto')).toBe(true)
  })

  it('accepts another real IANA zone', () => {
    expect(isValidTimezone('Europe/Paris')).toBe(true)
  })

  it('rejects a made-up zone', () => {
    expect(isValidTimezone('Not/AZone')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidTimezone('')).toBe(false)
  })
})

describe('timezoneSchema (valid IANA zone)', () => {
  it('accepts a valid IANA zone', () => {
    expect(timezoneSchema.safeParse('America/Toronto').success).toBe(true)
  })

  it('rejects an invalid timezone string with the contract message', () => {
    const result = timezoneSchema.safeParse('Not/AZone')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Timezone must be a valid IANA zone.')
  })
})

describe('WorkSettingsPatchSchema', () => {
  describe('per-field bounds are enforced through the partial schema', () => {
    it('rejects an out-of-range dailyWorkMinutes', () => {
      expect(WorkSettingsPatchSchema.safeParse({ dailyWorkMinutes: 0 }).success).toBe(false)
    })

    it('rejects an out-of-range quotaWph', () => {
      expect(WorkSettingsPatchSchema.safeParse({ quotaWph: 10001 }).success).toBe(false)
    })

    it('rejects a duplicate weekday', () => {
      expect(WorkSettingsPatchSchema.safeParse({ workDays: [1, 1, 2] }).success).toBe(false)
    })

    it('rejects an invalid timezone', () => {
      expect(WorkSettingsPatchSchema.safeParse({ timezone: 'Not/AZone' }).success).toBe(false)
    })

    // Empty workDays is allowed and is a valid non-empty body (the field is present).
    it('accepts an empty workDays selection as a valid body', () => {
      expect(WorkSettingsPatchSchema.safeParse({ workDays: [] }).success).toBe(true)
    })
  })

  describe('partial PATCH and the empty-body refine', () => {
    // The spec requires the whole schema to reject an empty object via the .refine, with a
    // stable message the client maps to a localized error.
    it('rejects an empty object through the refine', () => {
      const result = WorkSettingsPatchSchema.safeParse({})

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('At least one work setting must be provided.')
    })

    it('rejects a body whose only fields are explicitly undefined', () => {
      const result = WorkSettingsPatchSchema.safeParse({
        dailyWorkMinutes: undefined,
        workDays: undefined,
        quotaWph: undefined,
        timezone: undefined
      })

      expect(result.success).toBe(false)
    })

    // Each field on its own is a valid non-empty subset: the PATCH is partial, so any single
    // field must parse. This exercises the refine's "at least one defined" branch per field.
    it.each([
      ['dailyWorkMinutes', { dailyWorkMinutes: 450 }],
      ['workDays', { workDays: [1, 2, 3] }],
      ['quotaWph', { quotaWph: 450 }],
      ['timezone', { timezone: 'America/Toronto' }]
    ] as const)('accepts a body with only %s set', (_label, body) => {
      expect(WorkSettingsPatchSchema.safeParse(body).success).toBe(true)
    })

    it('accepts a multi-field subset', () => {
      const body = { dailyWorkMinutes: 420, quotaWph: 500 }
      const result = WorkSettingsPatchSchema.safeParse(body)

      expect(result.success).toBe(true)
      expect(result.data).toEqual(body)
    })
  })
})
