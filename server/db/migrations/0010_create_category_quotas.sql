-- Add the category_quotas table (PLAN-32b).
--
-- This is the expand half of retiring the global quota. A quota is a property of a
-- kind of work rather than a property of the person doing it, so one number per user
-- could not describe four kinds of work at once. The user's own figure per category
-- lives here, the shipped starting figures stay in shared/categories.ts as
-- defaultQuotaWph, and the server resolves the two together. A user with no rows in
-- this table still resolves a working quota for every trackable category, so there
-- is no bootstrap step, no backfill, and no state in which a trackable category has
-- no answer.
--
-- Nothing is migrated into this table. The stored settings.quota_wph value that 0011
-- drops is discarded rather than carried forward, because it is the global 450
-- default the planning overview already records as wrong, because one number
-- covering four kinds of work carries no information about any one of them so
-- attributing it to a category would be an invention, and because zero rows is a
-- working state rather than an empty one.
--
-- Keyed by a free-text category_id rather than by a foreign key to a category
-- record. There is no per-user categories record to point at, since the categories
-- are still a code contract with no table behind them, and building that table is
-- its own feature (PLAN-30). Free text also means this table already accepts an id
-- that does not exist yet, so a quota for a user-created category will be an insert
-- rather than a migration. That is the same seam the CategoryId type keeps open,
-- expressed in the database rather than only in TypeScript. The cost is that a
-- stored row can name a category the app no longer knows, and the resolver handles
-- that by never selecting such a row rather than by preventing it.
--
-- Effective dating copies work_schedule (0005) rather than inventing a second
-- arrangement for the same problem. Editing a quota must not restate a period that
-- has already been reported, so this is the SCD Type 2 pattern, one row per
-- effective date, with effective_from held as 'YYYY-MM-DD' text so lexicographic
-- order equals chronological order and resolution is a plain index-friendly range
-- scan. Only the two lifecycle instants (created_at, updated_at) use integer Unix
-- seconds.
--
-- Unique index note. The unique index on (user_id, category_id, effective_from)
-- forbids two records for the same user, category, and effective date, which would
-- make resolution ambiguous. It is also the conflict target the PATCH upserts on, so
-- saving twice on the same day updates that day's row rather than piling up rows,
-- and it serves the resolution query
--   WHERE user_id = ? AND category_id = ? AND effective_from <= ?
--   ORDER BY effective_from DESC
-- with the two equality columns first and the range column last.
--
-- Cascade note. The user_id foreign key is ON DELETE cascade, so deleting a user
-- removes that user's quotas and leaves no orphans. SQLite fires the cascade only
-- when PRAGMA foreign_keys = ON is set on the connection, and nothing in this repo
-- issues that pragma, so the purge endpoint
-- (server/api/cron/purge-deactivated.get.ts) deletes this table explicitly as well.
-- Read the cascade as a second line of defence rather than as the mechanism.
--
-- Expand-then-contract note. This is the expand half, and it is split from the drop
-- into its own file on purpose. The runner records a file in its ledger only after
-- every statement in that file has succeeded, and the ledger is keyed on the
-- filename with no checksum, so one file holding both halves could leave the table
-- created and the file unrecorded, with no way to resume except by editing SQL that
-- has already run in part. Two files also let the ledger express the state a deploy
-- actually sits in, which is create applied and drop pending. That state exists on
-- purpose and a single file cannot represent it.
--
-- The apply order is three steps and the runner does not enforce it. Applying 0010
-- changes nothing for the build that is live, because it does not know the table
-- exists. Then deploy the new build, which succeeds while quota_wph is still there
-- because that column is NOT NULL with a database-level DEFAULT 450 and the new
-- build's inserts never name it. Then apply 0011. Running
-- `bun run apply-migrations --yes` once applies every pending file in one pass, so
-- run it once before the deploy and once after rather than once in the middle.
--
-- Undo. Nothing to undo, deliberately. The old build does not know this table, so a
-- rollback can leave it in place. DROP TABLE category_quotas is only correct before
-- the user has saved a quota, and after that it destroys their settings.
--
-- DO NOT renumber or rename this file once it has been applied anywhere. The
-- runner's ledger (_applied_migrations) is keyed on the filename alone with no
-- checksum, so a name already recorded is skipped whatever the file now says, and a
-- name that is not recorded runs again.
--
-- Idempotency note. Both statements use IF NOT EXISTS, so re-applying this file
-- against a database that already has the table or the index is a no-op rather than
-- a duplicate-object error, matching 0005.
--
-- Authored as plain statement-broken SQL with this comment header to match how 0000
-- through 0009 are maintained in this project, applied by hand rather than by a
-- snapshot-diffing runner, because the repo keeps no drizzle-kit meta snapshot
-- directory or _journal.json.
--
-- DO NOT auto-run this against production. There is one real user, and this
-- migration is applied manually by the owner against the production Turso database,
-- matching 0000 through 0009. It must not be pointed at a live database by CI, a
-- deploy hook, or a dev-boot migration runner. There are no database credentials in
-- this environment.

CREATE TABLE IF NOT EXISTS `category_quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`quota_wph` integer NOT NULL,
	`effective_from` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `category_quotas_user_id_category_id_effective_from_idx` ON `category_quotas` (`user_id`,`category_id`,`effective_from`);
