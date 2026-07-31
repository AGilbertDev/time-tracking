// Detecting a click outside the open task editor, and getting the teleported case right, which is
// the whole reason this is a named composable instead of three lines in the component.
//
// The editor holds a USelectMenu, a USelect and a UModal. All three render their content through a
// Reka UI portal, so the category popover, the status popover and the discard confirmation are
// children of <body> rather than descendants of the form. A plain document listener therefore reads
// "the user picked a category" as "the user clicked outside the form", and raises a false
// unsaved-changes warning in the middle of an ordinary interaction. That is a data-loss-shaped defect
// rather than a cosmetic one: the warning is the signal the user is meant to trust, and one that cries
// wolf on every category pick teaches them to ignore the real one.
//
// So a click counts as inside when it lands in the form, in any portalled layer, or on one of the
// controls that runs the dirty check itself. Each of those is recognised by a marker the framework
// already stamps, so nothing here guesses at a class name.
//
// The framework's own mechanism for this is VueUse's onClickOutside and its `ignore` option, and that
// is what this would be built on. @vueuse/core is only present as a transitive dependency of
// @nuxt/ui, and adding it as a direct dependency needs an install, which this stage is not allowed to
// run. The listener below is deliberately the same shape onClickOutside uses (one capturing
// pointerdown on the document, the ignore test evaluated while the layer is still in the DOM) so
// swapping it for the library call is a small, local change once the dependency is declared.

// Every marker that says "this element belongs to a layer the framework portalled out of the page".
// data-reka-popper-content-wrapper is the positioned wrapper every Reka popper content sits in, which
// covers both selects; data-dismissable-layer is on the modal's content and on the popovers; and
// data-slot="overlay" is Nuxt UI's modal backdrop, which is a sibling of the content rather than a
// descendant of it, so dismissing the confirmation by clicking the backdrop is inside too.
const PORTALLED_LAYER_SELECTOR =
  '[data-reka-popper-content-wrapper],[data-dismissable-layer],[data-slot="overlay"]'

// The attribute the planning week puts on every control that asks the page's dirty check for
// permission before it acts: a task row's expand button, a day's add control, a day's disclosure
// button, and the week switcher. Those have their own rule in the spec (a discard confirmation, not a
// quiet note), so the outside detector stays out of their way rather than firing first and stacking a
// note underneath a modal.
export const EDITOR_GATE_ATTRIBUTE = 'data-editor-gate'

const INSIDE_SELECTOR = `${PORTALLED_LAYER_SELECTOR},[${EDITOR_GATE_ATTRIBUTE}]`

export function useClickOutsideEditor(
  getElement: () => Element | null | undefined,
  onOutside: () => void
) {
  function onPointerDown(event: PointerEvent) {
    const element = getElement()
    const target = event.target

    if (!element || !(target instanceof Element)) return
    if (element.contains(target)) return
    if (target.closest(INSIDE_SELECTOR)) return

    onOutside()
  }

  // Capturing, and on pointerdown rather than click, for the same reason the library does it: a
  // popover option removes itself from the DOM as it is selected, so by the time a click event is
  // dispatched the layer that would have identified it is already gone.
  onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
}
