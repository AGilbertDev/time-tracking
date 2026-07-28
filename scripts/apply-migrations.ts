import { createClient } from '@libsql/client'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Applies the hand-authored SQL in server/db/migrations, in filename order, to whatever database
// .env points at, and records what it applied so a second run is a no-op.
//
//   bun run apply-migrations                # dry run, shows the target and what is pending
//   bun run apply-migrations --yes          # apply the pending ones
//   bun run apply-migrations --baseline     # record every file as applied without running it
//
// Why this exists rather than drizzle's own tooling. `drizzle-kit push` diffs the schema and asks,
// interactively, whether a dropped column plus an added column is really a rename. It has no TTY in
// this container, and the wrong answer would carry a dropped column's data into the new one.
// `drizzle-kit migrate` wants a meta snapshot this project deliberately does not keep, because the
// migrations are written by hand rather than generated.
//
// Why there is a ledger. The first draft of this script trusted the "re-applying is harmless" note
// in the migration headers and skipped statements whose error looked like an already-applied one.
// That is not sound. 0000 is a data migration: statement 2 backfills settings.locale by reading
// users.locale, and statement 3 drops users.locale. Replaying it does not fail benignly, it fails
// with `no such column: users.locale`, and no error-string rule can tell that apart from a genuinely
// broken migration without guessing. So the script records what ran instead of inferring it.
//
// Databases migrated by hand before this script existed have no ledger. The script refuses to guess
// for them, because assuming "already applied" would skip real work and assuming "pending" would
// replay 0000. Run --baseline once on such a database, after confirming its schema matches, and it
// records the current files as applied without executing them.
//
// It writes to whatever .env points at, so aiming it at production is a deliberate choice and the
// operator's responsibility. Nothing in the pipeline runs this.

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'server', 'db', 'migrations')

// The ledger. Leading underscore to keep it out of the way of the application tables, and the name
// is the primary key so recording the same migration twice is impossible.
const LEDGER = '_applied_migrations'

// A chunk that is only comments is not a statement. The files carry long header comment blocks, and
// sending one to the database is a syntax error rather than a no-op.
function isExecutable(chunk: string): boolean {
  return chunk.length > 0 && !chunk.split('\n').every((line) => line.trim().startsWith('--'))
}

const url = process.env.NUXT_TURSO_URL
if (!url) throw new Error('NUXT_TURSO_URL is not set.')

const client = createClient({ url, authToken: process.env.NUXT_TURSO_AUTH_TOKEN })

// The host, without the credentials, so the operator sees which database is about to be written.
// Printing the whole URL would put the auth token in a terminal and in shell history, which the
// project's security rule forbids.
const host = (() => {
  try {
    return new URL(url).host
  } catch {
    return '(unparseable NUXT_TURSO_URL)'
  }
})()

const apply = process.argv.includes('--yes')
const baseline = process.argv.includes('--baseline')

const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
if (files.length === 0) throw new Error(`No .sql files found in ${MIGRATIONS_DIR}.`)

await client.execute(
  `CREATE TABLE IF NOT EXISTS ${LEDGER} (name text PRIMARY KEY, applied_at integer NOT NULL)`
)

const recorded = new Set(
  (await client.execute(`SELECT name FROM ${LEDGER}`)).rows.map((row) => String(row.name))
)
const pending = files.filter((file) => !recorded.has(file))

console.warn(`Target database: ${host}`)
console.warn(`${files.length} migration files, ${recorded.size} already recorded.\n`)

if (baseline) {
  for (const file of pending) {
    await client.execute({
      sql: `INSERT INTO ${LEDGER} (name, applied_at) VALUES (?, ?)`,
      args: [file, Math.floor(Date.now() / 1000)]
    })
    console.log(`baselined  ${file}`)
  }
  console.log(`\nRecorded ${pending.length} files as applied. Nothing was executed.`)
  process.exit(0)
}

if (pending.length === 0) {
  console.log('Nothing pending. The database is up to date.')
  process.exit(0)
}

// An empty ledger on a database that already has application tables means it was migrated by hand.
// Applying the pending list there would replay 0000, so stop and make the operator choose.
if (recorded.size === 0) {
  const existing = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`
  )
  if (existing.rows.length > 0) {
    console.warn(
      `This database has application tables but no migration ledger, so it was migrated by\n` +
        `hand before this script existed. Applying the pending list would replay migrations that\n` +
        `are not replayable.\n\n` +
        `Confirm its schema is current, then record the existing files without running them:\n\n` +
        `  bun run apply-migrations --baseline\n`
    )
    process.exit(1)
  }
}

if (!apply) {
  console.warn(pending.map((file) => `pending  ${file}`).join('\n'))
  console.warn(
    `\nDry run. Nothing was executed. These migrations include an irreversible DROP COLUMN.\n` +
      `Confirm the target above is the database you intend, then re-run with:\n\n` +
      `  bun run apply-migrations --yes\n`
  )
  process.exit(0)
}

for (const file of pending) {
  const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')

  // Split on the drizzle-kit marker the files are authored with, so each statement is its own round
  // trip and a failure names the statement rather than the whole file.
  const statements = sql
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter(isExecutable)

  for (const statement of statements) {
    try {
      await client.execute(statement)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // No error is tolerated. The ledger already answered "has this run", so anything failing here
      // is a real problem, and swallowing it would leave the schema half-migrated and unrecorded.
      throw new Error(
        `${file} failed and was NOT recorded. Statements before this one in the same file did ` +
          `run, so fix the cause and re-run rather than baselining.\n\n${statement}\n\n${message}`
      )
    }
  }

  await client.execute({
    sql: `INSERT INTO ${LEDGER} (name, applied_at) VALUES (?, ?)`,
    args: [file, Math.floor(Date.now() / 1000)]
  })
  console.log(`applied  ${file}`)
}

console.log(`\nDone. ${pending.length} applied.`)
