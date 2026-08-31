# Design: reset onboarding (admin)

The visual blueprint for [`onboarding-reset.md`](onboarding-reset.md). That spec owns the placement,
the gating, the flow, the API, and every visible string, all approved. This document resolves `AC23`,
`AC24` and `AC25` on the screen, which is the fourth section on the settings page and the confirmation
modal it opens. It writes no Vue and edits no component.

The whole feature is one section on a page that already has three, plus one modal in a shape the app
already ships. So there is almost nothing to invent here, and the two places where a real decision has
to be made are how much weight the destructive signal carries, in
[the weight of the signal](#the-weight-of-the-signal-and-why-it-is-not-heavier), and where the four
confirmation sentences live inside `UModal`, in
[where the four sentences go](#where-the-four-sentences-go-and-why-it-is-not-the-body-slot). The second
one is the finding worth reading, because getting it wrong is silent.

## Scope this design works inside

**One section is appended. Nothing already on the page moves.** The owner has separately asked for work
parameters to be split out of user settings into their own surface, that feature is being specced on its
own, and it owns every question about how this page is organised. This design proposes no reordering, no
regrouping, no renaming, and no restyling of the Work, Quotas and Security sections. `AC23` requires the
three to render identically whether or not the fourth is present, and the layout below satisfies that by
construction rather than by care, because the new section is the last child of a wrapper whose only
vertical rule is `space-y-[clamp(2rem,5vh,3rem)]`. Adding or removing a last child under a `space-y`
wrapper changes nothing about the children above it.

The section is also gated, so on most sessions it is not in the DOM at all. That makes the identical
rendering of the other three a property of the markup rather than a claim to re-test on every branch.

## Layout regions

The settings page keeps its existing shell, which is
`mx-auto w-full max-w-xl px-6 py-[clamp(2rem,6vh,4rem)] sm:px-6 lg:px-8 space-y-[clamp(2rem,5vh,3rem)]`.
Nothing about the page wrapper changes.

1. **Page header.** Unchanged.
2. **Work section.** Unchanged.
3. **Quotas section.** Unchanged.
4. **Security section.** Unchanged, and no longer last.
5. **Reset section.** New, gated on the admin role, fourth and last in the DOM. The only thing this
   document designs, along with the modal it owns.
6. **The confirmation modal.** Declared inside the Reset section rather than as a sibling of it, and
   portalled out of the document flow by `UModal` itself, so its position in the template affects no
   layout or stacking either way. That freedom is why it is nested. As a sibling the component was
   instantiated whatever the switch said, and the confirmation stayed unreachable only because the one
   writer of `confirmOpen = true` sat inside the unrendered section, which is a property of where a
   single assignment lives rather than of the template. Nested, AC26.3 holds by construction, because
   with the switch off the modal is never built at all.

**Why last rather than anywhere else.** The spec already decided it is appended after Security, and the
placement is right for two reasons worth recording. A destructive action belongs at the end of a page
rather than between two things the user came to edit, which is the danger-zone convention every product
in the spec's prior art follows. And last is the only position that leaves the other three untouched,
since inserting anywhere else would change what a returning user finds where they left it.

## The section, region by region

### The section header

Identical in construction to the three shipped sections, which is a `section` with `aria-labelledby`, an
`h2` carrying a leading `UIcon`, and a subtitle paragraph.

- `section v-if="isAdmin(user?.role)" aria-labelledby="settings-reset-heading" class="space-y-4"`
- `h2#settings-reset-heading class="flex items-center gap-2 text-lg font-semibold text-highlighted"`
- `UIcon class="size-5 text-primary" name="i-ph-arrow-counter-clockwise-bold"`
- `p class="mt-1 text-sm text-muted"` holding `settings.reset.subtitle`

`i-ph-arrow-counter-clockwise-bold` because the action returns the account to a previous state rather
than destroying a thing. `i-ph-warning-bold` and `i-ph-trash-bold` were the other candidates and both
are rejected in [the weight of the signal](#the-weight-of-the-signal-and-why-it-is-not-heavier). Bold
weight matches `i-ph-briefcase-bold`, `i-ph-target-bold` and `i-ph-lock-bold` on the three shipped
headings.

**The icon keeps `text-primary`, like the other three.** A permanently red glyph on a page the owner uses
routinely is a standing alarm on a control that is safe to look at, and a standing alarm is the thing
people stop seeing. The heading is also not where the destructive decision happens, so it is not where
the weight belongs.

### The card

`UCard class="rounded-2xl bg-default ring ring-default"`, the same card as the other three sections, with
no error tint and no coloured ring.

The card has no loading state and no load-failure state, because this section reads nothing. The other
two data-backed sections carry a skeleton and a `UAlert` with a retry because they fetch on mount. There
is nothing to fetch here, so there is no skeleton, no alert region, and no `loadError` or `retry` key in
the copy table. That absence is deliberate and it is why the copy table is shorter than the Work and
Quotas ones.

### The control

One control, right-aligned, in a `div class="flex justify-end"` as the card's only child.

```
UButton color="error" variant="subtle" icon="i-ph-arrow-counter-clockwise-bold"
        :label="t('settings.reset.submit')" @click="confirmOpen = true"
```

Four notes on that line.

- **`flex justify-end` matches the three shipped submits exactly**, so the fourth card ends where the
  other three end and the page keeps one rhythm down its right edge.
- **No `:loading` binding and no `type="submit"`.** The button opens a modal and sends nothing, which is
  `AC24`. A loading state on a control that performs no request would be a lie, and the loading state
  lives on the modal's confirm instead. There is also no `UForm` around it, because there is no field to
  submit.
- **No `btn-glow` class.** `app.config.ts` already appends `btn-glow` to the button theme's `base` slot,
  so every `UButton` in the app has it. The three shipped submits carry the class explicitly as well,
  which is redundant, and this section does not copy the redundancy. Nothing about the hover changes
  either way.
- **`color="error" variant="subtle"` is the whole of the at-rest destructive signal**, argued next.

## The weight of the signal, and why it is not heavier

This is the one aesthetic decision the spec left open, so here is the reasoning rather than the result
alone.

**What actually needs signalling.** Pressing this button does nothing. It opens a modal, and the modal
states in words that the action cannot be undone. So the at-rest treatment is not the safety mechanism
and does not need to carry the warning. What it does need to carry is that this control is not a fourth
Save. Three cards above it end in a solid primary button with `i-ph-check-bold`, in the same place, at
the same size. That is a motor pattern, and a fourth button in that exact costume would be pressed by
reflex on the way down the page. Breaking the pattern at the point where it stops applying is the whole
job.

**So the divergence is put on the control and nowhere else.** `color="error"` says which family of
action this is. `variant="subtle"` says it is not the thing on this page you press most. The icon
changes from a check to a counter-clockwise arrow, so the difference survives with all colour removed,
which is the never-colour-alone rule satisfied by construction rather than by adding a redundant marker
to a colour that was doing the work.

**Solid error is deliberately held back for the modal.** The section button is `subtle` and the modal's
confirm is solid `error`, so the two steps read as an escalation. If both were solid the second step
would add no visible seriousness at the exact moment seriousness is worth something, and if the section
button were solid red it would be the loudest element on a settings page the owner opens to change their
work hours.

**What was considered and rejected.**

| Option | Why not |
| --- | --- |
| A danger-zone card with `ring-error` and a tinted surface, GitHub style | A permanent red block on a page used routinely becomes furniture, and the section's actual copy is two short strings, so a bordered zone would be a frame around almost nothing. GitHub's danger zone holds several irreversible actions. This holds one. |
| A `UAlert color="warning"` inside the card restating the consequence | There is no i18n key for it, so it would mean inventing copy the spec did not write, and it would say at rest what the modal says at the moment of decision. Warning twice is how the first warning stops being read. |
| `text-error` on the heading icon | A standing alarm on a heading, with no decision attached to it. |
| Solid `color="error"` on the section button | Loudest element on the page, and it spends the escalation before the modal needs it. |
| A typed confirmation string | Settled by the spec against the prior art. Typing is reserved for deletion of something irreplaceable, and what is cleared here is a handful of numbers and preferences. |

**Why none of this is policing.** The project rule forbids blocking the user from recording what they
actually did. Nothing here refuses an action, nothing is disabled, no condition prevents the reset, and
Confirm always proceeds. The escalation is one modal, once, and the button colour is a statement about
what the action is rather than a hurdle in front of it.

## The confirmation modal

`UModal`, driven by a local `confirmOpen` ref, matching the shape already shipped in
[`admin/users.vue`](../../../app/pages/admin/users.vue). That page is the app's only confirmation modal
today and this is the second, so the idiom is copied rather than reinvented.

```
UModal v-model:open="confirmOpen" scrollable
       :title="t('settings.reset.confirm.title')"
       :ui="{ description: 'mt-2 space-y-3 text-sm text-muted', footer: 'justify-end' }"
       :content="{ onOpenAutoFocus: focusCancel }"
```

### Where the four sentences go, and why it is not the body slot

**This is the part worth reading carefully, because `UModal` builds the dialog's accessible description
from a prop and a named slot, and putting the text anywhere else is silent.**

In [`Modal.vue`](../../../node_modules/@nuxt/ui/dist/runtime/components/Modal.vue) the header renders a
reka-ui `DialogDescription` only when `props.description` is set or the `#description` slot is filled.
When neither is, the component still mounts an empty `DialogDescription` inside a `VisuallyHidden`
wrapper, and reka-ui's `DialogContent` points `aria-describedby` at that element's id. So a modal whose
prose lives entirely in `#body` renders correctly, looks right, and announces a title followed by an
empty description. Nothing about the page looks wrong.

The spec gives four separate strings, so the single `description` prop cannot hold them without joining
them into one string, and joining them would then be rendered a second time by whatever `#body` held.

**So all four sentences go in the `#description` slot**, in the spec's order, and there is no `#body` at
all. That puts every sentence inside `DialogDescription`, which is exactly what `aria-describedby`
resolves to, so what is announced and what is on screen are the same four sentences.

**One mechanical constraint that follows.** `DialogDescription` renders with `as: 'p'` by default and
`UModal` does not forward an `as` for it, so the slot's contents are inside a `<p>`. A `<div>`, a `<p>`
or a `<ul>` in there is invalid HTML, the browser closes the paragraph early, and the hydration mismatch
is real rather than theoretical. **Each sentence is therefore a `<span class="block">`**, which is
phrasing content, valid inside a paragraph, and stacks like a block. `space-y-3` on the description slot
spaces them, which works because the children are block-level.

### The four sentences and how they are weighted

Three levels of emphasis, all from semantic tokens, all still legible with colour removed because the
words carry the meaning on their own.

| Order | Key | Classes on the span | Why that weight |
| --- | --- | --- | --- |
| 1 | `settings.reset.confirm.cleared` | `block text-default` | The consequence, and the only sentence naming the theme and the language. Stepped up out of `text-muted` so it is the most legible line in the dialog, directly under the title, which is where a reader's eye lands first. |
| 2 | `settings.reset.confirm.kept` | `block` | The reassurance, inheriting `text-muted`. This is Chrome's reset dialog structure, where naming what survives is what makes the warning proportionate instead of frightening. |
| 3 | `settings.reset.confirm.password` | `block` | The heads-up about the wizard asking for a password again. Same weight as the reassurance, because it is a thing to expect rather than a thing to fear. |
| 4 | `settings.reset.confirm.irreversible` | `block font-medium text-highlighted` | The last thing read before the two buttons. Weight rather than colour, because the confirm button below it is already solid red and a red sentence above a red button is the same signal twice with less legibility. |

**The consequence the user will not expect is the theme and the language.** It sits inside sentence one,
which is the sentence the design makes the most legible and puts first. That is as far as layout can
carry it, and it is not far enough, for the reason set out in
[what the copy will fight](#what-the-copy-will-fight-in-this-layout). The honest statement is that the
warning is present, announced, and first, and that it is the fourth and fifth item of a six-item
enumeration inside one long sentence, which is a copy shape no arrangement of pixels improves.

### The two actions, and which one is safe

`:ui="{ footer: 'justify-end' }"`, the same footer override the shipped modal uses.

| Action | Component | Why |
| --- | --- | --- |
| Cancel | `UButton color="neutral" variant="ghost" :label="t('settings.reset.confirm.cancel')"` closing the modal | Character for character the shipped cancel in `admin/users.vue`. It sends nothing, which is `AC24`. |
| Reset | `UButton color="error" :label="t('settings.reset.confirm.submit')" :loading="resetting"` | Solid `error` at its default variant, which is the shipped destructive confirm on the users page. No icon, matching that confirm, because a labelled button at the end of a dialog that has just explained itself needs no glyph. |

**Cancel is the safe option and it is quieter than Confirm.** That is deliberate and it is the app's
existing idiom, but it is worth naming rather than leaving implied. A ghost cancel beside a solid red
confirm puts the visual weight on the dangerous side. What protects the user is not the button's weight,
it is that the safe option holds initial focus, so Enter and Space on arrival do nothing, and Escape
does the same thing as Cancel. Making Cancel an outline button was considered and dropped, because it
would put a second confirmation idiom in an app that has exactly one.

### Focus

**Focus starts on Cancel, explicitly.** Left alone, reka-ui autofocuses the first focusable element in
the dialog, and in `UModal` that is the close button in the header, since it precedes the footer in the
DOM. Landing on an icon-only dismiss control is a poor arrival, and on a destructive dialog the arrival
point should be the action that does nothing.

The mechanism is `UModal`'s `content` prop, which is forwarded to `DialogContent` with `v-bind`, so
`:content="{ onOpenAutoFocus: focusCancel }"` reaches reka-ui's own event. The handler calls
`event.preventDefault()` and focuses a template ref on the Cancel button.

The focus order once inside is Cancel, then Reset, then the close button, then wrap. That is DOM order
with one exception, which is that the close button is visually top-right but comes last in the footer's
tab sequence, because `UModal` places it in the header markup and positions it absolutely. It is the
shipped behaviour of the users-page modal, so it is inherited rather than introduced.

Focus returns to the section's Reset button when the modal closes, because reka-ui restores focus to the
element that was focused before the dialog opened, and this modal is opened from that button rather than
through a `#default` trigger slot.

**A simpler fallback if the escape hatch turns out to be awkward.** `:close="false"` removes the header
dismiss button, which makes Cancel the first focusable element with no handler at all. Escape, Cancel,
and a click outside all still dismiss, so nothing is lost but the X. This is the second choice rather
than the first only because keeping the X matches the shipped modal.

### Why the modal is `scrollable`

`scrollable` moves the overflow onto the overlay, which becomes `overflow-y-auto grid place-items-center
p-4 sm:py-8`, and takes the `max-h-[calc(100dvh-2rem)] overflow-hidden` off the content.

Without it, the content is height-capped and `overflow-hidden`, and only the body slot scrolls. This
modal has no body slot. Every one of its four sentences is in the header, and the header does not
scroll. At the page's narrowest supported width the French `cleared` string alone wraps to about five
lines, and the four together with the title and the footer come to roughly 380 pixels, which fits a tall
phone and does not fit a short one or a phone held in landscape.

So this is insurance rather than a fix for a measured break. It costs one prop, it changes nothing at any
width where the dialog already fits, and it removes a whole class of failure where a warning about an
irreversible action is clipped off the bottom of the screen. That is a trade worth taking without
waiting to see it happen.

## Loading and error states

The section has no load, so this is only about the write.

- **Pending.** `:loading="resetting"` on the modal's confirm button, bound to a local ref set true for
  the duration of the request. Nuxt UI's loading state also disables the button, which is what stops a
  double submit. This is the shipped convention on all three sections and on the users-page confirm.
- **Cancel stays enabled and the modal stays dismissible while the request is in flight.** Disabling
  them would guard against a user closing the dialog mid-write, and it would also trap the user if the
  request hung, which the no-dead-ends convention weighs more heavily. The spec has already analysed
  what happens if the user leaves at that moment, and the answer is that the write completes, the
  refreshed session cookie is on the response, and the next navigation routes correctly. So the
  permissive option is the one whose worst case is already documented as safe.
- **Success.** A toast, `toast.add({ title: t('settings.reset.success'), color: 'success', icon:
  'i-ph-check-circle' })`, identical in construction to the three shipped success toasts.
- **Failure.** The modal closes and a toast appears, `toast.add({ title:
  t('settings.reset.errors.generic'), color: 'error', icon: 'i-ph-warning-circle' })`, identical in
  construction to the three shipped error toasts. There is no inline error region in the card and no
  `UAlert`, because the only `UAlert` on this page is the load-failure alert on the two sections that
  load, and this one does not. `resetting` is cleared in a `finally`, so the button never keeps
  spinning.

### The order of operations on success, which is a design decision rather than plumbing

The spec's step 5 is a session refresh, a success toast, and a navigation. The order inside that matters
visually, because the reset changes the theme and the interface language.

The frontend conventions record that state derived once from the session does not re-derive when the
session re-reads. `useTheme`'s `lightTheme` and `darkTheme` are `useState` refs seeded from `user`, and
the active i18n locale is not read off `user` at all, so refreshing the session alone leaves the old
theme painted and the old language in place. The wizard already handles exactly this in
[`onboarding.vue`](../../../app/pages/onboarding.vue), where the completion handler writes the chosen
ids into `lightTheme` and `darkTheme` and awaits `setLocale` after the mutation. **The reset mirrors that
handler with the coded defaults**, which are `DEFAULT_THEME_ID` and `DEFAULT_LOCALE` from
[`#shared/theme`](../../../shared/theme.ts).

So the sequence is the session fetch, then the theme and locale re-apply, then the toast, then the
navigation.

**The toast comes after the locale switch on purpose.** An English-reading admin is looking at a French
interface from the moment the locale is applied, and a toast created before the switch would sit in
English on a French page. Creating it after means the success message is in the language the interface
is now in, which is the state the confirmation copy told them to expect, and which is the language the
wizard they are about to land on will be in. It is the smaller of two inconsistencies.

## Responsive behaviour

The page wrapper handles horizontal padding and the maximum width, and neither changes.

- **The section, base from 320 px.** The card holds one right-aligned button. The longest label in
  either locale is short, so nothing stacks, nothing wraps, and no `sm:` step is needed. At the capped
  page width the button sits at the right edge of the card, level with the three submits above it.
- **The section at `sm` and `lg`.** No change. The page is capped at `max-w-xl`, well below the `lg`
  breakpoint, so `lg:px-8` on the wrapper is the only thing that applies and it is inherited unchanged.
- **The modal, base from 320 px.** `w-[calc(100vw-2rem)]` with `p-4` padding, giving about 240 pixels of
  text. The description wraps to roughly eleven lines in French. The two footer buttons come to about
  200 pixels of the 256 available, so they stay on one row and no `flex-col` fallback is needed.
- **The modal at `sm` and up.** `max-w-lg` caps it at 512 pixels and the padding steps to `sm:p-6` on
  the body and `sm:px-6` on the header and footer, both from the shipped theme. The description falls to
  about four lines.
- **Any height.** `scrollable` means the overlay scrolls rather than the dialog clipping, at every
  width.

Nothing in the section or the modal is positioned by ordinal, counts anything, or depends on the number
of sections on the page.

## Motion

**This design adds none.** No transition, no reveal, no animated state change.

Two motions are inherited and neither is new. The `.btn-glow` hover is a 200 ms `box-shadow` fade
defined in `main.css` and applied to every `UButton` through `app.config.ts`, so both buttons and the
section control have it already. `UModal`'s open and close animation is the shipped `transition` variant,
a 200 ms fade on the overlay and a 200 ms scale on the content, which is exactly what the users-page
confirmation modal already does.

**Neither is currently behind a `prefers-reduced-motion` query, and `main.css` contains no such query at
all.** That is stated plainly rather than claimed as gated. A 200 ms shadow fade and a 200 ms dialog
scale are not vestibular motion, so the position is defensible as it stands, and in any case both are
shipped behaviours this section inherits rather than introduces. The remedy, if the accessibility stage
wants one, is a single app-wide `@media (prefers-reduced-motion: reduce)` block in `main.css` that
neutralises the transition and the two keyframe animations, raised against the whole app rather than
against this section. Gating one modal and leaving the other ungated would be worse than gating neither.

## Key Tailwind decisions

- **Section wrapper.** `space-y-4`. Matches the three shipped sections exactly, so all four share one
  rhythm.
- **Section heading.** `flex items-center gap-2 text-lg font-semibold text-highlighted`. Copied. Not
  re-clamped, because the page's `h1` carries the fluid size and the `h2` elements deliberately do not
  compete with it.
- **Heading icon.** `size-5 text-primary`. Copied, including the colour, for the reason in
  [the weight of the signal](#the-weight-of-the-signal-and-why-it-is-not-heavier).
- **Subtitle.** `mt-1 text-sm text-muted`. Copied.
- **Card.** `rounded-2xl bg-default ring ring-default`. Copied, and a ring rather than a border per the
  conventions. No error tint and no coloured ring.
- **Control row.** `flex justify-end`. Copied from the three submit rows.
- **Modal description slot.** `:ui="{ description: 'mt-2 space-y-3 text-sm text-muted' }"`. The shipped
  default is `mt-1 text-muted text-sm`, so this changes the top margin by one step and adds the vertical
  rhythm the four sentences need. `space-y-3` rather than a fluid clamp, because a dialog is not a page
  and its internal spacing should not move with the viewport height while the dialog itself is centred
  in it.
- **Each sentence.** `block` on a `span`, for the HTML validity reason in
  [where the four sentences go](#where-the-four-sentences-go-and-why-it-is-not-the-body-slot).
- **Emphasis.** `text-default` on the first sentence, inherited `text-muted` on the middle two,
  `font-medium text-highlighted` on the last.
- **Modal footer.** `:ui="{ footer: 'justify-end' }"`. Copied from the shipped confirmation modal.
- **Tokens only.** `bg-default`, `ring-default`, `text-highlighted`, `text-default`, `text-muted`,
  `text-primary`, and the `error`, `neutral` and `success` component colours. **No hex anywhere, no raw
  palette colour, and no `dark:` variant of its own**, so the section and the modal repaint correctly
  under all five themes in both modes with nothing to re-check per theme. The section introduces no new
  colour role, which is the reason no contrast measurement is needed here. Every surface, text token and
  component colour it uses is already measured on this page or on the users page.

## Component hierarchy

```
- div (page wrapper, unchanged)
  - div (page header, unchanged)
  - section (Work, unchanged)
  - section (Quotas, unchanged)
  - section (Security, unchanged)
  - section v-if="isAdmin(user?.role)" aria-labelledby="settings-reset-heading" (space-y-4)
    - div
      - h2#settings-reset-heading (flex items-center gap-2 text-lg font-semibold text-highlighted)
        - UIcon name="i-ph-arrow-counter-clockwise-bold" (size-5 text-primary)
        - settings.reset.heading
      - p (mt-1 text-sm text-muted) -> settings.reset.subtitle
    - UCard (rounded-2xl bg-default ring ring-default)
      - div (flex justify-end)
        - UButton color="error" variant="subtle" icon="i-ph-arrow-counter-clockwise-bold"
                  -> settings.reset.submit, opens the modal, sends nothing
  - UModal v-model:open="confirmOpen" scrollable
           :title -> settings.reset.confirm.title
           :ui="{ description: 'mt-2 space-y-3 text-sm text-muted', footer: 'justify-end' }"
           :content="{ onOpenAutoFocus: focusCancel }"
    - #description
      - span.block.text-default                          -> settings.reset.confirm.cleared
      - span.block                                       -> settings.reset.confirm.kept
      - span.block                                       -> settings.reset.confirm.password
      - span.block.font-medium.text-highlighted          -> settings.reset.confirm.irreversible
    - #footer="{ close }"
      - UButton ref="cancelButton" color="neutral" variant="ghost"
                -> settings.reset.confirm.cancel, calls close()
      - UButton color="error" :loading="resetting"
                -> settings.reset.confirm.submit, calls the endpoint
```

Every component in that tree is a Nuxt UI 4 primitive already used elsewhere in this app. The section
introduces no custom component and no new component idiom.

**Where it lives is the frontend stage's call.** Inline in `app/pages/settings.vue` alongside the other
three sections is the straightforward reading of the spec's file list, and a
`components/settings/reset-section.vue` holding the section and its modal is equally fine. The section
has no second surface to share with, so nothing forces the extraction, and either choice leaves the
three existing sections untouched.

## Nuxt UI components chosen, with a reason for each

| Component | Where | Why this one |
| --- | --- | --- |
| `UCard` | The section body | The shipped card on all three sections. Anything else would make the fourth section read as a bolt-on. |
| `UIcon` | The heading | The shipped heading construction. |
| `UButton` | The section control, and both modal actions | First in the solution priority order, and the only button primitive in the app. `color` and `variant` carry every distinction this design needs, so no custom class does. |
| `UModal` | The confirmation | The Nuxt UI primitive for a dialog, already the app's confirmation idiom on the users page. It brings the reka-ui focus trap, the Escape dismissal, the focus restore, `aria-modal`, and the title and description wiring, all of which a hand-built dialog would have to reproduce and would reproduce worse. |
| `useToast` | Success and failure | The shipped announcement channel on this page, which reaches `UApp`'s live region. |

**No `UForm` and no `UFormField` anywhere.** There is no input, no validation, and nothing to submit. The
spec rejected a typed confirmation and rejected a `confirm: true` body field, so the modal has no field
in it, and wrapping two buttons in a form would add a submit path that means nothing.

**No `UAlert`.** Covered under [the card](#the-card).

## Icons

Three, all Phosphor, all present in the installed collection and all already used in this app.

| Icon | Where | Why |
| --- | --- | --- |
| `i-ph-arrow-counter-clockwise-bold` | The section heading and the section button | The action returns the account to a previous state rather than deleting a thing. |
| `i-ph-check-circle` | The success toast | The shipped success toast icon on this page. |
| `i-ph-warning-circle` | The error toast | The shipped error toast icon on this page. |

No icon on the modal's confirm button, matching the shipped confirmation modal, and no icon inside the
description, because four short sentences with a glyph each is a list pretending to be prose.

## Copy, and the exact key for every visible string

Every string comes from a key. The spec's i18n table is the contract and this document reuses it rather
than paralleling it. The English gloss below is for orientation only. **The French is the source text and
is copied from the spec byte for byte, including the real U+00A0 before `?`**, which
`test/i18n/locale-punctuation.test.ts` enforces and which is visually identical to a plain space in an
editor and in a diff. `settings.reset.confirm.title` is the one string in the set carrying that
character.

| Key | Renders as | EN gloss |
| --- | --- | --- |
| `settings.reset.heading` | The `h2` text, after the icon | Reset |
| `settings.reset.subtitle` | The `p` under the heading | Clear your settings and go through the initial setup again. |
| `settings.reset.submit` | The section button label | Reset |
| `settings.reset.confirm.title` | The modal `title` prop | Reset your settings? |
| `settings.reset.confirm.cleared` | Description span 1, `text-default` | Your work hours, work days, timezone, theme, language and quotas will be cleared. |
| `settings.reset.confirm.kept` | Description span 2 | Your tasks, your name and your password are not affected. |
| `settings.reset.confirm.password` | Description span 3 | The initial setup will ask you for a password again. |
| `settings.reset.confirm.irreversible` | Description span 4, `font-medium text-highlighted` | This cannot be undone. |
| `settings.reset.confirm.cancel` | The footer's first button label | Cancel |
| `settings.reset.confirm.submit` | The footer's second button label | Reset |
| `settings.reset.success` | The success toast title | Your settings have been reset. |
| `settings.reset.errors.generic` | The error toast title | Something went wrong. Please try again. |

That is the complete set of visible strings, and it matches the spec's table exactly. **This design adds
no key and needs none**, which is `AC25` satisfied without a copy round trip. The keys sit under
`settings` beside `work`, `quotas` and `security`, in both locale files, in the same commit.

## Accessibility, what is answered here and what is left

Answered by construction.

- **The section is a `section` with `aria-labelledby` pointing at its `h2`**, matching the three shipped
  sections. The page then has one `h1` and four `h2` elements in document order.
- **The heading id is `settings-reset-heading`**, following `settings-work-heading`,
  `settings-quotas-heading` and `settings-security-heading`. Naming it that way is not cosmetic. It is
  what keeps the pattern obvious enough that a fifth section gets it right.
- **The dialog's accessible description is the four sentences the user can see**, which is the finding in
  [where the four sentences go](#where-the-four-sentences-go-and-why-it-is-not-the-body-slot) and the
  single easiest thing to get silently wrong here.
- **Initial focus is on the safe action**, and it is set explicitly rather than left to fall on the close
  button.
- **Focus is trapped in the dialog and restored to the Reset button on close**, both from reka-ui.
- **Escape dismisses**, because `dismissible` is left at its default.
- **Nothing is signalled by colour alone.** The section button differs from the three submits by icon and
  by label as well as by colour. The four description sentences differ by what they say. The confirm
  button is labelled. Remove all colour and the section and the modal both still read.
- **Both buttons carry a real text label**, so there is no icon-only control and nothing needing an
  `aria-label`.
- **Success and failure go to a toast** through `UApp`'s live region, which is how the other three
  sections already announce.
- **Nothing is disabled and nothing is refused**, except the confirm button while its own request is in
  flight, which says why by showing a spinner.
- **The gated section is absent rather than hidden** for a non-admin, so there is no control present and
  inert and nothing reachable by keyboard that a mouse user cannot see.
- **No hydration guard is needed, and the section is deliberately absent server-side.** This corrects an
  earlier draft of this document, which claimed the section renders server-side for an admin because
  `useUserSession`'s `user` resolves during SSR. It does not, and the reason is a deliberate choice rather
  than an oversight. The section renders on `me.canResetOnboarding`, and `useMeQuery` seeds its
  `initialData` from the sealed session cookie, which does not carry that field. The seed omits it on
  purpose, since inventing a value there would be guessing at a server decision, and the field is kept off
  the session so a flipped switch does not wait for a sign-out to take effect. So `showReset` is `false`
  through SSR and the first paint for everyone, and the section appears after hydration once `/api/me`
  answers. That direction is the safe one and it is why no `ClientOnly` wrapper is needed: the section can
  only ever go from absent to present, never appear and then be withdrawn, so nothing a non-admin or a
  switched-off admin sees is a control that is taken away. The cost is that an admin sees the section land
  a moment after the rest of the page, which is accepted. The reasoning is recorded on the composable in
  `app/composables/useMeQuery.ts`.

Left for the accessibility stage, each with a remedy named.

1. **The dialog's open and close animation is not behind a reduced-motion query**, and neither is
   `.btn-glow`. App-wide rather than this section's, remedy named under [motion](#motion).
2. **The close button's position in the tab order.** It is visually first and comes last in the
   sequence, which is `UModal`'s shipped markup and is already true of the users-page modal. If the
   stage decides it matters, `:close="false"` removes the question entirely on this modal, at the cost
   of the two modals differing.

## Assumptions taken rather than asked

Recorded under their own heading because no question could be asked during this stage. Each is the
smaller of the options available.

1. **The destructive signal is one step of divergence at the control and none in the section chrome.**
   Argued in full, with the four rejected alternatives named.
2. **The four confirmation sentences live in `#description` rather than `#body`**, which is what puts
   them in the accessible description. This is closer to a finding than an assumption, since the
   alternative is silently wrong rather than merely different.
3. **The first sentence steps up to `text-default` and the last takes `font-medium text-highlighted`.**
   The spec split the copy into four keys precisely so the design stage could lay them out, so weighting
   them is the invitation being taken rather than a liberty.
4. **The modal is `scrollable`.** Insurance against a clipped warning at short viewport heights, stated
   as insurance rather than as a fix for a measured break.
5. **Initial focus is moved to Cancel through the `content` prop**, with `:close="false"` recorded as
   the simpler fallback.
6. **The success toast fires after the locale switch**, so it reads in the language the interface has
   just become.
7. **The section carries no badge marking it as admin-only.** There is no key for one and inventing copy
   is not this stage's to do. Recorded under [what this leaves for later](#what-this-leaves-for-later).
8. **The section control drops the redundant explicit `btn-glow` class** the three shipped submits carry,
   since `app.config.ts` already applies it to every button. Nothing about the rendering changes.

## What the copy will fight in this layout

One thing, and it is worth the owner's attention because it is the sentence carrying the surprise.

**`settings.reset.confirm.cleared` is a six-item enumeration inside one sentence, and the theme and the
language are items four and five.** The design gives that sentence the best position and the highest
contrast in the dialog, and that is the whole of what layout can do for it. A reader skimming a long
comma-separated list reliably takes the first item and the last, and here the first is work hours and the
last is quotas, which are the two nobody is surprised by. The theme and the language are in the middle,
which is exactly where a skim drops.

**What would fix it is a copy change, and copy is the spec's rather than this stage's.** If the owner
wants the surprise to be unmissable, the shape that does it is a short lead-in string plus a real list,
so that "votre thème" and "votre langue" each sit on their own line. That is a genuinely better dialog
and it costs more than it looks, for two reasons this stage can at least price. It replaces one key with
a lead-in plus one key per item, which is a copy set the owner then has to review as a translator rather
than as an owner. And a `<ul>` cannot go inside `DialogDescription`, since that renders as a `<p>`, so
the list would have to move to the `#body` slot with the lead-in staying in the description, which
re-opens the announcement question this document just closed and means the announced text and the visible
text stop being the same thing.

So the recommendation is to leave the copy as the spec wrote it and ship it. The warning is present,
first, announced, and the most legible line in the dialog. Raising the residual risk is the honest half
of saying it fits.

Two smaller notes on the same table, neither of which affects the layout.

- **`settings.reset.heading` is a bare noun** and the spec already flags that it may read as terse beside
  Travail, Quotas and Sécurité. The layout is indifferent, since the heading is one line at
  `text-lg font-semibold` and every candidate word fits at 320 pixels with room over.
- **`settings.reset.submit` and `settings.reset.confirm.submit` are the same word** in both locales. That
  is correct rather than a duplication to collapse, because the two buttons are in different places and a
  later stage may want to change one without the other, and because the second one is the button that
  actually does the thing.

## What this leaves for later

Wishes this design generated and stopped at, per the boundary against absorbing scope.

1. **A marker saying the section is admin-only.** Every other section on the page is visible to every
   user and this one is not, and a sole admin has no way to notice the difference. A neutral subtle
   `UBadge` beside the heading is the shipped idiom for it, and it needs a string the spec did not write.
   Not built here.
2. **An app-wide `prefers-reduced-motion` block in `main.css`**, covering the modal animation and
   `.btn-glow` together. Named under [motion](#motion) and raised against the whole app.
3. **A shared confirmation component.** This is the app's second confirmation modal and the two are now
   the same shape with different contents. A third would be the point at which extracting one is worth
   more than the coupling, and two is not that point.
4. **Whether the settings page eventually grows a danger zone.** If the split of work parameters into
   their own surface leaves this page with a second irreversible action, the two belong in one bordered
   zone and the reasoning in
   [the weight of the signal](#the-weight-of-the-signal-and-why-it-is-not-heavier) changes, because a
   frame around two actions is a frame around something. That is that feature's call and not this one's.
