# Design: per-category quotas

The visual blueprint for [`per-category-quotas.md`](per-category-quotas.md). That spec owns the table,
the API, the resolution order, the copy table, and the removals, all approved. This document resolves
`AC7` and `AC8` on the screen, which is the new Quotas section on the settings page and the shape of
the strings it needs. It writes no Vue and edits no component.

**Amended 2026-08-24 for the snapshot model.** The owner approved an architecture change after this
blueprint was filed, recorded in the spec under
[the snapshot model](per-category-quotas.md#the-snapshot-model-approved-2026-08-24). A category quota is
now a plain current setting updated in place, and historical accuracy comes from the server writing the
resolved figure onto each task as the task is written. So there is no `effective_from` column, no
`effectiveFrom` field on the API, and no date anywhere on this screen. Every passage that change
falsifies is marked **superseded** below and says what replaced it, rather than being deleted, because
the reasoning that led here is part of what this document is for. One decision the change opens fresh is
answered in
[the task editor's quota field](#the-task-editors-quota-field-under-the-snapshot-model). Everything not
marked as superseded is unchanged and still holds, which is the layout, the grid, the dynamic row count,
the colour on the label, the props-not-slots assignment, the badge, the contrast measurements, and the
advisory findings.

The whole feature is one section on a page that already has two. So the governing constraint is that
there is nothing new to invent here. `app/pages/settings.vue` and
[`work-fields.vue`](../../../app/components/settings/work-fields.vue) already establish every part
except one, which is how a figure says where it came from. That one part is what most of this document
is about.

## The one thing the spec left to this stage, and the answer

Spec open question 4 asks whether the category labels take their `PLAN-32c` colour. **They do.** The
reasoning and the measured contrast are in [colour](#colour-the-label-is-the-carrier-and-it-is-reused)
below.

Everything else this document decides is either an assumption the spec did not reach or a detail small
enough that the spec was right not to carry it. Both are labelled.

## Scope this design works inside

The category set is the ten-member code contract in
[`shared/categories.ts`](../../../shared/categories.ts) for this feature. `PLAN-30` and its per-user
category rows stay next. That is the spec's assumption 6, which records itself as the pipeline
coordinator's working assumption rather than the owner's ruling, and for this stage it is fixed.

**So the layout is designed against a dynamic count and never against four.** Four trackable
categories exist today. The mandatory convention headed "Any list is customizable, modular, and
extensible" requires the layout to survive an eleventh and a twentieth, and
[how it behaves at 1, 4 and 20](#how-the-layout-behaves-at-1-4-and-20-rows) states what happens at
each. No class in this document counts the rows, and nothing is positioned by ordinal.

## Layout regions

The settings page keeps its existing shell, which is
`mx-auto w-full max-w-xl px-6 py-[clamp(2rem,6vh,4rem)] sm:px-6 lg:px-8 space-y-[clamp(2rem,5vh,3rem)]`.
Nothing about the page wrapper changes.

1. **Page header.** Unchanged. The `h1` and the intro paragraph.
2. **Work section.** Unchanged in structure. It loses one `UFormField`, because
   `work-fields.vue` loses its quota model per `AC7`. Its heading, its subtitle, its card, its
   skeleton, its alert and its submit all stay exactly as they are.
3. **Quotas section.** New, and the only thing this document designs. Third in the DOM after the page
   header and Work, before Security.
4. **Security section.** Unchanged, and stays last.

**Why Quotas sits between Work and Security rather than after both.** The quota used to live inside
Work, so a reader looking for it goes to where it was and finds the next thing down. Security is a
different subject and reads correctly as the last section on a settings page. This is an assumption
rather than a spec instruction, recorded under
[assumptions](#assumptions-taken-rather-than-asked).

## The section, region by region

### The section header

Identical in construction to Work and Security, which is a `section` with `aria-labelledby`, an `h2`
carrying a leading `UIcon`, and a subtitle paragraph.

- `section aria-labelledby="settings-quotas-heading" class="space-y-4"`
- `h2#settings-quotas-heading class="flex items-center gap-2 text-lg font-semibold text-highlighted"`
- `UIcon class="size-5 text-primary" name="i-ph-target-bold"`
- `p class="mt-1 text-sm text-muted"` holding `settings.quotas.subtitle`

`i-ph-target-bold` because the figure is a target rather than a measurement. `i-ph-gauge-bold` was the
other candidate and it reads as a reading taken, which is `PLAN-22`'s job rather than this section's.
Bold weight matches `i-ph-briefcase-bold` and `i-ph-lock-bold` on the two shipped headings.

### The card and its three states

`UCard class="rounded-2xl bg-default ring ring-default"`, the same card as the other two sections, and
the same three mutually exclusive states inside it.

- **Error.** A `div role="alert"` wrapping a `UAlert`, with `color="error"`, `variant="subtle"` and
  `icon="i-ph-warning-circle"`, carrying `settings.quotas.loadError` as its title and one action, a
  `color="neutral" variant="outline"` button labelled `settings.quotas.retry` calling the section's
  own `refresh()`. Copied from Work with the keys swapped.
- **Pending.** A `USkeleton` block laid out on the same grid the loaded form uses, so the card does
  not resize when the data lands.
- **Loaded.** A `UForm` holding the quota grid and the submit row.

The three sections load and save independently, so an error here leaves Work and Security working.
That is already true of the shipped pattern and this section inherits it rather than restating it.

**The skeleton row count is a placeholder and not a contract.** Four skeleton pairs, because four is
today's count and any number here is a guess about data that has not arrived. The tempting fix is to
read `trackable` from the shared contract to get the real count, and that is the exact inference
`AC6` removed when it decided non-trackable categories are absent from the response rather than
present with a null quota. The client renders what it is handed. So the skeleton guesses, the grid
reflows to whatever arrives, and the guess is written down here so nobody later mistakes it for a
count the layout depends on.

### The quota grid

One `UFormField` per entry in the API response, laid out on a grid.

```
grid grid-cols-1 gap-x-6 gap-y-[clamp(1rem,2.5vh,1.5rem)] sm:grid-cols-2
```

Entries render in the order the API returned, which is contract order per `AC6`. **Nothing sorts,
filters, or groups them.** Sorting by name breaks under a locale switch, sorting by value makes the
list jump while the user is typing in it, and filtering is what the server already did by omitting the
non-trackable categories.

Each cell is one field in three lines.

1. **The label line.** The `labelWrapper` slot of `UFormField` is a `flex` row with
   `justify-between`, so the category name sits left and the unit sits right on one line.
2. **The control line.** A `UInputNumber`.
3. **The provenance line.** The field's `help` region, under the control.

### The label, the unit, and the provenance, and which slot each one takes

This is the part worth reading carefully, because `UFormField` wires accessibility from its **props**
and not from its slots, and getting it wrong is silent.

In [`FormField.vue`](../../../node_modules/@nuxt/ui/dist/runtime/components/FormField.vue) the
provide block passes `hint: props.hint`, `description: props.description` and `help: props.help`, and
[`useFormField.js`](../../../node_modules/@nuxt/ui/dist/runtime/composables/useFormField.js) builds
`aria-describedby` by filtering those four names on the **prop** being truthy. The slot is what
renders, the prop is what gets announced. A field using only `#hint` or only `#help` renders a visible
string that no screen reader ever reaches, and nothing about the page looks wrong.

So the assignment is as follows.

- **The label takes the `#label` slot.** The slot is inside reka-ui's `Label`, which carries `:for="id"`
  regardless of whether the slot or the prop filled it, so the label association survives. The slot
  holds a `span` carrying the colour. See [colour](#colour-the-label-is-the-carrier-and-it-is-reused).
- **The unit takes the `hint` prop**, as a plain string, exactly as the shipped quota field on
  `work-fields.vue` does today (`:hint="t('onboarding.work.unitWph')"`). Prop only, no slot, so it is
  both visible and announced with no extra work. `AC8` keeps that key and names this section as one of
  its two surviving readers.
- **The provenance takes the `help` prop, and the `#help` slot only in the default case.** The prop
  carries the same localized string the slot renders, so `aria-describedby` fires and the announced
  text matches the visible text. The slot exists only so the default case can render its string inside
  a `UBadge` instead of as bare text.

`description` stays unused. It renders between the label and the control, which is the one place a
provenance note reads as a precondition on the field rather than as a footnote to the number.

## Expressing where a quota came from

The API sends `source: 'user' | 'default'` per `AC6`, so the client is told and never infers. Two
visible states.

**Superseded.** This paragraph used to read `effectiveFrom: string | null` off the response as well.
That field came off both the response and the request with the snapshot model, so `source` is the whole
of what the screen is handed, and it is enough, because the only thing the screen has to tell apart is a
figure the user set from one they never touched.

**A shipped default the user has never touched.** The help region renders
`UBadge color="neutral" variant="subtle" size="sm"` with `settings.quotas.defaultBadge` as its label.
No icon. That is the badge idiom already shipped in
[`admin/users.vue`](../../../app/pages/admin/users.vue), which is `color`, `size="sm"`,
`variant="subtle"` and a `label`, and matching it means this section introduces no new chip treatment.

**A value the user has saved.** The help region renders plain text, `settings.quotas.userValue`, which
takes no parameter of any kind. No badge, no icon, no colour.

**Superseded.** This state used to render `settings.quotas.userSince`, naming the date the value
took effect. The key is renamed and the date is gone, per `AC8`. The shape of the state is
untouched, since it was plain text in the `help` region before and it is plain text in the `help`
region now. Only the string got shorter.

### Why the two states are deliberately unequal in weight

The question a user actually asks of this list is "which of these have I never set", so the marker
only needs to be prominent in one direction. The badge answers that at a glance across however many
rows there are. The rows the user has already decided stay quiet, which is what a settled value should
look like.

**Neutral subtle is chosen so an untouched default cannot read as a problem.** `neutral` is the one
badge colour the five themes do not repaint and the four status roles do not claim, so the chip is
grey in both modes under every theme. It says "this is where the value came from" and it cannot be
mistaken for `warning` or `error`, which is what a primary or an amber chip on an untouched row would
have done.

**Nothing about the distinction is carried by colour.** Both states are words. Remove all colour and
the section still reads, because one row says a value is the shipped default and the other says the
value is the user's own. That satisfies the never-colour-alone rule by construction rather than by
adding a redundant icon to a colour that was doing the work. This held when the second state named a
date and it holds now that it names nothing else, since what carries the distinction was always the
words rather than the parameter inside them.

**Both states say something, because an absence cannot.** Marking only the defaults would have left the
other state as an absence, and an absence cannot distinguish "this is mine" from "we have nothing to say
about this row". So the user state carries words of its own rather than being the row with nothing under
it.

**Superseded in its argument rather than in its conclusion.** This paragraph used to reach that same
conclusion by way of the effective date, calling the date the interesting half, strictly more
informative, and the only place the effective dating became visible at all. Every clause of that is
void, because there is no effective dating left to make visible. The conclusion outlives the
argument it was resting on, since the reason both states need words was never about dates. It was
about an absence being unreadable.

**And the pair got better rather than worse.** Two words against a badge is simpler than a date against
a badge. There is no parameter to interpolate, no formatter, and no locale-dependent rendering, so there
is no way for the line to be subtly wrong in one locale and right in the other. See
[the date formatter that is no longer built](#the-date-formatter-that-is-no-longer-built) for the two
concrete bugs the removal takes off the table.

### Why the provenance survives a partial save, and says something useful when it does not

The spec's partially-completed-edit case says the client reconciles against the response rather than
against what it sent. The provenance marker is what makes that visible. A row that did not persist
comes back from the reconcile with its badge still on it, so the user sees which figures landed
without being told. That is a property of putting provenance on every row rather than a feature added
for the failure case, and it is worth naming because it is the reason a per-row marker beats a single
line of text at the top of the card.

### The date formatter that is no longer built

**Superseded, and the finding in it stopped applying rather than turning out to be wrong.** This
subsection specified how to format `effectiveFrom` for display, and it flagged a real bug in doing so.
There is no date on this screen now, so the formatter is deleted rather than fixed, and none of what
follows is work for the frontend stage.

The finding was that `new Date('2026-08-23')` parses as UTC midnight, so formatting a `'YYYY-MM-DD'`
string in `America/Toronto` renders the previous day. Every user of this app is in a negative offset
by default, so it was a bug that showed up immediately rather than an edge case. The remedy was to
build the `Date` from its three parts or to pass `timeZone: 'UTC'` to the formatter, and the shipped
formatting idiom it applied to is `new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' })`
in `admin/users.vue`. **That was correct and it caught the trap in shipped code before it cost
anything**, so it is kept here as the record of a live hazard in this codebase rather than removed
along with the paragraph that needed it. `AC7` keeps it in mind for the same reason, which is that
nothing else in the app has learned it yet.

**A second bug the removal takes off the table, which this document had not reached.** A French date
wants `1er` for the first of the month, and `Intl.DateTimeFormat` produces no French ordinal at any
`dateStyle`. So the first of a month would have rendered as `1 septembre` where a reader expects
`1er septembre`, and the only fix is hand-patching the formatter's output for one day in twelve, in
one locale. The primary user is a professional translator, so that is the kind of small wrongness
that costs trust rather than the kind nobody notices. Removing the date removes the problem instead
of solving it, which is a genuine gain from the architecture change rather than a coincidence, and
it is worth saying so plainly.

So nothing in this section formats anything now. Both provenance states are static localized
strings, and the only presentation logic left in the help region is choosing between two of them on
`source`.

## Colour, the label is the carrier and it is reused

The label takes its category colour, through the mechanism `PLAN-32c` already shipped. No second
treatment is invented.

The mechanism is `.planning-cat-name` in
[`main.css`](../../../app/assets/css/main.css), which sets
`color: oklch(var(--planning-cat-l) var(--planning-cat-c) var(--planning-cat-hue))`. Lightness and
chroma are fixed once per mode in that file, and the hue arrives inline as `--planning-cat-hue` read
from `categoryHue` in the shared contract. `TaskRow.vue` and `TaskEditor.vue` are both already readers
of it, so this section is a third reader of one contract rather than a second copy of a mapping.

So the `#label` slot holds one span, `class="planning-cat-name"` plus
`:style="{ '--planning-cat-hue': categoryHue(entry.categoryId) }"`, with the text coming from
`t('categories.' + entry.categoryId)` per `AC7`.

**Reading `categoryHue` in the component is correct and is not the thing `AC10` forbids.** `AC10`'s
guard is that nothing under `app/` resolves a **quota** from a category id or a stored row. A hue is
not a quota, it is the colour a name is printed in, and the contract's own header names the client
components as its readers. The distinction is worth stating so the code review stage does not read the
guard more widely than it is written.

### The contrast, measured on the surfaces this card actually has

The card is `bg-default` in both modes. The
[coloured-names blueprint](category-column-coloured-names-design.md) measured all twenty card surfaces
at the same fixed lightness and chroma, and two of its four blocks are exactly this card.

**Light, `bg-default`, which is `#ffffff` identically in all five themes.**

| Category            | ratio  |
| ------------------- | ------ |
| `translation`       | 6.31:1 |
| `revision_internal` | 6.53:1 |
| `revision_external` | 6.67:1 |
| `proofreading`      | 6.52:1 |

**Dark, `bg-default`, which is `neutral-900` and varies by theme. The worst cell of each row is
quoted.**

| Category            | worst  | theme  |
| ------------------- | ------ | ------ |
| `revision_external` | 7.48:1 | pastel |
| `proofreading`      | 7.51:1 | pastel |
| `revision_internal` | 7.65:1 | pastel |
| `translation`       | 7.76:1 | pastel |

So the worst reading anywhere on this card, across both modes, all five themes and all four trackable
categories, is **6.31:1**, against a 4.5:1 floor for 14 px regular text under WCAG 2.2 AA 1.4.3. The
label is `font-medium` here rather than `font-normal` as it is on the task row, which changes nothing
about the measured ratio and only helps how it reads.

**This card is not where the tight cells are.** The whole set's worst cell is 5.07:1, `translation` on
an automne off-day planning card in light, which is `bg-elevated`. This section never uses
`bg-elevated`, so it sits comfortably inside a floor that was already cleared on a harder surface.

**A category that does not exist yet passes too.** The same blueprint measured every integer hue from
0 to 359 at these fixed values against all twenty surfaces, with the worst reading anywhere being
5.02:1 in light and 6.07:1 in dark, and both of those worst cases are on `bg-elevated` rather than
here. So a hue `PLAN-30` hands a user is readable on this card by construction, with no new
measurement and no curated list of approved colours.

**One number to re-check on the built page**, since re-measuring the matrix would be pointless. Put
`translation` in light mode on this card and confirm 6.31:1. If that holds, the mechanism is wired to
the same custom properties as the task row and every other cell follows.

### The naming oddity, stated rather than fixed

`.planning-cat-name` is a global unlayered class in `main.css` and it is not scoped to the planning
page, so using it on the settings page is correct. The name is now slightly wrong, since the thing it
describes is an app-wide category treatment rather than a planning one. Renaming it touches `main.css`,
`TaskRow.vue` and `TaskEditor.vue`, which is three shipped files edited for a rename inside a feature
that has nothing to do with them, so it is left alone and recorded in
[what this leaves for later](#what-this-leaves-for-later).

## The controls

### The number input

`UInputNumber` with `class="w-full"` and `:ui="{ base: 'tabular-nums' }"`.

- `w-full` fills the grid cell, so the inputs form clean aligned columns and the section reads as a
  list of figures. It is also exactly what the shipped quota field on `work-fields.vue` does, so this
  is zero deviation.
- `tabular-nums` on the `base` slot rather than on `class`, because `class` lands on the
  `relative inline-flex` root and the digits are in `base`. A column of three and four digit figures
  that do not shift width is easier to compare, and `tabular-nums` is already the idiom on the admin
  table's numeric cells.
- `size` is left to the app default, which `app.config.ts` pins to `md` for `inputNumber`. No per-field
  size override.
- `:min="1" :max="10000"`, mirroring `quotaWphSchema`.
- Default orientation, matching every other number input in the app.

**`:min="1"` is data validity and not policing.** The quota is the divisor in
`estimated = words / quota`, so zero stores a row that divides by zero the moment `PLAN-12` reads it.
That is the same distinction the spec draws when it rejects a non-trackable `categoryId` with a `422`,
which is that the value would be meaningless rather than merely unusual. Inside the range nothing is
questioned, nothing is warned about, and no figure is refused for looking wrong.

**One thing left for the accessibility stage, with the remedy named.** At the default vertical
orientation the increment and decrement chevrons are stacked inside the control's height and carry
`scale-80`, so each one is well under the 24 by 24 CSS pixels WCAG 2.2 AA 2.5.8 asks for. Two things
about that. It is not new, since every number input in the app already has it, so fixing it here alone
would put a second number-input idiom on the same page as Work. And 2.5.8 has an exception where an
equivalent control exists, which it does, because the field itself accepts a typed value and is the
primary way anyone enters a four digit number. If the stage decides that exception does not carry it,
the remedy is `orientation="horizontal"`, which puts a full-height minus and plus at each end of the
control and clears the target size without touching the width. Raise it on all the number inputs at
once rather than on this section.

### The submit

One control, right-aligned, in a `div class="flex justify-end"` after the grid.

`UButton class="btn-glow" color="primary" icon="i-ph-check-bold" :label="t('settings.quotas.submit')"
:loading="savingQuotas" type="submit"`.

Character for character the shipped submit on both other sections, with the label key swapped. The
`:loading` binding is the convention that a slow write is never mistaken for a dead button.

### The zero-entry state

If the response is an empty array, the card renders one line of muted text, `settings.quotas.empty`,
and no form and no submit.

This cannot happen today, because the four trackable ids are frozen in the contract. It can happen
once `PLAN-30` lets a user mark every category non-trackable. Rendering a form with no fields and a
save button that saves nothing is a small dead end, and the convention against invalid states says not
to ship one. This is an assumption rather than a spec instruction and it is recorded as such.

Leaving out the submit here is not policing. There is no value being refused, there is simply no field
to submit.

## How the layout behaves at 1, 4 and 20 rows

The grid is `grid-cols-1 sm:grid-cols-2` and nothing in it counts rows, so all three cases are the
same layout with a different number of children.

- **One row.** Single column on mobile. At `sm` and up the one cell occupies the left column and the
  right column is empty. Slightly lopsided and not broken, which is how any responsive grid behaves
  with one child. Nothing is centred or stretched to hide it, because a special case for one row is a
  special case that has to be maintained.
- **Four rows, which is today.** One column on mobile, two by two at `sm` and up. The card is about
  the same height as the Work card, so the page reads as three comparable sections.
- **Twenty rows.** One column of twenty on mobile, ten by two at `sm` and up. The section becomes tall
  and the page scrolls. Nothing overflows, nothing truncates, no cell changes size, and the submit
  stays at the end of the form where it belongs.

**The honest cost at twenty.** Ten grid rows is roughly 900 pixels of form, so the submit is off
screen while the user is editing the first few figures. That is acceptable for a settings section and
it is not worth a sticky footer, because the section is saved once after a deliberate edit rather than
repeatedly. If the count really grows that far, the answer is `PLAN-30`'s own category screen owning
the quota next to everything else about a category, not a scroll affordance bolted onto this section.
That wish is recorded rather than designed.

**Why two columns rather than one.** At `max-w-xl` a single column gives a four digit number an input
480 pixels wide, and it doubles the height of a section whose fields are small. Two columns halve the
height at every count above one and give each field a 250 pixel cell, which is comfortable for the
longest shipped label plus the unit. It is also the only decision here that improves as the list grows.

**Why not three columns at `lg`.** The page wrapper is capped at `max-w-xl`, so `lg:` changes nothing
today and a third column would be dead code written against a page width that does not exist. If the
settings page is ever widened, `lg:grid-cols-3` is the change, and it is one class.

### Long names, which is the twentieth category's real risk

A user-created name can be much longer than any of the shipped ten. The labelWrapper is
`flex justify-between gap-1`, so a long label squeezes the unit unless it is told not to.

`:ui="{ label: 'min-w-0 break-words', hint: 'shrink-0' }"` on the `UFormField`. The label wraps onto a
second line and the unit keeps its width.

**No truncation anywhere.** The task row already refuses to truncate a category name, because
`Révision interne` and `Révision externe` differ only in their last word, and the same holds here with
the extra point that a truncated label on a form control is a label the user cannot read. A cell that
grows one line taller is the cheaper failure.

## Responsive behaviour

The page wrapper handles horizontal padding and the maximum width, and neither changes.

- **Base, from 320 px.** Single column grid. Each field is label and unit on one line, the input on
  the next, the provenance under it. At 320 px the cell is about 270 pixels wide, which holds
  `Révision interne` and `mots/heure` on one line with room to spare, and holds the default badge on
  its own line comfortably. The input is full width, which on a phone is the right size for a number
  keypad entry.
- **`sm` and up.** Two columns, `gap-x-6`. Cell width about 250 pixels at the capped page width.
- **`lg` and up.** No change, because the page is capped at `max-w-xl` well below the `lg` breakpoint.
  The `lg:px-8` on the wrapper still applies and is inherited unchanged.

The mobile case is the one the three-line field shape was chosen for. Putting the provenance under the
input rather than beside the label means a long category name and its provenance never compete for the
same 270 pixel line, which is what a right-aligned provenance marker would have done. That was written
when the provenance could be a formatted date, and it holds just as well now that the longest thing it
can be is a short sentence, since a user-created category name is the half that can grow without limit.

## Motion

**The section adds none.** No transition, no reveal, no animated state change.

The only transition anywhere in it is the shipped `.btn-glow` on the submit, which is
`transition: box-shadow 0.2s ease` in `main.css` with a `box-shadow` ring on hover. Two honest notes
about it rather than a claim. In this project `.btn-glow` is the box-shadow ring and not the spinning
conic-gradient variant described in the styling conventions, and it is not currently behind a
`prefers-reduced-motion` query. A 200 ms shadow fade on hover is not vestibular motion, so that is
defensible as it stands, and in any case it is shipped behaviour on two existing buttons that this
section inherits rather than introduces. There is nothing new here to gate.

## Key Tailwind decisions

- **Section wrapper.** `space-y-4`. Matches Work and Security exactly, so the three sections share one
  rhythm.
- **Section heading.** `flex items-center gap-2 text-lg font-semibold text-highlighted`. Copied. Not
  re-clamped, because the page's `h1` carries the fluid size and the `h2` deliberately does not
  compete with it.
- **Subtitle.** `mt-1 text-sm text-muted`. Copied.
- **Card.** `rounded-2xl bg-default ring ring-default`. Copied, and a ring rather than a border per the
  conventions.
- **Quota grid.** `grid grid-cols-1 gap-x-6 gap-y-[clamp(1rem,2.5vh,1.5rem)] sm:grid-cols-2`. The
  vertical gap is fluid so a tall viewport gets more air between rows and a short one gets less, which
  matters more here than anywhere else on the page because this is the section whose height grows with
  the data. The horizontal gap is fixed, because a column gutter that changes with viewport height
  would be nonsense.
- **Skeleton block.** The same grid, holding `USkeleton class="h-4 w-32"` over
  `USkeleton class="h-9 w-full"` per placeholder, so the pending state occupies the loaded state's
  footprint.
- **Category label.** `planning-cat-name` on a span inside `#label`, with `--planning-cat-hue` set
  inline. The `UFormField` theme's own `block font-medium text-default` stays on the `Label` element
  and the span sets its own colour, so there is no specificity contest and no `!important`.
- **Field overrides.** `:ui="{ label: 'min-w-0 break-words', hint: 'shrink-0' }"`. The one reason is
  long names, above.
- **Input.** `class="w-full"` with `:ui="{ base: 'tabular-nums' }"`.
- **Provenance badge.** `UBadge color="neutral" variant="subtle" size="sm"`. No utility classes at
  all. The `help` slot already provides `mt-2 text-muted`.
- **Submit row.** `flex justify-end`. Copied.
- **Tokens only.** `bg-default`, `ring-default`, `text-highlighted`, `text-muted`, `text-primary`, and
  the `neutral`, `primary` and `error` component colours. The one non-token colour in the section is
  the category name, which is the sixth fixed role `main.css` already declares and which flips its
  lightness and chroma per mode there. No hex, no raw palette colour, nothing that needs a
  `dark:` variant of its own.

## Component hierarchy

```
- div (page wrapper, unchanged)
  - div (page header, unchanged)
  - section (Work, unchanged apart from losing one field)
  - section aria-labelledby="settings-quotas-heading" (space-y-4)
    - div
      - h2#settings-quotas-heading (flex items-center gap-2 text-lg font-semibold text-highlighted)
        - UIcon name="i-ph-target-bold" (size-5 text-primary)
      - p (mt-1 text-sm text-muted) -> settings.quotas.subtitle
    - UCard (rounded-2xl bg-default ring ring-default)
      - div role="alert" (v-if error)
        - UAlert color="error" variant="subtle" icon="i-ph-warning-circle"
          - title -> settings.quotas.loadError
          - action -> UButton color="neutral" variant="outline" -> settings.quotas.retry
      - div (v-else-if pending, same grid as the form)
        - USkeleton x2 per placeholder cell
      - p (v-else-if the response is empty, text-sm text-muted) -> settings.quotas.empty
      - UForm (v-else, :state, space-y-6)
        - div (the quota grid)
          - UFormField (v-for over the response, :key and :name from categoryId)
            - #label -> span.planning-cat-name -> t('categories.' + categoryId)
            - hint prop -> onboarding.work.unitWph
            - UInputNumber (w-full, :min="1", :max="10000", tabular-nums)
            - help prop -> settings.quotas.defaultBadge or settings.quotas.userValue
            - #help -> UBadge color="neutral" variant="subtle" size="sm" (default source only)
        - div (flex justify-end)
          - UButton.btn-glow color="primary" icon="i-ph-check-bold" :loading -> settings.quotas.submit
  - section (Security, unchanged)
```

Every component in that tree is a Nuxt UI 4 primitive already used elsewhere in this app. The section
introduces no custom component. Whether it lives inline in `app/pages/settings.vue` or in a
`components/settings/` component of its own is the frontend stage's call, and either is fine, since
unlike `work-fields.vue` this has no second surface to share with now that onboarding is dropping the
question.

## Icons

Three, all Phosphor, all already in the app.

| Icon                  | Where                  | Why                                       |
| --------------------- | ---------------------- | ----------------------------------------- |
| `i-ph-target-bold`    | The section heading    | A quota is a target rather than a reading |
| `i-ph-warning-circle` | The load-failure alert | The shipped alert icon on this page       |
| `i-ph-check-bold`     | The submit button      | The shipped submit icon on this page      |

No icon on the provenance badge, and no icon on the provenance text. An icon whose meaning nobody can
guess is decoration that the accessibility stage then has to decide about, and the words already carry
it.

## Onboarding, confirming the removal leaves a coherent step

`AC7` removes the quota question from the work step entirely and does not replace it. This stage owes
only a confirmation that what is left still reads.

It does. The step keeps three fields, which are the daily hours pair, the Monday-first work-day
toggle, and the timezone select. All three are in one `flex flex-col gap-6` column, all three are
`UFormField` siblings, and removing the third of four leaves no hole, no orphaned heading, and no
layout that was balanced around four items. The step is arguably better, since the two remaining
numeric decisions are both about time and the quota was the one field about words.

One string does not survive the removal. `onboarding.steps.work.subtitle` reads
"Vos heures, vos journées et votre quota." and names a field that is gone. `AC8` already requires it
reworded in both locales with FR marked research, and this stage has nothing to add beyond confirming
the sentence has exactly one wrong word in it.

`step-work.vue` and `work-fields.vue` hold their own copies of the same three surviving fields rather
than one sharing the other. That predates this feature, `AC3` lists both files, and it is not this
design's to resolve.

## The task editor's quota field under the snapshot model

**New in this amendment, and the one thing the architecture change asks this stage to decide fresh
rather than correct.** The frontend stage is researching the string itself in parallel, so what
follows is the design intent behind it, meaning what the field now communicates and how it should
read. No candidate copy is written here, for the reason given under
[the FR strings](#the-fr-strings-and-why-none-of-them-is-written-here).

**What actually changed about the field is the data and not the markup.** Field 11 of
[`TaskEditor.vue`](../../../app/components/planning/TaskEditor.vue) keeps the same `UFormField`, the
same `UInputNumber`, the same `:min="1"`, the same `onboarding.work.unitWph` hint, and the same
`planning.editor.fields.quotaHint` help prop. What changed is what arrives in it. The field used to
be normally empty, and empty meant "use the category's figure". Under `AC12` the server writes the
resolved figure onto every task in a trackable category, so the field is now normally populated, and
the number in it is this task's own target.

**So the hint has a job it did not have before, which is to say what clearing the field does.** The
old string described the empty state because empty was the resting state. Empty is now the
exceptional state, and it is the only one the user can create deliberately, by clearing a number the
server put there. So the hint describes the populated state as normal and names clearing as the
action that has a consequence. `AC8` asks for the same thing in its copy table, and this is the
reasoning under it.

**Design intent, as three claims the string has to carry.**

1. **The number is this task's target rather than a setting.** It was taken from the category when
   the task was written and it belongs to the task from then on. The line should read as a fact
   about this row, not as a pointer at a preference living somewhere else.
2. **It is editable, and typing over it is ordinary.** Nothing about a server-written figure makes
   it more precious than one the user typed, and the copy should not imply otherwise.
3. **Clearing it hands the row back to the category setting.** That is the way back out of a
   snapshot, and the spec's edge cases call it a legitimate thing to want, so it reads as an
   available action rather than as a warning about losing something.

**Does the field read as editable? Yes, and nothing needs adding to make it so.** It is a
`UInputNumber` at the app's default `md` size, sitting in a grid of eleven other editable fields,
with no `readonly`, no `disabled`, and no visual difference from the word count beside it. A
populated number in an enabled input reads as editable to anyone who has used a form. The risk in
this field was never that the user would think it was locked, so there is no case for a pencil
affordance, an edit toggle, or a two-step reveal, all of which would make a plain number field
ceremonial for nothing gained.

**Should the screen distinguish a server-written figure from one the user typed? No, and that is a
finding rather than a design.** The want is real, because a user in front of a populated field
cannot tell whether they chose that number last week or the server wrote it, and those are different
situations. But the spec records that
[one column cannot hold both facts](per-category-quotas.md#the-field-the-snapshot-lives-in-and-why-it-is-the-existing-one).
`tasks.quota_wph_override` stores a number and nothing about where the number came from, so the
distinction is not in the data and no arrangement of pixels can render it. Raising it is the whole
of what this stage can do about it.

Three things follow, and they are why it is a finding rather than a complaint.

- **No second column here, and no inference in the client.** The tempting workaround is to compare
  the task's figure against the category's current setting and label them same or different. That is
  a rule applied inside a component to decide a label, which is what the
  logic-belongs-to-the-backend convention forbids, and it is wrong on its own terms as well, since a
  user who types the number the category already held is indistinguishable from a user who touched
  nothing. The spec names that same ambiguity in its own edge cases.
- **The cost of not having it is small, which is why it must not force a column.** The number is
  visible, it is editable, and getting it wrong costs one field edit. The spec's own reversal path
  is a small `quota_wph_source` column if a later feature genuinely needs the provenance, and that
  is cheaper than carrying two numeric columns from the start against the chance that one will.
- **If a later stage decides the distinction is needed, the design already exists.** It is the same
  two-state help region this document specifies for the settings section, a badge for the
  server-written figure and plain words for a typed one, reading a `source` the response would have
  to start carrying. So the screen is ready for the fact whenever the data can supply it, and
  nothing in the current design has to be unpicked to get there.

**One thing the field should not gain.** No copy explaining the snapshot model, no note naming which
category setting the number came from, and no date. The editor is a grid of twelve fields inside a
day row, the hint is one line of muted text under a small input, and a sentence about how historical
accuracy works in this app neither fits there nor answers what the user is asking of the field. The
settings section is where the category figure gets explained. This hint has room for what the number
is and what clearing it does, and that is the whole budget.

## Copy

Keys under `settings.quotas.*`, siblings of `settings.work.*`, following the shape of
[`fr.json`](../../../i18n/locales/fr.json). `AC8`'s table is reused as written and not paralleled.

### From `AC8`, unchanged

| Key                              | EN intent                                         | FR                                           |
| -------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `settings.quotas.heading`        | Quotas                                            | Quotas                                       |
| `settings.quotas.subtitle`       | Your target words per hour for each kind of work. | **RESEARCH**                                 |
| `settings.quotas.submit`         | Save                                              | Enregistrer                                  |
| `settings.quotas.success`        | Your quotas have been saved.                      | **RESEARCH**                                 |
| `settings.quotas.loadError`      | Your quotas could not be loaded.                  | **RESEARCH**                                 |
| `settings.quotas.retry`          | Try again                                         | Réessayer                                    |
| `settings.quotas.errors.generic` | Something went wrong. Please try again.           | Une erreur est survenue. Veuillez réessayer. |
| `settings.quotas.defaultBadge`   | Default value                                     | **RESEARCH**                                 |

`Enregistrer`, `Réessayer` and the generic error are copied verbatim from the shipped
`settings.work.*` keys, so those three are settled. `Quotas` is the same word in both locales.

### Two keys this design adds, and why each is the missing half rather than a parallel

| Key                         | EN intent                                  | FR           |
| --------------------------- | ------------------------------------------ | ------------ |
| `settings.quotas.userValue` | Your value.                                | **RESEARCH** |
| `settings.quotas.empty`     | No kind of work currently carries a quota. | **RESEARCH** |

`userValue` exists because `AC8` names a marker for the default case and none for the user case, and
[the reasoning above](#why-the-two-states-are-deliberately-unequal-in-weight) argues that an absence
cannot carry the other half. It takes no parameter. It does not duplicate `defaultBadge`, it is the
state `defaultBadge` is not.

**Superseded.** This key was `settings.quotas.userSince`, reading "Your value, in effect since
{date}." and taking a `{date}` parameter the component formatted. `AC8` renames it to the
parameterless `settings.quotas.userValue`, which is exactly the fallback the last section of this
document had already recorded against the possibility that the owner did not want a date on the
screen, so the rename takes an option that was written down rather than inventing a string. If
`userSince` has already landed in either locale file on this branch, `AC8` requires it renamed
rather than left sitting beside the new key.

`empty` exists for the zero-entry state, which cannot happen today. Both are recorded under
[assumptions](#assumptions-taken-rather-than-asked).

### The FR strings, and why none of them is written here

Every FR cell marked **RESEARCH** is for the frontend stage to establish in Québécois French, and
**none of them is a translation of the English cell**. The English column above is the intent and not
the source text. The primary user is a professional translator, so a confidently wrong French string
reads as a defect in the product rather than as a rough draft, and a flagged gap costs a research pass
while a wrong string costs trust. This stage deliberately writes no candidate, because a candidate
sitting in a blueprint is what gets copied instead of researched.

Two mechanical points that do apply to whatever the researched strings turn out to be.

- **A real U+00A0 before `? ! : ;`.** `test/i18n/locale-punctuation.test.ts` enforces it with its own
  positive controls, and a plain space is visually identical to a no-break space in an editor and in a
  diff. The string that used to carry this risk was `userSince`, and `userValue` replaces it with two
  words and no punctuation to get wrong, so **the risk moves rather than going away and the sentence
  needed rechecking rather than deleting.** In this feature it now sits on the reworded
  `planning.editor.fields.quotaHint`, whose current FR string is "Vide : le quota de la catégorie." with
  a real U+00A0 before the colon in [`fr.json`](../../../i18n/locales/fr.json), and whose replacement is
  the one new string most likely to keep a colon. Check that one first. Then check the four researched
  cells in the table above that are full sentences, which are `subtitle`, `success`, `loadError` and
  `empty`, since any of them can come back from research carrying one of the four marks.
- **FR and EN key sets are identical**, in both directions, enforced by the same test file. Every key
  in the two tables above lands in both locale files in the same commit.

`onboarding.work.unitWph` ("mots/heure") is reused unchanged as the per-field unit, which is exactly
what `AC8` says happens to it. Its namespace becomes a naming oddity once the onboarding step drops
its quota, and `AC8` already records that as known and not worth the churn.

`onboarding.work.quota` and `onboarding.steps.work.subtitle` are `AC8`'s to remove or reword and this
design adds nothing to them. **`planning.editor.fields.quotaHint` is no longer one of those.** The
snapshot model turned it into a hint on a different field, so the design intent behind its rewording is
set out in
[the task editor's quota field](#the-task-editors-quota-field-under-the-snapshot-model) rather than left
to the copy alone.

## Accessibility, what is answered here and what is left

Answered by construction.

- **Every control has a real label**, through `UFormField`'s `Label` with `:for`. The `#label` slot
  changes what is inside the label and not whether there is one.
- **The unit and the provenance are both announced**, because both come through props and therefore
  reach `aria-describedby`. That is the finding in
  [which slot each one takes](#the-label-the-unit-and-the-provenance-and-which-slot-each-one-takes)
  and it is the single easiest thing to get silently wrong in this section.
- **Provenance is words, never colour.** Both states are readable with all colour removed.
- **The 4.5:1 text floor holds with margin.** Worst reading on this card is 6.31:1, measured rather
  than assumed, on the surfaces this card actually has.
- **The section heading is an `h2` with `aria-labelledby` on its `section`**, third in a page with one
  `h1` and three `h2` elements in document order.
- **The load failure is a `div role="alert"` around a `UAlert`**, the shipped pattern on this page.
- **Success and failure of the save go to a toast**, through `UApp`'s live region, which is how the
  other two sections already announce.
- **Nothing is disabled and nothing is refused** except the schema's own bounds, so there is no state
  where a control is present and inert without saying why.

Left for the accessibility stage, both named with a remedy.

1. **The stepper target size on `UInputNumber`**, discussed under
   [the number input](#the-number-input). App-wide rather than this section's, exception argument
   given, remedy named.
2. **Whether the toast alone is enough for a save that partially persisted.** The reconcile makes the
   result visible on screen, and a sighted user sees a badge come back on the row that did not land. A
   screen reader user hears the generic failure toast and would have to walk the fields again to find
   out which. That is the shipped behaviour of the Work section too, so it is a page-level question
   rather than this section's, and it is raised here because this is the first section where a save can
   partially succeed.

## Assumptions taken rather than asked

Recorded under their own heading because no question could be asked during this stage. Each is the
smaller of the options available.

1. **The Quotas section sits between Work and Security.** The quota used to live inside Work.
2. **The unit takes the `hint` prop and the provenance takes the `help` prop.** `AC7` requires the
   unit hint on each input and says a default must be marked, and it does not say where either goes.
   This split is the only arrangement where both are announced without an `aria-hidden` anywhere.
3. **The provenance for a user-set value is words and carries no parameter**, reading `source`,
   which is the only field the response has left. **Superseded assumption**, since this used to say
   the provenance names its effective date from `effectiveFrom`. What replaced it is smaller rather
   than different in kind, because both versions are read-only text in the same place and neither is
   a control. See [what the effective dating left behind](#what-the-effective-dating-left-behind).
4. **The two provenance states are unequal in weight**, a badge for a default and plain text for a
   user value.
5. **The category labels take their category colour**, which answers spec open question 4 in the
   affirmative with the contrast measured.
6. **Two new i18n keys**, `settings.quotas.userValue` and `settings.quotas.empty`. The first was
   `settings.quotas.userSince` and is renamed by `AC8`.
7. **A zero-entry empty state**, which is unreachable today and reachable after `PLAN-30`.
8. **The skeleton shows four placeholder cells**, which is a guess and not a count the layout depends
   on.

## What the effective dating left behind

**Superseded in full, and kept because it is the record of what this section deliberately did not build
while the architecture still had dates in it.** Under the snapshot model there is no effective dating
anywhere, so nothing below constrains the build any more. It is left standing rather than cut so that a
reader coming to the diff can see which restraints were decisions and which were only the absence of a
feature.

**What it said, and what is left of each part.**

- **No date control anywhere in the section.** Still true, and now true for a duller reason. It used
  to be a deliberate restraint against a table that could have taken a backdated row. There is no
  backdated row to take, so it is not a decision any more.
- **An edit is implicitly effective from today, decided server-side with `todayInZone`.** Void. A
  save updates the user's single row in place, and `AC6` takes `todayInZone` and the
  `loadWorkSettings` call out of both handlers, because nothing in the resolution asks what day it
  is.
- **The history exists in storage with no way to browse it.** Void, and this is the sentence the
  architecture change contradicts most directly. `category_quotas` now holds one row per user and
  category, so there is no accumulated history in that table at all. What preserves a past period is
  the figure sitting on each task, and that is not a history anybody browses either. It is just the
  number that row was measured against.
- **The next feature inherits a table with real history and no reader for it.** Void. `PLAN-23`
  inherits a current setting plus a per-task figure, so nothing is piling up in that table for it to
  read, and the provenance line here is no longer the element a history affordance would hang from.
- **Two dates and no picker is a deliberate asymmetry.** Void, since there are no dates.

**What replaced the guarantee, because the guarantee itself did not go anywhere.** `AC2` keeps the
requirement word for word, which is that editing a quota never changes what an already-reported
period was measured against, and the figure stored on the task is what delivers it now. So this
subject moved off the settings screen and into the task write path, which is why this design has
less to say about it than it did rather than more.

## What this leaves for later

Wishes this design generated and stopped at, per the boundary against absorbing scope.

1. **`PLAN-30` has to collect a quota when a user creates a trackable category.** The spec already
   says `defaultQuotaWph` returns `null` for an id outside the four, so the resolver has no third step
   for a user-created category. This design assumes every entry the response carries has a number in
   it. If `PLAN-30` can produce a trackable category with no quota at all, this section needs a third
   provenance state saying so, and that state is `PLAN-30`'s to design because it is the feature that
   creates the condition.
2. **A user-created category has no `categories.<id>` key.** The label here resolves from i18n by id
   per `AC7`, so an id with no key renders as a raw dotted string. Naming a user-created category is
   `PLAN-30`'s form and its storage, and how that name reaches this label is its call.
3. **A quota history view, which this amendment removes rather than defers.** There is no stored history
   to view under the snapshot model, so the wish lost its subject rather than its priority. The nearest
   thing left is a task's own figure, which the editor already shows and already lets the user change.
4. **Per-field inline errors from the `422`.** The write goes through `sendZodError` with per-field
   data, and this section shows a generic toast, because the client-side bounds make a `422` nearly
   unreachable. Mapping the response's per-field data onto `UForm.setErrors` is a small improvement
   with no current trigger. The `:name` on each `UFormField` is set from the category id so it is
   already there when someone wants it.
5. **Renaming `.planning-cat-name`** to something app-wide, once a feature is touching those files for
   its own reasons.
6. **`lg:grid-cols-3`**, if the settings page is ever widened past `max-w-xl`.
7. **A category screen owning the quota**, which is the real answer if the list ever reaches twenty.
8. **A `quota_wph_source` column**, if a screen ever needs to tell a server-written task figure from one
   the user typed. Raised as a finding under
   [the task editor's quota field](#the-task-editors-quota-field-under-the-snapshot-model), where the
   spec's own reversal path is named. Not this feature's, and not designed here beyond the note that the
   two-state help region this document already specifies is what would render it.

## What I think the spec got wrong

Four small things, none of which blocks anything.

1. **`AC7` asks for the unit hint on each input and for the default to be marked, without noticing the
   two want the same slot.** `UFormField` has one hint and it is the shipped home of the unit today.
   The split above resolves it, and it is worth naming because the obvious reading of `AC7` is to put
   both in the hint, which loses one of them.

2. **`AC8`'s copy table marks the default and not its opposite.** A marker on one state only leaves the
   other as an absence, and an absence cannot distinguish a value the user set from a row the section
   has nothing to say about. `settings.quotas.userSince` is the missing half rather than a
   disagreement.

3. **`AC7` describes the section as editing "the four quotas" throughout.** The mechanism it specifies
   is dynamic and the count is not, and the spec's own extensibility section is emphatic that nothing
   should assume the number. The prose is a shorthand rather than a requirement, so this design reads
   it as dynamic, and the phrase is flagged so a later stage does not build a four-field form from it.

4. **Superseded, and it is the finding that resolved itself.** This item argued that the spec
   shipped `effectiveFrom` without noticing it could reach the screen, and that putting the date on
   the provenance line turned an absence into a fact. The architecture change removed the field, so
   there is nothing left to disagree about. The part worth keeping is the item's last sentence,
   because the fallback it named is what `AC8` went on to take. This document wrote the no-date
   option down, the owner's change made it the only option, and the string it becomes is
   `settings.quotas.userValue`. So the correction cost one key rename and nothing else about the
   section moved, which is what that fallback promised it would cost.

   The first three items above stand as written, and the snapshot model touches none of them.
