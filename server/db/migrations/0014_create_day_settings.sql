-- Add the day_settings table (the day settings snapshot).
--
-- A day's throughput is measured against how long that day was supposed to be, and
-- that length is a mutable setting on the settings row. Changing it next month would
-- silently rewrite every figure already reported for every past day. This table
-- records the settings that were in force on a day, once something is logged on that
-- day, so a later change can never reach backward.
--
-- This is the same snapshot the quota already uses, approved 2026-08-24, where the
-- task write path resolves the figure and stores it on the task the way an invoice
-- line stores the price it was sold at. Here the day is the thing carrying the fact.
--
-- Why this rather than the effective dating work_schedule (0005) already has. The
-- dated table protects the past only from changes made after it starts recording,
-- and nothing in the app has ever written to it, so a user who changes their hours
-- having never saved before still resolves every past day to the shipped default.
-- Stamping the day when it is used does not have that hole. work_schedule is not
-- retired: a day nobody worked has no row here, and the dated lookup remains the
-- honest answer for it, so the resolution order is this table, then work_schedule,
-- then DEFAULT_SCHEDULE.
--
-- The row is updatable rather than append-only, and that is deliberate. A settings
-- save refreshes every row dated today or later and touches nothing earlier, which
-- is what makes a day hold the last setting saved on that day while a past day stays
-- frozen. It also leaves a correction path for the case the industry says happens,
-- which is a setting that was simply wrong for a stretch of time. Clockify asks per
-- rate change whether the past should be rewritten; nothing here asks yet, and this
-- shape means that screen is a later feature rather than a later migration.
--
-- buffer_minutes is stamped even though the settings row carries no such column
-- today, so its value is the documented default of 60 until a real setting exists.
-- Stamping it now means adding that setting later needs no migration.
--
-- work_days is text holding a JSON array, matching settings.work_days and
-- work_schedule.work_days, and it is read back through the same defensive coercion
-- rather than trusted, so a corrupt value falls back to the default set instead of
-- reaching the quota engine.
--
-- Nothing is backfilled. Existing days have no honest value to be given, since the
-- settings in force on them were never recorded anywhere, so they resolve through
-- work_schedule and then the shipped default like any other unstamped day.
--
-- Unique index note. The unique index on (user_id, date) makes one row per user and
-- day a database guarantee rather than a convention, which is what makes a second
-- task created on the same fresh day a no-op instead of a duplicate stamp, with no
-- read-then-write race to lose. user_id comes first so it also serves the range
-- read WHERE user_id = ? AND date BETWEEN ? AND ?.
--
-- Cascade note. The user_id foreign key is ON DELETE cascade, so deleting a user
-- removes that user's day rows and leaves no orphans. SQLite fires the cascade only
-- when PRAGMA foreign_keys = ON is set on the connection and nothing in this repo
-- issues that pragma, so the purge endpoint
-- (server/api/cron/purge-deactivated.get.ts) deletes this table explicitly as well.
-- Read the cascade as a second line of defence rather than as the mechanism.
--
-- Idempotency note. Both statements use IF NOT EXISTS, so re-applying this file is a
-- no-op rather than a duplicate-object error, matching 0005 and 0010. This file is
-- genuinely re-runnable rather than protected only by the runner's ledger, which is
-- the difference between a CREATE TABLE and the ADD COLUMN cases docs/TODO.md
-- records. Do not copy 0006's header note claiming a tolerant runner, because
-- scripts/apply-migrations.ts tolerates no error at all.
--
-- DO NOT renumber, rename, or edit this file once it has been applied anywhere. The
-- runner's ledger (_applied_migrations) is keyed on the filename alone with no
-- checksum, so a recorded name is skipped whatever the file now says. A correction
-- after that arrives as a new numbered file on top.
--
-- DO NOT auto-run this against production. There is one real user and this migration
-- is applied manually by the owner against the production Turso database, matching
-- 0000 through 0013. It must not be pointed at a live database by CI, a deploy hook,
-- or a dev-boot runner. There are no database credentials in this environment.

CREATE TABLE IF NOT EXISTS `day_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`work_minutes` integer NOT NULL,
	`work_days` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`buffer_minutes` integer DEFAULT 60 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `day_settings_user_id_date_idx` ON `day_settings` (`user_id`,`date`);
