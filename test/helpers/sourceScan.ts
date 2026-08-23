import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The source scanner the guard tests share. A guard test asserts a property of the source itself
// rather than of any behaviour, so it reads files and searches them, and every one of them concludes
// from an absence. That makes the scanner load-bearing: a search that never saw the code reports the
// same clean result as a search that saw it and found nothing.
//
// It lives here because there is now more than one guard suite. It began as a local function inside
// the task write-boundary guards, and the per-category quota guard needs exactly the same reading and
// stripping. Copying it would have left two implementations to keep in step, and the copy that drifts
// is the one whose absences stop meaning anything, so the extraction is the point rather than tidiness.
// The fixtures that hold this scanner to its behaviour live in
// test/server/api/tasks/write-boundary-guards.test.ts, where they were written, and they now exercise
// this one shared function.

// The repository root, two levels up from test/helpers. Every path a guard passes in is relative to
// it, so the guards read the same way wherever their own file sits.
export const ROOT = fileURLToPath(new URL('../../', import.meta.url))

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
export function stripComments(source: string): string {
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

export function code(relativePath: string): string {
  return stripComments(readFileSync(join(ROOT, relativePath), 'utf8'))
}

// Every source file under a directory, recursively, skipping build output and agent worktrees.
export function sourceFiles(relativeDir: string, extensions: string[]): string[] {
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
