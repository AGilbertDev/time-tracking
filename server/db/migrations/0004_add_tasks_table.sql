-- Add the tasks table (PLAN-01, the planning data layer).
--
-- One row per task-day slice. Multi-day work is one logical task made of one
-- slice per day, sharing a project and a split_group_id, each slice carrying its
-- own words_done and its own duration, so every period statistic stays a plain
-- indexed range sum over (user_id, date). The table records raw facts only:
-- category and status are free text coerced at read (PLAN-02 / PLAN-09), the
-- estimate is frozen at write (PLAN-12), and the quota math lives in PLAN-22.
-- Calendar and clock values (date, delivery_date, delivery_time) are text, while
-- true lifecycle instants (created_at, updated_at) are integer Unix seconds,
-- matching users. The user_id foreign key uses ON DELETE cascade so deleting a
-- user removes that user's tasks and leaves no orphan rows.
--
-- This create matches how 0000, 0001, 0002, and 0003 are authored in this
-- project, as plain statement-broken SQL applied by hand rather than by a
-- snapshot-diffing runner, because the project keeps no drizzle-kit meta snapshot
-- directory. The SQL below is the drizzle-kit generate output for the tasks table
-- and its index, with IF NOT EXISTS added.
--
-- Idempotency note. Both statements use IF NOT EXISTS, which SQLite supports for
-- CREATE TABLE and CREATE INDEX, so a re-run against a database that already has
-- the table is a no-op rather than a duplicate-object error. The cascade only
-- fires when the connection has PRAGMA foreign_keys = ON, which SQLite leaves off
-- by default; enabling it on the app's libSQL client is a separate, reviewed step.
--
-- DO NOT auto-run this against production. There is one real user, and this
-- migration is applied manually by the owner against the production Turso
-- database, matching 0000, 0001, 0002, and 0003. It must not be pointed at a live
-- database by CI, a deploy hook, or a dev-boot migration runner. There are no
-- database credentials in this environment.

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
