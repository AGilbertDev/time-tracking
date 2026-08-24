import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { code, ROOT, sourceFiles, stripComments } from '../helpers/sourceScan'

// AC10 of docs/specs/planning/per-category-quotas.md, the half no behavioural test can observe.
//
//   "Nothing in app/ computes a quota. Verifiable in the same style as the shipped write-boundary
//   guard, by asserting that no file under app/ resolves a quota from a category id or from a stored
//   row. The client receives resolved figures and renders them."
//
// The property holds today, so this file guards it rather than fixing anything. That is the whole
// reason it is worth writing: the resolver is a plain exported function, an import of it from a
// component would work perfectly, and a later feature wanting a quota on screen would reach for it
// without ever reading AC6. What stops that is a test that goes red, not a paragraph in a spec.
//
// The rule this enforces is the project's logic-belongs-to-the-backend rule applied to one number.
// The server resolves and the client is handed finished figures, which is also why AC6 has the API
// send `source` alongside the figure. A page comparing a figure against a hardcoded default to decide
// what to label it would be a second copy of the resolution rule, and the second copy is the one that
// goes stale.
//
// The snapshot model strengthens this rather than threatening it. The figure a client sees on a task
// is now a stored column written by the server, so there is nothing left it could have been tempted to
// work out for itself.
//
// The searches run over comment-stripped source, through the shared scanner in
// test/helpers/sourceScan.ts. That matters more here than it looks: three shipped files under app/
// name isTrackableCategory in prose, explaining that they deliberately read the other flag, so a
// naive text search would report them as violations of a rule they are actually documenting.

// Everything under app/, both the TypeScript and the single-file components.
const APP_FILES = sourceFiles('app', ['.ts', '.vue'])

// The symbols that resolve a quota, or reach the rows one is resolved from. Each is either the
// resolution itself or a step of it, and none has any business running on the client.
//
// isTrackableCategory is in the list for the reason AC6 gives. Non-trackable categories are absent
// from the response rather than present with a null quota, "which means the client renders what it is
// handed instead of filtering on trackable itself". Deciding from a category id whether it has a quota
// is resolving a quota, whatever else it looks like. The contract is explicit that anything reaching a
// quota reads trackable and anything about a status or a word count reads deliverable, so a component
// wanting the second one is already served, and three of them say so in their own comments.
const FORBIDDEN_SYMBOLS = [
  'resolveCategoryQuota',
  'resolveTaskQuota',
  'defaultQuotaWph',
  'loadCategoryQuotas',
  'loadResolvedCategoryQuotas',
  'categoryQuotas',
  'category_quotas',
  'isTrackableCategory'
]

describe('the instrument, before anything is concluded from an absence', () => {
  // A guard that reports nothing because it read nothing is indistinguishable from a guard that read
  // everything and found nothing, and only the second one is a finding. So the scan proves it can
  // produce a positive first.
  it('collects both the components and the TypeScript under app/', () => {
    expect(APP_FILES.length).toBeGreaterThan(0)
    expect(APP_FILES.some((file) => file.endsWith('.vue'))).toBe(true)
    expect(APP_FILES.some((file) => file.endsWith('.ts'))).toBe(true)
  })

  // The positive control. quotaWph is the field name the API sends and the client renders, so it is
  // present in executable code under app/ on purpose and it is not forbidden. Finding it proves the
  // scan reaches quota-related code rather than reading empty strings.
  it('can see the quota field the client legitimately renders', () => {
    const carriers = APP_FILES.filter((file) => code(file).includes('quotaWph'))

    expect(carriers.length).toBeGreaterThan(0)
  })

  // The false positive this guard would otherwise produce, demonstrated on the shipped files rather
  // than on a fixture. At least one file under app/ names a forbidden symbol in its prose, and the
  // strip is what makes the absence below true. If this case ever finds no such file it is not a
  // failure of the app, so it asserts the pair only when the raw text really does carry one.
  it('reads a symbol named in a comment as absent from the code', () => {
    const raw = (file: string) => readFileSync(join(ROOT, file), 'utf8')
    const inProse = APP_FILES.filter((file) => raw(file).includes('isTrackableCategory'))

    expect(inProse.length).toBeGreaterThan(0)
    for (const file of inProse) {
      expect(code(file)).not.toContain('isTrackableCategory')
    }
  })

  // And the strip does not swallow the thing it is meant to catch. A fixture rather than a shipped
  // file, because there is deliberately no violation in the tree to point at.
  it('still catches a symbol that appears in code next to one in a comment', () => {
    const source = [
      '// resolveCategoryQuota belongs on the server, so this file only mentions it.',
      'const quota = resolveCategoryQuota(id, rows, date)',
      '/* resolveTaskQuota is discussed here too. */'
    ].join('\n')

    expect(stripComments(source)).toContain('const quota = resolveCategoryQuota(')
    expect(stripComments(source).match(/resolveCategoryQuota/g)).toHaveLength(1)
    expect(stripComments(source)).not.toContain('resolveTaskQuota')
  })
})

describe('nothing under app/ computes a quota (AC10)', () => {
  it.each(FORBIDDEN_SYMBOLS)('names %s in no executable line under app/', (symbol) => {
    expect(APP_FILES.filter((file) => code(file).includes(symbol))).toEqual([])
  })

  // The same property stated once over the whole set, so a failure names every offender at once
  // rather than one per case. The message is the file list, which is what a later reader needs.
  it('carries none of the resolution symbols anywhere under app/', () => {
    const offenders = APP_FILES.flatMap((file) => {
      const source = code(file)
      return FORBIDDEN_SYMBOLS.filter((symbol) => source.includes(symbol)).map(
        (symbol) => `${file} names ${symbol}`
      )
    })

    expect(offenders).toEqual([])
  })

  // The resolver lives under server/utils rather than in shared/ on purpose, and the spec says why:
  // a pure resolver in shared/ is "an open invitation" to resolve on the client, the way the dashboard
  // resolves the schedule from shared/planning.ts. That choice only holds while nothing under app/
  // imports from server/, so the import boundary is guarded as well as the symbols.
  it('imports nothing from server/ into the client', () => {
    const importers = APP_FILES.filter((file) => /from\s+['"][^'"]*server\//.test(code(file)))

    expect(importers).toEqual([])
  })
})
