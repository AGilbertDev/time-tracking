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

// The task-categories contract spec (docs/specs/planning/task-categories.md) locks the six
// default category ids, their trackable flags, and a fail-closed coercion to a non-trackable
// default. These invariants back the quota engine (PLAN-22), the task row UI (PLAN-06), and the
// write API (PLAN-09), so the spec's acceptance criteria AC1-AC3 are asserted here. Expected
// values are derived from the spec, not from the implementation.

// The locked order and membership from AC1 / the spec's outputs section.
const EXPECTED_ORDER = ['translation', 'revision', 'terminology', 'meetings', 'breaks', 'admin']

// Spec-derived trackable table (spec inputs #1 and AC1): translation and revision are trackable,
// the other four are not.
const TRACKABLE_TABLE: Array<[string, boolean]> = [
  ['translation', true],
  ['revision', true],
  ['terminology', false],
  ['meetings', false],
  ['breaks', false],
  ['admin', false]
]

// Invalid inputs that must all fold to the safe default (AC3 / spec edge cases). Includes a
// stale/renamed id to mirror the theme test's removed-id intent (spec edge case: a retired or
// renamed category id in stored data).
const INVALID_INPUTS: Array<[string, unknown]> = [
  ['an unknown string', 'does-not-exist'],
  ['a stale/renamed category id', 'proofreading'],
  ['the empty string', ''],
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['an object', { id: 'translation' }]
]

describe('shared/categories', () => {
  // AC1 / spec: DEFAULT_CATEGORY_IDS equals exactly the six ids in the locked order.
  it('exposes exactly the six default category ids in the locked order', () => {
    expect(DEFAULT_CATEGORY_IDS).toEqual(EXPECTED_ORDER)
  })

  it('has exactly six default category ids', () => {
    expect(DEFAULT_CATEGORY_IDS).toHaveLength(6)
  })

  it('has no duplicate category ids', () => {
    expect(new Set(DEFAULT_CATEGORY_IDS).size).toBe(DEFAULT_CATEGORY_IDS.length)
  })
})

describe('DEFAULT_CATEGORIES', () => {
  // AC1: exactly six descriptors ship, no seventh category.
  it('contains exactly six descriptors', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(6)
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

  // AC1: exactly two categories are trackable and four are not.
  it('has exactly two trackable categories', () => {
    expect(DEFAULT_CATEGORIES.filter((category) => category.trackable)).toHaveLength(2)
  })

  it('has exactly four non-trackable categories', () => {
    expect(DEFAULT_CATEGORIES.filter((category) => !category.trackable)).toHaveLength(4)
  })
})

describe('DEFAULT_CATEGORY_ID', () => {
  // AC3: the safe fallback is locked to admin.
  it('is admin', () => {
    expect(DEFAULT_CATEGORY_ID).toBe('admin')
  })

  it('is one of the default category ids', () => {
    expect(DEFAULT_CATEGORY_IDS as readonly string[]).toContain(DEFAULT_CATEGORY_ID)
  })

  // AC3: the fallback must be non-trackable, checked via the descriptor.
  it('is non-trackable per its descriptor', () => {
    const descriptor = DEFAULT_CATEGORIES.find((category) => category.id === DEFAULT_CATEGORY_ID)
    expect(descriptor?.trackable).toBe(false)
  })

  // AC3: cross-checked via the public trackable lookup as well.
  it('is non-trackable per isTrackableCategory', () => {
    expect(isTrackableCategory(DEFAULT_CATEGORY_ID)).toBe(false)
  })
})

// AC3: coerceCategory is identity on the valid set and folds everything else to the default.
describe('coerceCategory', () => {
  it.each(DEFAULT_CATEGORY_IDS)('returns %s unchanged for the valid id', (id) => {
    expect(coerceCategory(id)).toBe(id)
  })

  it.each(INVALID_INPUTS)('folds %s to the default', (_label, input) => {
    expect(coerceCategory(input)).toBe('admin')
  })

  // Cross-check against the documented default rather than the literal, so a default drift is
  // caught here too.
  it('uses DEFAULT_CATEGORY_ID as the fallback value', () => {
    expect(coerceCategory('anything-invalid')).toBe(DEFAULT_CATEGORY_ID)
  })
})

// AC2 (fail-closed): isTrackableCategory reports the flag for known ids and can never report an
// unknown id as trackable.
describe('isTrackableCategory', () => {
  it.each(TRACKABLE_TABLE)('returns %s for the known id %s', (id, expectedTrackable) => {
    expect(isTrackableCategory(id)).toBe(expectedTrackable)
  })

  // AC2 / spec edge case: every invalid input must read as non-trackable, so an unknown id can
  // never inflate the quota numerator.
  it.each(INVALID_INPUTS)('returns false for %s', (_label, input) => {
    expect(isTrackableCategory(input)).toBe(false)
  })

  // AC2 consistency: for every default id the lookup agrees with its descriptor, proving there is
  // one source of truth for the flag.
  it.each(DEFAULT_CATEGORIES)('agrees with the descriptor for $id', (descriptor) => {
    expect(isTrackableCategory(descriptor.id)).toBe(descriptor.trackable)
  })
})

// The progressive-disclosure spec (docs/specs/planning/extend-tasks.md) turns the category from a
// printed word into a colour on the row edge and says the mapping is one shared contract living
// beside this one. AC18 fixes what a non-trackable category resolves to, D8 fixes that each
// trackable category gets a distinct hue and that the palette must extend to categories PLAN-30
// has not created yet, and the design stage (extend-tasks-design.md, "The palette rule") settled
// the ring and the two assignments. Expected values below come from those documents.

// The hue the design stage assigned each trackable category, and the neutral the other four take.
// A null means no edge is drawn at all, which is how an edge treatment renders AC18's neutral.
const EDGE_HUE_TABLE: Array<[string, number | null]> = [
  ['translation', 195],
  ['revision', 300],
  ['terminology', null],
  ['meetings', null],
  ['breaks', null],
  ['admin', null]
]

describe('CATEGORY_HUE_SLOTS', () => {
  // D8: the palette must be able to extend, because PLAN-30 lets the user create categories that
  // each need a colour. A ring sized to exactly the six defaults would have to be redone, so it has
  // to carry more slots than the defaults consume.
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

  // Two trackable categories pointing at the same slot would resolve to the same hue.
  it('gives each trackable category its own slot', () => {
    const slots = DEFAULT_CATEGORIES.map((category) => category.edgeSlot).filter(
      (slot) => slot !== null
    )
    expect(new Set(slots).size).toBe(slots.length)
  })
})

describe('categoryEdgeHue', () => {
  // The design stage's assignments, and AC18's neutral for the four that produce no words.
  it.each(EDGE_HUE_TABLE)('resolves %s to %s', (id, expected) => {
    expect(categoryEdgeHue(id)).toBe(expected)
  })

  // D8: the distinction the colour exists to make is Traduction against Révision, so those two can
  // never land on the same hue.
  it('gives translation and revision different hues', () => {
    expect(categoryEdgeHue('translation')).not.toBe(categoryEdgeHue('revision'))
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
