# Theme system

## Intent

The app ships five deliberate, subject-grounded themes for a professional translator's tool: `pastel` (default), `encre`, `cafe`, `automne`, and `foret`. Each theme is a matched light and dark rendering under one id, and each carries a distinct primary and a distinct accent (its secondary ramp) chosen as a colour-harmony pairing. A user picks a light theme and a dark theme independently; both are persisted on the user's `settings` row and resolved server-side so the correct theme is in the initial HTML with no flash on first paint. The chrome around the themes stays deliberately quiet: a simple hover border on primary calls to action, a faint theme-derived page radial, Phosphor icons, and tokens derived from the active primary through oklch relative color so a single definition rethemes across all five themes in both modes.

## Inputs

This is not a runtime feature with user inputs. The inputs are the locked design decisions and the contracts the app consumes:

1. The five theme ids, display names, and per-theme primary and accent palettes.
2. The data-model rules: two preference columns, one shared five-id namespace, `pastel` as the default.
3. The shared contract in `shared/theme.ts` (`#shared/theme`): `THEME_IDS`, `DEFAULT_THEME_ID`, `coerceThemeId`, plus `LOCALES`, `DEFAULT_LOCALE`, `coerceLocale`.

## Outputs and acceptance criteria

### The five themes

- **AC1.** The theme set is exactly `pastel`, `encre`, `cafe`, `automne`, `foret`, in that order, with `pastel` the default. No other id exists anywhere in the app. The removed atmospheres (`ember`, `onyx`, `coffee`, `forest`, `autumn`, `berry`, `frost`) appear in no source file.
- **AC2.** Each theme is a matched light and dark rendering under one id. Display names are proper nouns identical in FR and EN: Pastel, Encre, Café, Automne, Forêt.

  | id | Display name (FR = EN) | Subject | Primary | Accent |
  | --- | --- | --- | --- | --- |
  | `pastel` | Pastel | Soft teal seafoam | teal seafoam | lilac |
  | `encre` | Encre | Translator's ink, the pro/corporate theme | ink blue | sarcelle (teal) |
  | `cafe` | Café | Warm coffee | espresso | caramel |
  | `automne` | Automne | Burnt orange and maple, redder than `cafe` | burnt orange | maple red |
  | `foret` | Forêt | Saturated pine | pine green | plum / heather |

### Shared contract (`shared/theme.ts`, imported as `#shared/theme`)

- **AC3.** `THEME_IDS` equals `['pastel', 'encre', 'cafe', 'automne', 'foret']`, in that order, and `DEFAULT_THEME_ID` is `'pastel'`. This is the single source of truth both the client and the Nitro server validate against, so the two cannot drift.
- **AC4.** `coerceThemeId(value)` returns the id unchanged for each of the five valid ids and returns `'pastel'` for anything else (any removed id, an unknown string, `''`, `null`, `undefined`, a number, an object). The theme columns are free text at the database level, so a stale value must resolve to the default rather than reach `<html data-theme>` as an id with no matching CSS.
- **AC5.** `coerceLocale(value)` returns the value unchanged for `'fr'` and `'en'` and returns `DEFAULT_LOCALE` (`'fr'`) for any invalid input. `LOCALES` is `['fr', 'en']`.

### Palettes and CSS (`app/assets/css/main.css`)

- **AC6.** `main.css` defines exactly the five theme palettes: the `:root` default (pastel) plus one `[data-theme="<id>"]` block per non-default id (`encre`, `cafe`, `automne`, `foret`). `grep -n 'data-theme' app/assets/css/main.css` returns only blocks for these five ids.
- **AC7.** Each theme block sets a full 50–950 `--ui-color-primary-*` ramp and a full 50–950 `--ui-color-secondary-*` (accent) ramp, both shared across light and dark under one id. Nuxt UI reads `--ui-primary` as primary-500 in light and primary-400 in dark, and `--ui-secondary` as secondary-500 / secondary-400, so the light anchor sits at step 500 and the dark anchor at step 400. The accent is wired to Nuxt UI's built-in `secondary` alias with no `app.config.ts` change.
- **AC8.** Neutrals are referenced from the `@theme static` surface scales (`--color-pastel-*`, `--color-encre-*`, `--color-cafe-*`, `--color-automne-*`, `--color-foret-*`), one full 50–950 scale per theme. The `--color-brand-*` logo scale and `--font-sans` are untouched by the theme blocks.
- **AC9.** The accent is a genuine secondary token, used sparingly for secondary emphasis (inline links, chips and badges, secondary or soft buttons, small active-state touches). It is never used for primary CTAs, the hover border, the page radial, focus rings, body text, form field chrome, or status colours, all of which stay on `primary` or their fixed status tokens.
- **AC10.** WCAG 2.2 AA holds in every theme, both modes, for body text and muted text on canvas and on surface (≥ 4.5:1), the button label on the primary fill (≥ 4.5:1), primary-on-surface as a UI element (≥ 3:1), and the accent in every text and label role it carries (≥ 4.5:1). Default borders are decorative structural separators, exempt from WCAG 1.4.11, and read as soft sub-3:1 hairlines by design.

### Chrome (`app/assets/css/main.css`)

- **AC11. Simple hover border.** The `.btn-glow` class is a simple hover border: a crisp 2px ring in the active theme primary on hover, `box-shadow: 0 0 0 2px var(--ui-primary)`, with a short `box-shadow` transition and no glow, gradient, blur, spin, or other motion. The `.glow-on` modifier keeps the same ring lit for a persistent state. It is applied to primary CTAs, not to inputs.
- **AC12. Page radial.** The `.page-radial` utility paints a faint radial of the active primary anchored top-right, derived via `oklch(from var(--ui-primary) …)` so it rethemes automatically, and it is fainter on dark (0.07 alpha) than on light (0.14 alpha) so it never muddies the darkest theme canvases. It is a static background with no motion.
- **AC13. oklch-derived tokens.** New tinted tokens (the page radial glint, the autofill fill) are derived from `var(--ui-primary)` through oklch relative color or `color-mix`, not hard-coded per theme, so one definition tracks whichever theme is active in both modes. No raw hex enters the hover border or the page radial.
- **AC14. Autofill override.** The browser autofill rules keep a themed input on its themed surface: the very long `background-color` transition defers the browser's autofill fill indefinitely, the text fill and caret are forced to the themed text colour so a prefilled value stays legible, and a low-opacity primary-tinted fill replaces the browser's default yellow. `:autofill` (Firefox) and `:-webkit-autofill` (Chromium) stay in separate rules so an unknown pseudo does not invalidate the whole rule.
- **AC15. Icons.** Icons are Phosphor (`i-ph-*`) throughout; no Carbon (`i-carbon-*`) icon remains. `grep -rn "i-carbon" app/` returns nothing.

### Persistence and no-flash resolution

- **AC16.** The `settings` table keeps both `light_theme` and `dark_theme` columns, neither dropped nor collapsed into one, both free text drawing from the same five-id namespace, both defaulting to `'pastel'` at the app level. The user can match a theme by name across modes or mix the light of one theme with the dark of another.
- **AC17.** The two stored theme columns are resolved server-side and pass through `coerceThemeId` before they reach the typed session, so a stale value resolves to `'pastel'` on the first server-rendered paint. When no settings row exists, the resolved preferences are `pastel` / `pastel` / `fr`.
- **AC18.** `app/app.vue` writes `data-theme`, `data-light-theme`, and `data-dark-theme` onto the `html` element from the session-resolved ids, and a synchronous pre-paint guard script resolves the one thing the server cannot know, the `system` colour-mode pick, from the colour-mode cookie or `localStorage` plus `matchMedia`, and sets `data-theme` to the matching id before the browser paints. No cookie mirror of the theme, and no flash.
- **AC19.** `app.vue` also exposes a brightness-derived on-primary text colour (`--ui-text-inverted`) so a button label stays legible on any theme's primary fill, and recolors the SVG favicon to the active theme's primary and ink. Both are derived from the palette, not hard-coded per theme.

### Palette mirror (`app/composables/useTheme.ts`)

- **AC20.** `useTheme` builds its option list from `THEME_IDS` so the client list cannot drift from the server-validated set, and carries per theme the swatch tones (`canvas`, `primary`, `accent`, `ink`) for light and dark, with the `default` flag on `pastel` only. The header theme picker renders three swatch dots per theme (`canvas`, `primary`, `accent`) and one name per theme regardless of mode.

## Edge cases

- **Stale stored id.** A settings row may hold a renamed or removed id on either column. The value coerces to a valid rendering theme at read time, defaulting to `pastel`, so no id without a matching `[data-theme]` block ever reaches `<html>`.
- **Mixed light/dark selection.** A user may store `light_theme = 'encre'` and `dark_theme = 'foret'`. The columns are independent: light mode renders Encre, dark mode renders Forêt, with no coupling.
- **Signed-out visitor or no settings row.** Both render the `pastel` default in the correct mode on first paint, with no invalid `data-theme` reaching `<html>`.
- **Darkest canvases with the page radial.** The radial must stay a faint tint, never a visible blob, on the darkest dark canvases (`pastel` `#10201c`, `automne` `#1b1109`, `foret` `#0e1a12`). The 0.07 dark alpha carries this.
- **Low-contrast pairings.** Three light accent anchors and one dark accent were adjusted on-hue so each accent step clears its AA bar as text and label; the pastel light primary was darkened on-hue so the white button label clears 4.5:1. Any future anchor that cannot meet its bar is adjusted by the minimum number of shades rather than shipped below AA.
- **Autofill fighting the theme.** The autofill rules paint an inset primary-tinted fill on inputs, so the hover border stays on buttons, not inputs, and the two never compete.
- **Hydration of mode-dependent chrome.** The theme picker label is one name per theme, mode-independent, so it is not a hydration surface. The colour-mode control stays behind its existing client guard so SSR and client do not mismatch.
- **Locale name identity.** Theme names are proper nouns identical in FR and EN. Switching locale changes the picker's surrounding chrome (the group label, the default suffix) but not the five names.

## Open questions

None.
