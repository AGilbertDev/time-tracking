# The inline task editor

`PLAN-10` plus `PLAN-11`, and the words column the row simplification left behind. Depends on
`PLAN-09` ([task-write-api.md](task-write-api.md)) and on the shipped week
([week-with-task-rows.md](week-with-task-rows.md), [extend-tasks.md](extend-tasks.md)). Backend,
frontend, two migrations, a shared contract change, and new copy.

## Intent

The planning week can be read and cannot be written. `PLAN-09` shipped the endpoints, and nothing in
the interface calls them, so the only way a task has ever entered the database is the dev seed. This
feature is the write path in the interface, and it is one feature rather than three because the three
pieces are the same piece of work seen from different sides.

The day card expands to show task rows. That row is minimal on purpose, in the owner's words because
it "minimizes mental clutter" and "needs to show minimal relevant info at a glance". Clicking a row
opens an inline form beneath it with a save button, and saving collapses it back to the minimal row.
The same form creates a task, reached from an `Ajouter une tâche` control at the foot of each day, so
adding and editing are one mechanism. The project manager field is not in the product and is not
built. Consignes is not in the product either, and a Notes field takes its place on a new column,
because the `instructions` column that used to back Consignes was dropped in migration `0007`.

The words column comes with it. The row prints a done-over-total pair today and the owner asked for the
total alone, which means the column behind the first half of that pair leaves the schema.
`overview.md` records the cost of building the editor before that field is removed, which is that the
editor renders whatever the schema holds and would need touching again afterwards. Doing both in one
pass is the cheaper order, and it is also what keeps the drop and the code that stops reading the
column in one change, since the read projection selects `words_done` today and the planning week stops
loading the moment it is dropped without a matching deploy.

## Which passages here are historical

Two things happened while this feature was being built. [other-category.md](other-category.md) superseded
parts of it, ruled by the owner on 2026-07-31, and several passages were corrected as the run went on.
**Every affected passage keeps its original text with a note attached**, because the project's practice is
that the record shows a decision changing rather than pretending it was always the new way, and some of
the retired reasoning is good reasoning that simply stopped applying. No acceptance criterion is
renumbered, since other stages build against these numbers.

The two indexes below are a pointer per passage and nothing more, and they are **exhaustive over the
passages a reader could otherwise act on as though they were current**, because an incomplete index is
read as complete and is therefore worse than none. That is the scope, stated so the claim is checkable.
Content this feature simply added, such as `AC66` and the purge criteria, is current and is not listed.
The reasoning lives in the notes themselves rather than here.

**Superseded by [other-category.md](other-category.md)**, which added a tenth category and split one
per-category flag into two.

| Passage here                                              | Live answer               |
| --------------------------------------------------------- | ------------------------- |
| "The shared contracts" input, item 5, nine ids            | `other-category.md` `UC1` |
| The words cell table's not-trackable row                  | `UC14`                    |
| `AC3`'s non-trackable sentence                            | `UC14`                    |
| The field table's row 1, `Catégorie`                      | `UC20`, `UC25`, `UC17`    |
| The field table's row 10, `Statut`                        | `UC8`, `UC26`             |
| "The category selector is coloured", extended not retired | `UC17`, `UC42`, `UC25`    |
| `AC22`, the category selector's options                   | `UC17`, `UC42`            |
| "Statut on a non-trackable category"                      | `UC8`, `UC12`, `UC38`     |
| `AC23`                                                    | `UC12`, `UC26`, `UC40`    |
| The refresh paragraph's list of server-resolved fields    | `UC11`                    |
| `AC40`'s worked example of a retired id                   | `UC4`, `UC10`             |
| "The user must supply a category, and nothing else"       | `UC20`                    |
| "The category has no preselected value"                   | `UC25`                    |
| "The client validates two things and no more"             | `UC27`                    |
| `AC45`                                                    | `UC45`                    |
| `AC46`'s enumeration, not its prohibition                 | `UC8`                     |
| The copy table's `categoryPlaceholder` row                | `UC25`, `UC27`            |
| The validation table's `categoryRequired` row             | `UC27`                    |
| The validation table's `statusNotTrackable` row, renamed  | `other-category.md` copy  |
| `AC56`, read against those two removals                   | `UC27`                    |
| The edge case reading `na` onto every non-trackable row   | `UC10`                    |

**Corrected during this feature's own run**, as the database was repaired, symbols were hoisted, and
stages found better answers than the spec first gave. These are not supersessions by another document.

| Passage here                                             | What changed                                              |
| -------------------------------------------------------- | --------------------------------------------------------- |
| Intent, third paragraph                                  | The week loads today, so the old dev-state premise is out |
| "The verified state of the database", items 2, 3, and 4  | The repaired ledger and the restored column               |
| "The two migrations", formerly a load-bearing filename   | Both files are ordinary and both really run               |
| `AC6`'s closing sentence, not its file list              | Executable lines only, guards and comments allowed        |
| `AC7`                                                    | Checked against the migrated schema                       |
| `AC17`, `AC18`, `AC19`                                   | Corrected to the repaired ledger's arithmetic             |
| The `words_done` section preamble                        | The code and the migration land together                  |
| The notes bound's names, `FREE_TEXT_MAX` and `NOTES_MAX` | `TASK_TEXT_MAX` and `TASK_NOTES_MAX` in `shared/`         |
| The note marker, a word                                  | A glyph, and `planning.note` was never added              |
| The field table's four numeric widgets                   | All four are `UInputNumber`                               |
| `AC43`                                                   | The live region lives on the page, not the panel          |
| `AC52`                                                   | Focus target must be present and not inside `inert`       |
| `AC62`, `AC63`                                           | Current module and symbol names, bound read not hardcoded |
| The erasure gap, formerly a follow-up                    | In scope, `AC67` through `AC70`                           |
| Stages, the frontend sequencing note                     | Rewritten to the real ordering constraint                 |
| Both places that quoted a suite total                    | No total, because the figure at the gate is the one       |

## Inputs

### The runtime inputs

The user's actions. Opening a day card, clicking a task row, pressing the add control, filling the
form, saving, cancelling, and pressing Escape. Every field of the form is a runtime input and the
field list is under [the editor's fields](#the-editors-fields).

### The design inputs

1. **The settled field list.** [extend-tasks.md](extend-tasks.md)'s "Handoff to `PLAN-11`, the
   expanded editor" hands over a complete field list so this feature inherits a contract instead of
   re-deciding one. It is inherited, with one member removed and one added, and the removal is argued
   under [Mots faits comes off the list](#mots-faits-comes-off-the-inherited-list).
2. **The write API.** [task-write-api.md](task-write-api.md) is the contract this form speaks. It
   decides what is required, what an absent field means against an explicit null, what a 404 means,
   and what the response carries back. The form adds no rule the API does not already enforce.
3. **The row and the day card as shipped.** `app/components/planning/TaskRow.vue`,
   `DayCard.vue`, `Week.vue`, and `StatusBadge.vue`, plus the layout decisions in
   [extend-tasks-design.md](extend-tasks-design.md).
4. **The reference app the owner uses every day.** Its row columns are Client, Numéro de projet,
   Livraison, Heure, Mots (total du projet), Durée estimée, Durée réelle, and Statut, with a drag
   handle, a duplicate control, and a delete control per row, and an `+ Ajouter une tâche` link at the
   foot of each day. The expanded form covers that field set minus the project manager and minus
   Consignes, plus Notes and plus the category. Where a cleaner idea and the reference app disagree,
   the reference app wins, because it is the workflow the owner depends on.
5. **The shared contracts.** `shared/categories.ts` for the nine ids, `categoryHue`,
   `coerceCategory`, and `isTrackableCategory`. `shared/planning.ts` for `PlanningTask`,
   `TASK_STATUSES`, `statusKey`, `effectiveDuration`, and `formatCount`.
   **Superseded in part.** There are ten ids, `other` tenth, and the contract exports a second
   per-category predicate beside `isTrackableCategory` for whether a category carries a status. See
   [other-category.md](other-category.md) `UC1` and `UC8`.
6. **The conventions.** `AGENTS.md` and `.recipes/CLAUDE.md`. Logic belongs to the backend, no
   invalid states and safe recovery, do not police the user, French first and researched.

### The verified state of the database and the migration runner

Checked in this container, and re-checked on 2026-07-31 after the owner repaired the development
database, with a positive control run first so a negative reading could not simply be a broken probe.
Everything here is a finding rather than an assumption. The one thing that could not be checked from
this container is labelled as such and is in [open questions](#open-questions), alongside a separate
claim about production that is verifiable from the code rather than from a database.

1. **The migration runner keys its ledger on the filename alone, with no checksum.**
   `scripts/apply-migrations.ts` creates `_applied_migrations (name text PRIMARY KEY, applied_at
integer NOT NULL)` and computes its work list as
   `const pending = files.filter((file) => !recorded.has(file))`. Nothing hashes or compares file
   contents, so a filename already in the ledger is skipped whatever the file now says, and a filename
   that is not in the ledger runs. That is a property to respect when renaming a migration, and it is
   not a mechanism this feature relies on. See [the two migrations](#the-two-migrations).
2. **The development ledger holds exactly eight rows, `0000` through `0007`.** The runner reports
   `8 migration files, 8 already recorded.` and `Nothing pending.`, so the ledger and
   `server/db/migrations/` agree. An abandoned earlier attempt had left a ninth row naming a `0008`
   file that did not exist; the owner removed it, and nothing here re-adds it or baselines anything.
3. **The development `tasks` table has nineteen columns and `words_done` is present.** `id`,
   `user_id`, `date`, `client`, `project`, `category`, `delivery_date`, `delivery_time`,
   `project_word_count`, `words_done`, `quota_wph_override`, `estimated_minutes`, `actual_minutes`,
   `status`, `split_group_id`, `sort_order`, `exclude_from_stats`, `created_at`, and `updated_at`. There
   is no `instructions` and no `notes`. So the database is in a true pre-`0008` state and both of this
   feature's migrations are genuinely pending.
4. **`main`'s read projection selects `words_done`.** `server/api/tasks/handlers/projection.ts` line 34
   is `wordsDone: tasks.wordsDone,`. That read works today and stops working the moment `0008` is
   applied, which is why the drop and the code change ship together and why
   [the deploy ordering](#the-two-migrations) is spelled out.
5. **The development database holds 112 task rows**, seeded across seven weeks.
6. **There are no production credentials in this container.** The migration runner's dry run prints
   the development host, `time-tracking-dev-agilbertdev.aws-us-east-1.turso.io`. So the production row
   count is unverified and stays unverified until the owner runs the check.

### The client data flow as it stands

`app/pages/index.vue` owns the fetching. Tasks come from `useAsyncData('planning-tasks', ...)` with
`watch: [weekRange]`, and it exposes `refresh` as `refreshTasks`. The rest of the app writes through
TanStack Query mutations, `app/composables/useUpdateProfileMutation.ts` being the model, with keys in
`app/queries/keys.ts`, which today holds only `me`. **A TanStack mutation invalidating a query key
would refresh nothing here**, because the planning week is not in the query cache. What this feature
does about that is under [how a saved row gets back into the
list](#saving-and-how-a-saved-row-gets-back-into-the-list).

## Scope

In scope. The words column becoming one figure. `words_done` leaving the schema, the contract, the
projection, the row, the seed, and the test scaffolding. A new `notes` column with its migration, its
validation, and its field. Two migrations. The inline editor, used for both create and edit. The
`Ajouter une tâche` control. An empty day becoming disclosable. Exclusivity, dirty tracking, focus
management, error recovery. All new copy in French and English. Annotations to `overview.md` where
this feature invalidates what it says. **Added to scope on 2026-07-31**, the account purge deleting
`tasks` and `work_schedule` explicitly, and the test scaffolding that makes a cascade regression
catchable, both under [the account purge](#the-account-purge-erases-tasks-explicitly). That defect is
pre-existing rather than caused here, and it is folded in because the `notes` column is what makes it
consequential.

Out of scope, each its own later pipeline run.

- **`PLAN-12`**, the `words / quota` derivation of the estimate. Argued under
  [the two durations stay plain inputs](#the-two-durations-stay-plain-inputs).
- **`PLAN-13`** delete, **`PLAN-17`** duplicate, and **`PLAN-15`** and **`PLAN-16`** drag. The
  reference app has all four and this feature ships none of them. **The owner ruled on 2026-07-31 that
  delete stays out and that `PLAN-13` runs immediately after this feature**, so the gap is recorded
  here rather than left to be discovered. The gap is that **a task created through this feature cannot
  be deleted from its row until `PLAN-13` lands**, and that the editor's day field is the only way to
  correct one that is on the wrong day. That is also why the day field is in the form at all, argued
  under [the editor's fields](#the-editors-fields).
- **`PLAN-14`**, the status cycle from the row. The editor carries a Statut field, so a status is
  changeable from here already.
- **`PLAN-18`** split, and **`PLAN-19`** through **`PLAN-21`** recurrence. Both appear in the
  inherited handoff list as panel members and neither is built. The editor's layout leaves room for
  them.
- **`PLAN-32b`**, per-category quotas. The per-task `quotaWphOverride` field is built; the default it
  falls back to is that feature's.
- **`PLAN-34`**, the timer.
- **Renaming `project_word_count`.** `PLAN-33` asks whether the surviving column should be renamed
  now that a row carries its own slice total rather than a whole project's. Decided under
  [the words column](#the-words-column-is-one-figure) and the answer is no.
- **Moving the planning week onto TanStack Query.** Reasoned about under [how a saved row gets back
  into the list](#saving-and-how-a-saved-row-gets-back-into-the-list) and deliberately not done.
- **A second arrangement for narrow screens.** The app has no mobile version and the card scrolls
  inside its own container, which is unchanged here.

## Outputs and acceptance criteria

### The words column is one figure

The `Mots` cell prints **`projectWordCount`, the row's own total**, and nothing else. No second
figure, no slash, no weight contrast between a numerator and a denominator.

That is the field because it is the only words field left once `words_done` is dropped, and because
the target model makes it the right one. `PLAN-33` settles that work spanning several days is several
rows, each carrying the words actually done that day as its own total, so a row total is what the
quota engine will sum. For a job that is not split the row total and the project total are the same
number, nothing is lost, and that is the common case and stays the simple one.

Three renderings, keeping the existing glyph-plus-screen-reader-text pattern exactly as the row
already uses it for every other absent value.

| Case                                      | Renders                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Not trackable                             | `planning.emDash` visually, `planning.notApplicable` to a reader |
| Trackable, `projectWordCount` is null     | `planning.emDash` visually, `planning.notSet` to a reader        |
| Trackable, `projectWordCount` is a number | `formatCount(projectWordCount, locale)`                          |

A trackable task with a zero word count prints `0` rather than the em dash, because zero is a figure
the user entered and the em dash is reserved for a figure nobody entered.

**Superseded in part, and the split is one row of that table.** The not-applicable case keys on whether
the category carries a status rather than on `trackable`, so `other` prints its stored word count like a
trackable row while the five categories that carry no status keep exactly the rendering above. The reason
is that a word count is meaningful on other work the user did not classify and meaningless on a break.
See [other-category.md](other-category.md) `UC14`. The two other rows and the zero rule are unchanged.

**`project_word_count` is not renamed.** The name reads as a whole project's total and a row now
carries its own slice, so the name is mildly misleading, and the fix is a comment rather than a
rename. A rename means either `ALTER TABLE ... RENAME COLUMN` plus a matching edit to every reader, or
a create-copy-swap, and it also renames `projectWordCount` on a request contract that shipped days
ago, which turns an internal tidy into a breaking API change. The behaviour gained is nothing. So the
column keeps its name and `schema.ts` gains a comment saying that a row's word count is that row's
own total, which is the whole project's total only when the work is not split.

- **AC1.** The `Mots` cell renders exactly one figure. No `/` separator and no second number appears
  anywhere in it, in any of the three cases above.
- **AC2.** A trackable row with `projectWordCount: 12000` renders `12 000` in French (grouped with
  the no-break space `formatCount` already emits) and `12,000` in English.
- **AC3.** A trackable row with a null `projectWordCount` renders the em dash visually and
  `planning.notSet` as screen-reader text. A non-trackable row renders the em dash and
  `planning.notApplicable`. A trackable row with `projectWordCount: 0` renders `0`. **The non-trackable
  sentence is superseded**, and the rest of the criterion stands. The not-applicable rendering belongs to
  the five categories that carry no status rather than to every non-trackable one, so an `other` row
  prints its count and prints the em dash with `planning.notSet` when the count is null. See
  [other-category.md](other-category.md) `UC14`.
- **AC4.** The column header stays `planning.columns.words`, and the cell stays in its existing grid
  track, right-aligned with tabular figures. If the design stage narrows that track now that it holds
  one figure rather than a pair, **the change is applied to both declarations**, the `DayCard.vue`
  column header line and `TaskRow.vue`, and the two grid templates are character-for-character
  identical afterwards.
- **AC5.** `schema.ts` carries a comment on `project_word_count` recording that a row's count is that
  row's own total, and the column is not renamed.

### `words_done` leaves the codebase

The column goes, and every reader goes with it. It is gone from the development database already, so
the code change and the migration land together, because either one alone breaks the planning week.

- **AC6.** `words_done` is absent from `server/db/schema.ts`, from `TaskListItem` in
  `server/models/tasks.ts`, from `TASK_COLUMNS` in `server/api/tasks/handlers/projection.ts`, from
  `PlanningTask` in `shared/planning.ts`, from `TaskRow.vue`, and from `scripts/seed.ts`. **Amended
  2026-07-31.** The enumerated list above is unchanged and is the precise part of this criterion. Its
  closing sentence used to demand that a repository-wide search return hits only in migrations `0004`
  and `0008`, and that cannot hold, because `AC8` and `AC64` deliberately keep `wordsDone` in the test
  suites as the key both request bodies must still refuse, and a guard proving a field is rejected has
  to name the field. So the criterion is that **no executable line under `server/`, `shared/`, `app/`,
  or `scripts/` reads or writes the dropped column**. Two things are explicitly allowed. Comments
  explaining the removal, which is what every remaining hit under `server/`, `shared/`, and `scripts/`
  is, and the test suites' refusal guards. This stays falsifiable rather than becoming a matter of
  opinion, because the source-scanning guard strips comments before searching, so an executable
  occurrence anywhere fails it and a sentence of prose does not.
- **AC7.** `GET /api/tasks` no longer returns a `wordsDone` key, and the planning week loads against a
  development database with both migrations applied. Checked in that order, since the week loads today
  and would keep loading if the code change were made without the migration, so the criterion is only
  meaningful against the migrated schema.
- **AC8.** `wordsDone` in a request body is still a 422 on both write endpoints. It was refused as an
  explicitly excluded field and it is now refused as an unknown key by `.strict()`, so `PLAN-09`'s
  `AC29` still holds for a different reason. The guard tests that assert the mirror was never written
  (`SELECT words_done` in `create.test.ts` and `update.test.ts`, and the
  `words_done is never written` block in `write-boundary-guards.test.ts`) lose their subject and are
  **replaced rather than deleted**, by a test that the key is refused as unknown. A suite left
  asserting against a dropped column is a broken suite, and one silently deleted leaves the mirror
  unguarded.
- **AC9.** `test/helpers/taskTestDb.ts` drops `words_done` from its `TASKS_DDL`, from `TaskRowSeed`,
  and from `seedTask`, so the in-memory table matches the live one.

### Mots faits comes off the inherited list

The handoff list in `extend-tasks.md` names `Mots faits` an editor field and calls it "the quota
numerator and the single most important stored number in the app". This feature takes it off the list.
That is a real contradiction between two settled documents and it is resolved here rather than
stepped around.

**Why removing it is right.** The owner killed the field for a reliability reason rather than a
simplicity one, "on ne track pas le nb de mots vs le total. seulement le total. sinon on n'aura jamais
des stats fiables. l'utilisateur ne perdra pas son temps à entrer chaque tâche manuellement". A figure
the user will not reliably enter produces worse statistics than no figure. The write API already
refuses it in both bodies, so a field here would have nowhere to send its value. `overview.md` records
that the editor renders whatever the schema holds, so building the field and dropping the column in
two features means building it twice. And the description of it as the live quota numerator was true
of an intention rather than of the code, because no quota engine exists yet and nothing reads the
column for a statistic.

**What it costs.** There is no longer any way to record partial progress inside one row. A job half
done at the end of a day is expressed as two rows, one per day, each carrying the words actually done
that day, which is `PLAN-18`'s split. Until `PLAN-18` ships the user does that by hand, adding one row
per day, which this editor is what makes cheap. The loss is real and it is the price of a number the
owner judged unreliable.

**`PLAN-18` needs restating, because the roadmap gives it `words_done`.** Its bullet reads "record
`words_done` on the current day and port the remainder to a chosen day", and its `AC1` and `AC3` name
the column. With the column gone, splitting sets the current row's `project_word_count` to the words
actually done that day and creates a sibling row carrying the remainder, the two joined by
`split_group_id`, and the quota attributes each day its own row total. That is the same mechanism
described in `PLAN-33`'s own decision, so nothing new is invented, but the roadmap still says the old
thing and a reader would follow it.

- **AC10.** `overview.md`'s `PLAN-18` entry and its `AC1` and `AC3` are annotated so they describe the
  split in terms of each row's own `project_word_count` rather than `words_done`, and a reader landing
  there is not sent looking for a dropped column. `PLAN-33`'s entry is annotated as delivered by this
  feature, and `PLAN-11`'s `AC1` is annotated to record that `Mots faits` came off the inherited field
  list and why. These are documentation edits, they are in scope for this feature because this feature
  is what makes the old text wrong, and they follow the precedent `PLAN-09` set with its own `AC32`
  through `AC34`.

### The notes field

A fresh field on a new column. It is not a revival of `instructions`, which was dropped with the
Consignes field it backed and whose contents were never real, only seed data.

| Question             | Decision                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Column               | `notes text` on `tasks`, nullable, no default                                                  |
| Contract field       | `notes`, a string or null, on `TaskListItem` and on `PlanningTask`                             |
| Writable             | Optional and nullable on both create and update, like `client` and `project`                   |
| Length               | Its own bound, `TASK_NOTES_MAX = 2000` characters, measured after trimming                     |
| Trimming             | Trimmed, and an emptied value becomes `null`, exactly as `client` and `project` already behave |
| Multiline            | Yes. Newlines are preserved inside the value                                                   |
| On the collapsed row | A presence marker, never the text                                                              |

**Where both bounds live, corrected 2026-07-31.** They are `TASK_TEXT_MAX = 200` and
`TASK_NOTES_MAX = 2000`, both exported from `shared/planning.ts` and imported as `#shared/planning`.
`app/utils/taskEditor.ts` re-exports the pair rather than declaring literals of its own, so the editor's
character counter and its length messages read the same numbers the write boundary validates against.
The server's own `FREE_TEXT_MAX` and `NOTES_MAX` no longer exist, and this spec named them in an earlier
draft. **A unit test importing either old name will not compile.** The names were chosen deliberately
rather than by accident. The client-side spellings were the ones kept, because `TaskEditor.vue` already
imported them and the stage doing the hoist could not edit a `.vue` file, and because a bare
`FREE_TEXT_MAX` in a shared module reads as free text anywhere in the application rather than as a
task's text fields, so the `TASK_` prefix is more accurate where the constant now lives.

**Why 2000 rather than the 200 of `TASK_TEXT_MAX`.** That bound exists for one-line identity fields, a
client name and a project number, and 200 characters is generous for those and tight for
prose. A note is a paragraph, often pasted from an instruction in an email, and 200 characters would
cut it mid-sentence. 2000 is an anti-garbage bound rather than a policy bound, the same distinction the
write API already draws for its numeric ranges, so it is far past any honest entry and still stops a
runaway paste from landing in the column. It is a separate constant so that tightening a client name
never tightens a note. **The owner accepted the figure on 2026-07-31**, so it is settled rather than
provisional, and it stays cheap to revisit because changing it costs one constant and one message.

**Why it is trimmed and emptied to null.** The write API already records the reason for the two
existing free-text fields, which is that a cleared field stored as `''` and a cleared field stored as
`NULL` are the same thing to the user and two different things to every reader. A note made of nothing
but whitespace and newlines is a cleared note, so it stores `NULL`.

**Why a marker on the collapsed row, and why not the text.** The text cannot fit, and it must not be
put in a `title` attribute either, since that is not reachable by keyboard and would be a second copy
of the field. But a note nobody can see is a note nobody remembers, and with no marker at all the only
way to find out which rows carry one is to open every row, which is more clutter across a week rather
than less. So the row shows one bit, whether opening this row will tell you something you cannot
already see, and that is exactly "minimal relevant info at a glance" rather than a violation of it. It
shows on any task with a note, trackable or not, because a note on a meeting is one of the cases it
exists for.

**Amended 2026-07-31. The marker is a glyph rather than a word, and this is settled.** This spec first
said a dimmed word on the identity line, following how `hors stats` and the split tag already read. The
design stage argued the opposite and the owner accepted the argument, which is that those two markers
state a fact about the task while this one points at disclosure, and a glyph is the honest form for a
pointer. **A glyph is what shipped**, with the accessible name beside it exactly as the row's em dash
pairs already work, and no middle dot before it, since a dot joins readable strings in a sequence and a
glyph is not a member of one. This was an open question in an earlier version of this document and it is
recorded here as the decision it became rather than left inviting a re-decision.

**Reversibility is kept as cheap insurance rather than as a pending question.** The marker is one small
piece of markup in one component reading one i18n key, so going back to a word costs that one edit.
Nothing else in the feature may come to depend on which form it takes.

- **AC11.** A create or update accepting `notes` stores it. `notes: null` clears it. An omitted
  `notes` on a `PATCH` leaves the column alone.
- **AC12.** `notes: '  '` stores `NULL`, not a whitespace string. `notes: 'ligne un\nligne deux'`
  stores both lines with the newline intact.
- **AC13.** A note of 2000 characters is accepted, and one of 2001 is a 422 whose `data` names
  `notes`. The length is measured after trimming, so 2000 characters surrounded by spaces is accepted.
- **AC14.** A row whose `notes` is a non-empty string renders the marker on the collapsed row. A row
  whose `notes` is null renders nothing at all in its place, and takes no width for it. The marker has
  an accessible name and the note's text appears nowhere on the collapsed row, including in any
  attribute.
- **AC15.** `notes` is present on `TaskListItem`, on `PlanningTask`, in `TASK_COLUMNS`, in
  `TaskWritableSchema`, in `TaskColumnValues`, and in `toTaskColumns`. Both request bodies stay
  `.strict()`, so the field had to be added to the base schema for it to be writable at all, and it is
  writable on both endpoints.

### The two migrations

Two migrations, applied in filename order.

| File                             | Statement                                   |
| -------------------------------- | ------------------------------------------- |
| `0008_drop_tasks_words_done.sql` | `ALTER TABLE tasks DROP COLUMN words_done;` |
| `0009_add_tasks_notes.sql`       | `ALTER TABLE tasks ADD notes text;`         |

Both statements are written with the backtick-quoted identifiers the neighbouring migration files use,
matching `0006` and `0007` exactly.

**Both files are ordinary next-in-sequence migrations, and both really run.** `0008` carries that name
because it is the next number and the name says what it does, nothing more. On development both are
genuinely pending, so one invocation applies the drop against a table that really holds `words_done`
and then adds `notes`, which is the correct and intended behaviour rather than anything to work
around.

**One property of the runner to respect, which is not a reason to do anything special here.** The
ledger is keyed on the filename with no checksum, so a name already in the ledger is skipped whatever
the file now says. That means **renumbering or renaming a migration after it has been applied to any
environment is unsafe**, because the new name is unrecorded and the runner will run the file again,
and the runner tolerates no error, so a re-run of a `DROP COLUMN` throws, is not recorded, and stops
the loop before every later file. `0008`'s header records that as the reason not to renumber it once
it has landed anywhere. Nothing in this feature depends on a skip.

**One sentence of history, because the git log will raise the question.** An abandoned earlier attempt,
closed unmerged as pull request #34, left the development ledger holding a `0008` row for a file that
did not exist and left the column already dropped. The owner repaired that before this feature
was built, and the repaired state was re-verified in this container on 2026-07-31 with a positive
control first: nineteen columns with `words_done` present and `notes` absent, a ledger of exactly
`0000` through `0007`, 112 task rows, and the runner reporting `8 migration files, 8 already
recorded.` So the database is in a true pre-`0008` state, nothing was baselined, and no phantom row
was re-added.

**Ordering against the deploy, and the window it leaves.** `0009` is the expand half and is safe to
apply before the new build. `0008` is the contract half and is safe only after it, because the old
build's projection selects the column. The runner applies pending files in filename order in one
invocation, so one invocation cannot do expand-then-contract properly, and there is a short window
either way in which the planning week fails to load. **Apply the migrations, then deploy.** Two
reasons. The schema is then in its final state and the deploy is the single last step whose success
ends the window, where deploying first and failing the migration needs a rollback to recover. And the
window that order leaves breaks a read, which the page's existing error state and its `Réessayer`
control already handle, where the reverse order breaks a write, and a failed save is where typed work
can be lost. Nothing is lost in either case and both are recoverable in one step.

**The rollout that leaves no window at all, which is the one to use.** The window above only exists
because both migrations are applied in a single invocation. Splitting them removes it entirely, and
the split is three ordered steps rather than two:

1. Apply `0009` alone, the expand half. It adds `notes` and breaks nothing, so the old build keeps
   serving normally.
2. Deploy the new build. It stops selecting `words_done` and starts using `notes`. Both columns exist
   at this moment, which is the whole point of expanding first, so neither the old build nor the new
   one can reach a missing column.
3. Apply `0008` alone, the contract half. Nothing reads `words_done` by now, so the drop is invisible.

Between every pair of steps the deployed build and the schema agree, so there is no instant at which
the planning week cannot load. The cost is one extra manual step and a deploy that is not a single
command. Do it this way for any deploy that matters.

**When the single invocation is acceptable instead.** Applying both files at once and then deploying
is the fallback, and it is defensible here for reasons specific to this app rather than as general
practice. There is one real user, the owner performs the deploy and knows when they are not working,
and the failure is a read that the page's existing error state and `Réessayer` control already
present as a retry rather than as data loss. Those three facts are what make a short window
tolerable, and none of them survives a second user or an automated deploy. **So drain first**: do not
apply the migrations while a session is open on the planning week, and if the app ever gains a second
user or the deploy stops being hand-run, the three-step rollout above stops being the better option
and becomes the only correct one.

**The undo, stated in the file as `0007` does.** If the drop is applied and the old build has to come
back, `ALTER TABLE tasks ADD words_done integer;` restores a working old build. The contents
are gone, which costs nothing, and the reason it costs nothing is the claim in
[open questions](#open-questions) item 2.

- **AC16.** The two files exist with exactly those names, each written in the hand-authored style
  `0000` through `0007` use, with a header comment block, and each carrying the `DO NOT auto-run this
against production` note the neighbouring files carry. Nothing in the pipeline, in CI, or in a
  deploy hook runs them.
- **AC17.** `0008`'s header records what the migration drops and why, the undo statement, and the
  runner's filename-keyed ledger as the reason not to renumber or rename a migration once it has been
  applied to any environment.
- **AC18.** Against the development database, `bun run apply-migrations` reports
  `10 migration files, 8 already recorded.` and lists exactly two pending files,
  `0008_drop_tasks_words_done.sql` and `0009_add_tasks_notes.sql`, in that order. Running it with
  `--yes` applies both and records both.
- **AC19.** After the development run, `PRAGMA table_info(tasks)` shows nineteen columns, which is the
  nineteen verified before the run minus `words_done` plus `notes`. The criterion is only met when
  `words_done` is **absent** and `notes` is **present**, so the pre-migration state cannot satisfy it,
  and all 112 existing rows have a null `notes`.
- **AC20.** `0009`'s header records that `notes` is a fresh field rather than a revival of the
  `instructions` column `0007` dropped, so nobody reads the pair as a mistake being undone.

### The editor's fields

Inherited from `extend-tasks.md`'s handoff, minus `Mots faits`, plus `Notes`, plus the task's own day.
`Gestionnaire de projet` and `Consignes` are not built, and were never on that list.

**Two rows of this table are superseded, and their original wording is kept in the notes below rather
than in the cells, because a table cell cannot hold a note this long.** Row 1 read "Required. Decides
trackability". Both halves are now wrong. `Catégorie` is **not required**, since a create with no
category stores `other`, and it decides **trackability and deliverability**, which used to be one fact
and are now two. It also gains a tenth option with a separator above it. Row 10 read "Trackable
categories only". `Statut` is governed by whether the category carries a status, and `other` is the one
member where that differs from trackability. See [other-category.md](other-category.md) `UC20`, `UC25`,
`UC17`, and `UC8`. Every other row stands.

| Order | Field             | Contract field     | Widget                                | Notes                                           |
| ----- | ----------------- | ------------------ | ------------------------------------- | ----------------------------------------------- |
| 1     | Catégorie         | `category`         | `USelectMenu`, coloured options       | Superseded, see below                           |
| 2     | Jour              | `date`             | `UInput type="date"`                  | Prefilled from the day card                     |
| 3     | Client            | `client`           | `UInput`                              | Free text                                       |
| 4     | Numéro de projet  | `project`          | `UInput`                              | Free text                                       |
| 5     | Livraison         | `deliveryDate`     | `UInput type="date"`                  | Clearable                                       |
| 6     | Heure             | `deliveryTime`     | `UInput type="time"`                  | Clearable, and legal with no delivery date      |
| 7     | Mots              | `projectWordCount` | `UInputNumber`                        | The words to do on that day                     |
| 8     | Durée estimée     | `estimatedMinutes` | Two `UInputNumber`, hours and minutes | Plain input, never derived here                 |
| 9     | Durée réelle      | `actualMinutes`    | Two `UInputNumber`, hours and minutes | Genuinely nullable, and clearing it is not zero |
| 10    | Statut            | `status`           | `USelect`                             | Superseded, see below                           |
| 11    | Quota             | `quotaWphOverride` | `UInputNumber`                        | Empty means the user's default                  |
| 12    | Exclure des stats | `excludeFromStats` | `USwitch`                             | Boolean, never null                             |
| 13    | Notes             | `notes`            | `UTextarea`                           | Full width, last                                |

**Why the task's own day is a field, when the handoff list does not name it.** Without it a task added
to Tuesday that belonged on Wednesday cannot be fixed, because delete is `PLAN-13` and drag is
`PLAN-16` and neither ships here, so the row would be stuck on the wrong day with no way out. That is
a dead end in the sense the conventions rule out. The write API already accepts `date` and already
reassigns `sort_order` to the end of the destination day when it changes, so the server side exists.
`PLAN-16`'s drag stays the fast path and this is the escape hatch.

**The category selector is coloured, and it updates live.** Both requirements come from the owner
through the handoff, "Categories in the selector should also show those colors to associate row color
to categories" and "switching category also change the color". Each option prints its category name in
that category's colour, and the closed control shows the selected category in its colour and changes
immediately on selection, before any save. The hue comes from `categoryHue` in `shared/categories.ts`
and the class from `.planning-cat-name` in `app/assets/css/main.css`, so the component supplies only
`--planning-cat-hue` and there is never a second copy of the mapping. Options are built from
`DEFAULT_CATEGORIES` in contract order with labels from `categories.<id>`.

**Still true, and now ten options.** Building from `DEFAULT_CATEGORIES` in contract order is what makes
the tenth option arrive for free, so nothing in this paragraph changes. Two things are added rather than
altered. `Autre` sits tenth and one separator sits immediately above it, and a fresh draft opens with
`other` already selected and named, styled as a plain selected value rather than as a placeholder,
because it is a real choice the save will honour. See [other-category.md](other-category.md) `UC17`,
`UC42`, and `UC25`.

**The status options read the shared vocabulary.** The three options are `TASK_STATUSES` in tuple
order, each labelled through `planning.status.<key>` with the key resolved by `statusKey(value, true)`,
plus an `Aucun` option meaning null. `retard` and `na` are derived keys and are never options. This is
why no fourth copy of the three French status strings appears anywhere in the editor.

**The three status names are confirmed.** `Accepté`, `En cours`, and `Terminé` were
`overview.md`'s open question 5 and the owner accepted them as the select options on 2026-07-31, so
that question closes here. From now on a rename is a data migration rather than a copy change, because
the values are stored data and the late comparison matches `Terminé` as a literal string. Hoisting
them into the one shared tuple is what keeps such a rename to a single edit.

**Statut on a non-trackable category. Superseded on the governing fact, unchanged on the mechanism.**
The behaviour described below is right and the rule that triggers it is not. It is now whether the
category **carries a status**, not whether it is trackable, and the two answers differ for exactly one
member. `other` is not trackable and does carry a status, so its `Statut` field is enabled and its stored
status is neither cleared nor hidden. The five categories that carry no status behave exactly as this
paragraph says. Where the text below reads `isTrackableCategory` for the pending selection, the editor
reads the second predicate instead, for the same reason and in the same place. One thing is added rather
than corrected: when the pending category flips to one that carries no status, the control clears to its
none state immediately rather than displaying a value the save will discard. See
[other-category.md](other-category.md) `UC8`, `UC12`, `UC13`, and `UC38`.

The original text follows. The field is disabled and shows a hint saying the category
carries no status, and the payload **omits `status` entirely** rather than sending null. The server
clears the stored value itself as part of the same write, which is rule 2 in
`server/api/tasks/handlers/write.ts`, so there is one place that clears it. The editor decides whether
to disable the field by reading `isTrackableCategory` for the **pending** selection, because the
selection can differ from the stored category before a save and the row's server-resolved `trackable`
describes the stored one. That is the one derived value the editor computes, and it is legitimate
because the rule lives once in `shared/` and both sides import it, which is the conventions' single
acceptable form of sharing.

**One hand-off to the accessibility stage, recorded 2026-07-31 so it is not lost.** A truly disabled
select is not focusable, so a keyboard user tabbing through the form never reaches the field and never
hears the hint, which is then only reachable in a screen reader's browse mode. The category selector's
own change is what explains the state, so disabled is what ships and that is a decision rather than an
oversight. If the accessibility stage judges browse mode insufficient, the alternative is
`aria-disabled` on a readonly control, which keeps the field in the tab order at the cost of a control
that looks operable and is not. That trade is the accessibility stage's to make.

- **AC21.** Expanding a row shows every field in the table above, prefilled from the row, and shows no
  field for a project manager and none for Consignes. A null contract field renders as an empty
  control rather than as the string `null`.
- **AC22.** Every option in the category selector prints its name in its own category colour, and the
  closed control's colour changes the moment the selection changes and before any save. The hue is read
  from `categoryHue` and no category-to-colour mapping exists in the component. **Extended rather than
  superseded.** The criterion holds for all ten options, and the option count plus the separator above
  `Autre` are covered by [other-category.md](other-category.md) `UC17` and `UC42`.
- **AC23.** Selecting a non-trackable category disables the Statut field and shows its hint. The
  resulting request body contains no `status` key. Saving such a change succeeds and the refreshed row
  reports `statusKey` of `na`. **Superseded insofar as it reads as a rule about every non-trackable
  category.** It stays true for the five that carry no status. It is not true for `other`, whose field is
  enabled and whose status is sent and stored. The payload rule itself survives unchanged, which is that a
  category carrying no status sends no `status` key. See [other-category.md](other-category.md) `UC12`,
  `UC26`, and `UC40`.
- **AC24.** The status options are exactly the three stored values plus a none option, in tuple order,
  labelled from `planning.status.*`. No literal `'Accepté'`, `'En cours'`, or `'Terminé'` appears in
  any file this feature adds under `app/`.

### The two durations stay plain inputs

Both durations are editable inputs storing whole minutes verbatim. **This feature derives nothing.**

`PLAN-12` owns `estimated_minutes = round_to_5(words / quota × 60)` and it needs a per-category quota,
which is `PLAN-32b` and is not built. The only quota that exists today is the global
`settings.quota_wph`, whose default of 450 is recorded as wrong and whose column `PLAN-32b` deletes.
The estimate is frozen by definition, so a value derived from that quota would never self-correct, and
every task written in the meantime would carry a frozen estimate derived from a number nobody
believes. Writing no estimate is recoverable, because `PLAN-12` can backfill from a real quota. Writing
a wrong frozen estimate is not, because nothing downstream can tell a frozen-correct value from a
frozen-wrong one. That is the same argument `task-write-api.md` already made for declining to compute
it at the write boundary, and it has not changed.

**Where the derivation will live when it lands.** In the server write handlers, with any pure rounding
helper in `shared/planning.ts` if both sides genuinely need it. Never in a Vue component. The
acceptance criterion below is written as a prohibition so a later implementer cannot satisfy `PLAN-12`
by putting the arithmetic in the form.

The hours-and-minutes pair is the widget, matching the shipped `dailyWorkMinutes` control in
`app/components/onboarding/step-work.vue` and `app/components/settings/work-fields.vue` rather than
inventing a duration parser. The two-way conversion between a pair of numbers and whole minutes is
input marshalling rather than a business rule, so it is presentation, and it lives in a pure
unit-tested module rather than inline in the component, following the precedent `app/utils/account.ts`
sets and states. That module is `app/utils/taskDuration.ts`, exporting `splitDuration` and
`joinDuration`.

- **AC25.** `Durée estimée` and `Durée réelle` are independent inputs. Typing one never changes the
  other, on create or on edit.
- **AC26.** No component computes minutes from a word count and a quota. A search for a division by a
  quota under `app/` returns nothing.
- **AC27.** Clearing `Durée réelle` sends `actualMinutes: null` and the refreshed row falls back to
  the estimate through `effectiveDuration`. Entering zero sends `actualMinutes: 0` and the row does not
  fall back. The two are distinguishable in the interface, so a user who typed a wrong duration has a
  way back to unmeasured.

### Expanding a row to edit

The collapsed row stays visible and the form opens in a panel directly beneath it, the two reading as
one expanded row. That is the shape `DayCard.vue` already uses for its own header and panel, so it is
the repository's own precedent rather than a new pattern, it keeps the row's identity on screen while
its fields are being edited, and it keeps the hand-rolled table semantics valid, which replacing the
row's cells with a form would not.

The affordance is a button inside the task-name cell carrying `aria-expanded` and `aria-controls`,
with a stretched pseudo-element making the whole row clickable, which is exactly what the day header's
disclosure button does today. The button's accessible name is a screen-reader-only `Modifier` followed
by the row's name, so a row with no client and no project still has a usable name. The editor panel is
a sibling row in the same rowgroup with a single cell spanning the grid.

- **AC28.** Clicking anywhere on a collapsed row opens its editor. The collapsed line stays visible
  above the form.
- **AC29.** The expand control is a real button with `aria-expanded` reflecting the state and
  `aria-controls` pointing at the panel, and the region keeps its `role="table"` semantics with six
  column headers over six cells.
- **AC30.** The editor panel is created and destroyed rather than hidden, so cancelling leaves no form
  state behind and nothing unsaved survives out of sight.
- **AC31.** A forward note is recorded in `TaskRow.vue` that the stretched click target will need to
  yield to the row-action controls `PLAN-13` and `PLAN-17` put in the reserved eighth track, so those
  buttons are not swallowed by it.

### Creating a task is the same mechanism

Each open day card carries an `Ajouter une tâche` control at the foot of its rows, matching the
reference app's `+ Ajouter une tâche` link. Pressing it opens a draft editor at the foot of that day's
rows, above the control, using the same form component with empty values and the day prefilled.

**A draft has no collapsed representation and issues no request until save.** There is no empty
placeholder row, so `PLAN-13`'s `AC2` is satisfied by construction rather than by cleanup, matching
`task-write-api.md`'s "no server-side draft exists". Abandoning a draft by cancelling, by closing the
tab, or by paging the week writes nothing.

**An empty day has to be openable, which it is not today.** `DayCard.vue` renders no disclosure
control when `tasks.length === 0`, on the stated grounds that "a button that opens onto an empty body
is a promise the card cannot keep". This feature puts the add control in that body, so the premise
changes and every day becomes disclosable. Without that change the first task of a day could never be
added, which is the one thing this feature exists to make possible.

- **AC32.** Every day card is disclosable, including a day with no tasks, and the comment in
  `DayCard.vue` explaining why an empty day grew no control is updated rather than left contradicting
  the code.
- **AC33.** An open day with no tasks shows the add control and an empty-state line, and shows no
  column header row, because headers over zero rows say nothing. An open day with tasks shows the
  header row, the rows, then the add control.
- **AC34.** The today-open default still applies, and now applies on an empty today as well, since
  today's card has something to disclose. The tri-state `userOpen` null meaning untouched is unchanged,
  so paging away and back during a fetch does not pin a card shut.
- **AC35.** Pressing the add control opens a draft editor with every user-entered field empty, the day
  prefilled from the card's date, and `category` preselected to `other`, which is
  `DEFAULT_CATEGORY_ID`. **Category is not empty.** The selector has no empty state to fall back to
  once `other` exists, and a draft that already carries a valid category is one the user can save
  without first answering a question they may not have an answer to. The default is non-trackable, so
  it produces no words and moves no quota figure. No row appears in the day until the create succeeds.
- **AC36.** A `POST` is sent only on save. Abandoning a draft in any way creates no row, verified by a
  task count that does not change.
- **AC37.** After a successful create the draft closes, the new row appears collapsed in its day
  ordered last, and focus returns to the add control so a second task is one keypress away.

### Saving, and how a saved row gets back into the list

Saving an edit sends a `PATCH /api/tasks/:id` carrying **only the changed fields**. Saving a draft
sends a `POST /api/tasks` carrying every field the user filled. Both go through one composable in
`app/composables/`, and the save control shows a loading state and is disabled while the request is in
flight.

**A partial patch rather than the whole task, for three reasons that are already recorded.** The write
API refuses an empty patch, so the editor has to know whether anything changed anyway. A patch touching
one field cannot clobber a field a second tab just wrote. And a row holding a stale category id, left
by a renamed or retired category, would be **unpatchable** if the form always sent `category`, since
`categorySchema` is a strict enum and the stale id is not in it. Sending only what the user touched
means editing a legacy row's client name works, and the stale id is repaired only if the user actually
picks a category.

**How the list refreshes.** The planning week is `useAsyncData`, not TanStack Query, so a mutation
invalidating a query key would refresh nothing. The documented convention for a `useAsyncData` read is
to call its `refresh()`, or `refreshNuxtData(key)` for a shared key, so **the save awaits the write and
then awaits `refreshNuxtData('planning-tasks')`, and the editor collapses when both have settled.** The
save control's loading state spans both, so the button is never dead and cannot be double-submitted.

That is the documented framework path rather than a bespoke bridge, and it is preferred over the three
alternatives. Splicing the returned row into the local array by hand would put list ordering and day
bucketing logic on the client, and the server owns `sort_order`. Registering a TanStack mutation whose
`onSuccess` invalidates a key nothing reads would be a convention followed in name and broken in
effect. And moving the whole week onto TanStack Query is a real option and a larger change than this
feature, since the week read needs SSR and re-runs on a `weekRange` watch, so it is named as a possible
later consolidation and not done here.

The extra round trip is one week's tasks, and it buys a list that always agrees with the server about
ordering, day membership, `statusKey`, `trackable`, and the day's capacity meter. The list of resolved
fields grew by one, the flag for whether a category carries a status, which the list handler decides and
hands over finished exactly as it does the other two. The argument is unchanged and the addition
strengthens it, since a second derived fact is a second thing the client would otherwise have had to work
out for itself. See [other-category.md](other-category.md) `UC11`.

- **AC38.** An edit sends only the fields whose normalized value differs from the loaded row. An edit
  that changes only the client name sends a body with exactly one key.
- **AC39.** **On an edit**, the save control is disabled when nothing has changed, so no empty `PATCH`
  is ever sent and the write API's 422 for one is never reached from the interface. **On a draft it
  stays enabled even untouched**, because the criterion exists to stop an empty `PATCH` and a draft
  sends a `POST`, which is never empty: it carries the day and the `other` category `AC35` preselects.
  Gating a draft on dirtiness would make "add a task, save it" impossible without first editing a field
  the user may have nothing to say about. So the guard reads `!task || dirty` rather than `dirty`.
- **AC40.** A row whose stored `category` is a retired id such as `revision` can have its other fields
  edited and saved. The request carries no `category` key and the save succeeds. The selector displays
  the coerced value, and if the user picks a category the request carries the picked id and the row is
  repaired. **The criterion stands and its worked example moved.** The coerced value is now `other` rather
  than `admin`, so that row displays `Autre` and reads as other work rather than as administration. This
  is called out because the example is what a test author copies. Two further consequences for the same
  row, both from the coercion change rather than from this criterion: its stored status becomes visible
  again and so does its word count, because `other` carries a status. See
  [other-category.md](other-category.md) `UC4` and `UC10`.
- **AC41.** The save control shows a loading state and is disabled from submit until both the write and
  the refresh have settled. Two rapid activations produce one request.
- **AC42.** On success the row collapses back to the minimal row showing the saved values, and the
  day's capacity meter and the week's totals reflect the change with no reload.
- **AC43.** **Amended 2026-07-31** to say where the region lives, because the original could not work.
  A success is announced through a polite live region **that lives in `app/pages/index.vue`**, outside
  everything the save tears down. `AC30` destroys the panel on close, so a region inside the panel is
  removed from the document before it can announce and the announcement never happens. **The
  announcement is asserted to survive the panel being destroyed**, and that assertion belongs to the
  accessibility stage, with the unit stage covering it too if the region ends up in a testable module.
  This is the kind of defect that ships broken and passes every visual check, which is why the
  criterion names the location rather than only the behaviour. No toast appears, because the collapse
  and the updated row are the visible confirmation and a toast on every save in a flow the user repeats
  dozens of times a day is noise.
- **AC44.** Changing the day to another date in the visible week moves the row to that day's card,
  ordered last, and both days' capacity recompute. Changing it to a date outside the visible week
  removes the row from the view, and the user reaches it by paging. Nothing is lost and nothing warns
  or blocks.

### Mandatory fields, and where validation lives

**This section is the most heavily superseded in the document, and the note is up here rather than
repeated three times below.** The live answer is that **only the day is required**. A create carrying just
a day is legal, and a category the user never picked is stored as `other`. So the three passages that
follow describe a mandatory category, a deliberately empty selector, and a save control disabled until a
category is chosen, and none of those three is how the editor now behaves. They are kept because the
middle one is genuinely good reasoning that stopped applying rather than reasoning that was ever wrong,
and a reader who only sees the new answer would not know why the old one was defensible. See
[other-category.md](other-category.md) `UC20`, `UC25`, `UC27`, and `UC45`. The original text follows.

**The user must supply a category, and nothing else.** The day is also required and is never typed on
a create, since it comes from the card the draft opened in. Those two are exactly what
`TaskCreateSchema` requires, so the client refuses nothing the server would accept and the mandatory
set is one decision rather than two. That closes `PLAN-10`'s `AC2`, which deferred the list to an open
question, and it confirms the division `task-write-api.md`'s open question 4 asks about.

**The category has no preselected value.** Defaulting it would be a guess with a cost either way. A
default of `translation` silently labels a break as translation work, and a default of `admin` is
non-trackable and silently removes real work from the quota numerator. Both produce wrong statistics
with nothing on screen to explain them. It is one click, it is the field that decides whether the
task's words count at all, and asking for it is honest. The selector therefore shows a placeholder and
the save control stays disabled until a category is chosen.

**Why that argument was retired rather than overruled.** It is exactly right about the two candidates it
weighs. `translation` mislabels a break and `admin` is real work a translator books time against, so
defaulting to either one moves a figure that should not have moved. The argument does not reach `other`,
because `other` is non-trackable and therefore contributes no words and no quota, and **a figure it cannot
move is a figure it cannot corrupt**. The premise was that every plausible default corrupts statistics,
and the tenth category is a default that does not. Requiring the choice also turned out to be the app
refusing to record something that happened, which is the policing the product rules out.

**The client validates two things and no more.** That a category is chosen, and that something
changed. Everything else is the server's, and the client does not reimplement `isValidCalendarDay`, the
numeric bounds, the `HH:MM` rule, the trimming, or `assertStatusFitsCategory`. Native input types
constrain the widget, which is presentation rather than a duplicated rule. **The count is now one.** The
chosen-category check is gone with the mandatory rule, so the client validates only that something
changed, and the principle that everything else stays the server's is unchanged and is the part that
mattered.

**A 422 is mapped by field name, never printed.** `sendZodError` returns a `data` object keyed by
field name, plus `_form` for anything that belongs to the body as a whole. The client maps each key to
its own French or English message from the table under [copy](#copy), falls back to a generic
invalid-value message for a key it does not recognise, and never displays the server's developer-facing
English.

- **AC45.** The save control is disabled until a category is chosen. A draft with only a category and a
  day saves successfully, which is the smallest legal add and is what recording a break costs.
  **Superseded.** The save control is never disabled for a missing category, and **the smallest legal add
  is a day**. A draft is saveable from the moment it opens, because a day plus the defaulted category is
  already a legal create, so the save-enabled condition is two conditions rather than one: an edit is
  saveable when the diff is non-empty, and a draft is saveable immediately. An untouched draft still
  counts as clean, so abandoning one costs no discard confirmation. See
  [other-category.md](other-category.md) `UC45`, and `UC20` for the boundary that makes it legal.
- **AC46.** No file this feature adds under `app/` contains a copy of a calendar-day check, a clock-time
  pattern, the word-count or duration bounds, the quota bounds, or a trackable-category list. The one
  contract function the client reads is `isTrackableCategory`, imported from `shared/`. **The prohibition
  stands unchanged and the enumeration does not.** The client still copies no contract rule. The contract
  functions it reads are now two rather than one, the trackability predicate and the one for whether a
  category carries a status, both imported from `shared/`. See [other-category.md](other-category.md)
  `UC8`.
- **AC47.** A 422 keeps the editor open with every typed value intact and shows a message against each
  field named in `data`. An unrecognised key and a `_form` key both surface a form-level message. The
  raw English message from the server is never rendered.

### Exactly one editor open at a time

Confirmed. `PLAN-11`'s `AC3` asked for confirmation and the answer is yes, and the exclusivity is
across the whole week rather than within one day, because two open forms in one view is exactly the
clutter the collapsed row exists to avoid.

**The open-editor state lives on `app/pages/index.vue`**, as one value that is either an edit of a
task id, a draft on a date, or nothing. `DayCard.vue`'s per-component ref cannot express exclusivity
across sibling rows or across cards, so it has to be lifted, and the page is the right owner because it
already owns the tasks, the refresh, and the week anchor, and it is the component that has to guard the
week switcher against a dirty editor. `Week.vue` passes it down and stays a thin renderer. Like the
day-card open state, this is the narrow presentation exception the backend-logic rule carves out. It is
not persisted, not in the URL, and never sent to the server.

**The discard confirmation lives on the page too, and that is a decision rather than a gap.** Recorded
2026-07-31, because it departs from the design document, which put the modal inside the editor panel,
and the owner accepted the departure. **Four of the seven paths that need the confirmation begin outside
the panel**, collapsing the day card, switching the week, leaving the route, and clicking another row,
so a modal owned by the panel would have needed an imperative channel reaching down through two
components to open it and report its answer back up. One instance on the page, next to the state that
already decides whether a close may proceed, is one rule in one place. A later reader should not move it
back into the panel on tidiness grounds.

**Collapsing a day card that holds the open editor cannot be allowed to strand it.** The collapsed
panel carries `:inert="!open"`, so an editor inside a card the user then collapses becomes
non-interactive while still holding unsaved values, which is a dead end. So the day-card toggle asks
the editor to close first, through the same dirty check every other close goes through, and the card
collapses only once the editor has gone. No editor is ever inside an inert panel.

- **AC48.** Opening a second row closes the first. Two editors are never open at once, in the same day
  or in different days.
- **AC49.** Collapsing a day card that holds a clean open editor closes the editor and collapses the
  card. Collapsing one that holds a dirty editor runs the discard confirmation first, and the card stays
  open if the user keeps editing.
- **AC50.** No editor is ever reachable inside a panel carrying `inert` or `aria-hidden`.

### Keyboard and focus

- **AC51.** On expand, focus moves to the first form control, which is the category selector.
- **AC52.** **Amended twice on 2026-07-31**, first because the original conflicted with `AC44` and then
  because the frontend stage found a stronger survival test than the amendment asked for. Closing an
  editor moves focus to the row's expand button when that button is **present and not inside an `inert`
  subtree**, and to the disclosure control of the day card the editor was open in otherwise. Both
  outcomes are ordinary. This holds on save, on cancel, and on a discard. On a create, both outcomes
  return focus to the add control.

  Presence alone is not enough, and the reason is the whole point of the criterion. A save that changes
  the day can move the row into a **collapsed sibling day**, and that row's button then exists in the
  document while being unfocusable, because `DayCard.vue` marks a collapsed panel `inert`. Focusing it
  fails `AC54` exactly as silently as focusing a button that was removed, so the test is presence plus
  reachability rather than presence. A save can also move the row out of the visible week entirely,
  which `AC44` describes and which the first amendment was written for. The day card's disclosure
  control always exists because `AC32` makes every card disclosable, so the fallback is always
  available.

- **AC53.** Escape from anywhere inside the editor cancels. A clean editor closes immediately. A dirty
  one runs the discard confirmation.
- **AC54.** Focus is never left on `<body>` at any point in an expand, a save, a cancel, a discard
  confirmation, or a failed save. The discard confirmation returns focus to the first form control when
  the user keeps editing and to the row's expand button when they discard.
- **AC55.** Every control in the editor is reachable and operable by keyboard alone, and the form can
  be filled and saved without a pointer.

## Edge cases

### Interrupted and abandoned paths

The rule the conventions set is that any process can be abandoned partway and the outcome must be
either fully done or safely recoverable. A task comes into being on a single `POST`, so there is no
half-created row anywhere and nothing to clean up. What has to be protected is the typed values, which
until a save lands are the only copy of that work.

**Dirty means at least one field differs from the loaded row**, or from empty for a draft, compared on
the normalized value, so typing a space and deleting it is not dirty. The trim-and-empty-to-null rule
lives in `shared/planning.ts` as `normalizeFreeText`, the one pure function that the server's
`freeTextSchema`, the notes schema, and the client's comparison all read, so the two sides cannot
disagree about what a cleared field is. The comparison itself is a pure function in
`app/utils/taskEditor.ts`, which exports `diffEditorState`, `isEditorDirty`, and `buildCreatePayload`
alongside `taskToEditorState` and `emptyEditorState`, and it produces the patch body as
well as the dirty verdict, so one function settles dirtiness, the request payload, and the refusal to
send an empty patch.

| What happens                                      | What the editor does                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click outside, nothing changed                    | Collapses. No prompt, ever, in the common case. What counts as outside is `AC66`                                                                                      |
| Click outside, changes pending                    | Stays open, shows a quiet unsaved-changes note in place, does not steal focus, loses nothing                                                                          |
| Escape or Cancel, nothing changed                 | Collapses                                                                                                                                                             |
| Escape or Cancel, changes pending                 | Discard confirmation. Discard closes and loses the values, which is now the user's explicit choice. Keep editing returns to the form                                  |
| Another row clicked, changes pending              | Same discard confirmation, since only one editor may be open                                                                                                          |
| The day card collapsed, changes pending           | Same discard confirmation, and the card stays open if the user keeps editing                                                                                          |
| The week switched, changes pending                | Same discard confirmation. Without it the card is destroyed by the `v-for` key change and the values vanish silently                                                  |
| Navigated to another route, changes pending       | Same discard confirmation, through the router's own leave guard                                                                                                       |
| Reloaded or the tab closed, changes pending       | The browser's own unload warning. A draft that is lost anyway writes nothing                                                                                          |
| A save fails on the network or a 500              | Stays open with every value intact, shows a recoverable error and a retry                                                                                             |
| A save returns 422                                | Stays open with every value intact, shows the per-field messages. Never collapses on a validation failure                                                             |
| A save returns 401, the session expired mid-edit  | Stays open with every value intact. Says the session expired, offers sign-in **in a new tab**, and offers a retry that re-sends the same body. Does not navigate away |
| A save returns 404, the row was deleted elsewhere | Stays open, says the task no longer exists, and offers to save the typed values as a **new task on the same day**. Never retries the patch                            |
| The refresh after a successful save fails         | The write has already landed. The editor has closed and the page shows its existing week-level error with its retry. No lost write and no stuck row                   |
| Two tabs editing the same row                     | Last write wins per field. Because the body is partial, two tabs editing different fields both land. Two tabs on the same field is genuinely last-write-wins          |

**Why the 401 does not navigate.** `task-write-api.md` sets the constraint that a 401 must not discard
the form, because the typed values are the only copy of that work. The page already has a global
watcher that routes to sign-in when the **read** returns 401, and the save path must not reuse it,
because navigating unmounts the form. Signing in a new tab keeps the values on screen with nothing
stored anywhere. Copying the pending body into `sessionStorage` and restoring it after a redirect was
considered and rejected, because it puts a second copy of task content at rest for a rare case and the
new tab needs no storage at all.

**Why the 404 offers a create.** A patch against a deleted row can never succeed and `PATCH` is not an
upsert, so retrying is a dead end. The typed values are still good, the same day is still there, and
recreating is exactly the undo-is-a-recreate pattern `task-write-api.md` already documents for delete.
The new row gets a new id, which is fine because nothing references a task by id.

### What counts as a click outside the editor

**Added 2026-07-31, after the design stage found that the obvious implementation breaks the happy
path.** Several controls in the form render their content through a teleport, so it leaves the panel's
DOM subtree and lands elsewhere in the document. `USelectMenu`'s popover and `UModal`'s content both do
this. A detector that listens on `document` and asks whether the click landed inside the panel's
subtree therefore reads **choosing a category** as a click outside the form, and the editor answers a
completely ordinary interaction with an unsaved-changes warning.

**This is a data-loss path rather than a polish issue.** The warning is the mechanism that protects
typed work, so training the user to see it during normal editing is what makes it ignorable on the one
occasion it matters, and a user who learns that the prompt means nothing is a user who will eventually
discard real work. The teleport is also invisible in every screenshot and in every visual review, so
nothing but a written criterion catches it.

**Content teleported out of the panel's subtree counts as inside the editor.** The detector resolves
what is inside from the component tree or from the library's own outside-click contract, not from DOM
containment alone.

**The detector stays hand-written for now, and this is a recorded follow-up rather than a defect.**
Ruled by the owner on 2026-07-31, and written down because swapping it for VueUse's `onClickOutside`
with its `ignore` option looks like an obvious improvement to anyone reading the file later.

- **Declaring the dependency has a known cost right now.** `@vueuse/core` is only a transitive
  dependency of `@nuxt/ui`, so using it directly means declaring it, which means an install, and this
  repository's `postinstall` runs `git submodule update --init --recursive`. That is exactly what
  detached the `.recipes` submodule and destroyed a convention file earlier in this session. So the
  install is not a neutral step today.
- **The hand-written listener is already correct rather than merely adequate.** It matches the three
  real portal markers rather than guessing at class names, and it listens for a capturing `pointerdown`
  for the same reason the library does, which is that a select option removes itself from the document
  before `click` fires, so a `click` listener would see the option gone and read the interaction as
  outside.
- **The cost of waiting is a comment.** It is written in the same shape the documented mechanism uses
  and carries a comment recording how to swap it.

The follow-up is to make the swap with the dependency declared and the lockfile updated in the same
change, at a moment when an install is safe. `AC66` is what protects the behaviour either way, since it
is written against the behaviour and not against the implementation.

- **AC66.** These three interactions do not produce an unsaved-changes warning and do not close the
  editor, whether or not the form is dirty. Opening the category selector, moving through its options,
  and choosing one. Opening a modal from within the editor and dismissing it. Opening a date picker,
  moving through it, and picking a date. **The criterion is written so that a naive `document` listener
  testing DOM containment fails it**, which is deliberate, because a test written the other way round
  passes for whatever the first implementation happens to do and protects nothing a year from now. A
  click on the week header, on another day card, or on another task row still counts as outside and
  behaves as the table above says.

### Data and product edge cases

- **A task on a non-work day, a holiday, or a day already overbooked.** Adding and editing work
  identically. Nothing is disabled and no save is refused for any of those reasons. The capacity meter
  turning red is the signal and it is the whole signal.
- **A day whose capacity is already over.** The add control is present and enabled, the new task is
  saved, and the meter goes further over. The app records reality.
- **A delivery time with no delivery date.** Allowed and stored, per the write API. The row reads the
  time only when a date is present, so a stray time is inert.
- **A delivery date before the task's day.** Allowed. The row will read as late, which is the correct
  signal.
- **A far-future or far-past day typed into the day field.** Accepted, because the API bounds nothing
  beyond being a real calendar day. A native date input makes a slip less likely and does not prevent
  it, and the row would sit on a week the user cannot navigate to easily. This is
  `task-write-api.md`'s open question 5 and it is inherited rather than solved here.
- **A word count on a non-trackable task.** Allowed and stored. A meeting with a word count is strange
  and harmless, and blanking it would be the app deciding what the user may record.
- **A quota override on a non-trackable task.** Allowed and stored, inheriting the write API's
  recorded inconsistency and its open question. The field is shown for every category rather than
  hidden on some, because nothing reads it there and hiding it would need the same two-part treatment
  the status gets.
- **An unchanged non-trackable row that still holds a stored status.** A legacy inconsistency. The form
  omits `status`, nothing else changed, so the save control stays disabled and the row keeps its stored
  value. Harmless, because every reader forces `na` for a non-trackable task. **Superseded on its final
  clause**, and this one was found by sweeping rather than from the supersession list, so it is flagged as
  an addition. Not every reader forces `na` on a non-trackable row any more. A row in a category that
  carries no status still reads `na`, and an `other` row resolves its stored status normally, so its
  `Terminé` prints as finished instead of being hidden. The rest of the case holds, including that nothing
  is rewritten and the save control stays disabled. See [other-category.md](other-category.md) `UC10`.
- **A note on a non-trackable task.** Normal, and one of the cases the field exists for. The marker
  shows on the collapsed row like any other.

## Copy

French first, English second. Every string is researched rather than guessed, and the field names come
from the app the owner already reads every day. **The space before `? ! : ;` is a real no-break space
(U+00A0) in the JSON**, not a plain space, so the punctuation never wraps away from the word it
belongs to.

New keys go under `planning.editor.*`, because the editor is part of the planning week and the row copy
already lives under `planning.*`. Field labels get their own keys even where they repeat a column
header, because a column header is a one-word abbreviation in a fixed track and a form label may need to
grow, so keeping them separate means renaming one never silently renames the other. The two unit
suffixes and the words-per-hour unit are reused from `onboarding.work.*`, which is the repository's
existing habit and is what `app/components/settings/work-fields.vue` already does.

### Controls and states

| Key                              | French                                                                                                                        | English                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `planning.editor.addTask`        | Ajouter une tâche                                                                                                             | Add a task                                                                                                 |
| `planning.editor.emptyDay`       | Aucune tâche ce jour.                                                                                                         | No tasks on this day.                                                                                      |
| `planning.editor.newTask`        | Nouvelle tâche                                                                                                                | New task                                                                                                   |
| `planning.editor.editRowLabel`   | Modifier                                                                                                                      | Edit                                                                                                       |
| `planning.editor.editFormLabel`  | Modification de la tâche                                                                                                      | Editing task                                                                                               |
| `planning.editor.save`           | Enregistrer                                                                                                                   | Save                                                                                                       |
| `planning.editor.cancel`         | Annuler                                                                                                                       | Cancel                                                                                                     |
| `planning.editor.saved`          | La tâche a été enregistrée.                                                                                                   | The task was saved.                                                                                        |
| `planning.editor.created`        | La tâche a été ajoutée.                                                                                                       | The task was added.                                                                                        |
| `planning.editor.unsaved`        | Modifications non enregistrées.                                                                                               | Unsaved changes.                                                                                           |
| `planning.editor.discardTitle`   | Abandonner les modifications ?                                                                                                | Discard changes?                                                                                           |
| `planning.editor.discardBody`    | Vos modifications n'ont pas été enregistrées. Elles seront perdues.                                                           | Your changes have not been saved. They will be lost.                                                       |
| `planning.editor.discardConfirm` | Abandonner                                                                                                                    | Discard                                                                                                    |
| `planning.editor.discardCancel`  | Continuer l'édition                                                                                                           | Keep editing                                                                                               |
| `planning.editor.saveError`      | La tâche n'a pas pu être enregistrée.                                                                                         | The task could not be saved.                                                                               |
| `planning.editor.sessionExpired` | Votre session a expiré. Ouvrez la connexion dans un nouvel onglet, reconnectez-vous, puis réessayez. Vos saisies restent ici. | Your session has expired. Open sign-in in a new tab, sign back in, then try again. Your entries stay here. |
| `planning.editor.signInNewTab`   | Ouvrir la connexion                                                                                                           | Open sign-in                                                                                               |
| `planning.editor.gone`           | Cette tâche n'existe plus. Elle a probablement été supprimée ailleurs.                                                        | This task no longer exists. It was probably deleted elsewhere.                                             |
| `planning.editor.goneCreate`     | Enregistrer comme nouvelle tâche                                                                                              | Save as a new task                                                                                         |
| `planning.editor.goneDiscard`    | Fermer                                                                                                                        | Close                                                                                                      |

`planning.retry` (`Réessayer` and `Try again`) is reused for the retry control rather than duplicated.

### Field labels and hints

| Key                                          | French                                                                     | English                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `planning.editor.fields.category`            | Catégorie                                                                  | Category                                                                     |
| `planning.editor.fields.categoryPlaceholder` | Choisir une catégorie (removed, see below)                                 | Choose a category (removed, see below)                                       |
| `planning.editor.fields.day`                 | Jour                                                                       | Day                                                                          |
| `planning.editor.fields.client`              | Client                                                                     | Client                                                                       |
| `planning.editor.fields.project`             | Numéro de projet                                                           | Project number                                                               |
| `planning.editor.fields.deliveryDate`        | Livraison                                                                  | Delivery                                                                     |
| `planning.editor.fields.deliveryTime`        | Heure                                                                      | Time                                                                         |
| `planning.editor.fields.words`               | Mots                                                                       | Words                                                                        |
| `planning.editor.fields.wordsHint`           | Le total de mots à faire ce jour-là.                                       | The total words to do on that day.                                           |
| `planning.editor.fields.estimatedDuration`   | Durée estimée                                                              | Estimated time                                                               |
| `planning.editor.fields.actualDuration`      | Durée réelle                                                               | Actual time                                                                  |
| `planning.editor.fields.status`              | Statut                                                                     | Status                                                                       |
| `planning.editor.fields.statusNone`          | Aucun                                                                      | None                                                                         |
| `planning.editor.fields.statusUnavailable`   | Cette catégorie ne porte pas de statut.                                    | This category carries no status.                                             |
| `planning.editor.fields.quota`               | Quota                                                                      | Quota                                                                        |
| `planning.editor.fields.quotaHint`           | Vide : votre quota par défaut.                                             | Empty means your default quota.                                              |
| `planning.editor.fields.excludeFromStats`    | Exclure des stats                                                          | Exclude from stats                                                           |
| `planning.editor.fields.excludeHint`         | La tâche reste au calendrier, mais ses mots ne comptent pas dans le quota. | The task stays on the calendar, but its words do not count toward the quota. |
| `planning.editor.fields.notes`               | Notes                                                                      | Notes                                                                        |
| `planning.editor.fields.notesPlaceholder`    | Précisions, rappels, détails à retenir…                                    | Details, reminders, anything to remember…                                    |
| `planning.editor.fields.notesCounter`        | {count} / {max} caractères                                                 | {count} / {max} characters                                                   |

The hour and minute suffixes reuse `onboarding.work.unitHours` (`h`) and `onboarding.work.unitMinutes`
(`min`), and the quota unit reuses `onboarding.work.unitWph` (`mots/heure` and `words/hour`).

**`planning.editor.fields.categoryPlaceholder` no longer exists in either locale file.** A fresh draft
opens with `Autre` already selected rather than with a placeholder, so the string had no reader left and
was removed rather than kept unused. Confirmed absent from both files. It is listed here with its original
copy because the table is the record of what this feature added, and a reader looking for the key needs to
find out that it is gone rather than find nothing. See [other-category.md](other-category.md) `UC25` and
`UC27`. One key was added for the tenth category and it belongs to that document, `categories.other`,
`Autre` in French and `Other` in English.

### The note marker on the collapsed row

| Key                  | French                     | English              |
| -------------------- | -------------------------- | -------------------- |
| `planning.noteLabel` | Cette tâche porte une note | This task has a note |

**Amended 2026-07-31.** There is one key rather than two. The marker is a glyph, so the visible word
this table used to carry, `planning.note`, has no reader and is **not added**, because an unused key at
parity in two locale files is a thing a later reader has to work out the purpose of. The remaining key
is the accessible name behind the glyph, paired with it exactly as the em dash pairs on the row already
are. The decision to draw a glyph is under [the notes field](#the-notes-field).

### Validation messages, and the field they map from

The client renders these. It never renders the server's message.

| `data` key from the 422              | Key                                               | French                                           | English                                      |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| (removed, see below)                 | `planning.editor.validation.categoryRequired`     | Choisissez une catégorie.                        | Choose a category.                           |
| `date`                               | `planning.editor.validation.dayInvalid`           | Choisissez un jour valide.                       | Choose a valid day.                          |
| `client`, `project`                  | `planning.editor.validation.textTooLong`          | Ce champ doit contenir au plus {max} caractères. | This field must be at most {max} characters. |
| `deliveryDate`                       | `planning.editor.validation.deliveryDateInvalid`  | Choisissez une date de livraison valide.         | Choose a valid delivery date.                |
| `deliveryTime`                       | `planning.editor.validation.timeInvalid`          | Entrez une heure au format 24 h (HH:MM).         | Enter a time in 24-hour format (HH:MM).      |
| `projectWordCount`                   | `planning.editor.validation.wordsInvalid`         | Entrez un nombre entier de mots.                 | Enter a whole number of words.               |
| `estimatedMinutes`, `actualMinutes`  | `planning.editor.validation.durationInvalid`      | Entrez une durée valide.                         | Enter a valid duration.                      |
| `quotaWphOverride`                   | `planning.editor.validation.quotaInvalid`         | Le quota doit être d'au moins 1 mot à l'heure.   | The quota must be at least 1 word per hour.  |
| `status`                             | `planning.editor.validation.statusNotDeliverable` | Cette catégorie ne peut pas porter de statut.    | This category cannot carry a status.         |
| `notes`                              | `planning.editor.validation.notesTooLong`         | La note doit contenir au plus {max} caractères.  | The note must be at most {max} characters.   |
| `category`, and any unrecognised key | `planning.editor.validation.invalid`              | Cette valeur est invalide.                       | This value is invalid.                       |
| `_form`                              | `planning.editor.saveError`                       | La tâche n'a pas pu être enregistrée.            | The task could not be saved.                 |

**Two rows of that table are superseded.**
`planning.editor.validation.categoryRequired` **no longer exists in either locale file**, confirmed absent
from both, because there is no client-side category-required check left to produce it. It is kept in the
table for the same reason as the placeholder above, so a reader looking for the key learns it was removed
rather than finding nothing. And `planning.editor.validation.statusNotTrackable` **is renamed to
`planning.editor.validation.statusNotDeliverable`**, which is the key the table above now carries and the
one both locale files define. It was named after the flag that was split, while the French and English
strings it holds are already correct and unchanged, since both describe the status concern rather than
trackability. So that row was a stale identifier rather than wrong copy shown to anyone. See
[other-category.md](other-category.md) `UC27` and its copy section.

- **AC56.** Every string above exists in both `i18n/locales/fr.json` and `i18n/locales/en.json`, the two
  files stay at key parity, and no visible string in any component this feature adds is a literal. **Read
  it against the two removals noted above**, so the criterion covers the strings this feature still ships
  rather than the two whose readers are gone.
- **AC57.** Every French string carrying `? ! : ;` uses a no-break space before it, as a real U+00A0
  character in the JSON rather than a plain space.
- **AC58.** The 422 mapping above is implemented as a lookup from the `data` key, and an unrecognised
  key produces the generic invalid-value message rather than nothing and rather than the server's
  English.

### Do not police the user

- **AC59.** Adding and editing work on a work day, a non-work day, a weekend, a holiday, and a day
  already over its capacity. No control is disabled and no save is refused for any of those reasons.
- **AC60.** An off-day card carries the add control like any other, so recorded weekend work can be
  entered where it happened.
- **AC61.** Nothing in the editor warns about, blocks, or reformats what the user writes in Notes. The
  confidentiality rule in the conventions governs what this repository publishes and says nothing about
  what the app stores, so no content policing is added.

### The account purge erases tasks explicitly

**Folded into this feature on 2026-07-31.** The compliance stage found this and it was first recorded as
a follow-up chore, then the owner ruled that both halves ship here. The defect is pre-existing and this
feature did not cause it, but the feature is what makes it consequential, so it closes here.

`server/api/cron/purge-deactivated.get.ts` deleted `settings`, `magicLinkTokens`, `allowedEmails`, and
`users` by naming them, and left `tasks` and `work_schedule` to the foreign key cascade. The endpoint's
entire job is erasure, so it was doing that job explicitly for four tables and by inference for two more,
and **a maintainer reading four deletes reasonably concludes those are all the tables involved**, which
was false. The ordering is load-bearing rather than incidental, because deleting the parent rows first is
precisely what made the outcome depend on the cascade at all.

**Why the cascade was not a safe thing to depend on.** It fires only because the platform enables
`PRAGMA foreign_keys` server-side, and `server/db/schema.ts` records honestly that this was probed
against development and that production was never probed. If production differs, a purged account leaves
every task row and every note behind forever, which is a failed erasure under Law 25.

**Why this feature raises the stakes without having caused the problem.** The `notes` column stores
free-text prose about a working day, which is more sensitive than the structured metadata the table held
before, so the cost of a failed erasure goes up while the mechanism preventing it stays unverified.

**This was demonstrated rather than argued.** The backend stage ran the endpoint's actual statements with
`PRAGMA foreign_keys` off, asserted that the pragma genuinely read `0` rather than assuming it, and ran
the negative control first so a passing result could not simply be a probe that could never fail. **The
old code left an orphaned task row still holding its notes prose behind a deleted user. The fixed code
removes every row with the cascade unavailable.** That is what turns this from a tidiness note into a
demonstrated privacy defect that this change closes.

**The second half is the one that matters most.** Before it, the suite **could not** catch a cascade
regression, because `test/helpers/taskTestDb.ts` never issued the pragma and SQLite leaves foreign keys
off per connection until something turns them on. A broken cascade kept every test green, which is a
check unable to produce a positive being read as a pass.

- **AC67.** `purge-deactivated.get.ts` deletes `tasks` and `work_schedule` explicitly, by name, and both
  deletes run **before** the `users` delete, mirroring the pattern the endpoint already uses for
  `settings`, `magicLinkTokens`, and `allowedEmails`. A comment records that the two deletes are not
  redundant, so a later reader does not remove them as duplicating the cascade.
- **AC68.** With the cascade unavailable, a purge leaves no `tasks` row and no `work_schedule` row for
  the purged user. The test asserts the pragma genuinely reads `0` before relying on it being off, so the
  case cannot pass because foreign keys were quietly on, and it is the assertion that **would have failed
  before this change**.
- **AC69.** `test/helpers/taskTestDb.ts` enables `PRAGMA foreign_keys`, so referential integrity is
  actually in force in the suite rather than nominally declared by the DDL.
- **AC70.** A test asserts the purge removes a user's `tasks` and `work_schedule` rows, so a future
  regression fails a check rather than passing silently.

**One consequence of `AC69` that is expected and wanted.** Task fixtures insert rows whose `user_id` must
exist in `users`, so **any suite seeding a task for a user it never created starts failing the moment the
pragma goes on.** That is the point rather than an obstacle. The owner's instruction is that breaking
tests are reported and fixed rather than papered over, and that the pragma is not quietly reverted to get
back to green. A test that only passes with referential integrity switched off is itself a finding.

### Tests and scaffolding

- **AC62.** The pure modules this feature adds are unit-tested from these criteria rather than from the
  implementation. **The module and symbol names below are current as of 2026-07-31 and are the ones to
  import**, because the bounds were hoisted into the shared contract after the first draft of this spec
  and the names changed with them. `normalizeFreeText` in `shared/planning.ts`. `diffEditorState`,
  `isEditorDirty`, and `buildCreatePayload` in `app/utils/taskEditor.ts`. `splitDuration` and
  `joinDuration` in `app/utils/taskDuration.ts`. Each is covered at its boundaries including an empty
  string, whitespace only, a value differing only by surrounding whitespace, a cleared value against a
  zero value, and a diff that finds nothing.
- **AC63.** The notes schema is covered at its bounds, 0, 1, `TASK_NOTES_MAX`, and one over it, plus
  whitespace only becoming null and a multiline value surviving intact. The bound is read from
  `TASK_NOTES_MAX` in `shared/planning.ts` rather than written as a literal, since a test that hardcodes
  2000 goes stale silently if the bound moves.
- **AC64.** The existing task suites pass, with the `words_done` assertions replaced per `AC8` and the
  test helper updated per `AC9`. `test/server/utils/sendZodError.test.ts` and
  `test/server/models/tasks.test.ts` both assert on the refused-key list and are updated so they still
  describe the shipped contract.
- **AC65.** `scripts/seed.ts` stops writing `words_done`, and seeds a note on at least one task so the
  collapsed-row marker is visible on a freshly seeded week without hand-entering one.

## Stages

Specs and code review are never skipped.

- **Specs.** This document.
- **Design.** Runs. A new interactive form inside the day card, a new coloured selector, the words cell
  changing shape, the note marker, the add control, the empty-day card, and the discard confirmation.
  The visual form of the marker and the field grid are its calls; the field set, the order, and the
  copy are settled here.
- **Backend.** Runs. Both migrations, the schema change, the notes validation, the projection change,
  the seed, and the `overview.md` annotations. **It runs first**, because the shared contract and the
  development database are what unblock everything else.
- **Frontend.** Runs. It can start against the contract as specced here in parallel with the backend
  stage. One sequencing fact to respect rather than discover. The week loads today, and applying `0008`
  to development breaks it until the projection change lands, so the two halves of that pair are
  checked out together and the migration is run once the code no longer selects the column. Nothing is
  lost either way, and the recovery is the one-line undo in `0008`'s header.
- **Compliance.** Runs, scoped narrowly to one thing, the new free-text column. A free-text field is
  where personal data lands in practice, so the pass confirms that `notes` is covered by the existing
  cascade-on-user-delete erasure path, that nothing logs its contents, and that no error message echoes
  it back. It must not turn that into a product constraint. The conventions are explicit that the
  confidentiality rule governs published prose and not what the owner's own tool stores, and that "do
  not police the user" wins. It ran and found one gap, that account deletion left `tasks` and
  `work_schedule` rows behind. The owner ruled on 2026-07-31 that both halves of it are folded into this
  feature rather than deferred, so explicit deletion of both tables ships here and is specified under
  [the account purge](#the-account-purge-erases-tasks-explicitly), covered by `AC68` through `AC70`. No
  compliance finding is left outstanding, and the erasure gap is no longer a follow-up.
- **Accessibility.** Runs. A new form, a new disclosure, focus management, a live region, a modal
  confirmation, and hand-rolled table semantics that have to stay valid with a panel row inside them.
- **Unit test.** Runs, per `AC62` through `AC65`, plus `AC68` through `AC70` for the purge.
- **SEO.** Skipped. An authenticated dashboard already marked `noindex, nofollow`, with nothing to
  optimize for search.
- **Code review**, then **commit**, which opens the pull request and stops there.

## Follow-ups recorded, not built here

One thing, written down so it does not have to be rediscovered. It is a chore rather than a defect in
this feature, and the owner decides whether it rides along or lands separately. The **hand-written
click-outside detector** stays as it is for now, and the reasoning is recorded with the criterion it
belongs to under [what counts as a click outside](#what-counts-as-a-click-outside-the-editor) rather than
repeated here.

The erasure gap that used to sit in this section is **no longer a follow-up**. The owner ruled on
2026-07-31 that both halves of it are folded into this feature, so it moved into the built scope under
[the account purge](#the-account-purge-erases-tasks-explicitly).

## What this feature's verification is worth, and what it is not

Recorded 2026-07-31 so that "verified" in this document cannot be read as carrying more weight than it
earned.

**Nobody has clicked this editor.** Not a person and not an agent. The planning week sits behind
authentication, signing in needs the owner's credentials from `.env`, which no agent may read, and when
the frontend stage tried to mint a throwaway development account instead, the permission system refused.
It did not look for a way around that, which was the right call.

**What was actually checked.** 32 probes run against the real modules rather than against mocks, plus
compiled-CSS checks and module-transform checks. The whole test suite is green and `eslint .` is clean,
both at exit 0. **No total is written here on purpose**, because the unit-test stage is still adding
tests and a figure copied into prose goes stale the same day. The number at the gate is the number that
counts. That evidence is genuinely strong about the modules in isolation, and it is the reason the
acceptance criteria in this document are written to be checkable from the criteria rather than from the
implementation.

**What was not checked.** Nobody has expanded a row in a browser, typed into the form, pressed save, and
watched the row collapse with its new values. Nothing has exercised the real category popover, the real
date picker, the real modal, or the real focus moves against a real browser's focus behaviour. Those
probes were also ad-hoc verification runs rather than committed tests, so the suite figure above covers
the pure modules and the write path and not the editor's own behaviour. So every behavioural claim about
the interface in this document is an argued expectation supported by module-level evidence, not an
observation.

**What the automated stage did settle.** The unit-test stage ran and finished: `bun run test` passes
1,584 tests across 31 files at exit 0, and `bun run lint` exits 0. That is the whole of the automated
evidence. It bounds what is claimed above rather than extending it, because none of those tests drive
the editor in a browser, so a green suite and an unclicked editor are both true at once.

**What follows from that.** The first person to sign in and use the form is doing first-pass manual
verification rather than confirming something already seen working, and it should be planned as that.
The three places most worth watching are the ones where the evidence is furthest from the behaviour,
which are the click-outside detector against the real popovers per `AC66`, the focus moves after a save
that relocates a row per `AC52`, and the live region actually announcing after the panel is destroyed
per `AC43`.

## Repository hygiene carried by this branch

**This is not part of the feature.** It is recorded here because the branch carries it as tracked
changes and the reasoning should not have to be re-argued. `.claude/**` is excluded from both Vitest
and ESLint, ruled by the owner on 2026-07-31 and verified in this container.

- **It was a real failure, not noise.** `bun run test` exited 1 and `bun run lint` exited 2 before the
  fix, and both reproduced on `main`, so this was pre-existing. It had been written off as pre-existing
  pollution in the build trail for at least two features, which made it a bug nobody owned and which
  cost real time twice.
- **A prune fixes one container and nothing else.** Agents create worktrees under `.claude/` as a
  matter of course, so the next one recreates the problem. The exclude is the durable fix.
- **The suite was misreporting its own coverage.** `.claude/worktrees` holds throwaway copies of the
  repository, so collecting their tests or resolving their ESLint config was never meaningful. The run
  previously reported 1298 tests of which 232 were duplicates in stale copies. **The honest pre-change
  baseline on this branch is 25 files and 1066 tests.** The current figure is deliberately not written
  down, because the unit-test stage is still adding tests, so the number at the gate is the one that
  counts and any total quoted here would be stale within the hour. Both gates are at exit 0. One delta
  against that baseline is worth naming because it is a decrease rather than an increase, so it could
  otherwise read as a failure hidden by a deletion. It is entirely inside
  `write-boundary-guards.test.ts`, six tests out and four in, where a four-case `it.each` over three
  write handlers plus `write.ts` was replaced by a smaller set of stronger guards, per `AC8`.
  `create.test.ts` and `update.test.ts` are net zero.
- **One inherent limitation, so nobody chases it as a regression.** Pointing ESLint directly at a file
  inside `.claude/worktrees/` still crashes, because flat config searches upward and finds that copy's
  own broken config. `eslint .` from the repository root is clean, and that is the only thing the gate
  runs.

## Open questions

**One subject is still open, the production row check, and it is the two entries below.** It does not
block the build and it needs the owner before the migrations are applied to production.

**Everything else this section carried is now a decision in the body.** This section is the one a reader
consults to learn what is undecided, so stale content here is worse than stale content anywhere else,
because it invites someone to re-decide a settled question and to read finished work as unfinished. Each
ruling is listed with where it now lives rather than summarised, so nothing has to be searched for.

| Was a question here                  | Ruled                             | Now recorded in                                                  |
| ------------------------------------ | --------------------------------- | ---------------------------------------------------------------- |
| Should delete fold into this feature | No, `PLAN-13` runs straight after | [scope](#scope), with the gap it leaves stated                   |
| The notes bound of 2000 characters   | Accepted                          | [the notes field](#the-notes-field)                              |
| The three stored status names        | Accepted as the select options    | [the editor's fields](#the-editors-fields)                       |
| The note marker, a word or a glyph   | A glyph, and it shipped           | [the notes field](#the-notes-field)                              |
| The tenth category's copy            | `Autre` and `Other`               | [other-category.md](other-category.md), which owns that decision |

The no-break space before `?`, `!`, `:`, and `;` in French copy was never open here. It is a convention
rather than a question, it is `AC57`, and any later stage adding a hint or a message for a new field is
bound by it.

1. **Does production hold task rows at all? UNVERIFIED, and it needs the owner.** There are no
   production credentials in this container, which is verifiable from the migration runner's dry run
   printing the development host, so this cannot be checked here and must not be guessed. `PLAN-09`
   shipped the write path on 2026-07-30, so the answer is no longer "no" by construction, and every
   document that reasons from the old no-history finding has already been annotated as expired. Run
   `SELECT COUNT(*) FROM tasks` against production, and confirm the ledger state there with
   `bun run apply-migrations` as a dry run, which should report both new files as pending.
2. **Any production row that exists has a null `words_done`. VERIFIABLE from the write path, and it is
   the reason the drop is safe.** `create.ts` never writes the column, `toTaskColumns` has no entry for
   it, and both request bodies refuse it, so the only writer that has ever set it is the dev seed, which
   does not run against production. So the drop cannot destroy user-entered data even if rows exist.
   This claim is deliberately kept apart from item 1, which is a fact about the database, where this is
   a fact about the code.
