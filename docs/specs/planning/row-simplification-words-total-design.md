# Design: the words column, one figure

The visual blueprint for [`row-simplification-words-total.md`](row-simplification-words-total.md)
(`PLAN-33`), and it closes `AC10` and nothing else. That spec hands this stage three numbers to
derive, which are the words track width, the scroll floor that follows from it, and whether the
column header still sits above the values it labels once the track moves. It writes no Vue and edits
no component.

It inherits [`extend-tasks-design.md`](extend-tasks-design.md) and
[`category-column-coloured-names-design.md`](category-column-coloured-names-design.md) rather than
replacing either. The track order, the alignment rules, the fixed-track lesson and the derivations
for Livraison, Durée, Statut and Catégorie all stand exactly as those blueprints set them. One track
gets narrower, one floor comes down with it, and one earlier reflow table turns out to be wrong and
is corrected here.

**Nothing is added.** No variance marker, no progress indicator, no icon, no badge, no per-row
performance affordance, and no new colour. `AC8` is a criterion rather than a preference, and the
argument for adding a signal lives in the overview as a parked decision rather than as a brief for
this stage. See [what this design does not add](#what-this-design-does-not-add).

## Summary of the decisions

| #   | Question                                | Decision                                                                                                                    |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | The words track width                   | `7.5rem` becomes **`5.5rem`** (88 px). The measured worst case the cell can ever print is 70.00 px, in French at the bound. |
| 2   | The scroll floor                        | `min-w-[62rem]` becomes **`min-w-[60rem]`** (960 px). The row's true minimum is 952 px, rounded up to the next whole rem.   |
| 3   | Header alignment at the narrowest width | Holds, and it is width-independent, because the words track is fixed. The two grid strings must stay byte-identical.        |
| 4   | The tone of the surviving figure        | It keeps the numerator's `font-semibold text-highlighted`, which is forced by the drop and is measured below.               |

## The measuring rig

The two earlier blueprints estimated cell widths from a per-character basis. This one reads the real
advance widths out of the font the app actually serves, because the whole point of `AC10` is to
re-derive rather than re-guess, and because the bound has to fit rather than the common case.

The font is the Latin subset `@nuxt/fonts` self-hosts for `--font-sans`, which `main.css` sets to
`'Hanken Grotesk', system-ui, sans-serif`. Metrics were read with `fontkitten`, which is already in
the tree as a dependency of `@capsizecss/unpack`, so nothing was installed. The file is the 268-glyph
Regular subset under `.output/public/_fonts/`, `unitsPerEm` 1000, variable on one `wght` axis with a
400 default.

| Glyph                     | Advance in font units | At `text-sm` (14 px) |
| ------------------------- | --------------------- | -------------------- |
| Any digit `0` through `9` | 560                   | 7.840 px             |
| `U+00A0` no-break space   | 260                   | 3.640 px             |
| `U+0020` space            | 260                   | 3.640 px             |
| `U+002C` comma            | 240                   | 3.360 px             |
| `U+002F` slash            | 418                   | 5.852 px             |
| `U+2014` em dash          | 1058                  | 14.812 px            |

**All ten digits share one advance, so the figures are already tabular-width by design.**
`tabular-nums` on the cell is therefore a guarantee that the column keeps aligning if the font is
ever swapped, rather than a feature that changes the metrics of this one. That is worth recording,
because it means the numbers below are the numbers the browser will lay out and not an approximation
of a variant.

For calibration, the same rig against two shipped tracks says the earlier estimates were consistently
high by about a quarter, which is why the old `7.5rem` looked reasonable and is in fact loose.

| Track          | Shipped width | Old estimate             | Measured                   |
| -------------- | ------------- | ------------------------ | -------------------------- |
| Durée `4.5rem` | 72 px         | `10 h 45` 60 px          | `10 h 45` 46.30 px         |
| Statut `6rem`  | 96 px         | `En retard` 74 px        | `En retard` 59.07 px       |
| Mots `7.5rem`  | 120 px        | `12 000 / 12 000` 118 px | `12 000 / 12 000` 98.81 px |

## Decision 1. The words track becomes `5.5rem`

### What the cell can print, at the bound rather than at the common case

`projectWordCountSchema` in [`server/models/tasks.ts`](../../../server/models/tasks.ts) bounds the
value at `10_000_000`, so the widest string the cell can ever hold is eight digits plus two grouping
separators. `formatCount` is a plain `Intl.NumberFormat` on the active locale, which
[`shared/planning.ts`](../../../shared/planning.ts) resolves to `fr-CA` and `en-CA`.

**The French separator is a no-break space and not a thin space, and that is the finding that decides
which locale binds.** Measured with the repo's own ICU, `fr-CA` groups with `U+00A0` at 260 units,
while `fr-FR` and bare `fr` group with the narrow `U+202F`. So the app's own French tag produces the
wider of the two French forms. It is wider than the English comma as well, so French is the case to
size against, exactly as the brief expects, and for a slightly different reason than a thin space
would have given.

One more reason to check that separator rather than assume it. **`U+202F` is not in the served font
subset at all**, and neither is `U+2009`, so a locale that grouped with a narrow space would render
it out of a fallback font at an advance this rig cannot predict. `U+00A0` is present, so the French
string is fully measurable in the font that draws it.

| String       | Locale  | Characters           | Measured at 14 px |
| ------------ | ------- | -------------------- | ----------------- |
| `10 000 000` | `fr-CA` | 8 digits, 2 `U+00A0` | **70.00 px**      |
| `10,000,000` | `en-CA` | 8 digits, 2 commas   | 69.44 px          |
| `9 999 999`  | `fr-CA` | 7 digits, 2 `U+00A0` | 62.16 px          |
| `12 000`     | `fr-CA` | 4 digits, 1 `U+00A0` | 42.84 px          |
| `—`          | either  | one em dash          | 14.81 px          |

So the binding value is **70.00 px**, the French form at the bound. The common case the spec's own
table names, `12 000`, is 42.84 px, and the em-dash empty states are 14.81 px. Every one of them is
right-aligned against the track's right edge, so the widest one is the only one that can overflow.

### Why `5.5rem` and not `5rem` or `6rem`

`5.5rem` is 88 px, which leaves 18.00 px over the binding value, a 26 % margin. Two things spend that
margin and both are real.

**The fallback font, before the webfont loads.** The stack falls back to `system-ui`, whose figures
are wider than Hanken Grotesk's 0.560 em in most of the places this app runs. Taking the widest
realistic candidate, DejaVu Sans at 0.636 em for a digit and 0.318 em for a space, the same string
comes to about 80.1 px. Segoe UI lands near 68 px and SF Pro Text near 75 px. So a pessimistic
fallback ceiling is roughly 80 px, and `5rem` at exactly 80 px would sit on that ceiling with nothing
in hand. The cell carries `whitespace-nowrap`, and the track is fixed, so an overflow does not wrap
or grow the column. It spills sideways into the 16 px gap and then over the Livraison cell, which is
a worse failure than a slightly loose column.

**A forced minimum font size.** Both the track and the type are in rem, so browser zoom and a changed
root font size scale them together and the ratio holds. A forced minimum font size is the one case
that grows the text without growing the track, and the margin turns out to be exactly one such step.
At 17.6 px the French string at the bound measures 88.00 px, which is the track to the pixel, so the
column survives a forced 17.6 px even in its worst case and survives a good deal more than that in
the common one.

`6rem` would clear all of that too and would give back 24 px of scroll floor instead of 32 px. The
extra 8 px buys nothing measurable, and 88 px already carries the bound in the fallback font, so the
narrower value wins. `5.5rem` also stays inside the 0.5rem vocabulary every other fixed track on this
row already uses.

### The column header is not the binding constraint

Worth confirming rather than assuming, because a header wider than its track would wrap and break the
header line. The six headers render at `text-[11px] font-medium uppercase tracking-wide`, so the
measurement adds 0.025 em of tracking per character to the uppercase forms.

| Header      | FR width     | EN width     | Track      |
| ----------- | ------------ | ------------ | ---------- |
| `CATÉGORIE` | 62.11 px     | 59.31 px     | 144 px     |
| `TÂCHE`     | 36.48 px     | 27.74 px     | 192 px min |
| `LIVRAISON` | 56.00 px     | 51.14 px     | 144 px     |
| **`MOTS`**  | **31.22 px** | **40.41 px** | **88 px**  |
| `DURÉE`     | 35.54 px     | 55.33 px     | 72 px      |
| `STATUT`    | 41.45 px     | 41.20 px     | 96 px      |

`WORDS` is the wider of the two words headings at 40.41 px, which is 46 % of the new track. The
values bind this column and the header has more than twice the room it needs, which is the same
relationship it has today. The measurements are taken at the 400 instance while the header renders at
`font-medium`, so the real figures are marginally wider, and a margin of better than two to one
absorbs that without a second measurement.

This is also the second half of `Decision 2` in the spec, measured. A parenthetical qualifier such as
`MOTS (TOTAL DU PROJET)` measures 137.81 px and `WORDS (PROJECT TOTAL)` 136.62 px, so the heading
would be 50 px wider than the whole track and would become the thing that sizes the column, pushing it
past even the `7.5rem` it has today. The spec declined it on truthfulness grounds first, and the width
confirms the trade was bad twice over.

## Decision 2. The scroll floor becomes `min-w-[60rem]`

### The arithmetic

The row's true minimum is the fixed tracks, plus the gaps, plus the name track's own minimum, plus
the card's horizontal padding. The category blueprint's derivation is reused unchanged with one
number moved.

| Part                              | Shipped             | After               |
| --------------------------------- | ------------------- | ------------------- |
| Fixed tracks                      | 40rem, 640 px       | **38rem, 608 px**   |
| Gaps, 7 at `gap-x-4`              | 112 px              | 112 px              |
| Name minimum, `minmax(12rem,1fr)` | 192 px              | 192 px              |
| Card padding, `px-5` on the row   | 40 px               | 40 px               |
| **Row minimum**                   | **984 px, 61.5rem** | **952 px, 59.5rem** |
| `min-w-[…]`                       | `62rem`, 992 px     | **`60rem`, 960 px** |

The fixed tracks are `1rem + 9rem + 9rem + 5.5rem + 4.5rem + 6rem + 3rem`, which is 38rem.

**The floor rounds up to the next whole rem, which is the same rule that produced `62rem` from
61.5rem.** The 8 px of slack lands on the name track rather than being a guess, and keeping the rule
means the frontend stage applies the value without re-deriving anything. The floor stays on the same
`role="table"` wrapper inside the same `overflow-x-auto` scroller, so nothing about the scroll
mechanism moves.

### A correction to the earlier reflow table, and it is the reason this is worth more than 32 px

The category blueprint's viewport table claims the card is scroll-free at a 1048 px viewport and
wider, and that the day card gains up to 32 px of scroll only in the 1024 px to 1047 px band. **That
is wrong, and the container is why.**

`app/pages/index.vue` L196 reads
`mx-auto w-full max-w-5xl px-6 py-[clamp(1.25rem,3vh,2rem)] sm:px-6 lg:px-8 xl:max-w-6xl`. Read
against Tailwind v4's own scale, `max-w-5xl` is 64rem and `max-w-6xl` is 72rem, and `xl` is 80rem. So
the container is capped at 1024 px for every viewport from 1024 px up to 1279 px, and only widens to
1152 px at `xl`. The earlier table assumed the container reached 1088 px of content at a 1152 px
viewport, which it does not.

The card is the container's own width, the card has no padding of its own, and the scroller is the
card's full width, so the scroll amount is simply the floor minus the card's outer width.

| Viewport        | Container content, and the card | Shipped floor 992 px | New floor 960 px | Name track after |
| --------------- | ------------------------------- | -------------------- | ---------------- | ---------------- |
| 1280 px and up  | 1088 px                         | no scroll            | no scroll        | 328 px           |
| 1024 to 1279 px | 960 px                          | **scrolls 32 px**    | **no scroll**    | 200 px           |
| 1008 to 1023 px | 960 to 975 px                   | scrolls 32 to 17 px  | no scroll        | 200 to 215 px    |
| 1000 px         | 952 px                          | scrolls 40 px        | scrolls 8 px     | 200 px           |
| 960 px          | 912 px                          | scrolls 80 px        | scrolls 48 px    | 200 px           |
| 320 px          | 272 px                          | scrolls 720 px       | scrolls 688 px   | 200 px           |

**So the day card is scroll-free today only at 1280 px and wider, and after this change it is
scroll-free at 1008 px and wider.** That is a 272 px band of viewport that stops scrolling sideways,
including every laptop width in the `lg` band, rather than the 23 px band the earlier table implied.
The spec is right that any freed width is an improvement to the reflow floor rather than a licence to
add a column, and the improvement is larger than it reads on paper because the shipped card was 32 px
over the floor across the whole band.

The `lg` padding step is worth one check, because it is where a naive derivation breaks. At 1023 px
the padding is `px-6` and the card is 975 px, and at 1024 px the padding becomes `px-8` and the card
narrows to 960 px. The new floor is exactly 960 px, so the card is still scroll-free on the far side
of that step. It clears it with nothing to spare, which is deliberate rather than lucky, and it is the
reason the floor is not pushed above 60rem.

### WCAG 1.4.10 holds for the same reason it held before

The card keeps scrolling inside its own container and the page body never scrolls sideways, which is
`AC25` of [`extend-tasks.md`](extend-tasks.md). Nothing about that mechanism changes here. The
scroller keeps its tab stop and its `aria-labelledby` pointing at the day heading, there is still one
row arrangement at every width, and no breakpoint is added. The reflow floor moves down, which is
strictly in the direction 1.4.10 wants.

## Decision 3. The header still sits above the values, at every width

**Confirmed, and the confirmation is stronger than the question asks for, because the words column is
width-independent.** Every track on this row is a fixed length except the name, which is the lesson
the row comment already records. So the words track is 88 px at a 320 px viewport and at a 2560 px
one, and the only track that responds to width is `minmax(12rem,1fr)`.

That gives three separate reasons alignment holds.

**The two grids are laid out at the same width, always.** `TaskRow.vue` and `DayCard.vue`'s header row
are siblings inside the same `min-w-[60rem]` wrapper, so both see the identical containing block. The
narrowest width either is ever laid out at is 960 px, because below that the wrapper stops shrinking
and the scroller scrolls instead. The narrowest supported width is therefore not a special case at
all, it is the 960 px case, and at 960 px the words track is still 88 px and the name track is
200 px.

**The flexible track resolves identically in both grids.** `minmax(12rem,1fr)` states its own minimum,
so the `1fr` carries no automatic `min-content` floor that the header's short `TÂCHE` and the row's
long client name could resolve differently. Same free space, same fixed tracks, same gaps, same
result.

**Both cells are right-aligned, so the edges that coincide are the ones the eye checks.** The header
span carries `class="text-right"` and the value cell carries `text-right`, so `MOTS` and `12 000` both
end at the track's right edge, and the figures below line up on their last digit. Nothing about that
changes.

The one thing that can break it is the duplication. **The two `grid-cols-[…]` strings are byte-identical
today and must stay byte-identical**, which is why both are given in full below rather than described.
Changing one and not the other slides every header one track away from the values it labels, and
because the words track is the fifth of eight, the damage would show on Mots, Durée and Statut at
once.

## The two grid strings, verbatim

The frontend stage applies these three strings and derives nothing.

**`TaskRow.vue` L110, the row root.**

```
group/row grid grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_5.5rem_4.5rem_6rem_3rem] items-center gap-x-4 px-5 py-[clamp(0.5rem,1.1vh,0.75rem)]
```

**`DayCard.vue` L243, the column-header row.**

```
grid grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_5.5rem_4.5rem_6rem_3rem] gap-x-4 border-b border-default px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-toned
```

**`DayCard.vue` L221, the scroll floor on the `role="table"` wrapper.**

```
min-w-[60rem]
```

The track list changes in exactly one position, the fifth, from `7.5rem` to `5.5rem`. Every other
track keeps the value its own blueprint derived, and the tracks stay fixed rather than becoming
`auto`, `min-content` or `fr`, because each row is its own grid and a content-sized track drifts from
row to row inside one card.

Nothing else in the repo carries either string. A grep for `7.5rem` and `min-w-[` across `app/`,
`test/`, `shared/` and `server/` returns only these three sites, so there is no fourth copy to keep
in step and no test asserting the old values.

## The tone of the surviving figure, which the drop forces a choice about

The cell holds two spans today with different tones, and only one figure survives, so a tone has to be
chosen either way. This is not an addition and it is not a signal. It is the one presentational
question the removal cannot avoid, so it is settled here rather than left to the frontend stage.

**Decision. The surviving figure takes the numerator's own classes, `font-semibold text-highlighted`,
inside the cell's unchanged `whitespace-nowrap text-right text-sm tabular-nums` wrapper. The two empty
states keep `text-muted`.** In diff terms the numerator span survives and is pointed at
`projectWords`, and the denominator branch with its slash goes.

Two reasons, and the second is a measurement.

**The row's own typographic tier says so.** The row sorts itself into two tiers, recorded in the
category blueprint. Semibold and `text-highlighted` carry the things the row asserts, which are the
task name, the duration and the status. Regular and `text-muted` carry the things the row describes,
which are the delivery date, the markers and the words denominator. The denominator was regular
because it was a denominator, subordinate to a figure beside it. With the pair gone there is no
subordinate figure, only one number of the same kind as the duration, so it belongs in the tier the
duration is already in. Keeping it muted would leave the row with one value column drawn as though it
were still explaining another one.

**`text-muted` does not clear the text floor on the default theme's off-day card.** Measured the same
way the category blueprint measured its palette, with the neutral ramps read out of `main.css` and the
`@nuxt/ui` token mapping read out of its own stylesheet, where light `text-muted` is `neutral-500` and
dark `text-muted` is `neutral-400`.

| Mode  | Card     | Surface                  | pastel   | encre | cafe | automne | foret |
| ----- | -------- | ------------------------ | -------- | ----- | ---- | ------- | ----- |
| light | work day | `bg-default` `#fff`      | 5.18     | 5.42  | 6.52 | 6.89    | 6.25  |
| light | off day  | `bg-elevated` n-100      | **4.44** | 4.54  | 5.37 | 5.54    | 5.17  |
| dark  | work day | `dark:bg-elevated` n-800 | 6.34     | 6.27  | 6.55 | 6.50    | 6.50  |
| dark  | off day  | `dark:bg-default` n-900  | 7.18     | 7.01  | 7.15 | 7.11    | 7.34  |

**4.44:1 on a pastel off-day card in light mode is below the 4.5:1 floor for 14 px text**, and pastel
is the `:root` default rather than an unusual pick. `text-highlighted` on the same surfaces measures
14.44:1 at worst, on that same pastel off-day card, and 16.86:1 or better on the five white work-day
cards, so the lifted figure has no contrast question at all in either mode.

**This is a shipped condition rather than one the drop creates, and the fix here is deliberately
narrow.** On every row a user can create today the numerator is already `NULL`, which the spec
establishes from the write path and the suite, so the words cell already prints a lone muted total at
4.44:1 on that card. Choosing the highlighted tier closes it for the figure, and it does not touch the
em-dash empty states, the delivery time, the project number or the two markers, which are all
`text-muted` on the same surface for the same reason. Re-toning those is a row-wide accessibility
question about a shipped token choice, and it belongs to the accessibility stage or to its own change
rather than to a feature whose brief is to remove a figure. It is reported here so it is not lost.

**It stays the owner's to overrule with a one-class edit.** If he would rather the row's words column
stay quiet and muted, `font-semibold text-highlighted` becomes `text-muted` and nothing else in this
blueprint moves. The measurement above is then the thing to weigh, not the tier rule.

## What this design does not add

`AC8` at criterion strength, so a build stage cannot drift into it.

- **No variance marker, no progress indicator, no estimated-against-actual signal.** The row draws one
  duration and says nothing about whether a task beat its estimate. The four candidate routes stay
  parked in the overview, where they are a recorded decision rather than a brief.
- **No icon, no badge, no chip, no pill, no dot, no meter, no sparkline.** The cell is one text span
  and stays one text span.
- **The colour budget does not grow.** Colour on this row still appears only on the category name, the
  status and the capacity meter above the rows. The words cell carries no hue in either mode, so
  WCAG 1.4.1 is not engaged by it. `text-highlighted` is a neutral semantic token rather than a
  colour in the sense `AC8` caps, and it is already the duration cell's tone one track to the right.
- **No new i18n key and no reworded one.** The heading stays `Mots` and `Words`, and the two empty
  states keep `planning.notSet` and `planning.notApplicable`. No parenthetical qualifier is
  reintroduced, per `Decision 2` of the spec and the width measurement above.
- **No new column.** The 32 px the drop frees is a lower reflow floor and nothing else.
- **No Nuxt UI primitive is added.** The row is a grid of spans by design and the only Nuxt UI
  component in it is the grip's `UIcon`, which does not change.

## Light and dark

Both modes were checked and neither has anything to resolve. The change removes one span and one
separator and introduces no colour, so the only tone question is the one settled above, and
`text-highlighted` measures 14.44:1 at worst on a light card surface, which is the pastel off-day
`bg-elevated` card, and 16.86:1 or better on the five white work-day cards, and it resolves to `#fff`
in dark. Every one of those is far above the 4.5:1 floor for this text size. The em-dash empty states keep the row's shipped missing-value treatment in both modes. Nothing
in this cell carries meaning through colour, so a forced-colors environment degrades with no work,
which is the same conclusion the spec's own edge case reaches.

## Responsive behaviour

There is one row layout and one header layout at every width, so `AC25` and `D14` hold and no
breakpoint is added.

- **`xl` and up, 1280 px.** `max-w-6xl` gives the card 1088 px and the name track 328 px, which is
  32 px more than it has today. No scroll.
- **1008 px to 1279 px.** The card is 960 px to 975 px and the name track is 200 px to 215 px. No
  scroll, where today this whole band scrolls by up to 32 px.
- **Below 1008 px.** The day card scrolls horizontally inside its own `overflow-x-auto`, 8 px at
  1000 px and more below. The page body never scrolls sideways. The scroller keeps its tab stop and
  its accessible name.
- **320 px and 200 % zoom.** Unchanged in kind from what ships, 32 px better in degree. The card
  scrolls, and the day header band's narrowed-but-not-solved problem is untouched, because this
  feature does not touch the band's grid.

## Motion

**None added, and none removed.** The only two transitions on this surface are the disclosure region's
`transition-[grid-template-rows] duration-150 ease-out` and the chevron's
`transition-transform duration-150`, and both already carry `motion-reduce:transition-none`. A number
does not animate, does not fade in and gets no hover treatment, because the row is strictly read-only
until `PLAN-11`. The `.btn-glow` ring is for buttons and has no business on a table cell.

## What the frontend stage applies

Three class edits and one template edit, and nothing to derive.

1. `TaskRow.vue` L110, the grid string above.
2. `DayCard.vue` L243, the grid string above. It changes in the same commit as L110 or the headers
   stop sitting above their values.
3. `DayCard.vue` L221, `min-w-[62rem]` becomes `min-w-[60rem]`.
4. `TaskRow.vue` L193 to L214, the words cell. The wrapper keeps
   `whitespace-nowrap text-right text-sm tabular-nums`. The non-trackable branch and the null branch
   keep their current shape, an `aria-hidden` em dash with `sr-only` text behind it, `Sans objet` for
   a non-trackable row and `Non précisé` for a trackable row with no total. The surviving figure span
   keeps `font-semibold text-highlighted` and reads `projectWords`. The slash span and the second
   figure go.

The accessibility comment at L193 to L197 goes with the pair rather than being reworded, which is
`AC7`'s call and not this blueprint's, and the em-dash-rather-than-zero reasoning transfers onto the
surviving figure, which is `AC1`'s.

## Open items this blueprint does not close

1. **`text-muted` measures 4.44:1 on a pastel off-day card in light mode.** Reported above, narrowed
   for the words figure, and left open for the row's other muted values and for the em-dash empty
   states. It is a shipped token choice on a shipped surface rather than anything this feature
   introduces, and it wants either the accessibility stage's read or its own change.
2. **The category blueprint's viewport table is wrong about the container and stays wrong.** Its
   claim that the card is scroll-free at 1048 px assumed a container width `max-w-5xl` does not give
   in the `lg` band. The correction is recorded here with the numbers. Amending that document is not
   in this feature's scope, and `AC12` says anything outside the named surface is drift, so the
   correction lives in this blueprint and the owner can decide whether the older one gets a note.
3. **The tone of the surviving figure is the owner's to overrule.** One class either way, with the
   measurement above as the thing to weigh.
