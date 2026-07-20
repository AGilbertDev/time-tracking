-- Add the tasks table (PLAN-01).
--
-- This lays the data foundation for the planning dashboard. It adds a single
-- tasks table keyed to users.id, one row per task-day slice, so every period
-- statistic (day, week, month, year) is a plain indexed range sum over
-- (user_id, date). The table records raw facts only; meaning (the trackable
-- flag, the frozen estimate, the quota math) is deferred to later features.
--
-- Per the project's per-slice model, calendar and clock values are text, not
-- timestamp integers: date and delivery_date hold 'YYYY-MM-DD', delivery_time
-- holds 'HH:MM'. Only the two lifecycle instants (created_at, updated_at) use
-- integer Unix seconds.
--
-- This file is authored as plain statement-broken SQL to match how 0000-0003
-- are maintained in this project, applied by hand rather than by a
-- snapshot-diffing runner, because the repo keeps no drizzle-kit meta snapshot
-- directory or _journal.json.
--
-- Idempotency note. Both statements use IF NOT EXISTS so re-applying the
-- migration against a database that already has the table or index is a no-op
-- rather than a duplicate-object error.
--
-- Cascade note. The user_id foreign key is ON DELETE cascade, so deleting a
-- user removes that user's task rows and leaves no orphans. SQLite enforces
-- foreign keys (and therefore fires the cascade) only when PRAGMA
-- foreign_keys = ON is set on the connection, so the libSQL/Turso client the
-- app uses must have foreign-key enforcement enabled for this guarantee to hold.
--
-- DO NOT auto-run this against production. There is one real user, and this
-- migration is applied manually by the owner against the production Turso
-- database, matching 0000-0003. It must not be pointed at a live database by
-- CI, a deploy hook, or a dev-boot migration runner. There are no database
-- credentials in this environment.

CREATE TABLE IF NOT EXISTS `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`client` text,
	`project` text,
	`category` text NOT NULL,
	`delivery_date` text,
	`delivery_time` text,
	`project_word_count` integer,
	`words_done` integer,
	`quota_wph_override` integer,
	`estimated_minutes` integer,
	`actual_minutes` integer,
	`status` text,
	`instructions` text,
	`split_group_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_user_id_date_idx` ON `tasks` (`user_id`,`date`);
