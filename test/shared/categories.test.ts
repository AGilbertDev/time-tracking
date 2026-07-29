import enMessages from '~~/i18n/locales/en.json'
import frMessages from '~~/i18n/locales/fr.json'
import { describe, expect, it } from 'vitest'

import {
  CATEGORY_HUE_SLOTS,
  categoryEdgeHue,
  coerceCategory,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORY_IDS,
  isTrackableCategory
} from '#shared/categories'

// The nine-categories spec (docs/specs/planning/nine-task-categories.md) replaces the six ids that
// PLAN-02 shipped with the nine the primary user's employer actually uses. It locks the membership
// and the order (AC1), the confirmed French and English copy (AC2), the coercion of the now stale
// revision id (AC4), a real locale key for every id in both files (AC6), and the placeholder edge
// slots inside the unchanged hue ring (AC7). The fail-closed coercion that PLAN-02 established
// still holds and is still asserted here, since the quota engine (PLAN-22), the task row UI
// (PLAN-06), and the write API (PLAN-09) all rest on it. Expected values are derived from the
// spec, not from the implementation.

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

// The four ids this feature adds, called out separately because each of them was an invalid value
// before PLAN-32a and has to read as valid now (AC4).
const NEW_IDS = ['revision_internal', 'revision_external', 'proofreading', 'dtp']

// Invalid inputs that must all fold to the safe default (AC4 and the spec's edge cases). The stale
// id case is revision, which is the id the six-member set carried and the exact value the dev
// database still holds, so this mirrors the theme test's removed-id intent against a real value
// rather than a hypothetical one.
const INVALID_INPUTS: Array<[string, unknown]> = [
  ['an unknown string', 'does-not-exist'],
  ['the stale revision id', 'revision'],
  ['the empty string', ''],
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['an object', { id: 'translation' }]
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

  // AC1: the single revision id is gone, replaced by the internal and external pair, because her
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

  // AC1: the descriptor ids match DEFAULT_CATEGORY_IDS in the same order.
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

  // AC4 spells out that the four ids this feature adds all return themselves unchanged. Each of
  // them folded to admin before PLAN-32a, so this is the criterion that proves the tuple widened
  // rather than only that the old ids still work.
  it.each(NEW_IDS)('returns the newly valid id %s unchanged', (id) => {
    expect(coerceCategory(id)).toBe(id)
  })

  it.each(INVALID_INPUTS)('folds %s to the default', (_label, input) => {
    expect(coerceCategory(input)).toBe('admin')
  })

  // AC4, and the most load-bearing behaviour in the feature. Nine seeded rows in the dev database
  // still carry revision, and this feature retires that id. A stored revision has to resolve to a
  // valid non-trackable id so its words can never enter the quota numerator and inflate the
  // headline number the employer reads at review time. Reading as administration is wrong for the
  // user and safe for the quota, which is the direction the fallback is chosen to fail in.
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

// AC2 and AC6. Every visible category name lives in the locale files under categories.<id>, never
// in the contract module, and TaskRow.vue resolves it with a dynamic template key that nothing
// validates. A missing key therefore prints the raw key string as the row's visible primary name
// and reads it aloud through the sr-only span, so the shipped copy being complete is a real
// requirement rather than a tidiness one. The two JSON files are imported directly rather than
// mocked, because the point is that the copy that ships is the copy that is asserted.
const FR_CATEGORIES = frMessages.categories as Record<string, string>
const EN_CATEGORIES = enMessages.categories as Record<string, string>

// The confirmed French and English names from the spec's category table. Every string here is
// confirmed with the primary user and locked, so this table is the guard against a later
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

  // AC2: the exact confirmed strings, which are locked.
  it.each(CATEGORY_NAME_TABLE)('names %s "%s" in French and "%s" in English', (id, fr, en) => {
    expect(FR_CATEGORIES[id]).toBe(fr)
    expect(EN_CATEGORIES[id]).toBe(en)
  })

  // AC2 calls the dtp divergence out by name because it is the one row where the two locales do
  // not say the same thing. Layout was the English name for part of 2026-07-29 and she rejected it
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

// The progressive-disclosure spec (docs/specs/planning/extend-tasks.md) turns the category from a
// printed word into a colour on the row edge and says the mapping is one shared contract living
// beside this one. AC18 fixes what a non-trackable category resolves to, D8 fixes that each
// trackable category gets a distinct hue and that the palette must extend to categories PLAN-30
// has not created yet, and the design stage (extend-tasks-design.md, "The palette rule") settled
// the ring. PLAN-32a AC7 then reassigns the slots for nine ids.

// The hue each category resolves to today, from PLAN-32a AC7, and the neutral the other five take.
// A null means no edge is drawn at all, which is how an edge treatment renders AC18's neutral.
//
// The four trackable hues are PLAN-32a placeholders and PLAN-32c replaces all of them, including
// the hue translation has held since it shipped. AC7 says so directly and gives the evidence.
// revision_internal resolving to magenta 300 against revision_external's green 115 reads as two
// unrelated categories, while PLAN-32c is required to make the two revision greens read as related
// but distinct. So a future reader who finds this table failing after PLAN-32c should update it
// rather than treat the change as a regression.
const EDGE_HUE_TABLE: Array<[string, number | null]> = [
  ['translation', 195],
  ['revision_internal', 300],
  ['revision_external', 115],
  ['proofreading', 345],
  ['terminology', null],
  ['meetings', null],
  ['breaks', null],
  ['admin', null],
  ['dtp', null]
]

describe('CATEGORY_HUE_SLOTS', () => {
  // AC7: the ring is unchanged by this feature. Only the edgeSlot numbers on the descriptors move,
  // and only as far as nine ids mechanically require, so the eight slots are asserted literally.
  it('is the unchanged eight-slot ring', () => {
    expect(CATEGORY_HUE_SLOTS).toEqual([195, 300, 115, 345, 240, 170, 275, 320])
  })

  // D8 and AC7: the palette must be able to extend, because PLAN-30 lets the user create
  // categories that each need a colour. Four of the eight slots are used, so the ring still
  // carries more slots than the defaults consume and PLAN-30 needs no redesign.
  it('carries more slots than the default categories consume', () => {
    const used = DEFAULT_CATEGORIES.filter((category) => category.edgeSlot !== null)
    expect(CATEGORY_HUE_SLOTS.length).toBeGreaterThan(used.length)
  })

  // Two categories sharing a hue would defeat the whole point, which is telling one kind of work
  // from another at a glance.
  it('has no duplicate hue angles', () => {
    expect(new Set(CATEGORY_HUE_SLOTS).size).toBe(CATEGORY_HUE_SLOTS.length)
  })

  // Every slot is a hue angle in degrees, since main.css feeds it straight into oklch(). A value
  // outside the circle would render as an unpredictable colour rather than fail loudly.
  it.each(CATEGORY_HUE_SLOTS)('exposes %i as a hue angle within the colour circle', (hue) => {
    expect(Number.isInteger(hue)).toBe(true)
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })
})

describe('Category descriptors carry an edge slot', () => {
  // The mapping lives on the descriptor rather than in a second map, which is what keeps the colour
  // and the trackable flag from drifting apart.
  it.each(DEFAULT_CATEGORIES)('declares an edgeSlot for $id', (descriptor) => {
    expect(descriptor).toHaveProperty('edgeSlot')
  })

  // AC18: a non-trackable category reads as neutral, so it holds no slot. D8: a trackable one does.
  it.each(DEFAULT_CATEGORIES)('gives $id a slot only when it is trackable', (descriptor) => {
    expect(descriptor.edgeSlot !== null).toBe(descriptor.trackable)
  })

  // AC7 states the split by membership rather than only by rule, so the two sides are asserted as
  // lists. The five non-trackable ids keep edgeSlot null in this feature, dtp included, because
  // colouring them is PLAN-32c's decision.
  it('gives an edge slot to the four trackable ids and none to the five others', () => {
    const withSlot = DEFAULT_CATEGORIES.filter((category) => category.edgeSlot !== null)
    const withoutSlot = DEFAULT_CATEGORIES.filter((category) => category.edgeSlot === null)
    expect(withSlot.map((category) => category.id)).toEqual([
      'translation',
      'revision_internal',
      'revision_external',
      'proofreading'
    ])
    expect(withoutSlot.map((category) => category.id)).toEqual([
      'terminology',
      'meetings',
      'breaks',
      'admin',
      'dtp'
    ])
  })

  // Two trackable categories pointing at the same slot would resolve to the same hue.
  it('gives each trackable category its own slot', () => {
    const slots = DEFAULT_CATEGORIES.map((category) => category.edgeSlot).filter(
      (slot) => slot !== null
    )
    expect(new Set(slots).size).toBe(slots.length)
  })

  // AC7: every assigned slot has to index into the ring, or categoryEdgeHue would wrap and hand
  // main.css a hue the palette never vetted for this category.
  it.each(DEFAULT_CATEGORIES)('keeps $id inside the ring bounds', (descriptor) => {
    if (descriptor.edgeSlot === null) return
    expect(descriptor.edgeSlot).toBeGreaterThanOrEqual(0)
    expect(descriptor.edgeSlot).toBeLessThan(CATEGORY_HUE_SLOTS.length)
  })
})

describe('categoryEdgeHue', () => {
  // The AC7 assignments, and AC18's neutral for the five that produce no words.
  it.each(EDGE_HUE_TABLE)('resolves %s to %s', (id, expected) => {
    expect(categoryEdgeHue(id)).toBe(expected)
  })

  // D8: the distinction the colour exists to make is one kind of work against another, so no two
  // trackable categories can land on the same hue and none of the four may read as neutral. With
  // four trackable members this is the assertion that carries that rule, and it replaces the old
  // translation-against-revision check, which now compares nothing since revision is not an id.
  it('gives the four trackable categories four distinct hues that are all drawn', () => {
    const hues = DEFAULT_CATEGORIES.filter((category) => category.trackable).map((category) =>
      categoryEdgeHue(category.id)
    )
    expect(hues).toHaveLength(4)
    expect(hues.every((hue) => hue !== null)).toBe(true)
    expect(new Set(hues).size).toBe(4)
  })

  // Every trackable hue has to be one the ring actually declares, or main.css would be handed a
  // number the palette never vetted for contrast.
  it.each(DEFAULT_CATEGORY_IDS)('resolves %s to a hue the ring declares, or to null', (id) => {
    const hue = categoryEdgeHue(id)
    if (hue !== null) expect(CATEGORY_HUE_SLOTS as readonly number[]).toContain(hue)
  })

  // AC18 restated through the public function: neutral and trackable are the same split, so the
  // colour can never say a break is translation work.
  it.each(DEFAULT_CATEGORY_IDS)('gives %s a hue only when it is trackable', (id) => {
    expect(categoryEdgeHue(id) !== null).toBe(isTrackableCategory(id))
  })

  // D8 asks for a palette that extends to categories that do not exist yet, so an id this contract
  // has never seen has to resolve rather than throw. It resolves to neutral, which draws no edge,
  // because borrowing another category's hue would make the row lie about what kind of work it is.
  it.each(INVALID_INPUTS)('resolves %s to neutral rather than throwing', (_label, input) => {
    expect(() => categoryEdgeHue(input)).not.toThrow()
    expect(categoryEdgeHue(input)).toBeNull()
  })

  // A user-created id from PLAN-30 is the same case as a stale one until PLAN-30 extends the
  // validated set, and it must not take a default category's colour on the way through.
  it('resolves a user-created category id to neutral rather than to a default hue', () => {
    expect(categoryEdgeHue('ma-categorie')).toBeNull()
  })

  // It agrees with the coercion, so an unknown id and the default it folds to read the same. This is
  // the same fail-closed discipline isTrackableCategory follows.
  it('agrees with coerceCategory for an unknown id', () => {
    expect(categoryEdgeHue('does-not-exist')).toBe(categoryEdgeHue(DEFAULT_CATEGORY_ID))
  })
})
