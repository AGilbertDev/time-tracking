# Progressive disclosure for the planning week

The read-only planning week has shipped. It runs on `PLAN-04` (the list endpoint), `PLAN-06`
(the compact row), `PLAN-07` (the week stack), `PLAN-03` plus `PLAN-05` (the capacity meter),
`PLAN-08` (the week switcher), and the styling pass in
[`alleger-la-semaine.md`](alleger-la-semaine.md). It shows every day open, every row flat, and
several facts the primary user reads every day are missing from both.

This feature gives the week two layers of progressive disclosure and brings the missing data
across. Day cards start collapsed except today and open on demand. Inside an open day, the task
row shows a small at-rest set and every other field is handed to `PLAN-11`, which builds the
click-to-edit form.

It delivers an extension of **`PLAN-06`**, an extension of **`PLAN-07`**, and a second small
slice of **`PLAN-01`**. It changes the shape `PLAN-04` returns. It stays read-only.

**This spec owns the information contract and the behaviour. The design stage owns the layout.**
Which fields exist at rest, which move to the editor, why each one earns its place, how the two
disclosures behave, the schema, the read shape, the accessibility requirements, and the copy are
settled here. How any of it is arranged on screen is not. The visual requirements are gathered
into one "Constraints for the design stage" section, written as constraints with reasons rather
than as a finished layout.

`PLAN-06` in [`overview.md`](overview.md) says its field set is "finalized on the mockup". That
field set is superseded here, and the `PLAN-06` bullet in `overview.md` should point at this
document once this lands.

## Problem

The original app the user is still working in every day is a spreadsheet. She calls it a
nightmare, and `overview.md` records that judgement as the reason the redesign went the other
way. But it did one thing right, and she has now named it: **a row showed only the most
important columns at first glance and expanded on edit.** Everything else lived behind that
expansion.

Our shipped week went calm but flat. Everything is open all the time, so there is no cheap way
to see the shape of a week, and there is nowhere to put a fact that matters sometimes. Data she
needs got dropped rather than deferred.

What is actually wrong today:

- **Every day is open all the time.** Seven full day cards with all their rows is a long scroll
  to answer a question as simple as "how is Thursday looking".
- The delivery date is stored and never rendered anywhere. It reaches her only indirectly,
  through the `En retard` badge the list endpoint derives from it. She cannot see when anything
  is due.
- The project word total is stored and never rendered, so she cannot see how much of a project
  is left.
- There is no way to mark a task as excluded from the quota. The original has that toggle and
  she relies on it.
- The `instructions` column exists, holds nothing real, and is load-bearing for a naming
  fallback it was never meant to serve.

The row also still carries a mobile grid alongside its desktop grid
([`TaskRow.vue:63`](../../../app/components/planning/TaskRow.vue)) and the day header a matching
stacked-below-`md` layout ([`DayCard.vue:43`](../../../app/components/planning/DayCard.vue)).
The user has confirmed the app needs no mobile version, so that is dead code.

This feature extends the simplifying pass rather than reversing it. Its rule that the interface
shows only what is functional now has a second half: what is not functional at a glance is not
deleted, it is one click away.

## Layer one, the day card

The week becomes a short stack of day headers. Every day starts collapsed except today, and the
user opens the day she cares about.

### What a collapsed day shows

Everything the day header shows today, plus a task count. Nothing is taken away.

- The day name, the `aujourd'hui` pill on today, and the `Congé` label on an off day.
- **The capacity bar and its reading, unchanged.** This is the decision that makes collapsing
  safe. The bar does the job of warning about hidden tasks, so a collapsed day still reports how
  full it is and an overbooked day is still red before it is opened. The meter must not be
  weakened anywhere in this feature.
- **The task count.** It appears only when the day is collapsed and disappears when it opens,
  because the rows are visible then and counting them again is noise.

An off day carries no capacity meter (the simplifying pass, AC3), so on a collapsed off day holding recorded
weekend work the count is the **only** signal that work is there. That is the strongest single
reason the count exists.

### Defaults and reset

- Today starts open. Every other day starts collapsed.
- Any number of days can be open at once. The toggles are independent, so opening Thursday does
  not close today.
- Switching weeks resets to that default. No expansion state is remembered across navigation.
- A week that does not contain today opens nothing, so paging forward or back gives a seven-line
  overview of that week with its capacity bars. That is a feature, not a gap.

### Days with nothing to disclose

- **A work day with no tasks** gets no control and no count. There is nothing to disclose, and a
  control that opens onto an empty body is a promise the card cannot keep. It keeps the header
  and meter it has today, and since a collapsed card is header-only anyway, an empty work day is
  already the same height as its collapsed neighbours.
- **An off day with no tasks** stays the slim compact strip the simplifying pass settled, with no
  control and no count.
- **An off day that holds recorded work** does get the control and the count, and it starts
  collapsed like any other non-today day. Collapsing it does not hide the work, it defers it, and
  the simplifying pass, AC3, which requires recorded weekend work to stay visible, is met by the
  count plus one click. Nothing is hidden that the user cannot see is there.
- **If today itself has no tasks**, there is nothing to open, so the today-starts-open rule
  simply does not apply that day.

### Where the open state lives

In the component. This is the narrow presentation exception the project's "logic belongs to the
backend" rule carves out by name, since whether a panel is open has no meaning off the screen.
It is not a setting, it is not persisted, it is not in the URL, and it never reaches the server.
A later reviewer should read this paragraph rather than flag it.

Each `DayCard` owns one boolean initialised from its own props. The reset on week switch needs
no code, because `Week.vue` already keys its `v-for` on `day.date`, so paging to another week
gives every card a new key, a fresh component, and the default state for free.

The task count needs no new endpoint field. The page already hands each card its own
`tasks: PlanningTask[]` array, so the count is that array's length. It is not a derived business
value, it is the length of a list already on the screen, and deriving it anywhere else would
create a number that could disagree with the rows below it.

## Layer two, the at-rest task row

The row is seen only inside a day the user deliberately opened. That relaxes the pressure to
strip it, so the set below was re-derived with the collapse in place rather than inherited from
an earlier draft. It came out the same. The one thing that changed is that the argument for a
single duration field got stronger, which is recorded below.

A translator reading an open day is answering five questions. Who is this for, when is it due,
how big is it, how long does it take, and where does it stand. Every field has to earn its place
against one of those five, or against a structural job the row cannot do without.

**The at-rest row stays strictly read-only in this feature. Nothing in it becomes clickable.
Only the day header is interactive.**

### The at-rest set

Five labelled data fields, one field carried by colour, two conditional markers, and two
structural affordances.

| At-rest field                                                          | Why it earns its place                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client and project number**                                          | Who the work is for. Without it a row is unidentifiable. They read as one identity, so they are one field, not two.                                                                                                               |
| **Livraison, date and time**                                           | When it is due. The most-missed fact today, and the only thing that makes a week plannable. Date and time are one deadline, so they are one field.                                                                                |
| **Mots, done over the project total**                                  | How big it is and how much is left. One progress pair, which is what the original app's single total could never answer.                                                                                                          |
| **Durée, the effective duration**                                      | How long it takes, and it is the number that sums to the capacity bar printed above it.                                                                                                                                           |
| **Statut**                                                             | Where it stands.                                                                                                                                                                                                                  |
| **Catégorie, carried by colour on the row edge rather than by a word** | Traduction and Révision are different work at different speeds, so which one a row is changes how its numbers read. The owner's call is that a colour answers this faster than a word and costs no width. See the decision below. |
| **Exclusion marker** (only on an excluded trackable task)              | Without it the day's visible words cannot be reconciled with the quota, and a number you cannot explain is worse than a number you cannot see.                                                                                    |
| **Split continuation marker** (only on a later slice)                  | Tells her this row is one slice of a multi-day task, so its partial word count reads as intended rather than as a shortfall.                                                                                                      |
| **Drag affordance** (structural)                                       | The only signal that rows reorder. `PLAN-15` needs the slot in place.                                                                                                                                                             |
| **Row action slot** (structural)                                       | Copy and delete appear here on hover in `PLAN-17` and `PLAN-13`. Reserved and empty now.                                                                                                                                          |

Field-level rules that are part of the contract rather than the layout:

- **Naming.** The name is the client when set, otherwise the project when set, otherwise the
  localized category name. A meeting reads `Réunions`. The owner has accepted that two meetings
  on one day look identical. No task can render nameless.
- **Non-trackable rows.** They produce no words, so `Mots` shows the em dash. Their name already
  is their category, so they take no category colour at all.
- **Nulls are visible.** A null `wordsDone` reads as the em dash, not `0`, so a planned task is
  not misread as a recorded zero. A missing project total drops the second figure of the pair. A
  missing delivery reads as the em dash.
- **An excluded task still shows its real figures.** The app records reality and the marker is
  what says the figures do not count.
- **Status has exactly one carrier.** The row ships with two, a coloured dot and a coloured badge,
  both encoding the same fact. That duplication ends here. Category does not take the freed dot,
  because it is carried by the row edge instead. See the decision below.

### Category becomes colour, 2026-07-28

The category was a labelled text field in the previous draft and was the open question the owner
answered. Their words: _"you may collapse category if you use color coding to show the type of
task at a glance"_, refined to _"you may use a small left and right border color on categoried
tasks or something similar to tell from a glance that the next task is translation without
opening it"_.

So the category stops printing a word and becomes a colour signal on the row itself. The width it
frees goes to the task name, per D3. The intent is scanning **inside an open day**, so she can see
that the next task is a translation from the row alone without opening that task. It is not about
a collapsed day, where no rows render at all.

**This knowingly reverses the simplifying pass, AC4, which shipped three days ago in PR #18.**
That pass deliberately stripped the teal (translation) and purple (revision) category washes, and
its guiding rule is that colour carries meaning rather than decoration, with semantic colour
reserved for the task status and the capacity meter only. The owner is overruling that specific
line, and the reason is that the category is not decoration to them, it is the type of work, and
they want it at a glance rather than as a word to read. **This is a recorded exception, not drift
and not a mistake to revert.** A future reader who finds coloured categories and remembers that
criterion should find this paragraph rather than "fix" it. Everything else in it stands: the
status and meter tones stay softened, and nothing else on the row earns a hue.

**The carrier is a row edge.** A small colour border on the row, which the owner suggested as left
and right. The exact treatment is design's, per D8, and "or something similar" is the owner's own
latitude. Design must weigh one edge against two explicitly, since a card of five rows carries ten
vertical colour strips if both sides are used and five if only one is.

**The status dot is deleted, not repurposed.** With the edge carrying category, the dot is once
again a plain duplicate of the status badge and it goes. The colour budget therefore does not
grow: the row loses a coloured dot and gains a coloured edge.

**A non-trackable row most likely takes no edge at all.** Neutral is the rule (AC18), and with an
edge treatment the natural way to render neutral is to draw nothing. That has a useful side
effect, since trackable work then reads as visually distinct from breaks and meetings for free.

**The mapping is one shared contract.** Which category is which colour is defined in exactly one
place and every surface that shows a category reads from it, per the project's rule against a rule
living on two sides. It belongs beside the existing `PLAN-02` category contract in
[`shared/categories.ts`](../../../shared/categories.ts), either as a field on the `Category`
descriptor or as a sibling map keyed by category id, resolving to a semantic token name rather
than a raw hex value so the five themes and dark mode still apply. **This feature does not build
it**, since nothing here needs the mapping until design has chosen the palette; it names where it
goes so the design and frontend stages do not each invent their own.

**`PLAN-30` inherits a new problem.** Custom categories will need colours too, either picked by
the user or assigned from a palette on creation. That is `PLAN-30`'s to solve, and it is recorded
here so that feature does not discover it. It is also why D8 asks for a palette that can extend
rather than one hand-tuned to exactly the six defaults.

Two things about all of this are not negotiable, and they are acceptance criteria rather than
design constraints because they are an accessibility floor and the reason the simplifying pass
existed.

- **Colour is never the only carrier** (AC16). WCAG 1.4.1, and it bites harder now that the
  carrier is a bare border rather than a labelled chip.
- **The colour budget does not grow** (AC26).

### The two durations, decided

One duration at rest, unchanged from what shipped: `effectiveDuration`, the actual minutes when
recorded and the estimate otherwise. The estimated and actual breakdown goes to the editor.

Three reasons, in order of weight.

1. **The at-rest number has to explain the bar.** The capacity meter now lives in the collapsed
   day header and is the owner's stated safeguard against hidden work. The most common reason to
   open a day is to find out why that bar is full or red. The meter sums `effectiveDuration`, so
   the field that explains it has to be the field it sums. Show the estimate instead, or show
   two numbers, and the rows no longer add up to the figure printed above them. Day collapse made
   this argument stronger, not weaker.
2. **The breakdown is an editing concern, not a reading one.** Reading an open day asks how long
   each thing takes. Comparing what a task was supposed to take against what it took is a review
   question about one task, and clicking that task now opens the editor.
3. **Two duration columns on every row is the clearest example of the clutter the owner is
   pushing back on.**

The estimate is never lost. It is stored, it is in the editor, and it is what `effectiveDuration`
falls back to for every task with no recorded actual, which is every future task in the week.

### What was cut from at rest, and where it went

- **The estimated duration** and **the actual duration** as separate readings. Editor.
- **The per-task quota override.** Editor. It is rare and it is a setting, not a reading.
- **The delivery split into two columns.** Merged into one deadline field.
- **The project number as its own column.** Folded into the identity field.
- **The category as a printed word.** It stays at rest as a colour on the row edge and stays in
  the editor as a labelled field. Its accessible name survives the loss of the visible label, per
  AC16.
- **The second status carrier.** Removed outright as a duplicate. Category does not take its
  place, since the edge carries that.
- **The meta line under the name.** Its two strings had nothing left to say once the delivery got
  its own field and the split word count moved into the words pair.
- **`Gestionnaire de projet`.** Dropped from the product. `overview.md` already records that the
  field was never filled.
- **`Consignes`.** Dropped from the product, along with the `instructions` column that backs it.

Everything on that list except the last two has a guaranteed home in the editor. That is what
makes an aggressive at-rest cut safe: cutting a field from the row moves it, it does not delete
it, and the handoff below names the destination for every one of them.

## Handoff to `PLAN-11`, the expanded editor

The owner has settled what row expansion is: "expanded tasks on click to edit will show the
rest". So expansion is the edit form, not a read-only detail view, which puts it squarely in
`PLAN-11`. **This feature builds none of it and designs none of it.** What it owes `PLAN-11` is a
complete, justified field list so that feature inherits a settled contract instead of
re-deciding one.

| Editor field                 | Why it lives there rather than at rest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client                       | Identity, editable. Read at rest, corrected here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Numéro de projet             | Identity, editable. Shared across the slices of a split group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Catégorie                    | Decides `trackable`, which decides whether the task's words count at all. Read at rest as an edge colour, named and changed here. Two requirements come with it, both the owner's and neither built here. **The selector shows each category in its own row colour**, _"Categories in the selector should also show those colors to associate row color to categories"_, so the association is learnable rather than memorised. And the colour updates live as the field changes, _"switching category also change the color"_, rather than only after a save. Both read the one shared category-to-colour mapping described under "Category becomes colour", never a second copy. |
| Livraison, date              | One of the two inputs behind the single at-rest deadline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Livraison, heure             | The other. Separate inputs because a deadline can have a day and no hour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Mots du projet               | The planning total. It drives the frozen estimate in `PLAN-12`, so it must be correctable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Mots faits                   | The quota numerator and the single most important stored number in the app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Durée estimée**            | The plan, frozen from `words / quota` by `PLAN-12`. Folded into the at-rest duration, corrected here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Durée réelle**             | The record. It moves the quota denominator on non-trackable and excluded tasks and it drives the capacity meter. Must stay genuinely nullable, see the caution below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Quota (mots/h)               | The existing `quota_wph_override`. Null means the user's default. Rare enough that it never belongs on a row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Exclure des stats**        | The toggle this feature adds storage for. The at-rest marker is its read-only face.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Statut                       | Editable here, and also cyclable straight from the row in `PLAN-14`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Répartir sur plusieurs jours | `PLAN-18`. An action, not a field, but it lives in the same panel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Récurrence                   | `PLAN-19`, `PLAN-20`, `PLAN-21`. Its own model and its own edit-scope rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Two of the original app's expanded fields are deliberately not on that list. `Gestionnaire de
projet` is dropped, and `Consignes` is dropped with the `instructions` column.

## The original columns, mapped

From the screenshots the owner supplied, so nothing is silently lost.

| Original field               | Where it lands                                            |
| ---------------------------- | --------------------------------------------------------- |
| Client                       | At rest, in the identity field.                           |
| Numéro de projet             | At rest, in the identity field. Editor.                   |
| Livraison (date)             | At rest, in the deadline field. Editor.                   |
| Heure                        | At rest, merged into the deadline field. Editor.          |
| Mots (total du projet)       | At rest, as the second half of the words pair. Editor.    |
| Durée estimée                | Editor. Folded into the at-rest duration.                 |
| Durée réelle                 | Editor. Folded into the at-rest duration.                 |
| Statut                       | At rest. Editor, and `PLAN-14`.                           |
| Row actions (copy, delete)   | Slot reserved at rest, built in `PLAN-17` and `PLAN-13`.  |
| Gestionnaire de projet       | Dropped from the product.                                 |
| Tâche (expanded)             | Already our `category`. At rest and in the editor.        |
| Quota (mots/h) (expanded)    | Editor.                                                   |
| Exclure des stats (expanded) | Stored here, marked at rest, toggled in the editor.       |
| Consignes (expanded)         | Dropped from the product, with the `instructions` column. |
| Récurrence (expanded)        | `PLAN-19` through `PLAN-21`.                              |

## Why this stays read-only

The write path is `PLAN-09` (the CRUD API), `PLAN-10` (add), and `PLAN-11` (the click-to-edit
form). This feature adds no endpoint, no form, and no mutation. Opening a day card is not a
write, since the open state never leaves the component, and the task row itself is not clickable.

That boundary is deliberate rather than convenient. Every field in the handoff table is an
input, and there is no editor to put an input in until `PLAN-11` builds one. Landing the storage
and the read shape now means `PLAN-11` binds against a complete field set and needs no second
migration of its own.

## Actual time still matters, and here is exactly how

The owner asked whether the actual duration is still relevant now that the quota changed. It is,
which is why it survives as a first-class stored field with its own place in the editor. But it
does not earn a place at rest, and the reason is subtle enough to write down.

The original app's headline number was `mots / durée réelle`, words over actual tracked time,
grouped by project name taking `max(wordCount)` once per group. `overview.md` replaces that,
confirmed with the primary user, with the availability quota:

```
quota_wph(period) = words_translated(period) / (effective_minutes(period) / 60)
effective_minutes(day) = work_minutes_setting(day) − non_trackable_minutes(day)
```

The denominator is scheduled availability. Idle-but-available time stays in it and lowers the
quota, which is how the employer measures productivity. Overtime is a boost because the
denominator is fixed.

**So actual time on a trackable task never touches the quota.** A translation estimated at three
hours that took four still divides its words by the scheduled day. That is the strongest single
argument against giving it a permanent place on the row.

**But actual time is not out of the quota.** The denominator subtracts `non_trackable_minutes`,
and that quantity is measured with `effectiveDuration`, which prefers `actualMinutes` and falls
back to `estimatedMinutes`. So actual minutes recorded on a break, a meeting, a terminology
task, or any task flagged exclude-from-stats move the quota denominator directly, minute for
minute. A meeting planned for 30 minutes that actually ran 90 removes 90 minutes from the day's
effective hours and raises the quota. That is the whole point of the exclusion the owner
described.

Actual time is also already load-bearing for the capacity meter, since `sumEffectiveDuration`
feeds `computeCapacity`, and the meter is now the safeguard that makes a collapsed day safe.

The conclusion is that actual time must be recorded accurately and must be easy to edit. Neither
of those requires it on the screen on every row of every open day.

One caution for `PLAN-12`. The original app auto-mirrored the estimate into the actual duration
until the user manually edited it, so the actual was never genuinely empty. That silently
polluted its quota, because an untouched task reported `words / (words / quota × 60)`, which
just returns the quota setting itself. The new nullable actual plus the `effectiveDuration`
fallback gets the same capacity behaviour without faking the record. `PLAN-12` specs a
mirror-until-edited behaviour, which reintroduces the same risk. The recommendation is to keep
`actual_minutes` genuinely nullable and to keep "never recorded" distinguishable from "recorded
and equal to the estimate", which the editor's two separate inputs make visible.

## What `PLAN-22` must do with `exclude_from_stats`

The quota engine is not built here. This feature adds the column so the data exists. The rule
`PLAN-22` implements, stated once so it is not reinvented:

```
counted(task)     = isTrackableCategory(task.category) AND NOT task.excludeFromStats
subtracted(task)  = NOT isTrackableCategory(task.category) OR task.excludeFromStats

words_translated(day)      = Σ wordsDone            over tasks where counted(task)
non_trackable_minutes(day) = Σ effectiveDuration(t) over tasks where subtracted(task)
```

The two predicates are exact complements, so every task on a day sits in exactly one bucket and
no task can both contribute words and have its time removed. `effective_minutes(day)` can go
negative if the subtracted time exceeds the scheduled day, which is a real state (a day of
nothing but meetings on a short schedule) and is `PLAN-22`'s floor and divide-by-zero problem,
not this feature's.

The capacity meter is deliberately not affected. `booked` still sums every task on the day,
excluded or not, because the meter reports how full the day is and not what counts toward the
quota. An excluded meeting still eats the day, and a collapsed day must still warn about it.

**Both halves of this were confirmed by the owner**, in their words: _"yes it counts, but also
subtracts total hours when calculating productivity wph. since less of the day is dedicated to
translation/revision tasks where wph apply."_ The task counts toward the day's booked time, so
the meter keeps warning, **and** its minutes come out of the quota denominator, because the day
had less time available for the work the quota measures. That is exactly the split above, so
nothing changes. It is recorded here because "counts" and "subtracts" sound contradictory until
you notice they are about two different totals.

## Acceptance criteria

### Schema and migrations

- **AC1. The schema delta is two columns.** `server/db/schema.ts` drops `instructions` from the
  `tasks` table and adds
  `excludeFromStats: integer('exclude_from_stats', { mode: 'boolean' }).notNull().default(false)`,
  matching how `magicLinkTokens.used` already stores a boolean in this repo. No other column
  changes. `PRAGMA table_info(tasks)` on a database migrated from zero shows
  `exclude_from_stats` present and `instructions` absent.
- **AC2. Two migrations, in expand-then-contract order.** The change lands as two sequential
  hand-authored files in the statement-broken style of `0000` through `0005`, each with the same
  header comment block those files carry (rationale, idempotency note, and the "DO NOT auto-run
  this against production" note).
  - `0006_add_tasks_exclude_from_stats.sql`, one statement,
    ``ALTER TABLE `tasks` ADD `exclude_from_stats` integer DEFAULT 0 NOT NULL;``. A constant
    default is required, since SQLite rejects a non-constant one on `ADD COLUMN`, and it is
    exactly the `0003` pattern.
  - `0007_drop_tasks_instructions.sql`, one statement,
    ``ALTER TABLE `tasks` DROP COLUMN `instructions`;``. SQLite supports `DROP COLUMN` from 3.35
    and the column is not a primary key, not unique, not indexed, and not referenced by a
    constraint or a generated column, so the drop is permitted.
    Both apply cleanly on a fresh SQLite database replayed from `0000`. Neither existing migration
    file is edited, so `0004` still creates the table with `instructions` and the sequence replays
    correctly from zero.
- **AC3. Every intermediate state is valid, and the drop has a stated undo.** The order is:
  apply `0006`, deploy, then apply `0007`. Old code with the new column present is fine, because
  it never selects it. New code with `instructions` still present is fine, because it never
  selects it either. The `0007` header records the one-line recovery if it is applied before the
  deploy lands, ``ALTER TABLE `tasks` ADD `instructions` text;``, which restores a working old
  build. Neither migration is applied to production by this feature. That stays an owner step,
  matching every prior migration, and there are no production credentials in this sandbox.
- **AC4. Nothing real is lost by the drop.** No write path has ever populated `instructions`.
  `PLAN-09` is not built, so the only writer is the dev seed, which this feature rewrites in the
  same change. The spec records this rather than assuming it, because a column drop is not
  reversible once real data is in it.

### Read shape

- **AC5. `instructions` is gone everywhere.** It is removed from `server/db/schema.ts`, from the
  `TaskListItem` type and the select list in
  [`server/models/tasks.ts`](../../../server/models/tasks.ts) and
  [`server/api/tasks/handlers/list.ts`](../../../server/api/tasks/handlers/list.ts), from
  `PlanningTask` in [`shared/planning.ts`](../../../shared/planning.ts), from `TaskRow.vue`, and
  from `scripts/seed.ts`. A repo grep for `instructions` outside `.recipes` and the migration
  history returns nothing.
- **AC6. The list endpoint returns the new fields, and the row stops deriving.** `GET /api/tasks`
  adds two fields to every item, mirrored in `TaskListItem` and `PlanningTask`.
  - `excludeFromStats: boolean`, the stored fact, returned as a real boolean by the Drizzle
    boolean mode.
  - `trackable: boolean`, derived server-side with `isTrackableCategory(task.category)` from the
    `PLAN-02` contract, resolved in the same `.map()` that already resolves `statusKey`.
    `TaskRow.vue` no longer imports `isTrackableCategory` and draws the trackable-ness it is
    handed. This follows the shipped `statusKey` precedent and the project rule that a derived
    value arrives resolved. The raw `category` string stays on the response uncoerced, because
    `PLAN-11` will round-trip it on save and a coerced value would silently rewrite a user's stale
    category. **No task-count field is added.** The count is the length of the array the page
    already hands each card, so inventing an endpoint field would create a number that could
    disagree with the rows it labels.

### Day card disclosure

- **AC7. Every day starts collapsed except today.** Today's card starts open, every other day
  starts closed, and the toggles are independent so any number of days can be open at once.
  Switching weeks resets to that default, which falls out of `Week.vue` keying its `v-for` on
  `day.date` and needs no explicit reset. A visible week that does not contain today opens
  nothing.
- **AC8. The collapsed header keeps the capacity meter and its reading unchanged.** The bar, the
  buffer band, the state colour, and the numeric reading render on a collapsed work day with the
  same `computeCapacity` figures they show today. Nothing about the meter is simplified,
  shortened, or deferred, because the bar is what makes hiding a day's rows safe. An off day
  still shows no meter, per the simplifying pass, AC3.
- **AC9. The task count shows only when collapsed.** A collapsed card with at least one task
  shows its task count. Opening the card removes it. The value is the length of the card's own
  `tasks` array, so it can never disagree with the rows. On a collapsed off day holding recorded
  work it is the only signal that work is there, since that card has no meter.
- **AC10. The control is a real disclosure button with correct semantics.** The day heading stays
  an `h2` carrying the id the `section`'s `aria-labelledby` already points at, so the section
  keeps its accessible name. The canonical accordion shape applies, a `<button>` inside that
  `h2`, carrying `aria-expanded` reflecting the state and `aria-controls` pointing at the id of
  the region holding the task rows. Any state glyph is `aria-hidden`. Extending the click target
  across the whole header is allowed, through a stretched pseudo-element rather than by wrapping
  the header in a button, since a heading is not valid button content. No `Développer` or
  `Réduire` copy is added, because `aria-expanded` is the correct carrier and assistive
  technology announces the state itself.
- **AC11. A day with nothing to disclose grows no control.** A work day with no tasks renders no
  control, no count, no `aria-expanded`, and no `aria-controls`, and keeps the header and meter
  it has today. An off day with no tasks stays the slim compact strip the simplifying pass
  settled,
  also with no control. Neither gets a button that opens onto an empty body. If today itself has
  no tasks, the today-starts-open rule simply does not apply.
- **AC12. An off day that holds recorded work collapses like any other day.** It gets the control
  and the count, it starts collapsed unless it is today, it still shows no meter, and its rows
  are one click away. This satisfies the simplifying pass, AC3, which requires recorded weekend
  work to stay
  visible, because the count announces the work and the control reaches it. Nothing is hidden
  that the user cannot see is there.
- **AC13. The open state lives in the component.** Each `DayCard` holds one boolean initialised
  from its own props. It is not persisted, not a setting, not in the URL, and never sent to the
  server, which is the narrow presentation exception the project's backend-logic rule carves out
  for whether a panel is open.

### The at-rest information set

- **AC14. The row renders exactly the at-rest set and nothing else.** The six data fields, the
  two conditional markers, and the two structural affordances listed in "The at-rest set", with
  no estimated-duration reading, no actual-duration reading, no quota override, no consignes, and
  no project-manager field. Any addition to this set is a spec change, not a design change.
- **AC15. The at-rest row is read-only and nothing in it is clickable.** No row-level expansion,
  no status cycling, no inline editing, and no hover action wired up. The only interactive
  element added anywhere by this feature is the day-header disclosure button.
- **AC16. Status is carried once, and category is never carried by colour alone.** Two parts,
  both hard.
  - The row ships with both a coloured dot and a coloured badge for the same status and ends this
    feature with one of them. The badge is the recommendation, because it is labelled and is
    already the accessible carrier. If the dot is the one dropped, `StatusDot.vue` is deleted.
    `statusKey` and its server-side resolution, including the `retard` pseudo-status, are
    unchanged either way.
  - **A non-trackable row shows the em dash rather than `N/A`.** Amended 2026-07-28, after the
    design stage removed the badge's pill and `N/A` became the loudest mark on a break or a
    meeting row. The em dash is what the same row's `Mots` cell already shows, so the two read as
    one consistent statement that neither figure applies. It is also the more honest mark, since a
    break has no status rather than having a status called "not applicable". `statusKey` still
    resolves to `na` and the change is presentational only, so the shared contract, the server
    resolution, and the `planning.status.na` key are all untouched and the key simply stops being
    read by the row. The dashed-border `N/A` span in `StatusBadge.vue` goes with it.
  - The category's colour is a supplement, never the whole signal. **The row carries an accessible
    name giving the localized category (`Traduction`, `Révision`, `Réunions`, and so on), so a
    colourblind or screen-reader user can tell one category from another with no colour at all.**
    This is WCAG 1.4.1 Use of Color. It is a floor rather than a preference, which is why it sits
    here and not in the design constraints, and it matters more than it did when the category was
    a labelled chip, because a bare border says nothing on its own.
- **AC17. Every task has a name.** The name is the client when set, otherwise the project when
  set, otherwise the localized category name from `categories.<id>`, so a meeting reads
  `Réunions`. This replaces the shipped
  `task.client ?? task.project ?? task.instructions ?? ''` chain at `TaskRow.vue:49`, which the
  column drop breaks. No task can render nameless.
- **AC18. A non-trackable row's category reads as neutral, not as a hue of its own.** Its name
  already is its category word for word, so a colour would repeat it, and the distinction the
  colour exists to make is Traduction against Révision, which non-trackable work is not part of.
  With an edge treatment, neutral most likely means drawing no edge, which also leaves trackable
  work visually distinct from breaks and meetings at no extra cost.
- **AC19. The deadline is one field carrying the date and the time.** The date renders as the day
  number plus the abbreviated month and the time as stored, for example `16 juill. 16:00`. A
  delivery date with no time shows the date alone. No delivery date shows the em dash whatever
  the time holds. The deadline takes no semantic colour when the task is late, because the status
  already reads `En retard` and the simplifying pass allows one carrier per state.
- **AC20. The words field shows the words done over the project total.** Both figures use the
  existing `formatCount`. A non-trackable task shows the em dash. A null `wordsDone` shows the em
  dash rather than `0`, so a planned task is not misread as a recorded zero. A null
  `projectWordCount` drops the second figure. Both null shows the em dash alone. An excluded task
  shows its real figures in full.
- **AC21. The duration field is `effectiveDuration` and nothing else.** The at-rest value is
  unchanged from what shipped, so the durations in an open card sum to the `booked` figure its
  capacity meter prints, collapsed or not. The row draws no distinction between a duration that
  is a record and one that is still a plan, because the breakdown belongs to the editor.
  `effectiveDuration`, `sumEffectiveDuration`, and `computeCapacity` keep their signatures and
  their behaviour.
- **AC22. An excluded trackable task is marked.** The marker renders only when the task's
  category is trackable, because on a non-trackable task the flag changes nothing and the marker
  would be noise. It carries an accessible label reading `Exclue du calcul du quota`.

### Accessibility

- **AC23. Every value is identifiable as to which field it is.** Whatever arrangement design
  picks, a screen-reader user must be able to tell one numeric value from another without
  counting positions, and must be able to learn a collapsed day's task count without expanding
  it. If design moves the labels off the rows, the accessibility stage supplies the association,
  and table semantics over the grid markup (`role="table"`, `role="row"`, `role="columnheader"`,
  `role="cell"`) is the recommended route.
- **AC24. The disclosure is operable and announced.** The control is reachable and operable by
  keyboard with a visible focus indicator, its accessible name identifies its day, and its state
  is conveyed by `aria-expanded` rather than by a glyph alone. Any reveal animation is suppressed
  under `prefers-reduced-motion: reduce`.

### Code hygiene and regression guards

- **AC25. The responsive split is removed from the planning week.** `TaskRow.vue` and the
  `DayCard.vue` header keep one arrangement each, with no `md:` variant and no element hidden by
  breakpoint. Any other breakpoint-conditional markup in the planning components that exists only
  to serve a mobile layout goes with them. The app shell (the header, the nav, the account
  popover) is not touched. A viewport narrower than the row's minimum width scrolls the day card
  horizontally inside its own container, never the page body.
- **AC26. The colour budget does not grow.** The row already carries status colour and sits under
  a coloured capacity meter, and category colour now joins them. The count of coloured elements
  per row must not increase against what ships today. Deleting the status dot and adding the
  category edge is a straight swap, which satisfies this exactly. Colour appears only on
  the status, the category, and the capacity meter. The exclusion marker, the split marker, the
  deadline, the words, the duration, and the task name carry none. This is the one place the
  simplifying pass, AC4 is narrowed, and the reasoning is recorded under "Category becomes
  colour".
- **AC27. The capacity meter reads identically.** `booked` still counts every task on the day
  including excluded ones, a day whose data did not change reads the same booked, remaining,
  excess, and colour band as before this feature, and collapsing a day changes none of those
  figures. The existing capacity unit tests pass unchanged.
- **AC28. A new pure helper formats a delivery date, and it is unit tested.**
  `formatDeliveryDate(deliveryDate, taskDate, months)` lives in `shared/planning.ts` beside the
  existing formatters, is pure and DB-free, and returns the day number plus the abbreviated month
  (`16 juill.`) when the delivery falls in the same calendar year as the task, and appends the
  year (`4 janv. 2027`) when it does not, so a December task with a January deadline is never
  ambiguous. The month names come from the caller's localized array, keeping month copy in the
  i18n layer exactly as `formatDayLabel` and `formatWeekLabel` already do.
- **AC29. The dev seed matches the new schema and shows the new states.** `scripts/seed.ts`
  writes no `instructions`, drops its `FILLER_LABELS` pool, and leaves non-trackable rows with no
  client and no project so they render by category name. It sets `excludeFromStats` on at least
  one trackable task per seeded week so the marker is visible, and keeps at least one trackable
  task with a null `actualMinutes` and a null `wordsDone` so the em dash cases are visible. It
  already seeds days with varying task counts and at least one worked weekend, which exercises
  the collapsed count and the collapsed off-day case. Re-run safety is unchanged: the seed still
  deletes the owner's rows first and rebuilds from today, so `bun run seed` recovers any dev
  database from any half-migrated state.

## Constraints for the design stage

Design owns the layout and is asked to push it as far toward decluttering as it can go. These
are the constraints it has to satisfy, with the reason for each, not instructions on how to
satisfy them. Where the shipped week already made a choice, it is named so design knows what it
is changing rather than inventing.

- **D1. One line per task at rest.** No second line under the name. `overview.md`'s layout
  direction is "one line per task at rest, everything else on expand", and the shipped row's
  second line is being emptied by this feature anyway.
- **D2. Values of the same field line up down a card.** The eye should read a column, not a
  paragraph. The shipped row already fixes its track widths for exactly this reason, after an
  earlier attempt with content-sized tracks made columns drift row to row.
- **D3. The task name must not truncate at realistic lengths.** It is the field that identifies
  the row, so it should take the width the others do not need. The worst seeded case is
  `Éditions Pluriel · P-4821`.
- **D4. The two word figures must read as one progress pair,** not as two independent numbers
  that happen to be adjacent.
- **D5. The deadline's date and time must read as one deadline.**
- **D6. Every value must be identifiable as to which field it is, without repeating a label above
  every value on every row if that can be avoided.** The shipped row prints two tiny uppercase
  labels per row, so a five-row card prints ten, and this feature would otherwise add a third. A
  single header line per open card is one way to collapse all of them into one; there may be
  better. Whatever is chosen has to satisfy AC23.
- **D7. Status keeps one carrier, and the recommendation is the badge,** because it is labelled
  and already the accessible carrier. Dropping the badge instead is allowed if design has a better
  answer, as long as the survivor is labelled or otherwise readable without colour. The dot is not
  reused for category, since the row edge carries that.
- **D8. The category treatment and its palette are design's to choose, within six limits.**
  The owner asked for a small colour border on the left and right of a categorised row, or
  something similar, so the treatment is a row edge rather than a chip or a dot, and the exact
  form is open. **Weigh one edge against two explicitly and record the choice**, because a card of
  five rows carries ten vertical colour strips with both sides and five with one, and the point of
  this feature is less clutter. Beyond the treatment: a distinct hue per trackable category, since
  Traduction against Révision is the distinction the owner wants at a glance. Muted enough to sit
  beside the status carrier without competing with it, since the simplifying pass softened the
  status and meter tones for exactly that reason. Legible in light and dark, through semantic
  tokens rather than raw hex. Non-trackable categories read as neutral, which with an edge most
  likely means no edge at all, per AC18. And **the palette must be able to extend**, because
  `PLAN-30` lets the user create categories that will each need a colour, so a set hand-tuned to
  exactly the six defaults would have to be redone.
- **D9. The two conditional markers must not add a box to every row.** They are rare, so an
  exclusion or a split slice should not cost every other row a pill.
- **D10. Room is reserved for two hover row actions.** Copy and delete arrive in `PLAN-17` and
  `PLAN-13` and must drop in without re-cutting the arrangement. The shipped 44 px slot carries a
  code comment admitting it is too narrow.
- **D11. The capacity meter is not weakened, and the simplifying pass, AC6, still holds.** Meter
  tracks start at
  the same position on every card and have the same width, whatever the disclosure affordance,
  the day name, or the task count do to the header.
- **D12. Fit, or come back to the spec.** If the at-rest set does not fit comfortably, design
  chooses between widening the planning container (currently `max-w-5xl` at `index.vue:190`) and
  rearranging. **It may not drop an at-rest field.** That is an information-contract change and
  needs a spec change, because a dropped field would lose its only read-only home.
- **D13. The reveal is restrained.** Short, with no slide, no bounce, and no per-row stagger.
  Duration and technique are design's, and animating height without measuring it is available
  through a `grid-template-rows` `0fr` to `1fr` transition. It must be suppressed under
  `prefers-reduced-motion: reduce`, per AC24.
- **D14. One arrangement, no breakpoints.** There is no mobile version, so there is no second
  layout to design. See AC25.
- **D15. Nothing new is decorative.** The disclosure affordance is functional and expected, and
  the category edge is the owner's explicit request. Beyond those, the net count of drawn elements
  per row should go down rather than up, since this feature removes a status carrier, a meta line,
  the category chip, and the per-row labels while adding one field and one edge.

## Copy / i18n changes

An unambiguous checklist for the frontend stage. Apply every line in both
`i18n/locales/fr.json` and `i18n/locales/en.json`. FR is default and Québécois. None of the new
strings contains `? ! : ;`, so the space-before-punctuation rule holds but is not triggered.

**Keys removed** (delete in both locale files and delete the code that reads them):

- `planning.deliveryMeta` (`Livraison {time}`), read at `TaskRow.vue:41`. The delivery is its own
  field now.
- `planning.splitMeta`, read at `TaskRow.vue:40`. The words pair carries the figure and the split
  marker carries the rest.

There is no `consignes` or `instructions` string in either locale file today, so dropping that
column removes no copy. It is a schema and code change only.

**Field labels.** The row's two existing labels, `planning.words` (`Mots` / `Words`) and
`planning.duration` (`Durée` / `Time`), keep their values. Four more are needed so every at-rest
field has a name available. They are grouped under `planning.columns` and the two existing keys
move into the same group so the set lives in one place:

| Key                         | FR          | EN         | Printed on screen?            |
| --------------------------- | ----------- | ---------- | ----------------------------- |
| `planning.columns.task`     | `Tâche`     | `Task`     | Design's call                 |
| `planning.columns.delivery` | `Livraison` | `Delivery` | Design's call                 |
| `planning.columns.words`    | `Mots`      | `Words`    | Design's call                 |
| `planning.columns.duration` | `Durée`     | `Time`     | Design's call                 |
| `planning.columns.status`   | `Statut`    | `Status`   | Design's call                 |
| `planning.columns.category` | `Catégorie` | `Category` | **No. Accessible name only.** |

The last column is the one thing about these keys that is settled here rather than by design. The
first five are labels for values that print, so whether they appear per row, once per card, or
only to assistive technology follows from D6 and AC23. **`planning.columns.category` is different.
No visible category label prints at all**, since the edge colour replaced the word. The key still
ships, because the field needs a name for the accessible carrier AC16 requires. The category's own
value comes from the existing `categories.<id>` keys, unchanged, and those are what an accessible
name resolves to, for example `Traduction` rather than `Catégorie`.

No `columns.estimated` and no `columns.actual` ship here. Those belong to the editor and are
`PLAN-11`'s to add, as `Durée estimée` and `Durée réelle` in full, since a form has room for the
whole phrase. No colour value is added to the locale files, because a colour is not copy. The
category-to-colour mapping lives in `shared/`, as described under "Category becomes colour".

**Key added**, the collapsed task count, as a vue-i18n pluralized message:

| Key                  | FR                                | EN                              |
| -------------------- | --------------------------------- | ------------------------------- |
| `planning.taskCount` | `{count} tâche \| {count} tâches` | `{count} task \| {count} tasks` |

Called as `t('planning.taskCount', n)`, which binds `count` implicitly. A zero count never
renders, because AC11 gives a day with no tasks no control and no count, so the French rule that
`0` takes the singular (`0 tâche`) is never exercised and no custom pluralization rule is needed.
This is recorded rather than left to be discovered, since vue-i18n's default rule would print
`0 tâches` if a zero ever reached it.

**No expand or collapse verb copy is added.** `aria-expanded` carries the state and assistive
technology announces it, so a `Développer` or `Réduire` string would be a second carrier for a
fact the platform already reports.

**Keys added**, the exclusion marker:

| Key                      | FR                          | EN                                    |
| ------------------------ | --------------------------- | ------------------------------------- |
| `planning.excluded`      | `hors stats`                | `excluded`                            |
| `planning.excludedLabel` | `Exclue du calcul du quota` | `Excluded from the quota calculation` |

`hors stats` is the visible text, lowercase so it sits quietly beside the task name the way the
`aujourd'hui` pill copy already does. `Exclue du calcul du quota` is its accessible label,
feminine to agree with `tâche`. The pairing matches the shipped `splitTag` and `splitTagLabel`.

**Key added**, the abbreviated month names for `formatDeliveryDate`, as an array under
`planning.monthsShort` beside the existing `planning.monthsLong`:

- FR: `janv.`, `févr.`, `mars`, `avr.`, `mai`, `juin`, `juill.`, `août`, `sept.`, `oct.`, `nov.`,
  `déc.` These are the standard abbreviations, and `mars`, `mai`, `juin`, and `août` are not
  abbreviated because they are already short enough. They were researched for Bout 1 and are
  reinstated here rather than re-guessed.
- EN: `Jan.`, `Feb.`, `Mar.`, `Apr.`, `May`, `Jun.`, `Jul.`, `Aug.`, `Sep.`, `Oct.`, `Nov.`,
  `Dec.`

**Unchanged and reused.** `planning.emDash` carries every empty value. `planning.splitTag`
(`⇄ suite`) and `planning.splitTagLabel` keep their values, and only how they render may change.
`planning.status.*`, `categories.*`, `planning.monthsLong`, and everything under
`planning.capacity`, `planning.nav`, and `planning.offDay` are untouched.

**Punctuation is rendered by the component, not stored as copy.** Whatever joins the two word
figures, and whatever joins the delivery date to its time, follows the Bout 2 precedent for the
middle-dot separator and is not a translatable string.

**Delivery time stays `16:00`, confirmed by the owner.** The Québécois convention writes a clock
time as `16 h 30`, but the row prints durations as `3 h 00` through `formatDuration`, and a
duration field near a `16 h 00` deadline would read as two durations. Keeping the numeric `16:00`
for a clock time and `3 h 00` for a duration disambiguates the two at a glance. The owner
confirmed this directly, _"i assume 16:00 is a time and 16h00 is a duration"_, so it is settled
rather than open, and it matches the format already stored in `delivery_time`.

## Out of scope

- **The row's expanded editor.** `PLAN-11` builds it and designs it. This feature settles its
  field list and builds none of it. The task row is not clickable.
- **Remembering which days were open.** The state resets on every week switch by design, and it
  is never persisted to settings, the URL, or the server.
- **Recurrence.** `PLAN-19` (config and model), `PLAN-20` (materialization), and `PLAN-21` (edit
  scope). Nothing recurrence-related is added to the schema, the read shape, or the row.
  `tasks-schema.md` AC5 deliberately keeps the table free of recurrence columns and that stays
  true after this feature.
- **Every write.** No create, update, delete, status cycle, reorder, move, copy, or split. That
  is `PLAN-09` through `PLAN-18`. In particular the `Exclure des stats` toggle is stored and
  marked here and made editable in `PLAN-11`.
- **The quota engine.** `PLAN-22`. This feature stores the flag and writes down the rule the
  engine will implement. It computes no quota.
- **The row actions themselves.** The slot is reserved, the buttons are `PLAN-17` and `PLAN-13`.
- **The app shell.** The header, the nav, the colour-mode toggle, and the account popover are not
  part of the planning week and are not touched by the responsive cleanup.

### Interruption and recovery

The only path here that spans more than one step is the migration, and AC2 through AC4 cover it.
The expand-then-contract order means an interrupted rollout leaves a valid database in every
intermediate state. Applying `0006` without deploying is harmless, deploying without applying
`0007` is harmless, and applying `0007` early has a one-line undo recorded in its own header. A
dev database in any state recovers with `bun run seed`.

Day collapse adds no persistent state, so there is nothing to get stuck in. The worst case is a
day left closed, and that day still reports its capacity through the meter and its content
through the count, so a collapsed day can never quietly swallow work. Any confusion resets by
paging a week and pressing `Cette semaine`, which reopens today.

Nothing else in this feature holds a token, a session, or a multi-request flow. The read path is
one authenticated `GET`, and the existing recoverable load-error state with its `Réessayer`
action and the `Cette semaine` re-anchor are unchanged and still apply.

## Stages

Specs and code review are never skipped.

- **Design runs, and it is the stage that resolves the layout.** It receives the at-rest set and
  the D1 through D15 constraints and decides the arrangement: how the fields are ordered and
  sized, how a value is identified as belonging to a field, which single carrier status keeps,
  **the category edge treatment and its palette** (D8, including the recorded one-edge against
  two-edge call and a palette that `PLAN-30` can extend), how the two markers render without
  adding boxes, where the disclosure affordance and the task count sit in the day header, and
  **whether the planning container widens**. The frontend stage implements what design decides,
  and it does not settle any of these itself. Design cannot add or remove an at-rest field, which
  is D12.
- **Backend** runs. The two schema columns, the two migrations, the list handler and model
  changes, and the seed rewrite. It has no dependency on design and can run alongside it.
- **Frontend** runs after design. The day-card disclosure and its state, the at-rest row rebuilt
  to design's arrangement, the naming fallback, the status-carrier removal, the exclusion marker,
  the responsive cleanup, and the i18n edits.
- **Accessibility** runs, and it has the most to do here. The disclosure button, its
  `aria-expanded` and `aria-controls`, and the preserved `h2` plus `aria-labelledby` are AC10 and
  AC24. How the values are announced under whatever arrangement design chose is AC23, including
  whether a collapsed day's count is reachable without expanding. It also confirms the surviving
  status carrier is accessible without colour, that the exclusion marker has a real accessible
  name, that the reveal honours `prefers-reduced-motion`, and that the removed mobile layout does
  not leave the page body scrolling sideways. **The category edge is the item most likely to fail
  a pass**, since a bare border is a pure colour signal, so AC16's accessible-name requirement and
  the contrast of the chosen hues in both themes are this stage's to enforce and to block on.
- **Unit-test** runs. It covers `formatDeliveryDate`, including the same-year and cross-year
  forms and the four months that are not abbreviated in French, and it confirms
  `effectiveDuration`, `sumEffectiveDuration`, and `computeCapacity` still pass their existing
  tests unchanged. The open state is component-local UI state with no pure logic to isolate, so
  it is not a unit-test target.
- **Compliance** is skipped. No new class of personal data, no email, no third-party asset, no
  public content. The same authenticated dashboard reads the owner's own tasks, and dropping a
  free-text column reduces rather than increases what is stored.
- **SEO** is skipped. The page is an authenticated dashboard behind sign-in and already
  `noindex, nofollow`.

## Open questions

None of these block the build.

1. **Whether the third row action fits.** The original app shows copy and delete, and D10 reserves
   room for two. `week-with-task-rows.md` also lists split (`PLAN-18`) as a row action. If split
   stays a row button rather than moving into the `PLAN-11` editor, that feature widens the slot
   or overlays the group on hover. Worth deciding when `PLAN-18` is specced.
2. **Whether the deadline should be hidden when it falls on the task's own day.** It is the common
   case for a same-day task and printing it repeats the day header. AC19 shows it always,
   matching the original app, which is the safer default until she says otherwise.
3. **Whether an open day should close when another is opened.** AC7 makes the toggles fully
   independent, per the owner's decision. If opening several days at once turns out to recreate
   the long scroll the collapse was meant to fix, an accordion that keeps one day open is a small
   change to where the boolean lives.
