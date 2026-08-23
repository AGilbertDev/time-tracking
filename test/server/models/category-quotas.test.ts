import { beforeEach, describe, expect, it, vi } from 'vitest'

// CategoryQuotasPatchSchema is the request boundary for PATCH /api/me/category-quotas. Every rule
// below is derived from docs/specs/planning/per-category-quotas.md AC6 (the PATCH contract), AC2 (a
// past or future effectiveFrom is accepted on purpose), AC10 (which names the cases this file has to
// cover), and the "A quota of zero, or an absurd one" edge case. None of it is read off the
// implementation.
//
// The spec fixes: quotas holds at least one entry, no duplicate categoryId, each categoryId a
// trackable category id, each quotaWph validated by the existing quotaWphSchema at integer 1 to
// 10000, effectiveFrom optional and validated by the same calendarDaySchema the task write boundary
// uses, a non-trackable categoryId rejected with a 422, and every validation failure going through
// sendZodError as a 422 with per-field data rather than as a crash.
//
// The floor of 1 is not a style choice. The quota is the divisor in words over quota, so a stored 0
// would divide by zero the moment PLAN-12 reads it. A high or low figure inside the range is accepted
// without comment, because the app records what the user tells it and never refuses a figure for
// looking wrong.

// createError is a Nitro auto-import, so in the raw source it resolves to globalThis. The stand-in
// keeps statusCode and data assertable, which is what makes "a 422 rather than a crash" checkable.
type ThrownError = { statusCode: number; statusMessage: string; data: Record<string, string> }

beforeEach(() => {
  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string; data: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
})

const { CategoryQuotasPatchSchema } = await import('~~/server/models/category-quotas')
const { sendZodError } = await import('~~/server/utils/sendZodError')

const TRACKABLE_IDS = ['translation', 'revision_internal', 'revision_external', 'proofreading']
const NON_TRACKABLE_IDS = ['terminology', 'meetings', 'breaks', 'admin', 'dtp', 'other']

// The same route the handler takes: parse, and hand a failure to sendZodError. This is what proves a
// rejected body becomes a 422 with per-field data instead of an exception nobody shaped.
function thrownBy(value: unknown): ThrownError {
  const result = CategoryQuotasPatchSchema.safeParse(value)
  if (result.success) throw new Error('The body parsed successfully, so there is no error to map.')
  try {
    sendZodError(result.error)
  } catch (error) {
    return error as ThrownError
  }
  throw new Error('sendZodError returned instead of throwing.')
}

describe('CategoryQuotasPatchSchema', () => {
  describe('a valid body', () => {
    it('accepts one quota with no effective date', () => {
      const result = CategoryQuotasPatchSchema.safeParse({
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ quotas: [{ categoryId: 'translation', quotaWph: 300 }] })
    })

    // effectiveFrom is optional and the handler defaults it to today in the user's own timezone, so
    // the schema leaves it absent rather than filling it in with the server's idea of today.
    it('leaves an absent effective date absent rather than defaulting it', () => {
      const result = CategoryQuotasPatchSchema.safeParse({
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(result.success).toBe(true)
      expect(result.data).not.toHaveProperty('effectiveFrom')
    })

    it('accepts an explicit effective date', () => {
      const result = CategoryQuotasPatchSchema.safeParse({
        effectiveFrom: '2026-08-23',
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(result.success).toBe(true)
      expect(result.data?.effectiveFrom).toBe('2026-08-23')
    })

    // The body is partial by design, like the work-settings save, so one entry and all four are
    // equally valid and nothing requires the full set.
    it.each(TRACKABLE_IDS)('accepts %s on its own, since the body is partial', (categoryId) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({ quotas: [{ categoryId, quotaWph: 500 }] }).success
      ).toBe(true)
    })

    it('accepts all four trackable categories in one body', () => {
      const quotas = TRACKABLE_IDS.map((categoryId) => ({ categoryId, quotaWph: 500 }))

      expect(CategoryQuotasPatchSchema.safeParse({ quotas }).success).toBe(true)
    })
  })

  describe('the quotaWph bounds inherited from quotaWphSchema (AC6, AC10)', () => {
    it.each([1, 240, 1300, 10000])('accepts the in-range figure %i', (quotaWph) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({ quotas: [{ categoryId: 'translation', quotaWph }] })
          .success
      ).toBe(true)
    })

    // Zero is rejected because the quota is a divisor, which is the reason the floor is 1 rather than
    // 0 on the task override as well.
    it('rejects zero, because the quota is a divisor', () => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          quotas: [{ categoryId: 'translation', quotaWph: 0 }]
        }).success
      ).toBe(false)
    })

    it.each([-1, 10001])('rejects the out-of-range figure %i', (quotaWph) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({ quotas: [{ categoryId: 'translation', quotaWph }] })
          .success
      ).toBe(false)
    })

    it('rejects a non-integer figure', () => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          quotas: [{ categoryId: 'translation', quotaWph: 240.5 }]
        }).success
      ).toBe(false)
    })

    it.each([
      ['a numeric string', '240'],
      ['null', null],
      ['a boolean', true]
    ])('rejects %s in place of a figure', (_label, quotaWph) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({ quotas: [{ categoryId: 'translation', quotaWph }] })
          .success
      ).toBe(false)
    })

    it('rejects an entry with no figure at all', () => {
      expect(
        CategoryQuotasPatchSchema.safeParse({ quotas: [{ categoryId: 'translation' }] }).success
      ).toBe(false)
    })
  })

  describe('the category id (AC6, AC10)', () => {
    // "A non-trackable categoryId is rejected with a 422. That is a data-validity rule rather than
    // policing, because a non-trackable category has no quota by definition, so the row would be
    // meaningless rather than unusual."
    it.each(NON_TRACKABLE_IDS)('rejects the non-trackable %s', (categoryId) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({ quotas: [{ categoryId, quotaWph: 300 }] }).success
      ).toBe(false)
    })

    // An id outside the contract is rejected rather than coerced here, which is the opposite of what
    // the read path does. The client picked from a list the server gave it, so an unknown id is a
    // client bug or a hostile request rather than history, and storing a quota against some other
    // category would be data corruption dressed as robustness.
    it.each([
      ['an unknown string', 'does-not-exist'],
      ['the retired revision id', 'revision'],
      ['a user-created id', 'ma-categorie'],
      ['the empty string', '']
    ])('rejects %s rather than coercing it', (_label, categoryId) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({ quotas: [{ categoryId, quotaWph: 300 }] }).success
      ).toBe(false)
    })

    it('rejects an entry with no category id at all', () => {
      expect(CategoryQuotasPatchSchema.safeParse({ quotas: [{ quotaWph: 300 }] }).success).toBe(
        false
      )
    })

    // "A duplicate category in one body has two answers for one row and no way to choose between
    // them", so it is refused rather than resolved last-one-wins.
    it('rejects the same category twice in one body', () => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          quotas: [
            { categoryId: 'translation', quotaWph: 300 },
            { categoryId: 'translation', quotaWph: 320 }
          ]
        }).success
      ).toBe(false)
    })

    it('accepts two different categories in one body', () => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          quotas: [
            { categoryId: 'translation', quotaWph: 300 },
            { categoryId: 'proofreading', quotaWph: 1800 }
          ]
        }).success
      ).toBe(true)
    })
  })

  describe('the quotas array (AC6, AC10)', () => {
    // "quotas holds at least one entry." An empty array is a save that asks for nothing, which is a
    // client bug rather than a no-op worth writing.
    it('rejects an empty quotas array', () => {
      expect(CategoryQuotasPatchSchema.safeParse({ quotas: [] }).success).toBe(false)
    })

    it('rejects a body with no quotas field', () => {
      expect(CategoryQuotasPatchSchema.safeParse({}).success).toBe(false)
      expect(CategoryQuotasPatchSchema.safeParse({ effectiveFrom: '2026-08-23' }).success).toBe(
        false
      )
    })

    it.each([
      ['an object', { translation: 300 }],
      ['a number', 300],
      ['null', null],
      ['a string', 'translation']
    ])('rejects %s in place of the quotas array', (_label, quotas) => {
      expect(CategoryQuotasPatchSchema.safeParse({ quotas }).success).toBe(false)
    })

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'quotas'],
      ['an array', []]
    ])('rejects %s in place of the whole body', (_label, body) => {
      expect(CategoryQuotasPatchSchema.safeParse(body).success).toBe(false)
    })
  })

  describe('the effective date (AC2, AC10)', () => {
    // The date rules come from the shared calendarDaySchema, so the shape and the real-date check
    // cannot drift from the task write boundary. The impossible date is the one AC10 names.
    it.each([
      ['a shape-valid date that is not real', '2026-02-31'],
      ['February 29 in a non-leap year', '2026-02-29'],
      ['a single-digit month', '2026-8-23'],
      ['no separators', '20260823'],
      ['a two-digit year', '26-08-23'],
      ['a month of 13', '2026-13-01'],
      ['a day of 32', '2026-08-32'],
      ['the empty string', ''],
      ['a full timestamp', '2026-08-23T00:00:00Z']
    ])('rejects %s as an effective date', (_label, effectiveFrom) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          effectiveFrom,
          quotas: [{ categoryId: 'translation', quotaWph: 300 }]
        }).success
      ).toBe(false)
    })

    it.each([
      ['null', null],
      ['a number', 20260823]
    ])('rejects %s in place of an effective date', (_label, effectiveFrom) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          effectiveFrom,
          quotas: [{ categoryId: 'translation', quotaWph: 300 }]
        }).success
      ).toBe(false)
    })

    // AC2: "An effectiveFrom in the past is accepted by the API and is a deliberate correction rather
    // than a mistake to block", and "A future effectiveFrom is accepted for the same reason". Both are
    // the do-not-police rule applied to a date, so a schema that refused either would be wrong.
    it.each([
      ['a past date', '2020-01-15'],
      ['a leap day', '2024-02-29'],
      ['a future date', '2099-12-31']
    ])('accepts %s', (_label, effectiveFrom) => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          effectiveFrom,
          quotas: [{ categoryId: 'translation', quotaWph: 300 }]
        }).success
      ).toBe(true)
    })
  })

  describe('unknown keys', () => {
    // Both objects are strict(), so a key nobody declared is named in the 422 rather than dropped in
    // silence. A silently dropped field is a save that reports success and stores less than it was
    // handed.
    it('rejects an unknown key on the body', () => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          quotas: [{ categoryId: 'translation', quotaWph: 300 }],
          userId: 'user-other'
        }).success
      ).toBe(false)
    })

    it('rejects an unknown key on an entry', () => {
      expect(
        CategoryQuotasPatchSchema.safeParse({
          quotas: [{ categoryId: 'translation', quotaWph: 300, effectiveFrom: '2026-08-23' }]
        }).success
      ).toBe(false)
    })
  })

  describe('every rejection is a 422 with per-field data rather than a crash (AC6)', () => {
    // "Validation errors go through sendZodError as a 422 with per-field data, and there is no other
    // error surface." So each invalid shape has to arrive as a shaped 422, and `data` has to name
    // something the client can act on rather than being empty.
    it.each([
      ['a missing quotas field', {}],
      ['an empty quotas array', { quotas: [] }],
      ['a missing figure', { quotas: [{ categoryId: 'translation' }] }],
      ['a missing category id', { quotas: [{ quotaWph: 300 }] }],
      ['a non-integer figure', { quotas: [{ categoryId: 'translation', quotaWph: 240.5 }] }],
      ['a figure of zero', { quotas: [{ categoryId: 'translation', quotaWph: 0 }] }],
      ['a figure above the ceiling', { quotas: [{ categoryId: 'translation', quotaWph: 10001 }] }],
      ['a non-trackable category', { quotas: [{ categoryId: 'meetings', quotaWph: 300 }] }],
      [
        'a duplicate category',
        {
          quotas: [
            { categoryId: 'translation', quotaWph: 300 },
            { categoryId: 'translation', quotaWph: 320 }
          ]
        }
      ],
      [
        'a malformed effective date',
        { effectiveFrom: '2026-2-31', quotas: [{ categoryId: 'translation', quotaWph: 300 }] }
      ],
      [
        'an impossible effective date',
        { effectiveFrom: '2026-02-31', quotas: [{ categoryId: 'translation', quotaWph: 300 }] }
      ],
      ['an unknown key', { quotas: [{ categoryId: 'translation', quotaWph: 300 }], quotaWph: 300 }]
    ])('answers %s with a 422 carrying something in data', (_label, body) => {
      const thrown = thrownBy(body)

      expect(thrown.statusCode).toBe(422)
      expect(Object.keys(thrown.data).length).toBeGreaterThan(0)
      expect(thrown.statusMessage.length).toBeGreaterThan(0)
    })

    // The per-field keying is what lets the settings form put a message under the input that caused
    // it, so the path of a failing entry has to reach `data` rather than collapsing to a form-level
    // key. The second entry is the one that is wrong here, and its index is part of the path.
    it('names the failing entry and field in data', () => {
      const thrown = thrownBy({
        quotas: [
          { categoryId: 'translation', quotaWph: 300 },
          { categoryId: 'proofreading', quotaWph: 0 }
        ]
      })

      expect(thrown.statusCode).toBe(422)
      expect(Object.keys(thrown.data)).toContain('quotas.1.quotaWph')
    })

    // An unknown key is named rather than reported as a nameless failure, which is the branch
    // sendZodError exists for and the reason a strict object is safe to use on a request boundary.
    it('names the rejected unknown key in data', () => {
      const thrown = thrownBy({
        quotas: [{ categoryId: 'translation', quotaWph: 300 }],
        userId: 'user-other'
      })

      expect(thrown.data).toHaveProperty('userId')
    })
  })
})
