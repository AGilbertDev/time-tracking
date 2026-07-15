import type { H3Event } from 'h3'

import type { UserPreferences } from './loadUserPreferences'

import { DAY_IN_SECONDS } from './constants/time'

const ONE_YEAR_IN_SECONDS = 365 * DAY_IN_SECONDS

// Mirrors the persisted preferences into client-readable cookies. The database is the
// authority, but the pre-paint no-flash guard in app/app.vue runs before Vue hydrates
// and cannot read the encrypted session cookie, so the resolved atmosphere has to live
// in plain cookies it can read. Writing these httpOnly would silently break the no-flash
// guarantee, so they are deliberately not httpOnly. Called at every session-creation
// site and by the preferences write endpoint so the guard never reads a stale value.
export function applyPreferenceCookies(event: H3Event, prefs: UserPreferences): void {
  // The two atmosphere cookies the noFlashTheme inline script reads. Names and attributes
  // match the client cookies written by useTheme so both sides agree.
  setCookie(event, 'ui-theme-light', prefs.lightTheme, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_IN_SECONDS
  })
  setCookie(event, 'ui-theme-dark', prefs.darkTheme, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_IN_SECONDS
  })

  // Mirror the locale to the cookie @nuxtjs/i18n already reads through
  // detectBrowserLanguage, so the module resolves the persisted locale on the first
  // request. Written with the module's own attributes rather than httpOnly.
  setCookie(event, 'i18n_redirected', prefs.locale, {
    path: '/',
    maxAge: ONE_YEAR_IN_SECONDS
  })
}
