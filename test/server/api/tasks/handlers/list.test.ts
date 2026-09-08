import type { Client } from '@libsql/client'

import { TaskListQuerySchema } from '~~/server/models/tasks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TASK_STATUSES } from '#shared/planning'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedSettings,
  seedTask
} from '../../../../helpers/taskTestDb'

// listTasks, the handler behind GET /api/tasks. It is the read behind the planning week.
//
// Derived from docs/specs/planning/week-with-task-rows.md (PLAN-04, Bout 1):
//
//   "On success, 200 with a JSON array of the caller's task rows whose date falls in [from, to]
//   inclusive, ordered by date ascending, then sortOrder ascending, then id for a stable tie-break.
//   The query is the single indexed range scan the (user_id, date) index was built for,
//   WHERE user_id = <session user> AND date >= from AND date <= to."
//
//   AC1. "A request with a valid from and to returns only the session user's tasks whose date is in
//   range, ordered by date then sortOrder, and never returns another user's rows even if a user id is
//   smuggled in the query."
//
//   AC2. "No session returns 401."
//
//   "Handler server/api/tasks/handlers/list.ts reads the session user through requireUserSession, so
//   the scope is always the session user and never an id from the request."
//
//   "A week with no tasks. GET /api/tasks returns an empty array [...] which is a normal state and
//   not an error."
//
//   "An equal from and to is valid and returns a single day."
//
// And from docs/specs/planning/read-only-week-capacity-and-nav.md (Bout 2), which reuses this same
// endpoint for the week switcher:
//
//   AC14. "Précédente and Suivante shift the visible range by exactly one week and refetch tasks for
//   the new range via GET /api/tasks, correct across month and year boundaries."
//
// The ordering asserted below is the spec's, not the code's. The fixtures are seeded in an order
// that contradicts the required one at every level, so a query that returned insertion order, or
// that dropped any one of the three sort terms, comes back visibly wrong rather than accidentally
// right.
//
// The 422 cases (missing, malformed, inverted, or over-wide range) belong to TaskListQuerySchema and
// are covered where that schema is tested. Every fixture query here is parsed through the shipped
// schema first, so no case asserts behaviour for a range the route would have refused with a 422
// before this handler ran.
//
// The seam is useDb: a real in-memory database with the shipped DDL, so the range predicate, the
// ORDER BY and the overdue CASE expression all run for real. resolveUserNow reads the user's stored
// timezone through the same mocked useDb, so the late verdict is decided in the user's own zone the
// way it is in production.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { listTasks } = await import('~~/server/api/tasks/handlers/list')

const event = { __event: true } as never

// AC1's "even if a user id is smuggled in the query". The validated query carries only from and to,
// so the other account's id is planted everywhere else a handler could reach for one.
const SMUGGLED_EVENT = {
  context: { params: { id: OTHER_USER_ID, userId: OTHER_USER_ID } },
  node: {
    req: { url: `/api/tasks?from=${'2026-07-19'}&to=${'2026-07-25'}&userId=${OTHER_USER_ID}` }
  },
  path: `/api/tasks?userId=${OTHER_USER_ID}`
} as never

function query(input: Record<string, unknown>) {
  const parsed = TaskListQuerySchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture query is not a valid request: ${parsed.error}`)
  return parsed.data
}

// The Sunday-to-Saturday week of 2026-07-20, the week the shared week helpers resolve for that date
// and the one the planning specs use as their worked example.
const WEEK = { from: '2026-07-19', to: '2026-07-25' }
const DAY_BEFORE = '2026-07-18'
const DAY_AFTER = '2026-07-26'

// Midday UTC inside the fixture week, which is the same calendar day in Toronto, so nothing below
// depends on when the suite happens to run.
const NOW = new Date('2026-07-22T16:00:00Z')

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

// The ids of the returned rows, which is what every range and ordering criterion is read through.
async function listedIds(input: Record<string, unknown>, on = event) {
  const rows = await listTasks(on, query(input))
  return rows.map((row) => row.id)
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })

  // The zone the late comparison is made in. Both accounts get one so neither answer depends on the
  // loader's fallback.
  await seedSettings(client, OWNER_ID, 'America/Toronto')
  await seedSettings(client, OTHER_USER_ID, 'America/Toronto')

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listTasks', () => {
  describe('the range filter is inclusive at both ends', () => {
    it('returns a task dated exactly on the first day of the range', async () => {
      await seedTask(client, { id: 'task-from', date: WEEK.from, category: 'translation' })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-from'])
    })

    it('returns a task dated exactly on the last day of the range', async () => {
      await seedTask(client, { id: 'task-to', date: WEEK.to, category: 'translation' })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-to'])
    })

    it('returns a task dated inside the range', async () => {
      await seedTask(client, { id: 'task-mid', date: '2026-07-22', category: 'translation' })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-mid'])
    })

    // Each exclusion carries the in-range row in the same case, because an empty answer would
    // satisfy the exclusion on its own.
    it('excludes the day before the range while keeping the first day of it', async () => {
      await seedTask(client, { id: 'task-before', date: DAY_BEFORE, category: 'translation' })
      await seedTask(client, { id: 'task-from', date: WEEK.from, category: 'translation' })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-from'])
    })

    it('excludes the day after the range while keeping the last day of it', async () => {
      await seedTask(client, { id: 'task-to', date: WEEK.to, category: 'translation' })
      await seedTask(client, { id: 'task-after', date: DAY_AFTER, category: 'translation' })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-to'])
    })

    // "An equal from and to is valid and returns a single day."
    it('returns only that day when from and to are the same date', async () => {
      await seedTask(client, { id: 'task-19', date: '2026-07-19', category: 'translation' })
      await seedTask(client, { id: 'task-20', date: '2026-07-20', category: 'translation' })
      await seedTask(client, { id: 'task-21', date: '2026-07-21', category: 'translation' })

      await expect(listedIds({ from: '2026-07-20', to: '2026-07-20' })).resolves.toEqual([
        'task-20'
      ])
    })

    // "A week with no tasks [...] is a normal state and not an error." The spec makes the empty
    // answer a normal 200, so the handler resolves rather than refusing.
    it('returns an empty array for a range holding no task', async () => {
      await seedTask(client, { id: 'task-before', date: DAY_BEFORE, category: 'translation' })
      await seedTask(client, { id: 'task-after', date: DAY_AFTER, category: 'translation' })

      await expect(listedIds(WEEK)).resolves.toEqual([])
    })

    it('returns an empty array for an account with no tasks at all', async () => {
      await expect(listedIds(WEEK)).resolves.toEqual([])
    })

    // AC14's "correct across month and year boundaries". The endpoint takes the range the client
    // derived, so a week straddling December into January has to scan as one range rather than two.
    it('returns a range that straddles a year boundary as one range', async () => {
      await seedTask(client, { id: 'task-dec', date: '2025-12-29', category: 'translation' })
      await seedTask(client, { id: 'task-jan', date: '2026-01-04', category: 'translation' })
      await seedTask(client, { id: 'task-outside', date: '2026-01-05', category: 'translation' })

      await expect(listedIds({ from: '2025-12-29', to: '2026-01-04' })).resolves.toEqual([
        'task-dec',
        'task-jan'
      ])
    })
  })

  // "ordered by date ascending, then sortOrder ascending, then id for a stable tie-break". Every
  // fixture set below is inserted in an order that contradicts the expected one, so insertion order
  // can never be mistaken for the specced order.
  describe('the specced ordering: date, then sortOrder, then id', () => {
    it('orders by date ascending', async () => {
      await seedTask(client, { id: 'task-c', date: '2026-07-23', category: 'translation' })
      await seedTask(client, { id: 'task-a', date: '2026-07-19', category: 'translation' })
      await seedTask(client, { id: 'task-b', date: '2026-07-21', category: 'translation' })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-a', 'task-b', 'task-c'])
    })

    // Date outranks sortOrder. The earlier day carries the higher sortOrder here, so an endpoint
    // that sorted by sortOrder first would return these two the other way round.
    it('puts an earlier date first even when it carries a higher sortOrder', async () => {
      await seedTask(client, {
        id: 'task-later-day',
        date: '2026-07-21',
        category: 'translation',
        sortOrder: 0
      })
      await seedTask(client, {
        id: 'task-earlier-day',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 9
      })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-earlier-day', 'task-later-day'])
    })

    // "so a week with several tasks on the same day renders in a deterministic order".
    it('orders tasks sharing a date by sortOrder ascending', async () => {
      await seedTask(client, {
        id: 'task-third',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 3
      })
      await seedTask(client, {
        id: 'task-first',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 1
      })
      await seedTask(client, {
        id: 'task-second',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 2
      })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-first', 'task-second', 'task-third'])
    })

    // "then id for a stable tie-break". Two rows on the same day with the same sortOrder is the real
    // starting state, since the column defaults to 0, and without the third term the order SQLite
    // returns them in is unspecified.
    it('breaks a tie on date and sortOrder by id ascending', async () => {
      await seedTask(client, {
        id: 'task-zulu',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 0
      })
      await seedTask(client, {
        id: 'task-alpha',
        date: '2026-07-20',
        category: 'translation',
        sortOrder: 0
      })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-alpha', 'task-zulu'])
    })

    it('applies all three terms together across a full week', async () => {
      // Inserted so that insertion order, date order, sortOrder order and id order all disagree.
      await seedTask(client, {
        id: 'task-d',
        date: '2026-07-22',
        category: 'admin',
        sortOrder: 0
      })
      await seedTask(client, {
        id: 'task-b',
        date: '2026-07-19',
        category: 'translation',
        sortOrder: 5
      })
      await seedTask(client, {
        id: 'task-c',
        date: '2026-07-19',
        category: 'meetings',
        sortOrder: 5
      })
      await seedTask(client, {
        id: 'task-a',
        date: '2026-07-19',
        category: 'proofreading',
        sortOrder: 1
      })

      await expect(listedIds(WEEK)).resolves.toEqual(['task-a', 'task-b', 'task-c', 'task-d'])
    })
  })

  // AC1's "never returns another user's rows". A second account is seeded with rows sitting in the
  // very same range, so a query missing its user predicate returns them rather than nothing.
  describe('AC1: the scope is the session user and never an id from the request', () => {
    it('returns the session user rows while another account holds rows in the same range', async () => {
      await seedTask(client, { id: 'task-owner', date: '2026-07-20', category: 'translation' })
      await seedTask(client, {
        id: 'task-other',
        date: '2026-07-20',
        category: 'translation',
        userId: OTHER_USER_ID
      })

      // Both halves in one case. The other account's row being absent proves nothing on its own,
      // because a handler returning an empty array would satisfy it.
      await expect(listedIds(WEEK)).resolves.toEqual(['task-owner'])
    })

    it('returns an empty array when only another account has rows in the range', async () => {
      await seedTask(client, {
        id: 'task-other',
        date: '2026-07-20',
        category: 'translation',
        userId: OTHER_USER_ID
      })

      await expect(listedIds(WEEK)).resolves.toEqual([])
    })

    it('keeps the other account rows out even when they are the majority of the week', async () => {
      await seedTask(client, { id: 'task-owner', date: '2026-07-22', category: 'translation' })
      for (const date of ['2026-07-19', '2026-07-20', '2026-07-21', '2026-07-23']) {
        await seedTask(client, {
          id: `task-other-${date}`,
          date,
          category: 'translation',
          userId: OTHER_USER_ID
        })
      }

      await expect(listedIds(WEEK)).resolves.toEqual(['task-owner'])
    })

    // "even if a user id is smuggled in the query".
    it('ignores another account id smuggled into the request', async () => {
      await seedTask(client, { id: 'task-owner', date: '2026-07-20', category: 'translation' })
      await seedTask(client, {
        id: 'task-other',
        date: '2026-07-20',
        category: 'translation',
        userId: OTHER_USER_ID
      })

      await expect(listedIds(WEEK, SMUGGLED_EVENT)).resolves.toEqual(['task-owner'])
    })

    it('answers as whichever account the session names', async () => {
      await seedTask(client, { id: 'task-owner', date: '2026-07-20', category: 'translation' })
      await seedTask(client, {
        id: 'task-other',
        date: '2026-07-20',
        category: 'translation',
        userId: OTHER_USER_ID
      })

      const asOwner = await listedIds(WEEK)
      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })
      const asOther = await listedIds(WEEK)

      expect([asOwner, asOther]).toEqual([['task-owner'], ['task-other']])
    })
  })

  // "The row's statusKey is resolved here rather than in the page [...] so the comparison is made in
  // the query and the row is handed a finished key to render. The page draws what it is given."
  describe('each row arrives resolved rather than raw', () => {
    it('hands back a resolved status key, a trackable flag and a deliverable flag', async () => {
      await seedTask(client, {
        id: 'task-1',
        date: '2026-07-20',
        category: 'translation',
        status: TASK_STATUSES[1]
      })

      await expect(listTasks(event, query(WEEK))).resolves.toMatchObject([
        { deliverable: true, id: 'task-1', statusKey: 'encours', trackable: true }
      ])
    })

    // The late pseudo-status has no column behind it, and the client is handed the verdict rather
    // than the rule. The delivery deadline below is in the past at the fixture instant, so a row
    // that is not finished reports late.
    it('reports the late pseudo-status for an unfinished task past its deadline', async () => {
      await seedTask(client, {
        id: 'task-late',
        date: '2026-07-20',
        category: 'translation',
        deliveryDate: '2026-07-20',
        deliveryTime: '09:00',
        status: TASK_STATUSES[0]
      })

      await expect(listTasks(event, query(WEEK))).resolves.toMatchObject([
        { id: 'task-late', statusKey: 'retard' }
      ])
    })

    // The same row, finished, is never late. Pairs with the case above so the late verdict is shown
    // moving rather than being a constant.
    it('does not report a finished task as late', async () => {
      await seedTask(client, {
        id: 'task-done',
        date: '2026-07-20',
        category: 'translation',
        deliveryDate: '2026-07-20',
        deliveryTime: '09:00',
        status: TASK_STATUSES[2]
      })

      await expect(listTasks(event, query(WEEK))).resolves.toMatchObject([
        { id: 'task-done', statusKey: 'termine' }
      ])
    })

    // "The late comparison is made against the user's own clock, so a task is late when it is late
    // where they are and not where the server happens to run." The two cases below are the pair that
    // discriminates the zone rather than merely exercising the comparison.
    //
    // The fixture instant is 16:00 UTC, which is 12:00 in America/Toronto. A deadline of 14:00 is
    // therefore already past in UTC and still an hour and a half away for the user, so a comparison
    // made in the server's zone reports a task late that the user has not yet missed. Nothing else in
    // these two cases differs, so only the zone can explain the difference between them.
    it('does not report a task late whose deadline has passed only in the server zone', async () => {
      await seedTask(client, {
        id: 'task-not-yet-due',
        date: '2026-07-22',
        category: 'translation',
        deliveryDate: '2026-07-22',
        deliveryTime: '14:00',
        status: TASK_STATUSES[0]
      })

      await expect(listTasks(event, query(WEEK))).resolves.toMatchObject([
        { id: 'task-not-yet-due', statusKey: 'accepte' }
      ])
    })

    it('reports a task late once its deadline has passed in the user own zone', async () => {
      await seedTask(client, {
        id: 'task-overdue-locally',
        date: '2026-07-22',
        category: 'translation',
        deliveryDate: '2026-07-22',
        deliveryTime: '11:00',
        status: TASK_STATUSES[0]
      })

      await expect(listTasks(event, query(WEEK))).resolves.toMatchObject([
        { id: 'task-overdue-locally', statusKey: 'retard' }
      ])
    })

    // The database's raw 1-or-0 verdict is an implementation detail of the query and is named before
    // it leaves the handler, so it must not reach the client alongside the resolved key.
    it('does not leak the raw overdue column into the response', async () => {
      await seedTask(client, { id: 'task-1', date: '2026-07-20', category: 'translation' })

      const rows = await listTasks(event, query(WEEK))

      expect(rows[0]).not.toHaveProperty('isOverdue')
      expect(rows[0]).toHaveProperty('statusKey')
    })
  })

  describe('AC2: no session', () => {
    // The exact code. A handler that crashed on a missing session would also reject and would also
    // return no rows, and only the status can tell a refusal apart from a fault.
    it('is refused with exactly a 401 while the same call answers under a session', async () => {
      expect.assertions(2)

      await seedTask(client, { id: 'task-owner', date: '2026-07-20', category: 'translation' })
      recorder.setSession(null)

      await expect(listTasks(event, query(WEEK))).rejects.toMatchObject({ statusCode: 401 })

      recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })
      await expect(listedIds(WEEK)).resolves.toEqual(['task-owner'])
    })
  })
})
