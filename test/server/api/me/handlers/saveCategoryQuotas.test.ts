import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countRows,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readStoredRow,
  seedCategoryQuota,
  seedTask
} from '../../../../helpers/taskTestDb'

// saveCategoryQuotas is the handler behind PATCH /api/me/category-quotas. This suite covers the
// properties docs/specs/planning/per-category-quotas.md states as mechanisms rather than as shapes,
// which are the ones only a real database can demonstrate.
//
//   AC2, rewritten under the snapshot model. "Editing a category quota changes what future tasks are
//   measured against and changes nothing about any task that already exists." Its two verifiable
//   properties are asserted below: a save updates the user's single row for that category in place
//   rather than appending, and a task that already carries a figure keeps it across the save.
//
//   AC6's partial-write rule and the read-back through the single read path.
//
// THE DATED CASES ARE GONE, AND THEY WERE REPLACED RATHER THAN DELETED. This file used to assert that
// a save appended a new dated row and left an earlier one alone, that a backdated save did not touch a
// later row, and that the effective date defaulted to today in the user's own timezone. All three
// asserted the effective-dated mechanism, which the owner replaced on 2026-08-24, so they were wrong
// rather than redundant. What stands in their place is the guarantee they existed to serve, and it is a
// stronger property: the old tests could only assert something about a date comparison, and the ones
// below assert it about the stored row on the task.
//
// The seam is useDb, which returns a genuine Drizzle instance over an in-memory libSQL database
// carrying the shipped DDL and the unique index the upsert conflicts on. A faked query builder would
// record the statement and prove nothing about whether a second save added a row or replaced one,
// which is the entire question here. Row counts are read with raw SQL so the code under test is not
// also what reads back its own work.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { loadResolvedCategoryQuotas } = await import('~~/server/utils/loadCategoryQuotas')
const { saveCategoryQuotas } = await import('~~/server/api/me/handlers/saveCategoryQuotas')
// The create handler, imported so the AC2 case below can write a real task through the real write path
// rather than describing one. The snapshot is what makes the guarantee true, so a fixture inserted with
// raw SQL would be asserting nothing about the mechanism.
const { createTask } = await import('~~/server/api/tasks/handlers/create')
const { TaskCreateSchema } = await import('~~/server/models/tasks')
// The resolver and the read path behind it, imported so the AC2 cases can assert what the task
// actually resolves to rather than only what its column holds. AC2's first property ends with
// "resolve the task again", and a stored figure that has not moved is only half of that: the other
// half is that resolution reads the task's own figure before it reads the category row, which is the
// step an assertion on the column alone cannot see.
const { loadCategoryQuotas } = await import('~~/server/utils/loadCategoryQuotas')
const { resolveTaskQuota } = await import('~~/server/utils/resolveCategoryQuota')

const event = { __event: true } as never

let harness: TaskTestDb
let client: Client

// What a task actually resolves to, composed the way a reader will compose it: the row as the
// database holds it, the user's current records, and the resolver over both. This is the assertion
// AC2's requirement is written in terms of, so the cases below make it rather than stopping at the
// column and inferring the rest.
async function resolvedTaskQuota(taskId: string) {
  const stored = await readStoredRow(client, taskId)
  const records = await loadCategoryQuotas(OWNER_ID)

  return resolveTaskQuota(
    {
      category: stored?.category,
      quotaWphOverride: stored?.quota_wph_override as number | null
    },
    records
  )
}

// The stored rows for one user, read with raw SQL.
async function storedRows(userId = OWNER_ID) {
  const result = await client.execute({
    sql: `SELECT category_id, quota_wph FROM category_quotas
          WHERE user_id = ? ORDER BY category_id ASC`,
    args: [userId]
  })
  return result.rows.map((row) => ({
    categoryId: String(row.category_id),
    quotaWph: Number(row.quota_wph)
  }))
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  // The auto-imported helpers the handlers call as free identifiers. loadResolvedCategoryQuotas is the
  // real function rather than a stand-in, because it reads through the same mocked useDb and a stub
  // would hide whether the read-back reflects the write.
  vi.stubGlobal('requireUserSession', async () => ({ user: { id: OWNER_ID } }))
  vi.stubGlobal('loadResolvedCategoryQuotas', loadResolvedCategoryQuotas)
  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string; data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
})

describe('saveCategoryQuotas', () => {
  describe('a save updates the row in place (AC2)', () => {
    // AC2's second verifiable property, word for word: "A save to category_quotas for a category that
    // already has a row leaves one row rather than two, and the row holds the new figure. Assert the row
    // count as well as the value, because a stray second row is the failure this table's unique key
    // exists to prevent."
    it('leaves one row holding the later figure rather than adding a second', async () => {
      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })
      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 320 }] })

      expect(await countRows(client, 'category_quotas')).toBe(1)
      expect(await storedRows()).toEqual([{ categoryId: 'translation', quotaWph: 320 }])
    })

    // A typo corrected three times in a morning is still one row, which is why the settings section
    // needs no date control to be useful.
    it('still leaves one row after several saves', async () => {
      for (const quotaWph of [300, 310, 320, 330]) {
        await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph }] })
      }

      expect(await countRows(client, 'category_quotas')).toBe(1)
      expect((await storedRows())[0]?.quotaWph).toBe(330)
    })

    // A row the user already had is updated rather than joined by a second one, which is the same
    // property from a starting state the handler did not create.
    it('updates a row that was already there rather than appending beside it', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'translation', 260)

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })

      expect(await countRows(client, 'category_quotas')).toBe(1)
      expect(await storedRows()).toEqual([{ categoryId: 'translation', quotaWph: 300 }])
    })
  })

  describe('editing a quota cannot restate a task that already exists (AC2)', () => {
    // AC2's first verifiable property, word for word: "Create a task in a trackable category. Save a
    // different quota for that category. Resolve the task again and assert its figure is unchanged. The
    // old criterion could only assert this about a date comparison. This asserts it about the row."
    //
    // This is the whole reason the snapshot model replaced effective dating, so it is asserted against
    // the real write path and the real database rather than against the pure resolver, which cannot see
    // whether anything was stored.
    function body(input: Record<string, unknown>) {
      const parsed = TaskCreateSchema.safeParse(input)
      if (!parsed.success) throw new Error(`fixture body is not a valid request: ${parsed.error}`)
      return parsed.data
    }

    it('leaves a task figure alone when the category setting changes afterwards', async () => {
      const created = await createTask(event, body({ date: '2026-08-23', category: 'translation' }))

      // The snapshot is the shipped default, since the user had saved nothing yet.
      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(240)

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 999 }] })

      // The setting moved and the task did not.
      expect(await storedRows()).toEqual([{ categoryId: 'translation', quotaWph: 999 }])
      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(240)

      // And the figure the task is measured against did not move either, which is the sentence the
      // criterion actually ends on. Without this the case proves the column is stable and leaves the
      // step from a stable column to a stable answer to a resolver tested in another file against
      // hand-built records. A reordering that read the category row before the task's own figure
      // would break AC2 and still pass every assertion above it.
      expect(await resolvedTaskQuota(created.id)).toEqual({ quotaWph: 240, source: 'task' })
    })

    it('gives a task created after the save the new figure', async () => {
      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 999 }] })

      const created = await createTask(event, body({ date: '2026-08-23', category: 'translation' }))

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(999)
    })

    // AC2's third property, and it is asserted about a task because that is what the property is
    // about. The version this replaced called loadResolvedCategoryQuotas and checked the category's
    // own entry, which is a true statement about the settings endpoint and says nothing about a task,
    // so a case named for a task with no figure contained no task at all.
    //
    // This is also the boundary of AC2's guarantee, so it is worth having as a test rather than only
    // as prose. The snapshot protects a task that carries a figure. A task with NULL, which is every
    // row written before AC12 shipped plus every figure a user deliberately cleared, still follows
    // the current setting and therefore still moves when that setting is edited. "Existing tasks keep
    // their NULL" records that as the honest cost; this asserts it, so the day someone reads AC2 as
    // covering the whole table there is a green test showing exactly which rows it does not cover.
    it('lets a task with no figure of its own follow the current setting, and move with it', async () => {
      await seedTask(client, {
        id: 'task-null',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: null
      })

      // The shipped default, since the user has saved nothing and the row carries nothing.
      expect(await resolvedTaskQuota('task-null')).toEqual({ quotaWph: 240, source: 'default' })

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })

      // It moved. Unlike the task two cases above, which carried its own figure and did not.
      expect(await resolvedTaskQuota('task-null')).toEqual({ quotaWph: 300, source: 'user' })
    })
  })

  describe('the write is partial by design (AC6)', () => {
    it('writes only the categories the body carries', async () => {
      await saveCategoryQuotas(event, {
        quotas: [
          { categoryId: 'translation', quotaWph: 300 },
          { categoryId: 'proofreading', quotaWph: 1800 }
        ]
      })

      expect(await storedRows()).toEqual([
        { categoryId: 'proofreading', quotaWph: 1800 },
        { categoryId: 'translation', quotaWph: 300 }
      ])
    })

    it('leaves a category the body does not mention untouched', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'proofreading', 1800)

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })

      expect(await storedRows()).toEqual([
        { categoryId: 'proofreading', quotaWph: 1800 },
        { categoryId: 'translation', quotaWph: 300 }
      ])
    })
  })

  describe('the write is scoped to the session user', () => {
    it('never touches another user row', async () => {
      await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 999)

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })

      expect(await storedRows(OTHER_USER_ID)).toEqual([
        { categoryId: 'translation', quotaWph: 999 }
      ])
      expect(await storedRows(OWNER_ID)).toEqual([{ categoryId: 'translation', quotaWph: 300 }])
    })
  })

  describe('the updated instant is set by hand on a conflict', () => {
    // $defaultFn fires on insert only, so an update that forgets updatedAt leaves the instant the row
    // was first written. A stale instant is not visible anywhere yet, which is exactly why it needs a
    // test rather than a reader to notice it.
    it('moves updated_at when a save updates an existing row', async () => {
      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 300 }] })

      await client.execute(
        "UPDATE category_quotas SET updated_at = 0 WHERE category_id = 'translation'"
      )

      await saveCategoryQuotas(event, { quotas: [{ categoryId: 'translation', quotaWph: 320 }] })

      const result = await client.execute(
        "SELECT updated_at FROM category_quotas WHERE category_id = 'translation'"
      )

      expect(Number(result.rows[0]?.updated_at)).toBeGreaterThan(0)
    })
  })

  describe('the response is read back through the single read path (AC6)', () => {
    // "The response is the same shape the GET returns, read back through the single read path, so the
    // client reconciles against what the database actually holds." A response assembled from the body
    // would look right even if nothing had been stored. Asserted as an exact set so a reintroduced
    // effectiveFrom on the response fails here.
    it('returns the full resolved set with the saved figure marked as the user own', async () => {
      const response = await saveCategoryQuotas(event, {
        quotas: [{ categoryId: 'translation', quotaWph: 300 }]
      })

      expect(response).toEqual([
        { categoryId: 'translation', quotaWph: 300, source: 'user' },
        { categoryId: 'revision_internal', quotaWph: 1000, source: 'default' },
        { categoryId: 'revision_external', quotaWph: 1300, source: 'default' },
        { categoryId: 'proofreading', quotaWph: 2000, source: 'default' }
      ])
    })
  })
})
