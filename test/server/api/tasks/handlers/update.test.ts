import type { Client } from '@libsql/client'

import { TaskUpdateSchema } from '~~/server/models/tasks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countTasks,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readStoredRow,
  seedTask
} from '../../../../helpers/taskTestDb'

// updateTask, the handler behind PATCH /api/tasks/[id].
//
// Derived from docs/specs/planning/task-write-api.md acceptance criteria AC4, AC5, AC14, AC15, AC17,
// AC23, AC24, AC28, AC39 and AC40, plus "Partial update semantics, absent against explicit null",
// "Status is validated against the category, on the resulting row" and "sort_order is assigned by
// the server".
//
// The merged-row cross-check (AC23 to AC25) is handler logic rather than schema logic: a body
// sending only { category: 'breaks' } is perfectly valid and produces an invalid row, and Zod only
// ever sees the request. So it is exercised here against real stored rows.
//
// Same seam as the create suite: only useDb, requireUserSession and createError are stubbed, and the
// database is a real in-memory SQLite with the shipped tasks DDL. Fixtures are inserted with raw SQL
// so the write path never shapes its own starting state.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { updateTask } = await import('~~/server/api/tasks/handlers/update')

const event = { __event: true } as never

let harness: TaskTestDb
let client: Client

// A valid patch body as the route would hand it over.
function patch(input: Record<string, unknown>) {
  const parsed = TaskUpdateSchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture patch is not a valid request: ${parsed.error}`)
  return parsed.data
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  vi.stubGlobal('requireUserSession', async () => ({ user: { id: OWNER_ID } }))
  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string; data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
})

describe('updateTask', () => {
  describe('ownership and the not-found case (AC4, AC39)', () => {
    it('returns 404 for an id that matches no row', async () => {
      await expect(updateTask(event, 'nope', patch({ client: 'Acme' }))).rejects.toMatchObject({
        statusCode: 404,
        statusMessage: 'task_not_found'
      })
    })

    // PATCH is never an upsert, so a second tab having already deleted the row leaves nothing behind.
    it('creates no row as a side effect of a 404', async () => {
      await expect(updateTask(event, 'nope', patch({ client: 'Acme' }))).rejects.toThrow()

      expect(await countTasks(client)).toBe(0)
    })

    // The missing case and the not-yours case are deliberately indistinguishable: same status, same
    // body, no message difference, so a caller holding a session cannot enumerate real ids.
    it('returns the same 404 for a row belonging to another user', async () => {
      await seedTask(client, {
        id: 'theirs',
        userId: OTHER_USER_ID,
        date: '2026-07-20',
        category: 'translation',
        client: 'Their client'
      })

      await expect(updateTask(event, 'theirs', patch({ client: 'Mine' }))).rejects.toMatchObject({
        statusCode: 404,
        statusMessage: 'task_not_found'
      })
    })

    it('leaves the other user row untouched', async () => {
      await seedTask(client, {
        id: 'theirs',
        userId: OTHER_USER_ID,
        date: '2026-07-20',
        category: 'translation',
        client: 'Their client'
      })

      await expect(updateTask(event, 'theirs', patch({ client: 'Mine' }))).rejects.toThrow()

      expect((await readStoredRow(client, 'theirs'))?.client).toBe('Their client')
    })

    it('scopes the write to the session user even when a userId is smuggled past the schema', async () => {
      await seedTask(client, { id: 'mine', date: '2026-07-20', category: 'translation' })
      const smuggled = { ...patch({ client: 'Acme' }), userId: OTHER_USER_ID } as never

      const updated = await updateTask(event, 'mine', smuggled)

      expect(updated.client).toBe('Acme')
      expect((await readStoredRow(client, 'mine'))?.user_id).toBe(OWNER_ID)
    })
  })

  describe('absent against explicit null (AC14)', () => {
    beforeEach(async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        client: 'Acme',
        project: 'Manual',
        projectWordCount: 12_000,
        estimatedMinutes: 120,
        actualMinutes: 95,
        status: 'En cours'
      })
    })

    it('leaves every column the patch omits unchanged', async () => {
      await updateTask(event, 'task-1', patch({ client: 'Beta' }))
      const stored = await readStoredRow(client, 'task-1')

      expect(stored).toMatchObject({
        client: 'Beta',
        project: 'Manual',
        project_word_count: 12_000,
        estimated_minutes: 120,
        actual_minutes: 95,
        status: 'En cours',
        date: '2026-07-20',
        category: 'translation'
      })
    })

    // effectiveDuration reads NULL as "the user did not measure this", so an explicit null is the
    // only way back from a wrong duration to unmeasured.
    it('clears the column when the patch sends an explicit null', async () => {
      const updated = await updateTask(event, 'task-1', patch({ actualMinutes: null }))

      expect((await readStoredRow(client, 'task-1'))?.actual_minutes).toBeNull()
      expect(updated.actualMinutes).toBeNull()
      // The row falls back to its estimate again through effectiveDuration at read time.
      expect(updated.estimatedMinutes).toBe(120)
    })

    // Zero minutes is a measurement, not a clear, and the row must not fall back after it.
    it('stores an explicit 0 as a measurement', async () => {
      const updated = await updateTask(event, 'task-1', patch({ actualMinutes: 0 }))

      expect((await readStoredRow(client, 'task-1'))?.actual_minutes).toBe(0)
      expect(updated.actualMinutes).toBe(0)
    })

    it('clears free text sent as an empty string (AC11)', async () => {
      await updateTask(event, 'task-1', patch({ client: '' }))

      expect((await readStoredRow(client, 'task-1'))?.client).toBeNull()
    })

    // A words figure the patch carried lands verbatim in the one column that holds it. This used to
    // be the surviving half of a test that also asserted the patch left words_done alone, and PLAN-33
    // dropped that column, so what remains is the part with a live subject.
    it('stores a changed project_word_count', async () => {
      await updateTask(event, 'task-1', patch({ projectWordCount: 20_000 }))

      expect((await readStoredRow(client, 'task-1'))?.project_word_count).toBe(20_000)
    })
  })

  describe('updatedAt is refreshed on every mutation (AC15)', () => {
    // $defaultFn fires on insert only, so an update that forgets updatedAt leaves a stale instant.
    it('advances updated_at past the stored value', async () => {
      const stale = new Date('2020-01-01T00:00:00Z')
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        updatedAt: stale
      })

      const before = Number((await readStoredRow(client, 'task-1'))?.updated_at)
      await updateTask(event, 'task-1', patch({ client: 'Acme' }))
      const after = Number((await readStoredRow(client, 'task-1'))?.updated_at)

      expect(before).toBe(Math.floor(stale.getTime() / 1000))
      expect(after).toBeGreaterThan(before)
    })
  })

  describe('the estimate never writes the actual (AC17)', () => {
    // -------------------------------------------------------------------------------------------
    // DO NOT MAKE THESE PASS BY AUTO-FILLING actual_minutes FROM estimated_minutes.
    //
    // AC17: "No code path in create.ts or update.ts reads estimatedMinutes in order to write
    // actualMinutes. An update that changes estimatedMinutes leaves actual_minutes exactly as it
    // was, NULL included." This is the 2026-07-29 locked decision. Storing the copy makes a duration
    // the user confirmed and a duration the app assumed into identical rows, and nothing downstream
    // can tell them apart afterwards. The assertions read the stored column rather than the
    // response, because the response resolves the fallback for display and would look right either
    // way.
    // -------------------------------------------------------------------------------------------
    it('leaves a NULL actual_minutes NULL when the estimate changes', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        estimatedMinutes: 120
      })

      await updateTask(event, 'task-1', patch({ estimatedMinutes: 240 }))
      const stored = await readStoredRow(client, 'task-1')

      expect(stored?.estimated_minutes).toBe(240)
      expect(stored?.actual_minutes).toBeNull()
    })

    it('leaves an existing actual_minutes exactly as it was when the estimate changes', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        estimatedMinutes: 120,
        actualMinutes: 95
      })

      await updateTask(event, 'task-1', patch({ estimatedMinutes: 240 }))
      const stored = await readStoredRow(client, 'task-1')

      expect(stored?.actual_minutes).toBe(95)
    })
  })

  describe('status is cross-checked against the merged row (AC23, AC24, AC25)', () => {
    it('refuses a status asserted on a task whose category is already non-trackable', async () => {
      await seedTask(client, { id: 'break-1', date: '2026-07-20', category: 'breaks' })

      await expect(
        updateTask(event, 'break-1', patch({ status: 'En cours' }))
      ).rejects.toMatchObject({ statusCode: 422 })

      expect((await readStoredRow(client, 'break-1'))?.status).toBeNull()
    })

    it('refuses a body that moves to a non-trackable category and asserts a status at once', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        status: 'Accepté'
      })

      await expect(
        updateTask(event, 'task-1', patch({ category: 'breaks', status: 'En cours' }))
      ).rejects.toMatchObject({ statusCode: 422 })

      // Nothing was written: the category and the status are both as they were.
      expect(await readStoredRow(client, 'task-1')).toMatchObject({
        category: 'translation',
        status: 'Accepté'
      })
    })

    // -------------------------------------------------------------------------------------------
    // AC24, the criterion the whole merged-row design exists for. A patch of { category: 'breaks' }
    // on a task holding 'En cours' is a perfectly valid body producing an invalid row, so the check
    // cannot live in Zod. The client asserted nothing about status, so this is not an error: the
    // server keeps the row valid on its own. Refusing until the client also sent status: null would
    // force PLAN-11's editor to know which categories are trackable in order to compose a valid
    // request, which is the backend rule leaking into the frontend the conventions forbid.
    // -------------------------------------------------------------------------------------------
    it('clears the stored status when the patch moves the task to a non-trackable category', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        status: 'En cours'
      })

      const updated = await updateTask(event, 'task-1', patch({ category: 'breaks' }))

      expect((await readStoredRow(client, 'task-1'))?.status).toBeNull()
      expect(updated.status).toBeNull()
      expect(updated.statusKey).toBe('na')
      expect(updated.trackable).toBe(false)
    })

    it('accepts the same move stated in full with an explicit null status', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        status: 'En cours'
      })

      const updated = await updateTask(event, 'task-1', patch({ category: 'breaks', status: null }))

      expect((await readStoredRow(client, 'task-1'))?.status).toBeNull()
      expect(updated.statusKey).toBe('na')
    })

    it('leaves the status alone when the category moves between two trackable ones', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        status: 'En cours'
      })

      const updated = await updateTask(event, 'task-1', patch({ category: 'proofreading' }))

      expect((await readStoredRow(client, 'task-1'))?.status).toBe('En cours')
      expect(updated.statusKey).toBe('encours')
    })

    it('is a no-op on status when the task already had none', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      const updated = await updateTask(event, 'task-1', patch({ category: 'meetings' }))

      expect((await readStoredRow(client, 'task-1'))?.status).toBeNull()
      expect(updated.statusKey).toBe('na')
    })

    it('accepts a status on a task whose patch moves it to a trackable category', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'breaks' })

      const updated = await updateTask(
        event,
        'task-1',
        patch({ category: 'translation', status: 'Accepté' })
      )

      expect((await readStoredRow(client, 'task-1'))?.status).toBe('Accepté')
      expect(updated.statusKey).toBe('accepte')
    })

    // Trackability is read from the shared contract, so every non-trackable id behaves the same way
    // rather than a hand-written subset of them.
    it.each(['terminology', 'meetings', 'breaks', 'admin', 'dtp'])(
      'clears the status when moving to the non-trackable category %s',
      async (category) => {
        await seedTask(client, {
          id: `task-${category}`,
          date: '2026-07-20',
          category: 'translation',
          status: 'Terminé'
        })

        await updateTask(event, `task-${category}`, patch({ category }))

        expect((await readStoredRow(client, `task-${category}`))?.status).toBeNull()
      }
    )
  })

  describe('sort_order on a date change (AC28)', () => {
    it('reassigns sort_order to the end of the destination day', async () => {
      await seedTask(client, {
        id: 'moving',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 0
      })
      await seedTask(client, { id: 'there-1', date: '2026-07-21', category: 'admin', sortOrder: 0 })
      await seedTask(client, { id: 'there-2', date: '2026-07-21', category: 'admin', sortOrder: 1 })

      const updated = await updateTask(event, 'moving', patch({ date: '2026-07-21' }))

      expect(updated.sortOrder).toBe(2)
      expect((await readStoredRow(client, 'moving'))?.sort_order).toBe(2)
    })

    it('gives sort_order 0 when the destination day is empty', async () => {
      await seedTask(client, {
        id: 'moving',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 5
      })

      const updated = await updateTask(event, 'moving', patch({ date: '2026-07-21' }))

      expect(updated.sortOrder).toBe(0)
    })

    // The old value is an ordinal within a different day, so only a real move reassigns it.
    it('leaves sort_order alone when the patch does not change the date', async () => {
      await seedTask(client, {
        id: 'staying',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 5
      })

      const updated = await updateTask(event, 'staying', patch({ client: 'Acme' }))

      expect(updated.sortOrder).toBe(5)
    })

    it('leaves sort_order alone when the patch sends the same date it already had', async () => {
      await seedTask(client, {
        id: 'staying',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 5
      })

      const updated = await updateTask(event, 'staying', patch({ date: '2026-07-20' }))

      expect(updated.sortOrder).toBe(5)
    })

    it('scopes the destination scan to the session user', async () => {
      await seedTask(client, {
        id: 'moving',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 0
      })
      await seedTask(client, {
        id: 'theirs',
        userId: OTHER_USER_ID,
        date: '2026-07-21',
        category: 'admin',
        sortOrder: 9
      })

      const updated = await updateTask(event, 'moving', patch({ date: '2026-07-21' }))

      expect(updated.sortOrder).toBe(0)
    })

    // The server does not filter its own response: dropping a row whose date left the loaded range
    // is presentation, and belongs to the client.
    it('returns the moved row rather than withholding it', async () => {
      await seedTask(client, { id: 'moving', date: '2026-07-20', category: 'translation' })

      const updated = await updateTask(event, 'moving', patch({ date: '2027-01-04' }))

      expect(updated.date).toBe('2027-01-04')
    })
  })

  describe('the response is a TaskListItem (AC40)', () => {
    it('returns exactly the contract fields, statusKey and trackable included', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      const updated = await updateTask(event, 'task-1', patch({ status: 'En cours' }))

      expect(Object.keys(updated).sort()).toEqual(
        [
          'actualMinutes',
          'category',
          'client',
          'date',
          'deliveryDate',
          'deliveryTime',
          'estimatedMinutes',
          'excludeFromStats',
          'id',
          'project',
          'projectWordCount',
          'quotaWphOverride',
          'sortOrder',
          'splitGroupId',
          'status',
          'statusKey',
          'trackable'
        ].sort()
      )

      // The contract shape is pinned rather than merely unasserted. PLAN-33 dropped words_done, so
      // the key is absent from the response rather than present and null.
      expect('wordsDone' in updated).toBe(false)

      expect(updated).toMatchObject({ id: 'task-1', status: 'En cours', statusKey: 'encours' })
    })

    it('resolves the late verdict server-side on the updated row', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        deliveryDate: '2020-01-01',
        deliveryTime: '09:00'
      })

      const updated = await updateTask(event, 'task-1', patch({ status: 'Accepté' }))

      expect(updated.statusKey).toBe('retard')
    })

    it('drops the late verdict once the row is marked finished', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        status: 'Accepté',
        deliveryDate: '2020-01-01',
        deliveryTime: '09:00'
      })

      const updated = await updateTask(event, 'task-1', patch({ status: 'Terminé' }))

      expect(updated.statusKey).toBe('termine')
    })
  })

  describe('last write wins per field', () => {
    // A partial body narrows the blast radius when two tabs are open: a patch touching only status
    // cannot clobber an actual_minutes the other tab just wrote.
    it('does not clobber a field the patch does not carry', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        actualMinutes: 95,
        status: 'Accepté'
      })

      await updateTask(event, 'task-1', patch({ status: 'En cours' }))
      const stored = await readStoredRow(client, 'task-1')

      expect(stored?.status).toBe('En cours')
      expect(stored?.actual_minutes).toBe(95)
    })
  })
})
