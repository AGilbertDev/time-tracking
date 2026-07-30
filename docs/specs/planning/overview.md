# Planning dashboard — feature breakdown

The dashboard is the core of the product, the planning views plus the quota stats. It replaces the empty placeholder at `app/pages/index.vue`. This document is the master breakdown. It records the decisions locked in the working sessions, lists the questions still open, and splits the dashboard into small features that each go through the pipeline on their own and can be tested in isolation.

Each feature below has an id (`PLAN-01`, …), a scope, its dependencies, and acceptance criteria written so they can be verified. When a feature enters the pipeline, the `specs` agent promotes its section here into a full `docs/specs/planning/<feature>.md`. This file stays the map and the ordering.

Read alongside [`docs/spec.md`](../../spec.md) (§4 domain model, §5 stats, §6 week view, §7 interactions) and [`docs/concept.md`](../../concept.md) (the old app this rebuilds).

The user uses the old app **every single day** and their data lives in **CSV files**. This is a rebuild of a tool in active daily use, not a greenfield app. Two things follow. The user's existing CSV history must import into the new app without loss (`PLAN-29`), and we must not regress a workflow the user depends on. When a decision is uncertain, favour matching what the user does today over a cleaner idea.

---

## Locked decisions

These came out of the working sessions with the user and are settled. They override the older TBDs in `spec.md` where they conflict.

### The quota is the reason the app exists

**Superseded on 2026-07-29 by [the quota is buckets](#the-quota-is-buckets-one-per-category-measured-against-time-spent).** The targets are set separately per kind of work, and separate targets cannot be measured against one shared pool, so the availability formula below stops being the headline. The section is kept as the reasoning that led there, and the parts about history safety, overtime, and the running read during the day all survive the change unaltered.

For each period the app shows one headline number, the corrected quota in words per hour.

```
quota_wph(period) = words_translated(period) / (effective_minutes(period) / 60)
```

- **`words_translated(period)`** is the sum of `words_done` across the trackable tasks in the period. `words_done` is the words actually completed on that task on that day, a stored fact, not the project total (see split tasks).
- **`effective_minutes(day) = work_minutes_setting(day) − non_trackable_minutes(day)`**. The denominator starts from the user's **scheduled** work-day length and subtracts the time spent on non-trackable tasks. It does **not** use the time actually spent translating. Available-but-idle time stays in the denominator and lowers the quota, which is how availability-based productivity is measured.
- **`effective_minutes(period)`** sums `effective_minutes(day)` over the days in the period.
- A non-trackable task (meeting, break, terminology) contributes no words and removes its duration from the effective hours. A 15 min meeting removes 15 min from the day, the week, the month, and the year.

**This is deliberately not the CAT-tool metric.** memoQ and Trados both measure words divided by _actual editing time_, the throughput while you are working. The old app did the same (`mots / durée réelle`). The review quota here divides by _scheduled available hours_ instead, so the two numbers differ on the same day. We may surface the CAT-style throughput as a secondary insight later, but the headline number is the availability quota. See [research notes](#research-notes).

**Overtime is a boost, by design.** The denominator is the scheduled length, never the actual hours worked. Extra words produced in overtime raise the numerator while the denominator stays put, so the quota goes up. Cramming more words into the same official day is exactly what a higher quota should reward.

- Work logged on a non-work day (scheduled length 0) has no standalone day quota, since dividing by zero has no meaning, but its words lift the enclosing week, month, and year.
- Overtime on a normal work day lifts that day, because the words rise over a fixed scheduled denominator.

**Running quota during the day.** Beyond the final number, the app shows a live pace from the effective minutes elapsed so far (scheduled minutes up to now, minus non-trackable time already taken). This is an at-a-glance "am I on track" read that updates through the day.

Confirmed with the user. The review uses this availability quota, words over scheduled hours minus non-trackable time. This replaces the old "group by project, take max words" algorithm.

### One quota per category, not one quota for everything

Decided 2026-07-28. Translation and revision are not the same work and do not run at the same speed, so a single global words-per-hour number cannot describe both. The quota becomes a property of the category rather than a single user setting, and the stats report a row per category rather than one blended figure.

The trackable set grows past the two we shipped. The direction is translation, internal revision, external revision, and proofreading, with the user able to add their own on top and each carrying its own default quota. `PLAN-30` already lets the user's create categories, so this makes the quota one more field on a category the user owns rather than a new mechanism.

### The quota is buckets, one per category, measured against time spent

Decided 2026-07-29 by the owner, answering the question the section above left open. The targets are genuinely set per kind of work, the four numbers recorded below. In the owner's words, "time spent working on translations has a certain quota, time spent on internal revision, etc."

**This supersedes the availability quota.** The two cannot both be true. If translation is 240 and internal revision is 1000, those numbers are measured against different denominators, and the only denominator that belongs to a single category is the time actually spent in it. Splitting one shared availability pool between categories was already rejected on this page as invented rather than measured, and that rejection still holds. So the pool loses, because buckets are the shape that can actually be measured.

```
quota_wph(category, period) = words in that category / hours spent in that category
```

Each trackable category is a bucket with its own target. A non-trackable category is a bucket with no target, consuming time and producing no words. The three ways out listed under the old open problem are resolved by this, and per-category throughput is the one chosen, which is the second of them. It was previously set aside for being the CAT-tool metric rather than the review metric, and the correction is that the review targets are themselves per kind of work, so the two are not in conflict after all.

**Unaccounted time is a derived bucket, never an entered one.** Scheduled minutes minus everything logged that day is the leftover, and it is computed rather than typed. Asking the user's to log idle time is exactly the manual entry that killed `words_done`. Under the old availability model that gap silently dragged every number down with no explanation, and as a visible bucket it becomes the same penalty made diagnosable. It is worth more as a data-quality signal than as a time figure, because a large leftover means the logging is incomplete rather than that the user was idle.

**The buckets are dynamic.** `PLAN-30` lets the user's create categories, so the number of buckets is not fixed and no layout may assume it is. This is the same constraint `PLAN-23` already carries.

### Estimated plans the day, actual measures it, and the ratio is the attainment

Decided 2026-07-29 by the owner. "estimated time is an overview of what the day is like and actual is used for tracking quotas", which is the ClickUp split between an estimate and tracked time. This resolves the three-route question left open in [the duration pair is the progress signal](#the-duration-pair-is-the-progress-signal-and-that-reopens-a-shipped-decision), and it restores the old app's model, where `actual_minutes` was the entire denominator of `Quota réel calculé`.

- `estimated_minutes` is derived from `words / the task's category quota` and frozen when written. It costs the user's nothing to produce, and it is what the capacity bar sums. It is also circular by construction, so it can never validate anything on its own.
- `actual_minutes` is the measurement and the quota denominator. It is the only field on an ordinary task that records what happened rather than what was planned.

**The estimate is the target restated in minutes, and that makes the comparison free.** Because `estimated = words / quota`, the identity `estimated / actual = achieved_wph / target_wph` holds exactly. So "did I beat my estimate" and "did I hit my quota" are one question in two units. The row needs one comparison rather than a duration pair plus a separate words-per-hour figure, and it is the same number the stats report one level up.

This is where the ClickUp analogy usefully diverges. In ClickUp the estimate is a human guess, so the comparison measures your estimating skill. Here the estimate is the quota, so the same comparison measures attainment.

**When actual is untouched it falls back to the estimate.** Decided 2026-07-29, in the owner's words, "if the user doesn't do it, we assume it took the estimated time, that's all". [`effectiveDuration`](../../../shared/planning.ts) already implements exactly this, and the quota engine reads the same function, so the rule is shipped code rather than new work.

**Do not store the fallback, resolve it at read time.** `PLAN-12` reads as "`actual_minutes` mirrors estimated until the user edits it", and the old app implemented that by storing a copy. Storing the copy turns a task the user confirmed at 2h00 and a task we assumed at 2h00 into identical rows, and nothing can tell them apart afterwards. The column is already nullable and the fallback function already exists, so leaving it NULL behaves identically on screen and keeps the distinction for free. This is a "do not undo it" note rather than work.

**Say plainly what the fallback does to the number.** A day the user never touches reports exactly their quota in every bucket, because `words / (words / quota)` is the quota. That is the fallback working rather than a defect, but the stat then reads as on target when the truthful reading is not measured. One quiet marker on the figure covers it, and it is a display decision rather than a feature.

**memoQ already measures what the user cannot reliably type.** The user works in memoQ every day, and its editing time report records actual editing time per segment automatically, as the research notes below already cite. That is an import path rather than a feature, it sits next to `PLAN-29`, and it is recorded here so nobody rediscovers it from scratch later.

### A running timer, ClickUp's shape, minimal

Decided 2026-07-29 by the owner. "create a time button that saves tracked time like clickup but simpler", then "let it run like clickup and allow recovering the timer", and "show the same timer in the navbar".

**Deferred the same day, and deliberately.** "timer is a luxury feature that adds to manual time tracking." The write path and the full task editor come first, so this is specced as `PLAN-34` and sits after them. The decisions below are settled and are recorded now so the feature does not have to be re-reasoned when it comes up.

**It reverses a v1 scope line.** [`spec.md`](../../spec.md) §14 puts time-tracking via a running timer out of scope and allows manual duration entry only. That line predates `actual_minutes` becoming the quota denominator, so the reason behind it is gone.

The rules that keep it simple without making it wrong.

- **One timer at a time, per user.** Starting a timer on another task stops the running one and banks its time. The user can only do one thing at once, so the constraint is honest, and it removes every question about overlapping entries. Simpler than ClickUp and more correct at the same time.
- **It accumulates, never replaces.** The user starts a translation, is pulled into a meeting, comes back. Three start-and-stop cycles leave `actual_minutes` holding the sum. Replacing is the one naive choice here that is broken rather than merely basic, because it silently deletes the morning.
- **The server owns the clock.** The start instant is stored server-side and the elapsed is derived from it, so a closed tab, a sleeping laptop, and a second device all resolve to the same answer. The ticking display is the only part that is genuinely presentation. Because there is one timer per user, this is a nullable task id plus a nullable start instant on the user rather than a column on every task, which enforces the one-at-a-time rule structurally rather than by convention.
- **A timer with no end is still running, across days.** Chosen explicitly over an auto-stop at the end of scheduled hours. If the user leaves it running overnight it is still running the next morning, reporting the elapsed since yesterday. The app never invents a stop it did not observe.
- **Recovery is the manual correction the model already has.** Nothing is auto-truncated and nothing is discarded, so a forgotten timer produces a number that is too large and obviously so, and the user fixes it by typing the real duration. The owner took this call with the sixty-hour-Monday case named, preferring a wrong number the user can see and correct over a plausible one the app made up.

**Deferred within the deferred, and worth knowing exists.** A `time_entries` log of every start and stop would let the user's fix one bad entry surgically instead of correcting a total, and it is what ClickUp actually stores. It is out of the minimal version on purpose, and it is the natural upgrade if correcting totals turns out to be annoying in daily use.

### The category set and the real quotas, from the user

Given 2026-07-29. These are the user's working categories and actual numbers, so they replace every researched estimate below.

**The default set is nine**, after the revision split and `dtp` joining. The user can add more on top, which is `PLAN-30`. The shipped set is six, so `PLAN-02` grows by three and loses one.

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

Against the six that shipped: `proofreading` and `dtp` are new, `revision` becomes two, and every French string above is now confirmed. `Relecture` was checked against the stricter `Correction d'épreuves` and the user chose the shorter word, so it is a decision rather than a loose synonym and should not be "corrected" later.

**Proofreading is new.** The six defaults that shipped in `PLAN-02` do not include it, so the contract grows by one trackable category.

**Revision is two categories, not one.** The user's list names a single `revision` but their quotas give internal 1000 and external 1300, and two rates cannot share one category.

**The split is who wrote the text the user is revising**, clarified 2026-07-29: internal is an employee's translation, external is a contractor's. It is not about who performs the revision, which is always the user's, and it is not about where the work sits. So the category answers "whose work is this", and that is why it carries its own rate.

Note the direction, because it looks like a transposition and is not. **External revision is the faster quota at 1300, internal the slower at 1000.** Revising a contractor's work is expected to move quicker than revising a colleague's. Recorded explicitly so nobody later reads it as a typo and swaps them.

**Decided 2026-07-29: split it into two categories, the simplest way.** The shipped `revision` id is replaced by `revision_internal` and `revision_external` rather than one being renamed and the other added, because a clean pair is easier to read than a pair where one member is a rename of something else.

That is only simple because there is no history to protect. `PLAN-09`, the write API, is not built, so no task has ever been created by a user and the only rows carrying `revision` come from the dev seed, which this change rewrites anyway. Whoever implements it should confirm that is still true rather than inherit the assumption, because the same change after `PLAN-09` ships would need a data migration and would stop being simple.

Proposed copy: `Révision interne` and `Révision externe` in French, `Internal revision` and `External revision` in English. These are the direct renderings of the terms the user used and read correctly in Canadian French, but they are established working vocabulary rather than invention, so confirm them before they ship.

**DTP joins the defaults as `dtp`, reading `Mise en page` in French and `DTP` in English.** Named by the user on 2026-07-29. It is desktop publishing, the pass after translation that refits the translated text into the original design, which is the PowerPoint work the user described.

The English name was `Layout` for part of that day, on the reasoning that it renders `Mise en page` directly and keeps the register of the set, which is otherwise plain words rather than industry acronyms. **Rejected the same day by the user. `Layout` is generic.** It describes arranging things on a page and says nothing about refitting translated text into someone else's slides, so it fails the one job the name has. `DTP` won over the spelled-out `Desktop publishing` because it is what the user actually says, and the register argument that protected `Layout` does not apply to a single-user app whose only user is a translator. So the set carries one industry acronym on purpose. Note that French and English diverge here rather than translating each other, which is fine, because each side is the term its own reader uses.

It is non-trackable. The industry bills DTP per page or per hour and never per word, so it produces no words and its time comes out of effective hours exactly as a meeting's does.

### Words are a total, not a progress pair, deferred to a later feature

Given 2026-07-29. **Not implemented.** The user's words: "we don't track words translated in realtime. useless to track x/y. only totals."

The shipped row prints `Mots` as `words done / project total`, for example `2 800 / 12 000`. That reads as live progress through a job, and the user does not work that way. The user records what a task is, not how far into it they are at any moment. The row shows one figure, the project total, and the pair goes.

This amends `AC20` of [extend-tasks.md](extend-tasks.md) and removes one of the two figures from the at-rest set, so it is a contract change rather than a styling one. It also matches the original app, whose column was headed `Mots (total du projet)`.

**The consequence to get right is the quota numerator.** `words_translated(period)` sums `words_done`, not `project_word_count`, and that stays correct because it is the only thing that keeps a multi-day job from counting its whole total on every day it touches. What changes is where `words_done` comes from. If the user only ever types a total, then for an ordinary single-day task `words_done` is that total and the app should set it rather than ask twice for the same number. `words_done` only diverges from the total on a split (`PLAN-18`), which is exactly the moment the split flow already asks for it. So the field survives in the schema and in the quota, and stops being something the user fills in by hand on a normal task.

**Resolved 2026-07-29, and further than this section originally went.** Both questions below assumed `words_done` survives. It does not. The owner's follow-up was "clean the db. create the proper migration apply it too", so the column leaves the schema rather than being hidden or derived, and the paragraph above is kept only as the reasoning that led here.

His reason is a reliability argument and not a simplicity one, which is why it wins: "sinon on n'aura jamais des stats fiables. l'utilisateur ne perdra pas son temps à entrer chaque tâche manuellement." A field the user will not reliably fill produces worse statistics than no field, so asking for it is the defect.

**The numerator is protected by splitting instead.** Work spanning several days becomes several rows, each carrying the words actually done that day as its own total, so the quota sums row totals and no day can claim a whole project. That is `PLAN-18`'s existing model rather than a new mechanism, and for an ordinary single-day task the row total and the project total are the same number, so the common case stays simple. The now-stale questions this replaces were whether `words_done` is written at save time or derived at read time, and what a split slice shows, and neither has an answer any more because neither has a field.

One consequence to carry into `PLAN-33`: `project_word_count` becomes a misleading name once a row holds a slice total rather than a whole project's, so that feature decides whether it is renamed in the same migration or left with a comment.

### The duration pair is the progress signal, and that reopens a shipped decision

Raised by the user on 2026-07-29, straight after the words decision above: "i think that's why we previously tracked estimated vs actual durations."

That is the missing half of why the old app looked the way it did, and it corrects reasoning already written into a shipped spec.

Words on a task are a static total, known when the job arrives and never revised as it progresses. So `estimated_minutes = words / quota` is fully derived and tells the user nothing they did not already type. `actual_minutes` is then the **only** field on an ordinary task that records what happened rather than what was planned. The estimated-against-actual pair is not a second progress indicator competing with the words pair, it is the one that exists **because** the words pair does not.

Better than that, the pair encodes quota attainment per task with no word arithmetic at all. If `estimated = words / quota`, then `actual < estimated` means the task beat its quota and `actual > estimated` means it missed, directly and at a glance.

**One correction to that story, checked against the old code rather than assumed.** The user's reading is that the pair was tracked "to get estimated vs real stats". Half of that holds. `actual_minutes` absolutely existed to feed statistics: in the old `StatsBar.vue` it was the entire denominator of `Quota réel calculé (mots/durée réelle)`. But the old app never computed an estimated-against-actual statistic. Its `correctedWph` reads only the actual duration, and the estimate appears nowhere in its stats. The estimate was the auto-filled starting value for actual and the plan figure on the row, nothing more.

That matters twice over. Actual time's old statistical job is gone, because the availability quota divides by scheduled hours rather than by time spent, so actual no longer feeds the headline number at all. And an estimated-against-actual statistic would therefore be **new work rather than a restoration**. It is probably worth building, since both figures are already stored and it is the cleanest per-task attainment signal available, but it should be specced as an addition and not smuggled in as something the rebuild dropped.

**Where this leaves [extend-tasks.md](extend-tasks.md).** Its "two durations, decided" section collapses the pair to a single `effectiveDuration` at rest and sends the breakdown to `PLAN-11`'s editor. Its reasons were that the at-rest number has to explain the capacity bar, that comparing plan against reality is a review question rather than a reading one, and that two duration columns were the clearest example of the clutter being removed. The first reason still holds and is still good. The second does not survive this: comparing plan against reality is not an occasional review question here, it is the only performance signal the row has left, and this feature removed the other one in the same pass. Between the words pair and the duration pair, the shipped row now carries nothing that says how a task is actually going.

**Not implemented, and not obvious enough to decide here.** Three routes, for whoever picks this up.

- Restore both durations at rest and accept two columns. Honest and complete, but it is the exact clutter the simplifying pass and this feature both cut, and the capacity bar then sums neither column cleanly, since it sums actual where present and estimated where not.
- Keep one duration and add a variance marker beside it, so the row shows the effective duration plus a quiet signal that the task ran over or under its estimate. Keeps the bar explainable and one column, and carries the attainment reading that matters.
- Leave it to the stats. Per-task attainment rolls into the per-category quota rows anyway, so the row stays quiet and the question is answered one level up.

The middle route looks strongest, because it keeps the property the first reason depends on while restoring what the second reason wrongly dismissed. It should still be designed rather than assumed.

**A fourth thing to consider alongside them, and the one the user was reaching for.** An estimated-against-actual statistic, per category and per period, sitting beside the availability quota in `PLAN-23`. It answers "am I faster or slower than my quota says I should be", which is a different and more actionable question than "what does the review show", and it is the CAT-style throughput reading this project deliberately set aside as the headline. Both inputs are already stored, so it costs an aggregation rather than a schema change. If that stat exists, the case for putting the pair back on every row weakens considerably, because the question it answers is a period question rather than a row question.

### The edge loses to a coloured name

Decided 2026-07-29, by the owner, looking at the seeded week on screen rather than at a mockup. "dont like color chips. restore category column theres enough space left", then "remove color chip. show colored category names instead".

**Implemented by `PLAN-32c`**, specced in [category-column-coloured-names.md](category-column-coloured-names.md) and designed in [category-column-coloured-names-design.md](category-column-coloured-names-design.md).

The shipped row carries its category as a coloured left edge and prints no category word. That was `extend-tasks.md`'s call, on the reasoning that a colour reads faster than a word and costs no width. Seeing it with real data reversed it. The edge is out, the category column is back, and **the name itself is coloured**.

That second message matters as much as the first, because it resolves what would otherwise have been a conflict with the user. The user asked for colour on every category, from the app the user uses today, and a bare text column would have quietly dropped it. Colouring the name keeps the user's association between a colour and a kind of work while removing the chip the owner objected to. Nobody's decision gets overridden here, so do not later "restore" the edge on the user's behalf.

**The width argument did not survive contact with the screen.** The edge existed partly because a category column was thought too expensive. With five columns rendered there is visible room left, so the premise was wrong rather than the tradeoff being close.

**A colour that was decorative is now load-bearing, and that is the real work.** A 3 px edge only had to be distinguishable. A coloured word has to be readable, so every category colour now faces a WCAG 2.2 AA contrast floor against the row background, in both modes. Three consequences follow, and none of them are reasons to reopen the decision.

- **Proofreading's pale grey is the first casualty.** Grey text on a near-white row is the classic contrast failure, and "pale" was chosen when it only had to tint an edge. **Neither of the two ways out worked.** A grey dark enough to pass reads as the row's own muted text, so the colour was substituted instead and `Relecture` ships as a slate blue at hue 230. That override and its measured reason are under [the original category colours](#the-original-category-colours-implemented-in-plan-32c).
- **Fixed lightness was tuned for edges and had to be retuned for text.** The one-number-per-category rule survived and it needed no per-category exception. Light moved from 0.55 to 0.47. **Dark did not move**, contrary to the expectation that the two modes would pull in opposite directions; at 0.74 it was already clearing 6.08:1 at its worst, so only its chroma dropped, from 0.14 to 0.13, and only to keep navy inside sRGB.
- **The collision with status hues got worse, not better.** The old defence was that a category is a coloured edge while a status is a word, so shape told them apart. Both are coloured words now and that defence is gone. The answer is position plus weight, category at track 2 in `font-normal` and status at track 7 in `font-semibold`, **plus one hue move on the status side.** Hue separation was measured as unavailable _among the user's colours_, which is what let them ship verbatim, but `success` is a reserved role rather than the user's, so when rendered pixels showed it sitting closer to `revision_internal` than the two revision siblings sat to each other, it moved to emerald. The user's hues did not. All three defences are kept deliberately, because they fail differently.

### The original category colours, implemented in PLAN-32c

Given 2026-07-29, from the app the user uses today. **Implemented by `PLAN-32c`**, specced in [category-column-coloured-names.md](category-column-coloured-names.md) and designed in [category-column-coloured-names-design.md](category-column-coloured-names-design.md). The user's hues ship verbatim wherever they named one, with a single exception recorded under the table. The invented palette that shipped in `PLAN-02` is gone.

| Category           | The user's colour    | Shipped hue | Note                                                          |
| ------------------ | ------------- | ----------- | ------------------------------------------------------------- |
| Translation        | cyan          | 195         | The user's, kept                                                    |
| Revision, internal | apple green   | 140         | The user's, kept. The user gave one green for both                       |
| Revision, external | apple green   | 115         | Derived sibling, 25 degrees off internal, the closest pair    |
| Proofreading       | pale gray     | 230         | **Overridden.** Slate blue rather than the user's grey, reason below |
| Terminology        | wine red      | 20          | The user's, kept                                                    |
| Meetings           | pink          | 340         | The user's, kept                                                    |
| Breaks             | navy          | 265         | The user's, kept                                                    |
| Administration     | not specified | 305         | Chosen, violet. The user named no colour for it                    |
| DTP                | not specified | 60          | Chosen, ochre. The user named no colour for it                     |

**Proofreading does not ship the user's pale grey, and this is an override of a colour the user gave rather than a gap they left.** `Relecture` prints at hue 230, a slate blue. The reason is measured. A grey dark enough to clear the 4.5:1 text floor lands at `L 0.47`, and all five themes put their light `text-muted` in the `L 0.47` to `L 0.53` band, so a chroma-zero category name would sit inside the tone the row already uses for its own dimmed text. `Relecture` would read as the one row whose colour failed to load rather than as one of the user's nine colours. The obvious compromise, a very low chroma slate, is worse rather than better, because encre's `neutral-500` is itself a blue-grey at `L 0.52 C 0.046 H 259`, so a slate at the same lightness and chroma near the same hue reproduces exactly the failure it was meant to avoid. Hue 230 is the centre of the widest empty arc in the user's own palette, so the substitution costs the least separation from everything else the user named. Approved by the owner, who will tell the user it changed and why. It stays the user's to overrule.

Two decisions the user made alongside them, both of which held.

**Every category takes a colour, including the non-trackable ones.** This amends `AC18` of [extend-tasks.md](extend-tasks.md) and retired the `edgeSlot: null` the non-trackable defaults carried. The shipped reasoning was that translation against revision is the only distinction worth colour and that a non-trackable row already prints its category as its own name. The user's original app coloured everything and they want that, so the reasoning loses. All nine now print a coloured name, and `PLAN-32c` removed the category fallback that made a non-trackable row's name its category word.

**Lightness stays fixed for every category, and measurement confirmed it.** The user chose the simple rule over literal fidelity, so navy renders as a medium blue and wine red as a medium red. One number per mode carries all nine with **zero per-category exceptions**, at `L 0.47 C 0.11` in light and `L 0.74 C 0.13` in dark, and the worst of the 180 measured readings is 5.07:1 against a 4.5:1 floor. The rule survives in a stronger form than it had: every hue from 0 to 359 clears the floor at those values, so a category `PLAN-30` has not created yet inherits its contrast for free from a full hue wheel rather than from a ring of pre-approved slots.

Four problems the implementing feature had to solve, with what `PLAN-32c` measured against each. None were reasons to change the decision, they were the work.

- **The palette was crowded past what fixed lightness looked able to carry, and it carried it.** Nine categories need distinct colours, four status hues are reserved, one category was grey rather than a hue, and revision needs two greens that read as related but distinct. The prediction here was that revision's two members would be the honest case for a lightness or chroma exception. **Measured, they are not.** The pair is answered by hue direction instead: `revision_external` sits at 115 rather than at 165, which leaves the arc between apple green and cyan empty and makes the pair the only one in the palette inside 35 degrees, so proximity itself is what says the two are the same work on different people's text. Fixed lightness survives with no exception for anything. The grey problem was answered by changing the colour, in the bullet below.

- **Wine red and pink are adjacent hues, and the user's original told them apart by lightness.** Fixed lightness drops exactly that difference, so 20 and 340 sit 40 degrees apart at identical lightness. Pink is at 340 rather than 350 to buy what spacing there is. This was the other predicted case for a per-category lightness exception and **it did not need one either.** 40 degrees is joint second-widest in the shipped set, and the pair's Oklab separation measures 0.075 against the revision pair's 0.047, so hue spacing alone carries it.
- **Pale gray is not a hue, and the requirement to make the contract express it is void.** `categoryEdgeHue` returned a hue angle and grey means chroma 0, so a chroma-zero slot looked like something the contract would have to grow. **The problem was real and the resolution was that the colour changed rather than the contract.** Proofreading ships as a real hue at the shared chroma, so no member of the palette is a neutral, the contract stays one hue per category, and `main.css` keeps its one fixed lightness and one fixed chroma per mode. **`PLAN-30` does not inherit any requirement to support chroma zero**, and it should not be given one, because that shape is what lets a user-created category inherit its contrast from a single number.
- **The user's hues collide with the reserved status hues, and there is no chromatic way out on the user's side.** Apple green 140 sits beside success 148, wine red 20 beside error 27, navy 265 beside info 258 (0.6 degrees apart as rendered), and DTP's ochre 60 near warning 78. Nine categories plus four status roles do not fit one circle at one lightness, and `PLAN-32c` declined to move any category hue, which is what let the user's hues stay verbatim. **The separation is position plus weight, and one reserved hue moved.** Rendered pixels showed success green closer to `revision_internal` (Oklab 0.0336) than the two revision siblings were to each other (0.0461), collapsing to 0.0201 under protanopia, so `success` became emerald. That is the status role moving, never a category, and only `revision_internal` against `success` was ever reachable in one row, because `breaks` and `terminology` are non-trackable and always render `N/A` rather than a coloured status. The category is track 2 and the status is track 7, about 640 px apart at 1280 px and never adjacent at any width, and the category prints `font-normal` against the status badge's `font-semibold`, so the two coloured words differ in weight before they differ in hue. The 3 px edge that used to be half this answer is gone. Still worth watching on screen, because it is the one place this palette could actively mislead.

**The 450 default is wrong and has to change.** `settings.quota_wph` defaults to 450 and the research note below justifies that number from published norms of 400 to 600 words per hour. The configured translation quota is 240, well under the published range, so the note is now misleading rather than supporting. Published norms measure throughput while working; this quota divides by scheduled availability, which is a different and larger denominator, and that is most of the gap. Keep the research as context for what the CAT tools report and stop treating it as evidence for the default. Once quota is a per-category setting, the global default retires with it.

**Superseded on 2026-07-29. The names are settled and were confirmed with the user, so this paragraph is kept as the research that led there rather than as a live warning.** `Relecture`, `Révision interne`, `Révision externe` and `Mise en page` are confirmed, and the set shipped in `PLAN-32a`. The rule it states still holds for any name added later, which is that a term is asked rather than guessed.

The research below is why the question was worth asking. These are the terms in actual use, and the Canadian industry draws real distinctions here. Bilingual revision checks a translation against its source, unilingual revision works on the target alone, and proofreading is the final accuracy pass, and the three are separate billable services rather than loose synonyms ([oxo innovation](https://oxoinnovation.com/fr/blog/la-difference-entre-la-revision-bilingue-la-revision-unilingue-et-la-correction-depreuves/), [ITC Traductions Canada](https://www.itctraductionscanada.ca/service-relecture-revision/), [HEC Montréal](https://www.hec.ca/biblio/services/traduction-revision.html)). Whether the split runs internal against external, or bilingual against unilingual, was the open question. It is internal against external, by who wrote the text being revised.

There is also no industry benchmark to fall back on for the defaults. Translation measures around 500 words per hour with a wide spread, but revision speed has largely been overlooked, published figures range from under 200 to over 2000 words per hour, and practitioners openly dispute them. So every default quota comes from the user's actual numbers, never from a researched average.

**Resolved on 2026-07-29 by [the quota is buckets](#the-quota-is-buckets-one-per-category-measured-against-time-spent), which chose the second of the three below.** The paragraph is kept because the reasoning is still what rules the other two out.

**The open problem was what a per-category quota does to the availability metric.** The denominator is one pool of scheduled time minus non-trackable time, and idle time sits in that pool without belonging to any category. So the availability quota cannot simply be computed four times. Three ways out, listed in the order they were preferred at the time.

- **Normalised attainment.** Give each trackable task an expected duration from its own category quota, sum the expected minutes across every trackable task whatever its category, and compare that total to the available minutes. One number, comparable across any mix of work, and it reduces to today's raw words-per-hour when every category shares a quota. Per-category words per hour then becomes a breakdown beneath the headline rather than the headline itself.
- **Per-category throughput.** Report words over the time actually spent in that category. This is a real and useful number, but it is the CAT-tool metric this project deliberately moved away from, and it answers a different question than the review asks.
- **Splitting the available pool between categories.** Rejected. Any rule for attributing idle time to one category over another would be invented rather than measured.

Confirm whether the targets are genuinely reported per kind of work, or whether one availability number covers everything and the split is only for personal insight. The answer decides whether attainment is the headline or a convenience.

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

1. Resolved, then replaced. The availability quota locked above divided words by scheduled hours minus non-trackable time. That is no longer the shape. Targets are set per kind of work, so the quota is buckets, one per category, each measured against the time spent in it (see [the quota is buckets](#the-quota-is-buckets-one-per-category-measured-against-time-spent)). The category list and its defaults are confirmed, and unaccounted day time is a derived bucket rather than a shared pool, so nothing here is still open.
2. Resolved. A multi-day task is per-day slices created by the split action. Day, week, and month are viewing granularities, every slice sits on one date.
3. Resolved. Overtime and non-work-day work are a boost. Words raise the numerator over the fixed scheduled denominator, so the quota rises. A non-work day has no standalone day quota but lifts the week, month, and year.
4. Resolved and shipped. The six defaults from `PLAN-02` were replaced by the nine in `PLAN-32a`, with `translation`, `revision_internal`, `revision_external`, and `proofreading` trackable and the other five not. The list and the FR copy are confirmed. The per-category quotas are confirmed too and are the one part still unbuilt, waiting on `PLAN-32b`.
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

As of 2026-07-29, the read-only week is shipped through `PLAN-08` plus two refinement passes, and `PLAN-32a` and `PLAN-32c` have landed. Everything below is recorded in [Locked decisions](#locked-decisions) and **not built**.

**The write path is next, decided by the owner on 2026-07-29.** "i think first we need expanding tasks with all the fields, and crud operations. timer is a luxury feature that adds to manual time tracking." So `PLAN-09`, `PLAN-10`, and `PLAN-11` come before the remaining contract work, and the timer sits at the end.

**`PLAN-32` was three features, not one.** Split on 2026-07-29, because it bundled a contract change, a settings retirement, and a palette design pass, and those are separable, separately testable, and reach different parts of the app. `32a` (the nine categories) and `32c` (the coloured category column) have shipped. `32b` is the one still outstanding.

| Order | Feature                           | Why now                                                                       |
| ----- | --------------------------------- | ----------------------------------------------------------------------------- |
| 1     | `PLAN-09` / `PLAN-10` / `PLAN-11` | The write path and the full field editor. The app cannot record anything yet  |
| 2     | `PLAN-33` — Row simplification    | Small, and it removes a field, so it is cheaper before the editor than after  |
| 3     | `PLAN-32b` — Per-category quotas  | Blocks `PLAN-22` and `PLAN-23`, and retires a wrong shipped default           |
| 4     | `PLAN-22` / `PLAN-23` — The stats | The quota engine and the stats bar, which is what the numbers were all for    |
| 5     | `PLAN-34` — The timer             | Writes to a task, so it needs the write path. A luxury on top of manual entry |

**One cost of putting the write path first, stated rather than hidden.** `PLAN-33` and `PLAN-32b` each remove a field, `words_done` and `settings.quota_wph`, and the editor in `PLAN-11` renders whatever the schema holds. Building the editor before those two means touching it again afterwards. There is a second, sharper version of the same point: `PLAN-32a` verified that no user history exists, which is what made its category change free, and that finding stops being true the moment `PLAN-09` ships. After that, `PLAN-33`'s migration is dropping a column from a table with real rows in it rather than from one only the seed has ever written. Neither is a reason to reorder, and both get cheaper if `PLAN-33` slots in first, since it only takes a field away. That is a recommendation rather than a dependency.

`PLAN-11` inherits a settled field list from [extend-tasks.md](extend-tasks.md), so it does not need to re-decide what the editor holds, and it should read [estimated plans the day](#estimated-plans-the-day-actual-measures-it-and-the-ratio-is-the-attainment) before it renders the two durations.

**The copy is confirmed, so no feature below has to guess at a name.** Checked with the user on 2026-07-29. `Relecture` for proofreading, and `Révision interne` / `Révision externe` for the pair, all three exactly as proposed. `Relecture` was confirmed over the stricter `Correction d'épreuves`, which is the term the Canadian industry uses for proofreading as a separate billable service, so the shorter word is a deliberate choice rather than an oversight and should not be "corrected" later. The internal-against-external naming was confirmed over an `employé` / `pigiste` pair that would have said whose work it is more literally. One English name changed in the same pass: `Layout` became `DTP` and the id became `dtp`, because `Layout` was generic. That closes the old `AC2` and the "must not be guessed" warning in [the original category colours](#the-original-category-colours-implemented-in-plan-32c).

**PLAN-32a — The nine default categories**
Depends on `PLAN-02`. Amends it. Shared contract, i18n, and the dev seed. No migration is needed, because the seed carries the id change. `tasks.category` is free text with no CHECK, enum, or index, so the nine ids are already storable, and the only `revision` rows in existence came from the dev seed this feature rewrites. The reasoning is in [`AC3` of the spec](nine-task-categories.md), and the rule it follows is now written down in the backend conventions skill.

**`AC3`'s no-history finding expired on 2026-07-29, when `PLAN-09` shipped.** It held only while no task write path existed, and the write API is that path, so the re-check it names has fallen due rather than sitting in the future. Every feature that touches `tasks` from here counts the rows the seed did not write, against production, rather than reusing the finding below. The evidence carries its own expiry note in [nine-task-categories.md](nine-task-categories.md) and the reasoning is in [task-write-api.md](task-write-api.md). The bullets are kept as written, because they record what was true and how it was checked at the time.

- Replaces the six shipped categories with the nine in [the category set](#the-category-set-and-the-real-quotas-from-the-primary-user). `proofreading` and `dtp` are new, `revision` is replaced by `revision_internal` and `revision_external`.
- Carries the ids, the `trackable` flags, and the FR / EN copy only. The quota field is `32b` and the colours are `32c`, so this feature changes the set without changing what a category holds beyond its name.
- AC1. The nine defaults are present with the correct trackable flags, `translation`, `revision_internal`, `revision_external`, and `proofreading` trackable and the other five not. AC2. The FR and EN strings are the confirmed ones above, in i18n keyed by id rather than in the contract. AC3. Existing `revision` rows are handled, and the claim that no user history exists is verified rather than inherited from this document. The check is done and the finding is recorded in the spec's `AC3`, which is that no write path has ever existed and every `revision` row in the dev database came from one seed pass. The finding stops being true once `PLAN-09` ships, so a later feature has to re-check rather than reuse it. AC4. `coerceCategory` validates the nine and still falls back to `admin`, so a stored `revision` resolves to a non-trackable id rather than reaching the UI raw. AC5. The dev seed is rewritten to the new ids.

**PLAN-32b — Per-category quotas, and retiring the global one**
Depends on `PLAN-32a`. Shared, backend, a migration, and the settings and onboarding UI. The migration is real here where `32a` has none, because `32b` drops the `settings.quota_wph` column, which is a structural change, while `32a` only changed stored values the seed owns.

- A trackable category carries its own quota, so `settings.quota_wph` retires as a global. See [one quota per category](#one-quota-per-category-not-one-quota-for-everything).
- The four defaults are translation 240, internal revision 1000, external revision 1300, proofreading 2000. Note that external is the faster number; [the category set](#the-category-set-and-the-real-quotas-from-the-primary-user) explains why that is not a transposition.
- The shipped 450 default is wrong and goes with the global setting. `quota_wph_override` on a task stays as the per-task exception.
- AC1. Each trackable category resolves its own quota and each non-trackable one has none. AC2. The quota is effective-dated, so editing it never restates a past period (`PLAN-30` AC6 covers the same ground for user-created categories). AC3. `settings.quota_wph` is gone from the schema, onboarding, the settings page, and `work-settings`, with no reader left behind. AC4. The research note that justified 450 is demoted to context rather than left reading as evidence.
- Settled before this feature rather than inside it. A per-category quota is measured against the time spent in that category, per [the quota is buckets](#the-quota-is-buckets-one-per-category-measured-against-time-spent), so there is no shared pool left to divide and nothing here is left open.

**PLAN-32c — The category column, with coloured names**
Depends on `PLAN-32a`. Design pass, then shared and frontend.

**Rewritten 2026-07-29 after the owner saw the seeded week on screen.** It was "the nine-edge palette", carrying every category as a coloured left edge. See [the edge loses to a coloured name](#the-edge-loses-to-a-coloured-name).

- The coloured row edge goes. The category returns as its own column, printing its name, and **the name is coloured with the category's colour**. So the colour association survives and the chip does not.
- This reverses the edge decision in [extend-tasks.md](extend-tasks.md), which removed the category as a printed word and moved it to the row edge. `AC18`'s neutral non-trackable rule goes with it, since all nine now print a coloured name.
- The palette work does not go away, it gets harder. The user's original colours and the problems they already had are in [the original category colours](#the-original-category-colours-implemented-in-plan-32c), and colouring text rather than a 3 px edge adds a contrast floor on top. See the decision section for why that is the real work here.
- AC1. The category column is back, showing every row's category as a name, and no row draws a coloured edge. AC2. Each name is coloured from the one shared category-to-colour mapping, never a second copy. AC3. Every name meets WCAG 2.2 AA contrast against its row background in both light and dark mode, measured rather than eyeballed, which is a stricter bar than an edge had to clear. AC4. Proofreading's pale grey either passes as text or is documented as the exception it has to become. AC5. The two revision greens read as related but distinct. AC6. No category name is mistakable for a status word, which now matters more because status is also coloured text in a neighbouring column. AC7. The non-trackable rows stop printing their category as the task name, since the column would otherwise say it twice.

**PLAN-33 — Row simplification: words total and the progress signal**
Depends on `PLAN-32`. Frontend, plus a design pass.

**The `PLAN-32a` no-history finding expired when `PLAN-09` shipped on 2026-07-29, so this migration is not the free one `32a` got.** That finding said no real user task history existed, and it rested on there being no task write path. `PLAN-09` is that write path, so from the day it shipped the `tasks` table holds rows the user created. Dropping `words_done` is now a migration against a table with real user rows in it rather than against one only the seed has ever written. Re-run the row check rather than inheriting it from this document or from [nine-task-categories.md](nine-task-categories.md), and run it against production rather than against a fresh dev database, since a dev database can be seed-only while production is not. The reasoning is in [task-write-api.md](task-write-api.md).

- `Mots` shows the project total alone rather than a done-over-total pair, per [words are a total](#words-are-a-total-not-a-progress-pair-deferred-to-a-later-feature). Amends `AC20` of `extend-tasks.md`.
- **Scope settled 2026-07-29, and it grew.** The owner's instruction was "enlève le restant `-- /` de la colonne mots. seulement le total, pas de `-- /`", then "only keep total words in this column. remove the rest. clean the db. create the proper migration apply it too". So this is no longer a display change. `words_done` leaves the schema, with a real migration that is written and applied, and the column stops existing rather than being hidden.
- **Do not include the progress signal.** The owner asked for the pair removed and nothing more, so the row goes quiet on performance until he decides. The four routes stay recorded in [the duration pair is the progress signal](#the-duration-pair-is-the-progress-signal-and-that-reopens-a-shipped-decision) for whoever picks that up, and the variance marker is still the favourite. Judging the simpler row first is the point.
- AC1. The words field is one figure, the row's own total. AC2. `words_done` is gone from the schema, the model, the list handler, `shared/planning.ts`, the row, and the seed, with no reader left behind. AC3. The migration is written, idempotent, and applied against the dev database. AC4. Whatever signals over or under, it adds no coloured element per row, per the simplifying pass.

**The quota numerator changes shape, and this is the part to get right.** The old rule summed `words_done` precisely so a multi-day job could not count its whole total on every day it touched, and [schema.ts](../../../server/db/schema.ts) says so in a comment. Dropping the column removes that protection, so it has to be replaced rather than lost.

**Decided 2026-07-29: work spanning several days is several rows, each carrying the words actually done that day as its own total.** The quota then sums row totals and every day is honest, with no done-against-total pair anywhere. This is what `PLAN-18` splitting already existed for, so it is a use of the existing model rather than a new mechanism.

The owner's reason for refusing the pair is worth keeping verbatim, because it is a reliability argument rather than a simplicity one. "on ne track pas le nb de mots vs le total. seulement le total. sinon on n'aura jamais des stats fiables. l'utilisateur ne perdra pas son temps à entrer chaque tâche manuellement." A figure the user will not reliably enter produces worse statistics than no figure at all, so the fix is to stop asking for it rather than to keep a field that fills with guesses.

Two things for the implementing feature to settle rather than assume. **`project_word_count` is now a misleading name**, since each row carries its own slice total rather than the whole project's, so decide whether the surviving column is renamed in the same migration or left alone with a comment, and say which and why. And **check what happens to a task that is not split**, since for a single-day job the row total and the project total are the same number and nothing is lost, which is the common case and should stay the simple one.

**PLAN-34 — The task timer and the navbar timer**
Depends on `PLAN-09`, because it writes to a task. Backend, shared, and frontend. The rules and the reasoning are in [a running timer](#a-running-timer-clickups-shape-minimal), and this section is only the scope.

**Last in the order, and deliberately.** The owner's words are "timer is a luxury feature that adds to manual time tracking", so manual entry ships first and stays the fallback. Verification is by hand rather than by an acceptance suite, also the owner's call. "we test it manually once we implement it."

- A start and stop control on the task row. Stopping adds the elapsed minutes to that task's `actual_minutes`.
- A timer in the navbar, on every page, showing the running task and the live elapsed with a stop control. Hidden when nothing is running.
- AC1. Starting records the start instant server-side and the elapsed derives from it, never counted in the browser.
- AC2. Starting a timer on a second task stops the first and banks its time, so only one runs per user.
- AC3. Stopping adds to `actual_minutes` rather than replacing it, so three cycles on one task sum.
- AC4. A running timer survives a reload, a closed tab, and a day boundary, and still reports as running with the elapsed measured from its original start.
- AC5. The navbar timer and the row agree on the running task and the elapsed, on every page.
- AC6. Typing a duration by hand still overrides, and stays the recovery path for a timer left running.
- AC7. The ticking display is corrected for client clock skew, so what the user watches matches what gets recorded.
- AC8. A non-trackable task can be timed, since a meeting's duration comes out of effective hours.

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

**`AC1`'s status code is superseded on 2026-07-29 by [task-write-api.md](task-write-api.md), which returns 404 and not 403.** The guarantee is unchanged, and a user still cannot mutate another user's task. Only the reported status differs. A 403 on someone else's task id confirms that the id exists, so a 404 for the missing case and the not-yours case alike leaks nothing and meets the same guarantee more safely. The shipped behaviour is 404, so do not implement the 403 the bullet below still names.

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

- The old app stored data as CSV files and the user has real daily data in that format, so import must read the old CSV layout to bring the user's history over. Export produces a portable dated backup file.
- AC1. Importing an old CSV loads the existing tasks with words, durations, status, and category mapped correctly, tolerating the old French date and column headers.
- AC2. Export downloads a dated file with all tasks.
- AC3. Import shows a preview of what will be added before it commits, so a bad file cannot silently wipe or duplicate the user's data (safe recovery, no invalid states).

---

## Research notes

Grounding for the decisions above. Full sources at the end.

- **CAT tools measure throughput, not availability.** memoQ's editing time report divides source words by the _actual editing time_ recorded per segment, grouped by match rate. Trados reports word counts and analysis but leans on translation-memory leverage rather than a clock-time quota. Both answer "how fast while working", which is a different question from "words per paid hour". This is why our headline quota divides by scheduled hours, and why the CAT number would look higher.
- **Industry norms.** A professional translator produces roughly 400 to 600 finished words per hour and about 2000 to 3000 words per day, and many full-time translators work only 5 to 6 effective hours a day because the work is mentally taxing. **This no longer supports the 450 default, and the claim that it did was wrong.** The configured translation quota is 240 (see [the category set and the real quotas](#the-category-set-and-the-real-quotas-from-the-primary-user)), well under the published range. The numbers are not comparable: published norms measure throughput while working, and this quota divides by scheduled availability, which is a larger denominator, so the same translator scores lower here by construction. Read this as context for what a CAT tool would report, never as evidence for a default. It does still support the rest, that effective hours are fewer than clock hours and that the buffer earns its place.
- **View design.** Agenda-style vertical lists let users find the next item faster and hold temporal context better than time grids, with much less visual noise, though a grid is better for seeing free space. Best practice is to offer day, week, and month and let the user switch. Sunsama is the reference for a calm, low-overwhelm daily planner. This backs the calm-day-list default with view toggles.
- **Category charts.** Toggl and Clockify both present time-by-category as pie and bar charts in daily and weekly reports, which is the model for `PLAN-31`.

Sources: [memoQ editing time report](https://docs.memoq.com/current/en/Workspace/create-editing-time-report.html), [memoQ time tracking blog](https://blog.memoq.com/time-tracking-and-editing-distance-reporting), [Trados Studio](https://www.trados.com/product/studio/), [translator output norms (getblend)](https://www.getblend.com/blog/output-words-per-day/), [expected translation times (pactranz)](https://www.pactranz.com/translation-times/), [calendar layout types (hora)](https://horacal.app/blog/2026-06-05-types-of-calendar-layouts/), [Sunsama review (Efficient App)](https://efficient.app/apps/sunsama), [Clockify vs Toggl reporting](https://toggl.com/blog/clockify-vs-toggl).

---

## How this feeds the pipeline

One feature at a time, in phase order, each through the full pipeline from `specs` to `commit`, with an entry added to [`docs/pipeline-trace.md`](../../pipeline-trace.md) and the trail in [`docs/pipeline.md`](../../pipeline.md) as it lands. Before Phase 0 starts, the row layout and compact field set are settled on a mockup.
