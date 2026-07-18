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

// These are the pure derivations behind the profile menu header popover. They were
// extracted from app/components/app/header.vue so each branch of the admin gate, the
// identity strings, the accessible-name fallback, and the link-ahead route map can be
// tested without mounting the component or a Nuxt runtime.

describe('isAdmin', () => {
  it('includes the admin item only for the exact admin role', () => {
    expect(isAdmin('admin')).toBe(true)
  })

  it('excludes a plain user role', () => {
    expect(isAdmin('user')).toBe(false)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['an unknown role', 'editor'],
    ['a case variant', 'Admin']
  ])('fails closed for %s', (_label, role) => {
    expect(isAdmin(role)).toBe(false)
  })
})

describe('accountInitials', () => {
  it('builds an uppercased pair from the first and last name', () => {
    expect(accountInitials('alex', 'gilbert')).toBe('AG')
  })

  it('uppercases initials that are already uppercase', () => {
    expect(accountInitials('Alex', 'Gilbert')).toBe('AG')
  })

  it('returns a single initial when only the first name is set', () => {
    expect(accountInitials('alex', '')).toBe('A')
    expect(accountInitials('alex', null)).toBe('A')
    expect(accountInitials('alex', undefined)).toBe('A')
  })

  it('returns a single initial when only the last name is set', () => {
    expect(accountInitials('', 'gilbert')).toBe('G')
    expect(accountInitials(null, 'gilbert')).toBe('G')
  })

  it('returns an empty string when neither name is set', () => {
    expect(accountInitials('', '')).toBe('')
    expect(accountInitials(null, null)).toBe('')
    expect(accountInitials(undefined, undefined)).toBe('')
    expect(accountInitials()).toBe('')
  })
})

describe('accountName', () => {
  it('joins the first and last name with a single space', () => {
    expect(accountName('Alex', 'Gilbert')).toBe('Alex Gilbert')
  })

  it('returns just the first name, trimmed, when the last name is missing', () => {
    expect(accountName('Alex', '')).toBe('Alex')
    expect(accountName('Alex', null)).toBe('Alex')
    expect(accountName('Alex', undefined)).toBe('Alex')
  })

  it('returns just the last name, trimmed, when the first name is missing', () => {
    expect(accountName('', 'Gilbert')).toBe('Gilbert')
    expect(accountName(null, 'Gilbert')).toBe('Gilbert')
  })

  it('returns an empty string when neither name is set', () => {
    expect(accountName('', '')).toBe('')
    expect(accountName(null, null)).toBe('')
    expect(accountName()).toBe('')
  })
})

describe('triggerLabel', () => {
  it('uses the display name when it is present', () => {
    expect(triggerLabel('Alex Gilbert', 'alex@example.com', 'Account menu')).toBe('Alex Gilbert')
  })

  it('falls back to the email when the name is empty', () => {
    expect(triggerLabel('', 'alex@example.com', 'Account menu')).toBe('alex@example.com')
  })

  it('falls back to the static label when both the name and email are empty', () => {
    expect(triggerLabel('', '', 'Account menu')).toBe('Account menu')
  })

  it('falls back to the static label when the email is null or undefined', () => {
    expect(triggerLabel('', null, 'Account menu')).toBe('Account menu')
    expect(triggerLabel('', undefined, 'Account menu')).toBe('Account menu')
  })
})

describe('navPath', () => {
  it.each([
    ['profile', '/profil'],
    ['settings', '/parametres'],
    ['admin-users', '/utilisateurs']
  ] as const)('resolves the fr path for %s', (key, path) => {
    expect(navPath(key, 'fr')).toBe(path)
  })

  it.each([
    ['profile', '/profile'],
    ['settings', '/settings'],
    ['admin-users', '/users']
  ] as const)('resolves the en path for %s', (key, path) => {
    expect(navPath(key, 'en')).toBe(path)
  })

  it('keeps NAV_ROUTES aligned with the paths navPath returns', () => {
    for (const key of Object.keys(NAV_ROUTES) as (keyof typeof NAV_ROUTES)[]) {
      expect(navPath(key, 'fr')).toBe(NAV_ROUTES[key].fr)
      expect(navPath(key, 'en')).toBe(NAV_ROUTES[key].en)
    }
  })
})

describe('oppositeLocale', () => {
  it('toggles fr to en', () => {
    expect(oppositeLocale('fr')).toBe('en')
  })

  it('toggles en to fr', () => {
    expect(oppositeLocale('en')).toBe('fr')
  })
})
