import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The criteria docs/specs/planning/task-write-api.md words as searches rather than as behaviour:
// AC1, AC2, AC17, AC19, AC37, AC41, AC44, AC45 and AC46. Each of them names a property of the
// source itself that no behavioural test can observe, and each guards a change a later implementer
// would make believing it was harmless. Two copies of the overdue expression both behave correctly
// until one of them is edited; a fourth handwritten copy of the status vocabulary behaves correctly
// until someone drops an accent.
//
// docs/specs/planning/row-simplification-words-total.md AC9 adds one more of the same kind, at the
// bottom of this file, and it is the only guard here that searches raw source rather than stripped
// source. AC2 of that spec asks for its string gone from comments as well as code, which is the
// opposite exemption from AC44's.
//
// Comments are stripped before every other search. AC44 exempts prose inside comments explicitly, and
// the handler comments discuss the very values and columns these guards forbid in executable code.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

// Source text with comments removed, so a search sees executable code only. All three forms are
// stripped: block and line comments in TypeScript, and the HTML comments a .vue template uses, since
// the design reasoning in those templates discusses the very status values AC44 forbids in code.
//
// This is a scanner rather than three regexes, and the reason is the failure mode it replaces. The
// line-comment strip used to be /\/\/.*$/gm, which ends a line at the first `//` wherever it sits,
// so any line carrying a URL was truncated at `https:` and everything after it stopped being
// searchable. Every guard in this file concludes from an absence, and a search that never saw the
// code reports the same clean result as a search that saw it and found nothing. That is a false pass
// in a test whose whole job is to prove something is not there.
//
// So the scan walks the text once and only treats `//` or `/*` as a comment when it is not inside a
// quoted string or a template literal. String bodies are copied through untouched, escapes are
// honoured so a `\'` does not close a string early, and a single- or double-quoted string stops at a
// newline so a lone apostrophe in Vue template prose cannot swallow the rest of the file.
//
// What it deliberately does not do, stated rather than smoothed over: it does not recognise a
// regular expression literal, which cannot be told from division without really parsing. A `//`
// inside a regex would still read as a comment start. Nothing scanned here contains one, and the
// case is checked by the fixtures below so the limit is visible rather than assumed away.
function stripComments(source: string): string {
  let out = ''
  let index = 0

  while (index < source.length) {
    // An HTML comment, the form a .vue template uses. Checked first because `<!--` cannot begin any
    // of the other states.
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4)
      index = end === -1 ? source.length : end + 3
      continue
    }

    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      continue
    }

    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }

    const char = source[index] as string

    if (char === '"' || char === "'" || char === '`') {
      out += char
      index += 1

      while (index < source.length) {
        const inner = source[index] as string
        out += inner
        index += 1

        // A backslash consumes whatever follows it, so an escaped quote never closes the literal.
        if (inner === '\\' && index < source.length) {
          out += source[index]
          index += 1
          continue
        }

        if (inner === char) break

        // Only a template literal spans lines. Stopping the other two at the newline keeps an
        // unmatched apostrophe in template prose from being read as an opening quote for the rest of
        // the file, which would leave real comments unstripped far away from the typo.
        if (char !== '`' && inner === '\n') break
      }

      continue
    }

    out += char
    index += 1
  }

  return out
}

function code(relativePath: string): string {
  return stripComments(readFileSync(join(ROOT, relativePath), 'utf8'))
}

// The same file, comments and all. Only the words_done guard at the bottom reads through this, because
// it is the only criterion here that forbids its string in prose as well as in code.
function raw(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

// Every source file under a directory, recursively, skipping build output and agent worktrees.
function sourceFiles(relativeDir: string, extensions: string[]): string[] {
  const skip = new Set(['node_modules', '.nuxt', '.output', '.git', 'worktrees'])
  const found: string[] = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const next = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(next)
      else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(next)
    }
  }

  walk(relativeDir)
  return found
}

const ROUTE_FILES = [
  'server/api/tasks/index.post.ts',
  'server/api/tasks/[id].patch.ts',
  'server/api/tasks/[id].delete.ts'
]

const WRITE_HANDLERS = [
  'server/api/tasks/handlers/create.ts',
  'server/api/tasks/handlers/update.ts',
  'server/api/tasks/handlers/remove.ts'
]

describe('the comment strip every guard below searches through', () => {
  // ---------------------------------------------------------------------------------------------
  // The instrument, tested before anything is concluded with it. Every other case in this file is a
  // negative, and a negative is only worth something if the search could have produced a positive.
  // A strip that quietly eats the tail of a line makes each of them pass for the wrong reason, and
  // the result is indistinguishable from a real finding, so the strip gets its own fixtures rather
  // than being trusted.
  // ---------------------------------------------------------------------------------------------
  it('removes a line comment', () => {
    expect(stripComments('const a = 1 // set a\nconst b = 2\n')).not.toContain('set a')
  })

  it('removes a block comment, including one spanning lines', () => {
    expect(stripComments('const a = 1 /* set\na */\nconst b = 2\n')).not.toContain('set')
  })

  it('removes an HTML comment, the form a .vue template carries', () => {
    expect(stripComments('<template>\n  <!-- why -->\n  <p>x</p>\n</template>')).not.toContain(
      'why'
    )
  })

  it('keeps the code around a comment it removed', () => {
    const stripped = stripComments('const a = 1 // set a\nconst b = 2\n')

    expect(stripped).toContain('const a = 1')
    expect(stripped).toContain('const b = 2')
  })

  // The bug this replaced. A line-anchored regex ends the line at the first `//`, so the rest of a
  // line carrying a URL disappears and a guard searching for what follows finds nothing.
  it('keeps the rest of a line whose string holds a URL', () => {
    const stripped = stripComments("const spec = 'https://example.com/x'\nconst wordsDone = 1\n")

    expect(stripped).toContain("'https://example.com/x'")
    expect(stripped).toContain('wordsDone')
  })

  it('keeps what follows a URL on the same line', () => {
    expect(stripComments("fetch('https://example.com', { body: wordsDone })\n")).toContain(
      'wordsDone'
    )
  })

  it('still removes the comment that trails a line holding a URL', () => {
    const stripped = stripComments("const spec = 'https://example.com' // see wordsDone there\n")

    expect(stripped).toContain('https://example.com')
    expect(stripped).not.toContain('see wordsDone there')
  })

  it('leaves a // that is inside a string, since it is a value and not a comment', () => {
    expect(stripComments('const sep = "//"\nconst after = 1\n')).toContain('"//"')
  })

  it('leaves a // inside a template literal, which spans lines', () => {
    expect(stripComments('const q = `SELECT\n// not a comment\n1`\nconst after = 1\n')).toContain(
      '// not a comment'
    )
  })

  // Asserted on the body of the string rather than on the line after it. Without the escape rule the
  // literal closes at the second quote, the `//` that follows starts a comment, and the tail of the
  // line goes missing while everything below it survives, so a check on the next line would pass
  // through the bug it is meant to catch.
  it('does not let an escaped quote close a string early', () => {
    const stripped = stripComments("const s = 'it\\'s // fine'\nconst after = wordsDone\n")

    expect(stripped).toContain("it\\'s // fine")
    expect(stripped).toContain('after = wordsDone')
  })

  // A lone apostrophe in .vue template prose is not an opening quote, and treating it as one across
  // the whole file would leave real comments unstripped somewhere far below. Stopping at the newline
  // bounds the damage to its own line.
  it('does not let a lone apostrophe in prose swallow the rest of the file', () => {
    const stripped = stripComments("<p>it's here</p>\nconst a = 1 // set a\n")

    expect(stripped).toContain("it's here")
    expect(stripped).not.toContain('set a')
  })

  // The known limit, written as a case so it is visible rather than assumed away. A regex literal
  // cannot be told from division without really parsing, so a bare `//` inside one reads as the
  // start of a comment and everything after it on that line is dropped. A character class is the
  // only place the pair can sit, because anywhere else the first slash would close the literal, so
  // the fixture is `/[//]/` and the code it eats is on the same line.
  //
  // Both halves are asserted, and the survivor on the next line is the reason why. The strip runs to
  // the newline and stops, so anything below comes through no matter what, and a fixture that put
  // the code there would pass while demonstrating nothing. It also rules out the other false pass,
  // where a strip returning nothing at all satisfies the negative on its own.
  //
  // No file this suite scans holds such a regex, so the limit is still theoretical. If one ever
  // lands, this is the case that names what it costs.
  it('reads a bare // inside a regex as a comment start, so the rest of that line is lost', () => {
    const stripped = stripComments('const r = /[//]/; const sameLine = 1\nconst nextLine = 2\n')

    expect(stripped).not.toContain('sameLine')
    expect(stripped).toContain('nextLine')
  })
})

describe('route and handler shape (AC1, AC2, AC3)', () => {
  it.each(ROUTE_FILES)('%s exists and is wrapped in defineAuthenticatedEventHandler', (file) => {
    expect(code(file)).toContain('defineAuthenticatedEventHandler')
  })

  // Thin in the shipped sense: a route validates and delegates, holding no database access, no
  // ownership check, and no business rule.
  it.each(ROUTE_FILES)('%s holds no database access or ownership check', (file) => {
    const source = code(file)

    expect(source).not.toContain('useDb')
    expect(source).not.toContain('drizzle-orm')
    expect(source).not.toContain('requireUserSession')
  })

  it.each([
    ['server/api/tasks/handlers/create.ts', 'createTask'],
    ['server/api/tasks/handlers/update.ts', 'updateTask'],
    ['server/api/tasks/handlers/remove.ts', 'removeTask']
  ])('%s exports %s', (file, exported) => {
    expect(code(file)).toContain(`export async function ${exported}`)
  })

  // delete cannot be an identifier in JavaScript, so the file is remove.ts and the pair stays
  // aligned the way list.ts and listTasks are.
  it('names the delete handler file after its exported function', () => {
    const files = sourceFiles('server/api/tasks/handlers', ['.ts'])

    expect(files).toContain('server/api/tasks/handlers/remove.ts')
    expect(files).not.toContain('server/api/tasks/handlers/delete.ts')
  })
})

describe('the estimate never writes the actual (AC17)', () => {
  // ---------------------------------------------------------------------------------------------
  // The behavioural guards live in create.test.ts and update.test.ts. This one is the structural
  // half of AC17: "No code path in create.ts or update.ts reads estimatedMinutes in order to write
  // actualMinutes." A behavioural test proves the auto-fill is absent today; this proves there is no
  // line where the two could be joined, which is what makes reintroducing it visible in review.
  //
  // The guard sits on reading the estimate rather than on the word actualMinutes. Banning
  // actualMinutes outright was broader than AC17 says and would refuse a rule that only ever touches
  // the actual, a future check that a finished task carries a measured duration for instance, under
  // a test named for a criterion with nothing to say about it. A handler that never names
  // estimatedMinutes cannot derive the actual from it, and that is AC17's antecedent word for word.
  //
  // What the narrower rule gives up, stated rather than smoothed over. A helper in some other file
  // could fill actualMinutes from the estimate and be called from here without either handler ever
  // naming the estimate. The line check below catches the version of that whose name says estimate,
  // and the rest is caught behaviourally by create.test.ts and update.test.ts, which read
  // actual_minutes back out of the database rather than off the response.
  // ---------------------------------------------------------------------------------------------
  it.each(['server/api/tasks/handlers/create.ts', 'server/api/tasks/handlers/update.ts'])(
    '%s reads no estimate it could fill the actual from',
    (file) => {
      // Positive control first. write.ts carries both identifiers in executable code, so if the
      // stripped source cannot show them there, a clean result below is a broken search rather than
      // a finding.
      const control = code('server/api/tasks/handlers/write.ts')

      expect(control).toContain('estimatedMinutes')
      expect(control).toContain('actualMinutes')

      const source = code(file)

      expect(source).not.toContain('estimatedMinutes')

      // Nothing writes the actual from something merely named after the estimate, which is the shape
      // the ban above cannot see on its own.
      const joined = source
        .split('\n')
        .filter((line) => line.includes('actualMinutes') && /estimat/i.test(line))

      expect(joined).toEqual([])
    }
  )

  it('never reads estimatedMinutes and writes actualMinutes on one line of the shared mapper', () => {
    const lines = code('server/api/tasks/handlers/write.ts').split('\n')

    // Positive control first. A negative from a scanner that cannot see the thing it is looking for
    // is indistinguishable from a clean result, so prove both names are visible in the stripped
    // source before concluding that no line joins them.
    expect(lines.filter((line) => line.includes('actualMinutes')).length).toBeGreaterThan(0)
    expect(lines.filter((line) => line.includes('estimatedMinutes')).length).toBeGreaterThan(0)

    const joined = lines.filter(
      (line) => line.includes('actualMinutes') && line.includes('estimatedMinutes')
    )

    expect(joined).toEqual([])
  })
})

// -------------------------------------------------------------------------------------------------
// The three guards that used to sit here, under `words_done is never written (AC30)`, are gone.
//
// They stopped a mirror into a column, and PLAN-33 dropped the column, so there is nothing left to
// mirror into. They were not repointed at project_word_count, because that column is supposed to be
// written and a guard asserting the opposite of what it used to assert under the same name is worse
// than no guard. Their coverage moved to the repo-wide assertion at the bottom of this file, which is
// strictly stronger, because it fails on a reintroduction anywhere in the source rather than only in
// the three write handlers. Ruled on in docs/specs/planning/row-simplification-words-total.md under "The
// test surface, and what becomes of a guard whose subject is gone".
//
// The sibling block above, on actualMinutes and estimatedMinutes, is a different column pair, is
// still live, and stays exactly as it was.
// -------------------------------------------------------------------------------------------------

describe('the write path derives no estimate (AC19)', () => {
  // The derivation needs a per-category quota that does not exist yet, so the only quota available
  // is the global settings.quota_wph, whose default the overview already records as wrong. A search
  // for quotaWph under server/api/tasks/ must find nothing but the per-task override passthrough.
  it('reads no quota anywhere under server/api/tasks beyond quotaWphOverride', () => {
    for (const file of sourceFiles('server/api/tasks', ['.ts'])) {
      expect(code(file).replaceAll('quotaWphOverride', '')).not.toContain('quotaWph')
    }
  })

  it.each(WRITE_HANDLERS)('%s does not import loadWorkSettings for a quota', (file) => {
    expect(code(file)).not.toContain('loadWorkSettings')
  })
})

describe('the overdue expression exists in exactly one place (AC41)', () => {
  // Producing the response shape means resolving the overdue comparison, and two copies of it would
  // drift. The extraction is only worth anything if it stays the single copy.
  //
  // The match is anchored on the SQL keyword pair rather than on the bare word CASE. Searching for
  // CASE alone fails this test on any unrelated identifier or message that happens to contain those
  // four uppercase letters, UPPERCASE and BASE64 among them, and a guard named for the overdue
  // expression should not go red over a word. \s+ rather than a space, because the expression is
  // written across lines and CASE and WHEN are not adjacent in the source.
  const CASE_WHEN = /\bCASE\s+WHEN\b/

  it('finds one CASE WHEN expression under server/', () => {
    const withCase = sourceFiles('server', ['.ts']).filter((file) => CASE_WHEN.test(code(file)))

    // The positive control is the assertion itself. One match proves the search can see the
    // expression, so an empty result would be a broken search rather than a finding.
    expect(withCase).toEqual(['server/api/tasks/handlers/projection.ts'])
  })

  // The narrowing is only safe if it did not also stop matching what it is meant to catch. A second
  // copy written on one line, the shape a later hand would most likely reach for, is still found.
  it('would still catch a second copy written on a single line', () => {
    expect(CASE_WHEN.test('sql`CASE WHEN a THEN 1 ELSE 0 END`')).toBe(true)
    expect(CASE_WHEN.test('const UPPERCASE_LABEL = 1')).toBe(false)
  })

  it('is consumed by list.ts, create.ts, and update.ts rather than reimplemented', () => {
    expect(code('server/api/tasks/handlers/list.ts')).toContain('taskSelection')
    expect(code('server/api/tasks/handlers/create.ts')).toContain('readTaskForUser')
    expect(code('server/api/tasks/handlers/update.ts')).toContain('readTaskForUser')
  })
})

describe('the stored status vocabulary has one copy (AC44, AC45)', () => {
  // ---------------------------------------------------------------------------------------------
  // The accents are load-bearing. The overdue expression compares the finished value as a literal
  // string, so a row storing a de-accented spelling would read as late forever with nothing on
  // screen to explain why. The seed is inside this scope on purpose: it is the one copy of the
  // vocabulary that writes these values into the database.
  //
  // Comments, the i18n locale files (display copy keyed by StatusKey, a different vocabulary), and
  // test fixtures are exempt and are not scanned.
  // ---------------------------------------------------------------------------------------------
  const SCANNED = [
    ...sourceFiles('app', ['.ts', '.vue']),
    ...sourceFiles('server', ['.ts']),
    ...sourceFiles('shared', ['.ts']),
    ...sourceFiles('scripts', ['.ts'])
  ]

  it.each(['Accepté', 'En cours', 'Terminé'])(
    'leaves %s in executable code only where the shared tuple declares it',
    (status) => {
      const carriers = SCANNED.filter((file) => code(file).includes(status))

      expect(carriers).toEqual(['shared/planning.ts'])
    }
  )

  it('declares the three values in cycle order in the shared tuple', () => {
    const source = code('shared/planning.ts')

    expect(source).toContain("export const TASK_STATUSES = ['Accepté', 'En cours', 'Terminé']")
  })

  // Either export of the shared declaration counts, because both are the same single source. The
  // projection reads TASK_STATUS_DONE rather than the tuple: it needs one specific value, and an
  // index into a cycle order is a position rather than a name for it, so picking it out by index in
  // a server file meant a reorder would silently rebind the late comparison. Asking for the tuple by
  // name here would have pushed that back the other way, so the guard asks what it actually means,
  // which is that the file takes its status values from shared/planning.ts and never writes one out.
  it.each([
    'shared/planning.ts',
    'server/api/tasks/handlers/projection.ts',
    'server/models/tasks.ts',
    'scripts/seed.ts'
  ])('%s derives its status values from the shared vocabulary', (file) => {
    expect(code(file)).toMatch(/\bTASK_STATUS(ES|_DONE)\b/)
  })

  // Validating a write against the locale file would break the moment a display string is reworded
  // and would make the server depend on i18n.
  it.each([...ROUTE_FILES, ...WRITE_HANDLERS, 'server/models/tasks.ts'])(
    '%s imports nothing from i18n',
    (file) => {
      expect(code(file)).not.toMatch(/from\s+['"][^'"]*i18n/)
    }
  )
})

describe('what grows in shared, and what does not (AC46)', () => {
  it('keeps the three request schemas in server/models/tasks.ts', () => {
    const source = code('server/models/tasks.ts')

    for (const exported of ['TaskCreateSchema', 'TaskUpdateSchema', 'TaskIdParamSchema']) {
      expect(source).toContain(`export const ${exported}`)
    }
  })

  // A request schema is a server boundary concern and the client has no business parsing one.
  it('adds no request schema under shared/', () => {
    for (const file of sourceFiles('shared', ['.ts'])) {
      const source = code(file)
      expect(source).not.toContain('TaskCreateSchema')
      expect(source).not.toContain('TaskUpdateSchema')
      expect(source).not.toContain('TaskIdParamSchema')
    }
  })
})

describe('no schema change and no migration (AC37)', () => {
  // Soft delete was not available, because adding a deleted_at column is a schema change this
  // feature may not make, and it would silently change every existing read path.
  it('adds no deleted_at column to the tasks table', () => {
    const source = code('server/db/schema.ts')

    expect(source).not.toContain('deleted_at')
    expect(source).not.toContain('deletedAt')
  })

  // The migrations already on disk when the write path was built. AC37 claims only that *this*
  // feature adds none of its own, so the guard is written against that and nothing wider.
  //
  // It is deliberately not pinned to the globally latest filename. Asserting `migrations.at(-1)` is
  // `'0007_drop_tasks_instructions.sql'` claims no feature ever adds another migration, which AC37
  // never said, and it was scheduled to fire. PLAN-33 is specced to drop words_done with a real
  // migration, so the next feature to land would have broken a PLAN-09 test over a change this
  // criterion has no opinion about. Recording the prefix instead lets a later migration land while
  // still failing if this feature's own history is rewritten or the rejected schema change appears.
  const MIGRATIONS_BEFORE_THIS_FEATURE = [
    '0000_persist_user_preferences.sql',
    '0001_remap_theme_ids.sql',
    '0002_add_settings_timezone.sql',
    '0003_add_allowed_emails_invited_at.sql',
    '0004_add_tasks_table.sql',
    '0005_add_work_schedule_table.sql',
    '0006_add_tasks_exclude_from_stats.sql',
    '0007_drop_tasks_instructions.sql'
  ]

  it('writes no migration of its own', () => {
    const directory = join(ROOT, 'server/db/migrations')
    const migrations = readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()

    // Positive control. An unreadable or renamed directory yields an empty list, and an empty list
    // would satisfy the soft-delete search below while proving nothing at all.
    expect(migrations.length).toBeGreaterThanOrEqual(MIGRATIONS_BEFORE_THIS_FEATURE.length)

    // The eight that predate the write path, still there and still first. This feature contributed
    // none, so anything sorting after them was written by a later one.
    expect(migrations.slice(0, MIGRATIONS_BEFORE_THIS_FEATURE.length)).toEqual(
      MIGRATIONS_BEFORE_THIS_FEATURE
    )

    // And no migration, whenever it was written, carries the soft delete AC37 turned down. This is
    // the half that still bites if a later hand reaches for that schema change from in here.
    const softDelete = migrations.filter((name) =>
      readFileSync(join(directory, name), 'utf8').includes('deleted_at')
    )

    expect(softDelete).toEqual([])
  })
})

describe('words_done is gone from the whole source, not only from the write path (AC2, AC9)', () => {
  // -------------------------------------------------------------------------------------------------
  // The guard that replaces the four deleted assertions, and it covers more than they did. They only
  // watched the three write handlers and the shared mapper. This watches every source directory, so a
  // column reintroduced in the schema, selected in the projection, typed onto the shared contract, or
  // printed by a component fails here rather than passing unnoticed.
  //
  // Two things about the scope are deliberate rather than incidental.
  //
  // It reads raw source rather than stripped source, which is the reverse of every other guard in this
  // file. AC2 asks for the string gone "in executable code and in comments alike", and the reason is
  // AC7's. A comment that outlives its column is worse than no comment, because it is the sentence a
  // later implementer trusts. schema.ts carried "wordsDone is the quota numerator" right up to this
  // feature, and that sentence became false the moment the migration landed.
  //
  // server/db/migrations/ is excluded, and permanently. 0004's historical DDL declares the column and
  // 0008 names it in its own DROP COLUMN statement and header, and neither may be edited, because
  // rewriting an applied migration would make the ledger describe a file that never ran. It is written as
  // a path filter rather than left to rest on the extension list, so it still holds if a .ts ever lands
  // in that directory.
  //
  // Agent worktrees under .claude/ are out of scope too. They hold whole stale copies of the repo at
  // older commits, including this column, and they are nobody's source of truth. Nothing here reaches
  // them, because the walk starts at each named source directory and sourceFiles skips worktrees.
  // -------------------------------------------------------------------------------------------------
  const NEEDLES = ['words_done', 'wordsDone']

  const SCANNED = [
    ...sourceFiles('app', ['.ts', '.vue']),
    ...sourceFiles('server', ['.ts']),
    ...sourceFiles('shared', ['.ts']),
    ...sourceFiles('scripts', ['.ts']),
    ...sourceFiles('i18n', ['.json', '.ts'])
  ].filter((file) => !file.includes('/migrations/'))

  function carriers(needle: string): string[] {
    return SCANNED.filter((file) => raw(file).includes(needle))
  }

  // ---------------------------------------------------------------------------------------------
  // The instrument, proven before anything is concluded from its silence. A guard that passes
  // because its glob matched nothing, or because its needle can never match, is worse than no guard
  // at all, and it reads exactly like a clean result.
  // ---------------------------------------------------------------------------------------------
  it('scans a real and substantial set of source files', () => {
    expect(SCANNED.length).toBeGreaterThan(20)

    // A words column is genuinely present in this scope, so the scan is looking at the files that
    // would carry the dropped one if it came back.
    expect(carriers('projectWordCount').length).toBeGreaterThan(0)
  })

  it.each(NEEDLES)('would still recognise %s if it were written back', (needle) => {
    // The matcher, against the exact declaration this feature removed from schema.ts.
    expect(`wordsDone: integer('words_done')`.includes(needle)).toBe(true)
  })

  it('finds words_done in the historical migration, which is why migrations are excluded', () => {
    // Real file, read through the same reader, carrying the real string. An empty result from the scan
    // below is therefore a finding rather than a broken read.
    expect(raw('server/db/migrations/0004_add_tasks_table.sql')).toContain('words_done')
    expect(raw('server/db/migrations/0008_drop_tasks_words_done.sql')).toContain('words_done')
  })

  it.each(NEEDLES)('no file under app, server, shared, scripts or i18n mentions %s', (needle) => {
    expect(carriers(needle)).toEqual([])
  })
})
