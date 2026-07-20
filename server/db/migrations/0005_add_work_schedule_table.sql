-- Add the work_schedule table (PLAN-03).
--
-- This lays the effective-dated work-schedule history for the planning
-- dashboard. The settings row holds the user's *current* daily work minutes,
-- work days, and buffer, but that row is mutable and cannot answer "what was
-- the work-day length on a date in the past". A period's quota denominator
-- reads the work-hours setting in effect on that day, so the setting is
-- versioned by date here in its own history table (the SCD Type 2 pattern
-- payroll systems use), keyed to users.id, one row per effective date. This
-- bout only reads the history; the create/update UI lives on the settings page.
--
-- Per the project's per-slice model, calendar values are text, not timestamp
-- integers: effective_from holds 'YYYY-MM-DD' so lexicographic order equals
-- chronological order and the resolution query is a plain index-friendly range
-- scan over (user_id, effective_from). Only the two lifecycle instants
-- (created_at, updated_at) use integer Unix seconds.
--
-- This file is authored as plain statement-broken SQL to match how 0000-0004
-- are maintained in this project, applied by hand rather than by a
-- snapshot-diffing runner, because the repo keeps no drizzle-kit meta snapshot
-- directory or _journal.json.
--
-- Idempotency note. Both statements use IF NOT EXISTS so re-applying the
-- migration against a database that already has the table or index is a no-op
-- rather than a duplicate-object error.
--
-- Cascade note. The user_id foreign key is ON DELETE cascade, so deleting a
-- user removes that user's schedule history and leaves no orphans. SQLite
-- enforces foreign keys (and therefore fires the cascade) only when PRAGMA
-- foreign_keys = ON is set on the connection, so the libSQL/Turso client the
-- app uses must have foreign-key enforcement enabled for this guarantee to hold.
--
-- Unique index note. The unique index on (user_id, effective_from) forbids two
-- schedule records for the same user on the same effective date, which would
-- make resolution ambiguous, and doubles as the resolution index for
-- WHERE user_id = ? AND effective_from <= ? ORDER BY effective_from DESC.
--
-- DO NOT auto-run this against production. There is one real user, and this
-- migration is applied manually by the owner against the production Turso
-- database, matching 0000-0004. It must not be pointed at a live database by
-- CI, a deploy hook, or a dev-boot migration runner. There are no database
-- credentials in this environment.

CREATE TABLE IF NOT EXISTS `work_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`work_minutes` integer NOT NULL,
	`work_days` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`buffer_minutes` integer DEFAULT 60 NOT NULL,
	`effective_from` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `work_schedule_user_id_effective_from_idx` ON `work_schedule` (`user_id`,`effective_from`);
