import type { CategoryQuotaRecord } from '~~/server/utils/resolveCategoryQuota'

import { resolveCategoryQuota, resolveTaskQuota } from '~~/server/utils/resolveCategoryQuota'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORY_IDS } from '#shared/categories'

// The per-category quota resolver, which is the whole of AC1 and part of AC2 of
// docs/specs/planning/per-category-quotas.md. Every expected value below is derived from that spec
// rather than from the implementation.
//
// The resolution order the spec fixes, in the section headed "The resolution order":
//
//   0. The trackable gate. A non-trackable category has no quota whatever else is stored.
//   1. tasks.quota_wph_override, the figure the task carries, when it is a usable divisor.
//   2. The user's current category_quotas row for that category.
//   3. The shipped default for that category, from the contract.
//   4. None.
//
// The gate is numbered zero here on purpose. The spec's own list puts it last and then spends a
// paragraph explaining that it is "a gate rather than a last resort", because the editor shows the
// quota field for every category deliberately, so a user can type a figure onto a meeting and step 1
// would otherwise hand that meeting a quota. The tests below assert it as a gate.
//
// NO STEP COMPARES A DATE. The snapshot model the owner approved on 2026-08-24 replaced the
// effective-dated lookup this file was first written against, so resolveCategoryQuota takes no date
// argument, a record carries no effectiveFrom, and resolveTaskQuota does not read task.date. The cases
// that asserted the date comparison were removed rather than adapted, because they asserted behaviour
// the resolver must no longer have. What replaces them is the guarantee those cases existed to serve,
// which is that an edit to a category setting cannot reach a task that already carries a figure, and
// that is exercised end to end against a real database in
// test/server/api/me/handlers/saveCategoryQuotas.test.ts and in the write-path suites.
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

function record(categoryId: string, quotaWph: number): CategoryQuotaRecord {
  return { categoryId, quotaWph }
}

describe('resolveCategoryQuota', () => {
  describe('a fresh user with no stored rows (AC1)', () => {
    // The spec: "a fresh user with zero rows in category_quotas still resolves working quotas for all
    // four trackable categories. There is no bootstrap step, no seeding requirement, and no state in
    // which a trackable category has no answer."
    it.each(SHIPPED_DEFAULTS)(
      'resolves %s to its shipped default of %i words per hour',
      (categoryId, expected) => {
        expect(resolveCategoryQuota(categoryId, [])).toEqual({
          quotaWph: expected,
          source: 'default'
        })
      }
    )

    // The source field exists so the client never compares a figure against a hardcoded default to
    // decide what to label it. It is asserted on its own rather than only inside the table above,
    // because AC6 has the API pass it straight through to the page.
    it('marks a default as coming from the shipped contract rather than the user', () => {
      expect(resolveCategoryQuota('translation', [])?.source).toBe('default')
    })

    // The resolved shape carries no date at all. Asserted as an exact object rather than as a
    // property check, so a reintroduced effectiveFrom fails here rather than passing unnoticed.
    it('resolves to a figure and a source and nothing else', () => {
      expect(Object.keys(resolveCategoryQuota('translation', []) ?? {}).sort()).toEqual([
        'quotaWph',
        'source'
      ])
    })

    // The transposition guard, stated as a comparison rather than as two numbers, so a swap fails
    // here with a message about the direction rather than only as two unrelated table rows.
    it('keeps external revision faster than internal revision', () => {
      const external = resolveCategoryQuota('revision_external', [])
      const internal = resolveCategoryQuota('revision_internal', [])

      expect(external?.quotaWph).toBe(1300)
      expect(internal?.quotaWph).toBe(1000)
      expect(external?.quotaWph).toBeGreaterThan(internal?.quotaWph ?? 0)
    })
  })

  describe('the trackable gate (AC1)', () => {
    // The spec: "The resolver returns none, expressed as null, for every non-trackable category,
    // whatever the stored rows or the task's own figure say."
    it.each(NON_TRACKABLE_IDS)('resolves the non-trackable %s to none', (categoryId) => {
      expect(resolveCategoryQuota(categoryId, [])).toBeNull()
    })

    // `other` is the one member where trackable and deliverable disagree, so it is worth its own
    // case. It can carry words and a status and it must still never reach a quota. It is also the
    // create default, so this is the state every task made from the inline editor starts in.
    it('resolves other to none even though it is deliverable', () => {
      expect(resolveCategoryQuota('other', [])).toBeNull()
    })

    // The gate beats a stored row. A row for a non-trackable category is storable, because the table
    // takes a free-text category id and PLAN-30 may turn a trackable category into a non-trackable
    // one, and the spec's edge case "A stored row for a category that is trackable today and not
    // tomorrow" says the row stops contributing the moment the category stops being trackable.
    it.each(NON_TRACKABLE_IDS)(
      'ignores a stored row for the non-trackable %s rather than honouring it',
      (categoryId) => {
        expect(resolveCategoryQuota(categoryId, [record(categoryId, 900)])).toBeNull()
      }
    )

    // Every one of the ten default ids resolves either a figure or null and nothing throws, which is
    // AC1's "verifiable by unit tests over all ten ids" read as totality.
    it.each(DEFAULT_CATEGORY_IDS)(
      'answers for the default id %s without throwing',
      (categoryId) => {
        expect(() => resolveCategoryQuota(categoryId, [])).not.toThrow()
      }
    )
  })

  describe('an unknown or stale category id', () => {
    // The spec's edge case "A stored row for a category id that no longer exists" and AC1's accessor
    // rule: an unknown id coerces to `other`, `other` is not trackable, so the answer is none.
    it.each(UNKNOWN_CATEGORY_INPUTS)('resolves %s to none', (_label, input) => {
      expect(resolveCategoryQuota(input, [])).toBeNull()
    })

    it.each(UNKNOWN_CATEGORY_INPUTS)('resolves %s to none without throwing', (_label, input) => {
      expect(() => resolveCategoryQuota(input, [])).not.toThrow()
    })

    // A stored row for an id outside the contract, which is the case AC10 names. Asked about that id,
    // the gate coerces it to `other` and the answer is none, so the row never produces a figure. This
    // is also the forward-compatibility seam: the row is storable today, it is left in place rather
    // than deleted, and if PLAN-30 makes the id a real trackable category the row is already there to
    // be read.
    it('returns none for a stored row naming an id outside the contract', () => {
      expect(resolveCategoryQuota('ma-categorie', [record('ma-categorie', 500)])).toBeNull()
    })

    // The other half of the same edge case, from the side of a category that does exist. A row
    // naming some other id never participates in an answer about translation, so an orphan row is
    // invisible rather than broken.
    it('never lets a row for another id answer for the category being asked about', () => {
      const records = [record('ma-categorie', 500), record('revision_internal', 700)]

      expect(resolveCategoryQuota('translation', records)).toEqual({
        quotaWph: 240,
        source: 'default'
      })
    })
  })

  describe('the user current row (AC2)', () => {
    // The stored row is the second-to-last step and it beats the shipped default. This is what the
    // settings page writes and what production reads the moment the user saves once.
    it('resolves the stored figure rather than the shipped default', () => {
      expect(resolveCategoryQuota('translation', [record('translation', 300)])).toEqual({
        quotaWph: 300,
        source: 'user'
      })
    })

    // A stored figure the shipped default would never produce, to prove the stored row is really
    // what is being read rather than the default agreeing by coincidence. The app accepts an
    // unusually high or low figure inside the schema's range without comment, per the do-not-police
    // rule, so 1 and 10000 are ordinary stored values here.
    it.each([1, 10000])('resolves a stored figure of %i rather than the default', (quotaWph) => {
      expect(resolveCategoryQuota('translation', [record('translation', quotaWph)])).toEqual({
        quotaWph,
        source: 'user'
      })
    })

    // Each category is answered from its own row, so two categories the user has saved do not borrow
    // each other's figures and one the user has not saved stays on its shipped default.
    it('keeps each category on its own row', () => {
      const records = [record('translation', 300), record('proofreading', 1800)]

      expect(resolveCategoryQuota('translation', records)?.quotaWph).toBe(300)
      expect(resolveCategoryQuota('proofreading', records)?.quotaWph).toBe(1800)
      expect(resolveCategoryQuota('revision_external', records)).toEqual({
        quotaWph: 1300,
        source: 'default'
      })
    })

    // The table's unique key is (user_id, category_id), so one row per category is a database
    // guarantee rather than a convention and the resolver has no tie to break. This asserts the
    // resolver does not silently depend on that being true in some particular order: it takes the row
    // it finds rather than scanning for a winner, which is exactly what having no history means.
    it('takes the single row for a category rather than choosing between candidates', () => {
      const records = [record('proofreading', 1800), record('translation', 300)]

      expect(resolveCategoryQuota('translation', records)).toEqual({
        quotaWph: 300,
        source: 'user'
      })
    })
  })
})

describe('resolveTaskQuota', () => {
  describe('the trackable gate comes before the task figure', () => {
    // The spec's edge case "A task carrying a figure on a non-trackable category": the figure is
    // storable today because the editor shows the quota field for every category on purpose, and the
    // resolver "gates on trackable first, so it never produces a quota for a meeting or a break".
    // Under the snapshot model this is also what makes AC12's rule 4 safe: a move to a non-trackable
    // category leaves the stored figure alone, and this gate is what keeps it out of any numerator.
    it.each(NON_TRACKABLE_IDS)(
      'returns none for %s even when the task carries a figure',
      (category) => {
        expect(resolveTaskQuota({ category, quotaWphOverride: 900 }, [])).toBeNull()
      }
    )

    // The same gate with a stored row behind it as well, so neither of the two sources can slip past.
    it('returns none for a non-trackable category carrying both a figure and a stored row', () => {
      const task = { category: 'meetings', quotaWphOverride: 900 }

      expect(resolveTaskQuota(task, [record('meetings', 700)])).toBeNull()
    })

    it.each(UNKNOWN_CATEGORY_INPUTS)(
      'returns none for a task whose category is %s, figure or not',
      (_label, category) => {
        expect(resolveTaskQuota({ category }, [])).toBeNull()
        expect(resolveTaskQuota({ category, quotaWphOverride: 900 }, [])).toBeNull()
      }
    )
  })

  describe('the task own figure, when the category is trackable', () => {
    it('wins over both a stored row and the shipped default', () => {
      const task = { category: 'translation', quotaWphOverride: 400 }

      expect(resolveTaskQuota(task, [record('translation', 300)])).toEqual({
        quotaWph: 400,
        source: 'task'
      })
    })

    // The source is named 'task' rather than 'override', because under the snapshot model the figure
    // on the task is the record rather than an exception to one: the write path puts it there for
    // every task written in a trackable category. Asserted by name so the rename cannot be undone
    // quietly.
    it('reports the source as task rather than as an override', () => {
      const task = { category: 'translation', quotaWphOverride: 400 }

      expect(resolveTaskQuota(task, [])).toEqual({ quotaWph: 400, source: 'task' })
    })

    // This is AC2's guarantee stated on the pure resolver: a task carrying its own figure resolves to
    // that figure whatever the user's current category setting says, so an edit to the setting cannot
    // restate what the task was measured against. The end-to-end version of this, through a real
    // database and the real save handler, is in saveCategoryQuotas.test.ts.
    it('keeps the task figure when the category setting says something else', () => {
      const task = { category: 'translation', quotaWphOverride: 240 }

      expect(resolveTaskQuota(task, [record('translation', 999)])).toEqual({
        quotaWph: 240,
        source: 'task'
      })
    })

    // The floor of the shared validator is 1, so a figure of 1 is a legal stored value and has to
    // be honoured rather than read as absent.
    it('honours a figure of 1 rather than treating it as absent', () => {
      expect(resolveTaskQuota({ category: 'translation', quotaWphOverride: 1 }, [])).toEqual({
        quotaWph: 1,
        source: 'task'
      })
    })
  })

  describe('a stored figure that cannot be a divisor', () => {
    // The quota is the divisor in words over quota, so a stored 0 is not a small quota, it is a
    // division by zero waiting for PLAN-12 to read it. No API path can write one today, because
    // quotaWphSchema floors the field at 1 on every boundary that accepts it, so this is defence
    // against a row that arrived some other way rather than a live bug.
    //
    // An unusable value costs the task's own figure and nothing else. It is treated as no figure at
    // all, which is the same path a NULL takes, so the task falls through to its category's stored row
    // and then to the shipped default. Resolving the whole task to none would throw away a perfectly
    // good category figure to punish one bad column, and the row would then read as carrying no quota
    // when its category plainly has one.
    const UNUSABLE_FIGURES: Array<[string, number]> = [
      ['zero', 0],
      ['a negative figure', -100],
      ['NaN', Number.NaN]
    ]

    it.each(UNUSABLE_FIGURES)(
      'falls through to the stored row when the figure is %s',
      (_label, quotaWphOverride) => {
        const task = { category: 'translation', quotaWphOverride }

        expect(resolveTaskQuota(task, [record('translation', 300)])).toEqual({
          quotaWph: 300,
          source: 'user'
        })
      }
    )

    it.each(UNUSABLE_FIGURES)(
      'falls through to the shipped default when the figure is %s and there is no row',
      (_label, quotaWphOverride) => {
        expect(resolveTaskQuota({ category: 'translation', quotaWphOverride }, [])).toEqual({
          quotaWph: 240,
          source: 'default'
        })
      }
    )

    // The two answers this must never give, stated as their own case so a regression says which of
    // the two failures happened. Reporting the source as the task's own would put the unusable figure
    // itself on screen, and returning null would hide a category quota the task really has.
    it.each(UNUSABLE_FIGURES)(
      'never reports %s as the task figure and never returns none',
      (_label, quotaWphOverride) => {
        const task = { category: 'translation', quotaWphOverride }

        expect(resolveTaskQuota(task, [])).not.toBeNull()
        expect(resolveTaskQuota(task, [])?.source).not.toBe('task')
        expect(resolveTaskQuota(task, [])?.quotaWph).not.toBe(quotaWphOverride)
      }
    )

    // The boundary the condition turns on, so a floor written as greater than 1 would fail here
    // rather than pass quietly. 1 is a legal stored figure and it wins, 0 is not and it does not.
    it('keeps 1 as the task figure while 0 falls through', () => {
      expect(resolveTaskQuota({ category: 'translation', quotaWphOverride: 1 }, [])).toMatchObject({
        quotaWph: 1,
        source: 'task'
      })
      expect(resolveTaskQuota({ category: 'translation', quotaWphOverride: 0 }, [])).toMatchObject({
        quotaWph: 240,
        source: 'default'
      })
    })

    // The gate still comes first, so an unusable figure on a non-trackable category resolves to none
    // for the category's sake rather than falling through to a figure.
    it.each(NON_TRACKABLE_IDS)('still returns none for %s carrying a zero figure', (category) => {
      expect(resolveTaskQuota({ category, quotaWphOverride: 0 }, [])).toBeNull()
    })
  })

  describe('no figure on the task, so the category resolution applies', () => {
    // The three kinds of row that reach this fallback under the snapshot model, per the spec's
    // "Existing tasks keep their NULL": a task written before PLAN-32b, a task whose figure the user
    // deliberately cleared, and a task inserted outside the write path such as the dev seed's. All
    // three are real, so this is live code rather than a leftover.
    it.each([
      ['null', null],
      ['undefined', undefined]
    ])('falls through to the stored row when the figure is %s', (_label, quotaWphOverride) => {
      const task = { category: 'translation', quotaWphOverride }

      expect(resolveTaskQuota(task, [record('translation', 300)])).toEqual({
        quotaWph: 300,
        source: 'user'
      })
    })

    it('falls through to the stored row when the field is absent altogether', () => {
      expect(resolveTaskQuota({ category: 'translation' }, [record('translation', 300)])).toEqual({
        quotaWph: 300,
        source: 'user'
      })
    })

    it('falls through to the shipped default when the user has no row', () => {
      expect(resolveTaskQuota({ category: 'proofreading' }, [])).toEqual({
        quotaWph: 2000,
        source: 'default'
      })
    })

    // The honest cost the spec records: a task with no figure follows the user's current setting, so
    // it does move when that setting is edited. That is correct rather than regrettable, because the
    // app has no record of what target such work was done against, and it is also what clearing the
    // field asks for. Asserted so the behaviour is deliberate rather than incidental.
    it('follows the current setting rather than freezing, when the task carries no figure', () => {
      const task = { category: 'translation', quotaWphOverride: null }

      expect(resolveTaskQuota(task, [record('translation', 260)])?.quotaWph).toBe(260)
      expect(resolveTaskQuota(task, [record('translation', 999)])?.quotaWph).toBe(999)
    })
  })
})
