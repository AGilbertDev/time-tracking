import type { Client } from '@libsql/client'

import { createClient } from '@libsql/client'
import { getTableName } from 'drizzle-orm'
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

// The users table as 0000 leaves it, plus 0012's onboarded_at. Only the columns the tasks foreign
// key and the fixtures need.
//
// onboarded_at carries no DEFAULT here, deliberately and for the same reason the shipped column
// carries none. The magic-link verify handler inserts a bare users row for a brand-new invitee, so
// an insert default would mark that account as onboarded before the wizard had run. Null is the
// correct state for a new row, and a DDL that defaulted it would make the tests for that agree with
// a database production does not have.
//
// This column has to stay in step with migration 0012 the same way TASKS_DDL stays in step with the
// live tasks table. A harness missing a column the shipped code selects is worse than no test at
// all, because every suite goes green while the handler under test would throw `no such column`
// against the real database. It was added when 0012 was written and it is the reason the three
// session-creation sites can be exercised here at all.
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
    deactivated_at integer,
    onboarded_at integer
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

// The category_quotas table as 0010 leaves it: one current figure per user and category, with no
// effective date. Present so the erasure path can be tested against a real table rather than a mock,
// since the purge endpoint names this table too and a cascade it cannot rely on is not what clears it.
const CATEGORY_QUOTAS_DDL = `
  CREATE TABLE category_quotas (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    category_id text NOT NULL,
    quota_wph integer NOT NULL,
    created_at integer,
    updated_at integer,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade
  )
`

// The unique index the write upserts on, so a test exercising the upsert conflicts the way production
// does rather than inserting a second row for the same category.
const CATEGORY_QUOTAS_INDEX_DDL = `
  CREATE UNIQUE INDEX category_quotas_user_id_category_id_idx
    ON category_quotas (user_id, category_id)
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
// through the write path they are checking. There is no effective date, because the table holds one
// current figure per user and category.
export async function seedCategoryQuota(
  client: Client,
  userId: string,
  categoryId = 'translation',
  quotaWph = 240
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO category_quotas (id, user_id, category_id, quota_wph)
          VALUES (?, ?, ?, ?)`,
    args: [`quota-${userId}-${categoryId}`, userId, categoryId, quotaWph]
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

// A Drizzle instance that logs which table each write names, and can be told to throw on one of
// them.
//
// This is a mock at the infrastructure boundary and nowhere else. Every statement that is not the
// chosen failure point runs for real against the real database, so a run that stops halfway leaves
// exactly the partial state production would leave. Injecting the failure any higher, by stubbing a
// handler's own steps, would be testing the test.
//
// It lives here rather than in one suite because two of them need it for different reasons. The reset
// has no transaction available, so its safety is entirely the write order and only a run that stops
// partway can show that order holding. The onboarding completion has to write the password and the
// timestamp in one statement, and counting the statements it issued is how that is observed rather
// than assumed.
//
// The log records the attempt rather than the success, so a forced failure still shows where the
// handler had got to when it stopped. That is the point of the ordering assertions.
export function instrumentedDb(
  db: unknown,
  order: string[],
  failOn?: 'category_quotas' | 'settings' | 'tasks' | 'users'
): unknown {
  return new Proxy(db as object, {
    get(target, property) {
      const value = Reflect.get(target, property)

      if (property === 'update' || property === 'delete' || property === 'insert') {
        return (table: never) => {
          const name = getTableName(table)
          order.push(`${String(property)}:${name}`)
          if (failOn === name) {
            throw new Error(`forced failure: ${String(property)} on ${name}`)
          }
          return (value as (t: never) => unknown).call(target, table)
        }
      }

      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    }
  })
}

// Inserts a magic_link_tokens row. The verify handler is one of the three session-creation sites, so
// exercising it needs a real token row to consume, and the two rules that handler carries are only
// separable by driving it end to end. Defaults to a live token, since an expired or already-used one
// is the exception a test asks for explicitly.
export async function seedMagicLinkToken(
  client: Client,
  token: string,
  email: string,
  options: { expiresAt?: Date; used?: boolean } = {}
): Promise<void> {
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000)
  await client.execute({
    sql: 'INSERT INTO magic_link_tokens (token, email, expires_at, used) VALUES (?, ?, ?, ?)',
    args: [token, email, Math.floor(expiresAt.getTime() / 1000), options.used ? 1 : 0]
  })
}

// The stored magic-link token row, raw. Whether a token was burned is read from the database rather
// than from the handler's return value, for the same reason as everywhere else here.
export async function readMagicLinkToken(
  client: Client,
  token: string
): Promise<Record<string, unknown> | undefined> {
  const result = await client.execute({
    sql: 'SELECT * FROM magic_link_tokens WHERE token = ?',
    args: [token]
  })
  const row = result.rows[0]
  return row ? Object.fromEntries(Object.entries(row)) : undefined
}

// The stored users row for an email rather than an id, which is how the magic-link path finds an
// account and the only way to read back a row that handler created for a brand-new invitee.
export async function readUserRowByEmail(
  client: Client,
  email: string
): Promise<Record<string, unknown> | undefined> {
  const result = await client.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] })
  const row = result.rows[0]
  return row ? Object.fromEntries(Object.entries(row)) : undefined
}

// The users columns a fixture can set. Every one is optional, matching the table, and a Date is
// stored as the Unix seconds the timestamp columns hold so a raw read-back sees exactly what
// production would.
export type UserRowSeed = {
  avatarUrl?: string | null
  createdAt?: Date | null
  deactivatedAt?: Date | null
  firstName?: string | null
  lastName?: string | null
  onboardedAt?: Date | null
  passwordHash?: string | null
  role?: string
}

// Sets columns on one of the fixture users with raw SQL, deliberately bypassing every handler so a
// starting state can never be shaped by the code a test is checking. Only the named columns are
// written, so a test saying nothing about password_hash leaves it null rather than inheriting a
// default it did not ask for.
//
// This lives here rather than in each suite because the onboarding reset, the two sign-in paths, and
// the wizard completion all need the same thing: an account put into a precise combination of
// "has a password" and "has finished setup". Those two columns are the whole subject of that
// feature, so the setup that arranges them belongs in one place.
export async function seedUserAccount(
  client: Client,
  userId: string,
  columns: UserRowSeed
): Promise<void> {
  const seconds = (value: Date | null | undefined) =>
    value ? Math.floor(value.getTime() / 1000) : null

  const assignments: Record<string, string | number | null> = {}
  if ('avatarUrl' in columns) assignments.avatar_url = columns.avatarUrl ?? null
  if ('createdAt' in columns) assignments.created_at = seconds(columns.createdAt)
  if ('deactivatedAt' in columns) assignments.deactivated_at = seconds(columns.deactivatedAt)
  if ('firstName' in columns) assignments.first_name = columns.firstName ?? null
  if ('lastName' in columns) assignments.last_name = columns.lastName ?? null
  if ('onboardedAt' in columns) assignments.onboarded_at = seconds(columns.onboardedAt)
  if ('passwordHash' in columns) assignments.password_hash = columns.passwordHash ?? null
  if (columns.role !== undefined) assignments.role = columns.role

  const names = Object.keys(assignments)
  if (names.length === 0) return

  await client.execute({
    sql: `UPDATE users SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`,
    args: [...names.map((name) => assignments[name] ?? null), userId]
  })
}

// The stored users row as the database holds it, column names and raw SQLite values. Every criterion
// about what a reset touches and what it leaves alone reads through this rather than through a
// handler, so the code under test is never also what reports on its own writes.
export async function readUserRow(
  client: Client,
  userId: string
): Promise<Record<string, unknown> | undefined> {
  const result = await client.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] })
  const row = result.rows[0]
  return row ? Object.fromEntries(Object.entries(row)) : undefined
}

// Every tasks row, in a stable order, as raw column values. This is what "the tasks table is
// unchanged" is asserted against: a count alone would pass while every row had been rewritten, so
// the comparison has to be over the rows themselves including quota_wph_override.
export async function readAllTaskRows(client: Client): Promise<Record<string, unknown>[]> {
  const result = await client.execute('SELECT * FROM tasks ORDER BY id ASC')
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)))
}

// The stored settings rows for one user, raw. A reset deletes the row rather than rewriting it, so
// the assertion is on rows returned rather than on any column value.
export async function readSettingsRows(
  client: Client,
  userId: string
): Promise<Record<string, unknown>[]> {
  const result = await client.execute({
    sql: 'SELECT * FROM settings WHERE user_id = ?',
    args: [userId]
  })
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)))
}

// The stored category_quotas rows for one user, raw, in a stable order.
export async function readCategoryQuotaRows(
  client: Client,
  userId: string
): Promise<Record<string, unknown>[]> {
  const result = await client.execute({
    sql: 'SELECT * FROM category_quotas WHERE user_id = ? ORDER BY category_id ASC',
    args: [userId]
  })
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)))
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
