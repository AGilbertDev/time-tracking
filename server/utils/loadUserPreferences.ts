import { eq } from 'drizzle-orm'

import type { Locale } from '#shared/theme'

import { coerceLocale, coerceThemeId, DEFAULT_LOCALE, DEFAULT_THEME_ID } from '#shared/theme'

import { useDb } from '../db/index'
import { settings } from '../db/schema'

export interface UserPreferences {
  darkTheme: string
  lightTheme: string
  locale: Locale
}

// Reads a user's persisted preferences from their settings row. Returns the coded
// defaults when no row exists yet, which covers the window between a magic-link
// sign-in and onboarding completion where the row has not been created. This is the
// single read path reused by the session-creation sites and both /api/me/preferences
// handlers so the fallback lives in one place.
export async function loadUserPreferences(userId: string): Promise<UserPreferences> {
  const db = useDb()

  const row = await db
    .select({
      lightTheme: settings.lightTheme,
      darkTheme: settings.darkTheme,
      locale: settings.locale
    })
    .from(settings)
    .where(eq(settings.userId, userId))
    .get()

  if (!row) {
    return { lightTheme: DEFAULT_THEME_ID, darkTheme: DEFAULT_THEME_ID, locale: DEFAULT_LOCALE }
  }

  // The theme and locale columns are free text at the database level, so narrow each stored
  // value back to a known id before it reaches the typed session and <html data-theme>. A
  // value left over from a renamed or removed atmosphere resolves to the default rather than
  // rendering a broken data-theme.
  return {
    lightTheme: coerceThemeId(row.lightTheme),
    darkTheme: coerceThemeId(row.darkTheme),
    locale: coerceLocale(row.locale)
  }
}
