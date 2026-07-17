-- Persist user preferences (theme and language).
--
-- This migration is hand-written because it carries a data backfill that
-- drizzle-kit generate cannot express, and because the schema must change in a
-- fixed order: add the preference columns, backfill a settings row for every
-- user that lacks one (carrying their users.locale value across), and only then
-- drop the now-retired users.locale column.
--
-- Apply this against the database manually. It is not run automatically here,
-- and there are no database credentials in this environment.

-- 1. Add the three preference columns to settings. Existing settings rows take
--    the column defaults, which match DEFAULT_THEME_ID and the default locale.
--    Every current users.locale value is the default 'fr', so an existing
--    settings row taking the 'fr' default loses no one's language.
ALTER TABLE `settings` ADD `light_theme` text DEFAULT 'pastel' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `dark_theme` text DEFAULT 'pastel' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD `locale` text DEFAULT 'fr' NOT NULL;
--> statement-breakpoint

-- 2. Backfill a settings row for every user without one, copying their
--    users.locale into settings.locale so no language is lost. The theme
--    columns and the other settings columns take their defaults. The id uses a
--    random hex value because the settings primary key has no database-side
--    default (it is generated in application code).
INSERT INTO `settings` (`id`, `user_id`, `locale`)
SELECT lower(hex(randomblob(16))), `users`.`id`, `users`.`locale`
FROM `users`
WHERE `users`.`id` NOT IN (SELECT `user_id` FROM `settings`);
--> statement-breakpoint

-- 3. Drop the retired users.locale column. Nothing reads it, and its values
--    are preserved on the settings rows created above.
ALTER TABLE `users` DROP COLUMN `locale`;
