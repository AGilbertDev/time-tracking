# Design: the tenth task category, `other`

Design stage for [other-category.md](other-category.md), the spec that adds a tenth category `other`,
named **Autre** in French and **Other** in English. The spec left three things to this stage. The
colour, how the tenth option is set apart in the selector, and how the status control presents now
that the category is non-trackable and still carries a status.

This document decides all three and shows the arithmetic behind the colour. It writes no
implementation code.

**A note on which version of the spec this answers.** I began against an earlier draft that called this
member `uncategorized` and argued its colour from the premise that it means "unset". That draft was
renamed and corrected while this stage ran, and I re-read the corrected file before finishing. The
corrected framing is the one used throughout below, which is that `Autre` is other work rather than a
gap in the record, so an ordinary hue at the shared chroma is the expected answer and the no-neutrals
rule is barely in tension. Nothing here argues against the spec as it now stands.

## Summary of the three decisions

1. **The colour is hue 90, an ordinary member of the palette at the shared lightness and chroma.** No
   exception, no neutral, no chroma override, and no new member on the `Category` descriptor for
   colour. Its worst reading across the twenty card surfaces is 5.47:1 in light and 6.42:1 in dark,
   both above the 4.5:1 floor and both mid-pack among the ten.
2. **The tenth option is set apart by a separator above it and by nothing else.** No muting, no icon,
   no suffix, no reordering. The separator is decorative, is skipped by keyboard navigation, and is
   already `aria-hidden` in the shipped component.
3. **The row is unchanged in kind and the `Statut` field presents as an ordinary enabled control.**
   `Autre` prints as a coloured word in the category cell exactly as the nine do, and `Statut` is
   operable from the moment a draft opens, with the help line reserved so the enable and disable flip
   costs no layout shift.

## Question one, the colour

### Why not a neutral, under the corrected framing

`PLAN-32c` ruled that no member of the palette is a neutral, and it gave two reasons. The first is
mechanical, that a pale grey at the shared chroma of 0.11 resolves to more than twice any theme
neutral's chroma and therefore cannot read as grey anyway. The second is the load-bearing one, that a
category name rendered as a neutral collides with the row's own `text-muted` and reads as
de-emphasised text rather than as a category colour.

The stale draft wanted the exception because "unset" is what a neutral communicates. `Autre` does not
mean unset, so that argument is gone. What remains is the collision, and it now points the other way
than the draft assumed. `Autre` is the one member that most needs to look like a live value, because
it is the member a user is most likely to suspect of being an error state. It carries a status, it
carries a word count, and the whole spec exists to stop the app treating an unclassified row as
lesser. Greying its name would say exactly the thing the feature is trying to stop saying.

So the exception is not taken, `PLAN-32c`'s rule survives whole with ten members rather than nine, and
`UC29`'s second branch applies. The guarantee is cited rather than replaced. I re-measured anyway,
below, because a tenth member is a good moment to check that the instrument still agrees with the
published figures.

### The rig, and proof it can produce a known answer

I rebuilt the measurement rather than reasoning from the published tables. OKLCH to sRGB with CSS
Color 4 section 13.2 gamut mapping, which is a binary search on chroma under a `deltaEOK` budget of
0.02 with local clipping, then 8-bit quantisation, then WCAG 2.x relative luminance and contrast. The
twenty surfaces are resolved out of `app/assets/css/main.css` lines 28 to 93 and `DayCard.vue`, so a
work day is `bg-default` in light and `dark:bg-elevated` in dark, and an off day is the other way
round.

Before trusting it on a new hue I ran it on the nine that already ship. It reproduces all eighteen
published hex values byte for byte, `#006b6c` and `#00c4c4` for translation through `#864900` and
`#e6964f` for dtp. The ratios land 0.01 to 0.02 above the published ones, which is a rounding
difference in the quantisation step and not a disagreement about whether anything passes. The
whole-wheel minimum comes out at 5.00:1 at hue 177 in light against the published 5.02:1 at hue 175,
and 6.05:1 at hue 355 in dark against the published 6.07:1 at hue 352. Same conclusion, every integer
hue from 0 to 359 clears 4.5:1 on all twenty surfaces.

### Where the tenth hue goes, and the finding the spec did not expect

The spec asked for "one integer that is far enough from all nine existing hues to be told apart",
which reads as though such an integer is easy to find. **It is not, and this is the real finding of
the colour work.** The palette is full.

Perceptual distance at a fixed lightness is the Oklab chord between two hues at their own effective
chromas, which is what the original blueprint used when it put the revision sibling pair at 0.0470.
Sweeping all 360 candidates and taking, for each, the smallest chord to any of the nine in the worse
of the two modes, the best placement available is **hue 90 at 0.0493**. Every other placement is
worse. The three peaks are hue 90 in the dtp-to-revision_external arc, hue 169 in the
revision_internal-to-translation arc, and nothing else above 0.045.

For scale, the existing palette's tightest pairs are as follows.

| Pair                                      | Light chord | Dark chord |
| ----------------------------------------- | ----------- | ---------- |
| `revision_internal` / `revision_external` | 0.0469      | 0.0563     |
| `proofreading` / `breaks`                 | 0.0564      | 0.0782     |
| `translation` / `proofreading`            | 0.0627      | 0.0771     |
| `meetings` / `admin`                      | 0.0662      | 0.0782     |

So a tenth member cannot be placed without creating a pair about as tight as the deliberate sibling
pair. At hue 90 it creates two of them, 0.0493 to `dtp` and 0.0509 to `revision_external`. The
sibling pair stays the tightest in the palette, which is the property `AC5` of `PLAN-32c` rests on,
but its margin over the next pair falls from 20 percent to 5 percent. That is a real cost and it is
recorded here rather than glossed.

### Why hue 90 rather than hue 169

Hue 169 measures almost as well on raw spacing, 0.0484, and it is the wrong answer for two reasons.

It sits inside the arc the original blueprint deliberately left empty. `revision_external` was moved
to 115 rather than 165 precisely so that the 140-to-195 arc would stay clear, "which protects the two
most frequent categories in the app from each other". Putting a third colour in that gap spends the
protection that placement bought.

And `Autre` is itself frequent. It is the create default, the coercion target for every stale stored
id, and the value any hurried row lands on. Placing a frequent category between the two most frequent
categories is the worst available trade. Hue 90's neighbours are `dtp` at 60, which is non-trackable
and uncommon, and `revision_external` at 115, which is the least common of the four trackable ids.

Within the 60-to-115 arc the placement is nearly forced. Below hue 88 the chord to `dtp` drops under
0.0469 and `Autre` and `dtp` become the tightest pair in the palette, displacing the siblings
outright. Above hue 92 the same happens against `revision_external`, and that one is worse because
confusing a non-trackable row with a trackable one is the confusion that costs a number. Hue 90 is the
midpoint of the only window where both neighbours stay clear of the sibling pair, and it is also the
maximum of the minimum. One integer, arrived at by measurement rather than by taste.

### Why the tighter spacing is acceptable on this member specifically

The palette's spacing budget should be spent where the words are hard to tell apart, and **`Autre` is
the easiest word in the set**. It is five characters, it is the shortest label of the ten, and it
shares no prefix with anything. The nine work categories include `Révision interne` and
`Révision externe`, which differ only in their last word and are exactly why the category cell carries
no `truncate`. Colour is doing its hardest scanning work on that pair. On `Autre` it is doing almost
none, because the word resolves the row on its own at a glance.

There is also a pleasant accident in where the measurement landed. Hue 90 at the shared chroma renders
as a dark khaki in light and a brass gold in dark. It is the drabbest region the wheel can reach at
this lightness, since yellows and yellow-greens are the most gamut-compressed, and its effective
chroma of 0.096 in light is the third lowest of the ten. So the palette's most generic-looking colour
lands on its most generic category without any rule being bent. That is a nice outcome rather than a
justification, and it is not why hue 90 was chosen.

### The measured colour

| Mode  | Nominal        | Resolved  | Effective chroma |
| ----- | -------------- | --------- | ---------------- |
| light | `0.47 0.11 90` | `#735700` | 0.096            |
| dark  | `0.74 0.13 90` | `#cba63a` | 0.130            |

The light value is gamut mapped from a nominal 0.11 down to 0.096, which puts `other` in the same
group as `translation` at 0.082 and `proofreading` at 0.100. Lightness is exactly even with the other
nine, which is what carries the contrast. The dark value is not mapped at all.

The hex values are informational and **nothing in the codebase holds one**. They are here so a later
reader can re-check a ratio without re-running the rig.

### The twenty cells

Every cell is the contrast ratio of the `Autre` name against its card background. The floor is 4.5:1
under WCAG 2.2 AA 1.4.3, because the name is 14 px regular text.

**Light, work-day card (`bg-default`, `#ffffff`, identical in all five themes).** 6.79:1.

**Light, off-day card (`bg-elevated`, `neutral-100`). This block holds the worst cell.**

| pastel | encre | cafe | automne  | foret |
| ------ | ----- | ---- | -------- | ----- |
| 5.82   | 5.69  | 5.59 | **5.47** | 5.61  |

**Dark, work-day card (`dark:bg-elevated`, `neutral-800`). The harder of the two dark surfaces.**

| pastel   | encre | cafe | automne | foret |
| -------- | ----- | ---- | ------- | ----- |
| **6.42** | 6.98  | 7.39 | 7.32    | 6.82  |

**Dark, off-day card (`dark:bg-default`, `neutral-900`).**

| pastel | encre | cafe | automne | foret |
| ------ | ----- | ---- | ------- | ----- |
| 7.27   | 7.81  | 8.07 | 8.01    | 7.71  |

The worst cell is **5.47:1, on an automne off-day card in light mode**, the same surface that binds
all nine existing categories. Against the nine re-measured on the same rig, `other` ranks fifth of ten
by worst cell, between `revision_external` at 5.39:1 and `breaks` at 5.56:1. It has 0.97 of headroom
over the floor and it is nowhere near being the binding member. The single number to re-check on the
built page is still translation's 5.07:1, not this one.

### One watch item, and it is milder than the one already accepted

The original blueprint flagged `dtp` against café's and automne's `text-muted`, since both of those
theme neutrals are warm tones at the same lightness as the category names. `other` is a warm tone at
the same lightness too, so the same check applies to it.

| Category     | vs café `neutral-500` `#6e5a48` | vs automne `neutral-500` `#7a5040` |
| ------------ | ------------------------------- | ---------------------------------- |
| `other` (90) | 0.0642, about 3.2 JND           | 0.0689, about 3.4 JND              |
| `dtp` (60)   | 0.0731, about 3.7 JND           | 0.0547, about 2.7 JND              |

`other` is better separated from the muted text than `dtp` already is at its worst, so this adds no
new watch item and does not raise the existing one. `text-muted` never appears in the category column
in any case, so the two are never adjacent.

### What `PLAN-30` inherits, said plainly

The contrast guarantee is untouched. Every integer hue from 0 to 359 still clears 4.5:1 on all twenty
surfaces at the fixed lightness and chroma, because nothing about the fixed values changed and no
member opts out of them. A user-created category still needs one integer and still gets its contrast
for free.

What `PLAN-30` inherits worse is uniqueness, which the original blueprint already named as the open
product question rather than a contrast question. With nine members the wheel had two arcs of 55
degrees. With ten it has four arcs of about 27, and the best a user can now do is a chord of roughly
0.027 to the nearest existing member, which is inside one just-noticeable difference. **A tenth
category is the point at which handing the user a free hue wheel stops being safe on its own, and
`PLAN-30` will need to either suggest a hue or warn about a collision.** That is a consequence of this
feature and it belongs in `PLAN-30`'s spec rather than being discovered when a user picks a duplicate.

### What the contract stage takes from this

One integer and nothing else. The descriptor keeps the shape it has today plus the second per-category
fact the spec already asked for, and the colour adds no member to the type.

```text
{ id: 'other', trackable: false, hue: 90, deliverable: true }
```

The second fact is the one named under the spec's `§ The status field`, and the contract stage
finalized it as `deliverable`, which is the name that shipped alongside the `isDeliverableCategory(id)`
helper. It is true for `other`, because `Autre` is work that can be in progress and can have words.
`trackable` is false, so nothing it holds reaches a quota. No
colour value for `other` exists anywhere outside `shared/categories.ts` and the fixed properties in
`main.css`, which is `UC28`.

The comment beside it should record that hue 90 is the maximum of the minimum Oklab chord to the nine,
that its neighbours are `dtp` and `revision_external` at about 0.05, and that the wheel is now full.
That sentence is what stops the next reader adding an eleventh hue by eye.

## Question two, setting the tenth option apart in the selector

### The decision

**A separator above `Autre`, and nothing else.** The items array is the ten categories in contract
order with one structural item inserted between index 8 and index 9, so `Autre` renders below a hairline
rule and is otherwise identical to the nine.

### Why a separator rather than nothing

The spec is right that the list mixes nine kinds of work with one residual class, and right that this
is presentation rather than contract. Doing nothing is defensible now that `Autre` names real work,
and I still think the rule earns its place, for one reason that survives the corrected framing.

`Autre` is the preselected value on every new draft. A user who opens a draft and then opens the
category list is looking at a list whose selected item is the last one, and the useful thing to tell
them in that moment is where the nine specific choices are. A rule above the last item says "the
choices are above this line, and the one you have is the fallback" without ranking anything or
disabling anything. It is the cheapest possible way to say that a list of ten contains one entry of a
different kind.

### Why nothing else

Everything else considered was rejected, and the reasons are worth keeping because each is a thing a
later stage might otherwise add.

**Muting it, in `text-dimmed` or at reduced opacity, is rejected.** It would say the option is lesser
or unavailable, and it would break the one behaviour the owner asked for by name, which is that every
option prints in its own row colour. It would also be the app quietly discouraging a legal choice,
which is the shape of policing this project rules out.

**An icon or a suffix such as "(par défaut)" is rejected.** It adds a visible string that needs
researching in both languages and owner sign-off, on a control where the printed name in its own
colour is deliberately the entire carrier. `PLAN-32c` chose no swatch, no dot and no pill for that
reason, and a badge on one option would be the first exception.

**A group label instead of a bare separator is rejected for the same reason.** `USelectMenu` supports
`{ type: 'label' }` and it would need copy in `fr.json` and `en.json`. The bare rule communicates the
break with no string at all, and a string the owner has to read is a cost with no matching benefit.

**Reordering is not available.** `UC17` fixes contract order and the spec forbids reordering to solve
presentation. The separator respects that, because it changes no index.

### The mechanism, verified rather than assumed

`USelectMenu` already handles this and needs no custom markup. I checked the shipped component rather
than trusting the documentation.

- `node_modules/@nuxt/ui/dist/runtime/components/SelectMenu.vue` line 150 treats `label` and
  `separator` as structural items, so a separator is skipped by keyboard navigation and cannot be
  selected or highlighted.
- Line 276 renders it through Reka UI's `ComboboxSeparator`, which sets `aria-hidden="true"` on its
  root. So it is never announced, and a screen reader user hears ten options with no extra noise.
- The default theme class is `-mx-1 my-1 h-px bg-border`, which is already a semantic token and works
  in both modes. **Do not override it.**

That means the separator is purely visual and carries no meaning that a non-sighted user loses. That
is correct, because it carries no meaning a user needs. The categories are ten peers and the rule is a
scanning aid, so there is nothing here that would need a text equivalent under 1.4.1.

### The preselected draft state reads as a plain selected value

The spec asked whether the preselected create state reads as plain or muted, subject to `UC25`.
**Plain.** The closed trigger renders `Autre` through `.planning-cat-name` at hue 90, in exactly the
treatment an edited task's category gets.

Muting it would reintroduce the placeholder semantics the spec just removed. The preselected value is
not provisional and it is not a suggestion, it is the value that will be stored if the user presses
save without touching the field, and `UC25` requires the stored outcome to be named on screen before
the save. A greyed word says the field is empty, and the field is not empty.

Two consequences follow for the shipped editor design.

- **The placeholder branch goes.** `task-inline-editor-design.md` gives the trigger a
  `v-else` span in `text-dimmed` for the no-selection case. There is no longer a no-selection case, so
  that branch and `planning.editor.fields.categoryPlaceholder` both go, which is what `UC27` predicted.
- **The transparent left edge goes.** That document says "A draft with no category yet draws
  `border-l-transparent` and keeps the 2 px". A draft now opens with a category, so
  `.planning-cat-edge` is coloured from the first paint and the transparent case is dead code. The
  caution attached to it still holds in its real form, which is that the edge binds to the model rather
  than to `categoryHue(undefined)`. Those two happen to agree now, since the coercion fallback and the
  create default are the same id, and binding to the model is still what makes the edge honest.

### Both required behaviours survive

The owner asked for two things about the selector and both are intact. Each option prints in its own
row colour, `Autre` included, through the same `.planning-cat-name` and the same `categoryHue` read
from the shared contract. And the colour updates live as the field changes, on the closed trigger and
more visibly on the panel's left edge, with `Autre` behaving no differently from the nine.

The selector still introduces no unmeasured surface. The trigger is `bg-default`, the menu content is
`bg-default`, and a highlighted option is `bg-elevated`. All three are inside the twenty cells measured
above, so hue 90's contrast claim carries into the dropdown without a second measurement.

## Question three, the row, the words cell, and `Statut`

### The row, and a correction to the premise

The brief describes the collapsed row as carrying the category "as a colour on its edge with the name
available to assistive technology". **That is the pre-`PLAN-32c` design and it is no longer what
ships.** `PLAN-32c` retired the row edge and moved the colour onto the printed category name, which is
the change that reversed `AC18` of `extend-tasks.md` and deleted `edgeSlot`. I confirmed it in the
shipped component. `app/components/planning/TaskRow.vue` line 177 carries
`class="planning-cat-name whitespace-nowrap text-sm font-normal"` with `role="cell"` and
`:style="{ '--planning-cat-hue': catHue }"`, and there is no edge binding on the row root.

That correction makes the answer simpler than the question implies. The name is real text in the
category cell, so it is not "available to assistive technology" as a separate affordance, it is the
carrier itself. A user who perceives no colour reads the word and loses nothing, which satisfies
1.4.1 by construction.

### So `Autre` reads on the row exactly as the nine do

The word `Autre` in `#735700` on light and `#cba63a` on dark, `text-sm font-normal`, no truncate, in
the category cell. **No marker, no italics, no muting, no badge.** Nothing distinguishes it from the
nine and nothing should.

The row is a scanning surface, and a marker on `Autre` would claim the row is incomplete. It is not.
A row can be `Autre` because the user chose it, and the row that landed there by omission is a row the
user is entitled to leave exactly as it is. The extend-tasks design gives the row two conditional
markers already, and a third that fires on a valid, deliberate, and common category is noise that the
user cannot act on and would not want to.

The separator in the dropdown and the plainness on the row are not in tension. The dropdown is a
choosing surface where saying "this last entry is a different kind of thing" helps, and the row is a
reading surface where the same statement would read as a complaint.

`Autre` is the shortest of the ten labels, so it cannot widen the category track and the horizontal
scroll guard's minimum width is unchanged. The track was sized for `Révision externe`.

### One visible consequence worth naming

`categoryHue` coerces before it resolves, so after this change every stale or unknown stored value
paints hue 90 rather than `admin`'s 305. A row holding the retired `revision` currently prints
`Administration` in violet and will print `Autre` in khaki. That is the intended outcome of moving the
fallback and it is worth stating because it is a visible change to existing data with no migration
behind it.

### The words cell

`UC14` makes the `Mots` cell print an uncategorized row's stored word count instead of the em dash,
keyed on the new second fact rather than on `trackable`. What the user sees is that an `Autre` row with
1200 words prints 1200, and an `Autre` row with no count prints the em dash with `planning.notSet`,
which is `Non précisé`.

The five categories that carry no status keep today's rendering exactly, the em dash with
`planning.notApplicable`, which is `Sans objet`.

**Both render as the same glyph and only the accessible text differs, and that is fine because it is
not new.** A `translation` row with no words logged already prints the em dash under `notSet`, and a
`breaks` row already prints it under `notApplicable`. The two readings already sit in one column
looking identical. `Autre` moves from the second group into the first, which changes which group it
belongs to and introduces no new ambiguity. If the owner ever wants the two distinguished visually,
that is a change to the `Mots` cell for all ten categories rather than something this feature should
invent for one.

### `Statut` presents as an ordinary enabled control

**`Autre` carries a status, so the field is enabled, operable, and carries no help line.** The
`USelect` shows its four options and behaves exactly as it does on a `translation` task. Nuxt UI's
disabled styling never applies and `planning.editor.fields.statusUnavailable` never renders.

The rule the field reads changes from "disabled when the category is not trackable" to "disabled when
the category does not carry a status". Those two are the same fact for nine of the ten members and
differ only for `Autre`, which is the whole point of the spec pulling the two meanings apart. The
editor stage must key the `:disabled` binding on the new flag and not on `trackable`, because keying
it on `trackable` reproduces today's bug on the one row that needed fixing.

What the user sees in each of the three moments.

| Moment                                       | `Statut`                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A fresh draft opens with `Autre` preselected | Enabled, empty, no help line. This is `UC26` and it is a visible change, since today a draft's `Statut` opens disabled. |
| The user picks `Pauses`                      | Disabled, help line appears in `text-muted` under the control                                                           |
| The user picks `Autre` again                 | Enabled again, help line goes                                                                                           |

### The one new layout problem, and how to hold it still

The help line appearing and disappearing under `Statut` changes that field's height by about one line.
At `@4xl/day` the field shares a grid line with `Durée estimée` and `Durée réelle`, so the line grows
and everything below it, `Quota`, `Exclure des stats` and `Notes`, shifts down and then back up as the
user moves between categories. The control causing the shift is on grid line 1 and the shift happens on
grid line 3, below where the user is looking, which is how it would go unnoticed as a defect and still
be irritating.

**Reserve the help line's height on the `Statut` grid cell at `@4xl/day` only.** The field's wrapper
already carries `col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-4`, and it takes one more class in
the `@4xl/day` variant that pins the cell to the taller of its two states. Below that breakpoint each
field is on its own line, the shift is local and small, and reserving a permanently empty line costs
vertical space on exactly the viewport where vertical space is scarce, so it is not reserved there.

The exact value is measured at build time against the shipped `md` control rather than guessed here,
because a hardcoded height that does not match the rendered label, input and help stack is worse than
no reserve at all. It is the sum of the `UFormField` label line, the `md` input, both gaps, and one
`text-xs` help line.

The existing note about disabled selects not being focusable carries forward unchanged. It was recorded
as a decision rather than an oversight, the spec still says disabled, and this feature narrows the set
it applies to from six categories to five rather than changing the treatment.

## Layout regions

Nothing new. This feature touches three existing regions and adds none.

- **The collapsed task row's category cell.** One more possible value, rendered identically.
- **The editor panel's category selector and its coloured left edge.** One more option, one separator,
  and a preselected value on drafts.
- **The editor panel's `Statut` field.** A changed disable rule and a reserved help line.

## Component hierarchy

- `PlanningTaskRow`
  - category cell `span.planning-cat-name` `role="cell"` (`text-sm font-normal whitespace-nowrap`, `--planning-cat-hue` from `categoryHue`)
  - `Mots` cell (prints the figure for `other`, em dash with `planning.notSet` when null)
- `PlanningTaskEditor`
  - `form.planning-cat-edge` (`border-l-2`, always coloured, transparent case retired)
    - `UFormField` Catégorie
      - `USelectMenu` (ten options plus one `{ type: 'separator' }` between index 8 and 9)
        - `#default` `span.planning-cat-name` (the selected category, plain, never dimmed)
        - `#item-label` `span.planning-cat-name` (each option in its own colour, `Autre` included)
    - `UFormField` Statut (`:help` only when the category carries no status)
      - `USelect` (`:disabled` keyed on the second per-category fact, never on `trackable`)

## Key Tailwind decisions

- **Category colour, unchanged mechanism.** `.planning-cat-name` and `.planning-cat-edge` both resolve
  `oklch(var(--planning-cat-l) var(--planning-cat-c) var(--planning-cat-hue))`. The component sets one
  number and reads it from `categoryHue`. No file gains a hue literal.
- **`main.css` is not edited by this feature.** `--planning-cat-l` and `--planning-cat-c` keep `0.47`
  and `0.11` in light and `0.74` and `0.13` in dark. A tenth member at the shared values needs no new
  rule, which is the point of the fixed-value design.
- **The separator keeps its default theme class**, `-mx-1 my-1 h-px bg-border`. Semantic token, both
  modes, no override.
- **The `Statut` cell reserves its help line at `@4xl/day`**, one `min-h` on the existing
  `col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-4` wrapper, applied in the `@4xl/day` variant
  only.
- **No new colour utility anywhere.** Every surface, border and muted text stays on `bg-default`,
  `bg-elevated`, `bg-border` and `text-muted`. The only non-token colour on screen is the category
  name itself, which is the one deliberate exception the project already made.

## Responsive behaviour

The selector's tenth option and its separator are width-independent and change nothing at any
breakpoint. The dropdown is already full width through `class="w-full"`.

`Autre` is the shortest of the ten labels, so the category track's sizing and the horizontal scroll
guard's minimum width are both unchanged, and no track needs re-deriving.

The only breakpoint-conditional decision in this document is the `Statut` help-line reserve, which
applies at `@4xl/day` and not below, for the reason given above.

## Motion

**None is added, and one thing must stay instantaneous.** The category colour on the closed trigger and
on the panel's left edge changes the moment the model changes, with no `transition-colors`. A colour
transition on a category would blur which category is selected during the fade, which is the opposite
of what the live colour requirement is for.

The enable and disable flip on `Statut` is not animated either. The reserved help line is what makes it
read as a state change rather than as a jump, and a fade on a control's availability would slow down a
user moving through the form.

Nothing here introduces a `@media (prefers-reduced-motion: reduce)` gate because nothing here moves.
The existing gates elsewhere in the app are untouched.

## What I think the spec gets wrong

Listed for the stages that come after, in rough order of how much they matter.

The two biggest things I had written here, that the spec was still written against `uncategorized` and
that its colour section reasoned from the stale meaning, were both fixed by the rename pass before I
finished. They are gone from this list rather than left standing, and what follows is measured against
the corrected file.

1. **The spec assumes a well-spaced tenth hue is available and it is not.** It asks for "one integer
   far enough from all nine existing hues to be told apart, which is a uniqueness question rather than
   a contrast one". The uniqueness framing is right and the measurement says the answer is worse than
   the sentence implies, because the best placement on the whole wheel lands about as close to two
   neighbours as the deliberate sibling pair is to itself. The choice is still sound and the cost is
   real, and the contract comment should record it so nobody adds an eleventh by eye.
2. **The spec's stage list skips accessibility, and I would run a short one anyway.** Its rule is that
   accessibility runs "only if the design stage takes the colour exception", and I did not take it, so
   by that rule the stage is skipped. Two things in this document are new and neither is a contrast
   question, which is the only thing that rule anticipated. The separator's behaviour inside the
   listbox is verified above but not tested, and `Statut` flipping between disabled and enabled on a
   draft is a form-control state change the shipped design never had at open time. A pass scoped to
   those two, rather than a full audit, is cheap and closes both.
3. **`task-inline-editor-design.md` carries two passages this makes dead**, and the spec's supersession
   list does not mention either because it lists spec passages rather than design ones. The trigger's
   `v-else` placeholder branch in `text-dimmed` has no remaining case, and the
   `border-l-transparent` draft state has no remaining case. Both should be annotated in that document
   rather than silently dropped, since stages are building against it.
4. **The brief's own framing of the row is stale**, as recorded under question three. The row carries
   the colour on the printed name, not on an edge, and has since `PLAN-32c`. Worth fixing wherever it
   is repeated, because a stage that implements the brief literally would reinstate a retired edge.

## What each stage takes from here

- **Contract and i18n.** Hue 90 on the `other` descriptor, the comment recording why, and
  `categories.other` as `Autre` and `Other` in both locale files. No change to `main.css`.
- **Editor.** The separator item between index 8 and 9, the preselected plain trigger, the deleted
  placeholder branch, the deleted transparent-edge branch, the `:disabled` binding keyed on the second
  fact, and the `@4xl/day` help-line reserve.
- **Unit test.** Nothing in this document needs a test that `UC1` through `UC37` do not already ask
  for. The hue is one integer in the contract and the existing category tests cover it.
- **Accessibility, if it runs.** The two items under point 2 above, and nothing about contrast, which
  is measured here and inherits the existing guarantee.

## Open questions this blueprint does not close

1. **`PLAN-30` needs a uniqueness answer now rather than later.** With ten members the wheel no longer
   has room for a freely chosen hue that is reliably distinct, as measured above. That is `PLAN-30`'s
   to solve and this document only records that the deadline moved.
2. **The exact reserved height for the `Statut` help line.** Measured at build time against the shipped
   `md` control rather than guessed here.
