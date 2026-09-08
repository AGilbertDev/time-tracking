import type { Client } from '@libsql/client'

import { TaskCreateSchema, TaskUpdateSchema } from '~~/server/models/tasks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countTasks,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readDaySettingsRow,
  readDaySettingsRows,
  readStoredRow,
  seedDaySettings,
  seedSettings,
  seedTask
} from '../../../../helpers/taskTestDb'

// The day settings stamp on the two task write paths, from docs/specs/planning/day-settings-snapshot.md.
//
//   AC2. "Creating a task on a date with no row writes one carrying the user's current settings. A
//   date that already has a row is left alone, so the first write creates the stamp and later tasks on
//   that day do not recreate it."
//
//   AC3. "Moving a task to a date with no row stamps that date. The date it left keeps its row,
//   because a day that once held work is a day whose settings were real."
//
//   AC5. "buffer_minutes is stamped even though settings carries no such column today. The value is
//   DEFAULT_SCHEDULE's 60 until a real setting exists."
//
//   AC7. "A failed stamp never blocks a task write. The task still lands and the failure is logged,
//   because refusing to record real work over a bookkeeping row would police the user, which spec.md
//   §2 forbids."
//
//   AC10. "Every stamp path is scoped to the session user, so no write can reach another user's day."
//
// The seam is useDb, and the stamp is asserted against the stored day_settings row with raw SQL
// rather than against anything either handler returns. Neither response mentions the stamp, so a
// handler that wrote nothing would look identical from the outside, which is exactly why the
// assertions read the table.
//
// AC7 is exercised by a real failure rather than by a stubbed one. The table is dropped before the
// write, so the insert fails against the database the way a constraint or an outage would, and every
// other statement in the handler still runs for real. Injecting the failure any higher, by stubbing
// the stamp itself, would be testing the test.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { createTask } = await import('~~/server/api/tasks/handlers/create')
const { updateTask } = await import('~~/server/api/tasks/handlers/update')

const event = { __event: true } as never

const DATE = '2026-09-09'
const OTHER_DATE = '2026-09-10'

let harness: TaskTestDb
let client: Client

function body(input: Record<string, unknown>) {
  const parsed = TaskCreateSchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture body is not a valid request: ${parsed.error}`)
  return parsed.data
}

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
    (opts: { data?: unknown; statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the day settings stamp on POST /api/tasks', () => {
  describe('AC2: creating a task on a date with no row writes one', () => {
    it('stamps the date the task is on', async () => {
      await createTask(event, body({ category: 'translation', date: DATE }))

      expect(await readDaySettingsRow(client, OWNER_ID, DATE)).toMatchObject({
        date: DATE,
        user_id: OWNER_ID
      })
    })

    // "carrying the user's current settings". Every value comes from the user's own settings row and
    // never from the request body, so figures that are visibly not the column defaults are what prove
    // the row was read.
    it('carries the user current settings rather than the coded defaults', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', {
        dailyWorkMinutes: 400,
        workDays: [1, 2, 3]
      })

      await createTask(event, body({ category: 'translation', date: DATE }))

      expect(await readDaySettingsRow(client, OWNER_ID, DATE)).toMatchObject({
        work_days: '[1,2,3]',
        work_minutes: 400
      })
    })

    // A user who has never saved a setting still gets a stamp, and it carries what the read path
    // resolves for them, which is 450 minutes on Monday through Friday.
    it('stamps the coded defaults for a user with no settings row', async () => {
      await createTask(event, body({ category: 'translation', date: DATE }))

      expect(await readDaySettingsRow(client, OWNER_ID, DATE)).toMatchObject({
        work_days: '[1,2,3,4,5]',
        work_minutes: 450
      })
    })

    // AC5. The settings row carries no buffer column, so the stamp takes DEFAULT_SCHEDULE's 60 and
    // adding the real setting later needs no migration.
    it('stamps a buffer of 60 minutes', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', { dailyWorkMinutes: 400 })

      await createTask(event, body({ category: 'translation', date: DATE }))

      expect((await readDaySettingsRow(client, OWNER_ID, DATE))?.buffer_minutes).toBe(60)
    })

    it('writes exactly one row', async () => {
      await createTask(event, body({ category: 'translation', date: DATE }))

      expect(await readDaySettingsRows(client, OWNER_ID)).toHaveLength(1)
    })

    // The stamp belongs to the task's own date rather than to the day the request was made, which is
    // what makes a task created for a future day carry that day's settings.
    it('stamps the task date and not today', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-09-07T12:00:00Z'))

      await createTask(event, body({ category: 'translation', date: '2026-12-25' }))

      const rows = await readDaySettingsRows(client, OWNER_ID)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.date).toBe('2026-12-25')
    })
  })

  describe('AC2: a date that already has a row is left alone', () => {
    it('leaves a stamped row untouched rather than restamping it', async () => {
      await seedDaySettings(client, OWNER_ID, DATE, { workDays: '[2,4]', workMinutes: 300 })
      await seedSettings(client, OWNER_ID, 'America/Toronto', {
        dailyWorkMinutes: 400,
        workDays: [1, 2, 3]
      })

      await createTask(event, body({ category: 'translation', date: DATE }))

      expect(await readDaySettingsRow(client, OWNER_ID, DATE)).toMatchObject({
        work_days: '[2,4]',
        work_minutes: 300
      })
    })

    // "Two tasks created on the same fresh day in quick succession. The unique index makes the second
    // insert a no-op rather than a duplicate."
    it('writes one row for two tasks created on the same fresh day', async () => {
      await createTask(event, body({ category: 'translation', date: DATE }))
      await createTask(event, body({ category: 'revision_internal', date: DATE }))

      expect(await readDaySettingsRows(client, OWNER_ID)).toHaveLength(1)
    })

    it('does not fail the second task on the same fresh day', async () => {
      await createTask(event, body({ category: 'translation', date: DATE }))
      await createTask(event, body({ category: 'revision_internal', date: DATE }))

      expect(await countTasks(client)).toBe(2)
    })

    it('writes one row per date when two tasks land on different days', async () => {
      await createTask(event, body({ category: 'translation', date: DATE }))
      await createTask(event, body({ category: 'translation', date: OTHER_DATE }))

      expect((await readDaySettingsRows(client, OWNER_ID)).map((row) => row.date)).toEqual([
        DATE,
        OTHER_DATE
      ])
    })
  })

  describe('AC10: the stamp is scoped to the session user', () => {
    // Both halves in one case on purpose. An absence on the other user's side is worth nothing
    // unless the row really was written on this user's side, since a handler that stamped nothing at
    // all would satisfy the absence alone.
    it('writes the row under the session user id and under no other', async () => {
      await createTask(event, body({ category: 'translation', date: DATE }))

      expect(await readDaySettingsRows(client, OWNER_ID)).toHaveLength(1)
      expect(await readDaySettingsRows(client, OTHER_USER_ID)).toEqual([])
    })

    // The unique index is per user and per date, so another user's stamp on the same day is neither
    // read nor overwritten.
    it('leaves another user row for the same date untouched', async () => {
      await seedDaySettings(client, OTHER_USER_ID, DATE, { workMinutes: 111 })

      await createTask(event, body({ category: 'translation', date: DATE }))

      expect((await readDaySettingsRow(client, OTHER_USER_ID, DATE))?.work_minutes).toBe(111)
      expect((await readDaySettingsRow(client, OWNER_ID, DATE))?.work_minutes).toBe(450)
    })

    it('reads the session user settings rather than another user settings', async () => {
      await seedSettings(client, OTHER_USER_ID, 'America/Toronto', { dailyWorkMinutes: 111 })

      await createTask(event, body({ category: 'translation', date: DATE }))

      expect((await readDaySettingsRow(client, OWNER_ID, DATE))?.work_minutes).toBe(450)
    })
  })

  describe('AC7: a failed stamp never blocks the task write', () => {
    it('still creates the task when the stamp cannot be written', async () => {
      await client.execute('DROP TABLE day_settings')

      const created = await createTask(event, body({ category: 'translation', date: DATE }))

      expect(created).toMatchObject({ category: 'translation', date: DATE })
      expect(await countTasks(client)).toBe(1)
    })

    it('does not let the failure propagate to the caller', async () => {
      await client.execute('DROP TABLE day_settings')

      await expect(
        createTask(event, body({ category: 'translation', date: DATE }))
      ).resolves.toBeTruthy()
    })

    it('leaves the stored task row complete', async () => {
      await client.execute('DROP TABLE day_settings')

      const created = await createTask(
        event,
        body({ category: 'translation', date: DATE, projectWordCount: 600 })
      )

      expect(await readStoredRow(client, created.id)).toMatchObject({
        date: DATE,
        project_word_count: 600,
        user_id: OWNER_ID
      })
    })

    it('logs the failure rather than swallowing it silently', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await client.execute('DROP TABLE day_settings')

      await createTask(event, body({ category: 'translation', date: DATE }))

      expect(error.mock.calls.length + warn.mock.calls.length).toBeGreaterThan(0)
    })
  })
})

describe('the day settings stamp on PATCH /api/tasks/[id]', () => {
  describe('AC3: moving a task to a date with no row stamps that date', () => {
    it('stamps the date the task moved to', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })
      await seedDaySettings(client, OWNER_ID, DATE, { workMinutes: 300 })

      await updateTask(event, 'task-1', patch({ date: OTHER_DATE }))

      expect(await readDaySettingsRow(client, OWNER_ID, OTHER_DATE)).toMatchObject({
        date: OTHER_DATE,
        work_minutes: 450
      })
    })

    // "The date it left keeps its row, because a day that once held work is a day whose settings were
    // real." So the move adds a row rather than moving one.
    it('leaves the row on the date the task left', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })
      await seedDaySettings(client, OWNER_ID, DATE, { workMinutes: 300 })

      await updateTask(event, 'task-1', patch({ date: OTHER_DATE }))

      expect((await readDaySettingsRow(client, OWNER_ID, DATE))?.work_minutes).toBe(300)
      expect(await readDaySettingsRows(client, OWNER_ID)).toHaveLength(2)
    })

    it('carries the user current settings onto the new date', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', {
        dailyWorkMinutes: 400,
        workDays: [1, 2, 3]
      })
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })

      await updateTask(event, 'task-1', patch({ date: OTHER_DATE }))

      expect(await readDaySettingsRow(client, OWNER_ID, OTHER_DATE)).toMatchObject({
        buffer_minutes: 60,
        work_days: '[1,2,3]',
        work_minutes: 400
      })
    })

    it('leaves a row already on the destination date alone', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })
      await seedDaySettings(client, OWNER_ID, OTHER_DATE, { workMinutes: 222 })

      await updateTask(event, 'task-1', patch({ date: OTHER_DATE }))

      expect((await readDaySettingsRow(client, OWNER_ID, OTHER_DATE))?.work_minutes).toBe(222)
    })

    // A patch that changes something other than the date has no new day to stamp, so the table is
    // untouched and the already-stamped day keeps what it holds.
    it('adds no row for a patch that does not move the task', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })
      await seedDaySettings(client, OWNER_ID, DATE, { workMinutes: 300 })

      await updateTask(event, 'task-1', patch({ projectWordCount: 600 }))

      const rows = await readDaySettingsRows(client, OWNER_ID)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.work_minutes).toBe(300)
    })

    // A task deleted or moved away leaves the row behind, so a task coming back to that day resolves
    // the settings the day was measured against rather than today's.
    it('leaves the vacated row in place for a task that comes back', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })
      await seedDaySettings(client, OWNER_ID, DATE, { workMinutes: 300 })

      await updateTask(event, 'task-1', patch({ date: OTHER_DATE }))
      await updateTask(event, 'task-1', patch({ date: DATE }))

      expect((await readDaySettingsRow(client, OWNER_ID, DATE))?.work_minutes).toBe(300)
      expect(await readDaySettingsRows(client, OWNER_ID)).toHaveLength(2)
    })
  })

  describe('AC10: the patch stamp is scoped to the session user', () => {
    it('stamps nothing when the patch matches no row the session user owns', async () => {
      await seedTask(client, {
        category: 'translation',
        date: DATE,
        id: 'other-task',
        userId: OTHER_USER_ID
      })

      await expect(updateTask(event, 'other-task', patch({ date: OTHER_DATE }))).rejects.toThrow()

      expect(await readDaySettingsRows(client, OWNER_ID)).toEqual([])
      expect(await readDaySettingsRows(client, OTHER_USER_ID)).toEqual([])
    })

    it('writes the new row under the session user id and under no other', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })

      await updateTask(event, 'task-1', patch({ date: OTHER_DATE }))

      expect(await readDaySettingsRow(client, OWNER_ID, OTHER_DATE)).toBeDefined()
      expect(await readDaySettingsRows(client, OTHER_USER_ID)).toEqual([])
    })
  })

  describe('AC7: a failed stamp never blocks the patch', () => {
    it('still applies the patch when the stamp cannot be written', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })
      await client.execute('DROP TABLE day_settings')

      const updated = await updateTask(event, 'task-1', patch({ date: OTHER_DATE }))

      expect(updated).toMatchObject({ date: OTHER_DATE })
      expect((await readStoredRow(client, 'task-1'))?.date).toBe(OTHER_DATE)
    })

    it('does not let the failure propagate to the caller', async () => {
      await seedTask(client, { category: 'translation', date: DATE, id: 'task-1' })
      await client.execute('DROP TABLE day_settings')

      await expect(updateTask(event, 'task-1', patch({ date: OTHER_DATE }))).resolves.toBeTruthy()
    })
  })
})
