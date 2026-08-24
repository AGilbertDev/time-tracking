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
  seedCategoryQuota,
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

    // Replaces the guard that used to assert words_done stayed NULL when the word count changed.
    // Migration 0008 dropped the column, so `SELECT words_done` is now a SQL error rather than an
    // assertion. It is replaced rather than deleted per task-inline-editor.md AC8: a patch carrying
    // wordsDone is still a 422, now as an unknown key refused by strict() rather than as a named
    // exclusion, and nothing here would otherwise notice a later hand re-adding the column.
    it('refuses a patch carrying wordsDone, and stores the word count with no second column', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        projectWordCount: 5_000
      })

      expect(TaskUpdateSchema.safeParse({ wordsDone: 500 }).success).toBe(false)

      await updateTask(event, 'task-1', patch({ projectWordCount: 12_000 }))
      const stored = await readStoredRow(client, 'task-1')
      const columns = Object.keys(stored ?? {})

      // Positive control first, so the absence below is a finding rather than an empty read.
      expect(stored?.project_word_count).toBe(12_000)
      expect(columns).toContain('project_word_count')

      expect(columns).not.toContain('words_done')
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

    // The rule is read from the shared contract, so every id that carries no status behaves the same
    // way rather than a hand-written subset of them. These five are the kinds of consumed time, which
    // is a narrower set than the six non-trackable ids, because `other` is non-trackable and does
    // carry a status. That distinction is the next two tests.
    it.each(['terminology', 'meetings', 'breaks', 'admin', 'dtp'])(
      'clears the status when moving to the non-deliverable category %s',
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

    // -------------------------------------------------------------------------------------------
    // UC13, and the data-loss path this feature would have created rather than inherited if the
    // clearing rule had stayed keyed on trackability. `other` is not trackable, so a guard reading
    // isTrackableCategory would wipe a stored status the moment a user moved a row to Autre, silently
    // and as part of a write they made for another reason. The guard reads the deliverable flag
    // instead, so moving to `other` clears nothing.
    //
    // Read back from the row rather than only off the response, because the criterion is about what
    // the database holds afterwards.
    // -------------------------------------------------------------------------------------------
    it('leaves the stored status alone when the patch moves the task to other', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        status: 'Terminé'
      })

      const updated = await updateTask(event, 'task-1', patch({ category: 'other' }))

      expect((await readStoredRow(client, 'task-1'))?.status).toBe('Terminé')
      expect(updated.status).toBe('Terminé')
      expect(updated.statusKey).toBe('termine')
      // The row is not trackable and it does carry a status, which is the pair of facts that made the
      // two flags necessary. Asserted together so neither can be read as implying the other.
      expect(updated.trackable).toBe(false)
      expect(updated.deliverable).toBe(true)
    })

    // UC12: the same move stated in full is legal too, so a client that does send the status is not
    // punished for it. This is the create-and-update symmetry assertStatusFitsCategory guarantees.
    it('accepts a move to other that asserts a status at the same time', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'breaks' })

      const updated = await updateTask(
        event,
        'task-1',
        patch({ category: 'other', status: 'En cours' })
      )

      expect((await readStoredRow(client, 'task-1'))?.status).toBe('En cours')
      expect(updated.statusKey).toBe('encours')
    })

    // The reverse direction, which is the workflow the default exists to allow. A row that landed on
    // `other` and was later classified keeps its status and starts counting toward the quota, and
    // nothing warns, because classifying a row later is ordinary rather than an error.
    it('keeps the status when moving from other to a trackable category', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'other',
        status: 'Terminé'
      })

      const updated = await updateTask(event, 'task-1', patch({ category: 'translation' }))

      expect((await readStoredRow(client, 'task-1'))?.status).toBe('Terminé')
      expect(updated.trackable).toBe(true)
      expect(updated.deliverable).toBe(true)
    })

    // And the path that does still clear, starting from `other` rather than from a trackable id, so
    // the clearing rule is shown to depend on the destination rather than on where the row began.
    it('clears the status when moving from other to a non-deliverable category', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'other',
        status: 'Terminé'
      })

      const updated = await updateTask(event, 'task-1', patch({ category: 'breaks' }))

      expect((await readStoredRow(client, 'task-1'))?.status).toBeNull()
      expect(updated.statusKey).toBe('na')
    })
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
          'notes',
          'project',
          'projectWordCount',
          'quotaWphOverride',
          'sortOrder',
          'splitGroupId',
          'status',
          'statusKey',
          'trackable',
          'deliverable'
        ].sort()
      )
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

// The notes column on a patch, from docs/specs/planning/task-inline-editor.md AC11 and AC12. The
// three instructions a patch can carry for it are different from each other and only a stored-row
// read tells them apart: a value stores that value, an explicit null clears the column, and an
// omitted key leaves whatever was there alone.
describe('updateTask and the notes column (AC11, AC12)', () => {
  it('stores a note the patch carried', async () => {
    await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

    const updated = await updateTask(event, 'task-1', patch({ notes: 'Relire le glossaire.' }))

    expect((await readStoredRow(client, 'task-1'))?.notes).toBe('Relire le glossaire.')
    expect(updated.notes).toBe('Relire le glossaire.')
  })

  it('clears the column on an explicit null', async () => {
    await seedTask(client, {
      id: 'task-1',
      date: '2026-07-20',
      category: 'translation',
      notes: 'Ancienne note.'
    })

    await updateTask(event, 'task-1', patch({ notes: null }))

    expect((await readStoredRow(client, 'task-1'))?.notes).toBeNull()
  })

  it('clears the column when the note is emptied to whitespace', async () => {
    await seedTask(client, {
      id: 'task-1',
      date: '2026-07-20',
      category: 'translation',
      notes: 'Ancienne note.'
    })

    await updateTask(event, 'task-1', patch({ notes: '  \n ' }))

    const stored = await readStoredRow(client, 'task-1')
    expect(stored?.notes).toBeNull()
    expect(stored?.notes).not.toBe('')
  })

  it('leaves an existing note alone when the patch omits notes', async () => {
    await seedTask(client, {
      id: 'task-1',
      date: '2026-07-20',
      category: 'translation',
      notes: 'Ancienne note.'
    })

    await updateTask(event, 'task-1', patch({ client: 'Acme' }))

    const stored = await readStoredRow(client, 'task-1')
    expect(stored?.notes).toBe('Ancienne note.')
    expect(stored?.client).toBe('Acme')
  })

  it('replaces an existing note with a new one', async () => {
    await seedTask(client, {
      id: 'task-1',
      date: '2026-07-20',
      category: 'translation',
      notes: 'Ancienne note.'
    })

    await updateTask(event, 'task-1', patch({ notes: 'Nouvelle note.' }))

    expect((await readStoredRow(client, 'task-1'))?.notes).toBe('Nouvelle note.')
  })

  it('keeps the newlines of a multiline note through a patch', async () => {
    await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

    await updateTask(event, 'task-1', patch({ notes: 'ligne un\nligne deux' }))

    expect((await readStoredRow(client, 'task-1'))?.notes).toBe('ligne un\nligne deux')
  })

  // -----------------------------------------------------------------------------------------------
  // The quota snapshot, from docs/specs/planning/per-category-quotas.md AC12.
  //
  // THIS IS THE COMMON PATH RATHER THAN THE CREATE, and the spec says so in as many words.
  // TaskCreateSchema defaults category to DEFAULT_CATEGORY_ID, which is `other`, and `other` is not
  // trackable, so a task made from the inline editor carries no figure when it is created. The first
  // patch that sets a real category is where most tasks get a figure at all. An implementation that
  // only snapshotted on create would leave most rows with none, which is why these cases exist.
  //
  // The four precedence rules AC12 fixes, each asserted below by name:
  //
  //   1. A figure in the body always wins.
  //   2. An explicit null in the body wins too, and is not immediately overwritten.
  //   3. Otherwise a category change re-snapshots and anything else does not.
  //   4. A move to a non-trackable category leaves the stored figure alone rather than clearing it.
  //
  // Rule 4 is deliberately unlike the status-clearing rule this handler applies a few lines earlier,
  // and the difference is stated rather than left to be discovered: a status a category cannot hold is
  // an invalid row, while a stored figure a category does not use is merely an unused one, and the
  // trackable gate in the resolver is what keeps it out of any numerator meanwhile.
  //
  // Every assertion reads the stored row rather than the response, because a handler that resolved a
  // figure and forgot to write it would look right from the outside.
  // -----------------------------------------------------------------------------------------------
  describe('the quota snapshot (AC12)', () => {
    // The normal flow through the app, end to end: a row starts on the create default and gets its
    // figure from the patch that makes it real work.
    it('snapshots a task moving off the non-trackable create default', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'other' })

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBeNull()

      await updateTask(event, 'task-1', patch({ category: 'translation' }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(240)
    })

    // Rule 5, which is rule 3 read from the non-trackable side. A task that sat in breaks holding a
    // stale figure gets a fresh one when it becomes real work.
    it('re-snapshots a task moving from a non-trackable category to a trackable one', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'breaks',
        quotaWphOverride: 900
      })

      await updateTask(event, 'task-1', patch({ category: 'proofreading' }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(2000)
    })

    // Rule 3, the case AC12 argues for out loud: "a task recategorised from translation to
    // proofreading is measured against the wrong target otherwise".
    it('replaces the figure when the category changes from one trackable category to another', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 240
      })

      await updateTask(event, 'task-1', patch({ category: 'proofreading' }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(2000)
    })

    it('re-snapshots from the user stored row rather than the shipped default', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'proofreading', 1500)
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      await updateTask(event, 'task-1', patch({ category: 'proofreading' }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(1500)
    })

    // Rule 3's other half. Sending the category the task already has is not a change, so nothing is
    // re-resolved and a figure the user typed is not quietly replaced by the category's.
    it('does not re-snapshot when the body names the category the task already has', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 400
      })

      await updateTask(event, 'task-1', patch({ category: 'translation' }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(400)
    })

    // Rule 3, stated as the exclusion it is. A date change is the case worth naming, because under the
    // effective-dated model it did move the figure and under the snapshot it must not.
    it('leaves the figure untouched when only the date changes', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 240
      })
      await seedCategoryQuota(client, OWNER_ID, 'translation', 999)

      await updateTask(event, 'task-1', patch({ date: '2026-09-01' }))

      const stored = await readStoredRow(client, 'task-1')

      expect(stored?.date).toBe('2026-09-01')
      expect(stored?.quota_wph_override).toBe(240)
    })

    it.each([
      ['a word count', { projectWordCount: 900 }],
      ['a status', { status: 'En cours' }],
      ['a note', { notes: 'Une note.' }],
      ['a duration', { actualMinutes: 90 }],
      ['a client', { client: 'Acme' }]
    ])('leaves the figure untouched when only %s changes', async (_label, body) => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 240
      })
      await seedCategoryQuota(client, OWNER_ID, 'translation', 999)

      await updateTask(event, 'task-1', patch(body))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(240)
    })

    // Rule 4. The stored figure survives the move, so moving a task to a meeting and back brings its
    // figure with it rather than losing it on the way.
    it.each(['terminology', 'meetings', 'breaks', 'admin', 'dtp', 'other'])(
      'leaves the figure alone when the task moves to the non-trackable %s',
      async (category) => {
        await seedTask(client, {
          id: 'task-1',
          date: '2026-07-20',
          category: 'translation',
          quotaWphOverride: 240
        })

        await updateTask(event, 'task-1', patch({ category }))

        expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(240)
      }
    )

    it('brings the figure back when the task returns to a trackable category', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 400
      })

      await updateTask(event, 'task-1', patch({ category: 'meetings' }))
      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(400)

      await updateTask(event, 'task-1', patch({ category: 'translation' }))
      // Coming back is a category change whose result is trackable, so it re-snapshots. The figure is
      // the category's rather than the one the row was carrying, which is rule 3 applying to the return
      // leg exactly as it applied to the outbound one.
      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(240)
    })

    // Rule 1. A request carrying a figure is the user stating what this task's figure is, so it wins
    // even when the same request also changes the category.
    it('stores the figure the body carries rather than re-snapshotting', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      await updateTask(event, 'task-1', patch({ category: 'proofreading', quotaWphOverride: 400 }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(400)
    })

    it('stores a figure the body carries with no category change at all', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 240
      })

      await updateTask(event, 'task-1', patch({ quotaWphOverride: 400 }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(400)
    })

    // Rule 2, and it is the rule most likely to be got wrong, because clearing and re-snapshotting in
    // the same request looks like two independent instructions. Clearing is the way back out of a
    // snapshot, so a re-snapshot on the same request would make it a silent no-op.
    it('stores NULL when the body clears the figure while also changing the category', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 240
      })

      await updateTask(event, 'task-1', patch({ category: 'proofreading', quotaWphOverride: null }))

      const stored = await readStoredRow(client, 'task-1')

      expect(stored?.category).toBe('proofreading')
      expect(stored?.quota_wph_override).toBeNull()
    })

    it('stores NULL when the body clears the figure on its own', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 240
      })

      await updateTask(event, 'task-1', patch({ quotaWphOverride: null }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBeNull()
    })

    // The resolution is scoped to the session user like every other read on this path.
    it('ignores another user stored row when re-snapshotting', async () => {
      await seedCategoryQuota(client, OTHER_USER_ID, 'proofreading', 999)
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      await updateTask(event, 'task-1', patch({ category: 'proofreading' }))

      expect((await readStoredRow(client, 'task-1'))?.quota_wph_override).toBe(2000)
    })

    // The snapshot must not have cost the patch its other rules. A category change to a non-deliverable
    // category still clears the status, and the row still moves day and takes a fresh sort order, all in
    // the same write as the figure being left alone.
    it('keeps the status-clearing and sort-order rules while leaving the figure alone', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        quotaWphOverride: 240,
        status: 'En cours'
      })

      await updateTask(event, 'task-1', patch({ category: 'breaks', date: '2026-09-01' }))

      expect(await readStoredRow(client, 'task-1')).toMatchObject({
        category: 'breaks',
        date: '2026-09-01',
        quota_wph_override: 240,
        sort_order: 0,
        status: null
      })
    })
  })
})
