import type { Client } from '@libsql/client'

import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

import { ROOT } from '../../../helpers/sourceScan'

// AC1 through AC5 of docs/specs/admin/onboarding-reset.md: the column, the two migration files, and
// the backfill's arithmetic.
//
// The two migration files are executed here rather than described. There are no database credentials
// in this environment, so nothing can be applied against the production Turso database and that half
// is the owner's manual step. What can be proved is that the SQL these files contain does what the
// spec says it does, and that is done by running the real file text against a real SQLite database
// built to the shape the table had before 0012, so the ADD COLUMN has something to add to and the
// backfill has real rows to read.
//
// Every fixture is inserted with raw SQL and every assertion reads raw SQL, so no application code
// is involved in setting up or reporting on a migration's work.

const MIGRATIONS = join(ROOT, 'server/db/migrations')

const ADD_COLUMN_FILE = '0012_add_users_onboarded_at.sql'
const BACKFILL_FILE = '0013_backfill_users_onboarded_at.sql'

function migrationText(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
}

// The runner's own chunking rule, copied from scripts/apply-migrations.ts so "one executable
// statement" is counted exactly the way the thing that will apply these files counts it. It splits
// on the drizzle-kit marker and drops any chunk that is nothing but comment lines, because a header
// block sent to the database is a syntax error rather than a no-op.
//
// Counting some other way would be measuring a property of the test rather than of the file.
function executableChunks(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter(
      (chunk) =>
        chunk.length > 0 && !chunk.split('\n').every((line) => line.trim().startsWith('--'))
    )
}

// A chunk with its comment lines removed, so what is left is the SQL the database will actually run.
function sqlOnly(chunk: string): string {
  return chunk
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
}

// The users table as 0000 through 0011 leave it, which is to say the shape 0012 is applied to. It is
// deliberately written out here without onboarded_at rather than reused from test/helpers/taskTestDb,
// because that harness now carries the migrated shape and applying 0012 to it would fail with a
// duplicate column. This is the "before", and 0012 running against it is the thing under test.
const PRE_0012_USERS_DDL = `
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

async function preMigrationDb(): Promise<Client> {
  const client = createClient({ url: ':memory:' })
  onTestFinished(() => client.close())
  await client.execute(PRE_0012_USERS_DDL)
  return client
}

// Runs every executable chunk of a migration file, the way the runner does, one round trip each, and
// reports how many rows the file changed.
//
// The row count is what "a second run changes nothing" is actually asserted on. Comparing the table
// before and after is not enough on its own: the backfill writes COALESCE(created_at, unixepoch()),
// and a second run inside the same wall-clock second would write the identical value back onto a row
// it should never have matched at all. The tables would compare equal and the test would report a
// pass for a migration whose WHERE clause had been removed. rowsAffected cannot be fooled that way,
// because it counts rows matched rather than values changed.
async function runMigration(client: Client, file: string): Promise<number> {
  let rowsAffected = 0
  for (const chunk of executableChunks(migrationText(file))) {
    const result = await client.execute(chunk)
    rowsAffected += Number(result.rowsAffected ?? 0)
  }
  return rowsAffected
}

async function seedUser(
  client: Client,
  row: {
    createdAt: number | null
    email: string
    id: string
    onboardedAt?: number | null
    passwordHash: string | null
  }
): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
    args: [row.id, row.email, row.passwordHash, row.createdAt]
  })
  if (row.onboardedAt !== undefined) {
    await client.execute({
      sql: 'UPDATE users SET onboarded_at = ? WHERE id = ?',
      args: [row.onboardedAt, row.id]
    })
  }
}

async function allUsers(client: Client): Promise<Record<string, unknown>[]> {
  const result = await client.execute('SELECT * FROM users ORDER BY id ASC')
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)))
}

async function columnNames(client: Client, table: string): Promise<string[]> {
  const result = await client.execute(`PRAGMA table_info(${table})`)
  return result.rows.map((row) => String(row.name))
}

describe('the instrument, before anything is concluded from a migration run', () => {
  // Both files are read from disk and both are executed below, so a path that pointed at nothing
  // would make every assertion here vacuous. A missing file must fail loudly rather than yield an
  // empty string that happens to satisfy a "does not contain" search.
  it('reads both migration files and finds real text in each', () => {
    expect(migrationText(ADD_COLUMN_FILE).length).toBeGreaterThan(200)
    expect(migrationText(BACKFILL_FILE).length).toBeGreaterThan(200)
  })

  // The pre-0012 fixture has to genuinely lack the column, or 0012 would be applied to a table that
  // already had it and the ADD COLUMN would throw rather than proving anything.
  it('builds a users table that does not yet have onboarded_at', async () => {
    const client = await preMigrationDb()
    expect(await columnNames(client, 'users')).not.toContain('onboarded_at')
  })
})

describe('AC1: the Drizzle column is nullable with no default', () => {
  // The column as server/db/schema.ts declares it, checked through the Drizzle column object rather
  // than by searching the source text, so a declaration that compiled to something other than what
  // it looks like would still be caught.
  it('declares onboarded_at on users, nullable, with no default of any kind', async () => {
    const { users } = await import('~~/server/db/schema')

    expect(users.onboardedAt.name).toBe('onboarded_at')
    expect(users.onboardedAt.notNull).toBe(false)
    // hasDefault covers both halves of the requirement: a $defaultFn and a database-level default
    // both set it. A new users row must arrive null, because magic-link verify inserts a bare row
    // for an invitee who has not seen the wizard yet.
    expect(users.onboardedAt.hasDefault).toBe(false)
  })

  // mode 'timestamp' means Unix seconds, matching createdAt, updatedAt, and deactivatedAt on the same
  // table. Asserted through the mapping rather than through a drizzle internal name, because what
  // matters is that a stored integer of seconds reads back as the instant it names, and that a
  // seconds-versus-milliseconds mistake would show up as a date fifty thousand years out.
  it('maps a stored integer of Unix seconds back to the instant it names', async () => {
    const { users } = await import('~~/server/db/schema')

    const seconds = 1_756_512_000
    const mapped = users.onboardedAt.mapFromDriverValue(seconds) as Date

    expect(mapped).toBeInstanceOf(Date)
    expect(mapped.getTime()).toBe(seconds * 1000)
  })

  // The criterion's own wording: "Inserting a users row naming only email leaves onboarded_at null."
  // Written through Drizzle so any $defaultFn would fire, and read back with raw SQL so the answer
  // comes from the database rather than from the same layer that wrote it.
  it('leaves onboarded_at null on a row inserted naming only email', async () => {
    const { createTaskTestDb } = await import('../../../helpers/taskTestDb')
    const { users } = await import('~~/server/db/schema')

    const { client, db } = await createTaskTestDb()
    await db.insert(users).values({ email: 'brand-new@example.com' })

    const result = await client.execute({
      sql: 'SELECT onboarded_at FROM users WHERE email = ?',
      args: ['brand-new@example.com']
    })

    expect(result.rows[0]?.onboarded_at).toBeNull()
  })
})

describe('AC2: 0012 adds the column and claims no idempotency it does not have', () => {
  it('exists and holds exactly one executable statement', () => {
    const chunks = executableChunks(migrationText(ADD_COLUMN_FILE))

    expect(chunks).toHaveLength(1)
    // One statement, so one terminator. A second statement hiding in the same chunk is the failure
    // the split-file arrangement exists to prevent.
    expect(
      sqlOnly(chunks[0] as string)
        .split(';')
        .filter(Boolean)
    ).toHaveLength(1)
  })

  it('adds onboarded_at to users when run against the pre-migration shape', async () => {
    const client = await preMigrationDb()

    await runMigration(client, ADD_COLUMN_FILE)

    expect(await columnNames(client, 'users')).toContain('onboarded_at')
  })

  it('adds the column as nullable integer with no database-level default', async () => {
    const client = await preMigrationDb()
    await runMigration(client, ADD_COLUMN_FILE)

    const info = await client.execute('PRAGMA table_info(users)')
    const column = info.rows.find((row) => String(row.name) === 'onboarded_at')

    expect(String(column?.type).toLowerCase()).toBe('integer')
    expect(Number(column?.notnull)).toBe(0)
    expect(column?.dflt_value).toBeNull()
  })

  it('leaves every other users column exactly as it found it', async () => {
    const client = await preMigrationDb()
    const before = await columnNames(client, 'users')

    await runMigration(client, ADD_COLUMN_FILE)
    const after = await columnNames(client, 'users')

    // Purely additive. Nothing dropped, nothing renamed, and the new column appended at the end.
    expect(after).toEqual([...before, 'onboarded_at'])
  })

  // The criterion's second half. The runner in scripts/apply-migrations.ts throws on any error and
  // does not record the file, so a header saying it tolerates a duplicate column and continues would
  // describe a runner this project does not have and would carry a false claim forward into a file
  // somebody later trusts.
  //
  // The forbidden thing is the claim, not the words. 0012 quotes the sentence in order to disown it
  // and name 0006 as the file not to copy, which is the opposite of making the claim, so a bare
  // substring search would report a violation on a file that is doing exactly the right thing. What
  // is asserted instead is the affirmative construction the older headers use, and the correction
  // that has to be present.
  it('does not carry the affirmative tolerance claim the older headers use', () => {
    expect(migrationText(ADD_COLUMN_FILE)).not.toMatch(
      /so this statement\s+is applied through a runner that tolerates/
    )
  })

  it('has the instrument to find that claim, proved on the older files that make it', () => {
    // The positive control. A search that matched nothing because it could never match anything
    // would report the same clean result on a header that did carry the claim, so it is shown here
    // finding the claim in the three files the spec names as the ones that make it.
    for (const file of [
      '0002_add_settings_timezone.sql',
      '0003_add_allowed_emails_invited_at.sql',
      '0006_add_tasks_exclude_from_stats.sql'
    ]) {
      expect(migrationText(file)).toMatch(
        /so this statement\s+is applied through a runner that tolerates/
      )
    }
  })

  it('states the runner behaviour that actually applies, that no error is tolerated', () => {
    // The other half of the same requirement. Deleting the correction and leaving the quotation
    // would turn a disowned sentence back into an unqualified one, and this is what goes red then.
    const text = migrationText(ADD_COLUMN_FILE)

    expect(text).toMatch(/tolerates no error|throws on any error/i)
    expect(text).toMatch(/not safe to execute twice|fails with a duplicate column name/i)
  })
})

describe('AC3: 0013 is one restricted UPDATE', () => {
  it('exists and holds exactly one executable statement', () => {
    const chunks = executableChunks(migrationText(BACKFILL_FILE))

    expect(chunks).toHaveLength(1)
    expect(
      sqlOnly(chunks[0] as string)
        .split(';')
        .filter(Boolean)
    ).toHaveLength(1)
  })

  it('is an UPDATE restricted by password_hash IS NOT NULL AND onboarded_at IS NULL', () => {
    const statement = sqlOnly(executableChunks(migrationText(BACKFILL_FILE))[0] as string)
    const normalized = statement.replace(/`/g, '').replace(/\s+/g, ' ')

    expect(normalized).toMatch(/^UPDATE users/i)
    expect(normalized).toMatch(/WHERE password_hash IS NOT NULL AND onboarded_at IS NULL/i)
  })

  it('writes COALESCE(created_at, unixepoch()) rather than a bare created_at', () => {
    // created_at is nullable, so created_at alone would leave a null onboarded_at on any row that
    // lacks one, which is the exact failure the backfill exists to prevent.
    const statement = sqlOnly(executableChunks(migrationText(BACKFILL_FILE))[0] as string)
    const normalized = statement.replace(/`/g, '').replace(/\s+/g, ' ')

    expect(normalized).toMatch(/SET onboarded_at = COALESCE\(created_at, unixepoch\(\)\)/i)
  })
})

describe('AC4: what the backfill writes to each kind of row, and what a second run does', () => {
  const CREATED_AT = 1_700_000_000
  const ALREADY_ONBOARDED_AT = 1_650_000_000

  let client: Client
  let migrationMoment: number

  beforeEach(async () => {
    client = await preMigrationDb()
    await runMigration(client, ADD_COLUMN_FILE)

    // The four rows the criterion names, inserted with raw SQL.
    await seedUser(client, {
      createdAt: CREATED_AT,
      email: 'a@example.com',
      id: 'a-password-and-created-at',
      passwordHash: 'hash-a'
    })
    await seedUser(client, {
      createdAt: null,
      email: 'b@example.com',
      id: 'b-password-no-created-at',
      passwordHash: 'hash-b'
    })
    await seedUser(client, {
      createdAt: CREATED_AT,
      email: 'c@example.com',
      id: 'c-no-password',
      passwordHash: null
    })
    await seedUser(client, {
      createdAt: CREATED_AT,
      email: 'd@example.com',
      id: 'd-already-onboarded',
      onboardedAt: ALREADY_ONBOARDED_AT,
      passwordHash: 'hash-d'
    })

    // Captured immediately before the run so the unixepoch() fallback can be bounded from below.
    migrationMoment = Math.floor(Date.now() / 1000)
    await runMigration(client, BACKFILL_FILE)
  })

  async function onboardedAt(id: string): Promise<number | null> {
    const result = await client.execute({
      sql: 'SELECT onboarded_at FROM users WHERE id = ?',
      args: [id]
    })
    const value = result.rows[0]?.onboarded_at
    return value === null || value === undefined ? null : Number(value)
  }

  it('gives a row with a password and a created_at exactly its created_at', async () => {
    // created_at is the closest true instant available, and it preserves the invariant that an
    // account never reads as having finished setup before it existed.
    expect(await onboardedAt('a-password-and-created-at')).toBe(CREATED_AT)
  })

  it('gives a row with a password and no created_at the migration moment', async () => {
    const value = await onboardedAt('b-password-no-created-at')

    expect(value).not.toBeNull()
    // At or after the instant the migration ran, which is what unixepoch() means and is the honest
    // fallback rather than a plausible earlier instant invented for it.
    expect(value as number).toBeGreaterThanOrEqual(migrationMoment)
    expect(value as number).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1)
  })

  it('leaves a row with no password null', async () => {
    // That account accepted a magic link and never onboarded. It is genuinely not through setup, and
    // the old build agreed, because the flag it derived from password_hash was false for it too.
    expect(await onboardedAt('c-no-password')).toBeNull()
  })

  it('leaves a row that already had a timestamp holding the value it had', async () => {
    // The onboarded_at IS NULL half of the WHERE clause doing real work. Without it the backfill
    // could overwrite a real completion timestamp, or undo a deliberate admin reset that happened
    // after the first run.
    expect(await onboardedAt('d-already-onboarded')).toBe(ALREADY_ONBOARDED_AT)
  })

  it('matches no rows at all on a second run', async () => {
    // The direct measure. Two rows were written on the first run, and the WHERE clause has to leave
    // nothing for the second one to find.
    expect(await runMigration(client, BACKFILL_FILE)).toBe(0)
  })

  it('changes nothing at all on a second run', async () => {
    const before = await allUsers(client)

    await runMigration(client, BACKFILL_FILE)

    expect(await allUsers(client)).toEqual(before)
  })

  it('matches no rows on a third run either, so idempotency is not a one-off', async () => {
    await runMigration(client, BACKFILL_FILE)
    const before = await allUsers(client)

    expect(await runMigration(client, BACKFILL_FILE)).toBe(0)
    expect(await allUsers(client)).toEqual(before)
  })

  it('did match rows on the first run, so a zero afterwards is a finding', async () => {
    // The positive control for the two counts above. A rowsAffected that always read zero would
    // satisfy them without the WHERE clause doing anything, so the first run is shown reporting the
    // two rows it genuinely wrote: the one with a password and a created_at, and the one with a
    // password and no created_at. The row with no password and the row already carrying a timestamp
    // are both excluded.
    const fresh = await preMigrationDb()
    await runMigration(fresh, ADD_COLUMN_FILE)
    await seedUser(fresh, {
      createdAt: CREATED_AT,
      email: 'x@example.com',
      id: 'x',
      passwordHash: 'hash-x'
    })
    await seedUser(fresh, { createdAt: null, email: 'y@example.com', id: 'y', passwordHash: null })

    expect(await runMigration(fresh, BACKFILL_FILE)).toBe(1)
  })

  it('touches no column other than onboarded_at', async () => {
    // The backfill names one column. Every other value on every row has to be exactly what the
    // fixture inserted, because a migration that quietly rewrote created_at or password_hash would
    // be a far worse problem than the one it was written to solve.
    const rows = await allUsers(client)
    const withoutTheNewColumn = rows.map(({ onboarded_at: _ignored, ...rest }) => rest)

    expect(withoutTheNewColumn).toEqual([
      {
        avatar_url: null,
        created_at: CREATED_AT,
        deactivated_at: null,
        email: 'a@example.com',
        first_name: null,
        id: 'a-password-and-created-at',
        last_name: null,
        password_hash: 'hash-a',
        role: 'user',
        updated_at: null
      },
      {
        avatar_url: null,
        created_at: null,
        deactivated_at: null,
        email: 'b@example.com',
        first_name: null,
        id: 'b-password-no-created-at',
        last_name: null,
        password_hash: 'hash-b',
        role: 'user',
        updated_at: null
      },
      {
        avatar_url: null,
        created_at: CREATED_AT,
        deactivated_at: null,
        email: 'c@example.com',
        first_name: null,
        id: 'c-no-password',
        last_name: null,
        password_hash: null,
        role: 'user',
        updated_at: null
      },
      {
        avatar_url: null,
        created_at: CREATED_AT,
        deactivated_at: null,
        email: 'd@example.com',
        first_name: null,
        id: 'd-already-onboarded',
        last_name: null,
        password_hash: 'hash-d',
        role: 'user',
        updated_at: null
      }
    ])
  })
})

describe('AC5: after the backfill the two columns agree on every pre-existing row', () => {
  // The property that makes the deploy invisible to existing users, and the one that proves the
  // backfill leaves existing onboarded users onboarded. Every row here is a row as it existed before
  // this feature, which means every onboarded_at starts null.
  it('has onboarded_at IS NOT NULL equal password_hash IS NOT NULL for every row', async () => {
    const client = await preMigrationDb()
    await runMigration(client, ADD_COLUMN_FILE)

    const fixtures: [string, string | null, number | null][] = [
      ['with-password-and-date', 'hash-1', 1_700_000_000],
      ['with-password-no-date', 'hash-2', null],
      ['invited-never-onboarded', null, 1_700_000_100],
      ['invited-no-date', null, null]
    ]

    for (const [id, passwordHash, createdAt] of fixtures) {
      await seedUser(client, { createdAt, email: `${id}@example.com`, id, passwordHash })
    }

    await runMigration(client, BACKFILL_FILE)

    const rows = await allUsers(client)
    expect(rows).toHaveLength(fixtures.length)

    for (const row of rows) {
      expect({
        id: row.id,
        onboarded: row.onboarded_at !== null,
        hasPassword: row.password_hash !== null
      }).toEqual({
        id: row.id,
        onboarded: row.password_hash !== null,
        hasPassword: row.password_hash !== null
      })
    }
  })

  it('leaves both kinds of row present, so the equality is not satisfied by an empty table', async () => {
    // A table with no rows satisfies "for every row" trivially, and a fixture where every row had a
    // password would satisfy it without ever exercising the null side. Both sides have to be there.
    const client = await preMigrationDb()
    await runMigration(client, ADD_COLUMN_FILE)

    await seedUser(client, {
      createdAt: 1_700_000_000,
      email: 'has@example.com',
      id: 'has',
      passwordHash: 'hash'
    })
    await seedUser(client, {
      createdAt: 1_700_000_000,
      email: 'none@example.com',
      id: 'none',
      passwordHash: null
    })

    await runMigration(client, BACKFILL_FILE)

    const rows = await allUsers(client)
    expect(rows.filter((row) => row.onboarded_at !== null)).toHaveLength(1)
    expect(rows.filter((row) => row.onboarded_at === null)).toHaveLength(1)
  })
})
