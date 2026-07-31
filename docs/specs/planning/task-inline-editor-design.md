# Design: the inline task editor

The visual blueprint for [`task-inline-editor.md`](task-inline-editor.md). That spec owns the field
list, the copy, the interaction rules, and the recovery behaviour, all approved. This document
resolves how the thing looks and where it sits. It writes no Vue and edits no component.

The governing constraint is the owner's own reason for the collapsed row. It "minimizes mental
clutter" and "needs to show minimal relevant info at a glance". So the row gains one figure fewer
and one glyph, and everything else this feature adds lives inside a panel that only exists while the
user is editing.

The shipped visual language is [`extend-tasks-design.md`](extend-tasks-design.md) and the components
built from it. Nothing here re-decides any of it. Two of its notes were addressed at this stage by
name, the category selector reading the same colour contract and the reserved action track, and both
are answered below.

## Superseded passages, do not implement

Ten passages carry their original text inside a blockquote marked **Superseded**. That text is
history and is kept on purpose. The live answer always sits immediately above each note, and it is
the one to build from. Reasons live in the notes and are not repeated here.

Two contract changes landed after this document was written. The tenth category, `other`, is
preselected on every new draft, which killed every no-category state. And `trackable` split into
`trackable` and `deliverable`, which moved the rule for the words cell and for the `Statut`
`:disabled` binding. `other` is `trackable: false` and `deliverable: true`, so it is the one member
where the two disagree, and it is the member every stale passage got wrong.

| Historical passage                               | Where it is                                                                       | The live answer                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| The two-branch panel border                      | [The panel box](#the-panel-box)                                                   | `.planning-cat-edge` unconditionally                  |
| The transparent draft edge                       | [The coloured left edge](#the-coloured-left-edge-and-the-live-colour-requirement) | The edge binds to the model, never to a coerced value |
| The `USelectMenu` placeholder and `v-else`       | [The category selector](#the-category-selector)                                   | One `#default` branch, no placeholder                 |
| "There is no preselected value"                  | [The category selector](#the-category-selector)                                   | The field always holds a value and reads plain        |
| `:disabled="!categoryChosen \|\| !dirty"`        | [The save control](#the-save-control)                                             | `:disabled="!dirty"`                                  |
| The `AC51` typeahead hazard and its wording      | [Focus treatment](#focus-treatment)                                               | No hazard on `Combobox`, and none to guard            |
| The two-branch border, restated                  | [Key Tailwind decisions](#key-tailwind-decisions)                                 | Same as the first row                                 |
| The words cell keyed on `trackable`              | [The words cell becomes one figure](#the-words-cell-becomes-one-figure)           | Keyed on `deliverable`                                |
| `Statut` framed on non-trackability              | [Statut on a non-deliverable category](#statut-on-a-non-deliverable-category)     | `:disabled` reads `isDeliverableCategory`             |
| The widget table's `Statut` and `Catégorie` rows | [The widgets](#the-widgets)                                                       | Non-deliverable, and always a value                   |

## The problem this layout is solving

A thirteen-field form has to open inside a read-only table that is already at its minimum width, and
it has to do that without breaking the table's semantics, without moving a single column of the rows
above it, and without adding a third copy of the grid template that the day card header and the task
row already share.

That is the whole difficulty. Everything else in this feature is ordinary form work.

## Layout regions

Top to bottom, with the three new regions marked.

1. **Page container.** Unchanged.
2. **The week stack.** Seven day cards, unchanged.
3. **The day header band.** Unchanged in geometry. Every day now carries the disclosure control,
   including an empty one.
4. **The disclosure region.** Now a query container, and now holding two children rather than one.
5. **The table scroller.** Unchanged, except that the words track narrows and the minimum width
   comes down with it.
6. **The task rows.** Unchanged, except for the words cell, the note marker, the click target, and
   the two new visual states, hovered and open.
7. **The editor panel, new.** A sibling row inside the rowgroup, directly beneath the row it edits.
8. **The day footer block, new.** Outside the scroller. Holds the empty-day line, the draft editor,
   and the add control.

## The central decision, where the editor panel sits

**The edit panel is a sibling `role="row"` in the same rowgroup, holding exactly one
`role="cell"` with `aria-colspan="6"`, and that cell is `position: sticky` at `left-0` and sized to
the card's visible width with a container query unit rather than to the table's minimum width.**

That is four separate decisions and each one is load-bearing.

### Why it is a row in the rowgroup rather than anything else

The collapsed row has to stay directly above the form, which the spec requires and which is what
keeps the row's identity on screen while its own fields are being edited. Inside a
`role="rowgroup"`, the only legal child is a `role="row"`, so a panel that sits between two rows is
a row or it is invalid. The three alternatives were considered and each fails.

- **A `role="presentation"` wrapper around the panel.** Presentation removes the element from the
  accessibility tree and reparents its children, so the form would become a direct child of the
  rowgroup, which permits only rows. Invalid, and invalid in a way no screen reader recovers from.
- **Closing the table and opening a second one after the panel.** Every open editor would split one
  day into two tables, and the second table would either lose its column headers or carry a
  duplicate set. That trades a solved problem for a worse one.
- **Rendering the panel after the table and positioning it back under its row.** It needs absolute
  positioning against a measured row offset, it breaks the moment a row wraps, and it puts the form
  outside the region the day heading names. Rejected outright.

So the row is not a preference, it is the only valid shape, and the spec had already reached it. The
row carries no grid template. It is a plain block with one child, so there is **no third copy of
`grid-cols-[…]`** anywhere in the feature and nothing to keep character-for-character identical
beyond the two declarations that exist today.

### Why the colspan is 6 and not 8

The grid has eight tracks and the accessibility tree has six columns, because track 1 is the grip
and track 8 is the reserved action cell and both already carry `role="presentation"`. The spec says
the cell spans the grid, which reads as eight. `aria-colspan` counts accessible columns, so the
correct value is **6**, matching the six `columnheader` elements the day card prints. The visual
span comes from CSS and not from the colspan at all, since the row is not a grid, so the two numbers
are independent and only the accessible one is `aria-colspan`.

### Why the cell is sticky and sized in `cqw`

This is the answer to the narrow-viewport question, and it is the one part of the design that is
genuinely new rather than borrowed.

The table lives inside `min-w-[60rem]` inside an `overflow-x-auto` scroller. A panel that is a
normal child of that table is 60 rem wide, which means a fourteen-control form would sit inside a
horizontally scrolling box and the user would scroll sideways to reach the save button. That is the
awkwardness the spec's "no second arrangement for narrow screens" line does not cover, because that
line is about the row and the row is unchanged.

The fix is to take the panel out of the horizontal scroll without taking it out of the table.

- The disclosure region becomes a **named query container**, `@container/day`. Its inline size is
  the card's inner width, which is what a form should be measured against, rather than the viewport,
  which the card does not fill.
- The panel cell is `w-[100cqw]`, so it is exactly as wide as the visible card whatever the table
  does. Container query units resolve against the nearest size container, and the `min-w-[60rem]`
  element is not one, so it is skipped.
- The panel cell is `sticky left-0`, so when the user scrolls the table sideways to read a later
  column, the form stays pinned to the left edge of the card instead of sliding out of view. Its
  containing block is the 60 rem row, so it can travel exactly the scroll distance and no further.

The result is that **the form never scrolls horizontally, at any width, and the table's single
arrangement is untouched.** The row keeps one layout, the columns keep their alignment, and the form
is always fully reachable. No breakpoint on the row, no second row grid, no mobile variant.

`container-type: inline-size` applies inline-size and layout containment. Neither interferes with
anything shipped. The block size is not contained, so the day card's `grid-template-rows` collapse
still works. Layout containment creates a containing block for absolutely positioned descendants,
and the only absolutely positioned thing in the region is the row's own stretched click target,
whose containing block is the row.

If the frontend stage finds the container unit unworkable for any reason, the fallback is the panel
simply being 60 rem wide and scrolling with the table. That is a real regression on a narrow card
and it should be reported rather than shipped quietly.

### The resulting shape of the disclosure region

```
div.grid.transition-[grid-template-rows]                        (unchanged)
  div#planning-day-panel-{date}  @container/day  overflow-hidden  [inert] [aria-hidden]
    ├─ div.overflow-x-auto  [role=group] [tabindex=0]            (only when the day has tasks)
    │    div.min-w-[60rem]  [role=table]
    │      ├─ div[role=row]                    column header line, 6 columnheaders
    │      └─ div[role=rowgroup].divide-y
    │           ├─ PlanningTaskRow             [role=row]
    │           ├─ div[role=row]               the edit panel, when this row is open
    │           │    div[role=cell][aria-colspan=6].sticky.left-0.w-[100cqw]
    │           │      PlanningTaskEditor
    │           └─ …
    └─ div.border-t                            the day footer block, always
         ├─ p                                  the empty-day line, when the day has no tasks
         ├─ PlanningTaskEditor                 the draft, when open
         └─ UButton                            Ajouter une tâche
```

Two things follow from this and both matter.

**The draft editor is never inside the table.** It sits in the footer block, which is outside the
scroller and therefore outside the 60 rem minimum and outside the table roles. That is exactly the
placement the spec asks for, at the foot of the day's rows and above the add control, and it means a
draft needs no row, no cell, and no colspan. A draft has no tabular identity because it has no row
yet, which is the same fact the spec states when it says a draft has no collapsed representation.

**`PlanningTaskEditor` declares no role of its own.** The parent supplies the wrapper, a row and a
cell inside the table for an edit and nothing at all in the footer for a draft. One component, two
mounting contexts, no branching inside it.

### The remaining honest concern with the table roles

A `role="table"` is a static structure and a screen reader reads it cell by cell. A thirteen-field
form inside one of those cells is reachable in both browse and focus mode, and forms inside real
`<table>` cells are old and well-supported ground, but reading the panel through table navigation is
awkward.

The mitigation is that the panel's content is a `<form>` with an accessible name from
`aria-labelledby`, which makes it a named form region. Entering it therefore announces as a form
rather than as more table content, which is the signal that the user has left the tabular data.

Promoting the whole region to `role="grid"` was considered and rejected. A grid takes over the arrow
keys, and arrow keys inside a native date input and inside a number stepper are the controls the user
needs. Trading working widgets for grid navigation on a region that is six read-only columns plus one
editor is the wrong trade. The accessibility stage owns the final call and should treat the form
landmark as the thing to verify.

## The collapsed row

Three changes and no more. The row is not allowed to get heavier.

### The words cell becomes one figure

The `Mots` cell prints `projectWordCount` alone. No slash, no second figure, no numerator and
denominator weight contrast.

**The cell keys on `deliverable`, never on `trackable`.** Those two were one fact until `other`
pulled them apart, and `other` is the member that separates them, since it is `trackable: false` and
`deliverable: true`. A cell keyed on `trackable` prints the em dash over an `Autre` row that holds a
real word count, which is the defect the split exists to remove.

| Case                                        | Renders                                                          |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Not deliverable                             | `planning.emDash` visually, `planning.notApplicable` to a reader |
| Deliverable, `projectWordCount` is null     | `planning.emDash` visually, `planning.notSet` to a reader        |
| Deliverable, `projectWordCount` is a number | `formatCount(projectWordCount, locale)`                          |

> **Superseded, and the original is kept below.** The table first keyed on trackability.
>
> > | Case                                      | Renders                                                          |
> > | ----------------------------------------- | ---------------------------------------------------------------- |
> > | Not trackable                             | `planning.emDash` visually, `planning.notApplicable` to a reader |
> > | Trackable, `projectWordCount` is null     | `planning.emDash` visually, `planning.notSet` to a reader        |
> > | Trackable, `projectWordCount` is a number | `formatCount(projectWordCount, locale)`                          |
>
> `isTrackableCategory` and `isDeliverableCategory` answer different questions now, and the live rule
> for this cell is the second one. See [`other-category.md`](other-category.md) and
> [`other-category-design.md`](other-category-design.md). The nine other members render identically
> under either rule, so only `Autre` changes, and only `Autre` was ever wrong.

```
cell      whitespace-nowrap text-right text-sm tabular-nums
figure    text-highlighted                     (normal weight, not semibold)
absent    text-muted  +  the shipped glyph-plus-sr-only pair
```

**The figure is `text-highlighted` at normal weight rather than semibold.** Weight should mark the
number the row is scanned by, and that is `Durée`, because the durations in an open card are what sum
to the booked figure the capacity meter prints above them. The word count is reference data. Two
adjacent right-aligned tabular columns are also easier to tell apart when they differ in weight than
when they are identical, which is the same argument that already keeps the category name at normal
weight beside a semibold status.

### The words track narrows, and the scroller minimum comes down with it

`AC4` invites this and the arithmetic says take it.

The track was `7.5rem` because the worst pair was `12 000 / 12 000`, about 118 px. One figure needs
far less. A seven-character grouped count is about 58 px at `text-sm` tabular, the column header word
`Mots` is about 34 px, and even an implausible `1 250 000` is about 74 px. **`5rem`** holds every one
of them right-aligned with room, and it frees `2.5rem`.

```
grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_5rem_4.5rem_6rem_3rem]
```

The scroller minimum recomputes from the same sum the shipped one used. The eight track minimums are
`49.5rem`, the seven `gap-x-4` gaps are `7rem`, and `px-5` is `2.5rem`, so the row's true minimum is
**`59rem`** and the scroller carries **`min-w-[60rem]`**, keeping the same one rem of cushion the
shipped `62rem` carries over its `61.5rem`.

Three edits, and they land together or not at all.

1. `DayCard.vue`, the column header line's `grid-cols-[…]`.
2. `TaskRow.vue`, the row's `grid-cols-[…]`, which must end up character-for-character identical to
   the first.
3. `DayCard.vue`, `min-w-[62rem]` becomes `min-w-[60rem]`.

The `2.5rem` goes to the name track at every width, and the scroll threshold drops by 32 px. Neither
is dramatic. Both are free, and leaving a track sized for a pair that no longer exists would be a
small lie in the layout.

### The note marker is a glyph, not a word

**Decision. A `size-3.5` `i-ph-note` glyph, last on the identity line, `text-dimmed`, `shrink-0`,
aria-hidden with the long form from `planning.noteLabel` as `sr-only` text beside it.**

This departs from the two shipped markers, which are dimmed words, and the reason is that the note
marker is a different kind of statement.

`hors stats` and `suite` are facts about the task's meaning. One says its words do not count, the
other says it is a continuation of earlier work. Both are things a reader needs in words, and both
sit naturally in a sequence of words joined by middle dots. The note marker says something about the
row's own disclosure instead, that opening this row will tell you something the row cannot show. That
is a pointer rather than a fact, and a small glyph is the honest form for a pointer. It is also why a
paperclip has meant an attachment for forty years.

Three supporting reasons.

- **The identity line is the row's only elastic track and it is already the busiest.** Worst case it
  carries the name, the project number, `suite`, and `hors stats`. A fourth dimmed word would be
  about 38 px against the glyph's 14 px, and the only thing that can give up that width is the name,
  which is the field that identifies the row.
- **The word `note` reads oddly in that sequence.** `Éditions Pluriel · P-4821 · hors stats · note`
  puts a bare noun where every other member is a qualifier, one track away from a cell that prints
  category names as words. A glyph cannot be misread as a category or a status.
- **The row is now clickable everywhere.** A small glyph on a clickable row reads as "there is more
  here", which is precisely the bit the marker exists to carry.

No middle dot before it. A dot joins two readable strings in a sequence and a glyph is not a member
of that sequence, so it takes `ml-1` instead and saves the ink of the separator as well.

The accessible name is carried the way the row already carries every other one, an `aria-hidden`
glyph beside an `sr-only` span, matching the em dash pairs and the two existing markers. That is the
repo's own idiom and it avoids `aria-label` on a non-interactive element, which is unreliable.

```html
<span v-if="task.notes" class="ml-1 shrink-0 self-center text-dimmed">
  <UIcon aria-hidden="true" class="size-3.5" name="i-ph-note" />
  <span class="sr-only">{{ t('planning.noteLabel') }}</span>
</span>
```

`self-center` because the line is `items-baseline` and a glyph has no baseline worth aligning to.

**One consequence for the copy table.** `planning.note`, the visible word, has no reader once the
marker is a glyph. It is listed in the spec because the spec assumed a word. Either drop it, which
is what I recommend since a key nothing reads is a key that rots, or keep the word and drop the
glyph. This is one line of the owner's attention and either answer is fine.

### The click target, the hover state, and the open state

The affordance is the day header's, reused verbatim. A real button inside the task-name cell, with a
stretched pseudo-element making the whole row clickable, and the focus ring on the row rather than on
the button because the row is the target.

```
row (collapsed)     group/row relative grid grid-cols-[…] items-center gap-x-4 px-5
                    py-[clamp(0.5rem,1.1vh,0.75rem)]
                    has-[button:hover]:bg-primary/[0.06] dark:has-[button:hover]:bg-primary/10
                    has-[button:focus-visible]:outline-2
                    has-[button:focus-visible]:-outline-offset-2
                    has-[button:focus-visible]:outline-primary

row (editor open)   bg-primary/[0.06] dark:bg-primary/10

button              text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none
```

`relative` is new on the row and it is required, because the stretched pseudo-element needs the row
as its containing block. The row does not have it today.

**Why a primary tint at 6 per cent and 10 per cent rather than a surface token.** No semantic
surface token works on all four combinations. A day card is `bg-default` in light and `bg-elevated`
in dark on a work day, and the reverse on an off day, so a `hover:bg-elevated` that reads on a light
work day is invisible on a light off day, and `bg-accented` reads in dark and is far too heavy in
light. A low-opacity primary tint is saturated enough to register on white and light enough to
register on neutral-800, it is the same colour the app's one hover idiom already uses, and it needs
no per-day-type branching. The open state is the same tint made permanent, so the row that owns the
open panel is visibly the one being edited with no new mechanism.

`has-[button:hover]` rather than `hover:` because the hover lands on the button's stretched
pseudo-element and not on the row, which is the same reason the shipped focus ring is written
`has-[button:focus-visible]`.

The accessible name is an `sr-only` `planning.editor.editRowLabel` followed by the row's own name, so
a row with neither client nor project still has a usable one. `aria-expanded` carries the state and
`aria-controls` points at the panel id.

`AC31`'s forward note belongs in the same comment block. The stretched target will have to yield to
the row-action buttons that `PLAN-13` and `PLAN-17` put in the reserved eighth track, and those
buttons land as the hover overlay `extend-tasks-design.md` already documents, positioned against
`group/row`. Nothing about the grid is re-cut when they arrive.

## The editor panel

### The panel box

```
cell        sticky left-0 w-[100cqw] px-5 pb-4 pt-1
form        rounded-xl p-4
            border border-accented dark:border-default
            border-l-2  +  planning-cat-edge      (always, see the supersession note below)
```

> **Superseded, and the original is kept below.** This block first read as follows.
>
> ```
> border-l-2  +  planning-cat-edge      (a category is selected)
> border-l-2 border-l-transparent       (a draft with no category yet)
> ```
>
> The tenth category, `other`, is preselected on every new draft, so there is no longer a moment at
> which a panel has no category and the transparent branch is unreachable.
> [`other-category-design.md`](other-category-design.md) settles that. The edge is coloured from the
> first paint in both cases, and `.planning-cat-edge` is unconditional.

`px-5` on the cell puts the panel's edges on the same x as every row's content, so the panel lines up
with the table it interrupts without any padding arithmetic.

**No background fill, and that is a considered decision rather than an omission.** There is no
semantic token one step off the card surface that works in all four combinations. `bg-muted` and
`bg-elevated` both resolve to neutral-800 in dark, which is already a dark work-day card, and
`bg-accented` resolves to neutral-200 in light, which is far too heavy for a form panel. Rather than
branch the fill on the day type and the mode, the panel takes the card's own surface and is separated
by its border. That is also what makes the form controls read correctly, since Nuxt UI's outline
input is `bg-default` with an accented ring and that is exactly how the settings page already looks
inside a `bg-default` card.

**A border rather than a ring, which deviates from the styling conventions on purpose.** The
conventions prefer a ring for a card, and the day card follows that. Here the left edge carries the
category colour, so the edge has to be a border for the colour to have somewhere to live. Using a
ring for three sides and a border for the fourth would stack a 1 px shadow outside a 2 px border and
read as muddy. The border widths follow the day card's own light and dark tones,
`border-accented dark:border-default`, which is the shipped answer to a box on a card in this app.

### The coloured left edge, and the live colour requirement

The owner asked for two things about colour, that the selector show each category in its row colour
and that the colour change as the field changes. The selector delivers the first. The panel's left
edge delivers the second more visibly than a closed select control can, because it is a 2 px stripe
the height of the whole panel and it changes the instant the selection does.

It needs one new declaration in `main.css`, sitting beside `.planning-cat-name` and reading the same
three custom properties.

```css
/* The category colour on a border rather than on text. Same three variables as .planning-cat-name,
   so lightness and chroma stay fixed in one place and the hue still arrives as --planning-cat-hue
   from categoryHue in the shared contract. A border is decorative reinforcement here, so 1.4.11
   does not bind it; it inherits the text tuning anyway. */
.planning-cat-edge {
  border-left-color: oklch(var(--planning-cat-l) var(--planning-cat-c) var(--planning-cat-hue));
}
```

Unlayered, exactly as `.planning-cat-name` is, so it wins over the layered `border-accented`
utility with no `!important` and no specificity trick.

**This is not a second copy of the colour mapping.** The hue still comes from `categoryHue` in
`shared/categories.ts`, the lightness and chroma still come from the one `@layer base` block, and the
component still sets a single number. It is a second reader of one contract, which is the whole point
of having the contract.

> **Superseded, and the original is kept below.** This paragraph first read as follows.
>
> > A draft with no category yet draws `border-l-transparent` and keeps the 2 px, so choosing the
> > first category colours the edge without shifting a single pixel of layout. That is also why the
> > edge is never drawn from a coerced value. `categoryHue(undefined)` would return the admin
> > default's 305 and paint a colour the user did not pick.
>
> The tenth category, `other`, is preselected on every new draft, so a panel always has a category
> and the transparent branch is dead. [`other-category-design.md`](other-category-design.md) settles
> that, and it also moves the coercion fallback onto `other`, so `admin`'s 305 is no longer the
> colour a coerced value would paint either. The reasoning is left in place because the second half
> of it survives in a different form, stated below, and because a reader who wonders why the
> question came up should be able to find the answer.

**The edge binds to the model, never to a coerced value.** That caution is what is left of the
paragraph above and it still matters. Reading the hue from the selector's own value, rather than
from whatever the row happens to hold, is what keeps the stripe honest about what will be saved.
The create default and the coercion fallback happen to be the same id today, so the two agree, and
binding to the model is what keeps them agreeing when one of them moves.

This document deliberately does not restate the category hues. There is exactly one place they live
and a table here would be a second copy waiting to drift.

### The panel heading

The form needs an accessible name, and whether it needs a visible one depends on which of the two
cases it is.

- **An edit** takes `planning.editor.editFormLabel` as `sr-only`. The collapsed row directly above is
  the visible heading, and printing "Modification de la tâche" over it would say the same thing
  twice in the feature whose whole premise is less clutter.
- **A draft** takes `planning.editor.newTask` visibly, `text-sm font-semibold text-highlighted`,
  because a draft has no row above it and nothing else on screen says what this box is.

One element, one conditional class, `aria-labelledby` on the form pointing at it in both cases.

### The field grid

One twelve-column grid, `gap-x-4 gap-y-4`, with the spans changing at two container breakpoints
against `@container/day`. The DOM order is the spec's field order 1 through 13 and never anything
else, so the reading order, the tab order, and the visual order are one thing.

| #   | Field             | base | `@2xl/day`       | `@4xl/day` | Notes on the width               |
| --- | ----------------- | ---- | ---------------- | ---------- | -------------------------------- |
| 1   | Catégorie         | 12   | 6                | 3          | 261 px at `@4xl`, ample          |
| 2   | Jour              | 12   | 6                | 3          | A native date input needs ~140px |
| 3   | Client            | 12   | 6                | 3          |                                  |
| 4   | Numéro de projet  | 12   | 6                | 3          |                                  |
| 5   | Livraison         | 12   | 6                | 3          | Native date again                |
| 6   | Heure             | 12   | 6                | 2          | A native time input needs ~110px |
| 7   | Mots              | 12   | 6                | 3          |                                  |
| 8   | Durée estimée     | 12   | 12 `col-start-1` | 4          | Two inputs plus two units        |
| 9   | Durée réelle      | 12   | 12               | 4          | Identical to the one beside it   |
| 10  | Statut            | 12   | 6                | 4          | Room for the help line           |
| 11  | Quota             | 12   | 6                | 3          |                                  |
| 12  | Exclure des stats | 12   | 12               | 9          | A switch with a long description |
| 13  | Notes             | 12   | 12               | 12         | Full width, last                 |

At `@4xl/day` that produces five lines.

```
Catégorie 3  |  Jour 3  |  Client 3  |  Numéro de projet 3
Livraison 3  |  Heure 2  |  Mots 3                              (ragged, and deliberately so)
Durée estimée 4  |  Durée réelle 4  |  Statut 4
Quota 3  |  Exclure des stats 9
Notes 12
```

Two things about that shape are choices rather than consequences.

**Mots ends its line and Durée estimée starts a new one.** They would fit together and the layout
would be tidier for it. `PLAN-12` will one day derive the estimate from the word count and the quota,
and putting the two fields side by side is exactly the arrangement that invites "why did it not fill
itself in". Constraint eight says no design element may imply an automatic calculation, and adjacency
is the cheapest way to imply one. A hole to the right of `Mots` costs nothing and buys that.
`@2xl/day:col-start-1` on Durée estimée is what forces the break, and it is inherited by `@4xl`.

**The two durations are visually identical siblings on one line.** Same span, same widget, same unit
suffixes, no arrow between them, no equals sign, no shared hint, nothing linking them. Two inputs of
equal weight side by side is the layout that says "two independent facts of the same kind", which is
what they are.

The two ragged lines are not a defect. Each field is left-aligned to a grid line, and a ragged right
edge in a form has nothing to align against, so it is invisible.

### The widgets

`UFormField` around every control, `class="w-full"` on every input, following the settings page and
`work-fields.vue` exactly. Nuxt UI's own `md` size everywhere, which `app.config.ts` already makes
the default.

**Every numeric field is `UInputNumber`, which deviates from the spec's `UInput type="number"`.**
Constraint eight requires the duration pairs to match the shipped `dailyWorkMinutes` control, and
that control is `UInputNumber`. If the durations use it and `Mots` and `Quota` use a plain number
input, the form carries two visibly different number controls, one with steppers and one without, for
no reason a user could name. `quotaWph` in `work-fields.vue` is already a `UInputNumber` with visible
steppers, so following that gives one control for all four numeric fields and keeps a shipped
precedent for each of them. Steppers stay visible on all four rather than being hidden on two, since
hiding them on some is the same inconsistency in a smaller form.

**The hours and minutes conversion must not copy `clampMinutes` from `work-fields.vue`.** That helper
clamps to 1 through 1440 because `dailyWorkMinutes` is required and cannot be null. Both task
durations are nullable, `Durée réelle` genuinely so, and clearing it is not the same as zero. So the
pure module in `app/utils/` maps two empty inputs to `null` and two zeroes to `0`, and never coerces
empty to zero. That distinction is `AC27` and it is the reason the module is unit tested.

| Field             | Widget                                                               |
| ----------------- | -------------------------------------------------------------------- |
| Catégorie         | `USelectMenu`, coloured options and coloured trigger, always a value |
| Jour              | `UInput type="date"`                                                 |
| Client            | `UInput`                                                             |
| Numéro de projet  | `UInput`                                                             |
| Livraison         | `UInput type="date"`                                                 |
| Heure             | `UInput type="time"`                                                 |
| Mots              | `UInputNumber :min="0"`                                              |
| Durée estimée     | Two `UInputNumber class="w-24"` plus unit spans                      |
| Durée réelle      | Two `UInputNumber class="w-24"` plus unit spans                      |
| Statut            | `USelect`, four options, disabled on a non-deliverable category      |
| Quota             | `UInputNumber :min="1"`, `hint` from `onboarding.work.unitWph`       |
| Exclure des stats | `USwitch` with its `description`                                     |
| Notes             | `UTextarea :rows="3" class="w-full"`, counter in the field `hint`    |

> **Superseded.** The `Statut` row read "disabled on a non-trackable category". The live rule is
> non-deliverable, and it is argued at
> [Statut on a non-deliverable category](#statut-on-a-non-deliverable-category). The `Catégorie` row
> read "placeholder". Both are summaries of sections that carry the reasoning, so nothing is
> duplicated here.

The duration pairs reuse `work-fields.vue`'s inner markup verbatim, including
`:aria-label="t('onboarding.work.hoursLabel')"` on each half and the `text-sm text-muted` unit spans,
so the two halves are individually named and the pair is not two unlabelled boxes.

```
pair wrapper   flex items-end gap-3
half           flex items-center gap-1.5
input          w-24
unit           text-sm text-muted
```

### The category selector

The one requirement that cannot be met with defaults. Both halves read the same contract, so the
association between a colour and a kind of work is learnable rather than two mappings that drift.

```html
<USelectMenu v-model="…" class="w-full" :items="categoryItems">
  <!-- The closed control. Colour changes the moment the model does, before any save. There is
       always a selection, so there is no second branch. -->
  <template #default>
    <span class="planning-cat-name" :style="{ '--planning-cat-hue': categoryHue(selected.value) }">
      {{ selected.label }}
    </span>
  </template>

  <!-- Each option in its own row colour. -->
  <template #item-label="{ item }">
    <span class="planning-cat-name" :style="{ '--planning-cat-hue': categoryHue(item.value) }">
      {{ item.label }}
    </span>
  </template>
</USelectMenu>
```

> **Superseded, and the original is kept below.** The block first carried a placeholder and a
> no-selection branch.
>
> ```html
> <USelectMenu
>   v-model="…"
>   class="w-full"
>   :items="categoryItems"
>   :placeholder="t('planning.editor.fields.categoryPlaceholder')"
> >
>   <template #default>
>     <span v-if="selected" class="planning-cat-name" …>{{ selected.label }}</span>
>     <span v-else class="text-dimmed">{{ t('planning.editor.fields.categoryPlaceholder') }}</span>
>   </template></USelectMenu
> >
> ```
>
> The tenth category, `other`, is preselected on every new draft, so the `v-else` branch is
> unreachable and `planning.editor.fields.categoryPlaceholder` has no reader.
> [`other-category-design.md`](other-category-design.md) settles that and is explicit that the
> preselected value reads plain rather than muted, because a greyed word says the field is empty and
> the field is not empty.

**The option list is owned by [`other-category-design.md`](other-category-design.md), not by this
document.** It is the ten categories in contract order with labels from `categories.<id>`, plus one
`{ type: 'separator' }` above `Autre`. That document argues the separator, verifies that Nuxt UI
skips it in keyboard navigation, and measures the tenth hue. Anything this document said about the
count is superseded by it, and the sentence below originally read "Nine options".

Ten options, built from `DEFAULT_CATEGORIES` in contract order with labels from `categories.<id>`.
No swatch, no dot, no coloured pill. The printed name in its own colour is the entire carrier,
because that is what the row does, and reproducing the row's treatment exactly is what makes the
association learnable. It is also what satisfies WCAG 1.4.1 by construction, since a user who
perceives no colour reads the name and loses nothing.

**The selector introduces no unmeasured surface, which is worth stating because it is what carries
the contrast claim across.** `.planning-cat-name` was tuned to 4.5:1 against `bg-default` and
`bg-elevated` in light and dark across all five themes. The closed trigger is `bg-default`. The menu
content is `bg-default`. A highlighted option is `bg-elevated`. All three are inside the measured set,
so no new measurement is needed, and the accessibility stage can verify rather than re-derive.

The declared `color` on the span beats any inherited `text-primary` Nuxt UI puts on a selected item,
because a declared colour on an element always beats an inherited one. The selected item's check
glyph inherits the category colour, which is fine and mildly pleasant.

> **Superseded, and the original is kept below.** This paragraph first read as follows.
>
> > **There is no preselected value.** The spec argues that at length and the design just needs to
> > show it, which is the placeholder in `text-dimmed` and the save control disabled until a category
> > is chosen.
>
> The owner has since added `other` and made it the preselected value on every new draft, so a
> category is always chosen and nothing is left to show as empty.
> [`other-category-design.md`](other-category-design.md) settles it. That also retires the second
> half of the sentence, because a save control gated on a category being chosen can never be gated on
> anything now.

**The field always holds a value, and the closed trigger reads plain.** A fresh draft opens on the
preselected category rendered through `.planning-cat-name` exactly as an edited task's category is,
with no muting and no provisional treatment, because that is the value that will be stored if the
user saves without touching the field.

### Statut on a non-deliverable category

**The `:disabled` binding reads `isDeliverableCategory`, never `isTrackableCategory`.** This is the
one binding in the feature where getting the flag wrong produces a real accessibility defect rather
than a cosmetic one, so it is stated before the styling. A fresh draft opens on `Autre`, which is
`deliverable: true`, so its `Statut` is enabled, operable, and carries no help line. Keying it on
`trackable` would render that draft's control disabled while announcing that the category carries no
status, on the single row the split exists to fix, and a control whose state contradicts its own
description is a WCAG 1.3.1 failure.

For the nine other members the two flags agree, so nothing else moves.

| The pending selection         | `Statut`                                                    |
| ----------------------------- | ----------------------------------------------------------- |
| Deliverable, `Autre` included | Enabled, operable, no help line, Nuxt UI's ordinary styling |
| Not deliverable               | Disabled, help line in `text-muted` under the control       |

When it is disabled the field takes `:help="t('planning.editor.fields.statusUnavailable')"`, so the
reason sits under the control, and Nuxt UI's own disabled styling carries the rest.

> **Superseded, and the original is kept below.** This section was framed on trackability throughout,
> including its heading, and asserted the disabled case as the current behaviour.
>
> > ### Statut on a non-trackable category
> >
> > The `USelect` takes `:disabled` and the field takes
> > `:help="t('planning.editor.fields.statusUnavailable')"`, so the reason sits under the control in
> > `text-muted`. Nuxt UI's own disabled styling carries the rest.
>
> The live rule is "disabled when the category carries no status" rather than "disabled when the
> category is not trackable". See [`other-category.md`](other-category.md) and
> [`other-category-design.md`](other-category-design.md).

The note for the accessibility stage survives unchanged, because it is about the disabled case and
that case still exists on the five non-deliverable members. A truly disabled select is not focusable,
so a keyboard user tabbing through the form never reaches the field and never hears the help text. The
category selector's own change is what explains the state, and the help text is reachable in browse
mode. If that turns out to be insufficient, `aria-disabled` with a readonly control keeps the field in
the tab order at the cost of a control that looks operable and is not. Disabled is what ships for a
category that carries no status, and this is recorded so it is a decision rather than an oversight.

### Notes and its counter

`UTextarea :rows="3"`, so the field is about 90 px rather than the 140 a five-row box would take, on
a panel that is already tall. `class="w-full"` and the placeholder from
`planning.editor.fields.notesPlaceholder`.

The counter goes in the field's `hint`, beside the label at the top right, rather than in `help`
under the control. Two reasons. `help` is where the 422 error lands, and a counter and an error
competing for the same line is worse than either alone. And the units in `work-fields.vue` already
use `hint` for exactly this kind of metadata about a field, so it is the house slot for it.

```
counter, normal      text-xs text-dimmed
counter, ≥ 90 %      text-xs text-warning-800 dark:text-warning-400
counter, over 2000   text-xs text-error-800 dark:text-error-400
```

The 800 and 400 shades are `StatusBadge.vue`'s, which were measured against every card surface, so
they carry over without new measurement. A counter is information rather than policing, the field is
never blocked, nothing is reformatted, and nothing warns about content. It exists so the user does
not discover a 2000-character bound through a 422.

### The footer, and the four states of its message slot

The panel ends with a message slot and a button row. The message slot is one region with four
possible occupants, so there is one place on screen where the editor speaks and the user learns where
to look once.

```
message slot   (a full-width UAlert, when there is something to say)
button row     flex flex-wrap items-center justify-between gap-3
  left         the unsaved-changes note, when it is showing
  right        flex items-center gap-2  →  Cancel, then Save
```

**The message slot sits above the button row and below the fields, not at the top of the panel.** A
form-level error conventionally goes at the top, and on a 560 px panel that is off screen at the
moment it appears, because the user's eye and the scroll position are both at the save button they
just pressed. Putting it where the action was is worth more than following the convention.

| State                                | Treatment                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 422 field error                    | Per field, through `UForm`'s `setErrors`. `UFormField` renders the message in `text-error` and wires `aria-invalid` and `aria-describedby` itself |
| A 422 `_form` or an unrecognised key | `UAlert color="error" variant="subtle" icon="i-ph-warning-circle"` in the message slot, titled `planning.editor.saveError`                        |
| A 500 or a network failure           | The same alert, plus one action, `planning.retry`, `color="neutral" variant="outline"`                                                            |
| A 401                                | The same alert, titled `planning.editor.sessionExpired`, with two actions, `signInNewTab` and `planning.retry`                                    |
| A 404                                | `UAlert color="warning" variant="subtle" icon="i-ph-info"`, titled `planning.editor.gone`, and **the button row swaps out**                       |

The 404 is the one state that changes the controls rather than adding to them, and it has to. A patch
against a deleted row can never succeed, so a save button that retries the patch is a dead end
dressed as an action. In that state the normal Cancel and Save pair is replaced by
`planning.editor.goneCreate` as the primary and `planning.editor.goneDiscard` as a neutral ghost. The
typed values are still on screen and still good, and the only two things the user can do are the only
two things offered.

The 401's sign-in control is `UButton :to="localePath('signin')" target="_blank"
rel="noopener noreferrer" trailingIcon="i-ph-arrow-square-out"`. WCAG 3.2.5 wants a new window
announced in advance, and the alert body already says so in words, "Ouvrez la connexion dans un
nouvel onglet", so the trailing glyph is reinforcement and no new copy key is needed.

### The dirty state

**The save control's enabled state is the ambient dirty affordance and nothing else is added for
it.** `AC39` disables save when nothing has changed, so an enabled save button already means
"something is unsaved", visible at all times, costing no new element. A permanent badge on top of
that would say the same thing twice.

The `planning.editor.unsaved` line is reserved for the one moment the spec names, a click outside
with changes pending. It appears in the button row's left slot and stays until the editor is saved or
discarded, because it is a true statement for as long as it is showing.

```
i-ph-warning-circle size-4  +  text-xs text-warning-800 dark:text-warning-400
```

No ring change on the panel, no pulse, no motion, no focus move. The spec asks for a quiet note in
place and a 2 px amber ring around a 560 px panel is not quiet. A text line with a glyph is.

### The save control

```
UButton color="primary" icon="i-ph-check-bold" :label="t('planning.editor.save')"
        :loading="saving" :disabled="!dirty" type="submit"
```

> **Superseded, and the original is kept below.** The guard first read
> `:disabled="!categoryChosen || !dirty"`. With `other` preselected on every draft there is no
> categoryless state, so `categoryChosen` is always true and the first half of the guard can never
> fire. Dirtiness is the whole guard now.
> [`other-category-design.md`](other-category-design.md) settles the preselection.

The same shape the settings page and the profile page already use for a submit, right-aligned in the
footer, with the leading check glyph. No `class="btn-glow"` is needed. `app.config.ts` appends
`.btn-glow` to every button's base slot, so the shipped call sites that pass it are being
redundant and this feature should not copy that.

`:loading` sets `disabled` itself and swaps the leading glyph for a spinner, which covers `AC41`.
The loading state spans the write and the `refreshNuxtData` that follows, so the button is dead for
neither of them and two rapid activations produce one request. Cancel is
`color="neutral" variant="ghost"` and sits to its left, matching the modal footer idiom in the admin
page.

### The live region belongs to the page, not to the panel

`AC30` destroys the panel on success and `AC43` announces the success politely. A live region inside
the panel is removed in the same tick as the announcement it is supposed to make, so it announces
nothing. This is not a spec error, it is a trap the spec does not name, and getting it wrong produces
a feature that passes every visual check and is silent to a screen reader.

So the region lives on `app/pages/index.vue`, beside the open-editor state that page already owns,
following `profile.vue`'s shipped pattern exactly.

```html
<p aria-atomic="true" aria-live="polite" class="sr-only">{{ editorStatusMessage }}</p>
```

It carries `planning.editor.saved` after an edit and `planning.editor.created` after a create, and
nothing otherwise. No toast, per `AC43`.

## The empty day and the add control

Every day card is disclosable now, including an empty one, because the add control lives in the body
and an empty body is no longer empty. `DayCard.vue`'s comment saying a button onto an empty body is a
promise the card cannot keep has to be rewritten rather than left contradicting the code.

An open day with no tasks renders no scroller, no `role="table"`, and **no column header line**, since
six headers over zero rows label nothing. It renders the footer block alone.

```
footer block   border-t border-default px-5 py-3
empty line     text-sm text-muted                          (planning.editor.emptyDay)
add control    UButton color="primary" variant="ghost" size="sm" icon="i-ph-plus-bold"
```

The footer block sits **outside** the scroller. Inside it, `width: auto` would resolve to the scroll
content width, which the 60 rem table sets, so the add control would sit 60 rem from the left on a
narrow card and the user would scroll sideways to reach it. Outside, it is the card's width and never
scrolls.

`border-t border-default` separates it from the last row cleanly, because `divide-y` draws only
between rows and leaves the last one bare.

**Ghost primary rather than neutral.** It is the day's only action, it appears once per open card
rather than once per row, and in a typical week one card is open. Primary on ghost is the lightest
way to make an action findable without putting a filled box on seven cards. The global `.btn-glow`
gives it a primary ring on hover, which is the app's one hover idiom and needs no opt-in.

It is left-aligned at the same `px-5` as every row's content, so the day's one action starts on the
same x as the day's data.

The control carries `:aria-expanded` and `aria-controls` pointing at the draft panel, because opening
a draft beneath it is a disclosure and the button is the thing that discloses it.

An off day carries the control like any other card. `AC60` requires it and the do-not-police rule is
the reason, so recorded weekend work can be entered where it happened.

## The discard confirmation

`UModal`, following the shared confirmation modal in `app/pages/admin/users.vue` so the app has one
confirmation idiom.

```html
<UModal
  v-model:open="discardOpen"
  :title="t('planning.editor.discardTitle')"
  :description="t('planning.editor.discardBody')"
  :ui="{ footer: 'justify-end' }"
>
  <template #footer>
    <UButton color="neutral" variant="ghost" :label="t('planning.editor.discardCancel')" />
    <UButton color="error" :label="t('planning.editor.discardConfirm')" />
  </template>
</UModal>
```

"Continuer l'édition" is first and neutral, "Abandonner" is second and `error`, so the safe action is
the easy one and the destructive one is the one that looks destructive. Discarding loses typed work,
which is what `error` is for.

The modal stays dismissible. Escape and an overlay click both mean "keep editing", which is the safe
default and the right reading of an ambiguous gesture.

**The editor's own Escape handler must not fire while the confirmation is open.** The modal is on top
and stops propagation, so this works by default, and it is written down because it is the kind of
thing a hand-rolled key listener on `document` breaks.

## Focus treatment

The conventions require a visible focus ring on every interactive element. Nuxt UI's form controls
carry their own `focus-visible` ring, so nothing in the panel needs an override. The two hand-rolled
targets are the row's expand button, which rings the whole row through
`has-[button:focus-visible]:outline-2 has-[button:focus-visible]:-outline-offset-2
has-[button:focus-visible]:outline-primary`, and the scroller, which already has one. The offset is
negative so the ring is drawn inside the row and is not clipped by the card's `overflow-hidden` or
overlapped by a neighbour's divider.

| Moment                 | Where focus goes                                          |
| ---------------------- | --------------------------------------------------------- |
| Expand a row           | The category selector, the first control                  |
| Open a draft           | The category selector                                     |
| Save an edit           | The row's expand button                                   |
| Cancel an edit         | The row's expand button                                   |
| Save or cancel a draft | The add control                                           |
| Discard confirmed      | The row's expand button, or the add control for a draft   |
| Discard declined       | The category selector, the first control                  |
| A failed save          | Stays where it is. The message slot is not a focus target |

**Scrolling on expand.** Focusing a control scrolls that control into view, and on a tall panel that
can leave the collapsed row above the fold, which loses the identity the panel exists beside. So the
frontend scrolls the row into view first and then focuses the selector, and the panel carries
`scroll-mt-24`, matching the `scroll-mt-24` the day header button already carries. No smooth
scrolling, because it would race the 150 ms disclosure the click may also have triggered.

**One hole in `AC52`.** It says focus returns to the collapsed row's expand button on save, and
`AC44` says a save that changes the day can move the row out of the visible week entirely. When that
happens the button no longer exists and focus lands on `<body>`, which `AC54` forbids. The design
answer is a fallback to the disclosure button of the day card the editor was open in, which always
exists because every card is disclosable now. Worth one line of the owner's attention and it does not
block the build.

**A hazard in `AC51` that turned out not to exist, and there is nothing here to guard.** Focus lands
on the category selector, which is the right target. The worry was that a user landing there and
starting to type would silently change the category through the trigger's typeahead. **That cannot
happen on this control.** `USelectMenu` is built on Reka's `Combobox`, and `Combobox` binds no
typeahead at all, open or closed.

The absence is a finding rather than a failed search, because the instrument was shown to produce a
positive first. The identical search for `useTypeahead` and `handleTypeaheadSearch` finds four
modules under `Select`, `SelectTrigger` among them, and zero under `Combobox`, with the shared
`useTypeahead` module present in both cases. So a search that can see the behaviour where it exists
reports it absent here, which is what makes the absence trustworthy.

**The control that does have closed-trigger typeahead is `Statut`, through `USelect`, and guarding it
was considered and deliberately refused.** `USelect` is Reka's `Select`, and `SelectTrigger` is
exactly where the closed-trigger typeahead lives. Typing a letter on a collapsed select to jump to a
matching option is native behaviour and it is the documented ARIA pattern for a select-only
combobox, so it is an affordance the user is entitled to rather than a defect. An assertion that it
does not happen would pin a regression in place and would take a working affordance away from a
keyboard user.

> **Superseded, and the original is kept below.** This note first read as follows.
>
> > **A hazard in `AC51`.** Focus lands on the category selector, which is the required field and the
> > right choice. A Reka select trigger can support typeahead while closed, so a user who lands there
> > and starts typing could silently change the category. The frontend should confirm the closed
> > trigger does not typeahead-select, and if it does, focus the trigger with typeahead off rather
> > than moving focus elsewhere. The field is still the right target.
>
> Two things in it were wrong. The hazard was attached to the wrong control, since the category
> selector is a `Combobox` and cannot carry it, and the accessibility stage has since proved that.
> And the category field is no longer required, so calling it "the required field" is stale for the
> same reason the placeholder passage above it is. The tenth category means an untouched dropdown
> stores `other`, named `Autre`, so a save is never blocked by a field the user never opened. See
> [`other-category-design.md`](other-category-design.md).

The severity reasoning that followed was sound and was simply attached to the wrong control, so it is
worth correcting rather than removing, because the next reader may arrive with the same worry and
deserves the answer. It ran that a preselected category makes an invisible failure worse, since
typeahead on an unfilled field would at least show a value appearing where none was, while typeahead
on a field already holding `Autre` would swap one real value for another with only an unwatched hue
as the trace. **On `Statut`, the control that actually has the behaviour, that case cannot arise.** A
wrong landing there produces announced text in a labelled field, so there is no silent swap to worry
about, and the conclusion flips from "something is left unguarded" to "there is nothing to guard".

## Responsive behaviour

The row keeps exactly one arrangement, which is what `extend-tasks-design.md`'s D14 and this spec's
scope both require. Below `60rem` the day card scrolls inside its own container and the page body
never scrolls sideways. No `md:` variant and no element hidden by breakpoint enters the planning
components.

**The form is the one thing that reflows, and it is not a second arrangement in the sense that rule
forbids.** That rule is about a row grid, where two arrangements mean sibling rows that no longer
align. A form has no siblings to align with and no columns to keep in step, so reflowing it costs
nothing that the rule was protecting.

The reflow is driven by container queries against the card rather than by viewport breakpoints,
because the card is what the form actually has to fit inside. A card at `max-w-6xl` on a 1280 px
laptop is about 64 rem wide, and the same page on a 768 px tablet gives about 41 rem, and the
viewport number tells you neither.

| Card inline size   | The form                                                          |
| ------------------ | ----------------------------------------------------------------- |
| Under `42rem`      | One column. Every field full width, stacked, thirteen tall        |
| `42rem` to `56rem` | Two columns, with the durations, the switch, and Notes full width |
| `56rem` and up     | The five-line twelve-column layout                                |

And the part that actually answers the awkward case. **At every width, the form is as wide as the
visible card and is pinned to its left edge, so it is never inside the horizontal scroll.** A user on
a narrow screen scrolls the table sideways to read a later column and the form stays put. A user who
opens an editor on a narrow screen sees the whole form without scrolling sideways at all. That is the
real answer, and it is a property of where the panel sits rather than of how its fields stack.

## Motion

**The editor panel does not animate its height, and that is deliberate.** Three reasons.

1. The day card disclosure the user may have just triggered is already a 150 ms
   `grid-template-rows` expansion, and a second nested one inside it reads as a stutter rather than
   as one gesture.
2. The panel is created and destroyed rather than hidden, per `AC30`, so an exit animation would keep
   an unmounted form on screen after a cancel. Asymmetric motion reads as a glitch, and symmetric
   motion means keeping the form mounted, which the spec forbids for a good reason.
3. Focus moves into the panel immediately on open, and the browser's scroll-into-view fights a box
   that is still growing.

So the panel appears and disappears instantly. That is also the shipped precedent, since the day card
animates height only and adds no fade, no slide, and no stagger.

| Element                   | Motion                                                        |
| ------------------------- | ------------------------------------------------------------- |
| Day disclosure region     | Unchanged, `grid-template-rows` 0fr to 1fr, 150 ms `ease-out` |
| Day chevron               | Unchanged, `rotate-90`, 150 ms                                |
| Editor panel              | None                                                          |
| Row hover and open tint   | `transition-colors duration-150`                              |
| Save button loading glyph | Nuxt UI's own spinner                                         |
| The discard modal         | Nuxt UI's own transition                                      |
| Everything above          | `motion-reduce:transition-none`                               |

The frontend stage should not add a height transition to the panel later as a polish pass. The reasons
above are why it is missing.

## Key Tailwind decisions

Concrete blueprints in this repo's idiom.

**Task row grid, both declarations, character-for-character identical**

```
grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_5rem_4.5rem_6rem_3rem]
```

**Table scroller**

```
min-w-[60rem]
```

**Disclosure region, the new query container**

```
@container/day overflow-hidden
```

**Task row**

```
group/row relative grid grid-cols-[…] items-center gap-x-4 px-5
py-[clamp(0.5rem,1.1vh,0.75rem)] transition-colors duration-150 motion-reduce:transition-none
has-[button:hover]:bg-primary/[0.06] dark:has-[button:hover]:bg-primary/10
has-[button:focus-visible]:outline-2 has-[button:focus-visible]:-outline-offset-2
has-[button:focus-visible]:outline-primary
bg-primary/[0.06] dark:bg-primary/10                       (when its editor is open)
```

**Editor panel row and cell**

```
row    (no classes beyond role="row")
cell   sticky left-0 w-[100cqw] px-5 pb-4 pt-1
```

**Editor panel box**

```
rounded-xl border border-accented dark:border-default border-l-2 p-4
planning-cat-edge                       (always, superseding the two-branch original)
```

> **Superseded.** The two lines here first read `planning-cat-edge (a category is selected)` and
> `border-l-transparent (a draft with no category)`. See the supersession note under
> [the panel box](#the-panel-box), and
> [`other-category-design.md`](other-category-design.md) for the preselected draft that removes the
> second case.

**Field grid**

```
grid grid-cols-12 gap-x-4 gap-y-4
```

**Panel heading**

```
text-sm font-semibold text-highlighted          (a draft)
sr-only                                         (an edit)
```

**Footer**

```
wrapper   mt-4 space-y-3
buttons   flex flex-wrap items-center justify-between gap-3
right     flex items-center gap-2
unsaved   inline-flex items-center gap-1.5 text-xs text-warning-800 dark:text-warning-400
```

**Day footer block**

```
border-t border-default px-5 py-3 flex flex-col gap-3 items-start
```

**Note marker**

```
ml-1 shrink-0 self-center text-dimmed     +     UIcon size-3.5 i-ph-note
```

**Words cell**

```
whitespace-nowrap text-right text-sm tabular-nums
figure    text-highlighted
absent    text-muted + glyph and sr-only pair
```

## Icons

Phosphor throughout, matching the rest of the app.

| Use                      | Icon                    |
| ------------------------ | ----------------------- |
| The note presence marker | `i-ph-note`             |
| The add control          | `i-ph-plus-bold`        |
| The save control         | `i-ph-check-bold`       |
| An error alert           | `i-ph-warning-circle`   |
| The gone alert           | `i-ph-info`             |
| The unsaved note         | `i-ph-warning-circle`   |
| Sign in, a new tab       | `i-ph-arrow-square-out` |

## Component hierarchy

- `app/pages/index.vue` — gains the single open-editor value, the save composable's status, and the
  polite live region
  - `p[aria-live=polite].sr-only` — new, and it has to be here rather than in the panel
  - `PlanningWeek` — threads the open-editor value down, stays a thin renderer
    - `PlanningDayCard` — every day disclosable, the disclosure region becomes `@container/day`,
      the column header line narrows the words track, the day footer block is new
      - column header line — one track width changes
      - `PlanningTaskRow` — the words cell becomes one figure, the note marker is added, the row
        becomes a disclosure with a stretched click target, a hover tint, and an open tint
        - `PlanningStatusBadge` — unchanged
      - editor row and cell — new, inline in `DayCard.vue`, wrapping the editor for an edit
      - `PlanningTaskEditor` — new. The form, the field grid, the footer, and the message slot. No
        role of its own, so the same component serves the row wrapper and the footer block
        - `USelectMenu` with the two coloured slots. Its items and its one separator are
          [`other-category-design.md`](other-category-design.md)'s, not this document's
        - `UFormField` × 13
        - `UInputNumber` × 6
        - `UModal` — the discard confirmation
      - add control — new, inline in `DayCard.vue`
- `app/assets/css/main.css` — one new unlayered rule, `.planning-cat-edge`
- `app/utils/` — the hours and minutes conversion and the change diff, both pure and both unit
  tested. Neither is a design concern beyond the null-versus-zero rule stated above.

## What I think the spec got wrong

Six things, none of which blocks the build. Four are gaps rather than errors.

1. **`AC52`'s focus target can cease to exist.** `AC44` allows a save to move a row out of the
   visible week, and then the collapsed row's expand button is gone and focus has nowhere to return,
   which `AC54` forbids. The design falls back to the day card's disclosure button. The spec should
   say so rather than leave two criteria quietly in conflict.

2. **A live region inside the panel cannot work.** `AC30` destroys the panel on success and `AC43`
   wants the success announced. The region has to be on the page. The spec is right about both
   requirements and silent about the fact that together they force where the region lives, which is
   exactly the kind of thing that ships broken and passes every visual check.

3. **`aria-colspan` should be 6, not 8.** The spec says the cell spans the grid, and the grid has
   eight tracks, but two of them are `role="presentation"` and the table is six columns wide to a
   screen reader. An eight would make the panel row claim two columns that do not exist.

4. **A naive click-outside detector will fire when the user picks a category.** The spec's
   click-outside rule is right, and `USelectMenu`'s popover and `UModal`'s content are teleported out
   of the panel's DOM subtree, so a `document` listener sees a click on an option as a click outside
   the editor and shows the unsaved-changes note in the middle of a normal interaction. The detector
   has to ignore the popper content wrapper, or be built on `focusout` rather than on pointer
   position. Flagging it because the symptom looks like a design mistake rather than a plumbing one.

5. **`planning.note` has no reader once the marker is a glyph.** The copy table carries the pair
   because it assumed a word. I have chosen the glyph and argued it, so I recommend the visible word
   key be dropped and `planning.noteLabel` alone survive. `AC56`'s point is key parity and no
   literals, both of which still hold. If the owner prefers the word, the design reverts to
   `· note` in `text-xs text-muted` and both keys stay.

6. **The widget column says `UInput type="number"` and the durations say match the shipped
   control.** Those pull in opposite directions, since the shipped control is `UInputNumber`. I have
   used `UInputNumber` for all four numeric fields so the form has one number control rather than
   two, and recorded it here as a deviation rather than resolving it silently.

One note that is not a criticism. The spec puts a second arrangement for narrow screens out of scope,
and the form does reflow. That is not the thing the scope line rules out. The row keeps one
arrangement, the columns keep their alignment, and the form is a new element with no siblings to
align to. What makes the narrow case genuinely work is not the reflow anyway, it is that the panel is
pinned to the card's visible width and never participates in the horizontal scroll at all.
