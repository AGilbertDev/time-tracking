# Row simplification, the words total

`PLAN-33`. Depends on `PLAN-32`. Backend and frontend, plus a small design pass, plus a real migration.

**The overview's stage line for this feature is stale and this spec corrects it.** It reads "Frontend, plus a design pass", which was true while this was a display change. The scope grew the same day it was written, so backend leads and the design pass is the narrowest stage rather than the leading one.

## Intent

The shipped task row prints `Mots` as a done-over-total pair, for example `2 800 / 12 000`. It becomes the row's own total alone. That much is a display change and the rest of this feature is not. `words_done` leaves the schema, with a hand-authored migration that is written and applied, so the column stops existing rather than being hidden behind a component that no longer reads it.

The owner's instruction grew in two steps on 2026-07-29, from "enlève le restant `-- /` de la colonne mots. seulement le total, pas de `-- /`" to "only keep total words in this column. remove the rest. clean the db. create the proper migration apply it too". The second half is what makes this a data feature.

His reason for refusing the pair is a reliability argument rather than a simplicity one, and it is kept verbatim because it is the strongest justification the decision has. **"on ne track pas le nb de mots vs le total. seulement le total. sinon on n'aura jamais des stats fiables. l'utilisateur ne perdra pas son temps à entrer chaque tâche manuellement."** A figure the user will not reliably enter produces worse statistics than no figure at all, so the fix is to stop asking for it rather than to keep a field that fills with guesses. That is a stronger argument than clutter, because it survives someone deciding later that the row has room for one more number.

**The part to get right is the quota numerator.** `words_done` existed for one job, which was to stop a multi-day task counting its whole project total on every day it touched, and [`schema.ts`](../../../server/db/schema.ts) says so at line 84. Dropping the column removes that protection. The replacement is splitting, decided on 2026-07-29 and already `PLAN-18`'s model, so this feature builds nothing new and does have to make sure the guarantee is recorded rather than lost. That is [the quota numerator](#the-quota-numerator-loses-its-guard-and-splitting-replaces-it) below, and it is the reason the stale-comment sweep is a criterion rather than a tidy-up.

**The progress signal is deliberately absent.** The owner asked for the pair removed and nothing more, so the row goes quiet on performance until he decides. See [no progress signal](#no-progress-signal-and-this-is-deliberate).

One prerequisite is not satisfiable inside this container and is not hidden. `PLAN-32a` got a free migration because it verified that no user task history existed, and that finding expired on 2026-07-30 when `PLAN-09` landed. The row check has to be re-run against production, and there are no production credentials here. See [the production row check](#the-production-row-check-and-what-is-actually-verified), which separates what is verified from what is predicted.

## Inputs

No runtime inputs. This feature adds no endpoint and changes no request contract, so its inputs are the decisions it implements and the shipped code it has to agree with.

1. **The words decision**, [words are a total, not a progress pair](overview.md#words-are-a-total-not-a-progress-pair-deferred-to-a-later-feature), given by the user on 2026-07-29 and resolved further by the owner the same day. Its earlier paragraphs assume `words_done` survives in the schema and they do not, and the section already says so. Read the resolution rather than the reasoning that led to it.
2. **The scope entry**, `PLAN-33` in [`overview.md`](overview.md), which carries the four acceptance criteria this spec expands, the two things it was asked to settle, and the expired-finding warning.
3. **The progress-signal section**, [the duration pair is the progress signal](overview.md#the-duration-pair-is-the-progress-signal-and-that-reopens-a-shipped-decision), which is where the four candidate routes live and which this feature deliberately does not act on.
4. **The live schema.** [`server/db/schema.ts`](../../../server/db/schema.ts), the `tasks` table. `wordsDone: integer('words_done')` at line 87 is nullable with no default, is not a primary key, is not unique, appears in no constraint and no generated column, and is covered by no index. The table's only index is `tasks_user_id_date_idx` on `(userId, date)`. That is what makes a plain `DROP COLUMN` legal rather than needing create-copy-swap.
5. **The migration precedent.** [`0007_drop_tasks_instructions.sql`](../../../server/db/migrations/0007_drop_tasks_instructions.sql) is the direct precedent and 0008 follows its shape, with one difference argued under [migration 0008](#migration-0008-and-the-live-reader-that-changes-the-ordering) and one correction to its idempotency note.
6. **The migration runner.** [`scripts/apply-migrations.ts`](../../../scripts/apply-migrations.ts) applies the files in filename order against whatever `.env` points at, records each in an `_applied_migrations` ledger, and tolerates no error. The next filename is `0008_`.
7. **The write path this must not disturb.** [`task-write-api.md`](task-write-api.md) settled that `words_done` is never written and is a 422 in either body, under [the words_done question](task-write-api.md#the-words_done-question-and-how-it-was-settled). This feature is the cleanup that decision was written to enable, so it removes a column the request contract never exposed and therefore breaks no client.
8. **The row as it ships.** [`TaskRow.vue`](../../../app/components/planning/TaskRow.vue) lines 72 to 84 for the two computed figures, lines 193 to 214 for the words cell and its accessibility comment, and line 110 for the eight-track grid, which is duplicated in [`DayCard.vue`](../../../app/components/planning/DayCard.vue) line 243.
9. **The i18n keys, all of which already exist.** `planning.columns.words` reads `Mots` in French and `Words` in English, `planning.emDash`, `planning.notSet` reads `Non précisé`, and `planning.notApplicable` reads `Sans objet`. This feature adds no key and rewords none.

## Scope

In scope. The `words_done` column and every reader of it, in the schema, the model, the read projection, the shared contract, the row, and the seed. Migration `0008`, written and applied against the dev database. The words cell in `TaskRow.vue` and the two grid strings. The stale comments and the shipped-spec annotations the drop invalidates. The test surface, which is large and is enumerated under [the test surface](#the-test-surface-and-what-becomes-of-a-guard-whose-subject-is-gone).

Out of scope, each named so a build stage cannot drift into it.

- **The progress signal**, in any form. Its own section below.
- **Splitting is `PLAN-18`.** This feature depends on splitting as the _model_ that replaces the numerator guard and it implements none of it. No `split_group_id` behaviour changes, no slice flow, no per-slice words prompt.
- **The `project_word_count` rename**, deferred with a reason and a trigger under [decision 1](#decision-1-project_word_count-keeps-its-name-for-now).
- **The quota engine is `PLAN-22`.** It does not exist, so nothing here computes a numerator. This feature only has to leave the recorded model correct for whoever builds it.
- **Per-category quotas are `PLAN-32b`.** `settings.quota_wph` and its 450 default are untouched.
- **The write API's request contract.** `wordsDone` is already refused on both endpoints, so nothing in `server/models/tasks.ts`'s schemas changes in behaviour. Only the comments naming a column that no longer exists change.
- **No new endpoint and no route change.** `projection.ts` loses one line from its select list and nothing else about the read path moves.

### No progress signal, and this is deliberate

**Do not add a variance marker, an estimated-against-actual indicator, or any per-row performance affordance.** The owner asked for the pair removed and nothing more, so the row goes quiet on performance until he decides, and judging the simpler row first is the point.

This needs saying at criterion strength because the argument for adding something is already written down and is persuasive. [The duration pair is the progress signal](overview.md#the-duration-pair-is-the-progress-signal-and-that-reopens-a-shipped-decision) records that between the words pair and the duration pair the row now carries nothing that says how a task is actually going, and it calls the variance marker the strongest of four routes. An implementer who reads that section as a brief will build it here. It is not a brief, it is a parked decision, and the four routes stay recorded in that section for whoever picks them up.

The one thing this feature owes the eventual signal is a constraint rather than a design, and it is the overview's own `AC4`. Whatever signals over or under adds **no coloured element per row**, because the simplifying pass caps the row's colour budget at what ships today and `AC26` of [`extend-tasks.md`](extend-tasks.md) holds. Recorded here so the later feature inherits the cap rather than rediscovering it.

## The quota numerator loses its guard, and splitting replaces it

`words_translated(period)` was specified to sum `words_done` rather than `project_word_count`, precisely so a multi-day job could not count its whole project total on every day it touched. That was the column's only real job. Dropping it removes the guard, and the replacement has to be recorded rather than left implicit, because the guard is the kind of thing that is only missed once a wrong number is on screen.

**The replacement, decided 2026-07-29. Work spanning several days is several rows, each carrying the words actually done that day as its own total, so the quota sums row totals and no day can claim a whole project.** That is `PLAN-18`'s existing model, so this is a use of a mechanism the roadmap already has rather than a new one. Nothing here builds it.

Two properties of that replacement are worth stating, because they are what make it a real guard and not a hope.

**It is enforced by the shape of the data rather than by a rule.** With one figure per row and no done-against-total pair anywhere, there is no second number a summing query could pick by mistake. The old model needed the quota engine to choose the right column, and this one leaves it only one column to choose.

**It is not yet load-bearing, and that is why the window is safe.** `PLAN-22` does not exist, so no code sums anything today. `PLAN-18` does not exist either, so no row can be a slice through any path a user can reach, since `splitGroupId` is not writable by the write API. The only split rows anywhere are the eight the dev seed makes. So the interval in which the guard is gone and the replacement is unbuilt contains no reader, which is the same ordering argument `PLAN-09` used and it still holds.

**What this feature owes the model is that nothing is left claiming otherwise.** `schema.ts` line 84 currently reads "wordsDone is the quota numerator, treated as zero when absent", which will be false the moment the migration lands and is exactly the sentence a later implementer would trust. Correcting it is `AC7`, and it is real work rather than housekeeping, because a comment that survives its column is worse than no comment.

## Two decisions this feature was asked to settle, and one it settled itself

### Decision 1. `project_word_count` keeps its name, for now

**Decided. The column is not renamed in this migration. It keeps `project_word_count` and gains a comment saying what it actually holds.** The tradeoff is real in both directions and the case for waiting is stronger.

**What a rename would cost, counted rather than estimated.** The column appears in `schema.ts`, in `TaskListItem` and `projectWordCountSchema` and `TaskWritableSchema` in `server/models/tasks.ts`, in the `TASK_COLUMNS` select list in `projection.ts`, in the field mapping in `write.ts`, in `PlanningTask` in `shared/planning.ts`, in `TaskRow.vue`, in `scripts/seed.ts` in four places including the split-pair construction, in the hand-written DDL and the insert in `test/helpers/taskTestDb.ts`, and in roughly thirty assertions across five test files. That is a wide surface and it is not the decisive argument, because a mechanical rename across a typed codebase is tedious rather than risky.

**The decisive argument is that a rename is a contract change and the drop is not.** `projectWordCount` is client-writable on both write endpoints and both schemas are `.strict()`, so renaming the field renames a key that `PLAN-10` and `PLAN-11` will send, and an old client sending the old key gets a 422 rather than being quietly accepted. `PLAN-09` deliberately kept `words_done` out of the request contract so that this feature would be an internal cleanup rather than a breaking change, and that property is worth something. Bundling a rename throws it away and makes a migration whose stated job is a drop into two structural changes with different risk profiles, one against a column nothing writes and one against the only words column that is live on the write path, the read projection, and the row.

**The name is also not yet wrong.** It becomes misleading once a row holds a slice total rather than a whole project's, and no row can be a slice today outside the seed. So a rename now renames for a model that has no rows in it, and the cheap accurate thing is to say in the comment that the column holds the words for this row's own day, which for an unsplit task is the whole project.

**The honest cost of deferring.** A comment is cheap and it leaves the name wrong, and a wrong name is read more often than the comment beside it. Someone summing `project_word_count` across a split group would double count, and the name invites exactly that. The mitigation is that the comment sits on the column in `schema.ts`, which is where a query author looks, and that the only reader who could make the mistake is the unbuilt quota engine.

**The trigger for the rename, so it is not lost.** `PLAN-18`. Splitting is the feature that first makes a row hold a slice total, it already has to touch the write path and the schema comments, and its own spec has to state what a slice's words mean. It should rename the column with `ALTER TABLE ... RENAME COLUMN` so no data moves, in its own migration, alongside the request-contract change and the client update in one deliberate pass. `word_count` is the obvious target name and it is a recommendation rather than a decision, since `PLAN-18` owns it.

### Decision 2. The heading does not change either, and this is the same question in the UI

**Decided. `planning.columns.words` stays `Mots` in French and `Words` in English. No key changes and none is added.**

The original app headed this column `Mots (total du projet)`, which is worth weighing here rather than ignoring, because the parenthetical is a plain-language version of the name question. It is not adopted, for the same reason and one more.

The parenthetical would be **wrong in exactly the way the column name is**, so importing it now imports a defect that is currently only latent in a database identifier and would become visible copy. `Mots` on its own is true of every row in every model, split or not, which is the property a column header should have.

It also costs width that is not free. The words cell sits in a `7.5rem` track inside a grid whose scroll floor is `min-w-[62rem]`, and a parenthetical qualifier in an eleven-pixel uppercase header is the widest thing in that column once the pair is gone. Spending width to say something that becomes false is the wrong trade twice over.

No copy work follows from this. The French space-before rule for `? ! : ;` is checked and not triggered by `Mots`, and the two fallback strings the cell already uses, `Non précisé` and `Sans objet`, are shipped and confirmed.

### Decision 3. The unsplit task, confirmed against the code rather than asserted

The overview asks this feature to check what happens to a task that is not split, on the expectation that nothing is lost because the row total and the project total are the same number. **Confirmed, and the finding is slightly stronger than the expectation.** For every row a user can create today the two figures are not merely equal, one of them is already `NULL`.

Traced through the shipped code. `TaskCreateSchema` and `TaskUpdateSchema` in `server/models/tasks.ts` accept `projectWordCount` as an optional integer and refuse `wordsDone` outright, `create.ts` and `write.ts` never write `words_done`, and `test/server/api/tasks/handlers/create.test.ts` asserts that every created row leaves it `NULL`. So the user types **one** figure today, into `projectWordCount`, and the column this feature drops is empty on every row the API has ever written.

What the user types, and what the row shows, for the common case.

| The task                             | The user types | The row shows today | The row shows after            |
| ------------------------------------ | -------------- | ------------------- | ------------------------------ |
| Trackable, one day, 12 000 words     | `12000`, once  | `— / 12 000`        | `12 000`                       |
| Trackable, no word count entered yet | nothing        | `—`                 | `—`, with `Non précisé` behind |
| Non-trackable, a break or a meeting  | nothing        | `—`                 | `—`, with `Sans objet` behind  |
| A seeded row carrying both figures   | not applicable | `2 800 / 12 000`    | `12 000`                       |

So the visible change on every row a user can create is that the leading `— / ` disappears, which is precisely the artefact the owner asked to have removed, and the only rows that lose a real number are seeded ones that the same feature rewrites anyway. The common case stays the simple one and it gets simpler.

One consequence for the row's null handling. Today a trackable task with no figures prints the em dash because `wordsDone` is null, and the comment at `TaskRow.vue` line 73 explains that an em dash rather than `0` keeps a planned task from being misread as a recorded zero. **That reasoning survives the drop and transfers to `projectWordCount`**, so the cell still prints the em dash rather than `0` for a null total, and the comment moves rather than going.

## The production row check, and what is actually verified

`PLAN-32a` recorded that no real user task history existed, and it earned a free migration on that basis. **The finding expired on 2026-07-30 when `PLAN-09` landed**, because it rested entirely on there being no task write path and `PLAN-09` is that write path. So this drop is a migration against a table that can hold rows a user created, and the check has to be re-run against **production** rather than inherited from any document and rather than run against a fresh dev database, since a dev database can be seed-only while production is not.

**That check cannot be run here, and it is not faked.** There are no production database credentials in this container. Verified by instrument rather than assumed. `bun run apply-migrations` as a dry run, which writes nothing, reports `Target database: time-tracking-dev-agilbertdev.aws-us-east-1.turso.io` with eight files and eight already recorded, so the configured database is the development one and the production answer is not available from here.

**What was measured, clearly labelled as the development database and not as the production answer.** A read-only count against `time-tracking-dev-agilbertdev` returns 112 task rows, of which 19 have a non-null `words_done`, 38 a non-null `project_word_count`, and 8 a non-null `split_group_id`. Nine of the 19 hold a `words_done` that differs from their own `project_word_count`, so the `lossy` query returns 9 here. Every one of the 112 carries a project name matching the seed's own `P-` and `R-` pattern, which is consistent with the seed having written all of them. Those are the dev seed's rows and they say nothing at all about production. They are reported for one reason, which is that they prove the instrument can return a positive, so a zero from the same query against production would be a finding rather than a broken tool.

**The owner's expectation, recorded as a prediction and not as a finding.** He expects the count of non-seed rows in production to still be zero, because `PLAN-10` does not exist yet, so no interface path has ever called the write API. That is a plausible prediction and it is his, not a verification, and it must not be written up anywhere as a result.

**The exact query he should run against production**, and what each outcome means.

```sql
SELECT COUNT(*) AS total,
       COUNT(words_done) AS with_words_done
FROM tasks;
```

- **`total` is 0.** Nothing to lose and nothing to decide. Apply 0008 as written.
- **`total` is greater than 0 and `with_words_done` is 0.** The expected shape if the write API has been exercised. Real rows exist and none of them carries a `words_done` value, so the drop discards nothing. Apply 0008 as written and record the two numbers in its header.
- **`with_words_done` is greater than 0.** Stop, and do not apply. Some path wrote the column, which contradicts everything below, so the cause has to be found before anything is dropped. Export those rows first, since `DROP COLUMN` is irreversible and the undo statement restores the column empty.

Two follow-up queries if that third outcome fires, so the decision is sized rather than guessed at.

```sql
-- How many of those rows hold something project_word_count does not already carry?
SELECT COUNT(*) AS lossy FROM tasks
WHERE words_done IS NOT NULL AND words_done <> COALESCE(project_word_count, -1);

-- And confirm production is at 0007 before 0008 is applied.
SELECT name FROM _applied_migrations ORDER BY name;
```

A row whose `words_done` equals its `project_word_count` loses no information, because the surviving column already holds the figure. The `COALESCE` is load-bearing rather than defensive, since a plain `words_done <> project_word_count` silently drops the rows where the project total is `NULL`, and those are the rows that lose the most. So `lossy` is the number that decides whether anything is being thrown away, and it can be zero even when `with_words_done` is not. The ledger query guards a different failure. An empty result means production was migrated by hand before the runner existed, in which case `--baseline` runs once after its schema is confirmed current, per the runner's own instructions.

**Now the distinction that matters most in this spec, and it is a different claim from the row count.** Even if production holds real user rows, **their `words_done` is `NULL` by construction**, because the write API cannot write the column. This is evidence rather than an expectation, and it is what materially lowers the risk of the drop.

- [`server/api/tasks/handlers/create.ts`](../../../server/api/tasks/handlers/create.ts) lines 20 to 21 and [`server/models/tasks.ts`](../../../server/models/tasks.ts) lines 121 to 122 both document that the column is never written.
- [`server/api/tasks/handlers/write.ts`](../../../server/api/tasks/handlers/write.ts) line 15 records that `wordsDone` has no entry in the field mapping at all, so no request can reach it however it is shaped.
- A standing guard, `words_done is never written (AC30)` in [`test/server/api/tasks/write-boundary-guards.test.ts`](../../../test/server/api/tasks/write-boundary-guards.test.ts) around line 329, asserts the write handlers do not so much as mention the field, and [`create.test.ts`](../../../test/server/api/tasks/handlers/create.test.ts) asserts that every created row leaves it `NULL`.

**Keep the two claims apart.** "There are no rows" is unverified from here and is the owner's prediction. "Any rows that exist have a null `words_done`" is verified from the shipped code and the shipped suite. The second is the one that makes this drop safe, and it holds even if the first turns out to be false, which is why it is worth more than the row count. The row count still gets run, because it is the only thing that can catch a write path nobody in this document knows about.

**This does not block the build.** The overview's `AC3` asks for the migration applied against the **dev** database, which is available here and needs no production knowledge. The production check gates the owner's manual production run, which is his step for every migration in this repo per 0007's header, and it is carried as an [outstanding item](#outstanding-items-and-open-questions) rather than as a blocker on the pipeline.

## Migration 0008, and the live reader that changes the ordering

`0008_drop_tasks_words_done.sql`, hand-authored plain SQL, one statement.

```sql
ALTER TABLE `tasks` DROP COLUMN `words_done`;
```

It follows 0007's shape, which is the direct precedent, and its header comment block has to cover the same six things. Five are the same argument with a different column name and one is genuinely different.

1. **What is dropped and why nothing real is lost.** Naming the write path that never wrote it and the two production numbers from the check above, so the header cannot honestly be written before the check is run.
2. **Why a plain `DROP COLUMN` is permitted.** SQLite has supported it since 3.35, and `words_done` is not a primary key, not unique, not indexed, not referenced by a constraint or a generated column, so the create-copy-swap dance is unnecessary. The table's only index is `tasks_user_id_date_idx` on `(user_id, date)`.
3. **The expand-then-contract ordering, which is where 0008 differs from 0007 and has to reason for itself.** 0007's column was selected by nothing, so its ordering note was almost free. **`words_done` has a live reader.** `TASK_COLUMNS` in [`projection.ts`](../../../server/api/tasks/handlers/projection.ts) line 34 genuinely selects it, and that projection backs the list endpoint and both write responses. So the four combinations are not symmetric.

   | Deployed code           | Column present | Column dropped                                  |
   | ----------------------- | -------------- | ----------------------------------------------- |
   | Old, still selects it   | works          | **breaks.** Every task read is `no such column` |
   | New, does not select it | works          | works                                           |

   **The safe order is therefore the deploy first and the migration strictly after**, never the reverse and never in the same step. Applying 0008 before the new build is live takes the whole planning week down rather than degrading it, because `listTasks` fails at the query. The header must say this in those terms rather than repeating 0007's gentler "safe in both directions", which is true of 0007 and false here.

4. **The undo, stated precisely.** One statement restores a schema an old build can run.

   ```sql
   ALTER TABLE `tasks` ADD `words_done` integer;
   ```

   The contents do not come back. On dev that used to be recoverable with `bun run seed`, and after this feature it is not, because the seed stops writing the column. So the honest note is that the undo restores a working old build and no values at all, which costs nothing here because nothing real was in them.

5. **Idempotency, stated correctly, and 0007's note on this is stale.** 0007's header says a re-run is safe because "this statement is applied through a runner that tolerates the benign no such column error and continues". The shipped runner does the opposite. [`apply-migrations.ts`](../../../scripts/apply-migrations.ts) lines 137 to 145 say "No error is tolerated", and its own header explains why it abandoned error tolerance for a ledger, which is that a data migration's replay failure is indistinguishable from a genuine break. **Idempotency in this repo comes from the `_applied_migrations` ledger**, which never executes a recorded file a second time, so a re-run of `bun run apply-migrations` is a no-op because 0008 is skipped rather than because its error is swallowed. 0008's header must say that and must not copy 0007's wording. **0007 itself is not edited. Ruled on by the owner on 2026-07-30 and closed.** Applied history does not get edited, and that rule is worth more than the fix. **The wrong sentence in 0007 is therefore a known recorded defect rather than one silently carried**, and it is named in this feature's entry in `docs/pipeline.md` so a later reader can tell it was seen and left standing on purpose. Recording it is the whole point of leaving it, because an uncorrected error nobody wrote down is indistinguishable from one nobody noticed.
6. **The do-not-auto-run warning**, matching 0007. There is one real user and the production application is manual and the owner's. Nothing in the pipeline runs the migration script, and CI, a deploy hook, and a dev-boot runner must all stay pointed away from it.

## Outputs and acceptance criteria

The overview's four criteria are carried here and expanded. Its `AC1` becomes `AC1`, its `AC2` becomes `AC2` and `AC7`, its `AC3` becomes `AC3` and `AC4`, and its `AC4` becomes `AC8`.

### AC1. The words cell is one figure, the row's own total

`TaskRow.vue` prints one number in the `Mots` cell, formatted with the existing `formatCount` and the active locale, right-aligned and tabular as it is today. The `wordsDone` computed at lines 77 to 79 goes, the `projectWords` computed survives as the cell's only figure, and the slash and the second span at lines 209 to 212 go with the pair.

The null and non-applicable branches keep their current shapes and their current keys. A non-trackable task prints the em dash with `planning.notApplicable` behind it. A trackable task with no total prints the em dash with `planning.notSet` behind it, rather than `0`, and the reasoning for that is moved from the `wordsDone` comment onto the surviving figure rather than deleted. An excluded task shows its real figure in full, because the app records reality and the `hors stats` marker is what says it does not count.

Verifiable on the seeded week, where no row prints a slash in the words column, and by grepping `TaskRow.vue` for `wordsDone` and finding nothing.

### AC2. `words_done` is gone from the schema and from every reader

The column and the field are removed from all seven non-test surfaces, each verified as a real reader rather than assumed.

| File                                      | What goes                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `server/db/schema.ts`                     | The column at line 87, and the comment at line 84 (see `AC7`)               |
| `server/models/tasks.ts`                  | The `TaskListItem` field at line 88, and the comments at 121 to 122 and 221 |
| `server/api/tasks/handlers/projection.ts` | The select entry at line 34, the only live reader                           |
| `server/api/tasks/handlers/create.ts`     | The comment at lines 20 to 21                                               |
| `server/api/tasks/handlers/write.ts`      | The comment at line 15                                                      |
| `shared/planning.ts`                      | The `PlanningTask` field at line 20                                         |
| `app/components/planning/TaskRow.vue`     | The comment at line 73, the computed at 77 to 78, the template at 204       |
| `scripts/seed.ts`                         | The `SeedTask` field at 106 and the three assignments at 354, 441, and 472  |

`server/db/migrations/0004_add_tasks_table.sql` line 45 is **not** edited. It is the historical DDL of an applied migration and rewriting it would make the ledger describe a file that never ran.

The seed's three assignments each need a decision rather than a deletion. Line 354 sets a phase-dependent value on every generated row, line 472 does the same for the Saturday row, and line 441 sets a late task's partial progress with a comment saying it "keeps the words column meaningful next to the red badge". That comment stops being true, since the column is now a static total that lateness does not touch, so the line goes and the comment goes with it rather than the value being moved onto `projectWordCount`, which already holds the right figure.

- **AC2 is verified by a grep**, not by a reading. A search for `words_done` and `wordsDone` across `app/`, `server/` excluding `migrations/`, `shared/`, `scripts/`, and `i18n/` returns nothing, in executable code and in comments alike. `AC9` makes that grep a standing test.

**And the seed's split pair needs one more change, which is the substantive edit in this feature rather than a deletion.** `scripts/seed.ts` line 408 overwrites **both** slices' `projectWordCount` with the sum of the two, so both rows carry the whole project's total while each keeps its own day's figure in `words_done`. That is the old two-column model expressed in data. Remove the column and leave that line and each slice keeps a total it did not do.

Measured on the dev database rather than reasoned about, because the numbers make the case better than the argument does. The seeded pair `P-1033` is two rows, 2026-07-08 and 2026-07-09, both carrying `project_word_count` 6400, with `words_done` of 3600 and 2800 that sum to exactly that. Today the row prints `3 600 / 6 400` and `2 800 / 6 400`, and the pair reads correctly. After the drop, with line 408 left alone, it prints `6 400` and `6 400`, and a quota summing row totals over that week gets 12 800 for a 6 400-word job.

**So line 408 goes, and each slice carries an equal share of the job total instead of the whole of it.** Decided by the owner on 2026-07-30, in his words, "seed can split equal, but the split feature will later ask how many words each part". The job total stays what it is today, the sum of the two slices' own figures, and each slice gets half of it. **Any odd remainder goes on the first slice, so the pair sums to exactly the job total rather than being off by one.** For the `P-1033` pair whose job total is 6400, both slices become 3200. The comment above the block is rewritten to say so.

An earlier draft of this criterion asked for the honest uneven per-day figures instead, on the grounds that they read as more realistic. **That is overruled and equal is what ships.** Uneven numbers here would be invented detail dressed as data, and the uneven case is the product's to collect rather than the seed's to guess.

The pair stays linked by `splitGroupId`, the client, the project, and the shared delivery, which is everything that makes it one logical task, and it stops sharing the one figure that is now per row. Afterwards a reviewer can add the two slices' words on screen and get the job total, which is the new model made visible in the only place it is visible at all.

**Equal division is reference data and it is not the product behaviour. The two must not be confused.** The seed divides equally because it needs plausible rows and has no user to ask. **`PLAN-18` asks the user how many words each part gets**, because only they know how far they actually got on the first day, and a job split across two days is almost never split evenly in reality. So nobody reading `scripts/seed.ts` should infer that halving is the model, and nobody building `PLAN-18` should reach for an automatic division because the seed does one. This is recorded in the `PLAN-18` section of [`overview.md`](overview.md) as well as here, because that is the document a reader opens to find out what `PLAN-18` is, and a product rule recorded only in the feature that happened to expose it has been recorded in the wrong place.

This is in scope rather than `PLAN-18`'s, and the distinction is worth stating because it is easy to defer. `PLAN-18` owns the flow that creates slices and the interface for splitting. It does not own **what a slice's words mean**, because that was decided on 2026-07-29 in the same breath as the drop, that each row carries the words actually done that day as its own total. Leaving the dev data contradicting a decided model would mean the seeded week, which is the reference shape every later feature reads and the screen the owner judges this change on, shows the exact double count the drop is supposed to have replaced with something better. That is a defect this feature introduces, so it is this feature's to not introduce.

### AC3. Migration 0008 is written, and its header carries the arguments above

`server/db/migrations/0008_drop_tasks_words_done.sql` exists, contains the single `ALTER TABLE` statement, and its header covers all six items under [migration 0008](#migration-0008-and-the-live-reader-that-changes-the-ordering). Two of the six are the ones a reviewer should check hardest, because they are the two where copying 0007 gives the wrong answer.

- The ordering note reckons with a live reader and states that the deploy lands first and the migration strictly after, with the old-build-plus-dropped-column case named as a hard failure rather than a safe window.
- The idempotency note attributes idempotency to the `_applied_migrations` ledger and does not repeat 0007's claim that the runner tolerates a benign error.

### AC4. It is applied against the dev database, and production stays the owner's step

`bun run apply-migrations --yes` is run against the development database, `0008` appears in the ledger, and a second run reports nothing pending. Afterwards `PRAGMA table_info(tasks)` on dev lists no `words_done`, and `bun run seed` completes and the planning week renders, which together prove the drop and the seed rewrite agree.

Production is **not** applied by this feature. The production row check under [the production row check](#the-production-row-check-and-what-is-actually-verified) runs first, the owner applies 0008 by hand as he has for 0000 through 0007, and this spec's job is to hand him the query, the outcomes, and the ordering rather than to run any of it.

### AC5. The column keeps its name and the heading keeps its copy

`project_word_count` is not renamed, `planning.columns.words` still reads `Mots` and `Words`, and no i18n key is added, removed, or reworded. Both decisions and their reasoning are `Decision 1` and `Decision 2` above, and both are recorded rather than silent so a later reader finds a choice instead of an oversight.

A diff touching `i18n/locales/*.json` or renaming a words column is scope drift against this criterion.

### AC6. The surviving column says what it actually holds

`schema.ts` gains a comment on `projectWordCount` saying that it holds the words for this row's own day, which for an unsplit task is the whole project, and that a multi-day job is several rows each carrying its own total. It also carries the name warning plainly, that the identifier says `project` and the value is per row, and that `PLAN-18` is the feature that renames it.

This is the mitigation the deferred rename is paying for, so it is a criterion rather than a nicety. A reader who arrives at the column to write a summing query has to find the warning at the column, not two documents away.

### AC7. Nothing is left claiming `words_done` is the quota numerator

The sweep, and it is real work rather than a tidy-up, because the sentences being corrected are exactly the ones a later implementer would trust.

- **`schema.ts` line 84**, "wordsDone is the quota numerator, treated as zero when absent", is replaced by the splitting model. The replacement says the quota sums each row's own total, that splitting is what keeps a multi-day job from counting its whole project on every day it touches, and that `PLAN-18` owns that flow.
- **`server/models/tasks.ts` lines 121 to 122 and line 221**, `create.ts` lines 20 to 21, and `write.ts` line 15 all explain why the column is not written. With no column there is nothing to explain, so they go. **What must survive is the neighbouring rule about `actual_minutes`**, which is a different column pair, is still live, and is the reason those comments read as a pair in the first place. Removing the words half must not thin the durations half.
- **`TaskRow.vue` lines 193 to 197**, the accessibility comment arguing that the slash is read out rather than hidden because "the cell announces as two unrelated numbers under a header that says `Mots`", is void. There is no slash. It goes rather than being reworded, and `AC11` covers what the cell announces now.
- **`docs/specs/planning/extend-tasks.md` `AC20`** already carries a superseded note pointing at the overview. This feature discharges it, so the note becomes "implemented by `PLAN-33`" with a link here, matching how `PLAN-32c` discharged its own predecessors.
- **`docs/specs/planning/task-write-api.md`'s `words_done` section** is annotated rather than rewritten. Its reasoning was correct when written and it is the record of a decision, so it gains a line saying the column was dropped by `PLAN-33` and that `AC29` to `AC31` are retired with it. The house pattern is a dated supersession note beside the original argument, not a deletion.
- **`overview.md`'s words section and `PLAN-33` entry** are marked implemented with a pointer to this spec, matching how the two `PLAN-32c` sections read.

Verifiable by grepping the four `docs/specs/planning/` files above plus `server/` and `app/` for `numerator` and for `words_done`, and finding every surviving mention either historical and marked so, or correct under the new model.

### AC8. No progress signal, and the colour budget does not grow

No variance marker, no estimated-against-actual indicator, no per-row performance affordance of any kind. The row draws one duration, which is `effectiveDuration` and unchanged, and says nothing about whether the task beat its estimate.

The colour budget is unchanged and does not grow. Colour still appears only on the status, the category name, and the capacity meter. The words cell carries none, and losing a figure removes the weight contrast between the numerator and the denominator without adding anything in its place.

Verifiable by reading the diff. Any new conditional class, icon, or marker in the words or duration cell is a defect against this criterion.

### AC9. The guards whose subject is gone are removed, and one stronger guard replaces them

Enumerated under [the test surface](#the-test-surface-and-what-becomes-of-a-guard-whose-subject-is-gone), because the recommendation per guard needs the room. The criterion is the outcome. **No test asserts anything about `words_done`, and one new guard asserts that no executable code mentions it anywhere.**

That new guard is the point of this criterion. The suite currently spends four assertions preventing a mirror into `words_done`, and deleting them without replacement would leave the drop uncovered. One repo-wide grep-style assertion, in the same style as the existing `write-boundary-guards.test.ts` source checks, covers `AC2` permanently and is strictly stronger than what it replaces, because it fails on a reintroduction anywhere rather than only in the write handlers.

### AC10. The grid is re-derived and the card still does not scroll the page

The words track is `7.5rem` in an eight-track grid, sized for `2 800 / 12 000`. One figure needs less, so the track is re-derived rather than left as it is, and `DayCard.vue`'s `min-w-[62rem]` scroll floor comes down with it if the tracks shrink.

**The two grid strings must keep agreeing.** `TaskRow.vue` line 110 and `DayCard.vue` line 243 carry the same eight-track `grid-cols-[…]` string in two places, and they change together or the column headers stop sitting above the values they label. The tracks stay fixed rather than `auto`, which is the lesson the row comment already records, since each row is its own grid and an `auto` track sizes to that row's own content.

The card keeps scrolling inside its own container and the page body never scrolls sideways, which is `AC25` of `extend-tasks.md` and WCAG 1.4.10. Any width the drop frees up is a small improvement to the reflow floor rather than a licence to add a column.

The exact numbers are the design stage's. Its brief is narrow, which is the words track width, the resulting scroll floor, and confirming the header still aligns at the narrowest width the card supports.

### AC11. The words cell announces one figure, cleanly

With the pair gone the cell holds one number, so there is no ratio to explain and nothing to keep audible. The `aria-hidden` em dash plus `sr-only` text pattern is unchanged for the two empty cases, so a screen reader hears `Non précisé` or `Sans objet` under a header that says `Mots` rather than a bare dash.

The one thing to check on screen rather than in the diff is that the cell no longer announces two numbers or a stray separator, since the pair's markup is what made that a risk. WCAG 1.4.1 is not engaged here, because nothing in this cell carries meaning through colour.

### AC12. Nothing outside the named surface changes

Verifiable by reading the diff. `isTrackableCategory`, `coerceCategory`, and the category colour contract are untouched. `effectiveDuration` and `formatDeadline` keep their signatures and their behaviour. `settings.quota_wph` and its 450 default are untouched. No route file changes. No request schema changes in behaviour. `splitGroupId` behaviour is unchanged and no splitting is built. Anything else in the diff is scope drift and a defect against this spec.

## The test surface, and what becomes of a guard whose subject is gone

The unit-test stage owns this and it is larger than the implementation, so it is enumerated here rather than discovered mid-run. Nine files are affected.

**The one that fails loudest, and that is fine.** [`test/helpers/taskTestDb.ts`](../../../test/helpers/taskTestDb.ts) declares its own `tasks` DDL on an in-memory client rather than importing the schema, so `words_done` has to come out of `TASKS_DDL` at line 70, out of `TaskRowSeed` at line 136, and out of both the insert column list at line 153 and the args at line 166, and the header comments at lines 10 and 57 that name `SELECT words_done` have to be rewritten. Missing one of those makes every task test fail at insert time with a column-count mismatch, which is loud rather than silent, so this file needs care rather than caution.

**The guards whose subject disappears, with a recommendation for each.** The question is whether a guard is deleted or repointed at the surviving column, and the answer is not the same for all of them.

- **`write-boundary-guards.test.ts`'s `words_done is never written (AC30)` block, around line 329. Delete it, do not repoint it.** Its purpose was to stop a mirror into a column, and with no column there is nothing to mirror. Repointing it at `project_word_count` would invert its meaning, because that column is _supposed_ to be written, and a guard that asserts the opposite of what it used to assert under the same name is worse than no guard at all. Its coverage is not lost, it moves to `AC9`'s repo-wide assertion, which is stronger.
- **The sibling block on `actualMinutes` and `estimatedMinutes`, around line 320. Untouched.** Different column pair, still live, still the rule most likely to be undone by a helpful implementer. It is worth saying explicitly, because the two blocks read as one idea and deleting both is the easy mistake.
- **`write-boundary-guards.test.ts` line 499's migration-list comment.** It already anticipates this feature by name, recording that the guard was deliberately written against a prefix list rather than against `migrations.at(-1)` so that `PLAN-33`'s migration could land without breaking a `PLAN-09` test. It is correct as written and needs no change, which is worth confirming rather than assuming. This is what a forward note looks like when it works.
- **`create.test.ts` around lines 161 to 192. Split it.** The `project_word_count` half of `stores project_word_count and leaves words_done NULL` is a live assertion and stays. The `words_done` half goes, the `leaves words_done NULL on every row it creates` test goes, and the DO-NOT-MIRROR comment block goes with them.
- **`write.test.ts` around lines 142 to 155. Repointed rather than deleted, and it is the one exception to the rule above.** `never mirrors projectWordCount into wordsDone` tests `toTaskColumns`, a pure mapper, and it makes two assertions. `'wordsDone' in columns` is false, which becomes vacuous and goes. But `expect(columns).toEqual({ projectWordCount: 12_000 })` says something that stays true and stays worth protecting, which is that one field in produces exactly one column out and nothing is inferred. That is the anti-mirror rule in its general form and it would catch a mirror into any column rather than only the dropped one. So the test survives with its name changed to say the mapper infers no second column from a words figure, the vacuous line removed, and the exact-equality assertion kept. Its comment is rewritten from "do not add a `words_done` mirror" to the general rule, plus one line recording that the specific mirror it was written against is now structurally impossible. This does not contradict the deletion above, because that block asserted the absence of a name and this one asserts the exactness of a mapping, and only the second has a live subject.
- **`update.test.ts` around line 241.** `never writes words_done when the word count changes` goes. The neighbouring assertion that a patch stores `project_word_count` stays.
- **The field-list and refused-key assertions**, in `create.test.ts` at 91 and 393 to 410, `projection.test.ts` at 77, 105 to 130, and 413, `write.test.ts` at 171, `update.test.ts` at 493, and `models/tasks.test.ts` at 103, 122, 129, and 458. `wordsDone` comes out of each list. These are mechanical and they are the ones a partial edit leaves half done, so a grep is the check rather than a passing run.
- **`sendZodError.test.ts` at lines 131 to 136.** It sends three server-owned keys and expects `['sortOrder', 'splitGroupId', 'wordsDone']` back. It becomes two keys. The test's actual point is that a strict schema reports every unknown key rather than the first, and that survives with two, so this is a narrowing rather than a loss.

**Added coverage, not only moved coverage.** The new repo-wide guard from `AC9`, and one assertion that a task read returns a `TaskListItem` without a `wordsDone` key at all, so the contract shape is pinned rather than merely not asserted.

## Edge cases

### Interrupted and abandoned paths

**The migration is one statement, so there is no partial state.** SQLite's `DROP COLUMN` either completes or it does not, the runner records the file only after every statement in it succeeded, and a failure leaves the file unrecorded so a re-run retries it. There is no half-dropped column to recover from.

**The migration lands and the deploy does not.** This is the one genuinely dangerous ordering and it is the reason `AC3` exists. An old build against a dropped column fails every task read with `no such column`, so the planning week returns a 500 rather than degrading, and the recovery is either finishing the deploy or running the one-line undo from the header to restore a schema the old build can query. Stated as a state to avoid by ordering rather than one to design around.

**The deploy lands and the migration does not.** Safe in both directions and indefinitely. New code never selects the column, so a `tasks` table that still has it behaves identically. This is the window the feature should sit in between the two steps.

**The dev database is migrated and the seed is not re-run.** Rows keep their `project_word_count` and the dropped values are simply gone, so the week renders with totals and nothing is broken. `bun run seed` is the clean reset and it is no longer a full recovery for this column, since the seed stops writing it, which the undo note in the header has to say.

**A session expires or a request is in flight during the drop.** Nothing to recover. The column is read-only in the projection and written by nothing, so an in-flight read either sees it or does not, and neither outcome writes anything.

**Production holds rows nobody expected.** The check catches it before anything is dropped, and the stop-and-export outcome is written into the runbook above rather than left to judgement in the moment.

### Data and display edge cases

**A trackable task with no word count.** The em dash with `Non précisé` behind it, unchanged in shape from today. It prints the em dash rather than `0`, so a planned task is never misread as a recorded zero, and that reasoning moves onto the surviving figure.

**A non-trackable task carrying a word count.** Allowed, stored, and **not printed**, because the cell reads the em dash with `Sans objet` for any non-trackable row before it looks at the figures. `PLAN-09` deliberately accepts a word count on a meeting rather than policing the combination, so the value exists and the cell says the category has no words to report. Unchanged by this feature and worth stating, since the branch order is what makes it true.

**A seeded split pair.** The eight seeded split rows currently share one summed `project_word_count` across both slices, set at `seed.ts` line 408, which is the old whole-project model. **Fixed here rather than deferred**, under `AC2`, because leaving it would have each slice print the whole job and put the double count the drop replaces into the reference data. The measured case and the reasoning for keeping it in scope are with that criterion.

**A real split entered by a user, once `PLAN-18` exists.** Each row carries its own day's words as its own total and the group sums to the project, which is the model. Nothing in the cell needs to know the row is part of a group, because the figure is already the row's own, and the split marker still says the row belongs to something larger. Recorded because it is the case the whole numerator argument rests on and it currently has no rows anywhere.

**A group of one, an interrupted split.** Already a valid state per the `splitGroupId` schema comment, and untouched here. The surviving row prints its own total, which is the words actually done, so a quota reading it sees an honest figure rather than a whole project attributed to one day. That is strictly better than the old model gave, where the surviving row carried the whole project in `project_word_count` and its real figure in the column being dropped.

**A row whose total is very large.** `projectWordCount` is bounded at 10 000 000 by `projectWordCountSchema`, so the widest figure the cell can print is eight digits plus separators. That is what the re-derived track width has to fit, and it is narrower than the pair it replaces even at the bound.

**A locale switch.** `formatCount` already takes the active locale, so the French thin-space grouping and the English comma grouping are unchanged. One figure formats exactly as the first figure of the pair did.

**The em dash cases in a forced-colors environment.** Nothing in this cell carries meaning through colour, so it degrades with no work.

## Outstanding items and open questions

None of these block the build. The first needs the owner and is the only one that gates anything.

1. **The production row check needs the owner.** The query and the three outcomes are under [the production row check](#the-production-row-check-and-what-is-actually-verified). It cannot be run from this container, which was verified rather than assumed, and no dev-database result substitutes for it. It gates the **production** application of 0008 and not the dev application, so the feature can complete `AC1` through `AC12` while this is outstanding. What is verified and what is predicted is separated in that section and must stay separated in any report.

2. **The `project_word_count` rename is deferred, not declined.** `Decision 1` states the tradeoff and pins `PLAN-18` as the trigger. If the owner would rather take the rename now and accept a second structural change in this migration plus a request-contract change for `PLAN-10` to inherit, that is a reasonable call and it is his. The comment from `AC6` is the cost of waiting and it is a real cost.

3. **`Mots (total du projet)` was considered and not adopted.** `Decision 2` gives the reasoning. Recorded as a question rather than buried, because it is the original app's heading and someone will suggest it again.

4. **The progress signal is parked and the four routes are recorded.** [The duration pair is the progress signal](overview.md#the-duration-pair-is-the-progress-signal-and-that-reopens-a-shipped-decision) holds all four, and the variance marker is still the favourite. The row goes quiet in the meantime, which the owner asked for so the simpler row can be judged first. Whatever lands inherits `AC8`'s colour cap.

5. **The quota numerator has no reader yet, so the replacement is untested by anything but reasoning.** `PLAN-22` will be the first code to sum row totals and it is where the splitting guarantee actually gets exercised. Its spec should confirm the model rather than inherit it from a comment, which is the same mistake this feature exists to clean up one level down.

## Stages

Specs and code review are never skipped.

- **Backend runs and leads.** The schema column and its comment, `projection.ts`, `shared/planning.ts`, the model, migration 0008, applying it against dev, the comment sweep in `server/`, and `scripts/seed.ts` including the split-pair word counts under `AC2`. Nothing frontend can be verified against a database that still has the column, and the seed change is what makes the split case reviewable on screen.
- **Design runs, narrowly.** The words track width, the resulting `min-w-[62rem]` floor, and confirming the header alignment at the narrowest supported width. It designs no signal and no marker, per `AC8`.
- **Frontend runs.** `TaskRow.vue` and `DayCard.vue`, the two grid strings together.
- **Unit-test runs**, and its scope is the nine files under [the test surface](#the-test-surface-and-what-becomes-of-a-guard-whose-subject-is-gone) plus the new repo-wide guard. It is the largest stage in this feature by file count.
- **Accessibility runs, briefly.** `AC11` only. Confirm the words cell announces one figure and that the two empty cases still read `Non précisé` and `Sans objet` under `Mots`.
- **Compliance runs, briefly, in parallel with frontend.** This spec originally proposed skipping it, on the grounds that dropping a column changes nothing about what is collected or who can reach it. **The owner overruled that on 2026-07-30 and he is right.** The feature irreversibly drops a column from a table that holds client and project names, so it is a destructive change to a store of personal data, and a checked verdict is worth more than an assumed one even when the expected answer is that nothing is wrong. The stage is narrow. Confirm the drop removes data rather than exposing any, confirm no retention or erasure obligation is affected, and confirm the production row check under [the production row check](#the-production-row-check-and-what-is-actually-verified) is the right gate before an irreversible statement runs against a live user's data.
- **SEO is skipped.** No new page and no new route, and the planning dashboard is behind sign-in and already `noindex, nofollow`.

## Amendments to shipped specs

- [`extend-tasks.md`](extend-tasks.md). **`AC20` is discharged.** Its superseded note, added 2026-07-29 and written in the future tense, becomes implemented by this feature with a pointer here. Its null-handling rules survive with one figure instead of two, the em-dash-rather-than-zero reasoning transfers to `projectWordCount`, and the excluded-task rule is unchanged. `AC14`'s at-rest set still counts the words as one printed field, so the field count does not move. `AC26`'s colour budget still holds, per `AC8`. `AC21`'s duration is untouched.
- [`task-write-api.md`](task-write-api.md). **The `words_done` section is annotated, not rewritten.** Its Route C decision was correct and is the reason this drop is an internal cleanup, so it gains a dated note saying the column is gone as of `PLAN-33` and that `AC29` through `AC31` retire with it. Its `PLAN-32a` expiry section is what sent this feature to production for the row check and it stands unchanged. Its `actual_minutes` sections are untouched and their guards stay.
- [`overview.md`](overview.md). The `PLAN-33` entry and [words are a total](overview.md#words-are-a-total-not-a-progress-pair-deferred-to-a-later-feature) are marked implemented with a pointer to this spec. The words section's `project_word_count` consequence is answered by `Decision 1` and should say which way it went. [The duration pair](overview.md#the-duration-pair-is-the-progress-signal-and-that-reopens-a-shipped-decision) stays open and stays the home of the four routes.
- [`nine-task-categories.md`](nine-task-categories.md). Untouched. `PLAN-09` already annotated its no-history finding as expired, which is the only thing this feature would have had to do there.
- [`tasks-schema.md`](tasks-schema.md). Its column list loses `words_done`, and its fourth open question about the `drizzle-kit generate` meta baseline is unaffected, since 0008 is hand-authored like every migration before it.
- [`category-column-coloured-names.md`](category-column-coloured-names.md). Its non-goal reading "the words total is `PLAN-33`" is discharged. It shipped the pair unchanged on purpose and this is the feature that reduces it.
