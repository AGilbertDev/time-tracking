import { PreferencesPatchSchema } from '~~/server/models/preferences'
import { describe, expect, it } from 'vitest'

import { LOCALES, THEME_IDS } from '#shared/theme'

// The schema is the validation boundary for PATCH /api/me/preferences. These tests
// lock the partial-body contract, the enum guards, and the non-empty refine so a
// regression in any branch is caught before it reaches the write handler.
describe('PreferencesPatchSchema', () => {
  describe('valid partial bodies', () => {
    it('accepts a lightTheme field on its own', () => {
      const result = PreferencesPatchSchema.safeParse({ lightTheme: 'ember' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ lightTheme: 'ember' })
    })

    it('accepts a darkTheme field on its own', () => {
      const result = PreferencesPatchSchema.safeParse({ darkTheme: 'onyx' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ darkTheme: 'onyx' })
    })

    it('accepts a locale field on its own', () => {
      const result = PreferencesPatchSchema.safeParse({ locale: 'en' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ locale: 'en' })
    })

    it('accepts all three fields together', () => {
      const body = { lightTheme: 'frost', darkTheme: 'coffee', locale: 'fr' }
      const result = PreferencesPatchSchema.safeParse(body)

      expect(result.success).toBe(true)
      expect(result.data).toEqual(body)
    })

    it.each(THEME_IDS)('accepts every known theme id %s as lightTheme', (id) => {
      expect(PreferencesPatchSchema.safeParse({ lightTheme: id }).success).toBe(true)
    })

    it.each(LOCALES)('accepts every supported locale %s', (locale) => {
      expect(PreferencesPatchSchema.safeParse({ locale }).success).toBe(true)
    })
  })

  describe('empty body', () => {
    it('rejects an empty object through the refine', () => {
      const result = PreferencesPatchSchema.safeParse({})

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('At least one preference must be provided.')
    })

    it('rejects a body whose only fields are explicitly undefined', () => {
      const result = PreferencesPatchSchema.safeParse({
        lightTheme: undefined,
        darkTheme: undefined,
        locale: undefined
      })

      expect(result.success).toBe(false)
    })
  })

  describe('invalid values', () => {
    it('rejects a theme id that is not in THEME_IDS', () => {
      const result = PreferencesPatchSchema.safeParse({ lightTheme: 'neon' })

      expect(result.success).toBe(false)
    })

    it('rejects a darkTheme id that is not in THEME_IDS', () => {
      expect(PreferencesPatchSchema.safeParse({ darkTheme: 'sunset' }).success).toBe(false)
    })

    it('rejects a locale outside fr and en', () => {
      const result = PreferencesPatchSchema.safeParse({ locale: 'de' })

      expect(result.success).toBe(false)
    })

    it('rejects a non-string theme id', () => {
      expect(PreferencesPatchSchema.safeParse({ lightTheme: 42 }).success).toBe(false)
    })
  })

  describe('unknown keys', () => {
    // The schema is a plain z.object, not .strict(), so an unknown key is stripped
    // rather than rejected as long as at least one known field is present. This test
    // documents that real behaviour rather than asserting a strictness the schema
    // does not implement.
    it('strips an unknown key and keeps the known field', () => {
      const result = PreferencesPatchSchema.safeParse({ lightTheme: 'ember', bogus: 'x' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ lightTheme: 'ember' })
    })

    it('rejects a body of only unknown keys because no known field is present', () => {
      const result = PreferencesPatchSchema.safeParse({ bogus: 'x' })

      expect(result.success).toBe(false)
    })
  })
})
