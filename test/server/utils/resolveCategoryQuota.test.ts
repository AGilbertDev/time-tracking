import type { CategoryQuotaRecord } from '~~/server/utils/resolveCategoryQuota'

import { resolveCategoryQuota, resolveTaskQuota } from '~~/server/utils/resolveCategoryQuota'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORY_IDS } from '#shared/categories'

// The per-category quota resolver, which is the whole of AC1 and AC2 of
// docs/specs/planning/per-category-quotas.md. Every expected value below is derived from that spec
// rather than from the implementation, because the resolver has no runtime caller yet and these tests
// are how the two criteria are demonstrated at all. AC10 says so in as many words, and it lists the
// cases: an empty history, a single row, a row not yet effective, several rows across a boundary
// date, unordered input, a non-trackable category, a task override, a task override on a
// non-trackable category, and a stored row for an id outside the contract.
//
// The resolution order the spec fixes, in the section headed "The resolution order":
//
//   0. The trackable gate. A non-trackable category has no quota whatever else is stored.
//   1. tasks.quota_wph_override, when it is not null.
//   2. The user's category_quotas row whose effective_from is the latest date at or before the task's.
//   3. The shipped default for that category, from the contract.
//   4. None.
//
// The gate is numbered zero here on purpose. The spec's own list puts it last and then spends a
// paragraph explaining that it is "a gate rather than a last resort", because the editor shows the
// quota field for every category deliberately, so a user can type an override onto a meeting and
// step 1 would otherwise hand that meeting a quota. The tests below assert it as a gate.
//
// Nothing here touches a database. The resolver is pure and takes the rows as an argument, so the
// read path is tested separately in loadCategoryQuotas.test.ts.

// The four shipped defaults from the spec's table under "The four shipped defaults".
//
// EXTERNAL REVISION IS DELIBERATELY THE FASTER NUMBER. 1300 for revision_external against 1000 for
// revision_internal reads like a transposition and the spec states twice that it is not one, because
// revising work that came from outside is expected to move quicker than revising work from inside.
// Any change that puts the larger figure on the internal side is undoing a decision rather than
// fixing a typo.
const SHIPPED_DEFAULTS: Array<[string, number]> = [
  ['translation', 240],
  ['revision_internal', 1000],
  ['revision_external', 1300],
  ['proofreading', 2000]
]

// The six ids the spec says are non-trackable and "carry no quota at all". `other` is in this list
// even though it is deliberately deliverable, because deliverable and trackable are two declared
// facts and only the second one reaches a quota.
const NON_TRACKABLE_IDS = ['terminology', 'meetings', 'breaks', 'admin', 'dtp', 'other']

// Values a stored category column can hold that name no current category. Each folds through
// coerceCategory to `other`, which is not trackable, so each resolves to none. This is the
// fail-closed direction the contract documents, and it is also the forward-compatibility seam: a
// user-created PLAN-30 id is the same case until PLAN-30 extends the validated set.
const UNKNOWN_CATEGORY_INPUTS: Array<[string, unknown]> = [
  ['an unknown string', 'does-not-exist'],
  ['the retired revision id', 'revision'],
  ['a user-created id', 'ma-categorie'],
  ['the empty string', ''],
  ['null', null],
  ['undefined', undefined],
  ['a number', 42],
  ['an object', { id: 'translation' }]
]

function record(categoryId: string, effectiveFrom: string, quotaWph: number): CategoryQuotaRecord {
  return { categoryId, effectiveFrom, quotaWph }
}

describe('resolveCategoryQuota', () => {
  describe('a fresh user with no stored rows (AC1)', () => {
    // The spec: "a fresh user with zero rows in category_quotas still resolves working quotas for all
    // four trackable categories. There is no bootstrap step, no seeding requirement, and no state in
    // which a trackable category has no answer."
    it.each(SHIPPED_DEFAULTS)(
      'resolves %s to its shipped default of %i words per hour',
      (categoryId, expected) => {
        expect(resolveCategoryQuota(categoryId, [], '2026-08-23')).toEqual({
          effectiveFrom: null,
          quotaWph: expected,
          source: 'default'
        })
      }
    )

    // The source field exists so the client never compares a figure against a hardcoded default to
    // decide what to label it, and effectiveFrom is null because a shipped default belongs to no
    // dated row. Both are asserted on their own rather than only inside the table above, because
    // AC6 has the API pass them straight through to the page.
    it('marks a default as coming from no dated row', () => {
      const resolved = resolveCategoryQuota('translation', [], '2026-08-23')

      expect(resolved?.source).toBe('default')
      expect(resolved?.effectiveFrom).toBeNull()
    })

    // The transposition guard, stated as a comparison rather than as two numbers, so a swap fails
    // here with a message about the direction rather than only as two unrelated table rows.
    it('keeps external revision faster than internal revision', () => {
      const external = resolveCategoryQuota('revision_external', [], '2026-08-23')
      const internal = resolveCategoryQuota('revision_internal', [], '2026-08-23')

      expect(external?.quotaWph).toBe(1300)
      expect(internal?.quotaWph).toBe(1000)
      expect(external?.quotaWph).toBeGreaterThan(internal?.quotaWph ?? 0)
    })
  })

  describe('the trackable gate (AC1)', () => {
    // The spec: "The resolver returns none, expressed as null, for every non-trackable category,
    // whatever the stored rows or the task's override say."
    it.each(NON_TRACKABLE_IDS)('resolves the non-trackable %s to none', (categoryId) => {
      expect(resolveCategoryQuota(categoryId, [], '2026-08-23')).toBeNull()
    })

    // `other` is the one member where trackable and deliverable disagree, so it is worth its own
    // case. It can carry words and a status and it must still never reach a quota.
    it('resolves other to none even though it is deliverable', () => {
      expect(resolveCategoryQuota('other', [], '2026-08-23')).toBeNull()
    })

    // The gate beats a stored row. A row for a non-trackable category is storable, because the table
    // takes a free-text category id and PLAN-30 may turn a trackable category into a non-trackable
    // one, and the spec's edge case "A stored row for a category that is trackable today and not
    // tomorrow" says the row stops contributing the moment the category stops being trackable.
    it.each(NON_TRACKABLE_IDS)(
      'ignores a stored row for the non-trackable %s rather than honouring it',
      (categoryId) => {
        const records = [record(categoryId, '2026-08-01', 900)]

        expect(resolveCategoryQuota(categoryId, records, '2026-08-23')).toBeNull()
      }
    )

    // Every one of the ten default ids resolves either a figure or null and nothing throws, which is
    // AC1's "verifiable by unit tests over all ten ids" read as totality.
    it.each(DEFAULT_CATEGORY_IDS)(
      'answers for the default id %s without throwing',
      (categoryId) => {
        expect(() => resolveCategoryQuota(categoryId, [], '2026-08-23')).not.toThrow()
      }
    )
  })

  describe('an unknown or stale category id', () => {
    // The spec's edge case "A stored row for a category id that no longer exists" and AC1's accessor
    // rule: an unknown id coerces to `other`, `other` is not trackable, so the answer is none.
    it.each(UNKNOWN_CATEGORY_INPUTS)('resolves %s to none', (_label, input) => {
      expect(resolveCategoryQuota(input, [], '2026-08-23')).toBeNull()
    })

    it.each(UNKNOWN_CATEGORY_INPUTS)('resolves %s to none without throwing', (_label, input) => {
      expect(() => resolveCategoryQuota(input, [], '2026-08-23')).not.toThrow()
    })

    // A stored row for an id outside the contract, which is the case AC10 names last. Asked about
    // that id, the gate coerces it to `other` and the answer is none, so the row never produces a
    // figure. This is also the forward-compatibility seam: the row is storable today, it is left in
    // place rather than deleted, and if PLAN-30 makes the id a real trackable category the row is
    // already there to be read.
    it('returns none for a stored row naming an id outside the contract', () => {
      const records = [record('ma-categorie', '2026-08-01', 500)]

      expect(resolveCategoryQuota('ma-categorie', records, '2026-08-23')).toBeNull()
    })

    // The other half of the same edge case, from the side of a category that does exist. A row
    // naming some other id never participates in an answer about translation, so an orphan row is
    // invisible rather than broken.
    it('never lets a row for another id answer for the category being asked about', () => {
      const records = [
        record('ma-categorie', '2026-08-01', 500),
        record('revision_internal', '2026-08-01', 700)
      ]

      expect(resolveCategoryQuota('translation', records, '2026-08-23')).toEqual({
        effectiveFrom: null,
        quotaWph: 240,
        source: 'default'
      })
    })
  })

  describe('a single stored row (AC2)', () => {
    it('resolves the stored figure for a date after the effective date', () => {
      const records = [record('translation', '2026-08-01', 300)]

      expect(resolveCategoryQuota('translation', records, '2026-08-23')).toEqual({
        effectiveFrom: '2026-08-01',
        quotaWph: 300,
        source: 'user'
      })
    })

    // "effective_from is the latest date less than or equal to the task's date", so a row dated
    // exactly on the date being resolved applies. This is the boundary the whole mechanism turns on.
    it('applies a row effective exactly on the date being resolved', () => {
      const records = [record('translation', '2026-08-23', 300)]

      expect(resolveCategoryQuota('translation', records, '2026-08-23')).toMatchObject({
        effectiveFrom: '2026-08-23',
        quotaWph: 300,
        source: 'user'
      })
    })

    // AC2: "Resolving a date before the earliest stored row for a category returns the shipped
    // default, so there is no discontinuity and no gap."
    it('falls back to the shipped default for the day before the row takes effect', () => {
      const records = [record('translation', '2026-08-23', 300)]

      expect(resolveCategoryQuota('translation', records, '2026-08-22')).toEqual({
        effectiveFrom: null,
        quotaWph: 240,
        source: 'default'
      })
    })

    // A future effectiveFrom is accepted by the API on purpose and "resolves for dates from that day
    // onward", so it changes nothing before then.
    it('ignores a row that is not yet effective and honours it from its own day onward', () => {
      const records = [record('translation', '2026-12-01', 320)]

      expect(resolveCategoryQuota('translation', records, '2026-08-23')?.source).toBe('default')
      expect(resolveCategoryQuota('translation', records, '2026-12-01')?.quotaWph).toBe(320)
      expect(resolveCategoryQuota('translation', records, '2027-01-15')?.quotaWph).toBe(320)
    })
  })

  describe('a history of several rows (AC2)', () => {
    // AC2's own verification, word for word: "a resolver test that reads a category on three dates
    // against a two-row history and gets the pre-history default, then the first value, then the
    // second".
    const history = [
      record('translation', '2026-06-01', 260),
      record('translation', '2026-08-01', 300)
    ]

    it('returns the shipped default for a date before the whole history', () => {
      expect(resolveCategoryQuota('translation', history, '2026-05-31')).toEqual({
        effectiveFrom: null,
        quotaWph: 240,
        source: 'default'
      })
    })

    it('returns the first stored figure for a date inside the first period', () => {
      expect(resolveCategoryQuota('translation', history, '2026-07-15')).toEqual({
        effectiveFrom: '2026-06-01',
        quotaWph: 260,
        source: 'user'
      })
    })

    it('returns the second stored figure for a date inside the second period', () => {
      expect(resolveCategoryQuota('translation', history, '2026-08-15')).toEqual({
        effectiveFrom: '2026-08-01',
        quotaWph: 300,
        source: 'user'
      })
    })

    // The boundary day itself belongs to the newer row, since the comparison is at or before.
    it('gives the boundary day to the newer row', () => {
      expect(resolveCategoryQuota('translation', history, '2026-08-01')).toMatchObject({
        effectiveFrom: '2026-08-01',
        quotaWph: 300
      })
    })

    it('picks the most recent of three rows at or before the date', () => {
      const records = [
        record('translation', '2026-06-01', 260),
        record('translation', '2026-07-01', 280),
        record('translation', '2026-08-01', 300)
      ]

      expect(resolveCategoryQuota('translation', records, '2026-07-20')).toMatchObject({
        effectiveFrom: '2026-07-01',
        quotaWph: 280
      })
    })

    // AC2's property, which is the point of the whole effective-dated shape: "adding a row dated
    // today changes nothing about what any earlier date resolves to". Asserted as a comparison of
    // the same dates before and after the append rather than as a set of fixed expectations, so it
    // reads as the property it is.
    it('changes nothing about any earlier date when a row dated today is added', () => {
      const earlier = ['2026-05-31', '2026-06-01', '2026-07-15', '2026-08-01', '2026-08-22']
      const before = earlier.map((date) => resolveCategoryQuota('translation', history, date))

      const withToday = [...history, record('translation', '2026-08-23', 999)]
      const after = earlier.map((date) => resolveCategoryQuota('translation', withToday, date))

      expect(after).toEqual(before)
      // And the new row does take effect from its own day, so the assertion above is about the past
      // rather than about the row having been ignored.
      expect(resolveCategoryQuota('translation', withToday, '2026-08-23')?.quotaWph).toBe(999)
    })

    // The read path orders by effective_from ascending, and the spec calls that "an optimisation
    // rather than a precondition", so an unordered list has to resolve identically.
    it('resolves an unordered list the same as an ordered one', () => {
      const ordered = [
        record('translation', '2026-06-01', 260),
        record('translation', '2026-07-01', 280),
        record('translation', '2026-08-01', 300)
      ]
      const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!]

      for (const date of ['2026-05-01', '2026-06-15', '2026-07-15', '2026-08-15']) {
        expect(resolveCategoryQuota('translation', shuffled, date)).toEqual(
          resolveCategoryQuota('translation', ordered, date)
        )
      }
    })

    // Each category is resolved on its own history, so two categories saved on different days do not
    // borrow each other's figures.
    it('keeps each category on its own history', () => {
      const records = [
        record('translation', '2026-08-01', 300),
        record('proofreading', '2026-06-01', 1800)
      ]

      expect(resolveCategoryQuota('translation', records, '2026-08-23')?.quotaWph).toBe(300)
      expect(resolveCategoryQuota('proofreading', records, '2026-08-23')?.quotaWph).toBe(1800)
      expect(resolveCategoryQuota('revision_external', records, '2026-08-23')).toEqual({
        effectiveFrom: null,
        quotaWph: 1300,
        source: 'default'
      })
    })

    // A stored figure the shipped default would never produce, to prove the stored row is really
    // what is being read rather than the default agreeing by coincidence. The app accepts an
    // unusually high or low figure inside the schema's range without comment, per the do-not-police
    // rule, so 1 and 10000 are ordinary stored values here.
    it.each([1, 10000])('resolves a stored figure of %i rather than the default', (quotaWph) => {
      const records = [record('translation', '2026-08-01', quotaWph)]

      expect(resolveCategoryQuota('translation', records, '2026-08-23')).toMatchObject({
        quotaWph,
        source: 'user'
      })
    })
  })
})

describe('resolveTaskQuota', () => {
  describe('the trackable gate comes before the override', () => {
    // The spec's edge case "A task carrying an override on a non-trackable category": the override is
    // storable today because the editor shows the quota field for every category on purpose, and the
    // resolver "gates on trackable first, so the override never produces a quota for a meeting or a
    // break".
    it.each(NON_TRACKABLE_IDS)(
      'returns none for %s even when the task carries an override',
      (category) => {
        const task = { category, date: '2026-08-23', quotaWphOverride: 900 }

        expect(resolveTaskQuota(task, [])).toBeNull()
      }
    )

    // The same gate with a stored row behind it as well, so neither of the two sources can slip past.
    it('returns none for a non-trackable category carrying both an override and a stored row', () => {
      const task = { category: 'meetings', date: '2026-08-23', quotaWphOverride: 900 }
      const records = [record('meetings', '2026-08-01', 700)]

      expect(resolveTaskQuota(task, records)).toBeNull()
    })

    it.each(UNKNOWN_CATEGORY_INPUTS)(
      'returns none for a task whose category is %s, override or not',
      (_label, category) => {
        expect(resolveTaskQuota({ category, date: '2026-08-23' }, [])).toBeNull()
        expect(
          resolveTaskQuota({ category, date: '2026-08-23', quotaWphOverride: 900 }, [])
        ).toBeNull()
      }
    )
  })

  describe('the override, when the category is trackable', () => {
    it('wins over both a stored row and the shipped default', () => {
      const task = { category: 'translation', date: '2026-08-23', quotaWphOverride: 400 }
      const records = [record('translation', '2026-08-01', 300)]

      expect(resolveTaskQuota(task, records)).toEqual({
        effectiveFrom: null,
        quotaWph: 400,
        source: 'override'
      })
    })

    // effectiveFrom is null for an override because a per-task override is not effective-dated, and
    // the source is what tells an override apart from a default.
    it('reports no effective date for an override', () => {
      const task = { category: 'translation', date: '2026-08-23', quotaWphOverride: 400 }

      expect(resolveTaskQuota(task, [])).toEqual({
        effectiveFrom: null,
        quotaWph: 400,
        source: 'override'
      })
    })

    // The floor of the shared validator is 1, so an override of 1 is a legal stored value and has to
    // be honoured rather than read as absent.
    it('honours an override of 1 rather than treating it as absent', () => {
      const task = { category: 'translation', date: '2026-08-23', quotaWphOverride: 1 }

      expect(resolveTaskQuota(task, [])).toMatchObject({ quotaWph: 1, source: 'override' })
    })
  })

  describe('an override that cannot be a divisor', () => {
    // The quota is the divisor in words over quota, so a stored 0 is not a small quota, it is a
    // division by zero waiting for PLAN-12 to read it. No API path can write one today, because
    // quotaWphSchema floors the override at 1 on every boundary that accepts it, so this is defence
    // against a row that arrived some other way rather than a live bug.
    //
    // An unusable value costs the override and nothing else. It is treated as no override at all,
    // which is the same path a NULL takes, so the task falls through to its category's stored row and
    // then to the shipped default. Resolving the whole task to none would throw away a perfectly good
    // category figure to punish one bad column, and the row would then read as carrying no quota when
    // its category plainly has one.
    const UNUSABLE_OVERRIDES: Array<[string, number]> = [
      ['zero', 0],
      ['a negative figure', -100],
      ['NaN', Number.NaN]
    ]

    it.each(UNUSABLE_OVERRIDES)(
      'falls through to the stored row when the override is %s',
      (_label, quotaWphOverride) => {
        const task = { category: 'translation', date: '2026-08-23', quotaWphOverride }
        const records = [record('translation', '2026-08-01', 300)]

        expect(resolveTaskQuota(task, records)).toEqual({
          effectiveFrom: '2026-08-01',
          quotaWph: 300,
          source: 'user'
        })
      }
    )

    it.each(UNUSABLE_OVERRIDES)(
      'falls through to the shipped default when the override is %s and there is no row',
      (_label, quotaWphOverride) => {
        const task = { category: 'translation', date: '2026-08-23', quotaWphOverride }

        expect(resolveTaskQuota(task, [])).toEqual({
          effectiveFrom: null,
          quotaWph: 240,
          source: 'default'
        })
      }
    )

    // The two answers this must never give, stated as their own case so a regression says which of
    // the two failures happened. Reporting the source as an override would put the unusable figure
    // itself on screen, and returning null would hide a category quota the task really has.
    it.each(UNUSABLE_OVERRIDES)(
      'never reports %s as an override and never returns none',
      (_label, quotaWphOverride) => {
        const task = { category: 'translation', date: '2026-08-23', quotaWphOverride }

        expect(resolveTaskQuota(task, [])).not.toBeNull()
        expect(resolveTaskQuota(task, [])?.source).not.toBe('override')
        expect(resolveTaskQuota(task, [])?.quotaWph).not.toBe(quotaWphOverride)
      }
    )

    // The boundary the condition turns on, so a floor written as greater than 1 would fail here
    // rather than pass quietly. 1 is a legal stored override and it wins, 0 is not and it does not.
    it('keeps 1 as an override while 0 falls through', () => {
      const date = '2026-08-23'

      expect(
        resolveTaskQuota({ category: 'translation', date, quotaWphOverride: 1 }, [])
      ).toMatchObject({ quotaWph: 1, source: 'override' })
      expect(
        resolveTaskQuota({ category: 'translation', date, quotaWphOverride: 0 }, [])
      ).toMatchObject({ quotaWph: 240, source: 'default' })
    })

    // The gate still comes first, so an unusable override on a non-trackable category resolves to none
    // for the category's sake rather than falling through to a figure.
    it.each(NON_TRACKABLE_IDS)('still returns none for %s carrying a zero override', (category) => {
      expect(resolveTaskQuota({ category, date: '2026-08-23', quotaWphOverride: 0 }, [])).toBeNull()
    })
  })

  describe('no override, so the category resolution applies', () => {
    it.each([
      ['null', null],
      ['undefined', undefined]
    ])('falls through to the stored row when the override is %s', (_label, quotaWphOverride) => {
      const task = { category: 'translation', date: '2026-08-23', quotaWphOverride }
      const records = [record('translation', '2026-08-01', 300)]

      expect(resolveTaskQuota(task, records)).toEqual({
        effectiveFrom: '2026-08-01',
        quotaWph: 300,
        source: 'user'
      })
    })

    it('falls through to the stored row when the field is absent altogether', () => {
      const task = { category: 'translation', date: '2026-08-23' }
      const records = [record('translation', '2026-08-01', 300)]

      expect(resolveTaskQuota(task, records)).toMatchObject({ quotaWph: 300, source: 'user' })
    })

    it('falls through to the shipped default when the user has no row', () => {
      const task = { category: 'proofreading', date: '2026-08-23' }

      expect(resolveTaskQuota(task, [])).toEqual({
        effectiveFrom: null,
        quotaWph: 2000,
        source: 'default'
      })
    })

    // The date the resolution is made on is the task's own date, which is what makes a past task keep
    // the figure that was in force when it was worked rather than picking up a later edit.
    it("resolves against the task's own date rather than any other", () => {
      const records = [
        record('translation', '2026-06-01', 260),
        record('translation', '2026-08-01', 300)
      ]

      expect(
        resolveTaskQuota({ category: 'translation', date: '2026-07-15' }, records)
      ).toMatchObject({ effectiveFrom: '2026-06-01', quotaWph: 260 })
      expect(
        resolveTaskQuota({ category: 'translation', date: '2026-05-01' }, records)
      ).toMatchObject({ effectiveFrom: null, source: 'default' })
    })
  })
})
