import type { Client } from '@libsql/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../helpers/taskTestDb'

import { createTaskTestDb, OWNER_ID } from '../../helpers/taskTestDb'

// loadWorkSettings is the single read path for a user's work settings (GET /api/me/work-settings
// and the PATCH read-back). Every expected value below is derived from
// docs/specs/settings/settings-page.md (the "GET /api/me/work-settings" contract and the "Corrupted
// or legacy work_days text" edge case), not from the implementation. The spec fixes: the no-row
// path returns the coded defaults { dailyWorkMinutes: 450, workDays: [1,2,3,4,5],
// timezone: 'America/Toronto' }; work_days is JSON text that the loader parses and coerces to a
// clean number[], where a non-JSON or non-array value falls back to [1,2,3,4,5] and every entry
// that is not an integer 0-6 is dropped and duplicates are de-duped; an empty array is a valid
// stored value preserved as an empty set. The DB read is mocked at the boundary (useDb), the same
// seam the real handler uses.

// Hoisted spy so the vi.mock factory can reference it; each test drives the row .get() returns.
//
// realDb is the escape hatch for the one group of cases that needs a genuine database rather than a
// stubbed row: the stored NULL below. It stays null for every other case, so the chain stub above
// remains the seam for the coercion cases and nothing about them changes.
const { getMock, realDb } = vi.hoisted(() => ({
  getMock: vi.fn(),
  realDb: { current: null as unknown }
}))

vi.mock('~~/server/db/index', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    get: getMock
  }
  return { useDb: () => realDb.current ?? chain }
})

const { loadWorkSettings } = await import('~~/server/utils/loadWorkSettings')

// Builds a settings row as the DB would return it. work_days is stored as JSON text.
//
// dailyWorkMinutes is read by presence of the key rather than with `??`, because the column is
// nullable and a stored NULL is one of the states under test. `?? 450` here turned the null case
// below into a 450 case, so the fallback it names was never reached and the assertion passed on the
// stored figure instead. An override of null now arrives as null.
function row(
  overrides: {
    workDays?: string
    dailyWorkMinutes?: number | null
    timezone?: string
  } = {}
) {
  return {
    dailyWorkMinutes: 'dailyWorkMinutes' in overrides ? (overrides.dailyWorkMinutes ?? null) : 450,
    workDays: overrides.workDays ?? '[1,2,3,4,5]',
    timezone: overrides.timezone ?? 'America/Toronto'
  }
}

afterEach(() => {
  getMock.mockReset()
  realDb.current = null
})

describe('loadWorkSettings', () => {
  describe('no settings row', () => {
    // Spec: when no row exists the loader returns the coded defaults matching the column defaults.
    it('returns the coded defaults when no row exists', async () => {
      getMock.mockReturnValue(undefined)

      await expect(loadWorkSettings('user-1')).resolves.toEqual({
        dailyWorkMinutes: 450,
        workDays: [1, 2, 3, 4, 5],
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
        row({ dailyWorkMinutes: 480, timezone: 'Europe/Paris', workDays: '[1,2]' })
      )

      await expect(loadWorkSettings('user-1')).resolves.toEqual({
        dailyWorkMinutes: 480,
        workDays: [1, 2],
        timezone: 'Europe/Paris'
      })
    })
  })

  // The fallback above, against a real settings table rather than a stubbed row.
  //
  // settings.daily_work_minutes is nullable: server/db/schema.ts declares it as
  // `integer('daily_work_minutes').default(450)` with no `.notNull()`, and migration 0000 predates
  // the column, so a row holding NULL is a state the database allows rather than one only a stub can
  // produce. Nothing in the write path can create it, since dailyWorkMinutesSchema has a floor of 1
  // and an insert omitting the field takes the DDL default, so the honest claim is that the column
  // permits it and the loader answers the spec's coded default for it. That is what these two cases
  // establish: first that the NULL really stores, then that the loader resolves it to 450.
  describe('a stored NULL daily figure', () => {
    let harness: TaskTestDb
    let client: Client

    beforeEach(async () => {
      harness = await createTaskTestDb()
      client = harness.client
      realDb.current = harness.db

      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO settings (id, user_id, daily_work_minutes, work_days, timezone)
              VALUES ('settings-null', ?, NULL, '[2,4]', 'Europe/Paris')`
      })
    })

    it('is a state the settings table accepts', async () => {
      const stored = await client.execute(
        "SELECT daily_work_minutes FROM settings WHERE id = 'settings-null'"
      )

      expect(stored.rows[0]?.daily_work_minutes).toBeNull()
    })

    it('reads back as the coded default rather than as null', async () => {
      await expect(loadWorkSettings(OWNER_ID)).resolves.toEqual({
        dailyWorkMinutes: 450,
        workDays: [2, 4],
        timezone: 'Europe/Paris'
      })
    })
  })
})
