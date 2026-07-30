import type { Client } from '@libsql/client'

import { tasks } from '~~/server/db/schema'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedSettings,
  seedTask
} from '../../../../helpers/taskTestDb'

// The shared task projection: the select column list, the overdue SQL expression, and the
// row-to-TaskListItem mapper that list.ts, create.ts, and update.ts all read through.
//
// docs/specs/planning/task-write-api.md AC41 and AC42 make this the highest-value target in the
// feature. The extraction moved live behaviour out of list.ts, list.ts had no test coverage at all
// before it, and AC42 states plainly that there is no existing suite to lean on, so the projection
// has to be covered directly, "including the overdue comparison at its boundaries and the statusKey
// and trackable resolution". All three callers inherit whatever this module does.
//
// The overdue expression is real SQL, so it is exercised by running it against a real in-memory
// SQLite database rather than by asserting on a query-builder object. taskSelection takes `now` as a
// bound parameter, so every boundary case below is deterministic with no clock manipulation.
//
// Status values are written out as literals per AC44's test-fixture exemption.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { readTaskForUser, resolveUserNow, taskSelection, toTaskListItem } =
  await import('~~/server/api/tasks/handlers/projection')

let harness: TaskTestDb
let client: Client

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
})

afterEach(() => {
  vi.useRealTimers()
})

// The database's late verdict for one seeded row, read through the real selection expression.
async function overdueFlagFor(
  now: string,
  row: Parameters<typeof seedTask>[1]
): Promise<number | undefined> {
  await seedTask(client, row)
  const selected = await harness.db
    .select(taskSelection(now))
    .from(tasks)
    .where(and(eq(tasks.id, row.id), eq(tasks.userId, OWNER_ID)))
    .get()
  return selected?.isOverdue
}

describe('toTaskListItem (pure row mapper)', () => {
  // A complete projection row, so each case below overrides only the field it is about.
  const baseRow = {
    id: 'task-1',
    date: '2026-07-20',
    client: 'Acme',
    project: 'Manual',
    category: 'translation',
    deliveryDate: '2026-07-25',
    deliveryTime: '17:00',
    projectWordCount: 12_000,
    wordsDone: null,
    quotaWphOverride: null,
    estimatedMinutes: 120,
    actualMinutes: null,
    status: 'En cours',
    excludeFromStats: false,
    splitGroupId: null,
    sortOrder: 2,
    isOverdue: 0
  }

  it('returns exactly the TaskListItem contract fields and drops isOverdue', () => {
    const item = toTaskListItem(baseRow)

    // Written out rather than derived from the type, so a field silently added to or removed from
    // the response is a failure here rather than a shape the client discovers at runtime.
    expect(Object.keys(item).sort()).toEqual(
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
    expect('isOverdue' in item).toBe(false)
  })

  it('passes every stored column through untouched', () => {
    const item = toTaskListItem(baseRow)

    expect(item).toMatchObject({
      id: 'task-1',
      date: '2026-07-20',
      client: 'Acme',
      project: 'Manual',
      category: 'translation',
      deliveryDate: '2026-07-25',
      deliveryTime: '17:00',
      projectWordCount: 12_000,
      wordsDone: null,
      quotaWphOverride: null,
      estimatedMinutes: 120,
      actualMinutes: null,
      status: 'En cours',
      excludeFromStats: false,
      splitGroupId: null,
      sortOrder: 2
    })
  })

  // The raw category stays on the contract uncoerced, because PLAN-11 round-trips it on save.
  it('leaves an unknown stored category on the row rather than coercing it', () => {
    const item = toTaskListItem({ ...baseRow, category: 'revision' })

    expect(item.category).toBe('revision')
  })

  describe('trackable resolution (AC25)', () => {
    it.each(['translation', 'revision_internal', 'revision_external', 'proofreading'])(
      'resolves %s as trackable',
      (category) => {
        expect(toTaskListItem({ ...baseRow, category }).trackable).toBe(true)
      }
    )

    it.each(['terminology', 'meetings', 'breaks', 'admin', 'dtp'])(
      'resolves %s as not trackable',
      (category) => {
        expect(toTaskListItem({ ...baseRow, category }).trackable).toBe(false)
      }
    )

    // A stale id left behind by a retired category must never be reported as trackable, because its
    // words would then enter the quota numerator.
    it('resolves a stale category id as not trackable', () => {
      expect(toTaskListItem({ ...baseRow, category: 'revision' }).trackable).toBe(false)
    })
  })

  describe('statusKey resolution', () => {
    it.each([
      ['Accepté', 'accepte'],
      ['En cours', 'encours'],
      ['Terminé', 'termine']
    ])('maps the stored status %s to %s on a trackable row', (status, expected) => {
      expect(toTaskListItem({ ...baseRow, status }).statusKey).toBe(expected)
    })

    it('maps a null status on a trackable row to na', () => {
      expect(toTaskListItem({ ...baseRow, status: null }).statusKey).toBe('na')
    })

    it('maps an unrecognised stored status to na', () => {
      expect(toTaskListItem({ ...baseRow, status: 'Termine' }).statusKey).toBe('na')
    })

    // A non-trackable task has no status and reads as N/A everywhere, so a stray stored value must
    // never colour the row.
    it('maps any status on a non-trackable row to na', () => {
      const item = toTaskListItem({ ...baseRow, category: 'breaks', status: 'En cours' })

      expect(item.statusKey).toBe('na')
      expect(item.trackable).toBe(false)
    })

    it('promotes a late trackable row to retard, outranking its stored status', () => {
      expect(toTaskListItem({ ...baseRow, status: 'Accepté', isOverdue: 1 }).statusKey).toBe(
        'retard'
      )
    })

    // A finished task is never late, however long ago its delivery was.
    it('keeps a finished row at termine even when the late flag is set', () => {
      expect(toTaskListItem({ ...baseRow, status: 'Terminé', isOverdue: 1 }).statusKey).toBe(
        'termine'
      )
    })

    it('keeps a non-trackable row at na even when the late flag is set', () => {
      expect(
        toTaskListItem({ ...baseRow, category: 'meetings', status: null, isOverdue: 1 }).statusKey
      ).toBe('na')
    })
  })
})

describe('taskSelection overdue expression, run against real SQL (AC42)', () => {
  const NOW = '2026-07-20T10:00'

  it('is not late when there is no delivery date', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'no-delivery',
        date: '2026-07-20',
        category: 'translation',
        status: 'En cours'
      })
    ).toBe(0)
  })

  // A non-trackable break or meeting carries no status and has no delivery to miss.
  it('is not late when the row carries no status', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'no-status',
        date: '2026-07-20',
        category: 'breaks',
        deliveryDate: '2020-01-01'
      })
    ).toBe(0)
  })

  it('is not late when the row is finished, however long ago the delivery was', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'finished',
        date: '2026-07-20',
        category: 'translation',
        status: 'Terminé',
        deliveryDate: '2020-01-01',
        deliveryTime: '09:00'
      })
    ).toBe(0)
  })

  it('is late one minute past the deadline', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'one-minute-late',
        date: '2026-07-20',
        category: 'translation',
        status: 'En cours',
        deliveryDate: '2026-07-20',
        deliveryTime: '09:59'
      })
    ).toBe(1)
  })

  // The comparison is strictly less than, so a deadline landing exactly on the current minute has
  // not yet passed.
  it('is not late at exactly the deadline minute', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'exactly-due',
        date: '2026-07-20',
        category: 'translation',
        status: 'En cours',
        deliveryDate: '2026-07-20',
        deliveryTime: '10:00'
      })
    ).toBe(0)
  })

  it('is not late one minute before the deadline', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'one-minute-early',
        date: '2026-07-20',
        category: 'translation',
        status: 'Accepté',
        deliveryDate: '2026-07-20',
        deliveryTime: '10:01'
      })
    ).toBe(0)
  })

  // An untimed delivery is due by the end of its day, so a task due today with no time set is not
  // reported late all day.
  it('is not late all day when the delivery has a date but no time', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'untimed-today',
        date: '2026-07-20',
        category: 'translation',
        status: 'Accepté',
        deliveryDate: '2026-07-20'
      })
    ).toBe(0)
  })

  it('is still not late at 23:59 on the day of an untimed delivery', async () => {
    expect(
      await overdueFlagFor('2026-07-20T23:59', {
        id: 'untimed-end-of-day',
        date: '2026-07-20',
        category: 'translation',
        status: 'Accepté',
        deliveryDate: '2026-07-20'
      })
    ).toBe(0)
  })

  it('is late the minute after an untimed delivery day ends', async () => {
    expect(
      await overdueFlagFor('2026-07-21T00:00', {
        id: 'untimed-next-day',
        date: '2026-07-20',
        category: 'translation',
        status: 'Accepté',
        deliveryDate: '2026-07-20'
      })
    ).toBe(1)
  })

  it('is late for an untimed delivery on an earlier day', async () => {
    expect(
      await overdueFlagFor(NOW, {
        id: 'untimed-yesterday',
        date: '2026-07-20',
        category: 'translation',
        status: 'En cours',
        deliveryDate: '2026-07-19'
      })
    ).toBe(1)
  })

  // The comparison is a plain string comparison over 'YYYY-MM-DDTHH:MM', so it must stay correct
  // across a month boundary rather than only within one month.
  it('is late across a month boundary', async () => {
    expect(
      await overdueFlagFor('2026-08-01T09:00', {
        id: 'across-months',
        date: '2026-07-31',
        category: 'translation',
        status: 'Accepté',
        deliveryDate: '2026-07-31',
        deliveryTime: '17:00'
      })
    ).toBe(1)
  })
})

describe('resolveUserNow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 03:30 UTC, which is the previous evening in Toronto and the same morning in Paris. A zone that
    // straddles midnight is what proves the instant is resolved in the user's zone and not the
    // server's.
    vi.setSystemTime(new Date('2026-07-20T03:30:00Z'))
  })

  it('falls back to the coded default zone when the user has no settings row', async () => {
    expect(await resolveUserNow(OWNER_ID)).toBe('2026-07-19T23:30')
  })

  it('resolves the instant in the zone the user stored', async () => {
    await seedSettings(client, OWNER_ID, 'Europe/Paris')

    expect(await resolveUserNow(OWNER_ID)).toBe('2026-07-20T05:30')
  })

  it('reads each user own zone rather than a shared one', async () => {
    await seedSettings(client, OWNER_ID, 'America/Toronto')
    await seedSettings(client, OTHER_USER_ID, 'Australia/Sydney')

    expect(await resolveUserNow(OWNER_ID)).toBe('2026-07-19T23:30')
    expect(await resolveUserNow(OTHER_USER_ID)).toBe('2026-07-20T13:30')
  })
})

describe('readTaskForUser', () => {
  it('returns the row in response shape for its owner', async () => {
    await seedTask(client, {
      id: 'task-1',
      date: '2026-07-20',
      category: 'translation',
      status: 'En cours',
      client: 'Acme',
      estimatedMinutes: 120,
      sortOrder: 4
    })

    const item = await readTaskForUser(OWNER_ID, 'task-1')

    expect(item).toMatchObject({
      id: 'task-1',
      date: '2026-07-20',
      category: 'translation',
      client: 'Acme',
      status: 'En cours',
      estimatedMinutes: 120,
      actualMinutes: null,
      wordsDone: null,
      excludeFromStats: false,
      sortOrder: 4,
      statusKey: 'encours',
      trackable: true
    })
  })

  // Ownership is a WHERE clause rather than a check after the fact, so another user's row is simply
  // not found and the caller cannot tell it apart from a missing one.
  it('returns undefined for a row belonging to another user', async () => {
    await seedTask(client, {
      id: 'their-task',
      userId: OTHER_USER_ID,
      date: '2026-07-20',
      category: 'translation'
    })

    expect(await readTaskForUser(OWNER_ID, 'their-task')).toBeUndefined()
  })

  it('returns undefined for an id that matches no row', async () => {
    expect(await readTaskForUser(OWNER_ID, 'nope')).toBeUndefined()
  })

  it('resolves the late verdict through the same expression the list uses', async () => {
    await seedTask(client, {
      id: 'late-task',
      date: '2026-07-20',
      category: 'translation',
      status: 'Accepté',
      deliveryDate: '2020-01-01',
      deliveryTime: '09:00'
    })

    const item = await readTaskForUser(OWNER_ID, 'late-task')

    expect(item?.statusKey).toBe('retard')
  })

  it('reads the SQLite exclude_from_stats integer back as a real boolean', async () => {
    await seedTask(client, {
      id: 'excluded',
      date: '2026-07-20',
      category: 'admin',
      excludeFromStats: true
    })

    expect((await readTaskForUser(OWNER_ID, 'excluded'))?.excludeFromStats).toBe(true)
  })
})
