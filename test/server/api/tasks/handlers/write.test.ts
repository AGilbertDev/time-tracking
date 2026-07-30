import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { createTaskTestDb, OTHER_USER_ID, OWNER_ID, seedTask } from '../../../../helpers/taskTestDb'

// The three rules create.ts and update.ts share: the body-to-column mapping, the status-against-
// category check, and the sort_order rule.
//
// Derived from docs/specs/planning/task-write-api.md: "Partial update semantics, absent against
// explicit null", "Do not store the fallback", "Status is validated against the category, on the
// resulting row", "sort_order is assigned by the server", and acceptance criteria AC14, AC16, AC17,
// AC23, AC25, AC26, AC29, AC30.
//
// toTaskColumns and assertStatusFitsCategory are pure and are tested directly with no mocks.
// nextSortOrder issues a real max() aggregate, so it runs against a real in-memory SQLite database
// rather than a stubbed query builder, because the thing being tested is the aggregate and its
// scoping and a fake would assert neither.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { assertStatusFitsCategory, nextSortOrder, toTaskColumns } =
  await import('~~/server/api/tasks/handlers/write')

let harness: TaskTestDb
let client: Client

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string; data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
})

describe('toTaskColumns', () => {
  it('maps an empty body to no columns at all', () => {
    expect(toTaskColumns({})).toEqual({})
  })

  it('maps every writable field the body carries', () => {
    const columns = toTaskColumns({
      date: '2026-07-20',
      client: 'Acme',
      project: 'Manual',
      category: 'translation',
      deliveryDate: '2026-07-25',
      deliveryTime: '17:00',
      projectWordCount: 12_000,
      quotaWphOverride: 500,
      estimatedMinutes: 120,
      actualMinutes: 90,
      status: 'En cours',
      excludeFromStats: true
    })

    expect(columns).toEqual({
      date: '2026-07-20',
      client: 'Acme',
      project: 'Manual',
      category: 'translation',
      deliveryDate: '2026-07-25',
      deliveryTime: '17:00',
      projectWordCount: 12_000,
      quotaWphOverride: 500,
      estimatedMinutes: 120,
      actualMinutes: 90,
      status: 'En cours',
      excludeFromStats: true
    })
  })

  describe('absent against explicit null (AC14)', () => {
    // An absent field must be left out entirely rather than mapped to undefined, because a key
    // present in the update object is a column the write touches.
    it('omits a field the body does not carry', () => {
      const columns = toTaskColumns({ client: 'Acme' })

      expect(Object.keys(columns)).toEqual(['client'])
      expect('actualMinutes' in columns).toBe(false)
    })

    it('passes an explicit null through so the column is cleared', () => {
      const columns = toTaskColumns({ actualMinutes: null })

      expect('actualMinutes' in columns).toBe(true)
      expect(columns.actualMinutes).toBeNull()
    })

    // Zero minutes is a measurement, not a clear, so it must survive the mapping as 0.
    it('passes an explicit 0 through as 0 rather than treating it as absent', () => {
      const columns = toTaskColumns({ actualMinutes: 0 })

      expect(columns.actualMinutes).toBe(0)
    })

    it('passes an explicit false through rather than treating it as absent', () => {
      const columns = toTaskColumns({ excludeFromStats: false })

      expect(columns.excludeFromStats).toBe(false)
    })

    it('passes an empty-string-normalized null client through as a clear', () => {
      expect(toTaskColumns({ client: null })).toEqual({ client: null })
    })
  })

  describe('the two columns this must never write (AC16, AC17, AC29, AC30)', () => {
    // ---------------------------------------------------------------------------------------------
    // DO NOT "FIX" THIS BY ADDING THE AUTO-FILL BACK.
    //
    // The 2026-07-29 locked decision, restated in the spec under "Do not store the fallback": a
    // create or update carrying estimatedMinutes and no actualMinutes must leave actual_minutes
    // alone. Auto-filling looks like a convenience and the app this replaces did exactly that. It is
    // not one. Storing the copy makes a duration the user confirmed at 2 h 00 and a duration the app
    // assumed at 2 h 00 into identical rows, and nothing downstream can tell them apart afterwards.
    // effectiveDuration already resolves the fallback at read time, so leaving the column NULL looks
    // identical on screen and keeps the distinction for free.
    // ---------------------------------------------------------------------------------------------
    it('never derives actualMinutes from estimatedMinutes', () => {
      const columns = toTaskColumns({ estimatedMinutes: 120 })

      expect('actualMinutes' in columns).toBe(false)
      expect(columns).toEqual({ estimatedMinutes: 120 })
    })

    it('leaves actualMinutes absent when the body carries an estimate and clears nothing', () => {
      const columns = toTaskColumns({ estimatedMinutes: 0 })

      expect('actualMinutes' in columns).toBe(false)
    })

    // ---------------------------------------------------------------------------------------------
    // DO NOT ADD A words_done MIRROR HERE.
    //
    // Route B in the spec's "The words_done question, and how it was settled" is the tempting one,
    // because overview.md contains a line reading "the app should set it rather than ask twice". It
    // was rejected. Mirroring project_word_count into words_done is the same defect as auto-filling
    // actual_minutes, and TaskRow.vue prints "words done / project total", so a brand-new 12 000-word
    // task would render 12 000 / 12 000 and read as finished before it had been started. The column
    // is also scheduled for removal in PLAN-33.
    // ---------------------------------------------------------------------------------------------
    it('never mirrors projectWordCount into wordsDone', () => {
      const columns = toTaskColumns({ projectWordCount: 12_000 }) as Record<string, unknown>

      expect('wordsDone' in columns).toBe(false)
      expect(columns).toEqual({ projectWordCount: 12_000 })
    })

    it('emits no server-owned or other-feature column for any writable body', () => {
      const columns = toTaskColumns({
        date: '2026-07-20',
        category: 'translation',
        projectWordCount: 12_000,
        estimatedMinutes: 120
      }) as Record<string, unknown>

      for (const forbidden of [
        'id',
        'userId',
        'createdAt',
        'updatedAt',
        'wordsDone',
        'sortOrder',
        'splitGroupId'
      ]) {
        expect(forbidden in columns).toBe(false)
      }
    })
  })
})

describe('assertStatusFitsCategory (AC23, AC25)', () => {
  it('accepts an absent status on a non-trackable category', () => {
    expect(() => assertStatusFitsCategory('breaks', undefined)).not.toThrow()
  })

  // The client asserted nothing, so this is not an error. update.ts clears the stored value itself.
  it('accepts an explicit null status on a non-trackable category', () => {
    expect(() => assertStatusFitsCategory('breaks', null)).not.toThrow()
  })

  it.each(['translation', 'revision_internal', 'revision_external', 'proofreading'])(
    'accepts a status on the trackable category %s',
    (category) => {
      expect(() => assertStatusFitsCategory(category, 'En cours')).not.toThrow()
    }
  )

  // Trackability is read from isTrackableCategory, so every non-trackable id in the contract is
  // refused rather than a hand-written subset of them.
  it.each(['terminology', 'meetings', 'breaks', 'admin', 'dtp'])(
    'refuses a status on the non-trackable category %s',
    (category) => {
      expect(() => assertStatusFitsCategory(category, 'En cours')).toThrow()
    }
  )

  it('throws a 422 naming the status field', () => {
    let thrown: unknown
    try {
      assertStatusFitsCategory('breaks', 'Accepté')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      statusCode: 422,
      data: { status: expect.any(String) }
    })
  })

  // An unknown id coerces to the non-trackable admin default, so it can never be reported as
  // trackable and a status asserted on it is refused rather than quietly stored.
  it('refuses a status on an unknown category id', () => {
    expect(() => assertStatusFitsCategory('revision', 'En cours')).toThrow()
  })
})

describe('nextSortOrder (AC26)', () => {
  it('assigns 0 to the first task of an empty day', async () => {
    expect(await nextSortOrder(OWNER_ID, '2026-07-20')).toBe(0)
  })

  it('assigns max + 1 for a day whose highest is 3', async () => {
    await seedTask(client, { id: 'a', date: '2026-07-20', category: 'admin', sortOrder: 0 })
    await seedTask(client, { id: 'b', date: '2026-07-20', category: 'admin', sortOrder: 3 })
    await seedTask(client, { id: 'c', date: '2026-07-20', category: 'admin', sortOrder: 1 })

    expect(await nextSortOrder(OWNER_ID, '2026-07-20')).toBe(4)
  })

  it('ignores the same user tasks on other days', async () => {
    await seedTask(client, { id: 'other-day', date: '2026-07-19', category: 'admin', sortOrder: 9 })

    expect(await nextSortOrder(OWNER_ID, '2026-07-20')).toBe(0)
  })

  // The scan is scoped to the session user, so another user's tasks on the same date cannot move it.
  it('ignores another user tasks on the same date', async () => {
    await seedTask(client, {
      id: 'theirs',
      userId: OTHER_USER_ID,
      date: '2026-07-20',
      category: 'admin',
      sortOrder: 9
    })

    expect(await nextSortOrder(OWNER_ID, '2026-07-20')).toBe(0)
  })

  it('counts only the requested user rows when both users have tasks that day', async () => {
    await seedTask(client, { id: 'mine', date: '2026-07-20', category: 'admin', sortOrder: 1 })
    await seedTask(client, {
      id: 'theirs',
      userId: OTHER_USER_ID,
      date: '2026-07-20',
      category: 'admin',
      sortOrder: 42
    })

    expect(await nextSortOrder(OWNER_ID, '2026-07-20')).toBe(2)
  })
})
