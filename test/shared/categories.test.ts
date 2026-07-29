import enMessages from '~~/i18n/locales/en.json'
import frMessages from '~~/i18n/locales/fr.json'
import { describe, expect, it } from 'vitest'

import {
  categoryHue,
  coerceCategory,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORY_IDS,
  isTrackableCategory
} from '#shared/categories'

// The nine-categories spec (docs/specs/planning/nine-task-categories.md) replaces the six ids that
// PLAN-02 shipped with the nine the user actually uses. It locks the membership
// and the order (AC1), the confirmed French and English copy (AC2), the coercion of the now stale
// revision id (AC4), and a real locale key for every id in both files (AC6). The fail-closed
// coercion that PLAN-02 established still holds and is still asserted here, since the quota engine
// (PLAN-22), the task row UI (PLAN-06), and the write API (PLAN-09) all rest on it.
//
// The colour half of the contract comes from the coloured-names spec
// (docs/specs/planning/category-column-coloured-names.md) and its design blueprint. AC2 there makes
// this module the single source of truth for which category is which colour, and the blueprint's
// resolved palette fixes the nine hues. Expected values throughout are derived from those specs, not
// from the implementation.

// The locked order and membership from AC1 and the spec's category table.
const EXPECTED_ORDER = [
  'translation',
  'revision_internal',
  'revision_external',
  'proofreading',
  'terminology',
  'meetings',
  'breaks',
  'admin',
  'dtp'
]

// Spec-derived trackable table (AC1). The four members that produce billable words are trackable
// and the five that only consume scheduled time are not.
const TRACKABLE_TABLE: Array<[string, boolean]> = [
  ['translation', true],
  ['revision_internal', true],
  ['revision_external', true],
  ['proofreading', true],
  ['terminology', false],
  ['meetings', false],
  ['breaks', false],
  ['admin', false],
  ['dtp', false]
]

// The four ids PLAN-32a added, called out separately because each of them was an invalid value
// before that feature and has to read as valid now (AC4).
const NEW_IDS = ['revision_internal', 'revision_external', 'proofreading', 'dtp']

// Invalid inputs that must all fold to the safe default (AC4 and the spec's edge cases). The stale
// id case is revision, which is the id the six-member set carried and the exact value the dev
// database still holds, so this mirrors the theme test's removed-id intent against a real value
// rather than a hypothetical one. ma-categorie stands for a category PLAN-30 lets the user create
// but that this contract has never seen, and NaN is here because a number reaching a lookup is the
// input most likely to produce undefined rather than a fallback.
const INVALID_INPUTS: Array<[string, unknown]> = [
  ['an unknown string', 'does-not-exist'],
  ['the stale revision id', 'revision'],
  ['the empty string', ''],
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['NaN', Number.NaN],
  ['an object', { id: 'translation' }],
  ['a user-created id', 'ma-categorie']
]

// The hue each category's name is printed at, from the design blueprint's resolved palette. Seven of
// the nine are the user's own colours from the app they use today, kept verbatim: cyan 195
// for translation, apple green 140 for revision_internal, wine red 20 for terminology, pink 340 for
// meetings, navy 265 for breaks. revision_external at 115 is the derived sibling of 140, and admin
// 305 and dtp 60 are chosen because the user named no colour for either. proofreading at 230 is the one
// substitution: the user's pale grey cannot both clear the 4.5:1 text floor and still read as a colour
// rather than as the row's own muted text, so it takes the centre of the palette's widest empty arc.
//
// This is the mapping AC2 calls the single source of truth, so it is pinned literally rather than
// derived from the descriptors. A future reader finding this table failing is looking at a palette
// change, which is a decision that belongs to the user rather than to a build stage.
const CATEGORY_HUE_TABLE: Array<[string, number]> = [
  ['translation', 195],
  ['revision_internal', 140],
  ['revision_external', 115],
  ['proofreading', 230],
  ['terminology', 20],
  ['meetings', 340],
  ['breaks', 265],
  ['admin', 305],
  ['dtp', 60]
]

describe('shared/categories', () => {
  // AC1: DEFAULT_CATEGORY_IDS equals exactly the nine ids in the locked order.
  it('exposes exactly the nine default category ids in the locked order', () => {
    expect(DEFAULT_CATEGORY_IDS).toEqual(EXPECTED_ORDER)
  })

  it('has exactly nine default category ids', () => {
    expect(DEFAULT_CATEGORY_IDS).toHaveLength(9)
  })

  it('has no duplicate category ids', () => {
    expect(new Set(DEFAULT_CATEGORY_IDS).size).toBe(DEFAULT_CATEGORY_IDS.length)
  })

  // AC1: the single revision id is gone, replaced by the internal and external pair, because the user's
  // two revision quotas are different numbers and two rates cannot share one category.
  it('no longer carries the retired revision id', () => {
    expect(DEFAULT_CATEGORY_IDS as readonly string[]).not.toContain('revision')
  })
})

describe('DEFAULT_CATEGORIES', () => {
  // AC1: exactly nine descriptors ship, no tenth category.
  it('contains exactly nine descriptors', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(9)
  })

  // AC1: the descriptor ids match DEFAULT_CATEGORY_IDS in the same order. The colour contract is read
  // by id rather than by position, but the two lists agreeing is what lets a reader compare the
  // palette table above against the contract in one pass.
  it('has ids matching DEFAULT_CATEGORY_IDS in the same order', () => {
    expect(DEFAULT_CATEGORIES.map((category) => category.id)).toEqual([...DEFAULT_CATEGORY_IDS])
  })

  // AC1: each id maps to its locked trackable flag.
  it.each(TRACKABLE_TABLE)('marks %s as trackable=%s', (id, expectedTrackable) => {
    const descriptor = DEFAULT_CATEGORIES.find((category) => category.id === id)
    expect(descriptor).toBeDefined()
    expect(descriptor?.trackable).toBe(expectedTrackable)
  })

  // AC1: exactly four categories are trackable and five are not.
  it('has exactly four trackable categories', () => {
    expect(DEFAULT_CATEGORIES.filter((category) => category.trackable)).toHaveLength(4)
  })

  it('has exactly five non-trackable categories', () => {
    expect(DEFAULT_CATEGORIES.filter((category) => !category.trackable)).toHaveLength(5)
  })

  // AC1 states the trackable split by membership as well as by count, and the four are the members
  // whose words reach the quota numerator, so naming them is worth more than counting them.
  it('marks translation, both revisions, and proofreading as the four trackable ids', () => {
    const trackable = DEFAULT_CATEGORIES.filter((category) => category.trackable)
    expect(trackable.map((category) => category.id)).toEqual([
      'translation',
      'revision_internal',
      'revision_external',
      'proofreading'
    ])
  })
})

describe('DEFAULT_CATEGORY_ID', () => {
  // AC4: the safe fallback is still locked to admin.
  it('is admin', () => {
    expect(DEFAULT_CATEGORY_ID).toBe('admin')
  })

  it('is one of the default category ids', () => {
    expect(DEFAULT_CATEGORY_IDS as readonly string[]).toContain(DEFAULT_CATEGORY_ID)
  })

  // AC4: the fallback must be non-trackable, checked via the descriptor.
  it('is non-trackable per its descriptor', () => {
    const descriptor = DEFAULT_CATEGORIES.find((category) => category.id === DEFAULT_CATEGORY_ID)
    expect(descriptor?.trackable).toBe(false)
  })

  // AC4: cross-checked via the public trackable lookup as well.
  it('is non-trackable per isTrackableCategory', () => {
    expect(isTrackableCategory(DEFAULT_CATEGORY_ID)).toBe(false)
  })
})

// AC4: coerceCategory is identity on the valid set and folds everything else to the default.
describe('coerceCategory', () => {
  it.each(DEFAULT_CATEGORY_IDS)('returns %s unchanged for the valid id', (id) => {
    expect(coerceCategory(id)).toBe(id)
  })

  // AC4 spells out that the four ids PLAN-32a added all return themselves unchanged. Each of them
  // folded to admin before that feature, so this is the criterion that proves the tuple widened
  // rather than only that the old ids still work.
  it.each(NEW_IDS)('returns the newly valid id %s unchanged', (id) => {
    expect(coerceCategory(id)).toBe(id)
  })

  it.each(INVALID_INPUTS)('folds %s to the default', (_label, input) => {
    expect(coerceCategory(input)).toBe('admin')
  })

  // AC4, and the most load-bearing behaviour in the nine-categories feature. Nine seeded rows in the
  // dev database still carry revision, and that id is retired. A stored revision has to resolve to a
  // valid non-trackable id so its words can never enter the quota numerator and inflate the headline
  // number read at review time. Reading as administration is wrong for the user and
  // safe for the quota, which is the direction the fallback is chosen to fail in.
  it('folds a stored revision to a non-trackable admin so its words can never reach the quota numerator', () => {
    expect(coerceCategory('revision')).toBe('admin')
    expect(isTrackableCategory('revision')).toBe(false)
  })

  // Cross-check against the documented default rather than the literal, so a default drift is
  // caught here too.
  it('uses DEFAULT_CATEGORY_ID as the fallback value', () => {
    expect(coerceCategory('anything-invalid')).toBe(DEFAULT_CATEGORY_ID)
  })
})

// AC1 and AC4 (fail-closed): isTrackableCategory reports the flag for known ids and can never
// report an unknown id as trackable.
describe('isTrackableCategory', () => {
  it.each(TRACKABLE_TABLE)('returns %s for the known id %s', (id, expectedTrackable) => {
    expect(isTrackableCategory(id)).toBe(expectedTrackable)
  })

  // Every invalid input must read as non-trackable, so an unknown id can never inflate the quota
  // numerator.
  it.each(INVALID_INPUTS)('returns false for %s', (_label, input) => {
    expect(isTrackableCategory(input)).toBe(false)
  })

  // AC1 consistency: for every default id the lookup agrees with its descriptor, proving there is
  // one source of truth for the flag.
  it.each(DEFAULT_CATEGORIES)('agrees with the descriptor for $id', (descriptor) => {
    expect(isTrackableCategory(descriptor.id)).toBe(descriptor.trackable)
  })
})

// The coloured-names spec (docs/specs/planning/category-column-coloured-names.md) prints the
// category as a word in its own colour, so the contract maps an id to one hue angle and the fixed
// lightness and chroma live once per mode in main.css. That split is what AC2 sanctions, and it is
// why nothing here asserts a contrast ratio: the ratios are measured in the design blueprint and
// enforced by the CSS custom properties, and this module is only ever asked which hue an id takes.

describe('Category descriptors carry a hue', () => {
  // The mapping lives on the descriptor rather than in a second map, which is what keeps the colour
  // and the trackable flag from drifting apart.
  it.each(DEFAULT_CATEGORIES)('declares a hue for $id', (descriptor) => {
    expect(descriptor).toHaveProperty('hue')
  })

  // The assertion that inverts. This file used to assert that a category carried a colour exactly
  // when it was trackable, which encoded AC18 of extend-tasks.md, where the five non-trackable
  // categories read as neutral and drew nothing. PLAN-32c reverses that: the user's original
  // app coloured every kind of work and the user asked for that back, so all nine take a colour and the
  // null case disappears from the defaults. Asserting the reversal explicitly rather than deleting
  // the old test is deliberate, so a reader who arrives expecting the old rule finds the reason here.
  it('gives every one of the nine categories a hue, trackable or not', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(9)
    for (const descriptor of DEFAULT_CATEGORIES) {
      expect(descriptor.hue).not.toBeNull()
      expect(descriptor.hue).not.toBeUndefined()
      expect(typeof descriptor.hue).toBe('number')
    }
  })

  // The same reversal stated from the non-trackable side, which is the half that changed. A meeting,
  // a break, administration, terminology, and page layout are all kinds of work the user wants to
  // recognize by colour, so none of the five may resolve to nothing.
  it('colours the five non-trackable categories too', () => {
    const nonTrackable = DEFAULT_CATEGORIES.filter((category) => !category.trackable)
    expect(nonTrackable.map((category) => category.id)).toEqual([
      'terminology',
      'meetings',
      'breaks',
      'admin',
      'dtp'
    ])
    expect(nonTrackable.every((category) => typeof category.hue === 'number')).toBe(true)
  })

  // Two categories sharing a hue would defeat the whole point, which is telling one kind of work
  // from another at a glance. With every category coloured this now covers all nine rather than the
  // four that used to hold a slot.
  it('gives each of the nine categories its own hue', () => {
    const hues = DEFAULT_CATEGORIES.map((category) => category.hue)
    expect(new Set(hues).size).toBe(hues.length)
  })

  // Every hue is an angle in degrees, since main.css feeds it straight into oklch(). A value outside
  // the circle would render as an unpredictable colour rather than fail loudly, and the blueprint's
  // guarantee that every hue from 0 to 359 clears 4.5:1 only holds inside that range.
  it.each(DEFAULT_CATEGORIES)('keeps $id at a hue angle within the colour circle', (descriptor) => {
    expect(Number.isInteger(descriptor.hue)).toBe(true)
    expect(descriptor.hue).toBeGreaterThanOrEqual(0)
    expect(descriptor.hue).toBeLessThan(360)
  })
})

describe('categoryHue', () => {
  // The blueprint's resolved palette, asserted per id. This is the assertion the palette table above
  // exists for.
  it.each(CATEGORY_HUE_TABLE)('resolves %s to hue %i', (id, expected) => {
    expect(categoryHue(id)).toBe(expected)
  })

  // AC2 asks for every one of the nine to resolve through the contract to a colour, so the whole set
  // is checked as a set rather than only row by row.
  it('resolves all nine ids to nine distinct hues', () => {
    const hues = DEFAULT_CATEGORY_IDS.map((id) => categoryHue(id))
    expect(hues).toHaveLength(9)
    expect(new Set(hues).size).toBe(9)
  })

  // The public function agrees with the descriptor for every default id, so there is one mapping
  // rather than a function and a table that can drift.
  it.each(DEFAULT_CATEGORIES)('agrees with the descriptor hue for $id', (descriptor) => {
    expect(categoryHue(descriptor.id)).toBe(descriptor.hue)
  })

  // Totality, which is the fifth thing the spec's new shape had to express. The row hands this
  // function whatever the free-text category column holds, so no input may return null or undefined
  // and none may throw. Every invalid value coerces to admin first and therefore takes admin's hue,
  // which is 305. It borrows the fallback's colour rather than another category's, so a stale row can
  // never claim to be translation work.
  it.each(INVALID_INPUTS)('resolves %s to a real hue rather than nothing', (_label, input) => {
    expect(() => categoryHue(input)).not.toThrow()
    const hue = categoryHue(input)
    expect(hue).not.toBeNull()
    expect(hue).not.toBeUndefined()
    expect(typeof hue).toBe('number')
    expect(hue).toBe(305)
  })

  // A PLAN-30 category the user creates is the same case as a stale id until PLAN-30 extends the
  // validated set. It resolves rather than throwing, which is the extensibility property the retired
  // hue ring existed for and that the blueprint now guarantees over the whole circle instead.
  it('resolves a user-created category id to the fallback hue rather than throwing', () => {
    expect(categoryHue('ma-categorie')).toBe(categoryHue(DEFAULT_CATEGORY_ID))
  })

  // It agrees with the coercion, so an unknown id and the default it folds to read the same. This is
  // the same fail-closed discipline isTrackableCategory follows. It is also the one assertion the
  // colour contract carried before PLAN-32c whose intent survives this feature unchanged.
  it('agrees with coerceCategory for an unknown id', () => {
    expect(categoryHue('does-not-exist')).toBe(categoryHue(DEFAULT_CATEGORY_ID))
  })
})

// AC2 and AC6 of the nine-categories spec. Every visible category name lives in the locale files
// under categories.<id>, never in the contract module, and TaskRow.vue resolves it with a dynamic
// template key that nothing validates. A missing key therefore prints the raw key string in the
// category column, which is the cell the coloured-names feature makes visible, so the shipped copy
// being complete is a real requirement rather than a tidiness one. The two JSON files are imported
// directly rather than mocked, because the point is that the copy that ships is the copy that is
// asserted.
const FR_CATEGORIES = frMessages.categories as Record<string, string>
const EN_CATEGORIES = enMessages.categories as Record<string, string>

// The confirmed French and English names from the spec's category table. Every string here is
// confirmed with the user and locked, so this table is the guard against a later
// well-meaning rewording. Two rows look like mistakes and neither is. Relecture was chosen over
// the stricter Correction d'épreuves on purpose, and dtp diverges on purpose, reading Mise en page
// in French against DTP in English, because each side is the term its own reader uses. Nobody
// should "fix" either one.
const CATEGORY_NAME_TABLE: Array<[string, string, string]> = [
  ['translation', 'Traduction', 'Translation'],
  ['revision_internal', 'Révision interne', 'Internal revision'],
  ['revision_external', 'Révision externe', 'External revision'],
  ['proofreading', 'Relecture', 'Proofreading'],
  ['terminology', 'Terminologie', 'Terminology'],
  ['meetings', 'Réunions', 'Meetings'],
  ['breaks', 'Pauses', 'Breaks'],
  ['admin', 'Administration', 'Admin'],
  ['dtp', 'Mise en page', 'DTP']
]

const LOCALE_TABLE: Array<[string, Record<string, string>]> = [
  ['French', FR_CATEGORIES],
  ['English', EN_CATEGORIES]
]

describe('i18n category names', () => {
  // AC6: every one of the nine ids resolves to a non-empty string in both files, so the dynamic
  // lookup can never fall through to printing its own key.
  it.each(DEFAULT_CATEGORY_IDS)('resolves %s to a non-empty French name', (id) => {
    expect(typeof FR_CATEGORIES[id]).toBe('string')
    expect(FR_CATEGORIES[id]?.trim()).not.toBe('')
  })

  it.each(DEFAULT_CATEGORY_IDS)('resolves %s to a non-empty English name', (id) => {
    expect(typeof EN_CATEGORIES[id]).toBe('string')
    expect(EN_CATEGORIES[id]?.trim()).not.toBe('')
  })

  // AC6: identical key sets on both sides, because French is the default and English is fully
  // supported, so a key present on one side only leaves one locale on raw keys.
  it('carries identical category key sets in French and English', () => {
    expect(Object.keys(FR_CATEGORIES).sort()).toEqual(Object.keys(EN_CATEGORIES).sort())
  })

  // AC6: neither file holds a categories key outside the nine, so no dead copy is left behind that
  // no id can reach.
  it.each(LOCALE_TABLE)('holds no %s category key outside the nine', (_locale, messages) => {
    expect(Object.keys(messages).sort()).toEqual([...DEFAULT_CATEGORY_IDS].sort())
  })

  // AC6: the retired revision key is removed from both files rather than left as a value no id can
  // reach. Note that revision_internal and revision_external are distinct keys, so this is about
  // the bare revision key alone.
  it.each(LOCALE_TABLE)('no longer holds the retired revision key in %s', (_locale, messages) => {
    expect(messages).not.toHaveProperty('revision')
  })

  // AC6: the locked order the spec gives is the order both files follow, so a reader comparing the
  // contract against the copy reads the two in the same sequence.
  it.each(LOCALE_TABLE)('lists its %s category keys in the contract order', (_locale, messages) => {
    expect(Object.keys(messages)).toEqual([...DEFAULT_CATEGORY_IDS])
  })

  // AC2: the exact confirmed strings, which are locked. AC8 of the coloured-names spec restates the
  // same lock for the column this feature makes visible, since the nine names are printed as
  // confirmed with no synonym substituted.
  it.each(CATEGORY_NAME_TABLE)('names %s "%s" in French and "%s" in English', (id, fr, en) => {
    expect(FR_CATEGORIES[id]).toBe(fr)
    expect(EN_CATEGORIES[id]).toBe(en)
  })

  // AC2 calls the dtp divergence out by name because it is the one row where the two locales do
  // not say the same thing. Layout was the English name for part of 2026-07-29 and the user rejected it
  // as generic the same day, so the set carries one industry acronym knowingly. This assertion
  // exists so a later stage cannot quietly align the two sides.
  it('keeps the intended dtp divergence between Mise en page and DTP', () => {
    expect(FR_CATEGORIES.dtp).toBe('Mise en page')
    expect(EN_CATEGORIES.dtp).toBe('DTP')
    expect(FR_CATEGORIES.dtp).not.toBe(EN_CATEGORIES.dtp)
  })

  // AC2: the French typography rule (a space before ? ! : ;) is recorded as checked rather than
  // illustrated with an invented case. None of the nine French names carries that punctuation, so
  // the rule holds trivially, and this asserts it keeps holding.
  it.each(CATEGORY_NAME_TABLE)(
    'gives %s a French name with no punctuation the space rule covers',
    (_id, fr) => {
      expect(fr).not.toMatch(/[?!:;]/)
    }
  )
})
