import enMessages from '~~/i18n/locales/en.json'
import frMessages from '~~/i18n/locales/fr.json'
import { describe, expect, it } from 'vitest'

import { code } from '../../helpers/sourceScan'

// AC23, AC24, AC25 and AC26.3 of docs/specs/admin/onboarding-reset.md: the Reset control on the
// settings page, its confirmation, and its copy.
//
// These are guards over the source rather than renders, and that is a deliberate choice with two
// reasons behind it.
//
// The project's unit-test rules say not to import or render a Vue component here, because that is the
// domain of component and end-to-end tests. And vitest.config.ts sets `environment: 'node'` with no
// DOM library installed, so there is nothing to render into. The repository already answers this the
// same way, in test/app/components/planning/concern-split-guards.test.ts and
// test/app/quota-resolution-guards.test.ts, both of which assert properties of .vue source through
// the shared scanner. This file follows that precedent.
//
// What that means for what can honestly be claimed. A guard can prove the render condition, prove
// which handler each control is bound to, and prove every visible string comes from i18n. It cannot
// prove what a browser paints. The criteria are written so their content is the binding and the
// condition rather than the pixels, so this covers them, and where it cannot reach a criterion's
// literal wording that is said plainly rather than implied.
//
// Every search runs over comment-stripped source through test/helpers/sourceScan.ts. That matters
// more here than usual: the reset section carries long comments discussing the very identifiers these
// searches look for, including the words admin, role and onboarding, so a naive text search would
// report the file as violating rules it is actually documenting.

const SOURCE = code('app/pages/settings.vue')

// A no-break space immediately before a question mark, at the end of a string. Written with an
// explicit \u00A0 escape rather than the literal character, because the literal is invisible in a
// diff and in a terminal and a reviewer cannot tell it from a plain space.
const NBSP_BEFORE_QUESTION = /\u00A0\?$/

// The <section> that holds the reset control, from its opening tag to its matching close. Sections do
// not nest on this page, so the next </section> is the right end.
function resetSection(source: string = SOURCE): string {
  const start = source.indexOf('<section v-if="showReset"')
  expect(start, 'the reset section was not found in settings.vue').toBeGreaterThan(-1)
  const end = source.indexOf('</section>', start)
  expect(end, 'the reset section is not closed').toBeGreaterThan(start)
  return source.slice(start, end + '</section>'.length)
}

// The reset section with the confirmation modal taken out of it. The modal is now declared inside
// the section, so resetSection() contains it and a guard about the section's own controls has to say
// which part it means. This is the part the user sees at rest, which is the heading, the card and the
// Reset button, and it is what AC24 is about: pressing that button opens the confirmation and sends
// nothing.
function resetControlRegion(source: string = SOURCE): string {
  return resetSection(source).replace(confirmationModal(source), '')
}

// Whether the confirmation modal is declared inside the guarded section. This is AC26.3's structural
// half, so it is written once and read both by the guard and by the mutation that proves the guard
// can fail.
function modalIsInsideSection(source: string = SOURCE): boolean {
  const sectionStart = source.indexOf('<section v-if="showReset"')
  const sectionEnd = source.indexOf('</section>', sectionStart)
  const modalStart = source.indexOf('<UModal')
  const modalEnd = source.indexOf('</UModal>', modalStart)

  return modalStart > sectionStart && modalEnd < sectionEnd
}

function confirmationModal(source: string = SOURCE): string {
  const start = source.indexOf('<UModal')
  expect(start, 'the confirmation modal was not found in settings.vue').toBeGreaterThan(-1)
  const end = source.indexOf('</UModal>', start)
  expect(end, 'the confirmation modal is not closed').toBeGreaterThan(start)
  return source.slice(start, end + '</UModal>'.length)
}

// Every opening <section ...> tag on the page, as raw text, so the guard on the three pre-existing
// ones reads their attributes rather than their contents.
function sectionOpeningTags(source: string = SOURCE): string[] {
  return [...source.matchAll(/<section\b[^>]*>/g)].map((match) => match[0])
}

// Every i18n key the page passes to t(), so the copy guard checks the keys actually in use rather
// than a list retyped here that could drift from the template.
function translationKeys(source: string): string[] {
  return [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1] as string)
}

// Flattens a messages object to dotted paths, so two locale files can be compared as key sets.
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
    keyPaths(inner, prefix ? `${prefix}.${key}` : key)
  )
}

// Any text node that is not whitespace and not a mustache, which is copy that would never be
// translated. Attribute values are excluded by construction, because only what sits between > and <
// is read.
function hardcodedTextNodes(markup: string): string[] {
  return [...markup.matchAll(/>([^<]+)</g)]
    .map((match) => (match[1] as string).replace(/\{\{[^}]*\}\}/g, '').trim())
    .filter(Boolean)
}

// A literal label or title attribute is the other way hardcoded copy gets in, and it sits where the
// text-node check cannot see it. A bound one is written :label, so its unbound form is empty.
function literalLabels(markup: string): string[] {
  return [...markup.matchAll(/\s(?:label|title)="([^"]*)"/g)]
    .map((match) => (match[1] as string).trim())
    .filter(Boolean)
}

function resolve(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined
    return (node as Record<string, unknown>)[part]
  }, messages)
}

describe('the instrument, before anything is concluded from an absence', () => {
  // Every guard below concludes from something not being in the source. A scanner that read the wrong
  // file, or that stripped the whole template as a comment, would report the same clean result as one
  // that read it all and found nothing, and only the second is a finding.
  it('reads a settings page with all four sections and the modal in it', () => {
    expect(SOURCE.length).toBeGreaterThan(2000)
    expect(sectionOpeningTags()).toHaveLength(4)
    expect(resetSection()).toContain('settings.reset.heading')
    expect(confirmationModal()).toContain('settings.reset.confirm.title')
  })

  it('can find an identifier it later asserts is absent', () => {
    // The positive control. isAdmin is asserted absent below, so the search is shown finding it in a
    // file that legitimately uses it.
    expect(code('app/middleware/admin.ts')).toContain('isAdmin')
  })
})

describe('AC23 and AC26.3: what decides whether the section renders', () => {
  it('gates the section on the finished server answer alone', () => {
    expect(SOURCE).toContain(
      'const showReset = computed(() => me.value?.canResetOnboarding === true)'
    )
    expect(resetSection()).toContain('v-if="showReset"')
  })

  it('compares with === true, so an absent value reads as false', () => {
    // The anti-flash, and the half of AC26.3 that says the absent case does not render. useMeQuery
    // seeds its initial data from the sealed session cookie, which does not carry this field, so the
    // first paint reads undefined. A truthiness check would be identical here, but `=== true` is what
    // makes "absent" and "false" provably the same answer rather than incidentally the same, so the
    // section can only ever go from absent to present and never present to withdrawn.
    expect(SOURCE).toMatch(/canResetOnboarding === true/)
  })

  it.each(['isAdmin', 'onboardingResetEnabled'])(
    'never names %s, so the page combines no facts of its own',
    (symbol) => {
      // The server folds the role and the switch into one boolean. Re-deriving either here would be a
      // second copy of a rule the server already applied, and the switch in particular is a private
      // config key that must never reach the client bundle.
      expect(SOURCE).not.toContain(symbol)
    }
  )

  it('does not read a role anywhere in the reset section', () => {
    expect(resetSection()).not.toContain('role')
  })

  it('leaves the three existing sections unconditional', () => {
    // AC23's second half: the three existing sections render identically whether or not the fourth is
    // there. They carry no v-if of their own, so nothing about the reset section's presence can reach
    // them. Keyed on the aria-labelledby ids rather than on position, so reordering the page does not
    // silently turn this guard off.
    const tags = sectionOpeningTags()

    for (const id of [
      'settings-work-heading',
      'settings-quotas-heading',
      'settings-security-heading'
    ]) {
      const tag = tags.find((candidate) => candidate.includes(id))
      expect(tag, `no section labelled by ${id}`).toBeDefined()
      expect(tag).not.toContain('v-if')
      expect(tag).not.toContain('v-show')
    }
  })

  it('gates exactly one section, the reset one', () => {
    const conditional = sectionOpeningTags().filter((tag) => tag.includes('v-if'))

    expect(conditional).toHaveLength(1)
    expect(conditional[0]).toContain('showReset')
  })
})

describe('AC26.3: the confirmation cannot be reached while the section is absent', () => {
  // The structural property this file exists to pin down.
  //
  // The <UModal> is declared INSIDE the guarded <section>, so with canResetOnboarding false or absent
  // the component is never built and AC26.3's "no confirmation modal is present in the rendered
  // output" holds by construction. Nesting costs nothing because UModal portals its content out of
  // the flow, so the placement affects no layout either way.
  //
  // It was a sibling when this suite was first written, and then the guarantee rested entirely on the
  // single writer of confirmOpen = true happening to sit inside the unrendered section. That is a
  // property of where one assignment lives rather than of the template, and a second writer added
  // later, a keyboard shortcut or a deep link, would have made the confirmation reachable with the
  // switch off while every other assertion here still passed. The containment guard below is what
  // makes the move stick, and the single-writer guards are kept because two independent reasons for
  // the same guarantee is the point rather than a redundancy.
  it('has exactly one place that opens the confirmation', () => {
    const writers = [...SOURCE.matchAll(/confirmOpen\s*=\s*true/g)]

    expect(writers).toHaveLength(1)
  })

  it('has that single opener inside the guarded section', () => {
    expect(resetSection()).toMatch(/confirmOpen\s*=\s*true/)
  })

  it('binds the modal open state to that same ref and nothing else', () => {
    expect(confirmationModal()).toContain('v-model:open="confirmOpen"')
  })

  it('declares the modal inside the guarded section, so the switch removes it', () => {
    // The containment itself, which is what makes AC26.3 structural rather than argued.
    expect(modalIsInsideSection()).toBe(true)
  })
})

describe('AC24: pressing Reset sends nothing until the confirmation is confirmed', () => {
  it('has the section button only open the modal', () => {
    // The section now contains the modal, whose confirm button legitimately binds onConfirmReset, so
    // this reads the section with the modal removed. That is the region holding the at-rest control,
    // and the mutation must not be reachable from it.
    const region = resetControlRegion()

    expect(region).toMatch(/@click="confirmOpen = true"/)
    expect(region).not.toContain('onConfirmReset')
    expect(region).not.toContain('resetOnboarding')
  })

  it('calls the mutation from exactly one place in the script', () => {
    // A second call site would be a second way to send without confirming.
    expect([...SOURCE.matchAll(/\bawait resetOnboarding\(\)/g)]).toHaveLength(1)
  })

  it('reaches that call only through the confirm handler', () => {
    const handlerStart = SOURCE.indexOf('async function onConfirmReset()')
    const callSite = SOURCE.indexOf('await resetOnboarding()')

    expect(handlerStart).toBeGreaterThan(-1)
    expect(callSite).toBeGreaterThan(handlerStart)
  })

  it('binds the confirm handler only in the modal footer', () => {
    expect(confirmationModal()).toContain('@click="onConfirmReset"')
    expect([...SOURCE.matchAll(/@click="onConfirmReset"/g)]).toHaveLength(1)
  })

  it('makes cancel close the dialog rather than confirm it', () => {
    // Cancelling sends nothing. The cancel control is bound to the modal's own close, so there is no
    // path from it to the mutation.
    const modal = confirmationModal()
    const cancelIndex = modal.indexOf('settings.reset.confirm.cancel')
    const submitIndex = modal.indexOf('settings.reset.confirm.submit')

    expect(cancelIndex).toBeGreaterThan(-1)
    expect(submitIndex).toBeGreaterThan(cancelIndex)
    // The cancel button's own handler, taken from the slice that belongs to it.
    expect(modal.slice(cancelIndex, submitIndex)).toContain('@click="close"')
  })
})

describe('AC25: every visible string resolves from settings.reset.*', () => {
  const sectionAndModal = `${resetSection()}\n${confirmationModal()}`
  const usedKeys = [...new Set(translationKeys(sectionAndModal))]

  it('uses only settings.reset.* keys in the section and the modal', () => {
    expect(usedKeys.length).toBeGreaterThan(0)
    for (const key of usedKeys) {
      expect(key).toMatch(/^settings\.reset\./)
    }
  })

  it.each([
    ['fr', frMessages],
    ['en', enMessages]
  ])('resolves every key it uses in %s', (_locale, messages) => {
    for (const key of usedKeys) {
      expect(typeof resolve(messages, key), `${key} is missing`).toBe('string')
    }
  })

  it('has identical key sets under settings.reset in both locale files', () => {
    const fr = keyPaths((frMessages as Record<string, never>).settings.reset).sort()
    const en = keyPaths((enMessages as Record<string, never>).settings.reset).sort()

    expect(fr).toEqual(en)
    expect(fr.length).toBeGreaterThan(0)
  })

  it('leaves no hardcoded visible text in the section or the modal', () => {
    expect(hardcodedTextNodes(sectionAndModal)).toEqual([])
  })

  it('binds every label and title rather than passing a literal', () => {
    // A literal label attribute is the other way hardcoded copy gets in, and it sits in an attribute
    // where the text-node check above cannot see it.
    for (const attribute of [...sectionAndModal.matchAll(/\s(label|title)="([^"]*)"/g)]) {
      expect(attribute[2], `${attribute[1]} is a literal rather than a bound translation`).toMatch(
        /^\s*$/
      )
    }
  })

  it('puts a no-break space before the question mark in the French confirmation title', () => {
    // The project's French punctuation rule, checked on this feature's own copy. Written as an
    // explicit U+00A0 escape because the character is invisible in a diff and in a terminal, so a
    // plain space would otherwise survive every review.
    const title = resolve(frMessages, 'settings.reset.confirm.title') as string

    // The detector first, so an absence below is a finding rather than a broken instrument. A plain
    // space and a no-break space are indistinguishable in an editor, a terminal and a diff, which is
    // exactly how a plain space has survived review in this repository before.
    expect('paramètres ?').not.toMatch(NBSP_BEFORE_QUESTION)
    expect('paramètres\u00A0?').toMatch(NBSP_BEFORE_QUESTION)

    expect(title).toMatch(NBSP_BEFORE_QUESTION)
  })
})

describe('every guard above is load-bearing, proved against a deliberately broken page', () => {
  // A guard that concludes from an absence has to demonstrate it detects the thing when it is
  // present, or a pass proves only that the search ran. The other stages are editing
  // app/pages/settings.vue while this suite is being written, so the regressions below are applied to
  // a copy of the real source in memory rather than to the file, which proves exactly the same
  // property with no chance of clobbering somebody else's concurrent edit.
  //
  // Each case is a regression a reviewer might genuinely wave through, and each one is a rule from
  // AC23, AC24 or AC26.3 that would otherwise be enforced by nothing but a paragraph in a spec.

  it('catches the render condition loosening to a truthy check (AC26.3)', () => {
    // The absent case is why === true is there. useMeQuery seeds initial data from the session
    // cookie, which does not carry this field, so a truthy check reads undefined on first paint and
    // behaves identically today. It stops being identical the moment the value can be anything but a
    // boolean, and the section would then flash in and be withdrawn.
    const broken = SOURCE.replace(
      'me.value?.canResetOnboarding === true',
      'me.value?.canResetOnboarding'
    )

    expect(SOURCE).toMatch(/canResetOnboarding === true/)
    expect(broken).not.toMatch(/canResetOnboarding === true/)
  })

  it('catches the section losing its guard entirely (AC26.3)', () => {
    const broken = SOURCE.replace('<section v-if="showReset"', '<section')

    expect(sectionOpeningTags(broken).filter((tag) => tag.includes('v-if'))).toHaveLength(0)
    expect(sectionOpeningTags().filter((tag) => tag.includes('v-if'))).toHaveLength(1)
  })

  it('catches a v-if appearing on one of the three existing sections (AC23)', () => {
    // AC23's second half says the three existing sections render identically whether or not the
    // fourth is there. A condition added to one of them breaks that and nothing else would notice.
    const broken = SOURCE.replace(
      '<section aria-labelledby="settings-work-heading"',
      '<section v-if="showReset" aria-labelledby="settings-work-heading"'
    )
    const tag = sectionOpeningTags(broken).find((candidate) =>
      candidate.includes('settings-work-heading')
    )

    expect(tag).toContain('v-if')
  })

  it('catches the page working the answer out for itself (AC23)', () => {
    const broken = SOURCE.replace(
      'const showReset = computed(() => me.value?.canResetOnboarding === true)',
      'const showReset = computed(() => isAdmin(user.value?.role))'
    )

    expect(broken).toContain('isAdmin')
    expect(SOURCE).not.toContain('isAdmin')
  })

  it('catches a second opener for the confirmation outside the section (AC26.3)', () => {
    // This was the fragile one while the UModal was a sibling of the guarded section, when nothing
    // outside the section being able to open it was the only thing keeping the confirmation
    // unreachable with the switch off. The modal is now a child, so containment carries that on its
    // own and a stray second opener can no longer reach a modal that was never built. The guard is
    // kept anyway, because a second writer is still a real defect on the switched-on path, where it
    // would open the confirmation from somewhere the user never pressed Reset.
    const broken = SOURCE.replace(
      'const confirmOpen = ref(false)',
      'const confirmOpen = ref(false)\nonMounted(() => { if (route.query.reset) confirmOpen = true })'
    )

    expect([...broken.matchAll(/confirmOpen\s*=\s*true/g)]).toHaveLength(2)
    expect([...SOURCE.matchAll(/confirmOpen\s*=\s*true/g)]).toHaveLength(1)
  })

  it('catches the modal being lifted back out of the guarded section (AC26.3)', () => {
    // The regression this move exists to prevent, and the one a reviewer would most plausibly wave
    // through, because returning the modal to a sibling position changes nothing a browser paints.
    // The break is built by closing the section immediately before the modal, which is exactly what
    // the sibling arrangement is in source, rather than by matching template text. SOURCE is
    // comment-stripped, so an anchor taken from the placement comment would silently match nothing
    // and the mutation would prove the guard against an unchanged file.
    const modalStart = SOURCE.indexOf('<UModal')
    const broken = `${SOURCE.slice(0, modalStart)}</section>\n${SOURCE.slice(modalStart)}`

    expect(modalStart).toBeGreaterThan(-1)
    expect(broken).not.toBe(SOURCE)
    expect(modalIsInsideSection(broken)).toBe(false)
    expect(modalIsInsideSection()).toBe(true)
  })

  it('catches the first press sending the request (AC24)', () => {
    // The whole content of AC24. A button wired straight to the mutation skips the confirmation
    // entirely and destroys configuration on one click.
    const broken = SOURCE.replace('@click="confirmOpen = true"', '@click="onConfirmReset"')

    expect(resetControlRegion(broken)).toContain('onConfirmReset')
    expect(resetControlRegion()).not.toContain('onConfirmReset')
  })

  it('catches cancel being wired to the confirm handler (AC24)', () => {
    // Cancelling must send nothing. Swapping the two handlers is a plausible copy-paste slip and it
    // turns the safe option into the destructive one.
    const modal = confirmationModal()
    const brokenModal = modal.replace('@click="close"', '@click="onConfirmReset"')
    const cancelIndex = brokenModal.indexOf('settings.reset.confirm.cancel')
    const submitIndex = brokenModal.indexOf('settings.reset.confirm.submit')

    expect(brokenModal.slice(cancelIndex, submitIndex)).not.toContain('@click="close"')
    expect(
      modal.slice(
        modal.indexOf('settings.reset.confirm.cancel'),
        modal.indexOf('settings.reset.confirm.submit')
      )
    ).toContain('@click="close"')
  })

  it('catches hardcoded prose in the modal (AC25)', () => {
    const broken = confirmationModal().replace(
      '<template #description>',
      '<template #description><span>This cannot be undone.</span>'
    )

    expect(hardcodedTextNodes(broken)).toContain('This cannot be undone.')
    expect(hardcodedTextNodes(confirmationModal())).toEqual([])
  })

  it('catches a literal label attribute (AC25)', () => {
    // The form a hardcoded string takes when it hides in an attribute, where the text-node detector
    // cannot see it. The bound form is :label, so dropping one colon is all it takes.
    const broken = resetSection().replace(':label="t(\'settings.reset.submit\')"', 'label="Reset"')

    expect(literalLabels(broken)).toContain('Reset')
    expect(literalLabels(resetSection())).toEqual([])
  })

  it('catches a key that exists in one locale file and not the other (AC25)', () => {
    // The parity failure renders a raw dotted key on screen to a reader of the other language, and it
    // is invisible to anyone testing in only one.
    const fr = keyPaths((frMessages as Record<string, never>).settings.reset)
    const brokenEn = keyPaths((enMessages as Record<string, never>).settings.reset).filter(
      (key) => key !== 'confirm.kept'
    )

    expect(fr.sort()).not.toEqual(brokenEn.sort())
  })
})
