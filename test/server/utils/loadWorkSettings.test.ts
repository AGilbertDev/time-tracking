import { afterEach, describe, expect, it, vi } from 'vitest'

// loadWorkSettings is the single read path for a user's work settings (GET /api/me/work-settings
// and the PATCH read-back). Every expected value below is derived from
// docs/specs/settings/settings-page.md (the "GET /api/me/work-settings" contract and the "Corrupted
// or legacy work_days text" edge case), not from the implementation. The spec fixes: the no-row
// path returns the coded defaults { dailyWorkMinutes: 450, workDays: [1,2,3,4,5], quotaWph: 450,
// timezone: 'America/Toronto' }; work_days is JSON text that the loader parses and coerces to a
// clean number[], where a non-JSON or non-array value falls back to [1,2,3,4,5] and every entry
// that is not an integer 0-6 is dropped and duplicates are de-duped; an empty array is a valid
// stored value preserved as an empty set. The DB read is mocked at the boundary (useDb), the same
// seam the real handler uses.

// Hoisted spy so the vi.mock factory can reference it; each test drives the row .get() returns.
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('~~/server/db/index', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    get: getMock
  }
  return { useDb: () => chain }
})

const { loadWorkSettings } = await import('~~/server/utils/loadWorkSettings')

// Builds a settings row as the DB would return it. work_days is stored as JSON text.
function row(
  overrides: {
    workDays?: string
    dailyWorkMinutes?: number | null
    quotaWph?: number
    timezone?: string
  } = {}
) {
  return {
    dailyWorkMinutes: overrides.dailyWorkMinutes ?? 450,
    workDays: overrides.workDays ?? '[1,2,3,4,5]',
    quotaWph: overrides.quotaWph ?? 450,
    timezone: overrides.timezone ?? 'America/Toronto'
  }
}

afterEach(() => {
  getMock.mockReset()
})

describe('loadWorkSettings', () => {
  describe('no settings row', () => {
    // Spec: when no row exists the loader returns the coded defaults matching the column defaults.
    it('returns the coded defaults when no row exists', async () => {
      getMock.mockReturnValue(undefined)

      await expect(loadWorkSettings('user-1')).resolves.toEqual({
        dailyWorkMinutes: 450,
        workDays: [1, 2, 3, 4, 5],
        quotaWph: 450,
        timezone: 'America/Toronto'
      })
    })
  })

  describe('work_days parse-and-coerce', () => {
    it('passes a valid JSON array through unchanged', async () => {
      getMock.mockReturnValue(row({ workDays: '[1,2,3]' }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [1, 2, 3] })
    })

    // A stored empty array is valid and must survive as an empty set, not fall back to the default.
    it('preserves an empty array as an empty set', async () => {
      getMock.mockReturnValue(row({ workDays: '[]' }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [] })
    })

    it('falls back to the default set on non-JSON text', async () => {
      getMock.mockReturnValue(row({ workDays: 'not json at all' }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [1, 2, 3, 4, 5] })
    })

    // Valid JSON but not an array (a bare number, an object) is a broken shape and falls back.
    it.each([
      ['a bare number', '5'],
      ['an object', '{}'],
      ['a string', '"weekdays"'],
      ['null', 'null']
    ])('falls back to the default set on non-array JSON (%s)', async (_label, stored) => {
      getMock.mockReturnValue(row({ workDays: stored }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [1, 2, 3, 4, 5] })
    })

    // Out-of-range and non-integer entries are dropped rather than failing the whole read; the
    // remaining valid entries survive.
    it('drops entries above 6, below 0, and non-integers, keeping the valid ones', async () => {
      getMock.mockReturnValue(row({ workDays: '[7, -1, 2.5, 3, 4]' }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [3, 4] })
    })

    it('drops non-number entries such as strings and objects', async () => {
      getMock.mockReturnValue(row({ workDays: '["1", 2, {"day":3}, 4]' }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [2, 4] })
    })

    it('de-duplicates repeated entries preserving first-seen order', async () => {
      getMock.mockReturnValue(row({ workDays: '[3, 3, 1, 1, 2]' }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [3, 1, 2] })
    })

    // A fully corrupted array (every entry invalid) coerces to an empty set, not the default,
    // because the value did parse as an array. The default only applies to a parse error or a
    // non-array, per the spec.
    it('coerces an all-invalid array to an empty set', async () => {
      getMock.mockReturnValue(row({ workDays: '[9, -2, 8]' }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ workDays: [] })
    })
  })

  describe('other fields on a present row', () => {
    // Defensive coercion: a null dailyWorkMinutes on the row falls back to the coded default rather
    // than reaching the client as null. The column is notNull in practice, so this guards a legacy
    // or partial row.
    it('falls back to the default daily minutes when the row value is null', async () => {
      getMock.mockReturnValue(row({ workDays: '[1,2]', dailyWorkMinutes: null }))

      await expect(loadWorkSettings('user-1')).resolves.toMatchObject({ dailyWorkMinutes: 450 })
    })

    it('returns the row values for the numeric and timezone fields', async () => {
      getMock.mockReturnValue(
        row({ dailyWorkMinutes: 480, quotaWph: 600, timezone: 'Europe/Paris', workDays: '[1,2]' })
      )

      await expect(loadWorkSettings('user-1')).resolves.toEqual({
        dailyWorkMinutes: 480,
        workDays: [1, 2],
        quotaWph: 600,
        timezone: 'Europe/Paris'
      })
    })
  })
})
