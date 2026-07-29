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

**The default set is seven.** Translation, revision, proofreading, terminology, meetings, breaks, administration. She can add more on top, which is `PLAN-30`.

| Category           | Trackable | Quota (words per hour) |
| ------------------ | --------- | ---------------------- |
| Translation        | yes       | 240                    |
| Revision, internal | yes       | 1000                   |
| Revision, external | yes       | 1300                   |
| Proofreading       | yes       | 2000                   |
| Terminology        | no        | none                   |
| Meetings           | no        | none                   |
| Breaks             | no        | none                   |
| Administration     | no        | none                   |
| DTP                | no        | none, see below        |

**Proofreading is new.** The six defaults that shipped in `PLAN-02` do not include it, so the contract grows by one trackable category.

**Revision is two categories, not one.** Her list names a single `revision` but her quotas give internal 1000 and external 1300, and two rates cannot share one category. Confirm the exact names with her before `PLAN-02` is amended.

**DTP is desktop publishing**, the layout pass after translation that makes the translated text fit the original design, which is the PowerPoint work she described. The industry bills it per page or per hour and never per word, so it produces no words and is non-trackable here: its time comes out of effective hours exactly as a meeting's does. Whether it joins the defaults or she adds it herself is open.

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

### Phase 0 — Data foundation

**PLAN-01 — Tasks schema and migration**
Depends on nothing. Backend only.

- New `tasks` table keyed to `users.id`, with `date`, `client`, `project`, `category`, `delivery_date`, `delivery_time`, `project_word_count`, `words_done`, `quota_wph_override` (nullable), `estimated_minutes`, `actual_minutes`, `status`, `exclude_from_stats`, a `split_group_id`, a `sort_order`, and timestamps. The live column list is in [tasks-schema.md](tasks-schema.md). `instructions` shipped here and was dropped again in migration `0007`, and recurrence columns were never added, since `PLAN-19` owns that model.
- AC1. `bunx drizzle-kit push` applies cleanly and the columns exist with the right types.
- AC2. A foreign key ties every task to a user, and an index covers `(user_id, date)`.
- AC3. Deleting a user cascades or is handled deliberately (decide in the spec).

**PLAN-02 — Task categories contract**
Depends on nothing. Shared contract.

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
