import type { Client } from '@libsql/client'

import { createClient } from '@libsql/client'
import {
  allowedEmails,
  categoryQuotas,
  daySettings,
  settings,
  tasks,
  users,
  workSchedule
} from '~~/server/db/schema'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { getTableName } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { foreignKeysEnabled } from '../../helpers/taskTestDb'

// The table declarations in server/db/schema.ts, tested as declarations rather than as a byproduct of
// some handler that happens to write through them.
//
// Every expected value below comes from a spec or a migration, never from the current declaration:
//
//   AC1 of docs/specs/planning/day-settings-snapshot.md: "A new `day_settings` table, one row per
//   user and date [...] with a unique index on `(user_id, date)` and a cascading foreign key to
//   `users`."
//
//   AC1 of docs/specs/planning/read-only-week-capacity-and-nav.md: "The `work_schedule` table exists
//   in `server/db/schema.ts` [...] a `user_id` foreign key to `users.id` with `onDelete: 'cascade'`,
//   and a unique index on `(user_id, effective_from)`."
//
//   docs/specs/planning/per-category-quotas.md, "The shape the owner decided": `user_id text not
//   null -> users.id, on delete cascade` and `unique (user_id, category_id)`.
//
//   AC2 and AC4 of docs/specs/planning/tasks-schema.md: a foreign key on `user_id` to `users.id`
//   with `onDelete: 'cascade'`, an index over `(user_id, date)`, and "Deleting a user row removes all
//   of that user's task rows and leaves no task with a `user_id` that has no matching `users.id`
//   (verifiable by deleting a user in a test database with foreign-key enforcement on and confirming
//   the tasks are gone)".
//
//   The id and lifecycle-instant defaults, from the same spec's table and from the schema's own
//   stated rule that every table carries a text primary key defaulted through
//   `$defaultFn(() => crypto.randomUUID())` and Unix-seconds `mode: 'timestamp'` instants: the
//   figures asserted are a v4 uuid and the instant of the write.
//
// WHY THE DATABASE HERE IS BUILT FROM THE SCHEMA RATHER THAN FROM HAND-WRITTEN DDL. A constraint test
// is only worth something if the constraint under test came from the declaration under test. Running
// against test/helpers/taskTestDb.ts would prove that the helper's own CREATE TABLE text constrains,
// which says nothing about schema.ts and would go green if a foreign key were deleted from it. So the
// DDL is generated from the schema module with drizzle-kit, the same tool that produced
// server/db/migrations/, and the generated statements match those migrations. Delete
// `.onDelete('cascade')` or a `uniqueIndex(...)` from schema.ts and the generated DDL loses it and
// the behaviour cases below fail.
//
// The one place the generated DDL differs from the shipped migrations is `allowed_emails.invited_at`,
// where migration 0003 also carries a SQL-side `unixepoch()` default for rows that predate the
// column. That difference makes the assertion stronger rather than weaker: with no SQL default, a
// missing `$defaultFn` is a NOT NULL failure rather than a silently server-filled value.

const OWNER_ID = 'user-owner'
const OTHER_USER_ID = 'user-other'
const MISSING_USER_ID = 'user-who-does-not-exist'

// A v4 uuid as crypto.randomUUID() produces one: version nibble 4, variant nibble 8, 9, a or b.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// A fixed instant with a non-zero millisecond part, so a round trip through an integer column proves
// both that the value is stored in seconds and that the sub-second part is dropped rather than the
// mapping quietly handing back milliseconds.
const NOW = new Date('2026-09-08T12:34:56.789Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)
const NOW_TRUNCATED = new Date(NOW_SECONDS * 1000)

let ddl: string

beforeAll(async () => {
  const schema = {
    allowedEmails,
    categoryQuotas,
    daySettings,
    settings,
    tasks,
    users,
    workSchedule
  }
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema)
  )
  ddl = statements.join('\n')
})

type SchemaTestDb = {
  client: Client
  db: ReturnType<typeof drizzle>
}

// A fresh database per test, built from the generated DDL with referential integrity on, holding the
// two fixture users and nothing else. SQLite leaves PRAGMA foreign_keys off per connection, so the
// pragma is issued here and read back in the cases that depend on it.
async function createSchemaTestDb(): Promise<SchemaTestDb> {
  const client = createClient({ url: ':memory:' })
  onTestFinished(() => client.close())

  await client.execute('PRAGMA foreign_keys = ON')
  await client.executeMultiple(ddl)

  for (const [id, email] of [
    [OWNER_ID, 'owner@example.com'],
    [OTHER_USER_ID, 'other@example.com']
  ]) {
    await client.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: [id, email] })
  }

  return { client, db: drizzle(client) }
}

let harness: SchemaTestDb
let client: Client
let db: ReturnType<typeof drizzle>

beforeEach(async () => {
  harness = await createSchemaTestDb()
  client = harness.client
  db = harness.db
})

// The raw stored value of one column, read with SQL rather than through Drizzle, so an assertion
// about what a `mode: 'timestamp'` column actually holds is not made by the mapping under test.
async function rawValue(table: string, id: string, column: string): Promise<unknown> {
  const result = await client.execute({
    sql: `SELECT ${column} AS value FROM ${table} WHERE id = ?`,
    args: [id]
  })
  return result.rows[0]?.value
}

describe('server/db/schema.ts declared defaults', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('allowed_emails.invitedAt', () => {
    // The column is NOT NULL with no SQL-side default in the generated DDL, so an insert that omits
    // it lands only because the declaration fills it in.
    it('fills the invited instant when the insert omits it', async () => {
      const [row] = await db
        .insert(allowedEmails)
        .values({ email: 'invitee@example.com' })
        .returning()

      expect(row?.invitedAt).toEqual(NOW_TRUNCATED)
    })

    it('stores the invited instant as Unix seconds rather than milliseconds', async () => {
      await db.insert(allowedEmails).values({ email: 'invitee@example.com' })

      const result = await client.execute(
        "SELECT invited_at FROM allowed_emails WHERE email = 'invitee@example.com'"
      )

      expect(Number(result.rows[0]?.invited_at)).toBe(NOW_SECONDS)
    })

    it('reads the invited instant back as a Date and not as a number', async () => {
      await db.insert(allowedEmails).values({ email: 'invitee@example.com' })

      const [row] = await db.select().from(allowedEmails)

      expect(row?.invitedAt).toBeInstanceOf(Date)
    })

    it('keeps an explicitly provided invited instant', async () => {
      const provided = new Date('2026-01-02T03:04:05.000Z')

      const [row] = await db
        .insert(allowedEmails)
        .values({ email: 'invitee@example.com', invitedAt: provided })
        .returning()

      expect(row?.invitedAt).toEqual(provided)
    })
  })

  describe('work_schedule.id', () => {
    it('fills a v4 uuid when the insert omits the id', async () => {
      const [row] = await db
        .insert(workSchedule)
        .values({ effectiveFrom: '2026-09-01', userId: OWNER_ID, workMinutes: 450 })
        .returning()

      expect(row?.id).toMatch(UUID_V4)
    })

    it('gives two rows written in the same instant different ids', async () => {
      const [first] = await db
        .insert(workSchedule)
        .values({ effectiveFrom: '2026-09-01', userId: OWNER_ID, workMinutes: 450 })
        .returning()
      const [second] = await db
        .insert(workSchedule)
        .values({ effectiveFrom: '2026-10-01', userId: OWNER_ID, workMinutes: 400 })
        .returning()

      expect(first?.id).not.toBe(second?.id)
    })

    it('keeps an explicitly provided id', async () => {
      const [row] = await db
        .insert(workSchedule)
        .values({
          effectiveFrom: '2026-09-01',
          id: 'schedule-provided',
          userId: OWNER_ID,
          workMinutes: 450
        })
        .returning()

      expect(row?.id).toBe('schedule-provided')
    })
  })

  describe('work_schedule.createdAt and work_schedule.updatedAt', () => {
    it('fills both lifecycle instants when the insert omits them', async () => {
      const [row] = await db
        .insert(workSchedule)
        .values({ effectiveFrom: '2026-09-01', userId: OWNER_ID, workMinutes: 450 })
        .returning()

      expect({ createdAt: row?.createdAt, updatedAt: row?.updatedAt }).toEqual({
        createdAt: NOW_TRUNCATED,
        updatedAt: NOW_TRUNCATED
      })
    })

    // The mapping most likely to break silently: `mode: 'timestamp'` over an integer column. A read
    // that handed back the stored number would satisfy a loose equality check and break every caller
    // that treats the field as a Date.
    it.each([
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at']
    ] as const)('reads %s back as a Date rather than a number', async (field, column) => {
      const [row] = await db
        .insert(workSchedule)
        .values({ effectiveFrom: '2026-09-01', userId: OWNER_ID, workMinutes: 450 })
        .returning()

      const [selected] = await db.select().from(workSchedule)

      expect(selected?.[field]).toBeInstanceOf(Date)
      expect(Number(await rawValue('work_schedule', String(row?.id), column))).toBe(NOW_SECONDS)
    })

    // The proof that the two instants above come from the declaration and not from the database: the
    // same insert made with raw SQL, which never sees the declaration, leaves them null.
    it.each([['created_at'], ['updated_at']])(
      'leaves %s null on an insert that bypasses the declaration',
      async (column) => {
        await client.execute({
          sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
              VALUES ('schedule-raw', ?, 450, '2026-09-01')`,
          args: [OWNER_ID]
        })

        expect(await rawValue('work_schedule', 'schedule-raw', column)).toBeNull()
      }
    )

    it('keeps explicitly provided lifecycle instants', async () => {
      const provided = new Date('2026-01-02T03:04:05.000Z')

      const [row] = await db
        .insert(workSchedule)
        .values({
          createdAt: provided,
          effectiveFrom: '2026-09-01',
          updatedAt: provided,
          userId: OWNER_ID,
          workMinutes: 450
        })
        .returning()

      expect({ createdAt: row?.createdAt, updatedAt: row?.updatedAt }).toEqual({
        createdAt: provided,
        updatedAt: provided
      })
    })
  })

  // The same three declarations appear on the other tables built the same way, and a table whose id
  // came back null or whose instants came back as numbers would be a real defect wherever it sat.
  describe('the same defaults on the other tables', () => {
    it('fills a v4 uuid and both instants on day_settings', async () => {
      const [row] = await db
        .insert(daySettings)
        .values({ date: '2026-09-08', userId: OWNER_ID, workMinutes: 450 })
        .returning()

      expect(row?.id).toMatch(UUID_V4)
      expect({ createdAt: row?.createdAt, updatedAt: row?.updatedAt }).toEqual({
        createdAt: NOW_TRUNCATED,
        updatedAt: NOW_TRUNCATED
      })
    })

    it('fills a v4 uuid and both instants on category_quotas', async () => {
      const [row] = await db
        .insert(categoryQuotas)
        .values({ categoryId: 'translation', quotaWph: 240, userId: OWNER_ID })
        .returning()

      expect(row?.id).toMatch(UUID_V4)
      expect({ createdAt: row?.createdAt, updatedAt: row?.updatedAt }).toEqual({
        createdAt: NOW_TRUNCATED,
        updatedAt: NOW_TRUNCATED
      })
    })

    it('fills a v4 uuid on settings', async () => {
      const [row] = await db.insert(settings).values({ userId: OWNER_ID }).returning()

      expect(row?.id).toMatch(UUID_V4)
    })

    it('fills a v4 uuid and both instants on tasks', async () => {
      const [row] = await db
        .insert(tasks)
        .values({ category: 'translation', date: '2026-09-08', userId: OWNER_ID })
        .returning()

      expect(row?.id).toMatch(UUID_V4)
      expect({ createdAt: row?.createdAt, updatedAt: row?.updatedAt }).toEqual({
        createdAt: NOW_TRUNCATED,
        updatedAt: NOW_TRUNCATED
      })
    })

    // Deliberately no default on this one, per the comment the column carries: the magic-link verify
    // handler inserts a bare users row for a brand-new invitee, so an insert default would mark that
    // account as onboarded before the wizard had run.
    it('leaves users.onboardedAt null on a fresh row while filling the id and the instants', async () => {
      const [row] = await db.insert(users).values({ email: 'fresh@example.com' }).returning()

      expect(row?.id).toMatch(UUID_V4)
      expect(row?.onboardedAt).toBeNull()
      expect({ createdAt: row?.createdAt, updatedAt: row?.updatedAt }).toEqual({
        createdAt: NOW_TRUNCATED,
        updatedAt: NOW_TRUNCATED
      })
    })
  })
})

// getTableConfig forces the `(table) => [...]` callback each of these tables declares, which is where
// the foreign keys and the indexes live, and returns what it built. Asserting on that is asserting on
// the declaration itself rather than on a database built from it.
describe('server/db/schema.ts declared constraints', () => {
  describe('the user foreign key', () => {
    it.each([
      ['tasks', tasks],
      ['work_schedule', workSchedule],
      ['category_quotas', categoryQuotas],
      ['day_settings', daySettings]
    ] as const)('ties %s.user_id to users.id and cascades on delete', (_label, table) => {
      const keys = getTableConfig(table).foreignKeys

      expect(keys).toHaveLength(1)
      const reference = keys[0]!.reference()
      expect({
        columns: reference.columns.map((column) => column.name),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        foreignTable: getTableName(reference.foreignTable),
        onDelete: keys[0]!.onDelete
      }).toEqual({
        columns: ['user_id'],
        foreignColumns: ['id'],
        foreignTable: 'users',
        onDelete: 'cascade'
      })
    })

    // settings is the documented exception rather than an oversight found here.
    // docs/specs/planning/tasks-schema.md records it: "This is a deliberate departure from the
    // existing `settings` foreign key, which declares no `onDelete`; Feature 6's compliance pass
    // already flagged adding `onDelete: 'cascade'` to `settings` as a follow-up". So the key is
    // asserted to exist and to point at users.id, and the missing cascade is pinned as the known
    // state so closing that follow-up shows up here as a failing expectation to update rather than
    // as a silent change.
    it('ties settings.user_id to users.id with no cascade declared', () => {
      const keys = getTableConfig(settings).foreignKeys

      expect(keys).toHaveLength(1)
      const reference = keys[0]!.reference()
      expect({
        columns: reference.columns.map((column) => column.name),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        foreignTable: getTableName(reference.foreignTable),
        onDelete: keys[0]!.onDelete
      }).toEqual({
        columns: ['user_id'],
        foreignColumns: ['id'],
        foreignTable: 'users',
        onDelete: undefined
      })
    })
  })

  describe('the declared indexes', () => {
    it.each([
      [
        'work_schedule',
        workSchedule,
        'work_schedule_user_id_effective_from_idx',
        ['user_id', 'effective_from']
      ],
      [
        'category_quotas',
        categoryQuotas,
        'category_quotas_user_id_category_id_idx',
        ['user_id', 'category_id']
      ],
      ['day_settings', daySettings, 'day_settings_user_id_date_idx', ['user_id', 'date']]
    ] as const)(
      'declares the unique index the %s migration creates',
      (_label, table, name, columns) => {
        const indexes = getTableConfig(table).indexes

        expect(indexes).toHaveLength(1)
        expect({
          columns: indexes[0]!.config.columns.map((column) =>
            'name' in column ? column.name : column
          ),
          name: indexes[0]!.config.name,
          unique: indexes[0]!.config.unique
        }).toEqual({ columns: [...columns], name, unique: true })
      }
    )

    // tasks carries the one non-unique index, because a user has many tasks on a day. A unique index
    // here would be a defect rather than a stronger guarantee.
    it('declares a non-unique index over tasks (user_id, date)', () => {
      const indexes = getTableConfig(tasks).indexes

      expect(indexes).toHaveLength(1)
      expect({
        columns: indexes[0]!.config.columns.map((column) =>
          'name' in column ? column.name : column
        ),
        name: indexes[0]!.config.name,
        unique: indexes[0]!.config.unique
      }).toEqual({ columns: ['user_id', 'date'], name: 'tasks_user_id_date_idx', unique: false })
    })

    it('declares no index on settings', () => {
      expect(getTableConfig(settings).indexes).toEqual([])
    })
  })
})

// The declarations above, proved to behave. Each case shows the insert succeeding first and then the
// same insert refused, so a refusal can never be credited to a missing table, a typo in a column
// name, or a pragma that failed to apply.
describe('server/db/schema.ts declared constraints in force', () => {
  // Everything below reads a refusal as evidence, and a refusal proves nothing with foreign keys off.
  // The pragma is read from the database rather than inferred from what was requested.
  it('has referential integrity switched on for the connection', async () => {
    await expect(foreignKeysEnabled(client)).resolves.toBe(true)
  })

  describe('the user foreign key refuses an orphan row', () => {
    it.each([
      [
        'tasks',
        `INSERT INTO tasks (id, user_id, date, category) VALUES (?, ?, '2026-09-08', 'translation')`
      ],
      [
        'work_schedule',
        `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
         VALUES (?, ?, 450, '2026-09-01')`
      ],
      [
        'category_quotas',
        `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
         VALUES (?, ?, 'translation', 240)`
      ],
      [
        'day_settings',
        `INSERT INTO day_settings (id, user_id, date, work_minutes)
         VALUES (?, ?, '2026-09-08', 450)`
      ]
    ] as const)('accepts a %s row naming a user that exists', async (_label, sql) => {
      await expect(client.execute({ args: ['row-ok', OWNER_ID], sql })).resolves.toBeTruthy()
    })

    it.each([
      [
        'tasks',
        `INSERT INTO tasks (id, user_id, date, category) VALUES (?, ?, '2026-09-08', 'translation')`
      ],
      [
        'work_schedule',
        `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
         VALUES (?, ?, 450, '2026-09-01')`
      ],
      [
        'category_quotas',
        `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
         VALUES (?, ?, 'translation', 240)`
      ],
      [
        'day_settings',
        `INSERT INTO day_settings (id, user_id, date, work_minutes)
         VALUES (?, ?, '2026-09-08', 450)`
      ]
    ] as const)('refuses a %s row naming a user that does not exist', async (_label, sql) => {
      expect.assertions(1)

      await expect(client.execute({ args: ['row-orphan', MISSING_USER_ID], sql })).rejects.toThrow(
        /FOREIGN KEY constraint failed/i
      )
    })
  })

  describe('the cascade removes a deleted user rows', () => {
    it.each([
      [
        'tasks',
        `INSERT INTO tasks (id, user_id, date, category) VALUES ('row-1', ?, '2026-09-08', 'translation')`
      ],
      [
        'work_schedule',
        `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
         VALUES ('row-1', ?, 450, '2026-09-01')`
      ],
      [
        'category_quotas',
        `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
         VALUES ('row-1', ?, 'translation', 240)`
      ],
      [
        'day_settings',
        `INSERT INTO day_settings (id, user_id, date, work_minutes)
         VALUES ('row-1', ?, '2026-09-08', 450)`
      ]
    ] as const)('leaves no %s row behind when the user is deleted', async (table, sql) => {
      await client.execute({ args: [OWNER_ID], sql })
      const before = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)

      await client.execute({ args: [OWNER_ID], sql: 'DELETE FROM users WHERE id = ?' })

      const after = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)
      expect({ after: Number(after.rows[0]?.n), before: Number(before.rows[0]?.n) }).toEqual({
        after: 0,
        before: 1
      })
    })
  })

  describe('the unique index refuses a second row on the same key', () => {
    it('accepts one work_schedule row per user and effective date', async () => {
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
              VALUES ('schedule-1', ?, 450, '2026-09-01')`
      })

      await expect(
        client.execute({
          args: [OWNER_ID],
          sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
                VALUES ('schedule-2', ?, 400, '2026-10-01')`
        })
      ).resolves.toBeTruthy()
    })

    it('refuses a second work_schedule row for the same user and effective date', async () => {
      expect.assertions(1)
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
              VALUES ('schedule-1', ?, 450, '2026-09-01')`
      })

      await expect(
        client.execute({
          args: [OWNER_ID],
          sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
                VALUES ('schedule-2', ?, 400, '2026-09-01')`
        })
      ).rejects.toThrow(
        /UNIQUE constraint failed: work_schedule\.user_id, work_schedule\.effective_from/i
      )
    })

    it('accepts the same effective date for a different user', async () => {
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
              VALUES ('schedule-1', ?, 450, '2026-09-01')`
      })

      await expect(
        client.execute({
          args: [OTHER_USER_ID],
          sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
                VALUES ('schedule-2', ?, 450, '2026-09-01')`
        })
      ).resolves.toBeTruthy()
    })

    it('accepts one category_quotas row per user and category', async () => {
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
              VALUES ('quota-1', ?, 'translation', 240)`
      })

      await expect(
        client.execute({
          args: [OWNER_ID],
          sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
                VALUES ('quota-2', ?, 'revision', 900)`
        })
      ).resolves.toBeTruthy()
    })

    it('refuses a second category_quotas row for the same user and category', async () => {
      expect.assertions(1)
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
              VALUES ('quota-1', ?, 'translation', 240)`
      })

      await expect(
        client.execute({
          args: [OWNER_ID],
          sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
                VALUES ('quota-2', ?, 'translation', 300)`
        })
      ).rejects.toThrow(
        /UNIQUE constraint failed: category_quotas\.user_id, category_quotas\.category_id/i
      )
    })

    it('accepts the same category for a different user', async () => {
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
              VALUES ('quota-1', ?, 'translation', 240)`
      })

      await expect(
        client.execute({
          args: [OTHER_USER_ID],
          sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
                VALUES ('quota-2', ?, 'translation', 300)`
        })
      ).resolves.toBeTruthy()
    })

    it('accepts one day_settings row per user and date', async () => {
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO day_settings (id, user_id, date, work_minutes)
              VALUES ('day-1', ?, '2026-09-08', 450)`
      })

      await expect(
        client.execute({
          args: [OWNER_ID],
          sql: `INSERT INTO day_settings (id, user_id, date, work_minutes)
                VALUES ('day-2', ?, '2026-09-09', 450)`
        })
      ).resolves.toBeTruthy()
    })

    // The index AC1 names is what makes the second task on a fresh day a no-op rather than a
    // duplicate stamp, so the refusal below is the guarantee the stamp path leans on.
    it('refuses a second day_settings row for the same user and date', async () => {
      expect.assertions(1)
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO day_settings (id, user_id, date, work_minutes)
              VALUES ('day-1', ?, '2026-09-08', 450)`
      })

      await expect(
        client.execute({
          args: [OWNER_ID],
          sql: `INSERT INTO day_settings (id, user_id, date, work_minutes)
                VALUES ('day-2', ?, '2026-09-08', 500)`
        })
      ).rejects.toThrow(/UNIQUE constraint failed: day_settings\.user_id, day_settings\.date/i)
    })

    it('accepts the same date for a different user', async () => {
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO day_settings (id, user_id, date, work_minutes)
              VALUES ('day-1', ?, '2026-09-08', 450)`
      })

      await expect(
        client.execute({
          args: [OTHER_USER_ID],
          sql: `INSERT INTO day_settings (id, user_id, date, work_minutes)
                VALUES ('day-2', ?, '2026-09-08', 450)`
        })
      ).resolves.toBeTruthy()
    })

    // tasks is the counterpart. Its index is not unique, so several tasks on one day is a normal
    // state rather than a refused one, which is what makes the three refusals above meaningful.
    it('accepts several tasks for the same user and date', async () => {
      await client.execute({
        args: [OWNER_ID],
        sql: `INSERT INTO tasks (id, user_id, date, category)
              VALUES ('task-1', ?, '2026-09-08', 'translation')`
      })

      await expect(
        client.execute({
          args: [OWNER_ID],
          sql: `INSERT INTO tasks (id, user_id, date, category)
                VALUES ('task-2', ?, '2026-09-08', 'revision')`
        })
      ).resolves.toBeTruthy()
    })
  })
})
