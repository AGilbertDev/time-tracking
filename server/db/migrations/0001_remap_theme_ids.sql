-- Remap stored theme ids to the redesigned five-theme set.
--
-- The theme-system-redesign spec replaces the eight atmospheres
-- (pastel, ember, onyx, coffee, forest, autumn, berry, frost) with five
-- deliberate themes (pastel, encre, cafe, automne, foret). This migration
-- rewrites every stored value on settings.light_theme and settings.dark_theme
-- so no row keeps a renamed or removed id.
--
-- Remap table:
--   coffee -> cafe       (renamed to the French slug)
--   forest -> foret      (renamed to the French slug)
--   autumn -> automne    (renamed to the French slug)
--   pastel -> pastel     (kept, redesigned palette, listed for completeness)
--   ember, onyx, berry, frost -> pastel  (removed themes fall back to the default)
--
-- Idempotent and crash-resistant. Every statement is a guarded
-- UPDATE ... WHERE <column> IN (...), so running it twice, or resuming after a
-- partial failure, drives both columns to the same end state with no duplicate
-- work. The migration only rewrites row values. It performs no column
-- operation, so it never needs an IF NOT EXISTS that SQLite lacks on ALTER.
--
-- Column default note: SQLite cannot easily ALTER a column default without a
-- full table rebuild, so this migration does not touch the settings defaults.
-- New inserts are governed by the app-level default instead, which is
-- default('pastel') on both theme columns in server/db/schema.ts backed by
-- DEFAULT_THEME_ID in shared/theme.ts. coerceThemeId in that same file is the
-- runtime belt-and-suspenders backstop, so any value this migration misses, or
-- any value written before it is applied, still resolves to pastel at read time
-- in server/utils/loadUserPreferences.ts before it reaches <html data-theme>.
--
-- DO NOT auto-run this against production. There is exactly one real user, and
-- this migration is applied manually by the owner. It must not be pointed at a
-- live or production database by CI, a deploy hook, or a dev-boot migration
-- runner. There are no database credentials in this environment, and none of
-- the statements below should be executed against prod from here.

-- 1. Rename the three kept-but-renamed themes on the light column.
UPDATE `settings` SET `light_theme` = 'cafe' WHERE `light_theme` IN ('coffee');
--> statement-breakpoint
UPDATE `settings` SET `light_theme` = 'foret' WHERE `light_theme` IN ('forest');
--> statement-breakpoint
UPDATE `settings` SET `light_theme` = 'automne' WHERE `light_theme` IN ('autumn');
--> statement-breakpoint

-- 2. Fold the four removed themes to the default on the light column.
UPDATE `settings` SET `light_theme` = 'pastel' WHERE `light_theme` IN ('ember', 'onyx', 'berry', 'frost');
--> statement-breakpoint

-- 3. Rename the three kept-but-renamed themes on the dark column.
UPDATE `settings` SET `dark_theme` = 'cafe' WHERE `dark_theme` IN ('coffee');
--> statement-breakpoint
UPDATE `settings` SET `dark_theme` = 'foret' WHERE `dark_theme` IN ('forest');
--> statement-breakpoint
UPDATE `settings` SET `dark_theme` = 'automne' WHERE `dark_theme` IN ('autumn');
--> statement-breakpoint

-- 4. Fold the four removed themes to the default on the dark column.
UPDATE `settings` SET `dark_theme` = 'pastel' WHERE `dark_theme` IN ('ember', 'onyx', 'berry', 'frost');
