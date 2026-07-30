import type { Client } from '@libsql/client'

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { onTestFinished } from 'vitest'

// A real in-memory SQLite database for the PLAN-09 write handlers, not a mocked query builder.
//
// The spec asks several criteria to be verified against the stored row rather than against the
// response (AC16 and AC31 name `SELECT actual_minutes` and `SELECT words_done` explicitly, because
// the response resolves the estimate fallback for display and would look right either way). A faked
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

// The settings table as 0000 through 0002 leave it. loadWorkSettings reads it for the timezone the
// overdue comparison is made in, and it is left real rather than mocked so the projection resolves
// its instant the way it does in production. No row means the coded defaults, America/Toronto.
const SETTINGS_DDL = `
  CREATE TABLE settings (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    daily_work_minutes integer DEFAULT 450,
    work_days text DEFAULT '[1,2,3,4,5]' NOT NULL,
    quota_wph integer DEFAULT 450 NOT NULL,
    light_theme text DEFAULT 'pastel' NOT NULL,
    dark_theme text DEFAULT 'pastel' NOT NULL,
    locale text DEFAULT 'fr' NOT NULL,
    timezone text DEFAULT 'America/Toronto' NOT NULL
  )
`

// The tasks table exactly as the live schema stands: migration 0004, plus 0006's exclude_from_stats
// default false, minus 0007's dropped instructions column. words_done is nullable with no default
// and actual_minutes is nullable, which is what makes AC16 and AC31 assertable as stored NULLs.
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
    words_done integer,
    quota_wph_override integer,
    estimated_minutes integer,
    actual_minutes integer,
    status text,
    split_group_id text,
    sort_order integer DEFAULT 0 NOT NULL,
    exclude_from_stats integer DEFAULT 0 NOT NULL,
    created_at integer,
    updated_at integer,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
  )
`

export type TaskTestDb = {
  client: Client
  db: ReturnType<typeof drizzle>
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
export async function createTaskTestDb(): Promise<TaskTestDb> {
  const client = createClient({ url: ':memory:' })
  onTestFinished(() => client.close())

  for (const statement of [USERS_DDL, SETTINGS_DDL, TASKS_DDL]) {
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
  wordsDone?: number | null
  quotaWphOverride?: number | null
  estimatedMinutes?: number | null
  actualMinutes?: number | null
  status?: string | null
  excludeFromStats?: boolean
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
            project_word_count, words_done, quota_wph_override, estimated_minutes, actual_minutes,
            status, split_group_id, sort_order, exclude_from_stats, created_at, updated_at
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
      row.wordsDone ?? null,
      row.quotaWphOverride ?? null,
      row.estimatedMinutes ?? null,
      row.actualMinutes ?? null,
      row.status ?? null,
      row.splitGroupId ?? null,
      row.sortOrder ?? 0,
      row.excludeFromStats ? 1 : 0,
      0,
      row.updatedAt ? Math.floor(row.updatedAt.getTime() / 1000) : 0
    ]
  })
  return row.id
}

// Inserts a settings row so a test can pin the timezone the overdue comparison is made in.
export async function seedSettings(
  client: Client,
  userId: string,
  timezone: string,
  quotaWph = 450
): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO settings (id, user_id, timezone, quota_wph) VALUES (?, ?, ?, ?)',
    args: [`settings-${userId}`, userId, timezone, quotaWph]
  })
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
