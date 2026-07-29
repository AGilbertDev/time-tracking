# Planning dashboard — feature breakdown

The dashboard is the core of the product, the planning views plus the quota stats. It replaces the empty placeholder at `app/pages/index.vue`. This document is the master breakdown. It records the decisions locked in the working sessions, lists the questions still open, and splits the dashboard into small features that each go through the pipeline on their own and can be tested in isolation.

Each feature below has an id (`PLAN-01`, …), a scope, its dependencies, and acceptance criteria written so they can be verified. When a feature enters the pipeline, the `specs` agent promotes its section here into a full `docs/specs/planning/<feature>.md`. This file stays the map and the ordering.

Read alongside [`docs/spec.md`](../../spec.md) (§4 domain model, §5 stats, §6 week view, §7 interactions) and [`docs/concept.md`](../../concept.md) (the old app this rebuilds).

The primary user uses the old app **every single day** and her data lives in **CSV files**. This is a rebuild of a tool in active daily use, not a greenfield app. Two things follow. Her existing CSV history must import into the new app without loss (`PLAN-29`), and we must not regress a workflow she depends on. When a decision is uncertain, favour matching what she does today over a cleaner idea.

---

## Locked decisions

These came out of the working sessions with the primary user and are settled. They override the older TBDs in `spec.md` where they conflict.

### The quota is the reason the app exists

For each period the app shows one headline number, the corrected quota in words per hour.

```
quota_wph(period) = words_translated(period) / (effective_minutes(period) / 60)
```

- **`words_translated(period)`** is the sum of `words_done` across the trackable tasks in the period. `words_done` is the words actually completed on that task on that day, a stored fact, not the project total (see split tasks).
- **`effective_minutes(day) = work_minutes_setting(day) − non_trackable_minutes(day)`**. The denominator starts from the user's **scheduled** work-day length and subtracts the time spent on non-trackable tasks. It does **not** use the time actually spent translating. Available-but-idle time stays in the denominator and lowers the quota, which is how the employer measures productivity.
- **`effective_minutes(period)`** sums `effective_minutes(day)` over the days in the period.
- A non-trackable task (meeting, break, terminology) contributes no words and removes its duration from the effective hours. A 15 min meeting removes 15 min from the day, the week, the month, and the year.

**This is deliberately not the CAT-tool metric.** memoQ and Trados both measure words divided by _actual editing time_, the throughput while you are working. The old app did the same (`mots / durée réelle`). The employer's quota here divides by _scheduled available hours_ instead, so the two numbers differ on the same day. We may surface the CAT-style throughput as a secondary insight later, but the headline number is the availability quota. See [research notes](#research-notes).

**Overtime is a boost, by design.** The denominator is the scheduled length, never the actual hours worked. Extra words produced in overtime raise the numerator while the denominator stays put, so the quota goes up. Cramming more words into the same official day is exactly what a higher quota should reward.

- Work logged on a non-work day (scheduled length 0) has no standalone day quota, since dividing by zero has no meaning, but its words lift the enclosing week, month, and year.
- Overtime on a normal work day lifts that day, because the words rise over a fixed scheduled denominator.

**Running quota during the day.** Beyond the final number, the app shows a live pace from the effective minutes elapsed so far (scheduled minutes up to now, minus non-trackable time already taken). This is an at-a-glance "am I on track" read that updates through the day.

Confirmed with the primary user. The employer uses this availability quota, words over scheduled hours minus non-trackable time. This replaces the old "group by project, take max words" algorithm.

### One quota per category, not one quota for everything

Decided 2026-07-28. Translation and revision are not the same work and do not run at the same speed, so a single global words-per-hour number cannot describe both. The quota becomes a property of the category rather than a single user setting, and the stats report a row per category rather than one blended figure.

The trackable set grows past the two we shipped. The direction is translation, internal revision, external revision, and proofreading, with the user able to add her own on top and each carrying its own default quota. `PLAN-30` already lets her create categories, so this makes the quota one more field on a category she owns rather than a new mechanism.

### The category set and the real quotas, from the primary user

Given 2026-07-29. These are her employer's categories and her employer's numbers, so they replace every researched estimate below.

**The default set is nine**, after the revision split and `dtp` joining. She can add more on top, which is `PLAN-30`. The shipped set is six, so `PLAN-02` grows by three and loses one.

| Id                  | FR               | EN                | Trackable | Quota (wph) |
| ------------------- | ---------------- | ----------------- | --------- | ----------- |
| `translation`       | Traduction       | Translation       | yes       | 240         |
| `revision_internal` | Révision interne | Internal revision | yes       | 1000        |
| `revision_external` | Révision externe | External revision | yes       | 1300        |
| `proofreading`      | Relecture        | Proofreading      | yes       | 2000        |
| `terminology`       | Terminologie     | Terminology       | no        | none        |
| `meetings`          | Réunions         | Meetings          | no        | none        |
| `breaks`            | Pauses           | Breaks            | no        | none        |
| `admin`             | Administration   | Admin             | no        | none        |
| `dtp`               | Mise en page     | DTP               | no        | none        |

Against the six that shipped: `proofreading` and `dtp` are new, `revision` becomes two, and every French string above is now confirmed. `Relecture` was checked against the stricter `Correction d'épreuves` and she chose the shorter word, so it is a decision rather than a loose synonym and should not be "corrected" later.

**Proofreading is new.** The six defaults that shipped in `PLAN-02` do not include it, so the contract grows by one trackable category.

**Revision is two categories, not one.** Her list names a single `revision` but her quotas give internal 1000 and external 1300, and two rates cannot share one category.

**The split is who wrote the text she is revising**, clarified 2026-07-29: internal is an employee's translation, external is a contractor's. It is not about who performs the revision, which is always her, and it is not about where the work sits. So the category answers "whose work is this", and that is why it carries its own rate.

Note the direction, because it looks like a transposition and is not. **External revision is the faster quota at 1300, internal the slower at 1000.** Revising a contractor's work is expected to move quicker than revising a colleague's. Recorded explicitly so nobody later reads it as a typo and swaps them.

**Decided 2026-07-29: split it into two categories, the simplest way.** The shipped `revision` id is replaced by `revision_internal` and `revision_external` rather than one being renamed and the other added, because a clean pair is easier to read than a pair where one member is a rename of something else.

That is only simple because there is no history to protect. `PLAN-09`, the write API, is not built, so no task has ever been created by a user and the only rows carrying `revision` come from the dev seed, which this change rewrites anyway. Whoever implements it should confirm that is still true rather than inherit the assumption, because the same change after `PLAN-09` ships would need a data migration and would stop being simple.

Proposed copy: `Révision interne` and `Révision externe` in French, `Internal revision` and `External revision` in English. These are the direct renderings of the terms she used and read correctly in Canadian French, but they are her employer's vocabulary, so confirm them before they ship.

**DTP joins the defaults as `dtp`, reading `Mise en page` in French and `DTP` in English.** Named by her on 2026-07-29. It is desktop publishing, the pass after translation that refits the translated text into the original design, which is the PowerPoint work she described.

The English name was `Layout` for part of that day, on the reasoning that it renders `Mise en page` directly and keeps the register of the set, which is otherwise plain words rather than industry acronyms. **Rejected the same day, by her: `Layout` is generic.** It describes arranging things on a page and says nothing about refitting translated text into someone else's slides, so it fails the one job the name has. `DTP` won over the spelled-out `Desktop publishing` because it is what she actually says, and the register argument that protected `Layout` does not apply to a single-user app whose only user is a translator. So the set carries one industry acronym on purpose. Note that French and English diverge here rather than translating each other, which is fine, because each side is the term its own reader uses.

It is non-trackable. The industry bills DTP per page or per hour and never per word, so it produces no words and its time comes out of effective hours exactly as a meeting's does.

### Words are a total, not a progress pair, deferred to a later feature

Given 2026-07-29. **Not implemented.** Her words: "we don't track words translated in realtime. useless to track x/y. only totals."

The shipped row prints `Mots` as `words done / project total`, for example `2 800 / 12 000`. That reads as live progress through a job, and she does not work that way. She records what a task is, not how far into it she is at any moment. The row shows one figure, the project total, and the pair goes.

This amends `AC20` of [extend-tasks.md](extend-tasks.md) and removes one of the two figures from the at-rest set, so it is a contract change rather than a styling one. It also matches the original app, whose column was headed `Mots (total du projet)`.

**The consequence to get right is the quota numerator.** `words_translated(period)` sums `words_done`, not `project_word_count`, and that stays correct because it is the only thing that keeps a multi-day job from counting its whole total on every day it touches. What changes is where `words_done` comes from. If she only ever types a total, then for an ordinary single-day task `words_done` is that total and the app should set it rather than ask twice for the same number. `words_done` only diverges from the total on a split (`PLAN-18`), which is exactly the moment the split flow already asks for it. So the field survives in the schema and in the quota, and stops being something she fills in by hand on a normal task.

Two things for the implementing feature to settle. Whether `words_done` is written at save time from the total or derived at read time, and what a task shows once it is split, since the slice's own words are then genuinely different from the project total and hiding that could make a split slice look like it did the whole job.

### The duration pair is the progress signal, and that reopens a shipped decision

Raised by the primary user on 2026-07-29, straight after the words decision above: "i think that's why we previously tracked estimated vs actual durations."

That is the missing half of why the old app looked the way it did, and it corrects reasoning already written into a shipped spec.

Words on a task are a static total, known when the job arrives and never revised as it progresses. So `estimated_minutes = words / quota` is fully derived and tells her nothing she did not already type. `actual_minutes` is then the **only** field on an ordinary task that records what happened rather than what was planned. The estimated-against-actual pair is not a second progress indicator competing with the words pair, it is the one that exists **because** the words pair does not.

Better than that, the pair encodes quota attainment per task with no word arithmetic at all. If `estimated = words / quota`, then `actual < estimated` means the task beat its quota and `actual > estimated` means it missed, directly and at a glance.

**One correction to that story, checked against the old code rather than assumed.** The primary user's reading is that the pair was tracked "to get estimated vs real stats". Half of that holds. `actual_minutes` absolutely existed to feed statistics: in the old `StatsBar.vue` it was the entire denominator of `Quota réel calculé (mots/durée réelle)`. But the old app never computed an estimated-against-actual statistic. Its `correctedWph` reads only the actual duration, and the estimate appears nowhere in its stats. The estimate was the auto-filled starting value for actual and the plan figure on the row, nothing more.

That matters twice over. Actual time's old statistical job is gone, because the availability quota divides by scheduled hours rather than by time spent, so actual no longer feeds the headline number at all. And an estimated-against-actual statistic would therefore be **new work rather than a restoration**. It is probably worth building, since both figures are already stored and it is the cleanest per-task attainment signal available, but it should be specced as an addition and not smuggled in as something the rebuild dropped.

**Where this leaves [extend-tasks.md](extend-tasks.md).** Its "two durations, decided" section collapses the pair to a single `effectiveDuration` at rest and sends the breakdown to `PLAN-11`'s editor. Its reasons were that the at-rest number has to explain the capacity bar, that comparing plan against reality is a review question rather than a reading one, and that two duration columns were the clearest example of the clutter being removed. The first reason still holds and is still good. The second does not survive this: comparing plan against reality is not an occasional review question here, it is the only performance signal the row has left, and this feature removed the other one in the same pass. Between the words pair and the duration pair, the shipped row now carries nothing that says how a task is actually going.

**Not implemented, and not obvious enough to decide here.** Three routes, for whoever picks this up.

- Restore both durations at rest and accept two columns. Honest and complete, but it is the exact clutter the simplifying pass and this feature both cut, and the capacity bar then sums neither column cleanly, since it sums actual where present and estimated where not.
- Keep one duration and add a variance marker beside it, so the row shows the effective duration plus a quiet signal that the task ran over or under its estimate. Keeps the bar explainable and one column, and carries the attainment reading that matters.
- Leave it to the stats. Per-task attainment rolls into the per-category quota rows anyway, so the row stays quiet and the question is answered one level up.

The middle route looks strongest, because it keeps the property the first reason depends on while restoring what the second reason wrongly dismissed. It should still be designed rather than assumed.

**A fourth thing to consider alongside them, and the one the primary user was reaching for.** An estimated-against-actual statistic, per category and per period, sitting beside the availability quota in `PLAN-23`. It answers "am I faster or slower than my quota says I should be", which is a different and more actionable question than "what does my employer see", and it is the CAT-style throughput reading this project deliberately set aside as the headline. Both inputs are already stored, so it costs an aggregation rather than a schema change. If that stat exists, the case for putting the pair back on every row weakens considerably, because the question it answers is a period question rather than a row question.

### The original category colours, deferred to a later feature

Given 2026-07-29, from the app she uses today. **Not implemented.** The shipped palette in `shared/categories.ts` is the design stage's invented one and stays until a feature picks this up. Recorded here so that feature inherits a decision rather than re-deriving one.

| Category           | Her colour  | Proposed hue   | Note                                   |
| ------------------ | ----------- | -------------- | -------------------------------------- |
| Translation        | cyan        | 195            | Already what shipped, by coincidence   |
| Revision, internal | apple green | 140            | She gave one green for both, see below |
| Revision, external | apple green | needs its own  | See below                              |
| Proofreading       | pale gray   | none, chroma 0 | Not a hue, see below                   |
| Terminology        | wine red    | 20             |                                        |
| Meetings           | pink        | 340            |                                        |
| Breaks             | navy        | 265            |                                        |
| Administration     | invented    | 305            | She did not specify one                |
| DTP                | invented    | 60             | She did not specify one                |

Two decisions she made alongside them.

**Every category takes an edge, including the non-trackable ones.** This amends `AC18` of [extend-tasks.md](extend-tasks.md) and the `edgeSlot: null` on the four non-trackable defaults. The shipped reasoning was that translation against revision is the only distinction worth colour and that a non-trackable row already prints its category as its own name. Her original app coloured everything and she wants that, so the reasoning loses.

**Lightness stays fixed for every category.** She chose the simple rule over literal fidelity, so navy renders as a medium blue, wine red as a medium red, and pale gray as a light neutral. One number per category survives, and a category `PLAN-30` has not created yet still inherits its contrast for free.

Four problems the implementing feature has to solve. None are reasons to change the decision, they are the work.

- **The palette is now crowded past what fixed lightness can carry.** Nine categories need distinct edges, four status hues are reserved, one category is grey rather than a hue, and revision needs two greens that read as related but distinct. Apple green at 140 with its sibling anywhere within about 30 degrees will be hard to tell apart at identical lightness, and moving the sibling further lands it on cyan or on success green. That is three constraints competing for the same arc. The likely answer is that revision's two members are the honest second case for a lightness or chroma exception, alongside wine red and pink below, so the shared rule holds for the set and two pairs opt out with a documented reason. Worth designing rather than assuming.

- **Wine red and pink are adjacent hues, and her original told them apart by lightness.** Fixed lightness drops exactly that difference, so 20 and 340 sit 40 degrees apart at identical lightness and will read as similar reds. Pink is proposed at 340 rather than 350 to buy what spacing there is. If it still reads wrong on screen, those two are the honest case for a per-category lightness exception, and it is better to make that exception for two categories than to abandon the shared rule for all of them.
- **Pale gray is not a hue and the current contract cannot express it.** `categoryEdgeHue` returns a hue angle, and grey means chroma 0. Proofreading does not exist as a category yet, so nothing is broken today, but whoever adds proofreading must widen the contract to allow a chroma-zero slot rather than squeezing grey out of a hue number.
- **Her hues collide with the reserved status hues, and the shipped palette was ordered specifically to avoid them.** Apple green 140 sits beside success 148, wine red 20 beside error 27, navy 265 beside info 258, and any warm slot for administration lands near warning 78. With six categories plus four status roles there is not enough hue space to keep them apart, so the separation has to come from position and shape instead: the category is a 3 px left edge on the row and the status is text in its own column. Worth watching once it is on screen, because it is the one place this palette could actively mislead.

**The 450 default is wrong and has to change.** `settings.quota_wph` defaults to 450 and the research note below justifies that number from published norms of 400 to 600 words per hour. Her employer's translation quota is 240, well under the published range, so the note is now misleading rather than supporting. Published norms measure throughput while working; this quota divides by scheduled availability, which is a different and larger denominator, and that is most of the gap. Keep the research as context for what the CAT tools report and stop treating it as evidence for the default. Once quota is a per-category setting, the global default retires with it.

**The category names are not settled and must not be guessed.** These are the terms her employer uses, and the Canadian industry draws real distinctions here. Bilingual revision checks a translation against its source, unilingual revision works on the target alone, and proofreading is the final accuracy pass, and the three are separate billable services rather than loose synonyms ([oxo innovation](https://oxoinnovation.com/fr/blog/la-difference-entre-la-revision-bilingue-la-revision-unilingue-et-la-correction-depreuves/), [ITC Traductions Canada](https://www.itctraductionscanada.ca/service-relecture-revision/), [HEC Montréal](https://www.hec.ca/biblio/services/traduction-revision.html)). Whether her employer splits internal against external, or bilingual against unilingual, is a question for her. Confirm the list and the FR copy with her before any of it is built.

There is also no industry benchmark to fall back on for the defaults. Translation measures around 500 words per hour with a wide spread, but revision speed has largely been overlooked, published figures range from under 200 to over 2000 words per hour, and practitioners openly dispute them. So every default quota comes from her employer's actual numbers, never from a researched average.

**The open problem is what a per-category quota does to the availability metric.** The denominator is one pool of scheduled time minus non-trackable time, and idle time sits in that pool without belonging to any category. So the availability quota cannot simply be computed four times. Three ways out, in order of preference.

- **Normalised attainment.** Give each trackable task an expected duration from its own category quota, sum the expected minutes across every trackable task whatever its category, and compare that total to the available minutes. One number, comparable across any mix of work, and it reduces to today's raw words-per-hour when every category shares a quota. Per-category words per hour then becomes a breakdown beneath the headline rather than the headline itself.
- **Per-category throughput.** Report words over the time actually spent in that category. This is a real and useful number, but it is the CAT-tool metric this project deliberately moved away from, and it answers a different question than the employer asks.
- **Splitting the available pool between categories.** Rejected. Any rule for attributing idle time to one category over another would be invented rather than measured.

Confirm with her whether the employer itself reports separate quotas per work type, or whether one availability number covers everything and the split is for her own insight. The answer decides whether attainment is the headline or a convenience.

**What this touches.** `PLAN-02` (the category contract gains a quota and the default set grows), `PLAN-22` (the engine computes per category and needs the attainment decision above), `PLAN-23` (a row per category), `PLAN-30` (a created category carries a quota), and the settings page (the single default quota becomes one per category). `quota_wph_override` on a task already exists and stays, as the per-task exception to its category's default. None of this is built yet and it may split across several features.

### History must stay correct when settings change

A period's quota is computed only from facts stored on that period's days. Editing today can never reach backward. The one danger is a mutable setting silently rewriting the past, and the quota denominator reads the **work-hours setting**, so that setting is versioned by date (`PLAN-03`).

- `work_minutes_setting(day)` is resolved from an effective-dated work schedule (`PLAN-03`), the pattern payroll systems use, so changing the day length next month leaves past days on the length in effect then, and even a day with no tasks resolves correctly.
- `estimated_minutes` is computed once from `words / quota` and **stored as a frozen value**. Changing the default quota later does not restate old estimates. It recomputes only when that task's own word count or its per-task quota override changes.
- Editing a **past** task's `words_done`, `actual_minutes`, or category **does** restate that past period. That is a correction of the record, which is intended, not the bug we guard against.

### Day capacity has a buffer

The day header shows booked vs remaining time against the day's work-hours setting, with a buffer zone the user likes to keep for urgent tasks.

- `booked_minutes(day)` is the sum of the effective duration of **all** tasks that day, trackable and non-trackable (a meeting still eats the day). Effective duration is `actual_minutes` when set, otherwise `estimated_minutes`.
- `remaining = work_minutes_setting − booked_minutes`.
- Colour bands, driven by a per-user `buffer_minutes` setting that defaults to 60.
  - `remaining > buffer_minutes` — comfortable (neutral / success tone).
  - `0 ≤ remaining ≤ buffer_minutes` — into the buffer (warning tone, yellow).
  - `remaining < 0` — overbooked (danger tone, red), showing the excess.

The app signals, it never blocks. Yellow and red are hints, the user can still add tasks (non-negotiable from `spec.md` §2).

### Settings live on the settings page, onboarding stays minimal

The work schedule, buffer, default quota, working days, and custom categories are all user settings. They belong on the settings page, which another agent is building, not in onboarding. Onboarding collects only the minimum and the rest is edited later on the settings page. Planning features read these values but do not own the editing UI for them.

### Tasks, splits, recurrence

- **A multi-day task is stored as one row per day.** A piece of work that spans days is one logical task, a shared `project` plus a `split_group_id`, made of one slice per day. Each slice carries its own `words_done` and its own duration, and the UI presents the slices as one connected task. This keeps every period stat a plain indexed range sum over `(user_id, date)` and avoids allocating words at query time. Week and month stay viewing granularities on top of these day rows.
- **Split, not distribution.** The split action is how multi-day slices are created with low friction. The user records `words_done` on the current day and ports the remainder to another day as a linked slice sharing the project. The quota attributes each day only its own `words_done`, so nothing is double-counted and we do not need the old max-words trick. Equal distribution (total words over the span) is offered only as an editable pre-fill, never as the reported number, because it is wrong when effort is uneven and it smears words across period boundaries.
- **Recurrence** works like Google Calendar. Toggle a task recurrent, pick weekdays and a timeframe, and no end date means it repeats forever. Editing a recurring task offers this one, this and the following, or all. Occurrences materialize as normal day-tasks the user can still tweak.
- **Categories** carry a `trackable` flag. Trackable categories (translation, revision) produce words and count toward the quota numerator. Non-trackable categories (terminology, meetings, breaks, admin) remove their time from effective hours. The set stays small, and the user can create their own categories, each with its own trackable flag (`PLAN-30`).
- **Status only on trackable tasks.** `Accepté` / `En cours` / `Terminé` applies to translation and revision. Non-trackable tasks (a meeting, a break) show `N/A` and have no status to cycle.
- **The project manager field is dropped.** It was never filled.

### Interactions carried forward

Add, inline expand-to-edit with click-outside to collapse, delete, status cycle on click, reorder within a day, move across days, copy-paste (a plain duplicate, not a recurrence link), and split. Drag works within and across days in the same view.

---

## Open questions

None of these block the build now.

1. Resolved, then extended. The employer's quota is words divided by total scheduled work hours minus non-trackable time, the availability quota locked above. The later check on whether revision counts like translation has now been answered, and it does not, so the quota is per category (see [one quota per category](#one-quota-per-category-not-one-quota-for-everything)). What stays open there is how a per-category quota folds back into a single availability number, and confirming the category list and its defaults with the primary user.
2. Resolved. A multi-day task is per-day slices created by the split action. Day, week, and month are viewing granularities, every slice sits on one date.
3. Resolved. Overtime and non-work-day work are a boost. Words raise the numerator over the fixed scheduled denominator, so the quota rises. A non-work day has no standalone day quota but lifts the week, month, and year.
4. Reopened. Six default categories shipped in `PLAN-02`, translation and revision trackable, terminology, meetings, breaks, and admin not. The trackable half is now growing, with internal revision, external revision, and proofreading under discussion, and each trackable category carrying its own quota. The list, the FR copy, and the default quotas all need confirming with the primary user, since they are her employer's terms and her employer's numbers.
5. **Status vocabulary.** Keep `Accepté` / `En cours` / `Terminé`, plus `N/A` for non-trackable tasks. Confirm the three trackable names with the user.
6. **Row layout.** Settle on the mockup. Direction is a calm, breathable list, see [views and layout](#views-and-layout-direction).
7. Resolved. Buffer defaults to 60 min and is editable per user on the settings page.

Default categories (FR / EN): Traduction / Translation (trackable), Révision / Revision (trackable), Terminologie / Terminology (non-trackable), Réunions / Meetings (non-trackable), Pauses / Breaks (non-trackable), Administration / Admin (non-trackable). The user can add more. FR copy to be verified before build.

---

## Views and layout direction

The old app was a dense spreadsheet, eight columns wide with empty padded rows, which the user calls a nightmare. The redesign goes the opposite way, calm and breathable, low mental load. Research backs a few choices.

- **Default to a calm day list, not a grid.** An agenda-style vertical list is faster to scan for the next thing and holds temporal context better than a time grid, and it is far quieter visually. Sunsama built its whole product on this calm, one-day-at-a-time feel, which is the model to follow.
- **Offer day, week, and month as toggles.** Each view answers a different question, so the accepted best practice is to let the user switch rather than force one. Day for focus, week for shape, month for the overview.
- **One line per task at rest, everything else on expand.** Keep the row to a few essentials and hide the secondary fields until the row is opened, the opposite of the old all-columns-at-once table.
- **Charts for the category split**, in the Toggl / Clockify spirit, live in the stats area (`PLAN-31`).

Concrete layout options for the mockup, to react to rather than decide in the abstract.

1. **Calm day list (recommended).** One day in focus, a soft vertical list of task rows, a big readable capacity meter on top. Week and month are lighter, zoomed-out versions of the same list.
2. **Week stack, cleaned up.** The familiar stacked days from the old app, but single-line rows, no empty placeholders, calmer palette. Least disruption to daily muscle memory.
3. **Week column grid.** Google-Calendar-style columns with time blocks. Shows the shape of the week best but is the densest and least breathable, so likely not the fit here.

---

## Feature breakdown

Ordered for the smallest shippable increments first. Each phase leaves the app in a working, testable state. A feature is "done" when its acceptance criteria pass and it has gone through the full pipeline (specs and code review never skipped).

### What to pick up next

As of 2026-07-29, the read-only week is shipped through `PLAN-08` plus two refinement passes. The working session on 2026-07-28 and 2026-07-29 produced four decisions that are recorded in [Locked decisions](#locked-decisions) but **not built**. They are gathered here as `PLAN-32` and `PLAN-33` so the next feature is a thing to pick up rather than four notes to reassemble.

**Do `PLAN-32` first.** Three of the four decisions land on the category contract, and the row work in `PLAN-33` reads the categories, so doing it the other way round rebuilds the row twice.

**`PLAN-32` is three features, not one.** Split on 2026-07-29, because it bundled a contract change, a settings retirement, and a palette design pass, and those are separable, separately testable, and reach different parts of the app. Each one goes through the pipeline on its own and lands its own pull request, which is also what the one-feature-at-a-time rule asks for. They are ordered by dependency: `32b` reads the descriptor shape `32a` establishes, and `32c` colours the nine ids `32a` declares.

| Order | Feature                            | Why now                                                             |
| ----- | ---------------------------------- | ------------------------------------------------------------------- |
| 1     | `PLAN-32a` — The nine categories   | Blocks everything below it, and the row work reads the ids          |
| 2     | `PLAN-32b` — Per-category quotas   | Blocks `PLAN-22` and `PLAN-23`, and retires a wrong shipped default |
| 3     | `PLAN-32c` — The nine-edge palette | Design-led, and independent of the two above once the ids exist     |
| 4     | `PLAN-33` — Row simplification     | Small, and independent once `PLAN-32a` lands                        |
| 5     | `PLAN-09` / `PLAN-10` / `PLAN-11`  | The write path, which is the next real capability                   |

`PLAN-11` also inherits a settled field list from [extend-tasks.md](extend-tasks.md), so it does not need to re-decide what the editor holds.

**The copy is confirmed, so no feature below has to guess at a name.** Checked with the primary user on 2026-07-29. `Relecture` for proofreading, and `Révision interne` / `Révision externe` for the pair, all three exactly as proposed. `Relecture` was confirmed over the stricter `Correction d'épreuves`, which is the term the Canadian industry uses for proofreading as a separate billable service, so the shorter word is a deliberate choice rather than an oversight and should not be "corrected" later. The internal-against-external naming was confirmed over an `employé` / `pigiste` pair that would have said whose work it is more literally. One English name changed in the same pass: `Layout` became `DTP` and the id became `dtp`, because `Layout` was generic. That closes the old `AC2` and the "must not be guessed" warning in [the original category colours](#the-original-category-colours-deferred-to-a-later-feature).

**PLAN-32a — The nine default categories**
Depends on `PLAN-02`. Amends it. Shared contract, i18n, and the dev seed. No migration is needed, because the seed carries the id change. `tasks.category` is free text with no CHECK, enum, or index, so the nine ids are already storable, and the only `revision` rows in existence came from the dev seed this feature rewrites. The reasoning is in [`AC3` of the spec](nine-task-categories.md), and the rule it follows is now written down in the backend conventions skill.

- Replaces the six shipped categories with the nine in [the category set](#the-category-set-and-the-real-quotas-from-the-primary-user). `proofreading` and `dtp` are new, `revision` is replaced by `revision_internal` and `revision_external`.
- Carries the ids, the `trackable` flags, and the FR / EN copy only. The quota field is `32b` and the colours are `32c`, so this feature changes the set without changing what a category holds beyond its name.
- AC1. The nine defaults are present with the correct trackable flags, `translation`, `revision_internal`, `revision_external`, and `proofreading` trackable and the other five not. AC2. The FR and EN strings are the confirmed ones above, in i18n keyed by id rather than in the contract. AC3. Existing `revision` rows are handled, and the claim that no user history exists is verified rather than inherited from this document. The check is done and the finding is recorded in the spec's `AC3`, which is that no write path has ever existed and every `revision` row in the dev database came from one seed pass. The finding stops being true once `PLAN-09` ships, so a later feature has to re-check rather than reuse it. AC4. `coerceCategory` validates the nine and still falls back to `admin`, so a stored `revision` resolves to a non-trackable id rather than reaching the UI raw. AC5. The dev seed is rewritten to the new ids.

**PLAN-32b — Per-category quotas, and retiring the global one**
Depends on `PLAN-32a`. Shared, backend, a migration, and the settings and onboarding UI. The migration is real here where `32a` has none, because `32b` drops the `settings.quota_wph` column, which is a structural change, while `32a` only changed stored values the seed owns.

- A trackable category carries its own quota, so `settings.quota_wph` retires as a global. See [one quota per category](#one-quota-per-category-not-one-quota-for-everything).
- The four defaults are translation 240, internal revision 1000, external revision 1300, proofreading 2000. Note that external is the faster number; [the category set](#the-category-set-and-the-real-quotas-from-the-primary-user) explains why that is not a transposition.
- The shipped 450 default is wrong and goes with the global setting. `quota_wph_override` on a task stays as the per-task exception.
- AC1. Each trackable category resolves its own quota and each non-trackable one has none. AC2. The quota is effective-dated, so editing it never restates a past period (`PLAN-30` AC6 covers the same ground for user-created categories). AC3. `settings.quota_wph` is gone from the schema, onboarding, the settings page, and `work-settings`, with no reader left behind. AC4. The research note that justified 450 is demoted to context rather than left reading as evidence.
- Open, and to settle in this feature or defer explicitly: what a per-category quota does to the availability metric, since idle time sits in one pool and belongs to no category. Normalised attainment is the preferred route and the three options are in [the original category colours](#the-original-category-colours-deferred-to-a-later-feature).

**PLAN-32c — The nine-edge palette**
Depends on `PLAN-32a`. Design pass, then shared and frontend.

- Every category carries a colour, including the non-trackable ones, which amends `AC18` of [extend-tasks.md](extend-tasks.md) and the `edgeSlot: null` those four ship with. Her original colours and the four problems the palette has to solve are in [the original category colours](#the-original-category-colours-deferred-to-a-later-feature).
- AC1. All nine categories draw an edge. AC2. The contract can express a chroma-zero slot, because proofreading is grey rather than a hue and `categoryEdgeHue` returns a hue angle today. AC3. The two revision greens read as related but distinct. AC4. Fixed lightness holds for the set, and any per-category exception is documented with its reason rather than quietly applied. AC5. No category edge is mistakable for one of the four reserved status hues, checked on screen in both modes rather than argued from hue angles.

**PLAN-33 — Row simplification: words total and the progress signal**
Depends on `PLAN-32`. Frontend, plus a design pass.

- `Mots` shows the project total alone rather than a done-over-total pair, per [words are a total](#words-are-a-total-not-a-progress-pair-deferred-to-a-later-feature). Amends `AC20` of `extend-tasks.md`.
- Decides how the row signals that a task ran over or under its estimate, now that removing the words pair leaves it with no performance signal at all. The four routes and the reasoning are in [the duration pair is the progress signal](#the-duration-pair-is-the-progress-signal-and-that-reopens-a-shipped-decision). The variance marker is the current favourite and the estimated-against-actual stat may make it unnecessary.
- AC1. The words field is one figure. AC2. `words_done` is still the quota numerator and is set rather than asked for twice on an unsplit task. AC3. A split slice does not read as having done the whole job. AC4. Whatever signals over or under, it adds no coloured element per row, per the simplifying pass.

### Phase 0 — Data foundation

**PLAN-01 — Tasks schema and migration**
Depends on nothing. Backend only.

- New `tasks` table keyed to `users.id`, with `date`, `client`, `project`, `category`, `delivery_date`, `delivery_time`, `project_word_count`, `words_done`, `quota_wph_override` (nullable), `estimated_minutes`, `actual_minutes`, `status`, `exclude_from_stats`, a `split_group_id`, a `sort_order`, and timestamps. The live column list is in [tasks-schema.md](tasks-schema.md). `instructions` shipped here and was dropped again in migration `0007`, and recurrence columns were never added, since `PLAN-19` owns that model.
- AC1. `bunx drizzle-kit push` applies cleanly and the columns exist with the right types.
- AC2. A foreign key ties every task to a user, and an index covers `(user_id, date)`.
- AC3. Deleting a user cascades or is handled deliberately (decide in the spec).

**PLAN-02 — Task categories contract**
Depends on nothing. Shared contract.

**Shipped, and superseded by `PLAN-32`.** The six defaults below are live, but the real set is nine, each trackable one carries its own quota, and every category carries a colour. Build from `PLAN-32`, not from this.

- A `shared/` module defines the six default category ids, each with a `trackable` boolean and verified FR / EN names, plus a `coerceCategory` fallback mirroring `coerceThemeId`. The shape allows user-created categories on top (`PLAN-30`).
- AC1. The six defaults are present with the correct flags (translation and revision trackable, the rest not).
- AC2. `trackable` is the single source both the quota engine and the UI read.
- AC3. An unknown id resolves to a safe default rather than reaching the UI raw.

**PLAN-03 — Effective-dated work schedule and buffer**
Depends on nothing (reads current values from the existing `settings` row). Backend plus shared.

- A small `work_schedule` history table records `work_minutes`, `work_days`, and `buffer_minutes` with an `effective_from` date per user. The value for any date is the record whose window covers it, the effective-dated / SCD Type 2 pattern payroll systems use. This is deliberately not a per-day snapshot, so a date with no tasks still resolves correctly. `buffer_minutes` defaults to 60.
- AC1. A date before a change resolves the old work minutes, a date on or after resolves the new value, including dates with no tasks.
- AC2. `buffer_minutes` defaults to 60 and is read by the capacity display.
- AC3. A pure resolver returns the effective schedule for any date, unit tested, and falls back to the default before the first record.

### Phase 1 — Read-only week

**PLAN-04 — List tasks for a date range (API)**
Depends on PLAN-01. Backend.

- `GET` with a validated `from` / `to` query, scoped to the session user.
- AC1. Returns only the caller's tasks within the range. AC2. 401 without a session. AC3. 422 on an invalid range.

**PLAN-05 — Day capacity summary**
Depends on PLAN-03, PLAN-04. Frontend.

- The day header shows the date label in French, booked, remaining, and excess, with the buffer colour bands from the locked decision.
- AC1. Booked equals the sum of effective durations of all that day's tasks. AC2. Remaining and excess compute against the resolved work minutes. AC3. The colour band is comfortable, buffer, or overbooked at the correct thresholds. AC4. A non-work day still renders with a hint and never blocks input.

**PLAN-06 — Compact task row (read-only)**
Depends on PLAN-04, PLAN-02. Frontend.

- The redesigned compact row shows the essential fields only, PM excluded, one line at rest, with the status badge coloured per status (or `N/A` for non-trackable).
- **The field set is settled in [extend-tasks.md](extend-tasks.md), which supersedes the "finalized on the mockup" line this bullet used to carry.** That spec also gives the week a second layer of disclosure, since day cards now start collapsed except today, and it moves the category from a printed word to a colour on the row edge.
- **Two of its criteria are already superseded by `PLAN-33`.** `AC20`'s words pair becomes a single total, and the single duration needs a signal for running over or under estimate. Read `PLAN-33` before touching the row.
- AC1. Only the agreed compact fields render. AC2. Status colour is correct per status, `N/A` for non-trackable. AC3. All copy is i18n, FR verified.

**PLAN-07 — Week view stack**
Depends on PLAN-05, PLAN-06. Frontend.

- Days stacked vertically, the week running **Sunday to Saturday** (North American convention), today made prominent, the user's working days shown with weekend and non-work days rendered as hints, and the French week label (`Semaine du 19 au 25 juillet 2026`).
- AC1. The week runs Sunday to Saturday and the days render in that order, with non-work days shown as hints. AC2. Today is visually distinguished. AC3. The week label is correct and localized.

**PLAN-08 — Week switcher**
Depends on PLAN-07. Frontend.

- Previous, Aujourd'hui, and next controls.
- AC1. Previous and next shift the range by one week. AC2. Aujourd'hui returns to the current week and brings today into view.

### Phase 2 — Task editing

**PLAN-09 — Task CRUD write API**
Depends on PLAN-01. Backend.

- Create, update, and delete, each validated with Zod, logic in `handlers/`, ownership enforced.
- AC1. A user can only mutate their own tasks (403 otherwise). AC2. Invalid bodies return a structured 422 via `sendZodError`. AC3. Thin route files, handlers extracted.

**PLAN-10 — Add a task to a day**
Depends on PLAN-09, PLAN-06. Frontend.

- Add to any day including non-work days and holidays.
- AC1. A new task appears on the target day and persists across reload. AC2. Mandatory fields are enforced on save, the final list per open question. AC3. Adding is never blocked on a full or non-work day.

**PLAN-11 — Inline expand-to-edit form**
Depends on PLAN-10. Frontend.

- Clicking a row expands it to the full editor with the secondary fields, and clicking outside collapses it.
- AC1. Expansion shows every field the at-rest row does not, and [extend-tasks.md](extend-tasks.md) hands over the settled list in its "Handoff to PLAN-11" section rather than leaving it to be re-decided here. `instructions` is not on it: the column was dropped in migration `0007` and the `Consignes` field it backed was dropped from the product. AC2. Click-outside collapses and does not lose unsaved intent unexpectedly. AC3. Only one row expanded at a time (confirm).

**PLAN-12 — Estimated duration auto-calc and actual auto-sync**
Depends on PLAN-11. Frontend plus shared.

- `estimated_minutes = round_to_5(words / quota × 60)`, stored frozen. `actual_minutes` mirrors estimated until the user edits it, then decouples.
- AC1. 900 words at 450 wph gives 2h00, 700 words gives 1h35. AC2. Editing actual decouples it and it stays independent. AC3. Changing the global default quota does not change a stored estimate.

**PLAN-13 — Delete a task**
Depends on PLAN-09. Frontend.

- AC1. Delete removes the task and it stays gone after reload. AC2. Empty placeholder rows are never persisted.

**PLAN-14 — Status cycle on click**
Depends on PLAN-09. Frontend.

- `Accepté` → `En cours` → `Terminé` → back, one click each, on trackable tasks only.
- AC1. Clicking advances the status and persists it. AC2. The badge colour tracks the status. AC3. A non-trackable task (meeting, break, admin) shows `N/A` and has no cycling status.

### Phase 3 — Interactions

**PLAN-15 — Reorder within a day (drag)**
Depends on PLAN-14. Frontend.

- AC1. Dragging changes `sort_order` and persists. AC2. Order is stable across reload.

**PLAN-16 — Move across days (drag)**
Depends on PLAN-15. Frontend.

- AC1. Dropping a task on another day updates its date and both days' capacity recompute. AC2. Works across days in the current view.

**PLAN-17 — Copy-paste a task**
Depends on PLAN-09. Frontend.

- AC1. Pasting creates an independent duplicate with a new id, not a recurrence link. AC2. The duplicate lands on the chosen day.

**PLAN-18 — Split a task**
Depends on PLAN-09. Frontend plus backend.

- Record `words_done` on the current day and port the remainder to a chosen day as a linked task sharing the project, joined by `split_group_id`.
- AC1. The current day keeps `words_done`, the new day carries the remainder of the project total. AC2. Both tasks share the project and the split group. AC3. The quota attributes each day only its own `words_done`.

### Phase 4 — Recurrence

**PLAN-19 — Recurrence config and model**
Depends on PLAN-01, PLAN-11. Frontend plus backend.

- Toggle recurrent, pick weekdays, set a start and an optional end, no end meaning forever.
- AC1. A recurrence config saves and reloads intact. AC2. No end date is stored and read as forever.

**PLAN-20 — Recurrence materialization**
Depends on PLAN-19. Backend.

- Occurrences appear as individual day-tasks the user can edit independently.
- AC1. Occurrences render on the configured weekdays within the timeframe. AC2. A materialized occurrence can be edited without touching the series definition.

**PLAN-21 — Recurrence edit scope**
Depends on PLAN-20. Frontend plus backend.

- Editing offers this one, this and the following, or all.
- AC1. This one detaches a single occurrence. AC2. This and the following splits the series at that date. AC3. All updates the whole series.

### Phase 5 — Stats and quota

**PLAN-22 — Quota calc engine**
Depends on PLAN-02, PLAN-03, PLAN-18. Shared plus backend, pure functions.

- Implements the availability quota for day, week, month, and year, history-safe, reading versioned scheduled minutes and per-day `words_done`.
- **Now also per category.** Each trackable category carries its own quota, so this engine reports a figure per category and must settle how those fold into one headline. Normalised attainment is the recommended shape. Read [one quota per category](#one-quota-per-category-not-one-quota-for-everything) before speccing this, and note that a per-category quota is a mutable setting reaching a past period, so it needs the same effective-dated treatment `PLAN-03` gave the work schedule.
- AC1. Unit tests cover day, week, month, and year with fixtures. AC2. Non-trackable time is excluded from effective hours and contributes no words. AC3. Split `words_done` is attributed per day. AC4. Zero effective minutes does not divide by zero. AC5. A past-day edit restates that period and never touches other periods. AC6. Overtime raises the quota over a fixed scheduled denominator, and non-work-day words lift the week, month, and year while the day itself has no quota. AC7. A running quota is available from the effective minutes elapsed so far.

**PLAN-23 — Stats bar UI**
Depends on PLAN-22. Frontend.

- A collapsible bar with a card per period showing the corrected quota, words completed, and effective time, plus today's running quota.
- **A row per trackable category**, not one blended figure, per [one quota per category](#one-quota-per-category-not-one-quota-for-everything). The category set is user-extensible, so the layout takes an unknown number of rows rather than a fixed few.
- AC1. Cards show day, week, month, and year for the period in view. AC2. Numbers match the engine. AC3. The running quota for today updates as the day progresses. AC4. Collapsible, copy is i18n and FR verified.

**PLAN-24 — Performance history and export**
Depends on PLAN-22. Frontend plus backend.

- A view to look up any past period, with a CSV or JSON export for review meetings. Format per open question in `spec.md` §10.
- AC1. Any past period resolves to the same number the stats bar showed then. AC2. Export produces a well-formed file the user can open.

**PLAN-30 — Custom categories**
Depends on PLAN-02. Frontend plus backend. Owned with the settings page.

- The user creates, renames, and retires their own categories on top of the defaults. Creating one sets its name, whether it is **trackable**, its **quota** when it is trackable, and its **colour**.
- **A quota belongs only to a trackable category.** A non-trackable category produces no words, so a words-per-hour figure on it would describe nothing. The form asks for a quota only once the category is marked trackable, and a non-trackable category stores none rather than storing an unused number that later reads as real.
- AC1. A created category is usable on tasks and persists. AC2. Its `trackable` flag flows into the quota engine and the effective-hours math. AC3. Retiring a category keeps historical tasks intact. AC4. A trackable category carries a quota the engine reads, and a non-trackable one carries none. AC5. A category carries a colour, which the task row and every category selector read from the one shared mapping, so the palette has to extend to a category that did not exist when it was designed.
- AC6. **Editing a category never restates a past period.** Both the quota and the `trackable` flag feed the stats, so changing either one reaches backward. Flipping a category from trackable to non-trackable is the sharper case, since it moves every historical task in that category from the numerator to the subtracted time and rewrites every period it touched. Both fields need the effective-dated treatment `PLAN-03` gave the work schedule, so a past day resolves the values in force on that day. This is the same "history must stay correct when settings change" rule, and it is the reason a category is versioned rather than simply edited in place.

**PLAN-31 — Time distribution charts**
Depends on PLAN-22, PLAN-30. Frontend.

- Pie or bar charts of time tracked by category for the day, week, month, and year, the kind Toggl and Clockify show.
- AC1. A chart shows the split of time across categories for the selected period. AC2. Trackable and non-trackable time are distinguishable. AC3. Follows the `dataviz` and styling conventions, readable in light and dark.

### Phase 6 — Views

**PLAN-25 — View switcher**
Depends on PLAN-07. Frontend.

- Switch between day, week, and month.
- AC1. The switch changes the range and the visible layout. AC2. The selected view persists across reload (confirm scope).

**PLAN-26 — Day view**
Depends on PLAN-25. Frontend.

- AC1. A single day in focus, calm list, with its capacity summary and task list at full detail.

**PLAN-27 — Month view**
Depends on PLAN-25. Frontend.

- AC1. A month overview with per-day capacity at a glance and a way into a day.

### Phase 7 — Portability and calendar

**PLAN-28 — Holidays and non-working days**
Depends on PLAN-05. Frontend plus backend.

- A date marked non-working still renders and still accepts work, per open question 7 in `spec.md` on the data source (manual vs seeded Quebec statutory holidays).
- AC1. A holiday renders with a label and never grays out input. AC2. The source is implemented as decided.

**PLAN-29 — Import and export (CSV migration plus backup)**
Depends on PLAN-09. Frontend plus backend. Higher priority than its phase suggests, because it carries the daily user's real history across.

- The old app stored data as CSV files and the primary user has real daily data in that format, so import must read the old CSV layout to bring her history over. Export produces a portable dated backup file.
- AC1. Importing an old CSV loads the existing tasks with words, durations, status, and category mapped correctly, tolerating the old French date and column headers.
- AC2. Export downloads a dated file with all tasks.
- AC3. Import shows a preview of what will be added before it commits, so a bad file cannot silently wipe or duplicate her data (safe recovery, no invalid states).

---

## Research notes

Grounding for the decisions above. Full sources at the end.

- **CAT tools measure throughput, not availability.** memoQ's editing time report divides source words by the _actual editing time_ recorded per segment, grouped by match rate. Trados reports word counts and analysis but leans on translation-memory leverage rather than a clock-time quota. Both answer "how fast while working", which is a different question from the employer's "words per paid hour". This is why our headline quota divides by scheduled hours, and why the CAT number would look higher.
- **Industry norms.** A professional translator produces roughly 400 to 600 finished words per hour and about 2000 to 3000 words per day, and many full-time translators work only 5 to 6 effective hours a day because the work is mentally taxing. **This no longer supports the 450 default, and the claim that it did was wrong.** Her employer's translation quota is 240 (see [the category set and the real quotas](#the-category-set-and-the-real-quotas-from-the-primary-user)), well under the published range. The numbers are not comparable: published norms measure throughput while working, and this quota divides by scheduled availability, which is a larger denominator, so the same translator scores lower here by construction. Read this as context for what a CAT tool would report, never as evidence for a default. It does still support the rest, that effective hours are fewer than clock hours and that the buffer earns its place.
- **View design.** Agenda-style vertical lists let users find the next item faster and hold temporal context better than time grids, with much less visual noise, though a grid is better for seeing free space. Best practice is to offer day, week, and month and let the user switch. Sunsama is the reference for a calm, low-overwhelm daily planner. This backs the calm-day-list default with view toggles.
- **Category charts.** Toggl and Clockify both present time-by-category as pie and bar charts in daily and weekly reports, which is the model for `PLAN-31`.

Sources: [memoQ editing time report](https://docs.memoq.com/current/en/Workspace/create-editing-time-report.html), [memoQ time tracking blog](https://blog.memoq.com/time-tracking-and-editing-distance-reporting), [Trados Studio](https://www.trados.com/product/studio/), [translator output norms (getblend)](https://www.getblend.com/blog/output-words-per-day/), [expected translation times (pactranz)](https://www.pactranz.com/translation-times/), [calendar layout types (hora)](https://horacal.app/blog/2026-06-05-types-of-calendar-layouts/), [Sunsama review (Efficient App)](https://efficient.app/apps/sunsama), [Clockify vs Toggl reporting](https://toggl.com/blog/clockify-vs-toggl).

---

## How this feeds the pipeline

One feature at a time, in phase order, each through the full pipeline from `specs` to `commit`, with an entry added to [`docs/pipeline-trace.md`](../../pipeline-trace.md) and the trail in [`docs/pipeline.md`](../../pipeline.md) as it lands. Before Phase 0 starts, the row layout and compact field set are settled on a mockup.
