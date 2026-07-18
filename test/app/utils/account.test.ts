import {
  accountInitials,
  accountName,
  isAdmin,
  NAV_ROUTES,
  navPath,
  oppositeLocale,
  triggerLabel
} from '~~/app/utils/account'
import { describe, expect, it } from 'vitest'

import type { Locale } from '#shared/theme'

// These tests are derived from docs/specs/settings/profile-menu-popover.md, not from the
// current implementation. Each block cites the acceptance criterion or edge case it enforces.
// The unit under test is the pure account-menu logic; the popover component itself is out of
// scope here and is exercised by component or E2E tests, per the unit-test rules.

describe('isAdmin', () => {
  // Spec, "Navigation group" acceptance and the cross-cutting "Admin gate is data-driven":
  // Manage users appears if and only if user.value?.role === 'admin'. The edge-case section
  // makes it a strict, fail-closed check: "Any value that is not exactly 'admin' hides Manage
  // users" and a session with no role (undefined) "fails closed".

  it("returns true only for the exact 'admin' role", () => {
    expect(isAdmin('admin')).toBe(true)
  })

  it("returns false for the ordinary 'user' role", () => {
    // Spec backend contract: a 'user'-role account does not see Manage users.
    expect(isAdmin('user')).toBe(false)
  })

  it('fails closed when role is undefined (session minted before role shipped)', () => {
    // Spec edge case "Session missing role": user.value?.role is undefined and the item is hidden.
    expect(isAdmin(undefined)).toBe(false)
  })

  it('fails closed when role is null', () => {
    expect(isAdmin(null)).toBe(false)
  })

  it('fails closed when role is an empty string', () => {
    expect(isAdmin('')).toBe(false)
  })

  // Spec edge case: the column is open text, so any value that is not exactly 'admin' must
  // hide Manage users. A strict === 'admin' check is case-sensitive and un-trimmed, so these
  // near-misses must all fail closed. This is a security-relevant branch.
  it.each([
    ['Admin'],
    ['ADMIN'],
    ['aDmin'],
    [' admin'],
    ['admin '],
    [' admin '],
    ['administrator'],
    ['superadmin'],
    ['admin,user'],
    ['owner'],
    ['moderator'],
    ['guest']
  ])('fails closed for the non-exact role %j', (role) => {
    expect(isAdmin(role)).toBe(false)
  })
})

describe('accountName', () => {
  // Spec, "Identity group": the name is the full name (firstName + lastName), trimmed, and
  // when both names are empty the name line is empty (never "null null"), a documented edge case.

  it('joins first and last name into the full display name', () => {
    expect(accountName('Marie', 'Tremblay')).toBe('Marie Tremblay')
  })

  it('degrades to just the first name when the last name is missing, with no trailing space', () => {
    // Spec: a missing part leaves no stray space.
    expect(accountName('Marie', null)).toBe('Marie')
    expect(accountName('Marie', undefined)).toBe('Marie')
    expect(accountName('Marie', '')).toBe('Marie')
  })

  it('degrades to just the last name when the first name is missing, with no leading space', () => {
    expect(accountName(null, 'Tremblay')).toBe('Tremblay')
    expect(accountName(undefined, 'Tremblay')).toBe('Tremblay')
    expect(accountName('', 'Tremblay')).toBe('Tremblay')
  })

  it('resolves to an empty string when both names are absent', () => {
    // Spec edge case "No name set": renders empty rather than "null null".
    expect(accountName(null, null)).toBe('')
    expect(accountName(undefined, undefined)).toBe('')
    expect(accountName('', '')).toBe('')
    expect(accountName(null, undefined)).toBe('')
  })

  it('trims whitespace-only names down to an empty string', () => {
    // Spec says the name is trimmed, so whitespace-only parts must not survive as a name.
    expect(accountName('   ', '   ')).toBe('')
  })
})

describe('accountInitials', () => {
  // Spec, "Identity group" and edge case "No name set": the initials come from the first and
  // last name and fall back to '' when neither is set, so the avatar never renders a stray "null".

  it('takes the first letter of each name', () => {
    expect(accountInitials('Marie', 'Tremblay')).toBe('MT')
  })

  it('uppercases the initials for the avatar circle', () => {
    // The identity block is an initials circle, the conventional uppercase avatar treatment.
    expect(accountInitials('marie', 'tremblay')).toBe('MT')
  })

  it('yields a single initial when only the first name is set', () => {
    // Spec: initials must handle a missing first or last name.
    expect(accountInitials('Marie', null)).toBe('M')
    expect(accountInitials('Marie', '')).toBe('M')
  })

  it('yields a single initial when only the last name is set', () => {
    expect(accountInitials(null, 'Tremblay')).toBe('T')
    expect(accountInitials('', 'Tremblay')).toBe('T')
  })

  it('falls back to an empty string when neither name is set', () => {
    // Spec edge case: the initials fall back to '' rather than crashing.
    expect(accountInitials(null, null)).toBe('')
    expect(accountInitials(undefined, undefined)).toBe('')
    expect(accountInitials('', '')).toBe('')
  })
})

describe('triggerLabel', () => {
  // Spec, "Copy" and cross-cutting a11y: the trigger button always has an accessible name.
  // The chain is the display name first, then the email, then the static account fallback,
  // because the name is empty before onboarding.

  const fallback = 'Compte'

  it('uses the display name when present', () => {
    expect(triggerLabel('Marie Tremblay', 'marie@example.com', fallback)).toBe('Marie Tremblay')
  })

  it('falls back to the email when the name is empty', () => {
    // Pre-onboarding the name is empty, so the email carries the accessible name.
    expect(triggerLabel('', 'marie@example.com', fallback)).toBe('marie@example.com')
  })

  it('falls back to the static account label when both name and email are empty', () => {
    expect(triggerLabel('', '', fallback)).toBe(fallback)
  })

  it('falls back to the static account label when the email is null or undefined', () => {
    expect(triggerLabel('', null, fallback)).toBe(fallback)
    expect(triggerLabel('', undefined, fallback)).toBe(fallback)
  })

  it('prefers the name even when an email is also available', () => {
    expect(triggerLabel('Marie Tremblay', 'marie@example.com', fallback)).toBe('Marie Tremblay')
  })
})

describe('NAV_ROUTES', () => {
  // Spec, "Localized routes (link-ahead)" table. The map is the single source of the localized
  // link-ahead paths, so it must match the spec table exactly in both locales.
  it('matches the spec route table for both locales', () => {
    expect(NAV_ROUTES).toEqual({
      profile: { fr: '/profil', en: '/profile' },
      settings: { fr: '/parametres', en: '/settings' },
      'admin-users': { fr: '/utilisateurs', en: '/users' }
    })
  })
})

describe('navPath', () => {
  // Spec, "Navigation group" acceptance: the three routes resolve to their localized paths in
  // both locales, and the French Settings path differs from the English one. Expected values
  // come straight from the spec's Localized routes table.
  it.each<[Parameters<typeof navPath>[0], Locale, string]>([
    ['profile', 'fr', '/profil'],
    ['profile', 'en', '/profile'],
    ['settings', 'fr', '/parametres'],
    ['settings', 'en', '/settings'],
    ['admin-users', 'fr', '/utilisateurs'],
    ['admin-users', 'en', '/users']
  ])('resolves %s in %s to %s', (key, locale, expected) => {
    expect(navPath(key, locale)).toBe(expected)
  })

  it('resolves Settings to different paths per locale', () => {
    // Spec explicitly calls out that the French Settings path differs from the English one.
    expect(navPath('settings', 'fr')).not.toBe(navPath('settings', 'en'))
  })
})

describe('oppositeLocale', () => {
  // Spec, "Preferences group" Language: the toggle switches to the other locale (setLocale(otherLocale)).
  it('returns en when the active locale is fr', () => {
    expect(oppositeLocale('fr')).toBe('en')
  })

  it('returns fr when the active locale is en', () => {
    expect(oppositeLocale('en')).toBe('fr')
  })
})
