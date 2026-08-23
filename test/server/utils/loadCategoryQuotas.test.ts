import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../helpers/taskTestDb'

import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedCategoryQuota,
  seedSettings
} from '../../helpers/taskTestDb'

// The read path over category_quotas and the resolved set both handlers of
// /api/me/category-quotas return, from docs/specs/planning/per-category-quotas.md AC6 ("The read path
// and the resolver") and AC1, plus the "A user with no rows at all" and "The timezone boundary on
// today" edge cases. Every expectation is derived from the spec rather than from the implementation.
//
// The spec fixes: loadCategoryQuotas reads one user's rows ordered by effective_from ascending and is
// the single read path behind both handlers; the resolved set is one entry per trackable category in
// contract order, each already resolved for today in the user's own stored timezone; non-trackable
// categories are absent rather than present with a null quota; source says whether the figure came
// from a stored row or the shipped default and effectiveFrom is the date of the winning row or null.
//
// The seam is useDb, which returns a genuine Drizzle instance over an in-memory libSQL database
// carrying the shipped DDL, including the unique index the write upserts on. A faked query builder
// would record whatever the read happened to pass it and prove nothing about scoping, ordering, or
// the constraint, and the constraint is one of the things this suite is here to check. Fixtures go in
// through raw SQL so a fixture can never be shaped by the code under test.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { loadCategoryQuotas, loadResolvedCategoryQuotas } =
  await import('~~/server/utils/loadCategoryQuotas')

let harness: TaskTestDb
let client: Client

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
})

describe('loadCategoryQuotas', () => {
  // The spec: "An empty history returns an empty array and no caller special-cases it, because the
  // resolver then supplies the shipped default for any date."
  it('returns an empty array for a user with no rows', async () => {
    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([])
  })

  it('returns the stored row as a category id, an effective date, and a figure', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300, '2026-08-01')

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'translation', effectiveFrom: '2026-08-01', quotaWph: 300 }
    ])
  })

  // AC6: "The read is always scoped to the session user, never to an id from the request, matching
  // getWorkSchedule." One user's quotas may never appear in another's read.
  it('reads only the requested user rows', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300, '2026-08-01')
    await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 999, '2026-08-01')

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'translation', effectiveFrom: '2026-08-01', quotaWph: 300 }
    ])
    await expect(loadCategoryQuotas(OTHER_USER_ID)).resolves.toEqual([
      { categoryId: 'translation', effectiveFrom: '2026-08-01', quotaWph: 999 }
    ])
  })

  it('orders the rows by effective date ascending', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300, '2026-08-01')
    await seedCategoryQuota(client, OWNER_ID, 'translation', 260, '2026-06-01')
    await seedCategoryQuota(client, OWNER_ID, 'proofreading', 1800, '2026-07-01')

    const rows = await loadCategoryQuotas(OWNER_ID)

    expect(rows.map((row) => row.effectiveFrom)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
  })

  // A row naming an id outside the contract is storable, because the category id is free text so the
  // table already accepts an id PLAN-30 has not created yet. The read path returns it like any other
  // row and the resolver is the layer that declines to use it.
  it('returns a row naming a category id outside the contract', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'ma-categorie', 500, '2026-08-01')

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'ma-categorie', effectiveFrom: '2026-08-01', quotaWph: 500 }
    ])
  })
})

describe('the unique index on (user_id, category_id, effective_from) (AC5)', () => {
  // The index is what makes the write an upsert rather than an append, and the spec's "Two edits on
  // the same day" edge case rests on it: the second edit updates that day's row "rather than two rows
  // the resolver would have to break a tie between". So the database has to refuse the second row
  // rather than leave the resolver to disambiguate.
  //
  // The second insert is written with raw SQL and a different primary key on purpose. The helper
  // derives its id from the same three columns, so a second call through it would collide on the
  // primary key and the test would pass without the unique index existing at all.
  async function insertWithId(
    id: string,
    userId: string,
    categoryId: string,
    quotaWph: number,
    effectiveFrom: string
  ): Promise<void> {
    await client.execute({
      sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph, effective_from)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, userId, categoryId, quotaWph, effectiveFrom]
    })
  }

  // The positive control for the three cases below. An insert with a fresh id succeeds, so a rejection
  // in the next test is the constraint doing its job rather than the fixture being malformed.
  it('accepts a second row with a fresh id when one of the three columns differs', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300, '2026-08-01')

    await expect(
      insertWithId('quota-second-date', OWNER_ID, 'translation', 320, '2026-09-01')
    ).resolves.toBeUndefined()
    await expect(
      insertWithId('quota-second-category', OWNER_ID, 'proofreading', 1800, '2026-08-01')
    ).resolves.toBeUndefined()
    await expect(
      insertWithId('quota-second-user', OTHER_USER_ID, 'translation', 999, '2026-08-01')
    ).resolves.toBeUndefined()

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toHaveLength(3)
  })

  it('refuses a second row for the same user, category, and effective date', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300, '2026-08-01')

    await expect(
      insertWithId('quota-duplicate', OWNER_ID, 'translation', 320, '2026-08-01')
    ).rejects.toThrow(/UNIQUE constraint failed/i)

    // And the first row is still the only one, so the refusal did not half-write anything.
    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'translation', effectiveFrom: '2026-08-01', quotaWph: 300 }
    ])
  })
})

describe('loadResolvedCategoryQuotas', () => {
  // AC6, and the spec's "A user with no rows at all" edge case: "Every trackable category resolves its
  // shipped default, the settings section shows those four figures marked as defaults, and nothing is
  // blank or broken."
  it('resolves the four shipped defaults in contract order for a user with no rows', async () => {
    await seedSettings(client, OWNER_ID, 'America/Toronto')

    await expect(
      loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-23T15:00:00Z'))
    ).resolves.toEqual([
      { categoryId: 'translation', effectiveFrom: null, quotaWph: 240, source: 'default' },
      { categoryId: 'revision_internal', effectiveFrom: null, quotaWph: 1000, source: 'default' },
      { categoryId: 'revision_external', effectiveFrom: null, quotaWph: 1300, source: 'default' },
      { categoryId: 'proofreading', effectiveFrom: null, quotaWph: 2000, source: 'default' }
    ])
  })

  // A user with no settings row at all still resolves, because loadWorkSettings returns the coded
  // defaults and the resolver needs nothing but a date.
  it('resolves for a user with no settings row', async () => {
    const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-23T15:00:00Z'))

    expect(entries).toHaveLength(4)
    expect(entries.every((entry) => entry.source === 'default')).toBe(true)
  })

  // AC6: "Non-trackable categories are absent rather than present with a null quota. That is AC1
  // expressed as absence, and it means the client renders what it is handed instead of filtering on
  // trackable itself."
  it('leaves every non-trackable category out of the response', async () => {
    const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-23T15:00:00Z'))
    const ids = entries.map((entry) => entry.categoryId)

    for (const absent of ['terminology', 'meetings', 'breaks', 'admin', 'dtp', 'other']) {
      expect(ids).not.toContain(absent)
    }
  })

  it('marks a stored figure as the user own and carries the date of the winning row', async () => {
    await seedSettings(client, OWNER_ID, 'America/Toronto')
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300, '2026-08-01')

    const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-23T15:00:00Z'))

    expect(entries[0]).toEqual({
      categoryId: 'translation',
      effectiveFrom: '2026-08-01',
      quotaWph: 300,
      source: 'user'
    })
    // The three the user has not saved are still defaults, which is what makes a partial save a
    // working state rather than an incomplete one.
    expect(entries.slice(1).every((entry) => entry.source === 'default')).toBe(true)
  })

  // A row for an id the contract does not carry is invisible here rather than broken, because the
  // response lists the current trackable categories and the orphan row is never asked about. The row
  // stays in the table, so if the id comes back its quota comes back with it.
  it('does not list an orphan row for a category id outside the contract', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'ma-categorie', 500, '2026-08-01')

    const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-23T15:00:00Z'))

    expect(entries.map((entry) => entry.categoryId)).toEqual([
      'translation',
      'revision_internal',
      'revision_external',
      'proofreading'
    ])
    expect(entries.every((entry) => entry.source === 'default')).toBe(true)
    // The row is still there. Deleting an orphan would be a cleanup that destroys a setting to tidy a
    // table nobody is reading.
    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toHaveLength(1)
  })

  it('never reads another user rows', async () => {
    await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 999, '2026-08-01')

    const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-23T15:00:00Z'))

    expect(entries[0]).toMatchObject({ quotaWph: 240, source: 'default' })
  })

  describe('the timezone boundary on today', () => {
    // The spec: "effectiveFrom defaults to today in the user's stored timezone rather than in UTC, so
    // an edit made late in the evening does not land on tomorrow's date." The same zone decides which
    // row is current, so an instant that is one date in UTC and another in the user's zone has to
    // resolve on the user's zone.
    //
    // 2026-08-24T01:30:00Z is still 2026-08-23 in America/Toronto, which is four hours behind in
    // August. A row effective on the 24th is therefore not yet in force for this user.
    it('resolves on the user own date rather than the UTC date behind it', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedCategoryQuota(client, OWNER_ID, 'translation', 320, '2026-08-24')

      const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-24T01:30:00Z'))

      expect(entries[0]).toEqual({
        categoryId: 'translation',
        effectiveFrom: null,
        quotaWph: 240,
        source: 'default'
      })
    })

    it('applies a row dated the same day as the user own date', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedCategoryQuota(client, OWNER_ID, 'translation', 320, '2026-08-23')

      const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-24T01:30:00Z'))

      expect(entries[0]).toMatchObject({
        effectiveFrom: '2026-08-23',
        quotaWph: 320,
        source: 'user'
      })
    })

    // The other direction, so the case above is about the stored zone rather than about being behind
    // UTC. 2026-08-23T23:30:00Z is already 2026-08-24 in Europe/Paris, so a row dated the 24th is in
    // force for a user in that zone at the same instant it is not in force in Toronto.
    it('honours a zone ahead of UTC on the same instant', async () => {
      await seedSettings(client, OWNER_ID, 'Europe/Paris')
      await seedCategoryQuota(client, OWNER_ID, 'translation', 320, '2026-08-24')

      const entries = await loadResolvedCategoryQuotas(OWNER_ID, new Date('2026-08-23T23:30:00Z'))

      expect(entries[0]).toMatchObject({
        effectiveFrom: '2026-08-24',
        quotaWph: 320,
        source: 'user'
      })
    })
  })
})
