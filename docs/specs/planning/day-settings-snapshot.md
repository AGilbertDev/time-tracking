# The day settings snapshot

## Intent

A day's throughput is measured against how long that day was supposed to be, and that length is a
mutable setting. Changing it next month would silently rewrite every past figure. This makes a day
record the settings in force on it, once something is logged on that day, so a later settings change
can never reach backward. It is the same snapshot the quota already uses on a task, applied to the
work schedule.

## Prior art

Two industries solve this and they disagree with each other.

**Payroll and HR effective-date it.** Workday and Oracle HRMS write a new row per change carrying a
validity period, and payroll honours the effective date rather than the date the change was entered.
This repo already has that shape in `work_schedule`. Their reason is specific, which is that payroll
must answer what someone earned on a past date even when nothing happened on it.

**Accounting snapshots onto the transaction.** An invoice line stores the price it was sold at, which
is why a price rise never restates last quarter. The owner approved exactly this for quotas on
2026-08-24, where a task carries the figure it was written against.

**Clockify is the closest analogue in a real time tracker, and it picks neither.** Changing an hourly
rate asks which of three things is meant. Apply to new entries only, apply from a chosen date onward,
or apply to everything past and future, whose documented example is that the old rate was wrong. So
the industry treats "does this rewrite the past" as a decision made per change rather than as a
property of the schema.

**Calendar apps are the wrong reference class**, checked rather than assumed. Google Calendar's
working-hours change affects only future invites and leaves existing events alone, but it computes
nothing retrospective against those hours, so it has no figure to protect and never faces the
question.

Where this lands. The snapshot is the default, because it is the owner's instruction and the pattern
already in the repo. Clockify's third option is the reason the stamp is an **updatable row rather than
an append-only log**, so a genuinely wrong setting has a correction path later without a migration.

## Inputs

No new endpoint and no new user action. Three existing paths gain a write.

- `POST /api/tasks` and `PATCH /api/tasks/[id]`, which stamp the affected day.
- `PATCH /api/me/work-settings`, which refreshes today and any already-stamped future day.

Every value comes from the user's own `settings` row, never from a request body.

## Outputs and acceptance criteria

AC1. A new `day_settings` table, one row per user and date, holding `work_minutes`, `work_days` and
`buffer_minutes`, with a unique index on `(user_id, date)` and a cascading foreign key to `users`.
Migration `0014`.

AC2. Creating a task on a date with no row writes one carrying the user's current settings. A date
that already has a row is left alone, so the first write creates the stamp and later tasks on that day
do not recreate it.

AC3. Moving a task to a date with no row stamps that date. The date it left keeps its row, because a
day that once held work is a day whose settings were real.

AC4. Saving work settings updates every row dated today or later and touches no row dated earlier.
That is what makes a day hold the last setting saved on that day, and what makes a past day
untouchable.

AC5. `buffer_minutes` is stamped even though `settings` carries no such column today. The value is
`DEFAULT_SCHEDULE`'s 60 until a real setting exists, so adding that setting later needs no migration.

AC6. The resolution order for any date is the day's own row, then the effective-dated `work_schedule`
through the shipped `resolveSchedule`, then the user's **current settings row**, then
`DEFAULT_SCHEDULE`. A day nobody worked has no row and still resolves.

The current settings tier was added on 2026-09-07 after code review. Without it an unstamped day
answered with the shipped 7 h 30 rather than the hours actually set, so a six-hour day had every
leftover overstated by 90 minutes per unstamped day and the same day reported 7 h 30 before its first
task and the real figure after. Reaching for the live row does move the leftover on past days that
were never logged, which is accepted rather than overlooked, since such a day holds no recorded work
so the figure moving is noise where the shipped default was simply wrong. The same review found the
dashboard capacity meter reads only `work_schedule` and so shows 7 h 30 whatever the setting says,
which is pre-existing, not this feature's to fix, and recorded in `docs/TODO.md`.

AC7. A failed stamp never blocks a task write. The task still lands and the failure is logged, because
refusing to record real work over a bookkeeping row would police the user, which `spec.md` §2 forbids.

AC8. The resolver is pure and database-free, taking a date, a day row or null, the schedule records,
and the user's current settings or null, so every criterion is testable against fixtures with no
database. Telling AC6's second tier from its third needs something the shared layer did not expose,
since `resolveSchedule` answers with `DEFAULT_SCHEDULE` for an empty history and cannot say whether a
record applied. `shared/planning.ts` gains an exported `hasScheduleOnOrBefore(records, date)`, keeping
the rule in the file that owns effective dating, with the same inclusive lower bound.

AC9. `work_days` is stored as JSON text and read through the same defensive coercion
`loadWorkSchedule` already applies, so a corrupt value falls back rather than reaching the engine. It
falls back to that coercion's own default set and never to the next AC6 tier, because a row that
exists is not a missing row. A legitimately empty array stays empty, meaning a week with no work days,
which is a real setting rather than a corrupt one.

AC10. Every stamp path is scoped to the session user, so no write can reach another user's day.

AC11. The `work_days` coercion AC9 names exists once. It had been copied byte for byte into
`loadWorkSettings` and `loadWorkSchedule`, and this feature would have been the third copy, so it
moves to `shared/planning.ts` and both existing readers import it. Behaviour is unchanged for both,
which their own suites prove, and the resolver can reach it without reaching a database.

## Edge cases and interrupted paths

- A task created on a future day. Stamped now, kept current by AC4 until the day passes, frozen after.
- A task deleted, leaving the day empty. The row stays. Deleting the last task does not unmake the
  fact that the day was worked, and dropping the row would lose the settings if a task came back.
- Two tasks created on the same fresh day in quick succession. The unique index makes the second
  insert a no-op rather than a duplicate, so no read-then-write race can double-stamp.
- A settings save on a day with no tasks. Nothing to update, and the day resolves through AC6.
- A stamp that fails midway through a task write. The task is already committed by AC7, so the day
  simply has no row and resolves through AC6. Nothing is left half-written and the next task on that
  day stamps it.
- The migration failing partway. The ledger in `scripts/apply-migrations.ts` is the guard, and
  `CREATE TABLE IF NOT EXISTS` makes this one genuinely re-runnable, unlike the `ADD COLUMN` cases
  `docs/TODO.md` records as protected only by that ledger.

## Out of scope

- A screen for correcting a past day's stamp. AC4 leaves the row updatable so that stays a later
  feature rather than a later migration.
- Retiring `work_schedule`, which survives as the AC6 fallback and keeps its own item in
  `docs/TODO.md`.
- Backfilling existing days. There is no honest value to backfill with, so days that already exist
  resolve through AC6.
- A buffer setting on the settings page.
- Clearing the table on an admin onboarding reset, and this is a decision rather than an omission.
  That reset deletes `settings` and `category_quotas` and deliberately leaves `tasks` and
  `work_schedule` alone, because it clears configuration and not history. A day stamp is history, a
  record of what a worked day was measured against, so it stays for the same reason a task does. It
  also has to stay for the reset to be safe: re-onboarding on different hours must not restate the
  periods already reported, which is the whole point of the snapshot. Recorded here because the
  admin onboarding reset's own spec had to reason about `work_schedule` and the next reader will ask
  the same question about this table.

## Verification

- `bun run test` exits 0, run unpiped, with fixtures covering AC2 through AC6, AC8 and AC9.
- `bun run lint` exits 0, run unpiped.
- The migration is applied against the dev database and then run a second time, proving it is
  genuinely idempotent rather than idempotent by ledger alone.
- By hand. A task is created on a fresh day and the row is read back. Work settings are then changed,
  and the row for today is confirmed to move while a row on a past day is confirmed to stay put.

## Open questions

None.
