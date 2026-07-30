import type { Client } from '@libsql/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countTasks,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readStoredRow,
  seedTask
} from '../../../../helpers/taskTestDb'

// removeTask, the handler behind DELETE /api/tasks/[id].
//
// Derived from docs/specs/planning/task-write-api.md acceptance criteria AC4, AC35, AC36 and AC38,
// plus the "Delete is a hard delete" and "Idempotency and the not-found case" sections.
//
// Same seam as the create and update suites: a real in-memory SQLite database behind a mocked
// useDb, so "the row is gone" is a real absence rather than a recorded call.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { removeTask } = await import('~~/server/api/tasks/handlers/remove')

const event = { __event: true } as never

let harness: TaskTestDb
let client: Client

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

// createTaskTestDb opens a libSQL client per test, so the harness is released here rather than left
// for the process to reap. Nothing closed them before and the handles accumulated across the run.
afterEach(() => {
  harness?.close()
})

describe('removeTask', () => {
  describe('the row is removed (AC35)', () => {
    it('deletes the row and returns its id', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      const result = await removeTask(event, 'task-1')

      expect(result).toEqual({ id: 'task-1' })
      expect(await readStoredRow(client, 'task-1')).toBeUndefined()
    })

    it('is a hard delete, so nothing is left behind to filter out later', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      await removeTask(event, 'task-1')

      expect(await countTasks(client)).toBe(0)
    })

    it('touches only the requested row', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })
      await seedTask(client, { id: 'task-2', date: '2026-07-20', category: 'admin' })

      await removeTask(event, 'task-1')

      expect(await readStoredRow(client, 'task-2')).toBeDefined()
      expect(await countTasks(client)).toBe(1)
    })
  })

  describe('idempotency and the not-found case (AC38)', () => {
    it('returns 404 for an id that matches no row', async () => {
      await expect(removeTask(event, 'nope')).rejects.toMatchObject({
        statusCode: 404,
        statusMessage: 'task_not_found'
      })
    })

    // Idempotent in effect: the row is gone either way and a repeated call changes nothing. A 404 on
    // delete means the row is already absent, which is the outcome the user asked for, so the client
    // treats it as success plus a refresh rather than as an error.
    it('returns 404 on a second delete of the same id and changes nothing', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })
      await seedTask(client, { id: 'task-2', date: '2026-07-20', category: 'admin' })

      await removeTask(event, 'task-1')

      await expect(removeTask(event, 'task-1')).rejects.toMatchObject({ statusCode: 404 })
      expect(await countTasks(client)).toBe(1)
    })
  })

  describe('ownership (AC4)', () => {
    // The missing case and the not-yours case are indistinguishable from outside: same status, same
    // body. A 403 would confirm that the id exists and let a caller enumerate real ids.
    it('returns the same 404 for a row belonging to another user', async () => {
      await seedTask(client, {
        id: 'theirs',
        userId: OTHER_USER_ID,
        date: '2026-07-20',
        category: 'translation'
      })

      await expect(removeTask(event, 'theirs')).rejects.toMatchObject({
        statusCode: 404,
        statusMessage: 'task_not_found'
      })
    })

    it('leaves the other user row in place', async () => {
      await seedTask(client, {
        id: 'theirs',
        userId: OTHER_USER_ID,
        date: '2026-07-20',
        category: 'translation'
      })

      await expect(removeTask(event, 'theirs')).rejects.toThrow()

      expect(await readStoredRow(client, 'theirs')).toBeDefined()
    })
  })

  describe('split siblings are untouched (AC36)', () => {
    // A group of one, an interrupted split, is a valid state the schema already defines, so there is
    // no orphan to clean up and nothing to recover from. Any richer behaviour belongs to PLAN-18.
    it('deletes one slice and leaves the siblings with their split_group_id unchanged', async () => {
      for (const [id, date] of [
        ['slice-1', '2026-07-20'],
        ['slice-2', '2026-07-21'],
        ['slice-3', '2026-07-22']
      ]) {
        await seedTask(client, {
          id: id as string,
          date: date as string,
          category: 'translation',
          splitGroupId: 'group-1'
        })
      }

      await removeTask(event, 'slice-2')

      expect((await readStoredRow(client, 'slice-1'))?.split_group_id).toBe('group-1')
      expect((await readStoredRow(client, 'slice-3'))?.split_group_id).toBe('group-1')
      expect(await countTasks(client)).toBe(2)
    })

    it('leaves a lone remaining slice carrying its group id', async () => {
      await seedTask(client, {
        id: 'slice-1',
        date: '2026-07-20',
        category: 'translation',
        splitGroupId: 'group-1'
      })
      await seedTask(client, {
        id: 'slice-2',
        date: '2026-07-21',
        category: 'translation',
        splitGroupId: 'group-1'
      })

      await removeTask(event, 'slice-2')

      expect((await readStoredRow(client, 'slice-1'))?.split_group_id).toBe('group-1')
    })
  })
})
