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
through the shipped `resolveSchedule`, then `DEFAULT_SCHEDULE`. A day nobody worked has no row and
still resolves.

AC7. A failed stamp never blocks a task write. The task still lands and the failure is logged, because
refusing to record real work over a bookkeeping row would police the user, which `spec.md` §2 forbids.

AC8. The resolver is pure and database-free, taking a date, a day row or null, and the schedule
records, so every criterion above is testable against fixtures with no database.

AC9. `work_days` is stored as JSON text and read through the same defensive coercion
`loadWorkSchedule` already applies, so a corrupt value falls back rather than reaching the engine.

AC10. Every stamp path is scoped to the session user, so no write can reach another user's day.

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

## Verification

- `bun run test` exits 0, run unpiped, with fixtures covering AC2 through AC6, AC8 and AC9.
- `bun run lint` exits 0, run unpiped.
- The migration is applied against the dev database and then run a second time, proving it is
  genuinely idempotent rather than idempotent by ledger alone.
- By hand. A task is created on a fresh day and the row is read back. Work settings are then changed,
  and the row for today is confirmed to move while a row on a past day is confirmed to stay put.

## Open questions

None.
