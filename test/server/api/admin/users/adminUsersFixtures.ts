import type { Client } from '@libsql/client'

// Raw-SQL fixtures and readers for the two tables the admin user-management handlers write, kept
// next to the four handler suites that share them.
//
// test/helpers/taskTestDb.ts already ships createTaskTestDb (a real in-memory libSQL database with
// the shipped DDL, including allowed_emails), seedUserAccount, readUserRow, readUserRowByEmail and
// countRows. What it has no equivalent of is an allowlist seed or read, and the four handlers here
// are largely defined by what they do to allowed_emails: invite writes a row, deactivate deletes
// one, reactivate puts one back, and the list is the union of that table with users. Three other
// agents are working in parallel, so rather than change a shared helper these live here, in the
// same raw-SQL style: every fixture is inserted with SQL and every assertion reads SQL, so the
// handler under test is never also what sets up or reports on its own state.
//
// The two timestamp columns touched here (allowed_emails.invited_at, users.created_at,
// users.deactivated_at) are Drizzle `mode: 'timestamp'` columns, which store Unix *seconds*. Every
// helper converts on the way in and leaves the raw integer alone on the way out, so a test can
// assert against the stored representation rather than a re-decoded one.

export function toSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000)
}

// One allowlist row at a chosen invited_at. The column is NOT NULL with a SQL-side unixepoch()
// default, so the date is always passed explicitly here: a fixture that let the default fire would
// make every seeded row share the same second and quietly destroy the ordering the list sorts on.
export async function seedAllowedEmail(
  client: Client,
  email: string,
  invitedAt: Date
): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO allowed_emails (email, invited_at) VALUES (?, ?)',
    args: [email, toSeconds(invitedAt)]
  })
}

// The stored allowlist row for one email, or undefined when the email is not allowed. The absence
// is as load-bearing as the presence: deactivate revokes an invitation by deleting this row, and
// invite must not create one for an already-active or deactivated address.
export async function readAllowedEmailRow(
  client: Client,
  email: string
): Promise<Record<string, unknown> | undefined> {
  const result = await client.execute({
    sql: 'SELECT * FROM allowed_emails WHERE email = ?',
    args: [email]
  })
  const row = result.rows[0]
  return row ? Object.fromEntries(Object.entries(row)) : undefined
}

// Every allowlist row, in a stable order. This is what "no other row was touched" is asserted
// against: a count alone would pass while every remaining row had been rewritten.
export async function readAllowedEmailRows(client: Client): Promise<Record<string, unknown>[]> {
  const result = await client.execute('SELECT * FROM allowed_emails ORDER BY email ASC')
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)))
}

// Every users row, in a stable order, as raw column values. Same purpose as the allowlist reader
// above: every one of these handlers is scoped to a single account, so the bystanders have to be
// comparable field by field and not merely counted.
export async function readAllUserRows(client: Client): Promise<Record<string, unknown>[]> {
  const result = await client.execute('SELECT * FROM users ORDER BY id ASC')
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)))
}

export type ExtraUserSeed = {
  createdAt?: Date | null
  deactivatedAt?: Date | null
  email: string
  firstName?: string | null
  id: string
  lastName?: string | null
  passwordHash?: string | null
  role?: string
}

// A users row beyond the two createTaskTestDb already provides. The list suite needs more distinct
// emails than two to span a page, and the write suites need a bystander account that is neither the
// acting admin nor the target, so "the write landed on the intended user and on no other" has a
// third row to be false about.
export async function seedExtraUser(client: Client, row: ExtraUserSeed): Promise<void> {
  await client.execute({
    sql: `INSERT INTO users
            (id, email, first_name, last_name, password_hash, role, created_at, deactivated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.email,
      row.firstName ?? null,
      row.lastName ?? null,
      row.passwordHash ?? null,
      row.role ?? 'user',
      row.createdAt ? toSeconds(row.createdAt) : null,
      row.deactivatedAt ? toSeconds(row.deactivatedAt) : null
    ]
  })
}

// Removes the two fixture accounts createTaskTestDb inserts, so the "no emails at all" empty-state
// contract can be exercised. It is the one case the shipped harness cannot express, because it
// always seeds two users.
export async function clearUsers(client: Client): Promise<void> {
  await client.execute('DELETE FROM users')
}
