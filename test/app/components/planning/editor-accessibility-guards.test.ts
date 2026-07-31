import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The accessibility properties of the inline task editor that live in the shape of the markup rather
// than in any function's return value, so no unit test of a pure module can see them and no
// screenshot can either. docs/specs/planning/task-inline-editor.md hands three of them to the
// accessibility stage by name: AC43 says the success announcement has to be asserted to survive the
// panel being destroyed, AC29 says the region keeps its table semantics with six column headers over
// six cells, and AC52 says the focus fallback has to reject a target sitting inside an `inert`
// subtree. Each guards a change a later reader would make believing it was harmless: moving the live
// region next to the thing it describes, adding a seventh column to one of the two grid declarations,
// or simplifying the focus helper down to a presence check.
//
// This is deliberately a source guard and not a claim about what a screen reader says. The app is
// behind authentication and nothing here can operate it, so what these tests prove is that the
// structure the announcement depends on is still in place. They cannot prove the announcement is
// heard. That distinction is stated rather than blurred, because a test whose name overclaims is
// worse than no test.
//
// Comments are stripped before every search, matching the idiom
// test/server/api/tasks/write-boundary-guards.test.ts already sets: the templates here discuss the
// very classes and attributes these guards forbid, and prose about a fix must not read as the fix.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

// Comments removed, so a search sees executable code and template markup only. All three forms:
// TypeScript block and line comments, and the HTML comments a .vue template uses. Quoted strings are
// copied through untouched so a URL or an apostrophe cannot truncate a line and turn a search that
// never looked into a search that found nothing.
function stripComments(source: string): string {
  let out = ''
  let index = 0

  while (index < source.length) {
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

        if (inner === '\\' && index < source.length) {
          out += source[index]
          index += 1
          continue
        }

        if (inner === char) break
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

const PAGE = 'app/pages/index.vue'
const WEEK = 'app/components/planning/Week.vue'
const DAY_CARD = 'app/components/planning/DayCard.vue'
const TASK_ROW = 'app/components/planning/TaskRow.vue'
const EDITOR = 'app/components/planning/TaskEditor.vue'

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('the comment strip these guards search through', () => {
  // Every guard below concludes from either a presence or an absence in stripped source. A strip that
  // ate too much would make each absence pass for the wrong reason, and the result would be
  // indistinguishable from a real finding.
  it('removes a line comment, a block comment and an HTML comment', () => {
    expect(stripComments('const a = 1 // aria-live\n')).not.toContain('aria-live')
    expect(stripComments('/* aria-live */\nconst a = 1\n')).not.toContain('aria-live')
    expect(stripComments('<template>\n  <!-- aria-live -->\n</template>')).not.toContain(
      'aria-live'
    )
  })

  it('keeps the code either side of a comment', () => {
    const stripped = stripComments('const a = 1 // note\nconst b = 2\n')

    expect(stripped).toContain('const a = 1')
    expect(stripped).toContain('const b = 2')
  })

  it('does not truncate a line at a URL, which is what makes an absence trustworthy', () => {
    const stripped = stripComments(
      "const doc = 'https://example.com/x'\nconst live = 'aria-live'\n"
    )

    expect(stripped).toContain('aria-live')
  })
})

describe('AC43, the success announcement survives the panel being destroyed', () => {
  // AC30 destroys the editor panel on a successful save, so a live region inside it is removed from
  // the document in the same tick as the announcement it was supposed to make. The region therefore
  // lives on the page, outside everything the save tears down. This is the defect class the criterion
  // was rewritten for: it ships broken and passes every visual check.
  const page = code(PAGE)

  it('declares exactly one polite live region, and it is on the page', () => {
    expect(count(page, 'aria-live')).toBe(1)
    expect(page).toContain('aria-live="polite"')
    expect(page).toContain('aria-atomic="true"')
  })

  it('renders that region unconditionally, so it exists before its text changes', () => {
    // A live region has to be in the document before the change for the change to be announced, so a
    // `v-if` on the region itself would reintroduce the silence from a different direction. The
    // element is matched whole and asserted to carry no conditional.
    const region = page.match(/<p[^>]*aria-live[^>]*>/)

    expect(region).not.toBeNull()
    expect(region?.[0]).not.toContain('v-if')
    expect(region?.[0]).not.toContain('v-show')
  })

  it('keeps every component the save unmounts free of a live region', () => {
    // The positive control for the four absences below is the assertion above: the same search finds
    // the region on the page, so an empty result here is a finding rather than a broken pattern.
    for (const file of [WEEK, DAY_CARD, TASK_ROW, EDITOR]) {
      expect(count(code(file), 'aria-live'), `${file} must not hold the live region`).toBe(0)
    }
  })

  it('clears the region before setting it, so two saves in a row announce twice', () => {
    // Assigning the same string twice is not a change and is announced once. The page empties the
    // region, lets that flush, then writes the message.
    const announce = page.slice(page.indexOf('async function announceEditorStatus'))

    expect(announce.slice(0, 200)).toContain("editorStatusMessage.value = ''")
    expect(announce.slice(0, 200)).toContain('await nextTick()')
  })
})

describe('AC29, the hand-rolled table stays valid with a panel row inside it', () => {
  const dayCard = code(DAY_CARD)
  const taskRow = code(TASK_ROW)

  it('prints six column headers over a panel cell that spans six columns', () => {
    // The grid has eight tracks and the accessibility tree has six columns, because the grip and the
    // reserved action track are both role="presentation". aria-colspan counts accessible columns, so
    // the two numbers have to agree or the panel row is wider or narrower than the table it sits in.
    const headers = count(dayCard, 'role="columnheader"')

    expect(headers).toBe(6)
    expect(dayCard).toContain(`aria-colspan="${headers}"`)
  })

  it('puts the panel in a row inside the rowgroup, which is the only legal child there', () => {
    const rowgroup = dayCard.slice(dayCard.indexOf('role="rowgroup"'))
    const panel = rowgroup.slice(rowgroup.indexOf('aria-colspan'))

    expect(rowgroup).toContain('role="rowgroup"')
    // The cell carrying the colspan is a cell, and the element above it in the same block is a row.
    expect(panel).toContain('role="cell"')
    expect(rowgroup.slice(0, rowgroup.indexOf('aria-colspan'))).toContain('role="row"')
  })

  it('keeps the two grid declarations character-for-character identical', () => {
    // AC4. One template is the column header line and the other is the row, and a divergence of one
    // character puts every visible label one track away from the values it labels. The panel row
    // deliberately carries no template of its own, so there must be exactly two in the feature.
    const template = /grid-cols-\[1rem_[^\]]+\]/
    const fromHeader = dayCard.match(template)?.[0]
    const fromRow = taskRow.match(template)?.[0]

    expect(fromHeader).toBeDefined()
    expect(fromRow).toBe(fromHeader)
    expect(count(dayCard, fromHeader as string)).toBe(1)
    expect(count(taskRow, fromRow as string)).toBe(1)
  })

  it('names the scrolling region and keeps it reachable by keyboard', () => {
    // A horizontally scrolling container has to be operable without a pointer (2.1.1), which means a
    // tab stop, and a tab stop with no accessible name announces as an unlabelled group.
    expect(dayCard).toContain('tabindex="0"')
    expect(dayCard).toContain('role="group"')
    expect(dayCard).toContain('aria-labelledby')
  })
})

describe('the disclosure relationship resolves to a real element', () => {
  // Both disclosure controls point aria-controls at the panel id, and for a long time nothing carried
  // that id: the editor built `${panelId}-form` and `${panelId}-heading` from it and used the bare
  // value for neither, so both references dangled. The form element is the panel, so the form carries
  // the id itself.
  it('gives the editor form the panel id as its own id', () => {
    expect(code(EDITOR)).toContain(':id="panelId"')
  })

  it('emits aria-controls only while the panel it names exists', () => {
    // AC30 destroys the panel rather than hiding it, so an unconditional aria-controls declares a
    // relationship to nothing for as long as the row is collapsed. aria-expanded carries the state.
    const row = code(TASK_ROW).match(/:aria-controls="[^"]*"/)?.[0]
    const add = code(DAY_CARD).match(/:aria-controls="draft[^"]*"/)?.[0]

    expect(row).toContain('panelId')
    expect(row).toContain('undefined')
    expect(add).toContain('draftPanelId')
    expect(add).toContain('undefined')
  })
})

describe('AC52 and AC54, focus is never left on the body', () => {
  const page = code(PAGE)

  it('rejects a focus target that sits inside an inert subtree', () => {
    // A save that changes the day can move the row into a collapsed sibling card, and DayCard marks a
    // collapsed panel inert. The button then exists in the document and cannot take focus, so a
    // presence check would silently drop focus to the body. Presence plus reachability is the test.
    expect(page).toContain("closest('[inert]')")
  })

  it('ends every focus candidate list with the day disclosure control', () => {
    // The day card's own control always exists and is never inert, because AC32 makes every card
    // disclosable, so it is the fallback that cannot fail. Every list of candidates has to end there.
    const lists = [...page.matchAll(/focusFirstReachable\(\s*([\s\S]*?)\n\s*\)/g)].map((m) => m[1])

    expect(lists.length).toBeGreaterThan(0)
    for (const list of lists) {
      const ids = [...(list ?? '').matchAll(/`planning-[a-z-]+-\$\{[^}]+\}`/g)].map((m) => m[0])

      expect(ids.length).toBeGreaterThan(0)
      expect(ids.at(-1)).toContain('planning-day-toggle-')
    }
  })
})

describe('the measured contrast floors the editor and the row were corrected to', () => {
  // `text-dimmed` resolves to neutral-400 in light and neutral-500 in dark. Measured against the four
  // card surfaces the panel and the rows sit on, across all five themes, it lands between 2.01:1 and
  // 2.94:1. That fails 1.4.3's 4.5:1 for the notes counter and the required-field placeholder, and it
  // fails 1.4.11's 3:1 for the note marker, which is the only visual carrier of the fact that a row
  // holds a note. The column header line already took this correction for the same reason.
  it('uses no dimmed tone anywhere in the editor', () => {
    // Positive control first: the pattern finds the tone that replaced it in the same file, so an
    // empty result below is an absence rather than a search that could not match.
    expect(code(EDITOR)).toContain('text-toned')
    expect(count(code(EDITOR), 'text-dimmed')).toBe(0)
  })

  it('leaves the dimmed tone on the row only where it is purely decorative', () => {
    const row = code(TASK_ROW)
    const dimmed = [...row.matchAll(/<span[^>]*text-dimmed[^>]*>/g)].map((m) => m[0])

    expect(dimmed).toHaveLength(1)
    // The drag grip. It is out of the accessibility tree and its icon is aria-hidden, so it carries no
    // information and 1.4.11 does not bind it.
    expect(dimmed[0]).toContain('role="presentation"')
  })
})

describe('the two duration pairs are announced as pairs', () => {
  const editor = code(EDITOR)

  it('groups each pair and names the group from the field label', () => {
    // An aria-label on a control wins over the field label, so two number boxes carrying "heures" and
    // "minutes" announce as two unrelated spin buttons with nothing saying which duration they belong
    // to. The group supplies that, and it needs no new copy.
    expect(count(editor, 'role="group"')).toBe(2)
    expect(editor).toContain(':aria-labelledby="estimatedLabelId"')
    expect(editor).toContain(':aria-labelledby="actualLabelId"')
  })

  it('gives every box in a pair its own id', () => {
    // UFormField injects one generated id into every control inside it, so two number inputs in one
    // field otherwise render the same id twice and the field's label binds to whichever consumed the
    // injection last.
    for (const id of [
      '-estimated-hours',
      '-estimated-minutes',
      '-actual-hours',
      '-actual-minutes'
    ]) {
      expect(count(editor, id), `${id} must be bound exactly once`).toBe(1)
    }
  })
})

describe('the required fields say so programmatically', () => {
  // UFormField's `required` prop drives the asterisk on the label and nothing else: it is not carried
  // through to the control, so without this the requirement is visible and not exposed.
  //
  // The day is now the only required field. The category used to be the other one and is not any more:
  // it always holds a value, a draft opens on the shared default and the selector offers no way to
  // clear one, so marking it required would demand something the form has already supplied and cannot
  // lose. UC20 and UC27.
  it('marks the day aria-required, and only the day', () => {
    expect(count(code(EDITOR), 'aria-required="true"')).toBe(1)
  })
})

describe('the closed category control cannot be typed into', () => {
  // A printable keystroke landing on a collapsed select is typeahead, and on this field it would swap
  // one real category for another. Once a category is preselected the swap leaves no trace a user
  // would notice, because the only thing that changes is a hue nobody was watching, where an empty
  // field gaining a value out of nowhere is conspicuous. The guarantee that it cannot happen rests on
  // one fact: the category field is a USelectMenu, which Nuxt UI builds on Reka's Combobox, and
  // Combobox has no typeahead at all. Its search runs through ComboboxInput, which is rendered inside
  // the portalled popover and only when a search input is asked for.
  //
  // Both halves are pinned, because either one alone can rot. A dependency bump could add typeahead to
  // Combobox, and a later reader could swap this field to USelect for tidiness. That second one is the
  // likelier of the two and is the half that lives in our own source.
  //
  // Stated rather than glossed: this does not observe a keystroke. Reka's own trigger cannot even be
  // rendered outside its root, and roving focus needs a real DOM, which this suite deliberately does
  // not have. What it proves is that the binding surface the guarantee depends on has not moved.
  const TYPEAHEAD = /handleTypeaheadSearch|useTypeahead/

  function modulesReferencingTypeahead(relativeDir: string): string[] {
    const dir = join(ROOT, relativeDir)
    const files = readdirSync(dir).filter((name) => name.endsWith('.js'))

    // A path that has moved must fail loudly. An empty directory read as "no typeahead anywhere" is
    // the exact false pass this guard exists to prevent.
    expect(files.length, `${relativeDir} produced no modules to search`).toBeGreaterThan(0)

    return files.filter((name) => TYPEAHEAD.test(readFileSync(join(dir, name), 'utf8')))
  }

  it('finds the typeahead binding where it really is, which is what makes the absence below a finding', () => {
    // The positive control. Reka binds printable-character typeahead on Select's trigger, which is
    // correct and is the ARIA select-only-combobox pattern, so it is the proof that this search works
    // rather than something to remove. If this ever comes back empty the guard below means nothing.
    expect(modulesReferencingTypeahead('node_modules/reka-ui/dist/Select')).toContain(
      'SelectTrigger.js'
    )
  })

  it('leaves no typeahead binding anywhere in Combobox, trigger included', () => {
    expect(modulesReferencingTypeahead('node_modules/reka-ui/dist/Combobox')).toEqual([])
  })

  it('keeps the category field on the Combobox-backed control', () => {
    // The half that lives in our source, and the likelier of the two to rot. USelect is Reka's Select,
    // whose trigger does carry typeahead, so swapping this control would reintroduce the hazard
    // silently while looking like a simplification.
    const editor = code(EDITOR)

    expect(editor).toContain('<USelectMenu')
    expect(editor).toContain('</USelectMenu>')
    // The category is the only place a searchable menu is used, and the status field is the only
    // USelect. If that ever inverts, this fails and the reason is worth re-reading.
    const category = editor.slice(editor.indexOf('name="category"'), editor.indexOf('name="date"'))

    expect(category).toContain('<USelectMenu')
    expect(category).not.toContain('<USelect ')
  })
})
