import type { Locale } from '#shared/theme'

// Pure derivations for the account menu popover in app/components/app/header.vue.
// They live here as framework-free functions rather than inline in the SFC so each
// branch is unit-testable without mounting the component or booting a Nuxt runtime.
// This mirrors how shared/theme.ts keeps its coercers pure for the same reason.

// Builds the avatar initials from the first and last name. It uppercases the pair,
// yields a single initial when only one name is set, and returns an empty string
// when neither is set so the avatar never renders a stray "null".
export function accountInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.[0] ?? ''
  const last = lastName?.[0] ?? ''
  return (first + last).toUpperCase()
}

// Joins the first and last name into a display name and trims it, so a missing part
// leaves no stray space and a fully empty name resolves to an empty string.
export function accountName(firstName?: string | null, lastName?: string | null): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim()
}

// The admin gate for the Manage users item. It matches an exact 'admin' role, so any
// other value fails closed, including an undefined role on a session minted before the
// role field shipped.
export function isAdmin(role?: string | null): boolean {
  return role === 'admin'
}

// The trigger button's accessible name. The display name is friendliest, but it is
// empty before onboarding, so the label falls back to the email and finally to a
// static account label so the button always has an accessible name.
export function triggerLabel(
  name: string,
  email: string | null | undefined,
  fallback: string
): string {
  return name || email || fallback
}

// The localized link-ahead paths for the account menu navigation. These mirror the
// nuxt.config i18n pages map. useLocalePath cannot resolve a pages-map key until the
// destination page file exists, so the paths are held here and selected by locale.
export const NAV_ROUTES = {
  profile: { fr: '/profil', en: '/profile' },
  settings: { fr: '/parametres', en: '/settings' },
  'admin-users': { fr: '/utilisateurs', en: '/users' }
} as const

export type NavRouteKey = keyof typeof NAV_ROUTES

// Picks the path for the active locale. It returns the fr path for fr and the en path
// for every other supported locale, matching the two-locale set.
export function navPath(key: NavRouteKey, locale: Locale): string {
  return locale === 'fr' ? NAV_ROUTES[key].fr : NAV_ROUTES[key].en
}

// The locale the language toggle switches to, the opposite of the active one.
export function oppositeLocale(locale: Locale): Locale {
  return locale === 'fr' ? 'en' : 'fr'
}
