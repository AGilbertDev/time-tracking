import { describe, expect, it } from 'vitest'

import {
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
