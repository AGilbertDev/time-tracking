import enMessages from '~~/i18n/locales/en.json'
import frMessages from '~~/i18n/locales/fr.json'
import { describe, expect, it } from 'vitest'

import {
  categoryHue,
  coerceCategory,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  DEFAULT_CATEGORY_IDS,
  isDeliverableCategory,
  isTrackableCategory
} from '#shared/categories'

// The nine-categories spec (docs/specs/planning/nine-task-categories.md) replaced the six ids that
// PLAN-02 shipped with the nine the user actually uses. It locked the membership
// and the order (AC1), the confirmed French and English copy (AC2), the coercion of the now stale
// revision id (AC4), and a real locale key for every id in both files (AC6). The fail-closed
// coercion that PLAN-02 established still holds and is still asserted here, since the quota engine
// (PLAN-22), the task row UI (PLAN-06), and the write API (PLAN-09) all rest on it.
//
// The colour half of the contract comes from the coloured-names spec
// (docs/specs/planning/category-column-coloured-names.md) and its design blueprint. AC2 there makes
// this module the single source of truth for which category is which colour, and the blueprint's
// resolved palette fixes the hues. Expected values throughout are derived from those specs, not
// from the implementation.
//
// The other-category spec (docs/specs/planning/other-category.md) then added a tenth id, `other`,
// and its criteria are numbered UC rather than AC because it landed on a branch that already
// numbered to AC70. It moves the count from nine to ten (UC1), moves the safe fallback and the
// create default from admin to other (UC3, UC4), and splits the single trackable flag into two
// declared facts (UC8). Every assertion in this file that used to say nine or admin was updated to
// the ruling rather than removed, because those failures were the suite doing its job.
//
// The split is the part worth understanding before editing anything below. `trackable` answers
// whether the row's words reach the quota. `deliverable` answers whether the row is work that can be
// in progress, so whether a status and a word count mean anything on it. Nine ids answer both the
// same way and `other` is the one that does not, being non-trackable and still carrying a status.
// Assertions about a quota read the first, assertions about a status or an N/A reading read the
// second, and collapsing them back into one flag is what this file now exists to prevent.

// The locked order and membership from AC1, the spec's category table, and UC1 for the tenth. `other`
// is last and the original nine keep their positions, so nothing reading the tuple by index moved.
const EXPECTED_ORDER = [
  'translation',
  'revision_internal',
  'revision_external',
  'proofreading',
  'terminology',
  'meetings',
  'breaks',
  'admin',
  'dtp',
  'other'
]

// Spec-derived trackable table (AC1, and UC2 for the tenth). The four members that produce billable
// words are trackable and the six that only consume scheduled time are not. `other` is false here on
// purpose. It is the create default and the coercion target, so a figure it could move is a figure
// an unclassified row could corrupt, and being non-trackable is what makes it safe to default to.
const TRACKABLE_TABLE: Array<[string, boolean]> = [
  ['translation', true],
  ['revision_internal', true],
  ['revision_external', true],
  ['proofreading', true],
  ['terminology', false],
  ['meetings', false],
  ['breaks', false],
  ['admin', false],
  ['dtp', false],
  ['other', false]
]

// Spec-derived deliverable table (UC8). True for the four trackable ids and for `other`, false for
// the five kinds of consumed time. This is the table that differs from TRACKABLE_TABLE above, and it
// differs on exactly one row, which is the whole reason the second flag exists. A break, a meeting,
// administration, desktop publishing, and terminology work have no deliverable, so a status on one
// would contradict every other reading of the row. `other` is work of a kind the user did not name,
// so it can be in progress and it can carry words.
const DELIVERABLE_TABLE: Array<[string, boolean]> = [
  ['translation', true],
  ['revision_internal', true],
  ['revision_external', true],
  ['proofreading', true],
  ['terminology', false],
  ['meetings', false],
  ['breaks', false],
  ['admin', false],
  ['dtp', false],
  ['other', true]
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
//
// `other` at 90 comes from the other-category design stage (UC28). It is the maximum of the minimum
// Oklab chord from a candidate hue to the existing nine, so it is the best placement left on the
// wheel, and its neighbours dtp at 60 and revision_external at 115 sit about 0.05 away, which is
// roughly the deliberate revision sibling spacing. The palette is full at ten, so an eleventh hue
// cannot be added by eye and this table is not the place to try.
const CATEGORY_HUE_TABLE: Array<[string, number]> = [
  ['translation', 195],
  ['revision_internal', 140],
  ['revision_external', 115],
  ['proofreading', 230],
  ['terminology', 20],
  ['meetings', 340],
  ['breaks', 265],
  ['admin', 305],
  ['dtp', 60],
  ['other', 90]
]

describe('shared/categories', () => {
  // AC1 and UC1: DEFAULT_CATEGORY_IDS equals exactly the ten ids in the locked order.
  it('exposes exactly the ten default category ids in the locked order', () => {
    expect(DEFAULT_CATEGORY_IDS).toEqual(EXPECTED_ORDER)
  })

  it('has exactly ten default category ids', () => {
    expect(DEFAULT_CATEGORY_IDS).toHaveLength(10)
  })

  // UC1: `other` is tenth and last, and none of the original nine changed index. Asserted by
  // position rather than by membership, because the criterion is about the indexes holding still for
  // anything that reads this tuple positionally, not merely about the id being present somewhere.
  it('adds other in tenth place without moving any of the original nine', () => {
    expect(DEFAULT_CATEGORY_IDS[9]).toBe('other')
    expect(DEFAULT_CATEGORY_IDS.slice(0, 9)).toEqual([
      'translation',
      'revision_internal',
      'revision_external',
      'proofreading',
      'terminology',
      'meetings',
      'breaks',
      'admin',
      'dtp'
    ])
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
  // AC1, superseded by UC2: exactly ten descriptors ship. This assertion read nine and no tenth
  // category until the other-category spec ruled a tenth, which is why it now reads ten rather than
  // having been softened to a lower bound. A count is the point of it.
  it('contains exactly ten descriptors', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(10)
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

  it('has exactly six non-trackable categories', () => {
    expect(DEFAULT_CATEGORIES.filter((category) => !category.trackable)).toHaveLength(6)
  })

  // AC1 states the trackable split by membership as well as by count, and the four are the members
  // whose words reach the quota numerator, so naming them is worth more than counting them. The
  // tenth category does not join them, which is what keeps the create default from moving a figure.
  it('marks translation, both revisions, and proofreading as the four trackable ids', () => {
    const trackable = DEFAULT_CATEGORIES.filter((category) => category.trackable)
    expect(trackable.map((category) => category.id)).toEqual([
      'translation',
      'revision_internal',
      'revision_external',
      'proofreading'
    ])
  })

  // UC8: every id maps to its locked deliverable flag, which is the second declared fact rather than
  // a rederivation of the first.
  it.each(DELIVERABLE_TABLE)('marks %s as deliverable=%s', (id, expectedDeliverable) => {
    const descriptor = DEFAULT_CATEGORIES.find((category) => category.id === id)
    expect(descriptor).toBeDefined()
    expect(descriptor?.deliverable).toBe(expectedDeliverable)
  })

  // UC8: every descriptor declares the flag explicitly. A missing key would read as falsy at every
  // call site and silently disable a status field, so absence is a failure rather than a default.
  it.each(DEFAULT_CATEGORIES)('declares an explicit boolean deliverable for $id', (descriptor) => {
    expect(descriptor).toHaveProperty('deliverable')
    expect(typeof descriptor.deliverable).toBe('boolean')
  })

  // UC8: five deliverables and five not, which is a different split from the trackable four and six
  // above. Two counts that differ is the cheapest possible proof that the two flags are not the same
  // fact under two names.
  it('has exactly five deliverable categories, a different split from the trackable four', () => {
    const deliverable = DEFAULT_CATEGORIES.filter((category) => category.deliverable)
    const trackable = DEFAULT_CATEGORIES.filter((category) => category.trackable)
    expect(deliverable).toHaveLength(5)
    expect(trackable).toHaveLength(4)
    expect(deliverable.map((category) => category.id)).toEqual([
      'translation',
      'revision_internal',
      'revision_external',
      'proofreading',
      'other'
    ])
  })

  // UC9, and the invariant that stops the two flags being declared in a combination that means
  // nothing. A trackable category whose words feed the quota but which cannot be in progress is not a
  // thing, so no descriptor may say trackable: true with deliverable: false. This is a check rather
  // than a comment because PLAN-30 will add descriptors nobody reviews, and it names the offenders so
  // a failure points at the row rather than at a count.
  it('never declares a trackable category as non-deliverable', () => {
    const contradictory = DEFAULT_CATEGORIES.filter(
      (category) => category.trackable && !category.deliverable
    )
    expect(contradictory.map((category) => category.id)).toEqual([])
  })

  // UC8, stated from the side that changed. `other` is the only member where the two flags disagree,
  // so this pins the disagreement to one id. A second member drifting into it is a contract decision
  // that should fail here and be argued for, not something to discover from a broken status field.
  it('has other as the only member whose two flags disagree', () => {
    const disagreeing = DEFAULT_CATEGORIES.filter(
      (category) => category.trackable !== category.deliverable
    )
    expect(disagreeing.map((category) => category.id)).toEqual(['other'])
  })

  // UC16: nothing an other task holds can reach a quota numerator or denominator, asserted from the
  // contract because the quota engine (PLAN-22) does not exist yet. When it does, it reads this flag.
  it('keeps other out of the quota while still letting it carry a status', () => {
    const other = DEFAULT_CATEGORIES.find((category) => category.id === 'other')
    expect(other?.trackable).toBe(false)
    expect(other?.deliverable).toBe(true)
    expect(isTrackableCategory('other')).toBe(false)
    expect(isDeliverableCategory('other')).toBe(true)
  })
})

describe('DEFAULT_CATEGORY_ID', () => {
  // UC3, superseding AC4. The safe fallback moved from admin to other on the owner's ruling of
  // 2026-07-31, quoted in the contract as "Admin is time tracking, email, etc". Administration is
  // real work a translator books time against, so coercing an unknown or retired value into it makes
  // the row assert something false and quietly inflates a real category. The one place in the app
  // that exists to fail safely was adding fictional administration hours.
  //
  // This assertion read admin before that ruling. It is updated rather than deleted, and a reader who
  // arrives wanting to move it back should read the contract comment first.
  it('is other', () => {
    expect(DEFAULT_CATEGORY_ID).toBe('other')
  })

  it('is one of the default category ids', () => {
    expect(DEFAULT_CATEGORY_IDS as readonly string[]).toContain(DEFAULT_CATEGORY_ID)
  })

  // AC4, unchanged by the move: the fallback must be non-trackable, checked via the descriptor. This
  // is the fail-closed property the quota rests on and the new fallback keeps it.
  it('is non-trackable per its descriptor', () => {
    const descriptor = DEFAULT_CATEGORIES.find((category) => category.id === DEFAULT_CATEGORY_ID)
    expect(descriptor?.trackable).toBe(false)
  })

  // AC4 and UC5: cross-checked via the public trackable lookup as well.
  it('is non-trackable per isTrackableCategory', () => {
    expect(isTrackableCategory(DEFAULT_CATEGORY_ID)).toBe(false)
  })

  // UC8: the fallback does carry a status, which is the half that is new. A legacy row holding a
  // retired id and a real stored status reads as finished after this change instead of as N/A, and
  // that is the point of the fallback being deliverable rather than an oversight.
  it('is deliverable, so a coerced row keeps a meaningful status', () => {
    const descriptor = DEFAULT_CATEGORIES.find((category) => category.id === DEFAULT_CATEGORY_ID)
    expect(descriptor?.deliverable).toBe(true)
    expect(isDeliverableCategory(DEFAULT_CATEGORY_ID)).toBe(true)
  })

  // UC3: one constant does both jobs, the coercion fallback and the create default, because they
  // answer the same question. The write boundary reads this same constant for its Zod default, so a
  // second literal cannot drift from it.
  it('is the value the write boundary defaults a create to', () => {
    expect(coerceCategory('anything-unknown')).toBe(DEFAULT_CATEGORY_ID)
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
    expect(coerceCategory(input)).toBe('other')
  })

  // UC4: admin is returned for the input admin and for nothing else. This is the assertion that would
  // catch a partial revert, where the tuple keeps `other` but the fallback goes back to admin, because
  // every INVALID_INPUTS case above would then land on admin while still passing a laxer check.
  it('returns admin only for the literal admin and never as a fallback', () => {
    expect(coerceCategory('admin')).toBe('admin')
    for (const [, input] of INVALID_INPUTS) {
      expect(coerceCategory(input)).not.toBe('admin')
    }
  })

  // AC4, and the most load-bearing behaviour in the nine-categories feature, now reversed in its
  // destination by UC4. Seeded rows in the dev database still carry revision, and that id is retired.
  // A stored revision still has to resolve to a valid non-trackable id so its words can never enter
  // the quota numerator and inflate the headline number read at review time, and that half is
  // unchanged.
  //
  // What changed is which id it lands on. Reading as administration was safe for the quota and wrong
  // for the user, because it asserted the row was time tracking and email when nothing knew what it
  // was. Reading as Autre asserts only what is actually known, which is that the kind of work is not
  // recorded, and it is still non-trackable so the quota is protected exactly as before.
  it('folds a stored revision to a non-trackable other so its words can never reach the quota numerator', () => {
    expect(coerceCategory('revision')).toBe('other')
    expect(isTrackableCategory('revision')).toBe(false)
  })

  // UC4 and the spec's edge case for a legacy row. A retired id is deliverable after coercion, so a
  // stored status on such a row becomes visible again instead of being hidden behind an N/A the user
  // never asked for. Nothing rewrites the stored value, so this is a read-path improvement on data
  // that is already there.
  it('makes a coerced legacy row deliverable so its stored status is not hidden', () => {
    expect(isDeliverableCategory('revision')).toBe(true)
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

// UC8: isDeliverableCategory is the second lookup, beside isTrackableCategory rather than derived
// from it. It answers whether a row is work that can be in progress, so it is what the status
// control's disabled state, statusKey's N/A guard, and the words cell all read.
describe('isDeliverableCategory', () => {
  it.each(DELIVERABLE_TABLE)('returns %s for the known id %s', (id, expectedDeliverable) => {
    expect(isDeliverableCategory(id)).toBe(expectedDeliverable)
  })

  // UC8: it coerces first, so an unknown id inherits `other`'s answer, which is true. This is the
  // opposite fail direction from isTrackableCategory and it is deliberate. The risk on this flag is
  // hiding a status the user stored, not inflating a number, so a legacy row with a real stored
  // status should show it rather than read as N/A.
  it.each(INVALID_INPUTS)('returns true for %s, inheriting the default answer', (_label, input) => {
    expect(isDeliverableCategory(input)).toBe(true)
  })

  // Consistency with the descriptors, the same property isTrackableCategory has, so there is one
  // declaration of the flag rather than a function and a table that can drift.
  it.each(DEFAULT_CATEGORIES)('agrees with the descriptor for $id', (descriptor) => {
    expect(isDeliverableCategory(descriptor.id)).toBe(descriptor.deliverable)
  })

  // The two lookups are not interchangeable, asserted directly rather than left to be inferred from
  // the two tables above. A future reader who deletes one function and points its callers at the other
  // fails here, which is the whole reason this describe block exists.
  it('disagrees with isTrackableCategory on exactly one default id', () => {
    const disagreeing = DEFAULT_CATEGORY_IDS.filter(
      (id) => isTrackableCategory(id) !== isDeliverableCategory(id)
    )
    expect(disagreeing).toEqual(['other'])
  })

  // And they disagree on an unknown value too, because the fallback is the disagreeing member. This
  // is the case a call site is most likely to get wrong, since a stale stored id reaches both.
  it('disagrees with isTrackableCategory on an unknown stored value', () => {
    expect(isTrackableCategory('revision')).toBe(false)
    expect(isDeliverableCategory('revision')).toBe(true)
  })
})

// UC15 and UC43. The two predicates fail in opposite directions on an unknown id, deliberately, and
// the reason has to be readable from the test names rather than only from the contract comment. Read
// side by side the two directions look inconsistent, so a later reader who sees only the mismatch will
// make one match the other and quietly break whichever they touch. That is the regression this block
// exists to catch, and it is why each name below carries its own reason instead of saying that the
// function returns false or true.
//
// The unifying principle is that the safer error is the one that does not destroy or misstate the
// user's own data. Inflating a quota invents work that was never done. Hiding a stored status conceals
// something the user deliberately recorded. Both directions follow that single rule applied to two
// different risks, so the apparent inconsistency is the rule working rather than a defect.
//
// The blocks above already assert both directions across the whole INVALID_INPUTS table. These
// assertions are not that coverage repeated. They are the statement of intent that survives a reader
// who arrives believing one of the two is a bug, which is a different job from coverage and is the
// reason they are named the way they are.
describe('the two predicates fail in opposite directions on purpose', () => {
  it('fails closed on an unknown id for the quota question, so a stray value cannot inflate a quota', () => {
    expect(isTrackableCategory('does-not-exist')).toBe(false)
    expect(isTrackableCategory('revision')).toBe(false)
    expect(isTrackableCategory(null)).toBe(false)
  })

  it('fails open on an unknown id for the status question, so a stray value cannot hide a status the user stored', () => {
    expect(isDeliverableCategory('does-not-exist')).toBe(true)
    expect(isDeliverableCategory('revision')).toBe(true)
    expect(isDeliverableCategory(null)).toBe(true)
  })

  // Stated as one assertion as well as two, because the relationship is the thing a later reader needs
  // and two separate checks are what let it be read as an inconsistency. Either direction being
  // "corrected" to match the other fails here with both halves in front of the reader.
  it('never answers an unknown id the same way twice, since the two risks pull opposite ways', () => {
    for (const [, input] of INVALID_INPUTS) {
      expect(isTrackableCategory(input)).toBe(false)
      expect(isDeliverableCategory(input)).toBe(true)
      expect(isTrackableCategory(input)).not.toBe(isDeliverableCategory(input))
    }
  })

  // The direction each one fails in is the direction that protects data rather than the direction that
  // happens to be conservative. Being conservative on the status question is what caused the defect the
  // fallback move fixes, since a stored `Terminé` on a legacy row read as not-applicable and the user
  // could not see the value they had set.
  it('makes the safe answer the one that does not misstate what the user recorded', () => {
    // A legacy row holding a retired id. Its words must never reach a quota, and its stored status
    // must still be shown, so the same input has to answer the two questions differently.
    expect(isTrackableCategory('revision')).toBe(false)
    expect(isDeliverableCategory('revision')).toBe(true)
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
  it('gives every one of the ten categories a hue, trackable or not', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(10)
    for (const descriptor of DEFAULT_CATEGORIES) {
      expect(descriptor.hue).not.toBeNull()
      expect(descriptor.hue).not.toBeUndefined()
      expect(typeof descriptor.hue).toBe('number')
    }
  })

  // The same reversal stated from the non-trackable side, which is the half that changed. A meeting,
  // a break, administration, terminology, and page layout are all kinds of work the user wants to
  // recognize by colour, so none of the five may resolve to nothing.
  it('colours the six non-trackable categories too', () => {
    const nonTrackable = DEFAULT_CATEGORIES.filter((category) => !category.trackable)
    expect(nonTrackable.map((category) => category.id)).toEqual([
      'terminology',
      'meetings',
      'breaks',
      'admin',
      'dtp',
      'other'
    ])
    expect(nonTrackable.every((category) => typeof category.hue === 'number')).toBe(true)
  })

  // UC28 and the design stage's ruling. `other` takes an ordinary hue at the shared chroma rather than
  // a neutral, and no exception to the fixed lightness and chroma was taken, so the descriptor carries
  // one integer and nothing else. A neutral would have collided with the row's own muted text and read
  // as de-emphasised rather than as a category colour, which would say the row is lesser. It is not.
  it('gives other an ordinary hue with no per-category colour override', () => {
    const other = DEFAULT_CATEGORIES.find((category) => category.id === 'other')
    expect(other?.hue).toBe(90)
    expect(Object.keys(other ?? {}).sort()).toEqual(['deliverable', 'hue', 'id', 'trackable'])
  })

  // Two categories sharing a hue would defeat the whole point, which is telling one kind of work
  // from another at a glance. With every category coloured this now covers all ten rather than the
  // four that used to hold a slot.
  it('gives each of the ten categories its own hue', () => {
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

  // AC2 asks for every one of them to resolve through the contract to a colour, so the whole set
  // is checked as a set rather than only row by row.
  it('resolves all ten ids to ten distinct hues', () => {
    const hues = DEFAULT_CATEGORY_IDS.map((id) => categoryHue(id))
    expect(hues).toHaveLength(10)
    expect(new Set(hues).size).toBe(10)
  })

  // The public function agrees with the descriptor for every default id, so there is one mapping
  // rather than a function and a table that can drift.
  it.each(DEFAULT_CATEGORIES)('agrees with the descriptor hue for $id', (descriptor) => {
    expect(categoryHue(descriptor.id)).toBe(descriptor.hue)
  })

  // Totality, which is the fifth thing the spec's new shape had to express. The row hands this
  // function whatever the free-text category column holds, so no input may return null or undefined
  // and none may throw. Every invalid value coerces to the default first and therefore takes the
  // default's hue, which UC6 moves from admin's 305 to 90. It borrows the fallback's colour rather
  // than another category's, so a stale row can never claim to be translation work.
  //
  // One visible consequence, worth stating because it changes existing data with no migration behind
  // it. A row holding the retired revision printed Administration in violet and now prints Autre in
  // khaki. That is the intended outcome of moving the fallback.
  it.each(INVALID_INPUTS)('resolves %s to a real hue rather than nothing', (_label, input) => {
    expect(() => categoryHue(input)).not.toThrow()
    const hue = categoryHue(input)
    expect(hue).not.toBeNull()
    expect(hue).not.toBeUndefined()
    expect(typeof hue).toBe('number')
    expect(hue).toBe(90)
  })

  // UC6 states this as its own criterion, that an unknown value no longer returns admin's 305, so it
  // is asserted on its own rather than only as part of the table above. The contract comment claiming
  // an unknown value borrows admin's colour was corrected in the same change.
  it('no longer gives an unknown value admin 305', () => {
    expect(categoryHue('does-not-exist')).not.toBe(305)
    expect(categoryHue('admin')).toBe(305)
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
//
// The tenth row is settled by the owner on 2026-07-31 (UC30 and the spec's copy table). Autre and
// Other were chosen over the Sans catégorie and No category the spec first proposed, and over
// Non catégorisé. The id followed the copy rather than the copy following the id, which is why the
// stored value is `other`. Autre reads as a real category, one more kind of work the user did, where
// Sans catégorie reads as a field left empty, and an id saying the row has no category under a name
// saying it is other work is how a later reader invents a distinction that does not exist.
const CATEGORY_NAME_TABLE: Array<[string, string, string]> = [
  ['translation', 'Traduction', 'Translation'],
  ['revision_internal', 'Révision interne', 'Internal revision'],
  ['revision_external', 'Révision externe', 'External revision'],
  ['proofreading', 'Relecture', 'Proofreading'],
  ['terminology', 'Terminologie', 'Terminology'],
  ['meetings', 'Réunions', 'Meetings'],
  ['breaks', 'Pauses', 'Breaks'],
  ['admin', 'Administration', 'Admin'],
  ['dtp', 'Mise en page', 'DTP'],
  ['other', 'Autre', 'Other']
]

const LOCALE_TABLE: Array<[string, Record<string, string>]> = [
  ['French', FR_CATEGORIES],
  ['English', EN_CATEGORIES]
]

describe('i18n category names', () => {
  // AC6 and UC31, and the reason the contract change and the locale change were made in one step
  // rather than two. This block is driven by DEFAULT_CATEGORY_IDS rather than by a hardcoded list, so
  // adding an id to the contract without adding its key to both files fails here immediately. Ten ids
  // shipping against nine keys renders a raw key string in the category column and nothing in the
  // build catches it, so the intermediate state was never allowed to exist even inside one branch.
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

  // AC6 and UC30: neither file holds a categories key outside the declared set, so no dead copy is
  // left behind that no id can reach. Equality in both directions is what makes this the parity guard
  // rather than a one-way completeness check, so a stray key and a missing key both fail.
  it.each(LOCALE_TABLE)('holds no %s category key outside the contract', (_locale, messages) => {
    expect(Object.keys(messages).sort()).toEqual([...DEFAULT_CATEGORY_IDS].sort())
  })

  // UC30: the tenth key exists in both files. Asserted on its own as well as through the id-driven
  // tables above, because this is the key the contract change would otherwise have shipped without.
  it('carries the tenth category key in both locale files', () => {
    expect(FR_CATEGORIES.other).toBe('Autre')
    expect(EN_CATEGORIES.other).toBe('Other')
  })

  // UC7 asks that no retired spelling of the tenth id survives anywhere in the code, and it needs no
  // assertion of its own here. The exact-key-set equality above already fails on any key the contract
  // cannot reach, whatever it is called, so a leftover from an earlier draft of the id would be caught
  // as a dead key rather than needing to be named. Naming it would also put the retired word back into
  // the tree that UC7 asks to be free of it.

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
