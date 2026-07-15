# Persist user preferences (theme and language)

## Intent

The theme selector (seven light and seven dark atmospheres) and the FR/EN language toggle already ship in the header, but both persist only to cookies today. This feature makes the user's account the source of truth for those preferences so they follow the user across devices instead of living in one browser. It wires the existing UI to a real settings API, demotes cookies to a pre-auth default only, and keeps the no-flash guarantee on first paint by resolving the chosen atmosphere server-side. Nothing new is added to the visible UI. This is plumbing behind controls that already exist.

The feature is being pulled forward because building the pickers without wiring real persistence risks the persistence being forgotten now that the visible parts look finished. See `AGENTS.md`, `docs/spec.md` §4, and `docs/TODO.md`.

## Storage decisions (settled, do not re-derive)

These come from `docs/spec.md` §4 and §13 and from the current schema. They are inputs to this spec, not open questions.

- **Theme** lives on the `settings` row as two independent columns, `light_theme` and `dark_theme`. Each holds a theme id from `themeOptions` in `app/composables/useTheme.ts`. This is the "Theme persistence (decision)" paragraph in `spec.md` §4.
- **Locale** lives on `users.locale`. That column already exists in `server/db/schema.ts` (`text`, not null, default `'fr'`) and `spec.md` §13 states the language item "persists to `users.locale`". Locale is not moved onto `settings`.
- Theme and locale therefore live in two different tables. Both are user preferences, but they sit where each existing decision already placed them. The split is called out in Open questions in case it should be consolidated, but this spec treats it as settled and keeps both tables in play.
- Cookies (`ui-theme-light`, `ui-theme-dark`) stop being the source of truth. They survive only as a pre-auth default on the sign-in and sign-up screens, where there is no user yet. The `nuxt-color-mode` cookie/localStorage keeps driving light vs dark mode as it does today. This feature does not change light/dark mode persistence, only which atmosphere is chosen within each mode.

## Inputs

- **Read on load (authenticated user)**: the current user's `light_theme`, `dark_theme` (from `settings`) and `locale` (from `users`), resolved server-side so they are present on first paint.
- **Read on load (pre-auth screens)**: the `ui-theme-light` / `ui-theme-dark` cookie values, read server-side per request, used only as a display default with no user attached.
- **Write, theme**: a request from `useTheme` when the user picks an atmosphere in the header picker. Body carries the mode being changed and the chosen theme id, for example `{ mode: 'light' | 'dark', theme: <themeId> }`. The exact route shape is defined under Outputs.
- **Write, locale**: a request when the user toggles language in the header. Body carries the target locale, for example `{ locale: 'fr' | 'en' }`.
- Both write paths are user-initiated actions on controls that already exist in `app/components/app/header.vue`.

## Outputs and acceptance criteria

### Schema and migration

- `settings` gains `light_theme` (text, not null) and `dark_theme` (text, not null) with a default of `pastel`, matching `DEFAULT_THEME` in `useTheme.ts`. The coded default is authoritative and `spec.md` was corrected to match it.
- A Drizzle migration adds both columns. Existing `settings` rows take the column default. See Open questions on the fact that no code path creates `settings` rows today, so the migration alone does not guarantee every user has a row.
- `users.locale` needs no schema change. It already exists.

### Read API and server-side resolution

- The atmosphere is resolved on the server and written into the initial HTML (`<html data-theme="...">` and the `.dark` class) before anything renders. On a hard refresh there is no flash of the default atmosphere followed by a swap to the user's choice. This is the primary acceptance criterion and it restates the "No flash of the wrong theme (requirement)" paragraph in `spec.md` §4.
- For an authenticated user, the resolved atmosphere comes from that user's `settings`, not from a cookie and not from a client fetch after mount.
- For the pre-auth screens, the same no-flash guarantee holds by reading the cookie default server-side on each request. A signed-out visitor on the sign-in or sign-up page never sees a flash either.
- Locale is likewise resolved server-side from `users.locale` for authenticated users so the first rendered copy is already in the persisted language.

### Write API

- A settings read/write API exists for these preferences, following the backend conventions in the `my-backend-conventions` skill. Route files stay thin, business logic lives in a `handlers/` directory, Zod schemas live in `server/models/`, and every route validates its input with `readValidatedBody` / `getValidatedQuery` and `.safeParse`. Protected routes use the authenticated-handler wrapper.
- A theme write persists the chosen id to the correct column (`light_theme` or `dark_theme`) on the current user's `settings` row and returns success. An invalid theme id (not one of the known `themeOptions` ids) is rejected by validation with a 422.
- A locale write persists the chosen value to `users.locale` and returns success. A value outside the supported locales (`fr`, `en`) is rejected with a 422.
- Writes are scoped to the current user from the session. A user can never write another user's preferences.
- The write path creates the `settings` row if the user has none yet, so a first-ever theme pick does not silently fail. See Open questions for whether row creation belongs here or elsewhere.

### Rewiring the client

- `useTheme` reads its initial `lightTheme` / `darkTheme` from the server-resolved user values for an authenticated user, and from the cookie default only when there is no user. It writes a pick to the theme API, and the cookie is no longer the store for a signed-in user.
- The header language toggle writes to the locale API in addition to calling `setLocale`, so the choice survives a new session on another device. The visible toggle behavior does not change.
- After a successful write, a page reload or a move to another device shows the persisted preference with no flash.

### Copy and i18n

- The theme picker and language toggle labels already exist as verified FR/EN keys under `header.*` and `theme.*` in `i18n/locales/`. This feature is not expected to add visible strings. If any user-facing string is added (for example an error toast on a failed save), it needs researched, correct FR and EN copy, French first. French uses a space before `? ! : ;`. No LLM-guessed copy ships.

### Product non-negotiable

- The app records and restores the user's own choice. It does not police the user. There is no theme or locale the app forces, blocks, or overrides beyond falling back to the documented default when nothing is stored.

## Edge cases

- **No `settings` row for the user**. Reads fall back to the default theme id. The first theme write creates the row. This matters because no current code path creates `settings` rows, so most or all existing users have none.
- **Stored theme id no longer exists** (an atmosphere was renamed or removed). The resolver falls back to the default id rather than rendering a broken `data-theme`.
- **`system` color mode on first paint**. The server cannot know the OS color scheme for a `system` user, so the SSR-rendered `data-theme` may not match the mode the client resolves. The existing pre-paint guard in `app/app.vue` handles this today by reading cookies. That guard must keep working, or its logic must move to read the server-resolved user atmospheres, so a `system` user in dark mode still lands on the correct dark atmosphere with no flash. This is the trickiest interaction between server resolution and the client guard and needs care in the design stage.
- **Write fails** (network or DB error). The in-memory pick still applies for the session so the UI is responsive, but the failure is surfaced and the persisted value is unchanged. Retry behavior is a design decision.
- **Signed-out user picks a theme on a pre-auth screen**. The choice updates the cookie default only. It is not written to any account and does not leak into another user's settings.
- **Locale toggle before the write resolves**. `setLocale` already switches the UI immediately. The persisted value catches up on the write. A failed write leaves `users.locale` unchanged while the current session stays on the toggled locale.
- **Concurrent devices**. Two devices can hold different in-memory picks. The last write wins in the database, and each device reflects its own last action until the next reload. No merge is attempted.

## Resolved decisions

- **Default atmosphere is `pastel`**. `spec.md` §4 previously documented the column default as `'ember'`, but `useTheme.ts` sets `DEFAULT_THEME = 'pastel'`, marks `pastel` as `default: true`, and the FR copy treats `pastel` as the default. The owner confirmed the coded value is authoritative, so the column default is `pastel` and `spec.md` and `TODO.md` were corrected to match.

## Open questions

- **Locale on `users` vs `settings`**. Theme sits on `settings` and locale sits on `users`, so the two preferences this feature persists live in different tables. This follows the existing decisions, but it means two read paths and two write paths for one conceptual "preferences" save. Should locale move onto `settings` alongside the theme columns, or stay on `users`? Staying on `users` is assumed unless changed.
- **No-flash mechanism, session payload vs SSR load**. `spec.md` §4 leaves open whether the server carries the resolved atmosphere in the session payload or loads it during SSR from the database. Session payload avoids a per-request DB read but means the session must be updated on every theme change. An SSR load keeps the session minimal but adds a query per render. This needs a decision in the design or backend stage.
- **Where `settings` row creation lives**. No code path creates `settings` rows today. Options are to create the row lazily on the first preference write, to create it at onboarding or first sign-in, or to backfill all existing users in the migration. The choice affects the migration and the read fallbacks.
- **Whether the write is one endpoint or two**. Theme and locale could share a single preferences endpoint or use separate routes given they touch different tables. Either fits the backend conventions. A choice is needed so the route files can be scaffolded.

## Notes for later stages

- Relevant files: `app/composables/useTheme.ts` (theme store and defaults), `app/components/app/header.vue` (pickers and locale toggle), `app/app.vue` (the current pre-paint no-flash guard and `useHead` injection), `server/db/schema.ts` (the `settings` and `users` tables), `i18n/locales/fr.json` and `i18n/locales/en.json` (existing verified copy).
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.
