import type { Client } from '@libsql/client'

import { TaskCreateSchema } from '~~/server/models/tasks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countTasks,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readStoredRow,
  seedSettings,
  seedTask
} from '../../../../helpers/taskTestDb'

// createTask, the handler behind POST /api/tasks.
//
// Derived from docs/specs/planning/task-write-api.md acceptance criteria AC5, AC10, AC11, AC16,
// AC18, AC23, AC26, AC30, AC31, AC40 and AC43, plus the "Do not store the fallback",
// "estimated_minutes is stored, not derived" and "The words_done question" sections.
//
// Two criteria insist on being verified against the stored database row rather than against the
// response, because the response resolves the estimate fallback for display and would look right
// either way. So the seam here is `useDb`, which returns a genuine Drizzle instance over an
// in-memory SQLite database with the shipped tasks DDL. Column defaults, NOT NULL constraints and
// the max(sort_order) aggregate all run for real, and the assertions read raw SQL.
//
// Bodies are built through TaskCreateSchema, because the handler's input is by contract the
// schema's output and a hand-shaped object would test a request the route can never deliver.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { createTask } = await import('~~/server/api/tasks/handlers/create')

const event = { __event: true } as never

let harness: TaskTestDb
let client: Client

// A valid create body as the route would hand it over.
function body(input: Record<string, unknown>) {
  const parsed = TaskCreateSchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture body is not a valid request: ${parsed.error}`)
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

describe('createTask', () => {
  describe('the smallest legal request (AC10)', () => {
    it('creates a task from only a date and a category', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect(created).toMatchObject({ date: '2026-07-20', category: 'breaks' })
      expect(await countTasks(client)).toBe(1)
    })

    it('assigns sortOrder, defaults excludeFromStats to false, and leaves every other column NULL', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))
      const stored = await readStoredRow(client, created.id)

      expect(stored).toMatchObject({
        user_id: OWNER_ID,
        date: '2026-07-20',
        category: 'breaks',
        sort_order: 0,
        exclude_from_stats: 0
      })

      for (const column of [
        'client',
        'project',
        'delivery_date',
        'delivery_time',
        'project_word_count',
        'words_done',
        'quota_wph_override',
        'estimated_minutes',
        'actual_minutes',
        'status',
        'split_group_id'
      ]) {
        expect(stored?.[column]).toBeNull()
      }
    })

    it('stamps created_at and updated_at', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))
      const stored = await readStoredRow(client, created.id)

      expect(Number(stored?.created_at)).toBeGreaterThan(0)
      expect(Number(stored?.updated_at)).toBeGreaterThan(0)
    })
  })

  describe('the two columns a create must never fill', () => {
    // -------------------------------------------------------------------------------------------
    // AC16. DO NOT MAKE THIS PASS BY AUTO-FILLING actual_minutes FROM estimated_minutes.
    //
    // This is the 2026-07-29 locked decision and the spec names it as the one most likely to be
    // undone by a later implementer acting helpfully, because auto-filling looks like a convenience
    // and the app this replaces did exactly that. Storing the copy makes a duration the user
    // confirmed at 2 h 00 and a duration the app assumed at 2 h 00 into identical rows, and nothing
    // downstream can tell them apart afterwards. effectiveDuration resolves the fallback at read
    // time, so leaving the column NULL behaves identically on screen and keeps the distinction.
    //
    // The assertion reads the stored column on purpose. AC16 says so explicitly: the response
    // resolves the fallback for display and would show the estimate either way, so asserting on the
    // response would pass whether or not the auto-fill was there.
    // -------------------------------------------------------------------------------------------
    it('stores actual_minutes as NULL when the body carries an estimate and no actual (AC16)', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', estimatedMinutes: 120 })
      )

      const stored = await readStoredRow(client, created.id)
      expect(stored?.estimated_minutes).toBe(120)
      expect(stored?.actual_minutes).toBeNull()
    })

    it('stores an actual_minutes the user actually sent', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          estimatedMinutes: 120,
          actualMinutes: 95
        })
      )

      expect((await readStoredRow(client, created.id))?.actual_minutes).toBe(95)
    })

    it('stores an explicit actualMinutes of 0 as a measurement rather than as unmeasured', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', actualMinutes: 0 })
      )

      expect((await readStoredRow(client, created.id))?.actual_minutes).toBe(0)
    })

    // -------------------------------------------------------------------------------------------
    // AC30 and AC31. DO NOT MAKE THIS PASS BY MIRRORING project_word_count INTO words_done.
    //
    // Route B in the spec's "The words_done question, and how it was settled". A later implementer
    // reading the line in overview.md that says "the app should set it rather than ask twice" is
    // meant to hit this test before they ship the mirror. It was rejected for two reasons. It is the
    // same defect as auto-filling actual_minutes, storing a value the app assumed in a column meant
    // for a value the user supplied. And it is actively wrong on screen: TaskRow.vue prints
    // "words done / project total", so a brand-new 12 000-word task would render 12 000 / 12 000 and
    // read as finished before it had been started, which is the misreading that column was built to
    // avoid. The column is scheduled for removal in PLAN-33 and nothing reads it for a statistic.
    // -------------------------------------------------------------------------------------------
    it('stores project_word_count and leaves words_done NULL (AC30, AC31)', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', projectWordCount: 12_000 })
      )

      const stored = await readStoredRow(client, created.id)
      expect(stored?.project_word_count).toBe(12_000)
      expect(stored?.words_done).toBeNull()
    })

    it('leaves words_done NULL on every row it creates', async () => {
      await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))
      await createTask(
        event,
        body({ date: '2026-07-21', category: 'translation', projectWordCount: 500 })
      )

      const rows = await client.execute('SELECT words_done FROM tasks')
      expect(rows.rows).toHaveLength(2)
      for (const row of rows.rows) expect(row.words_done).toBeNull()
    })
  })

  describe('estimated_minutes is stored, never derived (AC18)', () => {
    // The derivation needs a per-category quota that does not exist yet, and because the estimate is
    // frozen by definition a value derived from today's wrong global quota would never self-correct.
    it('stores NULL when no estimate is sent, even with a word count and a quota override present', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', 450)

      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          projectWordCount: 12_000,
          quotaWphOverride: 500
        })
      )

      const stored = await readStoredRow(client, created.id)
      expect(stored?.estimated_minutes).toBeNull()
      expect(stored?.project_word_count).toBe(12_000)
      expect(stored?.quota_wph_override).toBe(500)
    })

    it('stores an estimate the user sent verbatim', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          projectWordCount: 12_000,
          estimatedMinutes: 1_600
        })
      )

      expect((await readStoredRow(client, created.id))?.estimated_minutes).toBe(1_600)
    })
  })

  describe('empty string becomes NULL in the column (AC11)', () => {
    it.each([
      ['client', 'client'],
      ['project', 'project']
    ])('stores %s sent as an empty string as NULL', async (field, column) => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', [field]: '' })
      )

      expect((await readStoredRow(client, created.id))?.[column]).toBeNull()
    })

    it('stores a trimmed value when one was actually given', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', client: '  Acme  ' })
      )

      expect((await readStoredRow(client, created.id))?.client).toBe('Acme')
    })
  })

  describe('the owning user comes from the session (AC5)', () => {
    it('writes the session user id', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect((await readStoredRow(client, created.id))?.user_id).toBe(OWNER_ID)
    })

    // The schema already refuses a userId, so this covers the handler on its own: even a body that
    // somehow carried one could not reach the column, because the insert reads the session.
    it('ignores a userId smuggled past the schema', async () => {
      const smuggled = {
        ...body({ date: '2026-07-20', category: 'breaks' }),
        userId: OTHER_USER_ID
      } as never

      const created = await createTask(event, smuggled)

      expect((await readStoredRow(client, created.id))?.user_id).toBe(OWNER_ID)
    })
  })

  describe('status against category (AC23)', () => {
    it('refuses a non-null status on a non-trackable category and creates no row', async () => {
      await expect(
        createTask(event, body({ date: '2026-07-20', category: 'breaks', status: 'En cours' }))
      ).rejects.toMatchObject({ statusCode: 422 })

      expect(await countTasks(client)).toBe(0)
    })

    it('accepts a status on a trackable category', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', status: 'Accepté' })
      )

      expect((await readStoredRow(client, created.id))?.status).toBe('Accepté')
      expect(created.statusKey).toBe('accepte')
    })

    // A trackable category with no status is a legitimate row; statusKey maps NULL to na.
    it('accepts a trackable task with no status', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'translation' }))

      expect((await readStoredRow(client, created.id))?.status).toBeNull()
      expect(created.statusKey).toBe('na')
    })

    it('accepts a non-trackable category with an explicit null status', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'breaks', status: null })
      )

      expect(created.statusKey).toBe('na')
      expect(created.trackable).toBe(false)
    })
  })

  describe('sort_order is assigned by the server (AC26)', () => {
    it('gives the first task of a day sort_order 0', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect((await readStoredRow(client, created.id))?.sort_order).toBe(0)
      expect(created.sortOrder).toBe(0)
    })

    it('gives a task on a day whose highest is 3 sort_order 4', async () => {
      await seedTask(client, { id: 'a', date: '2026-07-20', category: 'admin', sortOrder: 3 })

      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect((await readStoredRow(client, created.id))?.sort_order).toBe(4)
    })

    it('lands each successive task of the same day at the end', async () => {
      const first = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))
      const second = await createTask(event, body({ date: '2026-07-20', category: 'admin' }))
      const third = await createTask(event, body({ date: '2026-07-20', category: 'meetings' }))

      expect([first.sortOrder, second.sortOrder, third.sortOrder]).toEqual([0, 1, 2])
    })

    it('scopes the scan to the day, so another day does not move it', async () => {
      await seedTask(client, { id: 'a', date: '2026-07-19', category: 'admin', sortOrder: 7 })

      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect(created.sortOrder).toBe(0)
    })

    it('scopes the scan to the session user, so another user tasks that day do not move it', async () => {
      await seedTask(client, {
        id: 'theirs',
        userId: OTHER_USER_ID,
        date: '2026-07-20',
        category: 'admin',
        sortOrder: 7
      })

      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect(created.sortOrder).toBe(0)
    })
  })

  describe('the response is a TaskListItem (AC40, AC43)', () => {
    it('returns exactly the contract fields, statusKey and trackable included', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          client: 'Acme',
          project: 'Manual',
          deliveryDate: '2026-07-25',
          deliveryTime: '17:00',
          projectWordCount: 12_000,
          quotaWphOverride: 500,
          estimatedMinutes: 1_600,
          status: 'Accepté',
          excludeFromStats: true
        })
      )

      expect(Object.keys(created).sort()).toEqual(
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
          'trackable',
          'wordsDone'
        ].sort()
      )

      expect(created).toMatchObject({
        client: 'Acme',
        project: 'Manual',
        deliveryDate: '2026-07-25',
        deliveryTime: '17:00',
        projectWordCount: 12_000,
        wordsDone: null,
        quotaWphOverride: 500,
        estimatedMinutes: 1_600,
        actualMinutes: null,
        status: 'Accepté',
        excludeFromStats: true,
        splitGroupId: null,
        trackable: true
      })
    })

    // AC43: the client is handed the verdict rather than the inputs, resolved server-side against
    // the user's own clock.
    it('returns statusKey retard for a task whose delivery is already past', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          status: 'Accepté',
          deliveryDate: '2020-01-01',
          deliveryTime: '09:00'
        })
      )

      expect(created.statusKey).toBe('retard')
    })

    it('does not return retard for a delivery still in the future', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          status: 'Accepté',
          deliveryDate: '2999-12-31'
        })
      )

      expect(created.statusKey).toBe('accepte')
    })

    it('resolves trackable false for a non-trackable category', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'meetings' }))

      expect(created).toMatchObject({ trackable: false, statusKey: 'na' })
    })
  })

  describe('edge cases the spec allows rather than polices', () => {
    it('stores a project word count on a non-trackable task', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'meetings', projectWordCount: 500 })
      )

      expect((await readStoredRow(client, created.id))?.project_word_count).toBe(500)
    })

    it('stores a quota override on a non-trackable task', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'breaks', quotaWphOverride: 500 })
      )

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(500)
    })

    it('stores a delivery time with no delivery date', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', deliveryTime: '09:00' })
      )

      const stored = await readStoredRow(client, created.id)
      expect(stored?.delivery_time).toBe('09:00')
      expect(stored?.delivery_date).toBeNull()
    })

    it('stores a delivery date before the task date', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', deliveryDate: '2026-07-01' })
      )

      expect((await readStoredRow(client, created.id))?.delivery_date).toBe('2026-07-01')
    })
  })
})
