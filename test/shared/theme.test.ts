import { describe, expect, it } from 'vitest'

import {
  coerceLocale,
  coerceThemeId,
  DEFAULT_LOCALE,
  DEFAULT_THEME_ID,
  LOCALES,
  THEME_IDS
} from '#shared/theme'

// These invariants are what the server validation and the session types rely on.
// Locking them here catches an accidental rename, a dropped id, or a default that
// drifts out of its own set before it reaches the schema or the no-flash guard.
describe('shared/theme', () => {
  it('exposes exactly the eight expected atmosphere ids in order', () => {
    expect(THEME_IDS).toEqual([
      'pastel',
      'ember',
      'onyx',
      'coffee',
      'forest',
      'autumn',
      'berry',
      'frost'
    ])
  })

  it('has no duplicate theme ids', () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length)
  })

  it('defaults the theme to a member of THEME_IDS', () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME_ID)
  })

  it('exposes exactly the fr and en locales', () => {
    expect(LOCALES).toEqual(['fr', 'en'])
  })

  it('defaults the locale to a member of LOCALES', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE)
  })
})

// The coercers guard the free-text theme and locale columns so a renamed, removed, or
// junk stored value resolves to the documented default rather than reaching the session
// and <html data-theme>. This is the read path's fallback that the no-flash guard relies on.
describe('coerceThemeId', () => {
  it('passes through every known theme id unchanged', () => {
    for (const id of THEME_IDS) {
      expect(coerceThemeId(id)).toBe(id)
    }
  })

  it('falls back to the default for an unknown id', () => {
    expect(coerceThemeId('sunset')).toBe(DEFAULT_THEME_ID)
  })

  it('falls back to the default for empty, null, and undefined values', () => {
    expect(coerceThemeId('')).toBe(DEFAULT_THEME_ID)
    expect(coerceThemeId(null)).toBe(DEFAULT_THEME_ID)
    expect(coerceThemeId(undefined)).toBe(DEFAULT_THEME_ID)
  })
})

describe('coerceLocale', () => {
  it('passes through every supported locale unchanged', () => {
    for (const locale of LOCALES) {
      expect(coerceLocale(locale)).toBe(locale)
    }
  })

  it('falls back to the default for an unsupported locale', () => {
    expect(coerceLocale('de')).toBe(DEFAULT_LOCALE)
  })

  it('falls back to the default for empty, null, and undefined values', () => {
    expect(coerceLocale('')).toBe(DEFAULT_LOCALE)
    expect(coerceLocale(null)).toBe(DEFAULT_LOCALE)
    expect(coerceLocale(undefined)).toBe(DEFAULT_LOCALE)
  })
})
