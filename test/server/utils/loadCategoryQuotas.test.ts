import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../helpers/taskTestDb'

import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedCategoryQuota
} from '../../helpers/taskTestDb'

// The read path over category_quotas and the resolved set both handlers of
// /api/me/category-quotas return, from docs/specs/planning/per-category-quotas.md AC6 ("The read path
// and the resolver") and AC1, plus the "A user with no rows at all" edge case. Every expectation is
// derived from the spec rather than from the implementation.
//
// The spec fixes: loadCategoryQuotas reads one user's rows and is the single read path behind both
// handlers; the resolved set is one entry per trackable category in contract order, each already
// resolved to the figure currently in force; non-trackable categories are absent rather than present
// with a null quota; source says whether the figure came from a stored row or the shipped default.
//
// NOTHING HERE IS DATED. Under the snapshot model the table holds one current figure per user and
// category, so the ORDER BY effective_from this suite used to assert is gone with the column, and so is
// the whole "timezone boundary on today" block: the response is not date-dependent, the handlers read
// no timezone, and loadResolvedCategoryQuotas takes no instant to pin. Those cases were removed rather
// than adapted, because they asserted behaviour the read path must no longer have. The unique index
// cases stay and narrow from three columns to two, which is a stronger property rather than a weaker
// one: the database now refuses a second row for a user and category outright.
//
// The seam is useDb, which returns a genuine Drizzle instance over an in-memory libSQL database
// carrying the shipped DDL, including the unique index the write upserts on. A faked query builder
// would record whatever the read happened to pass it and prove nothing about scoping or the
// constraint, and the constraint is one of the things this suite is here to check. Fixtures go in
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
  // The spec: "No rows returns an empty array and no caller special-cases it, because the resolver
  // then supplies the shipped default."
  it('returns an empty array for a user with no rows', async () => {
    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([])
  })

  // A record is a category id and a figure, and nothing else. Asserted as an exact object so a
  // reintroduced effective date fails here rather than riding along unnoticed.
  it('returns the stored row as a category id and a figure', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'translation', quotaWph: 300 }
    ])
  })

  // AC6: "The read is always scoped to the session user, never to an id from the request, matching
  // getWorkSchedule." One user's quotas may never appear in another's read.
  it('reads only the requested user rows', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300)
    await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 999)

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'translation', quotaWph: 300 }
    ])
    await expect(loadCategoryQuotas(OTHER_USER_ID)).resolves.toEqual([
      { categoryId: 'translation', quotaWph: 999 }
    ])
  })

  // One row per category, so a read of several categories returns one record each and the resolver has
  // no tie to break. This is what the ordering assertion turned into: there is nothing to order.
  it('returns one row per category the user has saved', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300)
    await seedCategoryQuota(client, OWNER_ID, 'proofreading', 1800)

    const rows = await loadCategoryQuotas(OWNER_ID)

    expect(rows).toHaveLength(2)
    expect([...rows].sort((a, b) => a.categoryId.localeCompare(b.categoryId))).toEqual([
      { categoryId: 'proofreading', quotaWph: 1800 },
      { categoryId: 'translation', quotaWph: 300 }
    ])
  })

  // A row naming an id outside the contract is storable, because the category id is free text so the
  // table already accepts an id PLAN-30 has not created yet. The read path returns it like any other
  // row and the resolver is the layer that declines to use it.
  it('returns a row naming a category id outside the contract', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'ma-categorie', 500)

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'ma-categorie', quotaWph: 500 }
    ])
  })
})

describe('the unique index on (user_id, category_id) (AC5)', () => {
  // The index is what makes the write an update in place rather than an append, and AC2's second
  // verifiable property rests on it: "A save to category_quotas for a category that already has a row
  // leaves one row rather than two." So the database has to refuse the second row rather than leave the
  // resolver to disambiguate. This narrowed from three columns to two along with the column that went,
  // and it forbids strictly more than it used to.
  //
  // The second insert is written with raw SQL and a different primary key on purpose. The helper
  // derives its id from the same two columns, so a second call through it would collide on the
  // primary key and the test would pass without the unique index existing at all.
  async function insertWithId(
    id: string,
    userId: string,
    categoryId: string,
    quotaWph: number
  ): Promise<void> {
    await client.execute({
      sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
            VALUES (?, ?, ?, ?)`,
      args: [id, userId, categoryId, quotaWph]
    })
  }

  // The positive control for the case below. An insert with a fresh id succeeds when one of the two
  // columns differs, so a rejection in the next test is the constraint doing its job rather than the
  // fixture being malformed.
  it('accepts a second row with a fresh id when one of the two columns differs', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

    await expect(
      insertWithId('quota-second-category', OWNER_ID, 'proofreading', 1800)
    ).resolves.toBeUndefined()
    await expect(
      insertWithId('quota-second-user', OTHER_USER_ID, 'translation', 999)
    ).resolves.toBeUndefined()

    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toHaveLength(2)
  })

  it('refuses a second row for the same user and category', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

    await expect(insertWithId('quota-duplicate', OWNER_ID, 'translation', 320)).rejects.toThrow(
      /UNIQUE constraint failed/i
    )

    // And the first row is still the only one, so the refusal did not half-write anything.
    await expect(loadCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'translation', quotaWph: 300 }
    ])
  })

  // The narrowing is the point, so it gets its own case. Under the old three-column index a second row
  // for the same user and category was legal as long as it carried a different date, which is exactly
  // the history the snapshot model does away with. That row is now refused whatever else it says.
  it('refuses a second row for the same user and category however else it differs', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

    await expect(insertWithId('quota-other-figure', OWNER_ID, 'translation', 1)).rejects.toThrow(
      /UNIQUE constraint failed/i
    )
  })
})

describe('loadResolvedCategoryQuotas', () => {
  // AC6, and the spec's "A user with no rows at all" edge case: "Every trackable category resolves its
  // shipped default, the settings section shows those four figures marked as defaults, and nothing is
  // blank or broken." The entries carry a figure and a source and no date.
  it('resolves the four shipped defaults in contract order for a user with no rows', async () => {
    await expect(loadResolvedCategoryQuotas(OWNER_ID)).resolves.toEqual([
      { categoryId: 'translation', quotaWph: 240, source: 'default' },
      { categoryId: 'revision_internal', quotaWph: 1000, source: 'default' },
      { categoryId: 'revision_external', quotaWph: 1300, source: 'default' },
      { categoryId: 'proofreading', quotaWph: 2000, source: 'default' }
    ])
  })

  // The response no longer depends on the user's settings row at all, because nothing in the
  // resolution asks what day it is. A user with no settings row resolves exactly the same set, which is
  // one fewer read and one fewer thing that can fail.
  it('resolves without reading a settings row', async () => {
    const entries = await loadResolvedCategoryQuotas(OWNER_ID)

    expect(entries).toHaveLength(4)
    expect(entries.every((entry) => entry.source === 'default')).toBe(true)
  })

  // AC6: "Non-trackable categories are absent rather than present with a null quota. That is AC1
  // expressed as absence, and it means the client renders what it is handed instead of filtering on
  // trackable itself."
  it('leaves every non-trackable category out of the response', async () => {
    const entries = await loadResolvedCategoryQuotas(OWNER_ID)
    const ids = entries.map((entry) => entry.categoryId)

    for (const absent of ['terminology', 'meetings', 'breaks', 'admin', 'dtp', 'other']) {
      expect(ids).not.toContain(absent)
    }
  })

  it('marks a stored figure as the user own', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

    const entries = await loadResolvedCategoryQuotas(OWNER_ID)

    expect(entries[0]).toEqual({ categoryId: 'translation', quotaWph: 300, source: 'user' })
    // The three the user has not saved are still defaults, which is what makes a partial save a
    // working state rather than an incomplete one.
    expect(entries.slice(1).every((entry) => entry.source === 'default')).toBe(true)
  })

  // A row for an id the contract does not carry is invisible here rather than broken, because the
  // response lists the current trackable categories and the orphan row is never asked about. The row
  // stays in the table, so if the id comes back its quota comes back with it.
  it('does not list an orphan row for a category id outside the contract', async () => {
    await seedCategoryQuota(client, OWNER_ID, 'ma-categorie', 500)

    const entries = await loadResolvedCategoryQuotas(OWNER_ID)

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
    await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 999)

    const entries = await loadResolvedCategoryQuotas(OWNER_ID)

    expect(entries[0]).toMatchObject({ quotaWph: 240, source: 'default' })
  })
})
