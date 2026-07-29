# The category column, with coloured names

`PLAN-32c`. Depends on `PLAN-32a`. Design pass, then shared and frontend.

## Intent

The shipped task row carries its category as a 3 px coloured left border and prints no category
word. The owner saw the seeded week on screen on 2026-07-29 and reversed that: "dont like color
chips. restore category column theres enough space left", then "remove color chip. show colored
category names instead". So the coloured edge goes, the category comes back as its own column
printing the localized category name, and **the name is printed in its category's colour**.

The second half is not optional and it is the reason this feature is not a five-minute edit. The
user asked for colour on every category because the app the user uses today colours everything,
and a plain text column would have satisfied the owner while quietly dropping the user's request.
Colouring the name keeps the user's association between a colour and a kind of work and removes the chip
the owner objected to, so neither decision is overridden. Nobody should later spec an uncoloured
column, and nobody should restore the edge on the user's behalf.

**The real work is contrast, not layout.** A 3 px edge only had to be distinguishable, and the
shipped CSS set itself a 3:1 floor for that. A coloured word has to be readable, so every category
colour now faces the WCAG 2.2 AA text floor against the row background in light and dark, in every
theme, on both card surfaces. The row text is 14 px regular, so the floor is 4.5:1 rather than
3:1. That turns a decorative palette into a load-bearing one and drags three known problems into
this feature: proofreading's pale grey, a fixed lightness tuned for edges, and the collision with
the reserved status hues. All three are work items below, not reasons to reopen the decision.

The reasoning behind the reversal is recorded in
[`overview.md`](overview.md#the-edge-loses-to-a-coloured-name) and the user's original colours are in
[the original category colours](overview.md#the-original-category-colours-implemented-in-plan-32c).
Neither is re-argued here.

## Inputs

No runtime inputs. This is a design pass plus a shared-contract and frontend change, so its inputs
are the decisions it implements and the shipped code it amends.

1. **The reversal itself**, [the edge loses to a coloured name](overview.md#the-edge-loses-to-a-coloured-name),
   decided by the owner on 2026-07-29 against real seeded data rather than a mockup.
2. **The user's own colours and the four problems they already carried**, from
   [the original category colours](overview.md#the-original-category-colours-implemented-in-plan-32c).
   Reproduced below because this is the feature that implements them.
3. **The nine category ids**, shipped in [`nine-task-categories.md`](nine-task-categories.md)
   (`PLAN-32a`). This feature colours those nine and declares no tenth.
4. **The nine FR and EN names, already confirmed and already shipped.** They exist in
   `i18n/locales/fr.json` and `en.json` under `categories.<id>`, confirmed with the user in
   `PLAN-32a`. FR reads Traduction, Révision interne, Révision externe, Relecture, Terminologie,
   Réunions, Pauses, Administration, Mise en page. This feature prints those strings. It does not
   restate them as new copy and it does not change any of them.
5. **`planning.columns.category` already exists** and reads `Catégorie` in FR, `Category` in EN
   (`i18n/locales/fr.json` L212). It ships today rendered `sr-only` in `DayCard.vue` L241, because
   the edge replaced the word. It becomes a visible column header. No new key is needed for it.
6. **The shipped colour contract**, `shared/categories.ts` L33 to L41 (`CATEGORY_HUE_SLOTS`), L47 to
   L51 (`Category`), and L119 to L123 (`categoryEdgeHue`), plus the CSS half in
   `app/assets/css/main.css` L202 to L231 (`--planning-cat-l`, `--planning-cat-c`,
   `.planning-cat-edge`).
7. **The reserved status hues and how they are rendered.** error ~27, warning ~78, success ~148,
   info ~258, drawn by `StatusBadge.vue` L33 to L39 at `text-*-800` in light and `text-*-400` in
   dark, `font-semibold`, 14 px.
8. **The five themes**, `main.css` L241 onward: pastel (`:root`), encre, and three more, each
   redefining the primary and neutral scales for both modes under one id.

## The user's colours, and what this feature has to do with them

From the app the user uses today, given 2026-07-29. The proposed hues are the overview's, not the user's, and
they are a starting point for the design stage rather than a decision.

| Category           | The user's colour  | Proposed hue   | What this feature owes it                     |
| ------------------ | ----------- | -------------- | --------------------------------------------- |
| Translation        | cyan        | 195            | Already the shipped hue, by coincidence       |
| Revision, internal | apple green | 140            | The user gave one green for both members           |
| Revision, external | apple green | needs its own  | A second green, related but distinct          |
| Proofreading       | pale gray   | none, chroma 0 | Passes as text or becomes a documented case   |
| Terminology        | wine red    | 20             | Sits 7 degrees from error 27                  |
| Meetings           | pink        | 340            | Sits 40 degrees from wine red at equal weight |
| Breaks             | navy        | 265            | Sits 7 degrees from info 258                  |
| Administration     | invented    | 305            | The user did not specify one                       |
| DTP                | invented    | 60             | The user did not specify one, and 78 is warning    |

Two decisions of the user's travel with the table and both stand.

**Every category takes a colour, including the five non-trackable ones.** This is what reverses
`AC18` of [`extend-tasks.md`](extend-tasks.md) and retires the `edgeSlot: null` the five
non-trackables carry today. The user's original app coloured everything and they want that.

**Lightness stays fixed for every category.** The user chose the simple rule over literal fidelity, so
navy renders as a medium blue and wine red as a medium red. One number per category survives if it
can, and a category `PLAN-30` has not created yet inherits its contrast for free. The number now
has to sit where text passes rather than where an edge looked even, and light and dark pull it in
opposite directions, so the rule may survive with a different number, or survive with a small set
of documented exceptions. Abandoning it for the whole set is the last resort.

## The contract has to change shape

The shipped contract cannot express what a coloured word needs, and three separate things are
wrong with it rather than one.

- **It returns a hue angle, not a colour.** `categoryEdgeHue` hands out an integer and `main.css`
  assembles `oklch(var(--planning-cat-l) var(--planning-cat-c) var(--planning-cat-hue))`. Text
  needs a resolved colour, and it needs one that differs between light and dark, which a single hue
  cannot carry.
- **Grey is not a hue.** Proofreading's pale grey means chroma zero, and a hue number has no way to
  say that. This was already recorded as a problem in the overview and it lands here.
- **`edgeSlot: null` has to go.** It means "draws nothing", which is a sensible way to render
  neutral with an edge and a meaningless one with text. All nine categories take a colour now, so
  every descriptor resolves to a real colour and the null case disappears from the defaults.

**What the new shape must express**, without this spec designing the palette, which is the design
stage's job.

1. A colour for every one of the nine ids, with no member resolving to nothing.
2. A member that is a neutral rather than a hue, if proofreading's grey survives as grey.
3. A light value and a dark value per category, since the two modes cannot share one.
4. Resolution that keeps every colour value out of every component. A component may hand a
   category id to the mapping and apply what comes back. It may not hold a hue, a lightness, a
   token name, or a class string of its own. Half the contract living in `main.css` as fixed
   lightness and chroma is fine and is how it ships today; a second copy anywhere is not.
5. Totality for an unknown or stale id, which is what `coerceCategory` already gives every reader
   and what keeps a leftover `revision` row from borrowing another category's colour.
6. Extensibility for `PLAN-30`, which lets the user create a category that needs a colour nobody
   designed. The shipped ring exists for that reason and whatever replaces it has to keep the
   property.

**What the rename may and may not touch.** Verified against the repo rather than assumed.

- **`categoryEdgeHue` has exactly one consumer in the whole repo**, `TaskRow.vue` L55. No server
  code and no seed code reads it. So it can be renamed, re-typed, or replaced outright with no
  ripple, and it should be, because a function called `edgeHue` returning a text colour would be
  lying. `edgeSlot` on the `Category` descriptor is in the same position.
- **`isTrackableCategory` must not change shape.** It is read by
  `server/api/tasks/handlers/list.ts` L93 and by `scripts/seed.ts`. It is the single source of the
  trackable flag and this feature adds no second copy of it.
- **`coerceCategory` must not change shape.** It is read by `TaskRow.vue` and it is what makes the
  new mapping total.

## Non-goals

Each of these is a separate feature and each is named so a build stage cannot drift into it.

**Per-category quotas are `PLAN-32b`.** No quota field is added to the `Category` descriptor and
nothing touches `settings.quota_wph` or its 450 default, even though
[the overview records that default as wrong](overview.md#the-original-category-colours-implemented-in-plan-32c).

**The words total is `PLAN-33`.** The row's words pair is visible in the same cells this feature
edits and it is also slated to change, and it is still not this feature's. `AC20` of
`extend-tasks.md` stands until `PLAN-33` reduces it, so the pair ships out of this feature exactly
as it is today. The same goes for whatever `PLAN-33` decides about signalling over or under
estimate.

**The drag grip and the seventh reserved track are untouched.** The 1 rem grip cell
(`TaskRow.vue` L111 to L114) and the empty 3 rem action track exist for `PLAN-15`, `PLAN-17`, and
`PLAN-13`. Their widths and their reasons are not this feature's to revisit, and the category
column is added around them rather than instead of them. The one thing that does change inside the
grip cell is the `sr-only` category span it holds, which is `AC10`.

**No write path.** `PLAN-09` is not built. No Zod schema, no POST, no PATCH.

**No new category and no renamed category.** The nine ids and the nine names are `PLAN-32a`'s and
they are confirmed. This feature colours them.

## The measurement matrix the design stage owes

The floor is WCAG 2.2 AA 1.4.3 at **4.5:1**, because the row's body text is 14 px regular and
nothing about it qualifies as large text. This is the binding rule, and it is a stricter bar than
anything the edge had to clear.

Two of the neighbouring rules do not bind and are named so they are not argued either way later.

- **1.4.1 Use of Color is satisfied by construction.** The category name is printed as a word, so
  the colour is redundant reinforcement rather than the signal. A user who perceives no colour at
  all reads `Révision interne` and loses nothing. This is a genuine improvement on the shipped
  edge, which needed an `sr-only` span to satisfy the same rule. **The accessibility stage should
  not re-litigate it**, and the sentence to check is only whether the name is really printed for
  every row, which is `AC1`.
- **1.4.11 Non-text Contrast does not apply to text.** It is what the shipped 3 px edge was
  measured against at a 3:1 floor. Text is 1.4.3's, at 4.5:1.

**The matrix is nine categories times two modes times two card surfaces times five themes, which
is 180 readings.** Every cell is measured and reported.

- **Nine categories.** All of them, not the four that hold a slot today.
- **Two modes.** Light and dark. `--planning-cat-l` already differs between them (0.55 and 0.74)
  and the direction text pulls is opposite in each, so neither can be inferred from the other.
  **Measured, only light had to move**, from 0.55 to 0.47, and dark stayed at 0.74 with 1.5 of
  headroom over the floor. This paragraph's expectation that both would move was wrong, and it is
  left standing with the correction beside it, because the reason to measure both is that neither
  can be predicted, which the wrong prediction demonstrates.
- **Two card surfaces, which is the trap.** A task row sits inside a work-day card
  (`bg-default` light, `dark:bg-elevated`) or inside an off-day card (`bg-elevated` light,
  `dark:bg-default`), per `DayCard.vue` L54 to L63. The muted off-day surface is where recorded
  weekend work is read, and both the shipped `StatusBadge` comment (L27 to L32) and the
  `--planning-cat-l` comment (`main.css` L211 to L216) record it failing first, with the work-day
  card passing while the off-day card did not.
  - **Correction worth stating once, because no shipped comment records it. The harder surface
    inverts between modes.** Both of those comments only ever measured the light half. In light,
    `bg-elevated` resolves to `neutral-100` and the off-day card is the harder one, which is what
    they say. In dark, `bg-elevated` is `neutral-800` while `bg-default` is `neutral-900`, so the
    **work-day** card is the lighter surface and therefore the harder one for a light word. Anyone
    inheriting "the off-day card is always the harder surface" from those comments inherits half a
    rule. Measuring one card per mode is the mistake that has already been made twice on this row,
    and picking the wrong card per mode is the way to make it a third time.
- **Five themes.** Each redefines the neutral scale that both card surfaces derive from, so the
  background moves per theme while the category colour does not.

**Measured, not estimated.** The design blueprint reports actual ratios, the way the shipped
`StatusBadge` and `--planning-cat-l` comments do, naming the worst cell per category rather than a
single reassuring average. A category that clears 4.51:1 at its worst passes; a category whose
report says "should be fine" has not been measured.

## Outputs and acceptance criteria

### AC1. The category column is back, and no row draws a coloured edge

Every task row prints its category as the localized name from `categories.<id>`, in a column of its
own, under a visible `Catégorie` header. All nine categories print, trackable and non-trackable
alike.

The edge goes completely rather than being softened. `TaskRow.vue` loses the `border-l-[3px]`
category treatment and the `--planning-cat-hue` inline style (L104 to L107), `main.css` loses
`.planning-cat-edge` (L229 to L231), and the transparent 3 px borders that exist only to align the
`DayCard.vue` header and column-header rows with the row edge (L89, L237) go with it, since they
have nothing left to align to. Verifiable by grepping for `planning-cat-edge` and
`--planning-cat-hue` and finding nothing.

The column position and width are the design stage's, inside two constraints. The grip's 1 rem
track and the reserved 3 rem action track are unchanged (non-goals), and the owner's premise that
there is visible room left has to be confirmed on screen rather than assumed. `index.vue` L190
caps the planning container at `max-w-5xl`, and widening it is available but is a change to record
rather than a silent one.

### AC2. Each name is coloured from the one shared mapping, and no component holds a colour value

The category-to-colour mapping lives once, in `shared/categories.ts` plus the fixed values in
`main.css` that already back it. `TaskRow.vue` hands a coerced category id to the contract and
applies what comes back. It holds no hue, no lightness, no token name, and no per-category class
string. The same applies to `PLAN-11`'s category selector and `PLAN-30`'s category form when they
arrive, which is why the mapping is shared rather than local, and it is the project's rule against
one rule living on two sides.

Verifiable by grepping the `app/` tree for a colour value or a category id paired with one and
finding none, and by asserting in the unit suite that every one of the nine ids resolves through the
contract to a colour.

### AC3. Every name meets 4.5:1 against its row background, in both modes, measured

The full 180-cell matrix above is measured and the results are in the design blueprint. Every cell
is at or above 4.5:1, or is a documented exception under `AC4`. The blueprint names the worst cell
for each of the nine categories with its actual ratio, the theme it occurs in, and the surface, so
a later reader can re-check one number instead of re-measuring the set.

The values that move are `--planning-cat-l` and `--planning-cat-c` in `main.css` L217 to L227,
which were tuned for a 3:1 edge floor and cannot be assumed to hold at 4.5:1. If one number per mode
still carries the whole set, it stays one number per mode and the contract is unchanged in shape. If
it cannot, the exceptions are per category and are listed with their reasons, not spread silently
across the palette.

**Settled, and the shape held.** One lightness and one chroma per mode carries all nine with zero
per-category exceptions, at `0.47 0.11` in light and `0.74 0.13` in dark, worst cell 5.07:1
(`translation` on an automne off-day card in light). **Only light moved.** This criterion predicted
that dark would have to go lighter than 0.74 and that is wrong: dark was already clearing 6.08:1 at
its worst, so it stayed, and its chroma dropped to 0.13 only to keep navy inside sRGB. See
[Decision 1 and Decision 2 of the blueprint](category-column-coloured-names-design.md).

### AC4. Proofreading's pale grey either passes as text or is documented as the exception it became

Grey text on a near-white row is the classic contrast failure and "pale" was chosen when it only had
to tint a 3 px edge. It cannot ship as given. One of two outcomes, chosen deliberately and written
down.

- **It darkens until it passes and stops being pale.** Honest, and it keeps the fixed-lightness rule
  intact by treating grey as a chroma-zero member at the same lightness as everything else.
- **It becomes a documented exception**, with the reason stated in the contract comment and in the
  blueprint, so nobody later "fixes" it back to pale or reads the exception as an oversight.

There is a second problem with grey that contrast alone does not catch, and the decision has to
account for it. **A grey that passes 4.5:1 is a dark grey, and a dark grey reads as ordinary body
text rather than as a colour.** The other eight categories say "this is a kind of work" through hue;
proofreading would say nothing, and it would sit in the same column as eight coloured words looking
like the one row whose colour failed to load. It may also collide with `text-muted` and
`text-highlighted`, which are the tones the rest of the row already uses. So passing contrast is
necessary and is not sufficient, and if grey cannot both pass and read as a deliberate choice, then
departing from the user's literal colour for this one category is the better answer and is the kind of
thing to put to the user's rather than decide silently.

**Resolved, and neither of the two outcomes above is what shipped. The colour became the exception
rather than the contrast.** `Relecture` prints at hue 230, a slate blue, and the user's pale grey does not
ship. **This is an override of a colour the user gave**, approved by the owner, who will tell
the user's it changed and why. It stays the user's to overrule.

The reason is measured, and it sits here rather than behind a pointer because anyone finding the
substitution has to find the reason with it. A grey dark enough to clear 4.5:1 lands at `L 0.47`, and
all five themes put their light `text-muted` in the `L 0.47` to `L 0.53` band, so a chroma-zero
category name would sit inside the tone the row already uses for its own dimmed text. That is the
second problem above, confirmed by measurement rather than avoided. The obvious middle route, a very
low chroma slate that keeps the intent of "pale", is worse rather than better: encre's `neutral-500`
is itself a blue-grey at `L 0.52 C 0.046 H 259`, so a slate at the same lightness and chroma near the
same hue reproduces in one theme exactly the failure it was meant to avoid. Hue 230 is the centre of
the widest empty arc in the user's own palette, so the substitution costs the least separation from every
colour the user did name, and at the shared `C 0.11` it resolves to more than twice any theme neutral's
chroma, so it cannot be read as a neutral anywhere.

Two consequences that outlive the colour choice. **The contract keeps its simple shape**, because with
no chroma-zero member a hue per category is still sufficient, which is one of the two reasons this
spec gave for changing the contract at all and is now void. And **`PLAN-30` inherits no requirement to
support chroma zero**, which it must not be given later, since a hue per category is what lets a
user-created category inherit its contrast from one number. The full argument is in
[Decision 3 of the blueprint](category-column-coloured-names-design.md).

### AC5. The two revision greens read as related but distinct

`revision_internal` and `revision_external` are the same work on different people's text and they
carry different quotas, so they have to read as siblings rather than as two unrelated categories.
The user gave one apple green for both.

This is the hardest hue problem in the set and it is genuinely over-constrained. Apple green near
140 with a sibling inside about 30 degrees is hard to separate at identical lightness, and moving
the sibling further lands it on cyan 195 (translation) in one direction or on success 148 in the
other. The likely answer is that the pair is the honest case for a lightness or chroma exception, so
the shared rule holds for the set and this one pair opts out with a reason. It must be designed and
measured rather than assumed, because both members then have to clear `AC3` independently.

Verifiable by the blueprint stating the two resolved colours, their measured separation, and the
reason the pair reads as related.

### AC6. No category name is mistakable for a status word

**This is the criterion the reversal made hardest, and the old defence is gone.** A category used to
be a 3 px edge and a status a word, so shape told them apart and the shipped contract comment says
so in as many words (`shared/categories.ts` L37 to L40). Both are coloured words now and that
argument no longer exists.

The collisions are close and they are the user's, not invented. Wine red 20 against error 27. Apple green
near 140 against success 148. Navy 265 against info 258. Any warm slot for administration or DTP
near warning 78. Four reserved roles and nine categories do not fit in one circle with that much
clearance, so hue separation alone will not solve it.

**The solution may be typographic or positional rather than chromatic**, and the design stage should
weigh all three rather than only reaching for hue.

- **Positional.** The status column is the row's last cell. Putting the category at the other end,
  where the edge was, is the cheapest separation available and it costs nothing.
- **Typographic.** `StatusBadge` differentiates itself by weight already, `font-semibold` against
  the row's regular text (`StatusBadge.vue` L33 to L37). A category name at regular weight, or at a
  different size, or with different tracking, is separated by more than hue.
- **Chromatic.** Real but limited, and it is the one that runs out of room first.

Note what is and is not at risk. The status vocabulary is a closed set of four strings
(`Accepté`, `En cours`, `Terminé`, `En retard`) plus the em dash, and none of the nine category
names resembles any of them as a word. The risk is that a coloured category reads as _the same kind
of signal_ as a status, so the eye treats terminology's wine red as an error and proofreading's
neighbour as a state. That is what has to be designed out.

Verifiable by the blueprint recording which of the three mechanisms was used, and by an
accessibility read of one seeded card holding both a red category and a red status in the same row.

### AC7. The non-trackable rows stop printing their category as the task name

`TaskRow.vue` L94 is `task.client || task.project || categoryLabel.value`, so a row with no client
and no project takes the localized category name as its visible primary name. That is every
non-trackable row, and the seeded week prints `Réunions`, `Pauses`, and `Administration` in the
TASK column today. With a category column beside it the row says the same word twice.

**This is a real design question and not a mechanical edit**, so the design stage chooses and
justifies. Two constraints come from the shipped code and both hold.

- **No task can render nameless.** The comment at `TaskRow.vue` L91 to L94 records that rule and the
  owner accepting that two meetings on one day look identical. A blank primary name is not an
  option, because the name is the row's `1fr` column and the thing the eye lands on first.
- **The row's em dash pattern already distinguishes "not set" from "not applicable"**, with keys for
  both. `planning.notSet` reads `Non précisé` in FR and `planning.notApplicable` reads `Sans objet`,
  and both are already used behind an `aria-hidden` em dash on this row (L151, L164). Whatever is
  chosen, a screen reader must not hear a bare dash under a header that says `Tâche`.

Options to weigh rather than a decision to inherit. The name falls back to the em dash with
`notApplicable` behind it, on the reading that a break genuinely has no name, which matches how the
same row already treats its words and its status. Or the category column carries the row on its own
and the name track collapses for those rows, which conflicts with the fixed-track lesson the grid
comment records. Or the name keeps a distinct fallback that is not the category word. Or the
category name stays as the fallback and the duplication is accepted as harmless, which is the option
that has to be argued rather than defaulted into, since removing the duplication is why this
criterion exists.

Whichever is chosen, the reason goes in the component comment, replacing the current one, and the
`showProject` and marker behaviour on those rows is unchanged.

### AC8. All copy is i18n, and the FR strings are the confirmed ones

No visible string is hardcoded. The nine names come from the existing `categories.<id>` keys and are
printed exactly as `PLAN-32a` confirmed them, with no synonym substituted, `Relecture` not
"corrected" to `Correction d'épreuves`, and `DTP` not translated to match `Mise en page`. The column
header comes from the existing `planning.columns.category`.

The French rule that `? ! : ;` take a space before them is **checked and not triggered** by any of
the nine names or by `Catégorie`. It is recorded as checked rather than illustrated with an invented
case. It does apply to any new string this feature adds, and `AC9` is the one place a new string
might appear.

No colour value goes into a locale file, because a colour is not copy.

### AC9. The delivery column separates the date from the time

**New, added by the owner looking at the same screen.** The delivery cell renders the date and the
time with nothing between them, printing `29 Jul. 202612:00` and `28 Jul. 202611:00`, so the year
runs into the hour and reads as one mangled number.

**Where the space is actually lost, verified rather than assumed.** `TaskRow.vue` L148 is
`<span v-if="task.deliveryTime" class="text-muted"> {{ task.deliveryTime }}</span>`, and the leading
space really is in the source. It is removed at compile time by Vue's template whitespace handling:
`condenseWhitespace` in `node_modules/@vue/compiler-core/dist/compiler-core.cjs.js` L2896 to L2904
drops a whitespace-only text node when it has no previous sibling (`!prev`), and that branch runs
regardless of the `whitespace` option. The space is the first child of that span, so it is dropped.

The asymmetry on the same row confirms the mechanism rather than leaving it a theory. L126,
`<span aria-hidden="true">·</span> {{ task.project }}`, keeps its space, because there the
whitespace node has a sibling on each side and is condensed to a single space instead of removed.
Line 173's `" / "` survives for a different reason again, that it is not whitespace-only. So the fix
is to put the separator somewhere the compiler cannot strip it, not to add more whitespace to the
same place.

**Confirm the separator is right rather than merely non-empty.** A plain space is likely enough. If
the design stage wants the date and the time visually distinguished beyond the tone contrast they
already carry, that is its call to make and to record. No comma, bullet, or middle dot is invented
without a stated reason, and the existing comment at L57 to L61 argues against a separator glyph on
the grounds that the deadline should read as one fact, so overriding that argument means replacing
it rather than ignoring it.

**Check French as well as English.** The two locales fail differently and only one of them is in the
owner's screenshot. EN month abbreviations are `Jul.`, so with a year the failure is digit against
digit, `202612:00`. FR abbreviations are `juill.`, `janv.`, `févr.` (`i18n/locales/fr.json` L248),
so without a year the FR failure is a period against a digit, `29 juill.12:00`, which is a
different visual problem and reads almost like a decimal. With a cross-year delivery FR fails the
same digit-against-digit way EN does, `4 janv. 202712:00`. Both need checking, and the year is only
appended when the delivery falls in a different calendar year than the task
(`shared/planning.ts` L242 to L243), so both cases exist in the same week.

**This needs an assertion, because a missing separator is exactly the kind of thing that silently
comes back.** `formatDeliveryDate` does not join the time today, so nothing pure covers the join and
the existing node-environment suite cannot see it. Two routes, and the choice is design's and the
unit-test stage's together.

- **Move the join into a pure shared function** beside `formatDeliveryDate` in `shared/planning.ts`,
  taking the delivery date, the task date, the time, and the localized months, and returning the
  composed deadline. It is then covered by the existing suite at no infrastructure cost, and it is
  where the project's rules would put it anyway. The cost is that a single returned string loses the
  two-tone rendering the row uses today, so if design wants the tone contrast kept, the function has
  to return the parts and the separator rather than one string.
- **Add component render testing.** `vitest.config.ts` is a node environment with no DOM and no
  `@nuxt/test-utils`, so this is new infrastructure for the project rather than a new test file. It
  is the only route that can assert what the template actually renders. Weigh the cost honestly
  rather than assuming it.

Either way the assertion fails if the separator disappears, in FR and in EN, with and without a
year, and with a delivery that carries no time at all.

The clock format itself is out of scope. `deliveryTime` is stored as `HH:MM` and printed as stored,
and the French space-before rule governs `? ! : ;` as punctuation rather than a numeric time
separator, so nothing inserts a space before the colon in `12:00`. Whether Québécois French should
render a time as `12 h 00` is a real localization question and it is not this feature's.

### AC10. The `sr-only` category name goes, and the column header prints

Two pieces of markup exist only because the category was a colour and no word, and both become wrong
the moment the name prints.

- **`TaskRow.vue` L112**, the `sr-only` span holding `categoryLabel` inside the grip cell. With the
  name printed in its own column this is a second copy, so the cell would announce the category
  twice. It goes, and the comment at L47 to L54 explaining why it existed goes with it.
- **`DayCard.vue` L240 to L242**, the category `columnheader` wrapping an `sr-only` span. It becomes
  a visible header printing `Catégorie` like the other five. The comment at L226 to L235 explaining
  that this one header does not print is rewritten, and the note about `sr-only` grid items being out
  of flow and sliding the labels one column left is preserved as the reason the header is an in-flow
  item, since that lesson still applies.

### AC11. The two grid definitions stay identical, and the card still does not scroll the page

`TaskRow.vue` L104 and the `DayCard.vue` column-header row L237 carry the same seven-track
`grid-cols-[…]` string in two places, and they have to keep agreeing or the labels stop sitting
above the values they label. Both change together in this feature, and the tracks must be fixed
rather than `auto`, which is the lesson the row comment at L16 to L21 already records: each row is
its own grid, so an `auto` track sizes to that row's own content and the columns drift down the
card.

`DayCard.vue` L220 floors the scroller at `min-w-[52rem]`. An extra text column raises the row's
real minimum, so that number is re-derived rather than left as it is. The card keeps scrolling
inside its own container and the page body never scrolls sideways, which is `AC25` of
`extend-tasks.md` and WCAG 1.4.10, and the reflow reasoning in the `DayCard.vue` header comment
(L76 to L86) is re-checked against the new track count rather than assumed to still hold.

### AC12. The colour budget does not grow

`AC26` of `extend-tasks.md` caps the coloured elements per row at what ships today, and this feature
satisfies it as a straight swap: the row loses the category edge and gains the coloured category
name. Colour still appears only on the status, the category, and the capacity meter. The task name,
the deadline, the words, the duration, and both conditional markers carry none, and nothing in this
feature adds a pill, a chip, a dot, or a badge.

### AC13. Nothing outside the colour contract and the row changes

Verifiable by reading the diff. `isTrackableCategory` is untouched and so is every caller of it. No
quota field appears on `Category`. `settings.quota_wph` and its 450 default are untouched. The words
pair renders exactly as it does today. No migration is added, since no stored value changes.
`server/db/schema.ts`, `server/api/`, `server/models/`, and `scripts/seed.ts` are all untouched. Any
of those in the diff is scope drift and a defect against this spec.

## What the existing test file must be expected to change

`test/shared/categories.test.ts` asserts the current edge contract hard, so it fails loudly on this
change. **Those assertions describe a contract this feature replaces, so the failures are expected
and every one moves deliberately.** A later agent finding them red should read this section rather
than conclude something broke.

- **`CATEGORY_HUE_SLOTS` equals `[195, 300, 115, 345, 240, 170, 275, 320]`** (L323). The ring is what
  the new shape replaces, so this assertion either changes to the new structure or goes with it.
- **`edgeSlot !== null` exactly matches `trackable`** (L358), and its restatement through the public
  function at L427 to L428. **This is the assertion that encodes `AC18` and it inverts.** All nine
  categories take a colour now, so the correct assertion is that every one of the nine resolves to a
  colour and none resolves to nothing.
- **"gives an edge slot to the four trackable ids and none to the five others"** (L364 to L366). Same
  inversion, and the same `AC18` reasoning in the comment above it.
- **`EDGE_HUE_TABLE`** (L307) and the `categoryEdgeHue` describe block (L399 onward). These hold the
  `PLAN-32a` placeholder hues and the file already says in a comment that `PLAN-32c` replaces all of
  them. The table becomes the nine designed colours, and the comment saying they are placeholders
  goes because it stops being true.
- **The ring-shape assertions**, that the ring carries more slots than the defaults consume (L330 to
  L331), that its slots are unique (L337), and that each is a valid hue angle (L342). They follow
  whatever replaces the ring. If a chroma-zero member ships under `AC4`, "every slot is a hue angle"
  is no longer true of the whole set and the assertion has to say so rather than be deleted quietly.
- **`categoryEdgeHue` returning null for an unknown id** (L435 to L448). The fallback behaviour still
  matters and still has to be total, but "null" stops being the right answer once every default has a
  colour. An unknown id resolves to `admin`'s colour, per `coerceCategory`, and the assertion should
  say that.

Added coverage, not just moved coverage. Every one of the nine ids resolves through the contract to a
colour, no two categories resolve to the same colour, the mapping is total for `''`, `null`,
`undefined`, a number, an object, and a stale `'revision'`, and the delivery separator assertion from
`AC9`. The `trackable` and `coerceCategory` blocks are untouched, since neither contract moves.

## Edge cases

- **A stored `revision` row, or any stale id.** It coerces to `admin` before the colour is resolved,
  so it prints `Administration` in administration's colour. Safe rather than correct, exactly as
  `PLAN-32a` `AC4` describes, and it can never borrow a colour that is not a real category's.
- **A `PLAN-30` category that does not exist yet.** It has no descriptor, so it coerces to `admin`
  and prints in `admin`'s colour. That is wrong-looking rather than broken, and it is why `AC2`
  requires the mapping to be extensible rather than a nine-entry table. `PLAN-30` owns the real
  answer.
- **The contract lands and the CSS does not, or the reverse.** The colour is assembled from both
  halves, so a half-applied change gives every category the same colour, or no colour, or an
  unreadable one. Nothing is stored and nothing is stranded, since the failure is entirely in the
  read, and recovery is completing the change. It is a reason to land both halves together rather
  than a state to design around.
- **A category name longer than its track.** FR `Révision interne` and `Révision externe` are the
  longest at sixteen characters and EN `Internal revision` at seventeen, so the two locales do not
  agree on the longest string and the track is sized for the longer of them. A truncated category
  name is worse than a truncated task name, because the two revision members differ only in their
  last word and truncation would make them identical. Either the track fits both locales' longest
  name or truncation is ruled out for this column.
- **An off-day card holding recorded weekend work.** This is the surface that has already failed
  twice on this row and it is the one a work-day-only measurement misses. It is in the matrix for
  that reason.
- **A red category beside a red status in one row.** Terminology's wine red next to `En retard`'s
  error red is the worst case for `AC6` and it exists in the seeded data, so it is a thing to look at
  on screen rather than only in a table of ratios.
- **A row whose category colour is the only thing distinguishing it from its neighbour.** Two
  meetings on one day already look identical and the owner accepted that. Adding a category column
  does not change it, and `AC7`'s choice must not make it worse by removing the only word those rows
  carry.
- **A user who perceives no colour at all.** The name is printed, so the row is fully readable. This
  is the improvement the reversal buys and it is worth stating as an outcome rather than only as a
  compliance note.
- **A forced-colors or high-contrast environment.** The category colour is a text colour, so it is
  overridden by the user's own palette and every category then reads in one colour. The names still
  print and nothing is lost, so this degrades correctly with no extra work. Worth a look during the
  accessibility read rather than a criterion.

## Open questions handed to the design stage, all seven closed

None blocked the build. Each was a decision this spec deliberately did not make, and each is answered
in [`category-column-coloured-names-design.md`](category-column-coloured-names-design.md). The
answers are recorded here so the spec stops reading as though the questions are live.

1. **The nine colours themselves.** Closed. The user's hues ship verbatim wherever they named one, with
   `revision_external` 115, `admin` 305, `dtp` 60, and `proofreading` 230 filling the four the user did
   not. Worst measured cell in the set is 5.07:1. Blueprint decision 1.
2. **Whether the fixed-lightness rule survives at 4.5:1, whole or with exceptions.** Closed. Whole,
   with **zero exceptions**, at `0.47 0.11` in light and `0.74 0.13` in dark, and in a stronger form
   than it had, since every hue from 0 to 359 clears the floor at those values. Blueprint decision 2.
3. **Whether proofreading stays grey.** Closed, and it does not. `Relecture` is slate blue at hue 230.
   This is the one answer that overrides a colour the user gave, it is approved by the owner,
   they will be told it changed and why, and it stays theirs to overrule. The measured reason is in `AC4`
   above and in blueprint decision 3.
4. **How the status collision is solved.** Closed, then amended. Position first and weight second,
   category at track 2 in `font-normal` and status at track 7 in `font-semibold`. Blueprint
   decision 4, and its amendment.

   This summary said chromatic separation was measured as unavailable and explicitly not relied on.
   **That is no longer the whole answer.** The accessibility stage measured on rendered pixels that
   `success` green sat closer to `revision_internal` (Oklab 0.0336) than the two revision siblings
   sat to each other (0.0461), inverting the relationship the palette exists to carry, and collapsing
   to 0.0201 under simulated protanopia. So `success` moved to emerald, giving a worst case of 0.0604
   normal and 0.0548 protan.

   The distinction that matters, and the reason this is an addition rather than a reversal: **the
   category hues are the user's and ship verbatim, while `success` is a reserved role and is
   ours to move.** Chromatic separation was never available _on the user's side_, and that part still holds.
   Position and weight remain the primary defences, because the two mechanisms fail differently.
   Position survives a palette change and does nothing for a viewer who cannot separate the hues at
   all, and the hue shift survives a layout change and does nothing if the two cells end up adjacent.

5. **What a non-trackable row shows in the task column.** Closed. The em dash with `planning.notSet`
   behind it, no new key, and `notSet` rather than `notApplicable` because a name is a fact nobody
   entered rather than one that cannot exist. Blueprint decision 5.
6. **The column's position and width.** Closed. Track 2 right after the grip, `9rem`, and
   `min-w-[52rem]` becomes `min-w-[62rem]`. The container does not have to widen, because the `xl`
   step already does it, and the owner's premise is confirmed with numbers. The honest cost recorded
   is up to 32 px of card scroll between 1024 px and 1047 px. Blueprint decision 6.
7. **Whether the delivery date and time get anything beyond a plain space.** Closed. A plain space and
   no glyph, and the join moves into a pure `formatDeadline` in `shared/planning.ts` returning the two
   parts, so the two-tone rendering survives and the space is assertable in the existing
   node-environment suite. Component render testing is not taken on. Blueprint decision 7.

## Stages

Specs and code review are never skipped.

- **Design runs and leads.** The palette, the measurement matrix, the status-collision mechanism, the
  column position and width, the `AC7` decision, and the delivery separator. Nothing else can start
  until the colours exist, and the blueprint carries measured ratios rather than estimates.
- **Backend runs, narrowly.** `shared/categories.ts` only, for the new colour contract. There is no
  server route change, no schema change, and no seed change, and `isTrackableCategory` must come out
  of it byte-identical.
- **Frontend runs.** `TaskRow.vue`, `DayCard.vue`, and `app/assets/css/main.css`.
- **Unit-test runs.** The rewrite described under "What the existing test file must be expected to
  change", plus the `AC9` assertion.
- **Accessibility runs**, and its job is narrow and named. Confirm the measured ratios against the
  built page rather than against the blueprint, read one seeded card holding both a coloured category
  and a coloured status, confirm the row announces its category once rather than twice after `AC10`,
  and confirm the `AC7` fallback does not leave a cell announcing as empty under `Tâche`. **WCAG
  1.4.1 is satisfied by construction and is not to be re-litigated**, since the name is printed and
  the colour is redundant reinforcement.
- **Compliance is skipped.** No personal data, no authentication change, no payments, and no email. A
  category colour changes nothing about what is collected or who can reach it.
- **SEO is skipped.** No new page and no new route, and the planning dashboard is behind sign-in and
  already `noindex, nofollow`.

## Amendments to shipped specs

- [`extend-tasks.md`](extend-tasks.md). **`AC18` is reversed.** A non-trackable row's category no
  longer reads as neutral; all nine categories print a coloured name, per
  [the original category colours](overview.md#the-original-category-colours-implemented-in-plan-32c)
  and [the edge loses to a coloured name](overview.md#the-edge-loses-to-a-coloured-name). Its
  reasoning, that a non-trackable row already prints its category as its own name, is retired twice
  over: by the user's decision to colour everything, and by `AC7` here removing that very fallback.
  - **The "Category becomes colour" section's carrier is replaced.** The row edge is out and a
    coloured word is in. That section's other claims stand, including that the mapping lives in one
    shared contract and that `PLAN-30` inherits the problem of colouring a category nobody designed.
  - **`AC16`'s third bullet is satisfied differently.** Colour is still never the only carrier, but
    the carrier is now the printed name rather than an `sr-only` span, so the span goes (`AC10`).
    Its first two bullets, one status carrier and the em dash for a non-trackable status, are
    untouched.
  - **`AC14`'s at-rest set changes**, which that criterion says is a spec change rather than a design
    change. This is that spec change. The category moves from a field carried by colour to a printed
    field, so the row prints six data fields instead of five. Nothing is added and nothing is
    removed.
  - **`AC26` still holds**, per `AC12` here. The swap is one coloured element for one.
  - **`D8` is superseded.** Its treatment constraint, a row edge and a distinct hue per trackable
    category only, is what this feature reverses. Its palette constraints survive and get stricter:
    legible in both modes, no raw hex in a component, and extensible for `PLAN-30`.
  - **The i18n table line for `planning.columns.category`** reading "No. Accessible name only." is
    superseded. It prints.
  - **The "What was cut from at rest" bullet for the category as a printed word** is superseded. It
    is back.
  - **`AC28`'s `formatDeliveryDate` is unchanged in shape.** `AC9` here may add a sibling that
    composes the date and the time, and it does not change the existing helper's contract.
- [`overview.md`](overview.md). The `PLAN-32c` bullet's `AC1` to `AC7` are carried here in the same
  order and expanded, and `AC8` (copy) and `AC9` (the delivery separator) are added. The delivery
  separator is not recorded in the overview at all and should be, since it came from the same
  screen-reading session as the reversal.
- [`nine-task-categories.md`](nine-task-categories.md). Its `AC7` placeholder `edgeSlot` values, its
  note in `AC9` that the hue table holds placeholders `PLAN-32c` replaces, and its `AC8` comment
  rewrite saying `PLAN-32c` is expected to give every category an edge are all discharged here,
  except that what every category gets is a coloured name rather than an edge. Its open question 2,
  which hands this feature the chroma-zero problem and the crowded ring, is answered by `AC4` and
  `AC6`.
- [`task-categories.md`](task-categories.md) (`PLAN-02`). Untouched by this feature beyond what
  `PLAN-32a` already superseded.
