import type { H3Event } from 'h3'

import type { UserPreferences } from './loadUserPreferences'

import { DAY_IN_SECONDS } from './constants/time'

const ONE_YEAR_IN_SECONDS = 365 * DAY_IN_SECONDS

// Mirrors the persisted locale into the cookie @nuxtjs/i18n reads server-side, so the module
// renders the correct language on first paint. The theme is no longer mirrored to cookies: the
// pre-paint guard now reads the atmosphere ids that SSR injects into the HTML from the session,
// which removed the flash a stale or missing theme cookie used to cause. Called at every
// session-creation site and by the preferences write endpoint so the locale cookie stays fresh.
export function applyPreferenceCookies(event: H3Event, prefs: UserPreferences): void {
  // The locale mirror is the cookie @nuxtjs/i18n already reads through detectBrowserLanguage,
  // so the module resolves the persisted locale on the first request. Written with the module's
  // own attributes rather than httpOnly.
  setCookie(event, 'i18n_redirected', prefs.locale, {
    path: '/',
    maxAge: ONE_YEAR_IN_SECONDS
  })
}
