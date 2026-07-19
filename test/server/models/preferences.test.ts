import { PreferencesPatchSchema } from '~~/server/models/preferences'
import { describe, expect, it } from 'vitest'

import { LOCALES, THEME_IDS } from '#shared/theme'

// PreferencesPatchSchema is the validation boundary for PATCH /api/me/preferences.
// Per the theme-system-redesign spec, both theme fields now validate against the five
// redesigned ids (F1/F2: two independent columns, same five-id namespace), so a body
// carrying a removed atmosphere must be rejected here. These tests lock the partial-body
// contract, the enum guards on the new set, and the non-empty refine.

// Removed atmospheres from the old eight-theme world. The schema must reject each now.
const REMOVED_THEME_IDS = ['ember', 'onyx', 'coffee', 'forest', 'autumn', 'berry', 'frost']

describe('PreferencesPatchSchema', () => {
  describe('valid partial bodies', () => {
    it('accepts a lightTheme field on its own', () => {
      const result = PreferencesPatchSchema.safeParse({ lightTheme: 'encre' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ lightTheme: 'encre' })
    })

    it('accepts a darkTheme field on its own', () => {
      const result = PreferencesPatchSchema.safeParse({ darkTheme: 'foret' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ darkTheme: 'foret' })
    })

    it('accepts a locale field on its own', () => {
      const result = PreferencesPatchSchema.safeParse({ locale: 'en' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ locale: 'en' })
    })

    // Mixed light/dark selection is an explicit spec edge case: the two columns are
    // independent, so a body may pair one theme's light with another's dark.
    it('accepts all three fields together with a mixed light/dark theme pair', () => {
      const body = { lightTheme: 'encre', darkTheme: 'foret', locale: 'fr' }
      const result = PreferencesPatchSchema.safeParse(body)

      expect(result.success).toBe(true)
      expect(result.data).toEqual(body)
    })

    it.each(THEME_IDS)('accepts the redesigned id %s as lightTheme', (id) => {
      expect(PreferencesPatchSchema.safeParse({ lightTheme: id }).success).toBe(true)
    })

    it.each(THEME_IDS)('accepts the redesigned id %s as darkTheme', (id) => {
      expect(PreferencesPatchSchema.safeParse({ darkTheme: id }).success).toBe(true)
    })

    it.each(LOCALES)('accepts the supported locale %s', (locale) => {
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
    // Every removed atmosphere id must now fail the enum on either theme column.
    it.each(REMOVED_THEME_IDS)('rejects the removed atmosphere %s as lightTheme', (removed) => {
      expect(PreferencesPatchSchema.safeParse({ lightTheme: removed }).success).toBe(false)
    })

    it.each(REMOVED_THEME_IDS)('rejects the removed atmosphere %s as darkTheme', (removed) => {
      expect(PreferencesPatchSchema.safeParse({ darkTheme: removed }).success).toBe(false)
    })

    it('rejects a theme id that was never in any set', () => {
      expect(PreferencesPatchSchema.safeParse({ lightTheme: 'neon' }).success).toBe(false)
    })

    it('rejects a locale outside fr and en', () => {
      expect(PreferencesPatchSchema.safeParse({ locale: 'de' }).success).toBe(false)
    })

    it('rejects a non-string theme id', () => {
      expect(PreferencesPatchSchema.safeParse({ lightTheme: 42 }).success).toBe(false)
    })
  })

  describe('unknown keys', () => {
    // The schema is a plain z.object, not .strict(), so an unknown key is stripped as long
    // as at least one known field is present. This documents the real behaviour rather than
    // asserting a strictness the schema does not implement.
    it('strips an unknown key and keeps the known field', () => {
      const result = PreferencesPatchSchema.safeParse({ lightTheme: 'encre', bogus: 'x' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ lightTheme: 'encre' })
    })

    it('rejects a body of only unknown keys because no known field is present', () => {
      expect(PreferencesPatchSchema.safeParse({ bogus: 'x' }).success).toBe(false)
    })
  })
})
