import type { Client } from '@libsql/client'

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { onTestFinished } from 'vitest'

// A real in-memory SQLite database for the PLAN-09 write handlers, not a mocked query builder.
//
// The spec asks several criteria to be verified against the stored row rather than against the
// response (the write API's AC16 names `SELECT actual_minutes` explicitly, because the response
// resolves the estimate fallback for display and would look right either way). A faked
// db object records whatever the handler happened to pass it, which proves nothing about what a
// column ends up holding, so the seam is moved one layer down: `useDb` is the only thing mocked and
// it returns a genuine Drizzle instance over an in-memory libSQL client. Column defaults, NOT NULL
// constraints, the `max(sort_order)` aggregate, and the overdue CASE expression all run for real.
//
// Fixtures are inserted with raw SQL and assertions read raw SQL, so the code under test is never
// also the thing that sets up or reads back its own state.

export const OWNER_ID = 'user-owner'
export const OTHER_USER_ID = 'user-other'

// The users table as 0000 leaves it. Only the columns the tasks foreign key and the fixtures need.
const USERS_DDL = `
  CREATE TABLE users (
    id text PRIMARY KEY NOT NULL,
    email text NOT NULL UNIQUE,
    first_name text,
    last_name text,
    avatar_url text,
    password_hash text,
    role text DEFAULT 'user' NOT NULL,
    created_at integer,
    updated_at integer,
    deactivated_at integer
  )
`

// The settings table as 0000 through 0002 leave it, minus 0011's dropped quota_wph. loadWorkSettings
// reads it for the timezone the overdue comparison is made in, and it is left real rather than mocked
// so the projection resolves its instant the way it does in production. No row means the coded
// defaults, America/Toronto.
const SETTINGS_DDL = `
  CREATE TABLE settings (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    daily_work_minutes integer DEFAULT 450,
    work_days text DEFAULT '[1,2,3,4,5]' NOT NULL,
    light_theme text DEFAULT 'pastel' NOT NULL,
    dark_theme text DEFAULT 'pastel' NOT NULL,
    locale text DEFAULT 'fr' NOT NULL,
    timezone text DEFAULT 'America/Toronto' NOT NULL
  )
`

// The tasks table exactly as the live schema stands: migration 0004, plus 0006's exclude_from_stats
// default false, minus 0007's dropped instructions column, minus 0008's dropped words_done, plus
// 0009's notes. actual_minutes is nullable, which is what makes the "stored, never derived" criteria
// assertable as stored NULLs, and notes is nullable with no default so a cleared note is assertable
// as a stored NULL rather than as an empty string.
//
// This DDL has to keep matching the live table. A test database still carrying a column production
// dropped is worse than no test at all: every suite goes green while the shipped read selects a
// column that is not there.
const TASKS_DDL = `
  CREATE TABLE tasks (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    date text NOT NULL,
    client text,
    project text,
    category text NOT NULL,
    delivery_date text,
    delivery_time text,
    project_word_count integer,
    quota_wph_override integer,
    estimated_minutes integer,
    actual_minutes integer,
    status text,
    split_group_id text,
    sort_order integer DEFAULT 0 NOT NULL,
    exclude_from_stats integer DEFAULT 0 NOT NULL,
    notes text,
    created_at integer,
    updated_at integer,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
  )
`

// The two tables the erasure path clears by email rather than by user id. They carry no foreign key of
// their own, so they are here only because the purge endpoint names them and a test running the real
// handler against a real database needs every table its statements touch to exist.
const MAGIC_LINK_TOKENS_DDL = `
  CREATE TABLE magic_link_tokens (
    token text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    expires_at integer NOT NULL,
    used integer DEFAULT 0
  )
`

const ALLOWED_EMAILS_DDL = `
  CREATE TABLE allowed_emails (
    email text PRIMARY KEY NOT NULL,
    invited_at integer NOT NULL DEFAULT (unixepoch())
  )
`

// The work_schedule table as 0005 leaves it. Present so the erasure path can be tested against a real
// table rather than a mock, since work_schedule is one of the two tables the purge endpoint has to
// clear and a cascade it cannot rely on used to be what cleared them.
const WORK_SCHEDULE_DDL = `
  CREATE TABLE work_schedule (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    work_minutes integer NOT NULL,
    work_days text DEFAULT '[1,2,3,4,5]' NOT NULL,
    buffer_minutes integer DEFAULT 60 NOT NULL,
    effective_from text NOT NULL,
    created_at integer,
    updated_at integer,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
  )
`

// The category_quotas table as 0010 leaves it. Present so the erasure path can be tested against a
// real table rather than a mock, since the purge endpoint names this table too and a cascade it cannot
// rely on is not what clears it.
const CATEGORY_QUOTAS_DDL = `
  CREATE TABLE category_quotas (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    category_id text NOT NULL,
    quota_wph integer NOT NULL,
    effective_from text NOT NULL,
    created_at integer,
    updated_at integer,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
  )
`

// The unique index the write upserts on, so a test exercising the upsert conflicts the way production
// does rather than inserting a second row for the same day.
const CATEGORY_QUOTAS_INDEX_DDL = `
  CREATE UNIQUE INDEX category_quotas_user_id_category_id_effective_from_idx
    ON category_quotas (user_id, category_id, effective_from)
`

export type TaskTestDb = {
  client: Client
  db: ReturnType<typeof drizzle>
}

export type TaskTestDbOptions = {
  // Whether referential integrity is in force. Defaults to true, which is the point: SQLite leaves
  // PRAGMA foreign_keys off per connection until something turns it on, so for as long as this helper
  // issued no pragma, every foreign key it declared was decoration. A cascade that stopped working, or
  // a fixture inserting a task for a user that does not exist, kept the whole suite green.
  //
  // Pass false only to prove something about the absence of the cascade. One test needs that: the
  // purge endpoint deletes tasks and work_schedule explicitly rather than leaning on onDelete
  // cascade, because that cascade depends on a Turso server default nobody has verified against
  // production. With the pragma on, that test would pass because the cascade cleaned up, and it would
  // keep passing if someone deleted the explicit statements, which is the one thing it exists to
  // catch. So it runs with the cascade off and asserts the pragma really reads 0 first.
  foreignKeys?: boolean
}

// Whether referential integrity is actually in force on this connection, read from the database rather
// than inferred from what was requested. A test that relies on the cascade being unavailable has to
// confirm that rather than assume it, because a pragma that silently failed to apply would leave the
// cascade doing the work and the test passing for the wrong reason.
export async function foreignKeysEnabled(client: Client): Promise<boolean> {
  const result = await client.execute('PRAGMA foreign_keys')
  return Number(Object.values(result.rows[0] ?? {})[0]) === 1
}

// A fresh database with the two fixture users already present. Called per test so no state leaks
// between cases.
//
// The harness owns the lifetime of its own client. createTaskTestDb is called per test and each
// call opens a client, nothing closed them before, and the handles accumulated for the whole run so
// the cost grew with every case added. Every suite then carried an identical afterEach to close it,
// which is five copies of one rule, so the rule now lives here once. An in-memory database is
// discarded with its client, so closing also drops the data rather than leaving it reachable.
//
// vitest's onTestFinished runs after the suite's own afterEach hooks, and it is registered below
// before the first await, so the client is released even when the DDL that follows throws partway.
// It can only be registered from inside a running test, which for these suites means a beforeEach.
// A harness built in a beforeAll or at module scope throws here rather than quietly leaking a
// client, and that is the right way round.
//
// Closing twice is a no-op on the libSQL client, so a suite that wants to close early can still do
// it through `client` without turning a test failure into a second error that hides it.
export async function createTaskTestDb(options: TaskTestDbOptions = {}): Promise<TaskTestDb> {
  const client = createClient({ url: ':memory:' })
  onTestFinished(() => client.close())

  // Before any DDL, so every statement that follows runs under the setting the caller asked for. It is
  // a per-connection setting rather than a per-database one, which is exactly why it has to be issued
  // here: each call opens its own client, so each one starts with foreign keys off.
  await client.execute(`PRAGMA foreign_keys = ${options.foreignKeys === false ? 'OFF' : 'ON'}`)

  for (const statement of [
    USERS_DDL,
    SETTINGS_DDL,
    TASKS_DDL,
    WORK_SCHEDULE_DDL,
    CATEGORY_QUOTAS_DDL,
    CATEGORY_QUOTAS_INDEX_DDL,
    MAGIC_LINK_TOKENS_DDL,
    ALLOWED_EMAILS_DDL
  ]) {
    await client.execute(statement)
  }

  for (const [id, email] of [
    [OWNER_ID, 'owner@example.com'],
    [OTHER_USER_ID, 'other@example.com']
  ]) {
    await client.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: [id, email] })
  }

  return { client, db: drizzle(client) }
}

// A stored task row as the fixtures describe one. Every column is optional but id, userId, date, and
// category, mirroring what the table requires.
export type TaskRowSeed = {
  id: string
  userId?: string
  date: string
  client?: string | null
  project?: string | null
  category: string
  deliveryDate?: string | null
  deliveryTime?: string | null
  projectWordCount?: number | null
  quotaWphOverride?: number | null
  estimatedMinutes?: number | null
  actualMinutes?: number | null
  status?: string | null
  excludeFromStats?: boolean
  notes?: string | null
  splitGroupId?: string | null
  sortOrder?: number
  updatedAt?: Date
}

// Inserts one task row with raw SQL, deliberately bypassing the write path so a fixture can never be
// shaped by the bug a test is looking for.
export async function seedTask(client: Client, row: TaskRowSeed): Promise<string> {
  await client.execute({
    sql: `INSERT INTO tasks (
            id, user_id, date, client, project, category, delivery_date, delivery_time,
            project_word_count, quota_wph_override, estimated_minutes, actual_minutes,
            status, split_group_id, sort_order, exclude_from_stats, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.userId ?? OWNER_ID,
      row.date,
      row.client ?? null,
      row.project ?? null,
      row.category,
      row.deliveryDate ?? null,
      row.deliveryTime ?? null,
      row.projectWordCount ?? null,
      row.quotaWphOverride ?? null,
      row.estimatedMinutes ?? null,
      row.actualMinutes ?? null,
      row.status ?? null,
      row.splitGroupId ?? null,
      row.sortOrder ?? 0,
      row.excludeFromStats ? 1 : 0,
      row.notes ?? null,
      0,
      row.updatedAt ? Math.floor(row.updatedAt.getTime() / 1000) : 0
    ]
  })
  return row.id
}

// Inserts a settings row so a test can pin the timezone the overdue comparison is made in. There is no
// quota argument, because the global quota_wph column retired in migration 0011 and a quota is now one
// row per category in category_quotas.
export async function seedSettings(
  client: Client,
  userId: string,
  timezone: string
): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO settings (id, user_id, timezone) VALUES (?, ?, ?)',
    args: [`settings-${userId}`, userId, timezone]
  })
}

// Inserts a work_schedule row. The erasure path has to clear this table as well as tasks, so a test
// covering the purge needs a real row here to watch disappear.
export async function seedWorkSchedule(
  client: Client,
  userId: string,
  effectiveFrom = '2026-07-01',
  workMinutes = 450
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO work_schedule (id, user_id, work_minutes, effective_from)
          VALUES (?, ?, ?, ?)`,
    args: [`schedule-${userId}`, userId, workMinutes, effectiveFrom]
  })
}

// Inserts a category_quotas row. The erasure path has to clear this table as well, and the resolver's
// stored-row branch needs a real row to resolve, so both kinds of test seed one from here rather than
// through the write path they are checking.
export async function seedCategoryQuota(
  client: Client,
  userId: string,
  categoryId = 'translation',
  quotaWph = 240,
  effectiveFrom = '2026-07-01'
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph, effective_from)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      `quota-${userId}-${categoryId}-${effectiveFrom}`,
      userId,
      categoryId,
      quotaWph,
      effectiveFrom
    ]
  })
}

// Marks a user as deactivated at a given instant, stored as the Unix seconds the timestamp column
// holds. The retention purge only touches accounts past its cutoff, so a test of the purge has to be
// able to age an account rather than wait a year.
export async function deactivateUser(
  client: Client,
  userId: string,
  deactivatedAt: Date
): Promise<void> {
  await client.execute({
    sql: 'UPDATE users SET deactivated_at = ? WHERE id = ?',
    args: [Math.floor(deactivatedAt.getTime() / 1000), userId]
  })
}

export async function countRows(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)
  return Number(result.rows[0]?.n ?? 0)
}

// The stored row as the database holds it, column names and raw SQLite values. This is what the
// "verified against the database row rather than against the response" criteria read.
export async function readStoredRow(
  client: Client,
  id: string
): Promise<Record<string, unknown> | undefined> {
  const result = await client.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [id] })
  const row = result.rows[0]
  return row ? Object.fromEntries(Object.entries(row)) : undefined
}

export async function countTasks(client: Client): Promise<number> {
  const result = await client.execute('SELECT COUNT(*) AS n FROM tasks')
  return Number(result.rows[0]?.n ?? 0)
}
