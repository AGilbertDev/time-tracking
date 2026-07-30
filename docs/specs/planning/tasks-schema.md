# Tasks schema and migration

## Intent

`PLAN-01` lays the data foundation for the planning dashboard. It adds a single `tasks` table keyed to `users.id`, and it ships no UI. The table stores one row per task-day slice, which is the locked model for multi-day work: a piece of work that spans days is one logical task made of one slice per day, sharing a `project` and a `split_group_id`, each slice carrying its own `words_done` and its own duration. Storing it this way keeps every period statistic (day, week, month, year) a plain indexed range sum over `(user_id, date)` and avoids allocating words at query time, which is exactly the shape the availability-quota engine (`PLAN-22`) needs. The table records raw facts only. It defers all meaning to the contracts and features that own it: the `trackable` flag lives in the `PLAN-02` category contract, the freezing of `estimated_minutes` happens in `PLAN-12`, the quota math is `PLAN-22`, the effective-dated work schedule is `PLAN-03`, and recurrence is `PLAN-19`. The schema stays a permissive record of reality, matching the product rule that the app records what happened and never blocks the user, and validation and coercion sit at the write boundary (`PLAN-09`) rather than in the columns.

## Inputs

This is a backend, data-only feature with no runtime user inputs. Its inputs are the locked data-model decisions from [`overview.md`](overview.md) that the table must serve, and the existing repo conventions it must match:

1. **The availability quota.** `words_translated(period)` is the sum of `words_done` across the trackable tasks in the period, a stored per-day fact rather than a project total. The denominator comes from `PLAN-03`, not this table. The schema must let a period stat be a plain range sum over `(user_id, date)`.
2. **One row per day for multi-day work.** A shared `project` plus a `split_group_id` links the slices of one logical task; each slice sits on exactly one date and carries its own `words_done` and duration. No word allocation at query time.
3. **Frozen estimate and per-task override.** `estimated_minutes` is computed once from `words / quota` and stored frozen (`PLAN-12`); at this layer it is just an integer of minutes. `quota_wph_override` is a nullable per-task override of the user's default quota (`settings.quota_wph`).
4. **Category and status are free text here.** The `trackable` flag and the category name set live in the `PLAN-02` shared contract, mirroring how theme ids are free text coerced at read through `coerceThemeId`. Status applies only to trackable tasks; non-trackable tasks are `N/A`. The write API (`PLAN-09`) validates and coerces both.
5. **The existing data layer.** `server/db/schema.ts` owns the table (Drizzle `sqliteTable`, `text`/`integer` columns, snake_case DB names with camelCase JS keys, `integer(..., { mode: 'timestamp' })` instants defaulted with `$defaultFn(() => new Date())`, and `foreignKey(...)` in the table callback). The `users` table is the parent. `shared/` owns cross-cutting contracts; this feature does not add one (that is `PLAN-02`).

## Outputs and acceptance criteria

### The tasks table

A new `tasks` table in `server/db/schema.ts`, following the exact style of the tables already there. The column contract is below (JS key on the left, DB column name in the middle):

| JS key | DB column | Type | Null? | Notes |
| --- | --- | --- | --- | --- |
| `id` | `id` | `text`, primary key | no | `$defaultFn(() => crypto.randomUUID())`, matching `users.id` and `settings.id`. |
| `userId` | `user_id` | `text` | no | Foreign key to `users.id`, `onDelete: 'cascade'` (see decisions). |
| `date` | `date` | `text` | no | The calendar day this slice belongs to, `'YYYY-MM-DD'`. The range key for period sums. |
| `client` | `client` | `text` | yes | Free text. Absent on non-trackable tasks (a break has no client). |
| `project` | `project` | `text` | yes | Free text. Shared across the slices of a split group. |
| `category` | `category` | `text` | no | Free-text category id. `trackable` lives in `PLAN-02`; coerced at read, validated at `PLAN-09`. |
| `deliveryDate` | `delivery_date` | `text` | yes | Deadline calendar day, `'YYYY-MM-DD'`. |
| `deliveryTime` | `delivery_time` | `text` | yes | Deadline wall-clock time, `'HH:MM'` (24-hour). |
| `projectWordCount` | `project_word_count` | `integer` | yes | Total project words. Integer count. |
| `wordsDone` | `words_done` | `integer` | yes | Words completed on this slice, on this day. The quota numerator fact; the engine treats absent as zero. |
| `quotaWphOverride` | `quota_wph_override` | `integer` | yes | Per-task override of the default quota. `NULL` means use the user's default. |
| `estimatedMinutes` | `estimated_minutes` | `integer` | yes | Frozen computed duration in minutes (`PLAN-12`). Just an integer here. |
| `actualMinutes` | `actual_minutes` | `integer` | yes | Real duration in minutes. Mirrors estimated until edited (`PLAN-12`). |
| `status` | `status` | `text` | yes | Free text. Trackable only (`Accepté` / `En cours` / `Terminé`); `NULL` reads as `N/A` for non-trackable. |
| ~~`instructions`~~ | ~~`instructions`~~ | ~~`text`~~ | ~~yes~~ | **Superseded.** Dropped in migration `0007`, see [extend-tasks.md](extend-tasks.md). No write path ever populated it. It was free-text notes for the task, and the owner dropped the `Consignes` field it backed. |
| `exclude_from_stats` | `excludeFromStats` | `integer` (boolean) | no, defaults false | **Added later**, in migration `0006`, see [extend-tasks.md](extend-tasks.md). Marks a trackable task whose words leave the quota numerator and whose time leaves the effective-hours denominator. |
| `splitGroupId` | `split_group_id` | `text` | yes | Plain grouping key (a uuid). `NULL` for a single-day task. No self-FK (see decisions). |
| `sortOrder` | `sort_order` | `integer` | no | Within-day ordering, default `0`. The write API assigns it; drag reorder (`PLAN-15`) mutates it. |
| `createdAt` | `created_at` | `integer` (`mode: 'timestamp'`) | matches `users` | `$defaultFn(() => new Date())`, Unix-seconds instant. |
| `updatedAt` | `updated_at` | `integer` (`mode: 'timestamp'`) | matches `users` | `$defaultFn(() => new Date())`, Unix-seconds instant. |

Word counts (`project_word_count`, `words_done`) and durations (`estimated_minutes`, `actual_minutes`) are stored as plain integers, durations as whole minutes. The two timestamp columns are true instants and use the repo's integer Unix-seconds `mode: 'timestamp'` pattern, matching `users.created_at` and `users.updated_at` exactly (no `.notNull()`, defaulted through `$defaultFn`).

- **AC1.** The `tasks` table exists in `server/db/schema.ts` with exactly the columns above and the stated SQLite types (`text` vs `integer`, and `mode: 'timestamp'` on the two instants). The generated migration applies cleanly on a fresh SQLite database and the resulting columns match the contract, verifiable with `PRAGMA table_info(tasks)`.
- **AC2.** A foreign key ties `user_id` to `users.id`, declared through `foreignKey(...)` in the table callback in the same style as `settings`, with `onDelete: 'cascade'` added. Every task row therefore belongs to exactly one user.
- **AC3.** A composite index covers `(user_id, date)` in that column order (`user_id` first for the equality match, `date` second for the range), named descriptively (for example `tasks_user_id_date_idx`). `PRAGMA index_list(tasks)` and `PRAGMA index_info(...)` confirm the index and its column order. This is what makes a period stat a single indexed range scan (`overview` AC2).

### Decisions this schema locks

**On-delete: `cascade` on the user foreign key.** Deleting a user deletes that user's tasks. The rationale: a user's tasks are their own personal data with no reason to outlive the account, so a cascade gives a clean deletion, produces no orphan task rows pointing at a user that no longer exists, and supports a future data-erasure path (`PLAN-29` and the erasure follow-up already tracked on the project) without a manual sweep. This is a deliberate departure from the existing `settings` foreign key, which declares no `onDelete`; Feature 6's compliance pass already flagged adding `onDelete: 'cascade'` to `settings` as a follow-up, so this table adopts the correct behavior from the start rather than inheriting the gap. The alternatives were rejected: no action or `restrict` would leave orphan rows or block deletion (an invalid state), and `set null` is impossible because `user_id` is `NOT NULL` and a task with no owner is meaningless.

- **AC4.** The on-delete behavior is `cascade`, recorded here and implemented on the foreign key. Deleting a user row removes all of that user's task rows and leaves no task with a `user_id` that has no matching `users.id` (verifiable by deleting a user in a test database with foreign-key enforcement on and confirming the tasks are gone).

**Recurrence columns are deferred to `PLAN-19`.** The `overview` `PLAN-01` column list mentions "recurrence fields," but they are not added here. `PLAN-19` is its own backend-plus-frontend feature that designs and owns the full recurrence model (weekday selection, a start and an optional forever end, and the this-one / this-and-following / all edit scopes). Adding placeholder recurrence columns now would ship dead columns with no reader and would likely be the wrong shape once `PLAN-19` is specified. The table stays lean and `PLAN-19` adds its own columns (or its own table) with its own migration when it lands.

- **AC5.** No recurrence columns exist in `tasks`. `PRAGMA table_info(tasks)` returns exactly the columns in the contract above and nothing recurrence-related. The deferral to `PLAN-19` is recorded here.

**Date storage: text for calendar and clock values, integers for instants.** `date` and `delivery_date` are stored as `text` in `'YYYY-MM-DD'` ISO 8601 form, and `delivery_time` as `text` in `'HH:MM'` 24-hour form. They are deliberately not integer `mode: 'timestamp'` columns. The reasons:

- A task `date` is a calendar day, not an instant. Lexicographic ordering of `'YYYY-MM-DD'` equals chronological ordering, so `WHERE user_id = ? AND date >= ? AND date <= ?` is a correct, index-friendly range scan over `(user_id, date)`, which is precisely the query the period stats need.
- A calendar day stored as text has no timezone ambiguity. If it were a Unix-seconds instant, "which day is this" would depend on the query's timezone, and range queries like "all of July" would drift at the boundaries. The user's timezone already lives on `settings.timezone` and is used to decide the calendar day at write time; the stored value is then a plain, timezone-free date.
- `delivery_time` is a wall-clock time-of-day, not an instant either, so it is text for the same reason. `delivery_date` and `delivery_time` stay two separate columns (as the `overview` lists them) so a task can carry a deadline day with no specific time.
- This keeps a clean rule in the schema: true lifecycle instants (`created_at`, `updated_at`) are integer Unix seconds through `mode: 'timestamp'`, matching every other timestamp in the repo, while calendar and clock values that must sort and range as dates are text. It also matches how the repo already stores structured non-instant values as text (for example `settings.work_days` as a JSON string).

- **AC6.** `date` and `delivery_date` are `text` holding `'YYYY-MM-DD'`; `delivery_time` is `text` holding `'HH:MM'`; `created_at` and `updated_at` are integer `mode: 'timestamp'`. A range query of the form `WHERE user_id = ? AND date BETWEEN ? AND ?` returns exactly the rows whose calendar day falls in the range, in date order, using the `(user_id, date)` index.

**`split_group_id` is a plain nullable grouping key, no self-FK.** It is a nullable `text` column holding a shared uuid across the slices of one logical multi-day task. It is deliberately not a self-referential foreign key to another `tasks.id`. All slices in a split group are peers with no canonical parent row, so a shared opaque group id is enough to group or filter them, and it keeps a period stat a plain range sum over `(user_id, date)` with no join. A self-FK would invent a parent/child relationship the model does not have and would introduce a second cascade path to reason about.

- **AC7.** `split_group_id` is a nullable `text` column with no foreign-key constraint. A single task row may carry a `split_group_id` (a group of one) without violating any constraint, so the split flow (`PLAN-18`) can never leave a dangling reference. Confirmed by inserting one row with a `split_group_id` and no sibling and seeing it accepted.

### Migration

The migration is generated locally with `bunx drizzle-kit generate` (dialect `turso`, out `server/db/migrations`) and reviewed, landing as the next sequential file (expected `0004_add_tasks_table.sql`) in the same statement-broken style as `0000`–`0003`. The command of record is `generate`, not the `push` named in the `overview` `PLAN-01` sketch: `push` writes directly to a live database and needs credentials this environment does not have, whereas `generate` produces a reviewable SQL file that the owner applies by hand, which is exactly how every migration in this repo is already maintained.

- **AC8.** A migration for the `tasks` table lands in `server/db/migrations/` and applies cleanly on a fresh SQLite database, creating the table, the `user_id` foreign key with `onDelete: 'cascade'`, and the `(user_id, date)` index. It is produced with `bunx drizzle-kit generate` (or hand-authored to match, consistent with how `0000`–`0003` are maintained) and matches `schema.ts`.

**Migration is generated only, not applied to production.** There are no production database credentials in this sandbox, so the migration is written and verified locally but is not applied. Applying it against the production Turso database remains an owner step, matching how Features 2, 4, and 5 recorded this. The new table does not exist in production until the owner runs it. It must not be pointed at a live database by CI, a deploy hook, or a dev-boot runner.

## Edge cases

- **Deleting a user with tasks.** With `onDelete: 'cascade'`, the user's task rows are removed with the user, leaving no orphans and no invalid state, and giving a future erasure path a clean sweep. The safe recovery from a user deletion is that the system is fully consistent afterward with nothing to reconcile.
- **Cascade depends on foreign-key enforcement being on.** SQLite does not enforce foreign keys (and therefore does not fire `ON DELETE CASCADE`) unless `PRAGMA foreign_keys = ON` is set on the connection, which is off by default. For the no-orphan guarantee in AC4 to actually hold, the backend stage must confirm the libSQL / Turso client used by the app has foreign-key enforcement enabled. This is a verification item for the backend stage, not something the schema alone can guarantee.
- **An interrupted split.** The split flow (`PLAN-18`) creates two rows sharing a `split_group_id`. If it is abandoned after the first row and before the second, the result is a single valid row that happens to carry a `split_group_id` (a group of one). Because `split_group_id` has no foreign key and no minimum-membership constraint, this is a fully consistent state, not a dangling reference, and recovery is simply completing or abandoning the split later. The schema must not enforce "a split group has at least two members," which would turn a normal mid-flow state into an invalid one.
- **A non-trackable task's empty fields.** A meeting or a break has no client, no project, no delivery, no words, and no status. Those columns are nullable precisely so the app can record such a task truthfully rather than forcing placeholder values. The quota engine (`PLAN-22`) reads no words from it and its category (via `PLAN-02`) removes its duration from effective hours.
- **Work on a non-work day.** A task can be stored on any calendar day, including one whose scheduled length is zero. The schema places no constraint on `date` against the work schedule; the day-quota meaning of such a row is the engine's concern (`PLAN-22`), and the app never blocks the entry.
- **A stale or unknown category or status.** Because `category` and `status` are free text, a value can arrive that is not in the current known set (a renamed or retired category, or an unexpected status). This is intentional and mirrors the theme-id pattern: the read path coerces through the `PLAN-02` category contract and the `PLAN-09` status handling to a safe rendering value, so a stale stored string never reaches the UI raw. The column itself imposes no enumeration.
- **Re-applying the create migration.** A `CREATE TABLE` / `CREATE INDEX` migration is not idempotent on its own; a second run against a database that already has the table errors on the duplicate. This matches how the repo's other generated creates are applied once, by hand, by the owner. Making re-application tolerant (as `0003` documents for its column add) is an apply-time concern for the owner and the backend stage, not a schema change.

## Open questions

None block this schema. The items below are recorded so the downstream stages resolve them deliberately.

**Questions 1, 2, and 3 are now resolved.** Each named `PLAN-09` as the feature that would settle it, because the table was left permissive on purpose so the meaning would be enforced at the write boundary rather than in the columns. That boundary has been built, so the answers are in [`task-write-api.md`](task-write-api.md) and are summarised inline below. Question 4 is untouched, since that feature writes no migration.

1. **Status vocabulary (soft, `overview` open question 5).** ~~The three trackable status names are `Accepté` / `En cours` / `Terminé`, with `N/A` for non-trackable, still to be confirmed with the user.~~ **Resolved by `PLAN-09`.** The stored set is the three French values plus `NULL`, and it is now a validation enum read from the `TASK_STATUSES` tuple in `shared/planning.ts`. `N/A` is a display value the read path derives and is refused as a stored one. The accents are load-bearing, since the late comparison matches the finished value as a literal string. One thing did not change. The names themselves are still unconfirmed with the user, and hoisting them into one tuple is what keeps a rename to a single edit rather than removing the need to ask. From here a rename is a data migration rather than a copy change.
2. **Mandatory-field list.** ~~Which columns are required on save is an open question tied to the row layout and field set on the mockup.~~ **Resolved by `PLAN-09`.** It is `date` and `category`, and nothing else, because those are the only two `NOT NULL` columns without a default. The write boundary enforces only what the schema requires, on the principle that it should not refuse a task the database would accept, so any richer requirement belongs to `PLAN-10`'s form validation rather than to a 422 from the API.
3. **Keeping `updated_at` fresh.** ~~Whether to add a Drizzle `$onUpdate(() => new Date())` or have the `PLAN-09` write API set `updated_at` on every mutation is left to the backend stage.~~ **Resolved by `PLAN-09`.** The write API sets it explicitly on every mutation and the table adds no `$onUpdate`, which is the default this question already expected and which keeps `tasks` matching the `users` pattern it was built to match.
4. **`drizzle-kit generate` with no meta baseline.** The repo keeps no `drizzle-kit` meta snapshot directory (documented in `0003`), so a naive `generate` has no baseline to diff against and would emit a whole-schema migration. The backend stage should author the tasks migration as the next sequential `0004` file in the established hand-broken style (seeding a meta baseline first if it chooses to lean on `generate`), so the committed migration contains only the tasks addition.
