import { CompleteOnboardingSchema } from '~~/server/models/onboarding'
import { describe, expect, it } from 'vitest'

import { LOCALES, THEME_IDS } from '#shared/theme'

// CompleteOnboardingSchema is the single validation boundary for POST /api/onboarding/complete.
// Per the onboarding-wizard spec (AC9 and the Edge cases section), one Finish submit carries
// identity, appearance, and work settings in one body, and this schema rejects anything a
// crafted request or client bug could send outside the documented bounds. These tests are
// derived from the spec's acceptance criteria, not from the implementation: the expected
// bounds, allowed sets, and duplicate/timezone contracts come from the spec.

// A full valid payload as the happy path describes it: the schema-default appearance and work
// values a user who touched nothing on steps 2 and 3 would submit. Individual tests clone this
// and override one field so a single invalid value is what fails, never an unrelated one.
const validPayload = {
  firstName: 'Alexandre',
  lastName: 'Gilbert',
  password: 'correct horse battery',
  lightTheme: 'pastel',
  darkTheme: 'pastel',
  locale: 'fr',
  dailyWorkMinutes: 450,
  workDays: [1, 2, 3, 4, 5],
  timezone: 'America/Toronto'
} as const

// Builds a payload from the valid base with the given overrides applied.
function payload(overrides: Record<string, unknown> = {}) {
  return { ...validPayload, ...overrides }
}

describe('CompleteOnboardingSchema', () => {
  describe('valid full payload', () => {
    // The all-defaults completion edge case: untouched steps 2 and 3 submit the schema-default
    // values and the whole body parses.
    it('accepts a full payload with all appearance and work fields', () => {
      const result = CompleteOnboardingSchema.safeParse(validPayload)

      expect(result.success).toBe(true)
      expect(result.data).toEqual(validPayload)
    })
  })

  describe('identity fields (unchanged behaviour)', () => {
    it('rejects an empty firstName', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ firstName: '' })).success).toBe(false)
    })

    it('rejects a whitespace-only firstName because it trims to empty', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ firstName: '   ' })).success).toBe(false)
    })

    it('rejects an empty lastName', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ lastName: '' })).success).toBe(false)
    })

    it('rejects a firstName longer than 100 characters', () => {
      expect(
        CompleteOnboardingSchema.safeParse(payload({ firstName: 'a'.repeat(101) })).success
      ).toBe(false)
    })

    it('trims surrounding whitespace on the name fields', () => {
      const result = CompleteOnboardingSchema.safeParse(payload({ firstName: '  Alex  ' }))

      expect(result.success).toBe(true)
      expect(result.data?.firstName).toBe('Alex')
    })

    // NIST 8-character floor, no composition rules.
    it('rejects a password shorter than 8 characters', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ password: 'short7!' })).success).toBe(
        false
      )
    })

    it('accepts a password of exactly 8 characters', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ password: 'a'.repeat(8) })).success).toBe(
        true
      )
    })

    it('rejects a password longer than 200 characters', () => {
      expect(
        CompleteOnboardingSchema.safeParse(payload({ password: 'a'.repeat(201) })).success
      ).toBe(false)
    })
  })

  describe('appearance fields reuse the shared contracts', () => {
    it.each(THEME_IDS)('accepts the shared theme id %s as lightTheme', (id) => {
      expect(CompleteOnboardingSchema.safeParse(payload({ lightTheme: id })).success).toBe(true)
    })

    it.each(THEME_IDS)('accepts the shared theme id %s as darkTheme', (id) => {
      expect(CompleteOnboardingSchema.safeParse(payload({ darkTheme: id })).success).toBe(true)
    })

    it('rejects an unknown lightTheme id', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ lightTheme: 'neon' })).success).toBe(
        false
      )
    })

    it('rejects an unknown darkTheme id', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ darkTheme: 'ember' })).success).toBe(
        false
      )
    })

    it.each(LOCALES)('accepts the supported locale %s', (locale) => {
      expect(CompleteOnboardingSchema.safeParse(payload({ locale })).success).toBe(true)
    })

    it('rejects a locale outside fr and en', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ locale: 'de' })).success).toBe(false)
    })
  })

  describe('dailyWorkMinutes bounds', () => {
    it('accepts the default of 450', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: 450 })).success).toBe(
        true
      )
    })

    it('accepts the lower boundary of 1', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: 1 })).success).toBe(
        true
      )
    })

    it('accepts the upper boundary of 1440', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: 1440 })).success).toBe(
        true
      )
    })

    it('rejects 0 which is below the minimum', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: 0 })).success).toBe(
        false
      )
    })

    it('rejects a negative value', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: -30 })).success).toBe(
        false
      )
    })

    it('rejects a value above 1440', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: 1441 })).success).toBe(
        false
      )
    })

    it('rejects a non-integer value', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: 90.5 })).success).toBe(
        false
      )
    })
  })

  describe('workDays', () => {
    it('accepts the default Monday to Friday set', () => {
      expect(
        CompleteOnboardingSchema.safeParse(payload({ workDays: [1, 2, 3, 4, 5] })).success
      ).toBe(true)
    })

    // The empty-array edge case: a user who works no fixed days can store [].
    it('accepts an empty array', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ workDays: [] })).success).toBe(true)
    })

    it('accepts the full week of all seven distinct days', () => {
      expect(
        CompleteOnboardingSchema.safeParse(payload({ workDays: [0, 1, 2, 3, 4, 5, 6] })).success
      ).toBe(true)
    })

    it('rejects a day number below 0', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ workDays: [-1, 2] })).success).toBe(false)
    })

    it('rejects a day number above 6', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ workDays: [5, 7] })).success).toBe(false)
    })

    it('rejects a non-integer day number', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ workDays: [1, 2.5] })).success).toBe(
        false
      )
    })

    // The schema's documented contract on duplicates is to reject them (the refine requires the
    // set size to equal the array length), so the stored JSON holds each day at most once.
    it('rejects duplicate day numbers', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ workDays: [1, 1, 2] })).success).toBe(
        false
      )
    })

    // Length is capped at 7. An eight-entry array is over the cap regardless of its values.
    it('rejects an array longer than 7', () => {
      expect(
        CompleteOnboardingSchema.safeParse(payload({ workDays: [0, 1, 2, 3, 4, 5, 6, 0] })).success
      ).toBe(false)
    })
  })

  describe('timezone', () => {
    it('accepts America/Toronto, the default zone', () => {
      expect(
        CompleteOnboardingSchema.safeParse(payload({ timezone: 'America/Toronto' })).success
      ).toBe(true)
    })

    it('accepts another valid IANA zone', () => {
      expect(
        CompleteOnboardingSchema.safeParse(payload({ timezone: 'Europe/Paris' })).success
      ).toBe(true)
    })

    it('rejects an Area/Location-shaped string that is not a real zone', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ timezone: 'Not/AZone' })).success).toBe(
        false
      )
    })

    it('rejects a string with no Area/Location shape at all', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ timezone: 'foobar' })).success).toBe(
        false
      )
    })

    it('rejects an empty timezone string', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ timezone: '' })).success).toBe(false)
    })
  })

  describe('missing and mistyped fields', () => {
    it('rejects a body missing the work fields entirely', () => {
      const result = CompleteOnboardingSchema.safeParse({
        firstName: 'Alex',
        lastName: 'Gilbert',
        password: 'correct horse battery'
      })

      expect(result.success).toBe(false)
    })

    it('rejects a string dailyWorkMinutes rather than coercing it', () => {
      expect(CompleteOnboardingSchema.safeParse(payload({ dailyWorkMinutes: '450' })).success).toBe(
        false
      )
    })
  })
})
