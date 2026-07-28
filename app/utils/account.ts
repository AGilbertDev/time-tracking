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

// How many characters of name the identity block fits on one line. The popover content is 16rem
// (w-64, 256px) less the block's own 8px of padding either side, so about 240px, and a name is
// text-sm, where an average character advances roughly 7px. That is a deliberately rough budget
// rather than a measurement: a long name is a rare case, and a character count is pure, correct
// during SSR, and needs no layout read, where measuring would flash the full name before shrinking
// it. The `truncate` class stays on the name as the final safety net for a name that defeats even
// the shortest form.
export const ACCOUNT_NAME_MAX_CHARS = 32

// One name segment reduced to its initial and a period. Returns an empty string for an empty
// segment so a stray separator cannot produce a lone period.
function initialOf(segment: string): string {
  const first = Array.from(segment)[0]
  return first ? `${first.toLocaleUpperCase()}.` : ''
}

// One name part (a whole first name or a whole last name) abbreviated to initials, keeping whatever
// joined its segments, which is how a compound name is abbreviated in French: Marie-Hélène becomes
// M.-H. and Jean Paul becomes J. P. Splitting on a capturing group leaves the separators at the odd
// indices, so they survive the rebuild instead of being guessed at.
function abbreviatePart(part: string): string {
  return part
    .trim()
    .split(/([-\s]+)/)
    .map((chunk, index) => (index % 2 === 0 ? initialOf(chunk) : chunk.replace(/\s+/g, ' ')))
    .join('')
}

// The display name for the identity block, shortened only as far as it has to be to fit `maxChars`.
// It steps down through three forms and returns the first that fits: the full name, then the first
// name reduced to initials (`A. Gilbert`, `M.-H. Cochet`), then both names reduced (`A.-B. C.-D.`).
// A name with only one part is never reduced, because an initial with nothing beside it identifies
// no one; it keeps its full form and lets truncation handle it. The shortest form is returned even
// when it still exceeds the budget, so the function always yields the most readable name available
// rather than failing.
export function fitAccountName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  maxChars: number
): string {
  const first = firstName?.trim() ?? ''
  const last = lastName?.trim() ?? ''

  const full = accountName(first, last)
  if (full.length <= maxChars) return full
  if (!first || !last) return full

  const firstAbbreviated = `${abbreviatePart(first)} ${last}`
  if (firstAbbreviated.length <= maxChars) return firstAbbreviated

  return `${abbreviatePart(first)} ${abbreviatePart(last)}`
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
