# Theme system redesign

## Owner course corrections

- **2026-07-19, mid-build (before any UI code was written):** the pastel theme was reverted from the originally-approved "pastel goth" lilac-and-turquoise palette to a teal seafoam palette at the owner's request. Pastel stays the default and keeps the id `pastel`. Everything else in this spec is unchanged. This note records the change so the trail stays honest; the palette table and edge cases below already reflect the teal anchors.

## Relationship to `visual-theme-rework.md`

This spec **partially supersedes** [`visual-theme-rework.md`](./visual-theme-rework.md) and **extends** it for everything else.

- **Superseded**: that spec's central premise, "the app's 8-atmosphere theme system stays exactly as is" (its Intent and AC9). This redesign replaces the eight atmospheres (`pastel`, `ember`, `onyx`, `coffee`, `forest`, `autumn`, `berry`, `frost`) with five deliberate, subject-grounded themes (`pastel`, `encre`, `cafe`, `automne`, `foret`), migrates stored settings to the new IDs, and reduces `theme.names.<id>` from a `{ light, dark }` pair to a single name per theme. It also touches the data layer (a migration and the schema default note), which the prior pass declared out of scope. Those parts of the old spec no longer describe the target state.
- **Extended, not replaced**: the signature chrome the prior pass already shipped stays and is the foundation here. `.btn-glow` / `.glow-on`, the `@property --btn-angle` spin, the `prefers-reduced-motion` gate, `.page-radial`, the Phosphor icon set, the oklch relative-color derivation of glint from `--ui-primary`, the `app.config.ts` container and `2xl` button size, and the round-media rule all remain in force. This redesign feeds those mechanisms more saturated primaries and widens where two of them apply (page-glow onto the app shell, flip transition onto the header mode and language controls).

Why the split rather than a rewrite: the prior spec's chrome is already implemented and correct against its own acceptance criteria. Rewriting it would erase a shipped, reviewed contract. This spec records only what changes and why, and leaves the still-true parts of the old spec authoritative so the trail stays honest.

Read this spec as the current source of truth for the theme **set**, **names**, **palettes**, **data model**, and **migration**. Read `visual-theme-rework.md` as the still-authoritative source for the glow/radial/icon **mechanisms** this one reuses.

## Intent

Replace the eight loosely-themed atmospheres with five deliberate, subject-grounded themes for a professional translator's tool, each a matched light and dark rendering under one name. Feed the already-shipped glow and radial chrome more saturated primaries so the dynamic feel aligns with the AGilbertDev portfolio, and widen two interactions (page-glow on the app shell, the 3D flip on the header mode and language controls) without adding noise anywhere else. Migrate the one existing user's stored theme settings to the new IDs, and make any invalid stored value resolve to the default at read time so a stale ID never reaches `<html data-theme>`.

The default theme is `pastel` (ID kept, palette redesigned). The two-column data model (`light_theme`, `dark_theme`) is kept so the user can match a theme by name across modes or mix the light of one with the dark of another.

## The five themes (locked, owner-approved)

Five themes, each with a matched light and dark rendering under one name. IDs are lowercase ASCII slugs. Display names are proper nouns and are identical in FR and EN.

| ID | Display name (FR = EN) | Subject | Default |
| --- | --- | --- | --- |
| `pastel` | Pastel | Soft teal seafoam. Genuinely colourful, never washed out. Its glint is a brighter seafoam close to its own primary. | Yes |
| `encre` | Encre | Translator's ink. Deep confident blue, the pro/corporate theme. | No |
| `cafe` | Café | Warm caramel on cream. | No |
| `automne` | Automne | Burnt orange and maple, deliberately redder and more saturated than `cafe` so the two never read alike. | No |
| `foret` | Forêt | Saturated pine green, brighter than the old muted forest. | No |

### Approved anchor colors

These anchors are the locked design intent. The **design stage** expands each into a full 50–950 primary ramp and a 50–950 neutral (surface) ramp, then validates WCAG 2.2 AA (see Acceptance criteria) and adjusts a shade **only as AA strictly requires**, noting any change in the design output. The anchors themselves are not open to restyling.

`glint` is the hue-shifted lighter tone that `.btn-glow` and `.page-radial` derive from `--ui-primary` via `oklch(from var(--ui-primary) …)`. The `glint` hex below is the **target** that derivation should land near now that primaries are more saturated; it is not a value hard-coded into the chrome. The design stage confirms the derived glint reads close to the listed `glint` and, if it does not, adjusts the primary anchor (within AA) rather than hard-coding a second hue. No raw hex enters the glow or radial.

#### pastel (default)

Soft teal seafoam that stays genuinely colourful rather than washed out. Its glint is a brighter seafoam close to its own primary, like the other four themes, so it does not need a special large hue shift from primary to glint. Teal primary with a white label clears AA comfortably.

| Mode | canvas | surface | primary | glint | text | muted | border |
| --- | --- | --- | --- | --- | --- | --- | --- |
| light | `#f1faf6` | `#ffffff` | `#159a82` | `#2cc0a0` | `#12312b` | `#55736b` | `#d0e8e0` |
| dark | `#10201c` | `#172b26` | `#34c3a3` | `#55d8bc` | `#e2f1ec` | `#8fb0a7` | `#26403a` |

#### encre

Deep confident blue, the pro/corporate theme.

| Mode | canvas | surface | primary | glint | text | muted | border |
| --- | --- | --- | --- | --- | --- | --- | --- |
| light | `#f5f7fb` | `#ffffff` | `#2a5cb8` | `#3e86d6` | `#14203a` | `#5a6b85` | `#d8e0ec` |
| dark | `#0d1626` | `#14203a` | `#5b9be8` | `#6fb6f2` | `#e6ecf5` | `#93a2bc` | `#26344f` |

#### cafe

Warm caramel on cream.

| Mode | canvas | surface | primary | glint | text | muted | border |
| --- | --- | --- | --- | --- | --- | --- | --- |
| light | `#faf5ee` | `#fffdfa` | `#a9611f` | `#c98a3e` | `#2a1d12` | `#6e5a48` | `#e7dbcb` |
| dark | `#17110c` | `#221a12` | `#d08a45` | `#e2a863` | `#f2e9dd` | `#b39c86` | `#322619` |

#### automne

Burnt orange and maple, deliberately redder and more saturated than `cafe`.

| Mode | canvas | surface | primary | glint | text | muted | border |
| --- | --- | --- | --- | --- | --- | --- | --- |
| light | `#fbf2ea` | `#fffaf5` | `#c0531f` | `#e07636` | `#34160c` | `#7a5040` | `#ecd6c6` |
| dark | `#1b1109` | `#281911` | `#e2703a` | `#f08c4e` | `#f6e7da` | `#c09880` | `#38220f` |

#### foret

Saturated pine green, brighter than the old muted forest.

| Mode | canvas | surface | primary | glint | text | muted | border |
| --- | --- | --- | --- | --- | --- | --- | --- |
| light | `#f0f6f1` | `#fafdfa` | `#1f7a50` | `#35a86a` | `#12241a` | `#4e6656` | `#d3e3d7` |
| dark | `#0e1a12` | `#16261b` | `#3da76c` | `#58c486` | `#e4efe7` | `#93ac9c` | `#24382b` |

## Inputs

This is not a runtime feature with user inputs. The inputs are the locked decisions above plus these contracts the build stages consume:

1. The five theme IDs, names, and anchor palettes (above).
2. The data-model rules (two columns, shared 5-ID namespace, `pastel` default) below.
3. The `shared/theme.ts` contract (`THEME_IDS`, `DEFAULT_THEME_ID`, `coerceThemeId`) below.
4. The migration remap table below.
5. The UI-upgrade intents below.

## Outputs and acceptance criteria

Each criterion is written so the unit-test stage can author a test from the spec alone (intent and expected result, not implementation).

### A. Shared contract (`shared/theme.ts`)

- **A1.** `THEME_IDS` equals exactly `['pastel', 'encre', 'cafe', 'automne', 'foret']`, in that order, and contains no other IDs. None of `ember`, `onyx`, `coffee`, `forest`, `autumn`, `berry`, `frost` appears.
- **A2.** `DEFAULT_THEME_ID` is `'pastel'`.
- **A3.** `coerceThemeId(id)` returns the same ID unchanged for each of the five valid IDs (identity on the valid set).
- **A4.** `coerceThemeId(value)` returns `'pastel'` for any value not in `THEME_IDS`, including each removed ID (`'ember'`, `'onyx'`, `'coffee'`, `'forest'`, `'autumn'`, `'berry'`, `'frost'`), an arbitrary unknown string (`'nope'`), the empty string `''`, `null`, `undefined`, a number, and an object.
- **A5.** `coerceLocale(value)` returns the value unchanged for each valid locale (`'fr'`, `'en'`) and returns `DEFAULT_LOCALE` (`'fr'`) for any invalid input, including an unknown string, `''`, `null`, and `undefined`. (Regression guard: `coerceLocale` behaviour is unchanged by this feature, but the same test file covers it.)
- **A6.** `DEFAULT_LOCALE` is `'fr'` and `LOCALES` is unchanged (`['fr', 'en']`).

### B. SSR fallback (runtime safety net)

- **B1.** `loadUserPreferences` continues to pass both stored theme columns through `coerceThemeId` before they reach the typed session, so a stored value left over from a removed atmosphere (e.g. `'berry'`) resolves to `'pastel'` on the first server-rendered paint without any migration having run. This is the belt-and-suspenders backstop behind the migration.
- **B2.** When no settings row exists, `loadUserPreferences` returns `pastel` / `pastel` / `fr`, unchanged from today.

### C. Palettes and CSS (`app/assets/css/main.css`)

- **C1.** `main.css` defines exactly five theme palettes: the `:root` default (pastel light) plus one `[data-theme="<id>"]` block per non-default ID, and the eight old `[data-theme]` blocks (`ember`, `onyx`, `coffee`, `forest`, `autumn`, `berry`, `frost`) are gone. `grep -n 'data-theme' app/assets/css/main.css` returns only blocks for the five new IDs.
- **C2.** Each theme block sets a full 50–950 `--ui-color-primary-*` ramp and a full 50–950 `--ui-color-neutral-*` (surface) ramp, expanded from the anchors, for both light and dark under one ID. The default (`:root`) is the pastel light ramp; the `.dark` variant of each theme is resolved by Nuxt UI from the same ID's ramp in dark mode, matching how the current file is structured.
- **C3.** The `@theme static` surface scales are the five new themes' scales (`--color-pastel-*`, `--color-encre-*`, `--color-cafe-*`, `--color-automne-*`, `--color-foret-*`), and the old surface scales for removed themes are gone. The `--color-brand-*` logo scale and `--font-sans` are untouched.
- **C4.** The shipped `.btn-glow`, `.glow-on`, `@property --btn-angle`, `btn-glow-spin` keyframes, the `prefers-reduced-motion` spin gate, the autofill rules, and the `.dark` border-lift block are all preserved. The glow and radial still derive every color from `var(--ui-primary)` via oklch relative color, with no raw hex added.
- **C5.** WCAG 2.2 AA holds in every theme, both modes, for: body text on canvas and on surface (≥ 4.5:1), muted text on canvas and on surface (≥ 4.5:1, or ≥ 3:1 only where the token is used exclusively for large text), the default border against its adjacent surface (≥ 3:1 for the UI-component contrast where the border carries meaning), primary-on-surface as a UI element (≥ 3:1), and the button label on the primary fill (≥ 4.5:1). Where an anchor cannot meet its bar, the design stage adjusts the minimum number of shades and records the change.

### D. Palette source-of-truth mirror (`app/composables/useTheme.ts`)

- **D1.** The `themeOptions` array is built from the five IDs and carries, per theme, the swatch data (`canvas`, `primary`, and the third swatch tone the header renders) for light and dark, drawn from the anchors, with the `default` flag set on `pastel` only.
- **D2.** `useTheme` still reads `THEME_IDS` as its ID source so the client list cannot drift from the server-validated set, and the record covers all five IDs and no removed ID.
- **D3.** `themeFavicon` and `onPrimary` keep working against the new palettes (the favicon and on-primary label color are derived, not hard-coded per theme).

### E. i18n names (`i18n/locales/fr.json`, `en.json`)

- **E1.** `theme.names` is a flat map of one name per theme: `{ "pastel": "Pastel", "encre": "Encre", "cafe": "Café", "automne": "Automne", "foret": "Forêt" }`, identical in FR and EN, with no `{ light, dark }` sub-objects and no removed IDs.
- **E2.** Every site that read `theme.names.<id>.<mode>` now reads `theme.names.<id>`. Specifically the header theme picker (`app/components/app/header.vue`, the atmosphere label at line ~58) renders one name per theme regardless of mode. `grep -rn 'theme.names' app/` shows no `.light`/`.dark` access on the name map.
- **E3.** The rest of the `theme` block (`light`, `dark`, `mode`, `default`, `active`) and every other key in both locale files is unchanged. French keeps the space before `? ! : ;` where those punctuation marks appear.

### F. Data model and schema (`server/db/schema.ts`)

- **F1.** The `settings` table keeps both `light_theme` and `dark_theme` columns; neither is dropped and they are not collapsed into one column. Both remain free text drawing from the same five-ID namespace.
- **F2.** Both columns keep the app-level default `'pastel'` in `schema.ts` (`default('pastel')`), which governs new inserts. `DEFAULT_THEME_ID` stays `'pastel'`. The `locale` column default (`'fr'`) is unchanged.

### G. Migration (`server/db/migrations/`)

- **G1.** A new migration file remaps existing stored theme values on both `light_theme` and `dark_theme` per the table below.

  | Old stored value | New value | Reason |
  | --- | --- | --- |
  | `pastel` | `pastel` | Kept (redesigned palette, same ID). No-op remap for completeness. |
  | `coffee` | `cafe` | Renamed to the French slug. |
  | `forest` | `foret` | Renamed to the French slug. |
  | `autumn` | `automne` | Renamed to the French slug. |
  | `ember` | `pastel` | Removed theme, falls back to default. |
  | `onyx` | `pastel` | Removed theme, falls back to default. |
  | `berry` | `pastel` | Removed theme, falls back to default. |
  | `frost` | `pastel` | Removed theme, falls back to default. |

- **G2.** The migration is idempotent and safe to re-run: every statement is a guarded `UPDATE … WHERE <column> IN (…)` (or equivalent guarded form) so a second run is a no-op, and a run after a partial failure completes the remaining remaps. No statement assumes a column op that SQLite lacks `IF NOT EXISTS` for; the migration only updates row values, it does not alter columns.
- **G3.** The migration does not attempt to change the SQLite column default (SQLite cannot easily `ALTER` a default without a table rebuild). The app-level default in `schema.ts` governs new inserts, and the migration file documents this in a comment.
- **G4.** The migration is authored to be applied **manually by the owner** and must **not** run against production automatically. There is exactly one real user. The migration file carries a comment stating it needs manual application and must not be pointed at prod by CI or a deploy hook.
- **G5.** After the migration and the `coerceThemeId` backstop, no stored value can resolve to a theme without a matching `[data-theme]` block: any residual unmapped value coerces to `pastel` at read time (see B1).

### H. UI upgrades toward the portfolio

Each criterion carries the reduced-motion obligation explicitly.

- **H1. Page-glow on the app shell.** The theme-derived `.page-radial` (or an equivalent theme-derived faint radial of the active primary) is extended from the auth surfaces to the main authenticated app shell, so the product surface carries a faint glow of the active theme's primary. It is fainter on dark than on light so it never muddies the darkest canvases (`pastel` dark `#14101d`, `automne` dark `#1b1109`, `foret` dark `#0e1a12`). It is a static background with no motion, so it has no reduced-motion obligation of its own, but it must not introduce any animated element.
- **H2. Header icon-control hover micro-interactions.** The header icon controls (the color-mode toggle and the account-menu trigger, at minimum) gain a subtle hover treatment: a slight `hover:scale` in the 110–125 range and `hover:text-primary`, transitioning over about 200 ms, matching the portfolio navbar's restraint. The scale/color transition is disabled or reduced under `prefers-reduced-motion: reduce` so no movement occurs for users who opt out (the color change may remain; the scale must not animate).
- **H3. 3D flip on the header mode and language controls.** The 3D flip transition already used by the auth language toggle is applied to the header color-mode (sun/moon) control and the header language control, so switching mode or locale animates consistently with that toggle. The flip is gated behind `prefers-reduced-motion: reduce` exactly as the existing auth toggle is, so it does not animate for users who opt out, and no layout shift occurs between motion states.
- **H4. `.btn-glow` on primary CTAs.** Primary CTAs use `.btn-glow` where it fits, now that primaries are saturated (the existing auth submit buttons already carry it; this criterion confirms the pattern holds and extends to any primary CTA introduced by this feature). The spin remains gated behind `prefers-reduced-motion: reduce` (already shipped); the static ring and glow remain for opted-out users.
- **H5. Restraint.** No new animation is added beyond the glow spin (already gated), the H2 hover, and the H3 flip. Everything else stays quiet. There is no scroll choreography, no new always-lit element beyond what the prior spec defined.

### I. Theme preview pages (`app/pages/themes.vue`, `app/pages/themes-v2.vue`)

- **I1.** After this feature, neither preview page references a removed theme ID or the old `theme.names.<id>.<mode>` i18n shape, and neither page breaks the build or a typecheck. Per the documented decision below, both throwaway galleries are **removed**. If the build stage instead elects to keep either page, it must be updated to the five new IDs, the new single-name i18n shape, and the new anchor palettes, and `grep -rn "ember\|onyx\|berry\|frost\|coffee\|forest\|autumn" app/pages/themes*.vue` must return nothing.

### J. No regressions

- **J1.** The header account menu, theme picker, color-mode toggle, and language toggle all continue to function: selecting a theme persists the correct column for the active mode, and the picker shows one name per theme with the active one marked.
- **J2.** A signed-out visitor and a user with no settings row both render the `pastel` default in the correct mode on first paint, with no invalid `data-theme` reaching `<html>`.

## Edge cases

- **Removed ID already stored.** The single real user may currently store any of the eight old IDs on either column. The migration remaps the four renamed/kept IDs and folds the four removed IDs to `pastel`; the `coerceThemeId` backstop catches anything the migration misses or anything stored before the migration is applied. Expected result: a valid, rendering theme in every case, defaulting to `pastel`.
- **Migration re-run.** Running the migration twice, or after a partial failure, must not corrupt data or error. The `WHERE … IN (…)` guards make each remap a no-op once applied. Expected result: identical end state whether run once or many times.
- **Mixed light/dark selection.** The user may store `light_theme = 'encre'` and `dark_theme = 'foret'`. Both columns are independent and both must resolve and render. Expected result: light mode renders Encre, dark mode renders Forêt, no coupling between the columns.
- **Button label contrast on saturated primaries.** Every theme's button label on its primary fill must clear 4.5:1. Expected result: the design stage picks label and/or primary shades that clear the bar per theme and records any change; no theme ships below AA.
- **Darkest canvases with the page-glow.** The app-shell glow (H1) must stay very low opacity on dark so `pastel`/`automne`/`foret` dark canvases are not muddied. Expected result: the glow reads as a faint tint, never a visible blob, on every dark theme.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, the glow spin, the H2 hover scale, and the H3 flip all stop animating, while the static ring, glow, hover color, and mode/locale change still occur without movement and without layout shift.
- **Locale name identity.** Theme names are proper nouns identical in FR and EN. Expected result: switching locale changes the picker's surrounding chrome (the `Thème clair` / `Light theme` group label, the `(défaut)` / `(default)` suffix) but not the five theme names themselves.
- **Hydration of mode-dependent chrome.** The color-mode control and any name/label that depends on the active mode must not mismatch between SSR and client. The header picker label is now mode-independent per theme (one name), which removes the prior per-mode name as a hydration surface; the moon/sun control stays behind its existing client guard.

## Out of scope

- Any change to the number of preference columns, the auth flow, the session shape beyond the already-typed theme/locale fields, or any business logic (time tracking, quotas, work days).
- Adding a settings-page theme UI or any theme control beyond the existing header account-menu picker.
- Running the migration against production. The migration is authored and committed but applied manually by the owner (G4).
- Re-deriving or restyling the shipped glow/radial/icon mechanisms. This feature only feeds them new primaries and widens where the glow and flip apply (H1, H3). The mechanisms themselves are governed by `visual-theme-rework.md`.
- New public pages, new marketing surfaces, or scroll choreography.
- A user-facing "reset theme to default" action.

## Documented assumptions

These resolve every ambiguity the brief left open so the build runs without stopping to ask.

1. **Theme preview pages are removed.** `app/pages/themes.vue` and `app/pages/themes-v2.vue` are throwaway scaffolding: `themes.vue` hard-codes an eight-theme palette set and is not linked from the app, and `themes-v2.vue` reads the old `theme.names.<id>.<mode>` shape that this feature deletes, so it would break regardless. Both are removed (I1). If the build stage has a reason to keep one as a living gallery, it must be fully migrated to the five IDs, the single-name i18n shape, and the new anchors, and must not reference any removed ID. Default action: remove both.
2. **Third header swatch tone.** The header theme picker currently renders three swatch dots per theme from `canvas`, `primary`, and `accent`. The new anchors provide `canvas`, `surface`, `primary`, `glint`, `text`, `muted`, `border` but no `accent`. Assumption: the three swatch dots become `canvas`, `primary`, and `glint` (the glint replaces the removed accent as the third tone), keeping the picker visually informative. The `useTheme` swatch data carries these three tones per mode. If design prefers `surface` or `border` as the third dot for legibility on a given theme, that is a design-stage call recorded in its output; the contract only requires three anchor-derived tones per mode.
3. **`ThemePalette` shape.** The `accent` field on the `ThemePalette` interface in `useTheme.ts` is renamed or repurposed to carry the glint (or the chosen third tone) rather than the removed atmosphere accent, so no field references a concept that no longer exists. The exact field name is an implementation detail for the frontend stage; the swatch render must not reference a dropped `accent` concept.
4. **Anchor-to-ramp expansion owner.** The design stage owns expanding each anchor into full 50–950 primary and neutral ramps and validating AA (C2, C5). The spec fixes the anchors and the AA bars; it does not prescribe the intermediate ramp stops, which the design stage derives (matching how the current `main.css` ramps were built).
5. **Glint is derived, not stored in chrome.** The per-theme `glint` hex is the design target for the oklch-derived tone, documented so design can verify the derivation lands near it. It is not written as a literal into `.btn-glow`/`.page-radial`; those keep deriving from `--ui-primary`. If the derived tone drifts too far from the target on a given theme, design nudges the primary anchor within AA rather than hard-coding glint.
6. **Migration format.** The migration follows `my-backend-conventions` for `server/db/migrations/` (guarded, idempotent SQL). If the project uses Drizzle-generated migrations, the remap is authored as a hand-written data migration alongside them, since it updates row values rather than schema. The backend stage confirms the exact file naming and placement against the existing migrations folder.
7. **Page-glow reuse vs new utility.** H1 reuses the shipped `.page-radial` utility (already theme-derived and dark-dimmed) applied to the app shell, rather than authoring a second radial. If applying it at the shell level conflicts with the shell's existing flat `bg-muted` canvas, the frontend stage layers the radial `background-image` over the `background-color` exactly as the auth pages do. Default: reuse `.page-radial`.
8. **Flip transition reuse.** H3 reuses the existing auth language-toggle flip implementation (already `prefers-reduced-motion`-gated) rather than authoring a new transition, so the mode and language header controls animate identically to it.

## Skipped pipeline stages

- **Compliance: skipped.** This feature changes no personal-data collection, retention, sharing, email, or consent surface. It remaps a stored preference and restyles chrome. No compliance review is triggered.
- **SEO: skipped.** No new public page, route, or indexable surface is added; the app is authenticated. There is nothing for the SEO stage to act on.

Design, frontend, backend (schema + migration), accessibility, and unit-test stages all apply. Specs and code review are never skipped.
