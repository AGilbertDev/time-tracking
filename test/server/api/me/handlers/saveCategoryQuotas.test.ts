import type { Client } from '@libsql/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countRows,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedCategoryQuota,
  seedSettings
} from '../../../../helpers/taskTestDb'

// saveCategoryQuotas is the handler behind PATCH /api/me/category-quotas. This suite covers the two
// properties docs/specs/planning/per-category-quotas.md states as mechanisms rather than as shapes,
// which are the ones only a real database can demonstrate:
//
//   AC2. "Editing a quota inserts or updates the row for the effective date being edited and never
//   touches a row with an earlier effective_from." That is the guarantee that an edit never restates
//   a period already reported.
//
//   The "Two edits on the same day" edge case. "The second upserts the first day's row. Editing a
//   figure twice in a morning leaves one row for that day holding the latest value, rather than two
//   rows the resolver would have to break a tie between."
//
// Plus AC6's partial-write rule and the timezone default on the effective date. Every expectation is
// derived from the spec, not from the implementation.
//
// The seam is useDb, which returns a genuine Drizzle instance over an in-memory libSQL database
// carrying the shipped DDL and the unique index the upsert conflicts on. A faked query builder would
// record the statement and prove nothing about whether the second save added a row or replaced one,
// which is the entire question here. Row counts are read with raw SQL so the code under test is not
// also what reads back its own work.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { loadWorkSettings } = await import('~~/server/utils/loadWorkSettings')
const { loadResolvedCategoryQuotas } = await import('~~/server/utils/loadCategoryQuotas')
const { saveCategoryQuotas } = await import('~~/server/api/me/handlers/saveCategoryQuotas')

const event = { __event: true } as never

let harness: TaskTestDb
let client: Client

// The stored rows for one user, read with raw SQL, newest date last.
async function storedRows(userId = OWNER_ID) {
  const result = await client.execute({
    sql: `SELECT category_id, quota_wph, effective_from FROM category_quotas
          WHERE user_id = ? ORDER BY effective_from ASC, category_id ASC`,
    args: [userId]
  })
  return result.rows.map((row) => ({
    categoryId: String(row.category_id),
    effectiveFrom: String(row.effective_from),
    quotaWph: Number(row.quota_wph)
  }))
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  // The three auto-imported helpers the handler calls as free identifiers. loadWorkSettings and
  // loadResolvedCategoryQuotas are the real functions rather than stand-ins, because both read
  // through the same mocked useDb and a stub would hide whether the read-back reflects the write.
  vi.stubGlobal('requireUserSession', async () => ({ user: { id: OWNER_ID } }))
  vi.stubGlobal('loadWorkSettings', loadWorkSettings)
  vi.stubGlobal('loadResolvedCategoryQuotas', loadResolvedCategoryQuotas)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('saveCategoryQuotas', () => {
  describe('two edits on the same day', () => {
    it('leaves one row holding the later figure rather than adding a second', async () => {
      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-08-23',
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })
      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-08-23',
        quotas: [{ categoryId: 'translation', quotaWph: 320 }]
      })

      expect(await countRows(client, 'category_quotas')).toBe(1)
      expect(await storedRows()).toEqual([
        { categoryId: 'translation', effectiveFrom: '2026-08-23', quotaWph: 320 }
      ])
    })

    // A typo corrected three times in a morning is still one row, which is why the settings section
    // needs no date control to be useful.
    it('still leaves one row after several saves on the same day', async () => {
      for (const quotaWph of [300, 310, 320, 330]) {
        await saveCategoryQuotas(event, {
          effectiveFrom: '2026-08-23',
          quotas: [{ categoryId: 'translation', quotaWph }]
        })
      }

      expect(await countRows(client, 'category_quotas')).toBe(1)
      expect((await storedRows())[0]?.quotaWph).toBe(330)
    })
  })

  describe('an edit never restates a past period (AC2)', () => {
    it('adds a new dated row and leaves the earlier row exactly as it was', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'translation', 260, '2026-06-01')

      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-08-23',
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(await storedRows()).toEqual([
        { categoryId: 'translation', effectiveFrom: '2026-06-01', quotaWph: 260 },
        { categoryId: 'translation', effectiveFrom: '2026-08-23', quotaWph: 300 }
      ])
    })

    // A deliberate correction to a past period writes that period's row and leaves the later one
    // alone, which is the same mechanism read from the other end. The app never backdates on its own
    // and a user who explicitly asks to correct a past period gets to.
    it('writes a backdated row without touching a later one', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'translation', 300, '2026-08-23')

      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-06-01',
        quotas: [{ categoryId: 'translation', quotaWph: 260 }]
      })

      expect(await storedRows()).toEqual([
        { categoryId: 'translation', effectiveFrom: '2026-06-01', quotaWph: 260 },
        { categoryId: 'translation', effectiveFrom: '2026-08-23', quotaWph: 300 }
      ])
    })
  })

  describe('the write is partial by design (AC6)', () => {
    it('writes only the categories the body carries', async () => {
      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-08-23',
        quotas: [
          { categoryId: 'translation', quotaWph: 300 },
          { categoryId: 'proofreading', quotaWph: 1800 }
        ]
      })

      expect(await storedRows()).toEqual([
        { categoryId: 'proofreading', effectiveFrom: '2026-08-23', quotaWph: 1800 },
        { categoryId: 'translation', effectiveFrom: '2026-08-23', quotaWph: 300 }
      ])
    })

    it('leaves a category the body does not mention untouched', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'proofreading', 1800, '2026-08-23')

      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-08-23',
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(await storedRows()).toEqual([
        { categoryId: 'proofreading', effectiveFrom: '2026-08-23', quotaWph: 1800 },
        { categoryId: 'translation', effectiveFrom: '2026-08-23', quotaWph: 300 }
      ])
    })
  })

  describe('the write is scoped to the session user', () => {
    it('never touches another user row', async () => {
      await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 999, '2026-08-23')

      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-08-23',
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(await storedRows(OTHER_USER_ID)).toEqual([
        { categoryId: 'translation', effectiveFrom: '2026-08-23', quotaWph: 999 }
      ])
      expect(await storedRows(OWNER_ID)).toEqual([
        { categoryId: 'translation', effectiveFrom: '2026-08-23', quotaWph: 300 }
      ])
    })
  })

  describe('the effective date defaults to today in the user own timezone', () => {
    // The spec's "The timezone boundary on today" edge case: the default is today in the user's stored
    // timezone rather than in UTC, "so an edit made late in the evening does not land on tomorrow's
    // date". 2026-08-24T01:30:00Z is still 2026-08-23 in America/Toronto.
    //
    // Only Date is faked. The libSQL client's own promises must keep running, so faking every timer
    // would deadlock the write rather than test it.
    it('stores the user date rather than the UTC date behind it', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-24T01:30:00Z'))

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })

      expect((await storedRows())[0]?.effectiveFrom).toBe('2026-08-23')
    })

    it('stores the user date for a zone ahead of UTC on the same instant', async () => {
      await seedSettings(client, OWNER_ID, 'Europe/Paris')
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-23T23:30:00Z'))

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })

      expect((await storedRows())[0]?.effectiveFrom).toBe('2026-08-24')
    })

    it('uses the date the body names when it carries one', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-24T01:30:00Z'))

      await saveCategoryQuotas(event, {
        effectiveFrom: '2026-06-01',
        quotas: [{ categoryId: 'translation', quotaWph: 260 }]
      })

      expect((await storedRows())[0]?.effectiveFrom).toBe('2026-06-01')
    })
  })

  describe('the response is read back through the single read path (AC6)', () => {
    // "The response is the same shape the GET returns, read back through the single read path, so the
    // client reconciles against what the database actually holds." A response assembled from the body
    // would look right even if nothing had been stored.
    it('returns the full resolved set with the saved figure marked as the user own', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-23T15:00:00Z'))

      const response = await saveCategoryQuotas(event, {
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(response).toEqual([
        {
          categoryId: 'translation',
          effectiveFrom: '2026-08-23',
          quotaWph: 300,
          source: 'user'
        },
        { categoryId: 'revision_internal', effectiveFrom: null, quotaWph: 1000, source: 'default' },
        { categoryId: 'revision_external', effectiveFrom: null, quotaWph: 1300, source: 'default' },
        { categoryId: 'proofreading', effectiveFrom: null, quotaWph: 2000, source: 'default' }
      ])
    })
  })
})
