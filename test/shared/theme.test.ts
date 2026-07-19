import { describe, expect, it } from 'vitest'

import {
  coerceLocale,
  coerceThemeId,
  DEFAULT_LOCALE,
  DEFAULT_THEME_ID,
  LOCALES,
  THEME_IDS
} from '#shared/theme'

// The theme-system spec (docs/specs/appearance/theme-system.md)
// locks the theme set to exactly five subject-grounded ids and folds every removed
// atmosphere to the default at read time. These invariants back the server validation,
// the session types, and the no-flash guard, so section A of the spec is asserted here.

// The four ids that existed in the old eight-atmosphere world but are gone now. The spec
// (A1, A4, edge cases) requires each to be treated as invalid input, not a known theme.
const REMOVED_THEME_IDS = ['ember', 'onyx', 'coffee', 'forest', 'autumn', 'berry', 'frost']

describe('shared/theme', () => {
  // A1: THEME_IDS equals exactly the five ids in the locked contract order, no others.
  it('exposes exactly the five redesigned theme ids in the locked order', () => {
    expect(THEME_IDS).toEqual(['pastel', 'encre', 'cafe', 'automne', 'foret'])
  })

  // A1: none of the removed atmospheres survives in the set.
  it.each(REMOVED_THEME_IDS)('no longer contains the removed atmosphere %s', (removed) => {
    expect(THEME_IDS as readonly string[]).not.toContain(removed)
  })

  it('has no duplicate theme ids', () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length)
  })

  // A2: the default theme is pastel.
  it('defaults the theme to pastel', () => {
    expect(DEFAULT_THEME_ID).toBe('pastel')
  })

  it('keeps the default theme inside THEME_IDS', () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME_ID)
  })

  // A6: locales are unchanged by this feature.
  it('exposes exactly the fr and en locales', () => {
    expect(LOCALES).toEqual(['fr', 'en'])
  })

  // A6: the default locale is fr.
  it('defaults the locale to fr', () => {
    expect(DEFAULT_LOCALE).toBe('fr')
  })

  it('keeps the default locale inside LOCALES', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE)
  })
})

// A3 + A4: coerceThemeId is identity on the valid set and folds everything else to pastel.
describe('coerceThemeId', () => {
  // A3: identity on each of the five valid ids.
  it.each(THEME_IDS)('returns %s unchanged for the valid id', (id) => {
    expect(coerceThemeId(id)).toBe(id)
  })

  // A4: every removed atmosphere id resolves to the default. This is the "invalid stored
  // value falls back to the default" guarantee, so it is exercised id by id.
  it.each(REMOVED_THEME_IDS)('folds the removed atmosphere %s to pastel', (removed) => {
    expect(coerceThemeId(removed)).toBe('pastel')
  })

  it('returns the default pastel for an arbitrary unknown string', () => {
    expect(coerceThemeId('nope')).toBe('pastel')
  })

  it('returns the default pastel for the empty string', () => {
    expect(coerceThemeId('')).toBe('pastel')
  })

  it('returns the default pastel for null', () => {
    expect(coerceThemeId(null)).toBe('pastel')
  })

  it('returns the default pastel for undefined', () => {
    expect(coerceThemeId(undefined)).toBe('pastel')
  })

  it('returns the default pastel for a number', () => {
    expect(coerceThemeId(42)).toBe('pastel')
  })

  it('returns the default pastel for an object', () => {
    expect(coerceThemeId({ id: 'pastel' })).toBe('pastel')
  })

  // Cross-check against the documented default rather than the literal, so a default drift
  // is caught here too.
  it('uses DEFAULT_THEME_ID as the fallback value', () => {
    expect(coerceThemeId('anything-invalid')).toBe(DEFAULT_THEME_ID)
  })
})

// A5: coerceLocale is unchanged by this feature. Identity on fr/en, everything else to fr.
describe('coerceLocale', () => {
  it.each(LOCALES)('returns %s unchanged for the valid locale', (locale) => {
    expect(coerceLocale(locale)).toBe(locale)
  })

  it('returns the default fr for an unknown locale string', () => {
    expect(coerceLocale('de')).toBe('fr')
  })

  it('returns the default fr for the empty string', () => {
    expect(coerceLocale('')).toBe('fr')
  })

  it('returns the default fr for null', () => {
    expect(coerceLocale(null)).toBe('fr')
  })

  it('returns the default fr for undefined', () => {
    expect(coerceLocale(undefined)).toBe('fr')
  })

  it('uses DEFAULT_LOCALE as the fallback value', () => {
    expect(coerceLocale('anything-invalid')).toBe(DEFAULT_LOCALE)
  })
})
