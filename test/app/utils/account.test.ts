import {
  ACCOUNT_NAME_MAX_CHARS,
  accountInitials,
  accountName,
  fitAccountName,
  isAdmin,
  NAV_ROUTES,
  navPath,
  oppositeLocale,
  triggerLabel
} from '~~/app/utils/account'
import enMessages from '~~/i18n/locales/en.json'
import frMessages from '~~/i18n/locales/fr.json'
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

// --- the identity block name budget ---------------------------------------------------------------
//
// SPEC GAP, RECORDED RATHER THAN PAPERED OVER. `fitAccountName`, `ACCOUNT_NAME_MAX_CHARS`, and the
// abbreviation rules behind them have no acceptance criterion anywhere in docs/specs/. The popover
// spec (docs/specs/settings/profile-menu-popover.md) stops at its edge case "Very long name or email
// overflowing the identity row [...] Long values should truncate or wrap rather than break the
// layout. Frontend applies a truncation utility; not a blocking criterion but noted so it is
// handled." The stepped abbreviation shipped later and was never written back into a spec, so the
// contract the cases below encode is the module's own declared contract plus the French convention
// for abbreviating a compound given name, which is a real typographic rule and not a guess:
// Marie-Hélène abbreviates to M.-H. with the hyphen kept, and Jean Paul to J. P. with the space kept.
//
// The declared contract, quoted from app/utils/account.ts so a reader can see what is being held to:
//
//   "The display name for the identity block, shortened only as far as it has to be to fit
//   `maxChars`. It steps down through three forms and returns the first that fits: the full name,
//   then the first name reduced to initials (`A. Gilbert`, `M.-H. Cochet`), then both names reduced
//   (`A.-B. C.-D.`). A name with only one part is never reduced, because an initial with nothing
//   beside it identifies no one; it keeps its full form and lets truncation handle it. The shortest
//   form is returned even when it still exceeds the budget, so the function always yields the most
//   readable name available rather than failing."
//
//   "One name part [...] abbreviated to initials, keeping whatever joined its segments, which is how
//   a compound name is abbreviated in French."
//
//   "Returns an empty string for an empty segment so a stray separator cannot produce a lone period."
//
// This should become an acceptance criterion on the popover or the profile spec. Reported rather
// than invented, per the rule that the spec wins and a mismatch surfaces as a failing test.

describe('fitAccountName: the full name, when it fits', () => {
  it('returns the full name unchanged when it is well inside the budget', () => {
    expect(fitAccountName('Marie', 'Tremblay', 32)).toBe('Marie Tremblay')
  })

  // The step-down is gated on `<= maxChars`, so a name measuring exactly the budget fits and must
  // not be abbreviated. This is the boundary the three forms hinge on.
  it('returns the full name when it measures exactly the budget', () => {
    const full = 'Marie Tremblay'

    expect(fitAccountName('Marie', 'Tremblay', full.length)).toBe(full)
  })

  it('abbreviates as soon as the full name is one character over the budget', () => {
    const full = 'Marie Tremblay'

    expect(fitAccountName('Marie', 'Tremblay', full.length - 1)).toBe('M. Tremblay')
  })

  it('resolves to an empty string when neither name is set', () => {
    // The empty name measures zero, so it fits any budget and the first form is returned.
    expect(fitAccountName(null, null, 32)).toBe('')
    expect(fitAccountName(undefined, undefined, 32)).toBe('')
    expect(fitAccountName('', '', 32)).toBe('')
  })

  it('trims a whitespace-only name down to an empty string', () => {
    expect(fitAccountName('   ', '   ', 32)).toBe('')
  })

  it('trims the surrounding whitespace off a name that does fit', () => {
    expect(fitAccountName('  Marie  ', '  Tremblay  ', 32)).toBe('Marie Tremblay')
  })
})

describe('fitAccountName: the second form, the first name reduced to initials', () => {
  // The contract's own worked example.
  it('reduces the first name and keeps the last name in full', () => {
    expect(fitAccountName('Alexandre', 'Gilbert', 12)).toBe('A. Gilbert')
  })

  // The contract's second worked example, and the French compound-name rule: the hyphen that joined
  // the segments is kept, so Marie-Hélène becomes M.-H. rather than M. or MH.
  it('keeps the hyphen of a compound first name', () => {
    expect(fitAccountName('Marie-Hélène', 'Cochet', 15)).toBe('M.-H. Cochet')
  })

  // The space-joined form of the same rule: Jean Paul becomes J. P.
  it('keeps the space of a space-joined compound first name', () => {
    expect(fitAccountName('Jean Paul', 'Tremblay', 16)).toBe('J. P. Tremblay')
  })

  it('collapses a run of spaces inside a compound first name to a single space', () => {
    expect(fitAccountName('Jean   Paul', 'Tremblay', 16)).toBe('J. P. Tremblay')
  })

  it('uppercases the initial it takes from a lowercase first name', () => {
    expect(fitAccountName('alexandre', 'Gilbert', 12)).toBe('A. Gilbert')
  })

  // An accented initial has to stay accented and stay one character. É is the first letter of a
  // great many Québécois given names, so this is the common case rather than an exotic one.
  it('uppercases an accented initial without stripping the accent', () => {
    expect(fitAccountName('élodie', 'Tremblay', 12)).toBe('É. Tremblay')
  })

  // The initial is taken as a whole code point rather than a UTF-16 unit, so a first letter outside
  // the Basic Multilingual Plane yields a printable character instead of half a surrogate pair.
  it('takes a whole code point as the initial rather than half a surrogate pair', () => {
    const fitted = fitAccountName('𝐀lice', 'Tremblay', 13)

    expect(fitted).toBe('𝐀. Tremblay')
    // The failure this guards is a lone high surrogate, which renders as a replacement glyph.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(fitted)).toBe(false)
  })
})

describe('fitAccountName: the third form, both names reduced', () => {
  it('reduces both names when the second form still does not fit', () => {
    expect(fitAccountName('Alexandre', 'Gilbert', 8)).toBe('A. G.')
  })

  // The contract's third worked example, `A.-B. C.-D.`: both compounds keep their separators.
  it('keeps the separators of two compound names', () => {
    expect(fitAccountName('Marie-Hélène', 'Cochet-Dupont', 12)).toBe('M.-H. C.-D.')
  })

  // "The shortest form is returned even when it still exceeds the budget, so the function always
  // yields the most readable name available rather than failing." An impossible budget returns the
  // shortest form rather than an empty string or a truncated fragment, and the `truncate` class in
  // the component is the final safety net.
  it('returns the shortest form even when it still exceeds the budget', () => {
    expect(fitAccountName('Marie-Hélène', 'Cochet-Dupont', 1)).toBe('M.-H. C.-D.')
  })

  it('returns the shortest form for a zero budget rather than nothing at all', () => {
    expect(fitAccountName('Alexandre', 'Gilbert', 0)).toBe('A. G.')
  })

  // The three forms in order, from one name and one shrinking budget, so the step-down is shown
  // happening rather than asserted one form at a time.
  it('steps down through the three forms as the budget shrinks', () => {
    const forms = [32, 12, 8].map((budget) => fitAccountName('Alexandre', 'Gilbert', budget))

    expect(forms).toEqual(['Alexandre Gilbert', 'A. Gilbert', 'A. G.'])
  })
})

describe('fitAccountName: a name with only one part is never reduced', () => {
  // "A name with only one part is never reduced, because an initial with nothing beside it
  // identifies no one." A single 'B.' on the line names nobody, so the full form is kept and
  // truncation handles it.
  it('keeps a lone first name in full even when it exceeds the budget', () => {
    expect(fitAccountName('Bartholomew', null, 4)).toBe('Bartholomew')
  })

  it('keeps a lone last name in full even when it exceeds the budget', () => {
    expect(fitAccountName(null, 'Bartholomew', 4)).toBe('Bartholomew')
  })

  it('treats an empty-string name as absent rather than as a part', () => {
    expect(fitAccountName('', 'Bartholomew', 4)).toBe('Bartholomew')
    expect(fitAccountName('Bartholomew', '', 4)).toBe('Bartholomew')
  })

  it('treats a whitespace-only name as absent rather than as a part', () => {
    expect(fitAccountName('   ', 'Bartholomew', 4)).toBe('Bartholomew')
  })

  it('keeps a lone compound name in full rather than reducing it to initials', () => {
    // Marie-Hélène on its own is still one part, so it is not reduced to 'M.-H.', which would name
    // no one.
    expect(fitAccountName('Marie-Hélène', null, 4)).toBe('Marie-Hélène')
  })
})

describe('fitAccountName: a stray separator never produces a lone period', () => {
  // "Returns an empty string for an empty segment so a stray separator cannot produce a lone
  // period." A name typed with a trailing or leading hyphen is a plain typo that the 1-to-100
  // character policy accepts, so the abbreviation has to survive it. The assertion is the property
  // the contract promises rather than the exact string, because the exact string is a consequence of
  // where the separator sat and restating it would just re-type the implementation.
  const lonePeriod = /(?:^|[\s-])\.(?:$|[\s-])/

  it.each([
    ['a trailing hyphen', 'Marie-', 'Cochet'],
    ['a leading hyphen', '-Marie', 'Cochet'],
    ['a doubled hyphen', 'Marie--Hélène', 'Cochet'],
    ['a trailing hyphen on the last name', 'Marie', 'Cochet-'],
    ['separators on both names', '-Marie-', '-Cochet-']
  ])('produces no lone period for %s', (_case, firstName, lastName) => {
    const fitted = fitAccountName(firstName, lastName, 1)

    // The positive half sits beside the absence: a function returning an empty string would satisfy
    // the "no lone period" check on its own.
    expect(fitted).not.toBe('')
    expect(lonePeriod.test(fitted)).toBe(false)
  })

  it('produces no consecutive periods for a doubled separator', () => {
    expect(fitAccountName('Marie--Hélène', 'Cochet', 1)).not.toContain('..')
  })
})

describe('ACCOUNT_NAME_MAX_CHARS', () => {
  // The budget is a character count fed straight to fitAccountName as maxChars, so it has to be a
  // whole positive number or the step-down comparisons are meaningless.
  it('is a positive whole number of characters', () => {
    expect(Number.isInteger(ACCOUNT_NAME_MAX_CHARS)).toBe(true)
    expect(ACCOUNT_NAME_MAX_CHARS).toBeGreaterThan(0)
  })

  // The declared derivation, checked against the two measurements it is derived from rather than
  // against the literal: "The popover content is 16rem (w-64, 256px) less the block's own 8px of
  // padding either side, so about 240px, and a name is text-sm, where an average character advances
  // roughly 7px." A budget above that ceiling would promise the line more characters than the box
  // can hold, which is the overflow the constant exists to prevent.
  it('stays inside the pixel budget it is derived from', () => {
    const contentWidthPx = 16 * 16 - 8 * 2
    const averageCharAdvancePx = 7

    expect(ACCOUNT_NAME_MAX_CHARS).toBeLessThanOrEqual(
      Math.floor(contentWidthPx / averageCharAdvancePx)
    )
  })

  // app/components/app/header.vue passes `ACCOUNT_NAME_MAX_CHARS - t('header.adminTag').length` so
  // the tag's own width is reserved from the same budget. The shipped copy is read from the locale
  // files rather than retyped, because that is the source of truth the subtraction follows: reword
  // the tag longer, or shrink the budget, and the remaining allowance has to stay usable.
  it('still leaves a usable allowance after the admin tag is reserved, in both locales', () => {
    const tags = [frMessages.header.adminTag, enMessages.header.adminTag]

    for (const tag of tags) {
      expect(ACCOUNT_NAME_MAX_CHARS - tag.length).toBeGreaterThan(0)
    }
  })

  // The consequence of that reservation on screen: with the tag's width taken out, a real name still
  // has to come back non-empty and still has to identify someone, which is the reason the shortest
  // form is a pair of initials rather than nothing.
  it('yields a readable name for an admin, with the tag width taken out', () => {
    const budget = ACCOUNT_NAME_MAX_CHARS - frMessages.header.adminTag.length

    expect(fitAccountName('Marie-Hélène', 'Cochet-Dupont', budget)).toBe('M.-H. Cochet-Dupont')
  })
})
