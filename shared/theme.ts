// Canonical preference ids shared by the client and the server. Nuxt 4 auto-imports
// everything under shared/ into both the app and the Nitro server, so this is the one
// place theme ids and locales are declared and both sides validate against the same list.

// The eight atmosphere ids. These mirror the palettes defined in app/composables/useTheme.ts.
// useTheme owns the palettes and display names, but its themeOptions must reference this
// list so the ids cannot drift from what the server validates.
export const THEME_IDS = [
  'pastel',
  'ember',
  'onyx',
  'coffee',
  'forest',
  'autumn',
  'berry',
  'frost'
] as const

export type ThemeId = (typeof THEME_IDS)[number]

// The default atmosphere. Matches DEFAULT_THEME in useTheme.ts and the settings column defaults.
export const DEFAULT_THEME_ID: ThemeId = 'pastel'

// The supported interface locales.
export const LOCALES = ['fr', 'en'] as const

export type Locale = (typeof LOCALES)[number]

// The default locale. Matches the i18n defaultLocale and the settings.locale column default.
export const DEFAULT_LOCALE: Locale = 'fr'

// Narrows an arbitrary stored value to a known theme id, falling back to the default when it
// is not one of THEME_IDS. The theme columns are free text at the database level, so a value
// left over from a renamed or removed atmosphere must resolve to the default rather than reach
// <html data-theme> as an id with no matching CSS. Pure and DB-free so it is unit-testable.
export function coerceThemeId(value: unknown): ThemeId {
  return (THEME_IDS as readonly string[]).includes(value as string)
    ? (value as ThemeId)
    : DEFAULT_THEME_ID
}

// Narrows an arbitrary stored value to a supported locale, falling back to the default when it
// is outside LOCALES. Mirrors coerceThemeId for the same free-text-column reason.
export function coerceLocale(value: unknown): Locale {
  return (LOCALES as readonly string[]).includes(value as string)
    ? (value as Locale)
    : DEFAULT_LOCALE
}
