import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../helpers/taskTestDb'

import {
  countRows,
  createTaskTestDb,
  deactivateUser,
  foreignKeysEnabled,
  OTHER_USER_ID,
  OWNER_ID,
  readDaySettingsRows,
  seedCategoryQuota,
  seedDaySettings,
  seedSettings,
  seedTask,
  seedWorkSchedule
} from '../../../helpers/taskTestDb'

// The purge endpoint against a real database, covering the one thing the existing
// purge-deactivated.test.ts cannot: that a purged user's tasks, work_schedule, category_quotas and
// day_settings
// rows are actually gone afterwards. That suite mocks useDb with a fake whose delete() resolves to nothing, which proves
// the statements were issued and proves nothing about what any table ends up holding. So the seam here
// is moved one layer down to a genuine in-memory libSQL database, and every assertion reads raw SQL.
//
// Why this runs with foreign keys OFF, which is the whole point and is not a shortcut.
//
// tasks, work_schedule, category_quotas and day_settings all declare onDelete('cascade'), so with
// referential
// integrity in force the rows would vanish when the users row went, whatever the endpoint did or did
// not delete explicitly. This suite would pass, it would prove nothing about the endpoint, and it would
// keep passing if someone deleted the four explicit statements as redundant. That is the exact regression it exists to
// catch. The cascade also only fires because Turso switches PRAGMA foreign_keys on server-side, and
// server/db/schema.ts records that this was probed against development and never against production,
// so leaning on it is leaning on something unverified where it matters most.
//
// day_settings joined that list last and it is the reason this comment was edited rather than left
// alone. Its schema comment claims the purge clears it explicitly, and the delete is there, but until
// the case below existed nothing seeded a row for it, so the statement could have been removed with
// every assertion in this file still green. A check that cannot fail is the failure this project's
// build trail keeps recording in new disguises, so the row is seeded for both users and the deletion
// is read back.
//
// Turning it off is only meaningful if it really turned off, so the first test asserts the pragma reads
// 0 rather than trusting that it was requested. A pragma that silently failed to apply would leave the
// cascade quietly doing the work, and this file would report a pass for the wrong reason. That is the
// same broken-instrument failure the explicit deletes exist to remove, and it would be no better here.

const { dbRef, delMock } = vi.hoisted(() => ({
  dbRef: { current: null as unknown },
  delMock: vi.fn()
}))

vi.mock('~~/server/utils/avatarStorage', () => ({
  avatarStorage: { del: delMock, get: vi.fn(), put: vi.fn() }
}))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

// defineEventHandler wraps the handler at import time, so it is stubbed before the import and unwraps
// to the raw async function the tests can call directly.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)

const purgeDeactivated = (await import('~~/server/api/cron/purge-deactivated.get')).default as (
  event: unknown
) => Promise<{ purged: number }>

const SECRET = 'cron-secret'
const event = { __event: true }

// Well over the one-year retention cutoff, so the real isPurgeable returns true and the account is
// genuinely purgeable rather than stubbed into being so.
const LONG_AGO = new Date('2000-01-01T00:00:00Z')

let harness: TaskTestDb
let client: Client

function stubGlobals() {
  vi.stubGlobal('getHeader', () => `Bearer ${SECRET}`)
  vi.stubGlobal('useRuntimeConfig', () => ({ cronSecret: SECRET }))
  vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(opts.statusMessage), opts)
  )
}

describe('the suite runs with referential integrity in force by default', () => {
  // The guarantee the default harness now makes, asserted rather than assumed. For as long as the
  // helper issued no pragma, SQLite left foreign keys off per connection and every key it declared was
  // decoration, so a broken cascade or a fixture referencing a user that does not exist kept the whole
  // suite green. This is the test that would go red if the pragma were ever dropped again.
  beforeEach(async () => {
    harness = await createTaskTestDb()
    client = harness.client
  })

  it('reads PRAGMA foreign_keys as on', async () => {
    expect(await foreignKeysEnabled(client)).toBe(true)
  })

  it('actually enforces, rejecting a task row for a user that does not exist', async () => {
    // Reading the pragma proves what the setting says. Only a refused orphan proves it is in force,
    // which is the difference between a configured instrument and a working one.
    await expect(
      seedTask(client, {
        category: 'translation',
        date: '2026-07-20',
        id: 't-orphan',
        userId: 'ghost'
      })
    ).rejects.toThrow(/FOREIGN KEY constraint failed/)
  })

  it('accepts a task row for a user that does exist, so the check is not refusing everything', async () => {
    // The positive control for the test above. A harness that rejected every insert would satisfy it
    // for the wrong reason.
    await expect(
      seedTask(client, {
        category: 'translation',
        date: '2026-07-20',
        id: 't-ok',
        userId: OWNER_ID
      })
    ).resolves.toBe('t-ok')
  })
})

describe('purge-deactivated erases dependent rows without the cascade (AC68, AC70)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    delMock.mockResolvedValue(undefined)
    stubGlobals()

    // The cascade is deliberately unavailable here. See the reasoning at the top of the file.
    harness = await createTaskTestDb({ foreignKeys: false })
    client = harness.client
    dbRef.current = harness.db

    // The account to be purged, aged past the retention cutoff, carrying one row in each table the
    // endpoint has to clear.
    await deactivateUser(client, OWNER_ID, LONG_AGO)
    await seedSettings(client, OWNER_ID, 'America/Toronto')
    await seedTask(client, {
      category: 'translation',
      date: '2026-07-20',
      id: 'task-purged',
      notes: 'prose about client work that must not survive an erasure',
      userId: OWNER_ID
    })
    await seedWorkSchedule(client, OWNER_ID)
    await seedCategoryQuota(client, OWNER_ID)
    // The day the purged task was logged on, stamped the way the day settings snapshot stamps it. It
    // is personal data of the same kind as the rest, a record of how long that user's working day was,
    // so an erasure that left it behind would leave a trace of the account it erased.
    await seedDaySettings(client, OWNER_ID, '2026-07-20', { workMinutes: 400 })

    // A second, active account with rows of its own, so the deletes have to be scoped by user id
    // rather than clearing the tables.
    await seedSettings(client, OTHER_USER_ID, 'America/Toronto')
    await seedTask(client, {
      category: 'revision_internal',
      date: '2026-07-21',
      id: 'task-kept',
      userId: OTHER_USER_ID
    })
    await seedWorkSchedule(client, OTHER_USER_ID)
    await seedCategoryQuota(client, OTHER_USER_ID)
    await seedDaySettings(client, OTHER_USER_ID, '2026-07-21', { workMinutes: 300 })
  })

  it('confirms the cascade is genuinely unavailable before anything is concluded from it', async () => {
    expect(await foreignKeysEnabled(client)).toBe(false)
  })

  it('deletes the purged user tasks and work_schedule rows', async () => {
    // The rows exist first, so the absence asserted afterwards is a deletion rather than a fixture
    // that never landed.
    expect(await countRows(client, 'tasks')).toBe(2)
    expect(await countRows(client, 'work_schedule')).toBe(2)

    const result = await purgeDeactivated(event)

    expect(result).toEqual({ purged: 1 })

    const remainingTasks = await client.execute('SELECT id, user_id FROM tasks')
    const remainingSchedules = await client.execute('SELECT user_id FROM work_schedule')

    expect(remainingTasks.rows.map((row) => row.id)).toEqual(['task-kept'])
    expect(remainingSchedules.rows.map((row) => row.user_id)).toEqual([OTHER_USER_ID])
  })

  it('deletes the purged user day_settings rows', async () => {
    // The row exists first, and it is read by date rather than counted, so the absence asserted
    // afterwards is a deletion rather than a fixture that never landed. That distinction is the whole
    // reason this case exists: the endpoint's day_settings delete was already written and already
    // passing, but nothing seeded a row for it, so removing the statement would have left every
    // assertion in this file green.
    expect(await countRows(client, 'day_settings')).toBe(2)
    expect((await readDaySettingsRows(client, OWNER_ID)).map((row) => row.date)).toEqual([
      '2026-07-20'
    ])

    const result = await purgeDeactivated(event)

    expect(result).toEqual({ purged: 1 })
    expect(await readDaySettingsRows(client, OWNER_ID)).toEqual([])

    // The scoped half, asserted here rather than in a case of its own because the same purge answers
    // both questions. The active user's stamp survives with the figure it was written with, so the
    // delete names a user rather than clearing the table.
    expect(await readDaySettingsRows(client, OTHER_USER_ID)).toMatchObject([
      { date: '2026-07-21', work_minutes: 300 }
    ])
  })

  it('leaves no row of the purged user in any table', async () => {
    await purgeDeactivated(event)

    for (const table of [
      'tasks',
      'work_schedule',
      'category_quotas',
      'day_settings',
      'settings',
      'users'
    ]) {
      const result = await client.execute({
        sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'} = ?`,
        args: [OWNER_ID]
      })

      expect(Number(result.rows[0]?.n), `${table} still holds a purged row`).toBe(0)
    }
  })

  it('leaves the active user rows untouched, so the deletes are scoped by user id', async () => {
    await purgeDeactivated(event)

    for (const table of ['tasks', 'work_schedule', 'category_quotas', 'day_settings', 'settings']) {
      const result = await client.execute({
        sql: `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`,
        args: [OTHER_USER_ID]
      })

      expect(Number(result.rows[0]?.n), `${table} lost the active user row`).toBe(1)
    }

    expect(await countRows(client, 'users')).toBe(1)
  })

  it('purges nothing and deletes no row when the account is inside the retention window', async () => {
    // The real isPurgeable decides this, so the cutoff is exercised rather than stubbed.
    await deactivateUser(client, OWNER_ID, new Date())

    const result = await purgeDeactivated(event)

    expect(result).toEqual({ purged: 0 })
    expect(await countRows(client, 'tasks')).toBe(2)
    expect(await countRows(client, 'work_schedule')).toBe(2)
    expect(await countRows(client, 'day_settings')).toBe(2)
  })
})
