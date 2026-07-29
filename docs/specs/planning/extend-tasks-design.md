# Design: progressive disclosure for the planning week

The visual blueprint for [`extend-tasks.md`](extend-tasks.md). That spec owns the information
contract and hands this stage fifteen constraints, D1 through D15. This document resolves the
layout and nothing else. It writes no Vue and edits no component.

The governing pass is the simplifying pass in
[`alleger-la-semaine.md`](alleger-la-semaine.md), with the one recorded exception the spec makes
for category colour. Its two rules still drive everything below. Colour carries meaning, and the
interface shows only what is functional.

## The problem this layout is solving

The owner asked for "the most mind decluttering layout possible", "light on the eyes and optimized
for less mental clutter". The feature nonetheless adds a delivery field, a second word figure, a
category colour, and an exclusion marker. So the net has to come out calmer, which is D15.

The arithmetic that makes it possible, counted per task row:

| | Drawn per row today | Drawn per row after |
| --- | --- | --- |
| Status carriers | dot + badge pill = 2 | 1 coloured word |
| Category | 1 neutral chip pill | 1 border edge (0 nodes) |
| Field labels | 2 tiny uppercase labels | 0 |
| Meta line | 1 line | 0 |
| Data values | 3 (name, mots, durée) | 4 (name, livraison, mots, durée) |
| Split tag | 1 badge pill (conditional) | 1 dimmed word (conditional) |
| Grip | 1 | 1 |
| **Boxes drawn per row** | **3 pills** | **0** |
| **Total at-rest elements** | **10** | **7** |

A five-row card goes from fifty drawn elements to thirty-five, and from fifteen pill boxes to
zero, while gaining a field. That is the whole design.

## Layout regions

Top to bottom, unchanged in structure from what shipped.

1. **Page container.** Title, week label, week switcher.
2. **The week stack.** Seven day cards, each one `section`.
3. **The day header band.** Three fixed-geometry zones. Now also the only interactive element on
   the page.
4. **The disclosure region.** Collapsed to zero height by default, holding the column header line
   and the task rows.
5. **The task row.** One line, seven tracks, a coloured left edge.

## Container width

**Widen to `max-w-5xl xl:max-w-6xl`.**

The row fits at `max-w-5xl` with 389 px left for the task name, so widening is not forced by D12.
It is chosen because this is a data-dense dashboard and the styling conventions prescribe
`lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl` for exactly that shape. The extra 128 px at `xl` goes to
the two tracks that benefit from slack, the task name and the capacity bar, and every fixed track
is untouched.

This is a container max-width step, not a second arrangement, so D14 holds. There is one row
layout and one header layout at every width. Below `xl` nothing changes at all.

```
mx-auto w-full max-w-5xl xl:max-w-6xl px-6 sm:px-6 lg:px-8 py-[clamp(1.25rem,3vh,2rem)]
```

## The at-rest row

### Track order and sizing

Seven tracks. Every track except the name is a fixed width, because a per-row `auto` track sized
itself to that row's own content and made the columns drift, which is the lesson the shipped row
already records. The name is the single `1fr`, so all the slack lands on the field that identifies
the row.

```
grid grid-cols-[1rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem]
gap-x-4 items-center
```

| # | Track | Width | Align | Why here |
| --- | --- | --- | --- | --- |
| — | Category edge | 3 px border | — | Outside the grid, on the row's own left border. Costs no track and no node. |
| 1 | Grip | `1rem` | centre | Structural. Leftmost because a drag handle that is not at the edge is not a drag handle. |
| 2 | Identity + markers | `minmax(12rem,1fr)` | left | Who the work is for. First readable track, takes all slack (D3). Hosts both conditional markers inline (D9). |
| 3 | Livraison | `9rem` | left | When it is due. Second because the spec's reading order is who, when, how big, how long, where it stands, and because the deadline is the fact she cannot see today. |
| 4 | Mots | `7.5rem` | right | How big, and how much is left. |
| 5 | Durée | `4.5rem` | right | How long. Sits immediately left of the status so the two numbers that explain the capacity bar are adjacent. |
| 6 | Statut | `6rem` | left | Where it stands. Last readable track, because it is the field you check after you have identified the row, and because a status column at the right edge is the convention the original app already taught her. |
| 7 | Row actions | `3rem` | right | Reserved, empty. Hover actions land here (D10, see below). |

Width derivations, so the frontend stage does not re-guess them.

- **Livraison `9rem` (144 px).** The worst case is the cross-year form, `4 janv. 2027 16:00`,
  eighteen characters at `text-sm`, about 137 px. 144 px clears it with no truncation.
- **Mots `7.5rem` (120 px).** The worst realistic pair is `12 000 / 12 000`, fifteen characters of
  `tabular-nums` at `text-sm`, about 118 px.
- **Durée `4.5rem` (72 px).** `10 h 45` is seven tabular characters, about 60 px.
- **Statut `6rem` (96 px).** The longest label is `En retard`, nine characters at `text-sm`
  semibold, about 74 px. 96 px leaves the column edge clean with no box to align to.
- **Grip `1rem`.** A `size-4` Phosphor glyph, unchanged from what shipped.

At `max-w-5xl` the card's inner width is 984 px, the fixed tracks and gaps take 592 px, so the name
gets **389 px**. The worst seeded case, `Éditions Pluriel · P-4821`, is about 200 px. There is room
for roughly twice the longest realistic name before truncation, so D3 is met with margin.

### Alignment rules

- **Livraison is left-aligned.** It is the one compound field of varying length. Right-aligning it
  would put `juill.` where `16:00` sits on the row above, which reads as noise. Left-aligned, every
  deadline starts at the same x and the field reads as one block (D2, D5).
- **Mots and Durée are right-aligned and `tabular-nums`.** Pure figures align on the last digit, so
  the eye reads magnitude down the column without reading the numbers (D2).
- **Statut is left-aligned.** Without a pill there is no box to centre, and a left-aligned word
  under a left-aligned `Statut` header is the cleanest possible column.

### Minimum width and the horizontal scroll guard

AC25 requires that a narrow viewport scrolls the day card, never the page body. The row's true
minimum is the fixed tracks (496 px) plus gaps (96 px) plus the name minimum (192 px) plus the
card's horizontal padding (40 px) plus the edge (3 px), so **827 px**.

```
<!-- inside the disclosure region -->
<div class="overflow-x-auto">
  <div class="min-w-[52rem]">   <!-- 832 px -->
    …column header line, then the rows…
  </div>
</div>
```

The scroller is inside the card, so the card scrolls and the page never does.

### The identity track

One baseline-aligned flex line. Middle dots join every part, so the whole line reads as one
sequence rather than as a name with things stuck to it.

```
Éditions Pluriel · P-4821 · ⇄ suite · hors stats
```

```html
class="flex min-w-0 items-baseline gap-x-1.5"
  span.sr-only                    → the localized category, AC16
  span "Éditions Pluriel"         → truncate text-[15px] font-semibold tracking-tight text-highlighted
  span "· P-4821"                 → shrink-0 text-sm text-muted        (only when both exist)
  span "· ⇄ suite"                → shrink-0 text-xs text-dimmed       (conditional)
  span "· hors stats"             → shrink-0 text-xs text-muted        (conditional)
```

Only the primary name truncates. Both markers are `shrink-0`, so a rare marker is never the thing
that gets cut.

### The two conditional markers (D9)

Both stop being badges. The split tag ships today as a `UBadge`; it becomes plain dimmed text
carrying its own `⇄` glyph, which is already a stronger mark than the pill around it. The exclusion
marker never becomes a badge in the first place.

- **Split continuation.** `· ⇄ suite`, `text-xs text-dimmed`, with `aria-label` from
  `planning.splitTagLabel`. Dimmed because it qualifies the words figure rather than announcing
  anything about the task.
- **Exclusion.** `· hors stats`, `text-xs text-muted`, with `aria-label` from
  `planning.excludedLabel`. One step brighter than the split tag because it is the thing that
  explains why the day's visible words do not reconcile with the quota, which is a question the
  user will actually ask.

Neither carries colour (AC26). Neither reserves a track, so a row without them draws nothing and
loses no width (D9).

### The status carrier (D7)

**The dot is deleted. `StatusDot.vue` is deleted. The badge survives as the single carrier, and it
loses its pill.**

`StatusBadge.vue` stops rendering a `UBadge` and renders the localized status as coloured
semibold text with no wash, no border, and no box.

```html
<span class="text-sm font-semibold" :class="textClass">{{ label }}</span>
```

```
accepte  → text-info-700 dark:text-info-400
encours  → text-warning-700 dark:text-warning-400
retard   → text-error-700 dark:text-error-400
termine  → text-success-700 dark:text-success-400
na       → text-dimmed font-normal
```

The shade choices are the ones the component already ships, tuned by the simplifying pass to clear
AA on the pale wash. On the plain card surface they clear it by more, not less, so the change is
safe in the direction that matters. The dashed `N/A` box goes with the rest; a non-trackable row
reads `N/A` in `text-dimmed` at normal weight, which is the quietest possible way to hold the
column.

This satisfies D7 in substance. The recommendation was to keep the badge because it is labelled and
already the accessible carrier, and the label and the accessible carrier are exactly what survives.
What is dropped is the rectangle around it. That rectangle is the single heaviest texture on a day
card, five identical filled boxes stacked in one column, and it is the same "a box on every row"
pattern D9 forbids for the markers. Removing it is the largest single decluttering win after the
labels.

`statusKey` and its server-side resolution, including the `retard` pseudo-status, are untouched.

## Labelling: one column header line per open card

**Decision. Kill the per-row labels. Print one column header line at the top of each open card's
disclosure region, and give the region real table semantics so the visible header and the
accessible header are the same object.**

```html
<div role="table">
  <div role="row" class="grid grid-cols-[…] gap-x-4 border-b border-default px-5 py-2">
    <span role="columnheader" class="sr-only">Catégorie</span>   <!-- grip / edge track -->
    <span role="columnheader">Tâche</span>
    <span role="columnheader">Livraison</span>
    <span role="columnheader" class="text-right">Mots</span>
    <span role="columnheader" class="text-right">Durée</span>
    <span role="columnheader">Statut</span>
    <span role="columnheader" class="sr-only">Actions</span>
  </div>
  <div role="rowgroup">…rows…</div>
</div>
```

Header typography: `text-[11px] font-medium uppercase tracking-wide text-dimmed`. One shade
quieter than the shipped per-row labels, because a label that appears once can afford to be
fainter than one the eye keeps re-encountering.

### Why this beats the alternatives

- **Against per-row labels (what ships today).** A five-row card prints ten tiny uppercase labels,
  and this feature would have taken it to twenty-five across five columns. The header line prints
  five, once, and only on cards the user opened. With a typical week of one open day, the whole
  screen carries five label words instead of the current fifty or so.
- **Against no labels at all, with `sr-only` associations.** Tempting, and it is the absolute
  minimum ink. Rejected because it gives a sighted user strictly less than a screen-reader user,
  which is backwards, and because the em-dash cases break it. A row reading `—` in the Livraison
  track and `—` in the Mots track is two identical glyphs in two unlabelled columns, and the
  format-is-self-evident argument collapses exactly when a value is missing. The header line
  survives an empty column; an inferred label does not.
- **Against one sticky column header above the whole week.** Rejected on three counts. It is wrong
  when every day is collapsed, since it would label columns that are not on screen. It sits far
  from most cards once the user scrolls. And the card, not the week, is the horizontal scroll unit
  under AC25, so a week-level header would desynchronise from the tracks it labels the moment a
  narrow viewport scrolled one card.
- **Against per-column icons instead of words.** Rejected outright by D15. An icon per column per
  row is a drawn element per row, which is the thing we are removing.

### Why the table roles rather than `sr-only` text per cell

The header line has to exist visually anyway. Once it does, `role="table"` plus
`role="columnheader"` makes it the accessible header too, so one object serves both audiences and
there is no second copy of the labels to drift. That is the AC23 recommended route and it now costs
nothing extra. The consequence for the frontend stage is that the shipped `<ul>` / `<li>` becomes
`role="rowgroup"` / `role="row"`, with each grid cell carrying `role="cell"`. The accessibility
stage owns the final call and may adjust.

The one thing the table roles do not cover is the category, because the edge is a border rather
than a cell. That is why the identity cell opens with an `sr-only` span carrying the localized
category name, which is AC16's floor.

## The category edge

### One edge, not two (D8, recorded)

**One left edge.** Three reasons, in order of weight.

1. **Ten strips become five.** A five-row card carries five vertical colour strips instead of ten.
   The point of the feature is less clutter, and halving the colour ink for zero information loss
   is the cheapest available win.
2. **A left edge builds a continuous band.** Flush with the card's inner left edge and drawn at full
   row height, consecutive rows of the same category merge into one unbroken strip. Three
   translations in a row read as one block of translation work, which is more than a right edge
   could add and is exactly the at-a-glance scan the owner asked for. A right edge cannot group
   anything, because it is interrupted by the ragged right end of the actions gutter.
3. **Two edges reintroduce the box.** A strip on each side frames the row, and a framed row is the
   pill texture we are removing from the status and the markers. Bracketing every row would undo
   the win on the same screen where we take it.

The owner's own words allow this: "a small left and right border color on categoried tasks **or
something similar**". One edge is the same signal at half the ink.

### The treatment

The edge is the row's own left border, so it adds no DOM node.

```html
<!-- trackable, with a hue -->
<div class="planning-cat-edge border-l-[3px] …" style="--planning-cat-hue: 195">

<!-- non-trackable, or any category with no hue -->
<div class="border-l-[3px] border-l-transparent …">
```

Every row carries the 3 px border whether or not it is drawn, so the geometry is identical and no
row shifts. A non-trackable row draws nothing at all, which is AC18's neutral and which leaves
trackable work visually distinct from breaks and meetings for free.

The day header band carries the same `border-l-[3px] border-l-transparent`, so the header content
and the row content start at the same x with no per-element padding arithmetic.

### The palette rule (D8, extensible)

**One hue angle per category is the entire contract. Lightness and chroma are fixed in one place,
so every category, including one a user creates in `PLAN-30`, lands at the same visual weight and
the same contrast in each mode.**

Add beside the existing `.planning-buffer` block in `app/assets/css/main.css`:

```css
/* Category edge colour. Only the hue varies per category; lightness and chroma are fixed here so
   every category, including a user-created one, has the same weight and the same contrast in each
   mode. A new category needs one number, never a new colour ramp. */
@layer base {
  :root {
    --planning-cat-l: 0.58;
    --planning-cat-c: 0.15;
  }
  .dark {
    --planning-cat-l: 0.74;
    --planning-cat-c: 0.14;
  }
}

.planning-cat-edge {
  border-left-color: oklch(
    var(--planning-cat-l) var(--planning-cat-c) var(--planning-cat-hue)
  );
}
```

Beside the `PLAN-02` contract in `shared/categories.ts`:

```ts
// The category edge hue ring. Slot order is the assignment order, so the earliest slots sit
// furthest from the four reserved status hues (error ~27, warning ~78, success ~148, info ~258).
// PLAN-30 assigns a new category the next unused slot, wrapping modulo the ring length.
export const CATEGORY_HUE_SLOTS = [195, 300, 115, 345, 240, 170, 275, 320] as const

// `edgeSlot: null` means neutral, which with an edge treatment means no edge at all (AC18).
translation → edgeSlot 0 → hue 195 (cyan-teal)
revision    → edgeSlot 1 → hue 300 (purple-magenta)
terminology → null
meetings    → null
breaks      → null
admin       → null
```

Why this shape rather than a set of named tokens:

- **It extends by construction.** A new category needs one integer. There is no ramp to author, no
  contrast to re-tune, and no dark variant to remember, because lightness and chroma are shared.
  That is precisely what D8 asks for and what a palette hand-tuned to the six defaults could not
  give `PLAN-30`.
- **It is theme-fixed on purpose.** This is a **deviation from the spec's wording**, which asks the
  mapping to resolve "to a semantic token name". No semantic token in this project is right for the
  job: `primary` and `secondary` are redefined by all five themes, and `success` / `info` /
  `warning` / `error` are reserved for status. More importantly a category's identity must not
  shift when the user changes atmosphere, for the same reason the status roles are pinned. So the
  category hues are a sixth fixed role, declared once in `main.css` exactly as the brand and
  surface ramps are, and read through a named utility exactly as `.planning-buffer` already is. The
  spec's actual requirement, "so the five themes and dark mode still apply", is met: dark mode is
  handled by the `.dark` override, and the five themes correctly leave category identity alone.
- **No raw hex reaches a component.** The colour resolves in one CSS declaration in `main.css`, the
  same single-source-of-truth discipline the theme ramps follow. A component only ever sets a
  number.

Contrast, approximate and to be confirmed by the accessibility stage per theme:

| Mode | Card surface | Edge L | Contrast |
| --- | --- | --- | --- |
| Light | `bg-default`, near white | 0.58 | ~3.4:1 |
| Dark | `dark:bg-elevated` | 0.74 | ~5.6:1 |

The edge is a supplement, never the whole signal (AC16), so WCAG 1.4.11 does not strictly bind it.
Clearing 3:1 anyway is the right floor for something the owner intends to scan by.

`PLAN-11`'s selector reads the same contract, applying `.planning-cat-edge` to each option, with
non-trackable options drawing no edge. That is what makes the association learnable, and it is one
mapping, never two.

## The day header

Three fixed-geometry zones, so the meter track starts at the same x and ends at the same x on every
card in the week, whatever the day name, the disclosure affordance, or the count do (D11, and the
simplifying pass AC6).

```
grid grid-cols-[20rem_minmax(0,1fr)_15rem]
gap-x-5 items-center relative
border-l-[3px] border-l-transparent
px-5 py-[clamp(0.75rem,1.6vh,1rem)]
```

At `max-w-5xl` that leaves the bar **384 px**, and at `xl:max-w-6xl` **512 px**. Both are longer
than the shipped `min-w-60`.

| Zone | Width | Contents |
| --- | --- | --- |
| Left | `20rem` fixed | chevron, `h2` with the disclosure button, `aujourd'hui` pill, `Congé` tag, task count |
| Middle | `1fr` | capacity bar, work days only |
| Right | `15rem` fixed | capacity reading, work days only, `text-right` |

### The right zone becomes fixed width, and that is a bug fix

The shipped header is `md:grid-cols-[16rem_minmax(0,1fr)_auto]`. An `auto` right track is as wide as
its own content, and the reading's content is not a constant: `6 h 30 planifié · 1 h 00 restant` and
`9 h 00 planifié · 1 h 30 en trop` are different lengths. So the `1fr` middle is a different width
on an overbooked day than on a comfortable one, and **the bars in the shipped week do not actually
line up down the page**. That is a live violation of the simplifying pass AC6, which this feature's
D11 restates.

Pinning the right track at `15rem` (240 px, enough for the longest reading at `text-sm`) fixes it.
Bars now start at the same x and end at the same x on every card, collapsed or open, comfortable or
overbooked.

### Collapsed and expanded, and what moves

| | Collapsed | Expanded |
| --- | --- | --- |
| Chevron | `i-ph-caret-right`, `text-dimmed` | same glyph, `rotate-90` |
| Day name | unchanged | unchanged |
| `aujourd'hui` pill | unchanged | unchanged |
| `Congé` tag | unchanged | unchanged |
| Task count | `5 tâches`, `text-xs tabular-nums text-dimmed` | removed |
| Capacity bar | unchanged | unchanged |
| Capacity reading | unchanged | unchanged |
| Disclosure region | height 0 | natural height |

**Nothing else moves.** The count is the only thing that appears and disappears, and it lives
inside the fixed left track, so its presence cannot change where the bar starts or how long it is.
That is the whole reason it goes there rather than beside the reading.

### The left zone

```html
<div class="flex min-w-0 items-baseline gap-x-2">
  <UIcon aria-hidden="true"
         class="size-4 shrink-0 self-center text-dimmed transition-transform duration-150 motion-reduce:transition-none"
         :class="open && 'rotate-90'"
         name="i-ph-caret-right" />

  <h2 :id="`planning-day-${date}`" class="min-w-0 truncate text-[17px] font-semibold tracking-tight text-highlighted first-letter:uppercase">
    <button type="button"
            :aria-controls="`planning-day-panel-${date}`"
            :aria-expanded="open"
            class="after:absolute after:inset-0 after:content-['']">
      {{ dayLabel }}
    </button>
  </h2>

  <span v-if="isToday"  class="shrink-0 …">aujourd'hui</span>
  <span v-if="offLabel" class="shrink-0 …">Congé</span>
  <span v-if="!open && tasks.length" class="shrink-0 text-xs font-medium tabular-nums text-dimmed">
    {{ t('planning.taskCount', tasks.length) }}
  </span>
</div>
```

- The `h2` keeps the id the section's `aria-labelledby` points at, and the `button` sits inside it,
  which is the canonical accordion shape (AC10).
- The stretched `after:` pseudo-element on the button makes the whole header row the click target
  without wrapping a heading in a button. The header is the `relative` ancestor.
- The chevron is outside the button and `aria-hidden`, so the accessible name is the day and the
  state comes from `aria-expanded` (AC10, AC24).
- **Focus.** Ring the whole header, not just the day name, because the whole header is the target:
  `has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-[-2px]
  has-[button:focus-visible]:outline-primary` on the header container. The accessibility stage may
  simplify this to a ring on the button itself.
- **A day with nothing to disclose** renders no chevron, no button, no count, and no
  `aria-expanded`, and the `h2` carries the day name directly (AC11). The chevron's `size-4` and its
  gap are not reserved in that case, so the day name shifts left by 24 px. That is correct: a card
  with no control should not print an empty slot where a control would be, and the meter is
  unaffected because the left track is fixed either way.
- **Truncation.** 20 rem holds the chevron, the longest day name, and either the pill or the count
  comfortably. It holds all three about 38 px short, which happens only when the user manually
  collapses today. In that one case the day name truncates and everything else stays put. That is
  the correct thing to sacrifice, and it is the only case in the week where anything truncates at
  all.

### The disclosure region and the reveal (D13)

```html
<div class="grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none"
     :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
  <div :id="`planning-day-panel-${date}`" class="overflow-hidden">
    <div class="overflow-x-auto">
      <div class="min-w-[52rem]" role="table">
        …column header line, then the rows…
      </div>
    </div>
  </div>
</div>
```

150 ms, `ease-out`, height only. No slide, no fade, no bounce, no per-row stagger. The chevron
rotates on the same duration so the two read as one gesture. Both are suppressed by
`motion-reduce:transition-none`, and the region snaps.

## The reserved row actions (D10)

The shipped slot is 44 px and carries a comment admitting it is too narrow for the copy and delete
buttons `PLAN-17` and `PLAN-13` will add. Two `size-7` ghost icon buttons with a gap need about
64 px.

The resolution is a **48 px reserved track plus a documented leftward overlay**:

- Track 7 stays at `3rem`, close enough to today's 44 px that the at-rest emptiness does not grow.
- The row carries `group/row` from this feature on, costing nothing.
- `PLAN-17` and `PLAN-13` render the button group absolutely positioned at
  `right-3 top-1/2 -translate-y-1/2`, revealed with `opacity-0 group-hover/row:opacity-100
  group-focus-within/row:opacity-100`, over a short `bg-gradient-to-l from-default` fade so it reads
  cleanly where it overlaps the status column.

Nothing about the grid is re-cut when they land, which is D10's actual requirement. Reserving the
full 72 px instead would print an empty column four times the card's own padding on every row of
every open day, which is the dead space that shrank the slot to 44 px in the first place.

## Key Tailwind decisions

Concrete blueprints, in this repo's idiom.

**Page container**

```
mx-auto w-full max-w-5xl xl:max-w-6xl px-6 sm:px-6 lg:px-8 py-[clamp(1.25rem,3vh,2rem)]
```

**Week stack** — unchanged.

```
space-y-[clamp(1rem,2vh,1.25rem)]
```

**Day card** — unchanged from the simplifying pass.

```
overflow-hidden rounded-2xl
bg-default ring ring-accented shadow-md dark:bg-elevated dark:ring-default    (work day)
border border-default bg-elevated dark:bg-default                            (off day, solid muted)
ring-2 ring-primary                                                          (today, layered)
```

**Day header band**

```
relative grid grid-cols-[20rem_minmax(0,1fr)_15rem] gap-x-5 items-center
border-l-[3px] border-l-transparent px-5 py-[clamp(0.75rem,1.6vh,1rem)]
bg-accented dark:bg-default                                                  (work day only)
has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-[-2px]
has-[button:focus-visible]:outline-primary
```

**Column header line**

```
grid grid-cols-[1rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem] gap-x-4
border-b border-default px-5 py-2
text-[11px] font-medium uppercase tracking-wide text-dimmed
```

**Row list**

```
divide-y divide-default
```

**Task row**

```
group/row grid grid-cols-[1rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem] gap-x-4
items-center border-l-[3px] px-5 py-[clamp(0.5rem,1.1vh,0.75rem)]
planning-cat-edge                       (trackable with a hue)
border-l-transparent                    (otherwise)
```

Single-line rows at that padding are about 40 px tall against today's roughly 58 px, so a five-row
card is 90 px shorter while being easier to read.

**Cells**

```
grip        grid place-items-center text-dimmed opacity-40   +  UIcon size-4 i-ph-dots-six-vertical-bold
identity    flex min-w-0 items-baseline gap-x-1.5
  name      truncate text-[15px] font-semibold tracking-tight text-highlighted
  project   shrink-0 text-sm text-muted
  markers   shrink-0 text-xs text-dimmed / text-muted
livraison   whitespace-nowrap text-sm
  date      text-highlighted
  time      text-muted
mots        whitespace-nowrap text-right text-sm tabular-nums
  done      font-semibold text-highlighted
  slash     text-dimmed
  total     text-muted
duree       whitespace-nowrap text-right text-sm font-semibold tabular-nums text-highlighted
statut      text-sm font-semibold  +  the four semantic text shades
actions     (empty)
```

**Field composition, and a deviation on punctuation**

- **Deadline (D5).** `16 juill.` then a plain space then `16:00`, no separator glyph, with the date
  `text-highlighted` and the time `text-muted`. The spec nudges toward the middle-dot precedent for
  the joiner. **I am deviating.** A middle dot is a separator, and D5 requires the date and time to
  read as one deadline rather than as two adjacent facts. Tone contrast joins them; a dot would
  split them. The middle dot stays where it belongs, on the identity line, where the parts genuinely
  are separate facts.
- **Words pair (D4).** `2 800 / 12 000`, a slash rather than a middle dot, for the same reason
  inverted: a slash is the conventional progress notation and reads as one ratio, where a middle dot
  would read as two independent numbers. The done figure is semibold `text-highlighted`, the slash
  `text-dimmed`, the total `text-muted`, so the pair has a clear numerator and denominator without
  any extra mark.
- **Em dashes.** A missing delivery, a missing or null `wordsDone`, and a non-trackable row's Mots
  all render `planning.emDash` in `text-dimmed`. A missing project total drops the slash and the
  second figure entirely rather than printing `—` after the slash.

## Responsive behaviour

There is none, by design (D14, AC25). One arrangement at every width.

- `TaskRow.vue` loses its mobile grid. `DayCard.vue` loses its stacked-below-`md` header. No `md:`
  variant and no element hidden by breakpoint survives in the planning components.
- The only width-conditional thing left in the feature is the page container's
  `xl:max-w-6xl` step, which changes no internal track and no arrangement.
- Below the row's minimum, the day card scrolls horizontally inside its own `overflow-x-auto`
  wrapper. The page body never scrolls sideways.

## Motion

Everything is gated on `prefers-reduced-motion: reduce` through `motion-reduce:transition-none`.

| Element | Motion |
| --- | --- |
| Disclosure region | `grid-template-rows` `0fr` → `1fr`, 150 ms `ease-out` |
| Chevron | `rotate-90`, 150 ms |
| Row actions (`PLAN-17`, `PLAN-13`) | opacity only on hover and focus-within |

No slide, no fade on the region, no bounce, no stagger. Nothing else animates.

## Component hierarchy

- `app/pages/index.vue` — container widens to `max-w-5xl xl:max-w-6xl`
  - `PlanningWeek` — unchanged
    - `PlanningDayCard` — gains the open boolean, the chevron, the disclosure button, the count, the
      fixed right track, and the disclosure region
      - `h2` > `button` (`aria-expanded`, `aria-controls`, stretched `after:`)
      - `PlanningCapacityBar` — unchanged
      - `PlanningCapacityReading` — unchanged, now in a fixed-width track
      - column header line (new, inline in `DayCard`)
      - `PlanningTaskRow` — rebuilt on the seven-track grid, gains the category edge and the
        Livraison cell, loses the meta line, the labels, and the chip
        - `PlanningStatusBadge` — survives, restyled to plain coloured text
- `PlanningStatusDot` — **deleted** (AC16)
- `PlanningCategoryChip` — **deleted**. Nothing renders it once the edge carries the category, and
  `PLAN-11`'s selector needs an option row rather than a chip. `chipVariant` and `ChipVariant` in
  `shared/planning.ts` go with it as dead code.

## D1 through D15

| | How it is satisfied |
| --- | --- |
| **D1** | One line per task. The meta line is gone and both markers are inline on the identity line, so nothing sits under the name. |
| **D2** | Six of seven tracks are fixed-width, the name is the only `1fr`, and the column header line anchors the columns visually. |
| **D3** | The name is `minmax(12rem,1fr)` and takes all slack: 389 px at `max-w-5xl`, 517 px at `xl`, against about 200 px for the worst seeded case. |
| **D4** | `2 800 / 12 000`, one right-aligned tabular cell with a slash and a done/total weight contrast. Read as a ratio, not two numbers. |
| **D5** | `16 juill. 16:00`, one cell, no separator glyph, joined by tone rather than punctuation. Deviates from the middle-dot nudge, justified above. |
| **D6** | Per-row labels are deleted. One column header line per open card, doubling as the accessible `columnheader` set. Ten labels on a five-row card become five, once, and zero when collapsed. |
| **D7** | Status keeps one carrier. The dot is deleted and `StatusDot.vue` with it. The labelled badge survives and loses its pill; the label, which is what makes it the accessible carrier, is untouched. |
| **D8** | One left edge, weighed against two and recorded. Distinct hue per trackable category. Non-trackable draws no edge. One hue angle per category with shared lightness and chroma, so the palette extends to a `PLAN-30` category with one integer. Light and dark handled by a `.dark` override. |
| **D9** | Both markers are inline dimmed text on the identity line. No reserved track, no box, and no cost to a row that does not carry them. The split tag loses the badge it ships with today. |
| **D10** | A 48 px reserved track, no wider than today's 44 px, plus a documented leftward hover overlay so the two buttons land without re-cutting the grid. |
| **D11** | The left track is fixed at 20 rem and the right track is now fixed at 15 rem, so the bar starts and ends at the same x on every card. The count lives inside the fixed left track, so appearing and disappearing changes nothing. The meter itself is untouched. This also fixes a live AC6 violation in the shipped `auto` right track. |
| **D12** | Everything fits. No at-rest field is dropped. The container widens as a convention-idiomatic step for slack, not out of necessity. |
| **D13** | 150 ms `grid-template-rows` `0fr` → `1fr`, no slide, no bounce, no stagger, suppressed under `prefers-reduced-motion`. |
| **D14** | One arrangement. Both mobile grids are deleted. The only breakpoint left in the feature is the page container's max-width step, which changes no track. |
| **D15** | Ten drawn elements per row become seven, and three pill boxes become zero, while the row gains a field. The only new drawn things anywhere are the chevron and the category edge, both explicitly sanctioned. |

## What I think the spec got wrong

Four things, none of which block the build.

1. **The middle-dot nudge conflicts with D5.** The copy section says the joiner between the delivery
   date and its time "follows the Bout 2 precedent for the middle-dot separator", but D5 requires
   the date and the time to read as one deadline. A separator glyph does the opposite of that. I
   used tone contrast instead and kept the middle dot on the identity line, where the parts really
   are separate. Recorded as a deviation rather than treated as settled.

2. **The shipped capacity bars already do not line up, and the spec does not notice.** D11 asks that
   the meter not be weakened and that AC6 still hold, framed as something to preserve. It is not
   currently true. The `auto` right track in `DayCard.vue:43` is content-sized, and the overbooked
   reading is longer than the comfortable one, so the `1fr` middle differs between cards. This
   design fixes it by pinning the right track, but the frontend stage should know it is repairing a
   regression rather than preserving a property.

3. **`N/A` on every break and meeting row is now the noisiest thing left.** With the pills gone, the
   Statut column on a non-trackable row prints the literal string `N/A` in a column where every
   other row prints a real word. The row's whole point is that its name already is its category and
   it has no status to have. Rendering `planning.emDash` there instead, consistent with the Mots
   cell one column over, would be quieter and more honest. **I have not done it**, because the
   status field is part of the at-rest contract and AC14 makes any change to that set a spec change.
   Flagging it as worth one line of the owner's attention.

4. **Open question 2 is worth reopening after this ships, not before.** Hiding the deadline when it
   falls on the task's own day would empty the Livraison column on most rows, and an empty column
   with a printed header reads worse than a repeated date. AC19's always-show is the right default
   and the column header line makes the repetition cheap. Leaving it alone.

One note that is not a criticism. The spec asks for the category colour to resolve "to a semantic
token name". No existing token in this project can carry it, for the reasons given under the palette
rule, so the design introduces the category hue as a new fixed role alongside the status roles. The
spec's underlying requirement, that the five themes and dark mode still work, is met.
