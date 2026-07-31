import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The half of docs/specs/planning/other-category.md that lives in the shape of a component's source
// rather than in any function's return value. UC44 says the move from `trackable` to the new
// `deliverable` flag is per-reader rather than a sweep, and it names the one reader that stays as it
// is. UC14 says the words cell moved. UC26 and the design blueprint say the status control's disabled
// rule moved. UC45 says the save-enabled condition is two conditions rather than one.
//
// None of those four is reachable from a unit test of a pure module, because each is a binding inside a
// Vue component and this repository's Vitest environment is `node` with no DOM, no jsdom and no Nuxt
// runtime, which is deliberate. So they are guarded here as properties of the source, following the
// idiom test/server/api/tasks/write-boundary-guards.test.ts and
// test/app/components/planning/editor-accessibility-guards.test.ts already set.
//
// What these guards prove and what they do not, said plainly rather than left to the file name. They
// prove that the expression a criterion names still reads the flag that criterion requires. They prove
// nothing about what renders, because nothing in this repository can render a component. A test whose
// name overclaims is worse than no test, so each name below says which expression it is reading.
//
// The reason this file exists at all is one specific regression rather than tidiness. `trackable` was
// answering two questions and they are now two functions, so a later reader tidying up will sweep the
// remaining `trackable` reads across to `deliverable` and it will look like a refactor. On the
// exclusion marker it is not, because excluding a row from statistics is a quota question and not a
// status question. That sweep would print `hors stats` on an `Autre` row where the flag is already
// inert, and before this file nothing in the suite caught it.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const TASK_ROW = 'app/components/planning/TaskRow.vue'
const TASK_EDITOR = 'app/components/planning/TaskEditor.vue'

// Source text with comments removed, so a search reads executable code and template markup only. Both
// components discuss the very flags these guards check, at length and in both directions, so prose
// about a decision must never read as the decision.
//
// Three forms are removed, which are the three these files use. A TypeScript block comment, an HTML
// comment in a template, and a line whose first non-space characters are `//`. A trailing `//` comment
// on a line of code is deliberately left in place rather than cut at the first slash, because cutting
// there is what truncates any line carrying a URL and turns a search that never looked into a search
// that found nothing. Every assertion below reads one extracted expression, so a stray word left in a
// trailing comment can only produce a loud failure and never a quiet pass.
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

function sourceOf(relativePath: string): string {
  return withoutComments(readFileSync(join(ROOT, relativePath), 'utf8'))
}

// The one line of executable code matching a pattern, which fails when there is no match and fails
// again when there is more than one. Both failures matter. No match means the expression was renamed
// or removed and the guard is reading nothing, which is the false pass every guard in this file has to
// rule out. More than one means the pattern is ambiguous and the guard might be reading the wrong
// line, which is the same problem wearing a different hat.
function theLineMatching(relativePath: string, pattern: RegExp): string {
  const matches = sourceOf(relativePath)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => pattern.test(line))

  expect(matches, `expected exactly one line matching ${pattern} in ${relativePath}`).toHaveLength(
    1
  )

  return matches[0] as string
}

describe('the instrument these guards depend on', () => {
  // Every assertion in this file concludes from what an extracted line does and does not contain, and
  // a broken extractor reports a clean result whether or not it read anything. So the extractor is
  // shown able to produce both answers before any of its results are trusted.
  it('finds a line that is there', () => {
    expect(theLineMatching(TASK_ROW, /^const showExcluded/)).toContain('computed')
  })

  it('fails rather than passing quietly when nothing matches', () => {
    expect(() => theLineMatching(TASK_ROW, /^const thisDoesNotExist/)).toThrow()
  })

  it('fails rather than guessing when more than one line matches', () => {
    expect(() => theLineMatching(TASK_ROW, /const /)).toThrow()
  })

  // And the comment strip is shown to work in both directions on the real files, since a strip that
  // removed everything would make every negative assertion below pass for the wrong reason.
  it('removes comment prose while leaving the code that follows it', () => {
    const editor = sourceOf(TASK_EDITOR)

    expect(editor).not.toContain('isTrackableCategory')
    expect(editor).toContain('isDeliverableCategory')
  })
})

describe('the exclusion marker stays on the quota question (UC44)', () => {
  // The trap this whole file was written for. `showExcluded` reads `trackable`, and it is the odd one
  // out beside the words cell in the same component, which reads `deliverable`. Exclusion is a quota
  // question and nothing else, so trackability is the flag that answers it.
  it('computes showExcluded from the trackable flag', () => {
    expect(theLineMatching(TASK_ROW, /^const showExcluded/)).toContain('task.trackable')
  })

  // The negative half, which is the assertion that catches the sweep. A mechanical rename of every
  // `trackable` in this component to `deliverable` would leave the marker firing on an `Autre` row,
  // where the category already moves no quota figure, so the row would claim it had been excluded from
  // statistics it was never in.
  it('never computes showExcluded from the deliverable flag', () => {
    expect(theLineMatching(TASK_ROW, /^const showExcluded/)).not.toContain('deliverable')
  })

  // The marker is driven by that one computed rather than by a second copy of the condition in the
  // template, so there is one place to read and one place to change.
  it('renders the marker from showExcluded and not from a second copy of the condition', () => {
    const template = sourceOf(TASK_ROW)

    expect(template).toContain('v-if="showExcluded"')
    expect(template).not.toContain('v-if="task.trackable && task.excludeFromStats"')
  })
})

describe('the words cell moved to the status question (UC14)', () => {
  // The reader that did move, asserted beside the one that did not so the pair is read together. An
  // `Autre` row's word count is a real figure the user typed, so the cell prints it, and the
  // not-applicable reading belongs to the five categories that carry no status.
  it('keys the not-applicable reading on the deliverable flag', () => {
    expect(theLineMatching(TASK_ROW, /v-if="!task\./)).toContain('deliverable')
  })

  it('never keys the not-applicable reading on the trackable flag', () => {
    expect(theLineMatching(TASK_ROW, /v-if="!task\./)).not.toContain('trackable')
  })

  // Both flags are read in this one component, on different questions, which is what makes UC44 a
  // per-reader move rather than a rename. A component holding only one of the two words is a component
  // where the distinction has been lost.
  it('reads both flags in the same component, on different questions', () => {
    const row = sourceOf(TASK_ROW)

    expect(row).toContain('task.trackable')
    expect(row).toContain('task.deliverable')
  })
})

// UC42 puts the separator immediately above the catch-all and nowhere else, and it splits the pinning
// on purpose. What is guarded here is the placement rule and only that, which is that the separator is
// keyed on the contract's own fallback id rather than on a hardcoded index. The render assertion the
// criterion also asks for, covering the aria-hidden and the separator staying out of the item
// collection, is not written here, because it needs the component compiled and rendered and this
// environment has no Nuxt runtime. The keyboard skip stays the named gap the criterion already declares,
// since it cannot be pinned without real key events.
describe('the separator sits above the catch-all by contract rather than by index (UC42)', () => {
  it('keys the separator on the shared fallback id', () => {
    const line = theLineMatching(TASK_EDITOR, /type: 'separator'/)

    expect(line).toContain('DEFAULT_CATEGORY_ID')
  })

  // A hardcoded position would be a second statement of which id the catch-all is, and it would move
  // the line the day an eleventh category is added rather than following the id it belongs above.
  it('never places the separator at a hardcoded index', () => {
    const editor = sourceOf(TASK_EDITOR)

    expect(editor).not.toMatch(/index === 9/)
    expect(editor).not.toMatch(/splice\(9/)
  })
})

describe('the status control reads the status question (UC26, UC38)', () => {
  // The disabled rule moved from trackability to the new flag, and keying it on trackability would
  // disable the status field on the one category the whole feature exists to give a status to.
  it('resolves the pending category through isDeliverableCategory', () => {
    const line = theLineMatching(TASK_EDITOR, /^const deliverable = /)

    expect(line).toContain('isDeliverableCategory')
    expect(line).toContain('state.category')
  })

  // The pending selection decides rather than the row's server-resolved flag, because the selection can
  // differ from the stored category before any save.
  it('reads the pending selection rather than the loaded row flag', () => {
    expect(theLineMatching(TASK_EDITOR, /^const deliverable = /)).not.toContain('props.task')
  })

  it('disables the status control from that one computed', () => {
    expect(sourceOf(TASK_EDITOR)).toContain(':disabled="!deliverable"')
  })

  // The disabled state and the help line move together or not at all. The help text rides
  // aria-describedby, so a control announced as unavailable that then takes a value would invite an
  // action it will not honour, and half of this change would be worse than none of it.
  it('drives the help line from the same computed as the disabled state', () => {
    const line = theLineMatching(TASK_EDITOR, /:help="deliverable/)

    expect(line).toContain('statusUnavailable')
  })

  // The displayed value comes from the pure derivation rather than being held by the control, which is
  // what makes what the field shows the thing that will be stored. displayedStatus and diffEditorState
  // read the same shared function, so the three can never disagree.
  it('derives the displayed status rather than holding it in the control', () => {
    expect(theLineMatching(TASK_EDITOR, /^get: \(\) =>/)).toContain('displayedStatus(state)')
  })

  // The component names neither flag itself, which is UC11 and the prohibition on a second copy of a
  // contract rule. It reads the shared helper for the pending selection, which is the single exception
  // the spec grants, because that selection has not been saved yet.
  it('never asks the quota question anywhere in the editor', () => {
    expect(sourceOf(TASK_EDITOR)).not.toContain('isTrackableCategory')
  })
})

describe('the save-enabled condition is two conditions (UC45)', () => {
  // An edit waits for a change and a draft is saveable from the moment it opens, so the condition
  // cannot be dirtiness alone. Both halves have to be in the expression, and a reader who collapses it
  // to one of them fails here.
  it('asks whether this is a draft as well as whether anything changed', () => {
    const line = theLineMatching(TASK_EDITOR, /^const canSave = /)

    expect(line).toContain('props.task')
    expect(line).toContain('dirty')
  })

  it('is not dirtiness alone', () => {
    expect(theLineMatching(TASK_EDITOR, /^const canSave = /)).not.toBe(
      'const canSave = computed(() => dirty.value)'
    )
  })

  // And dirtiness stays the separate question it is, computed from the same comparison the payload
  // comes from. Making a bare draft report itself dirty is the simplification UC45 rules out, because
  // the page reads this value for the discard confirmation and a mis-clicked add would then cost a
  // prompt for work nobody did.
  it('keeps dirtiness as the honest comparison the page reads for its discard prompt', () => {
    const line = theLineMatching(TASK_EDITOR, /^const dirty = /)

    expect(line).toContain('isEditorDirty(baseline, state)')
    expect(line).not.toContain('props.task')
  })

  // The save control is bound to the split condition rather than to dirtiness, which is the binding
  // that actually delivers UC25. A draft whose save is bound to `dirty` opens disabled.
  it('binds the save control to the split condition rather than to dirtiness', () => {
    const editor = sourceOf(TASK_EDITOR)

    expect(editor).toContain(':disabled="!canSave"')
    expect(editor).not.toContain(':disabled="!dirty"')
  })
})
