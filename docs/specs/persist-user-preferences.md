# Persist user preferences (theme and language)

## Intent

The theme selector (the light and dark atmospheres defined in `useTheme`) and the FR/EN language toggle already ship in the header, but both persist only to cookies today. This feature makes the user's account the source of truth for those preferences so they follow the user across devices instead of living in one browser. It wires the existing UI to a real settings API, demotes cookies to a pre-auth default only, and keeps the no-flash guarantee on first paint by resolving the chosen atmosphere server-side. Nothing new is added to the visible UI. This is plumbing behind controls that already exist.

The feature is being pulled forward because building the pickers without wiring real persistence risks the persistence being forgotten now that the visible parts look finished. See `AGENTS.md`, `docs/spec.md` §4, and `docs/TODO.md`.

## Storage decisions (settled, do not re-derive)

- **All three preferences live on the `settings` row.** Theme is two independent columns, `light_theme` and `dark_theme`, each holding a theme id from `themeOptions` in `app/composables/useTheme.ts`. Locale is a third column, `locale`. Keeping the three together means one row, one read path, and one write path for a "save preferences" action.
- **Locale moves off `users`.** `users.locale` exists today (`text`, not null, default `'fr'`) but nothing in the server or client reads it, so it is a defined-but-unused column. This feature retires it and makes `settings.locale` the source of truth. `spec.md` §13 previously said locale "persists to `users.locale`", and that reference is now updated to `settings.locale`.
- **Theme default is `pastel`.** The column default matches `DEFAULT_THEME` in `useTheme.ts`. The owner confirmed the coded value is authoritative over the older `ember` mention in the docs, which were corrected.
- Cookies (`ui-theme-light`, `ui-theme-dark`) stop being the source of truth, but they do not go away. The database becomes the authority and the cookies become a client-readable cache derived from it, refreshed from the user's `settings` on session creation and on every preference write. They are needed because the server cannot know a `system`-mode user's light-versus-dark choice at render time, so a value has to be readable by the pre-paint guard in `app/app.vue`, and the encrypted session cookie is not readable by that inline script. On the pre-auth screens the same cookies serve as the display default with no user attached. The `nuxt-color-mode` cookie/localStorage keeps driving light versus dark mode as it does today. This feature does not change light/dark mode persistence, only which atmosphere is chosen within each mode.

## Inputs

- **Read on load (authenticated user)**: the current user's `light_theme`, `dark_theme`, and `locale` from the `settings` row, carried in the session payload so they are present on first paint with no per-render database read.
- **Read on load (pre-auth screens)**: the `ui-theme-light` / `ui-theme-dark` cookie values, read server-side per request, used only as a display default with no user attached.
- **Write**: a single request from the client when the user picks an atmosphere or toggles language in the header. Body carries only the changed fields, for example `{ lightTheme: <themeId> }`, `{ darkTheme: <themeId> }`, or `{ locale: 'fr' | 'en' }`. The exact route shape is defined under Outputs.
- Both write triggers are user-initiated actions on controls that already exist in `app/components/app/header.vue`.

## Outputs and acceptance criteria

### Schema and migration

- `settings` gains three columns: `light_theme` (text, not null, default `'pastel'`), `dark_theme` (text, not null, default `'pastel'`), and `locale` (text, not null, default `'fr'`). The theme defaults match `DEFAULT_THEME` in `useTheme.ts`.
- A Drizzle migration adds the three columns, backfills a `settings` row for every existing user who lacks one, and copies each existing `users.locale` value into the new `settings.locale` during the backfill so no one's language is lost. After the backfill, the migration drops `users.locale`. Dropping it is safe because nothing reads it, which was verified against the server and client code.
- The `settings` row is also created when a user completes onboarding, in `server/api/onboarding/handlers/complete.ts`, so every user onboarded after this migration has a row from the start. Between the migration backfill and onboarding creation, every user ends up with exactly one row.

### Read and server-side resolution (no flash)

- The resolved atmosphere is written into the initial HTML (`<html data-theme="...">` and the `.dark` class) before anything renders. On a hard refresh there is no flash of the default atmosphere followed by a swap to the user's choice. This is the primary acceptance criterion and it restates the "No flash of the wrong theme (requirement)" paragraph in `spec.md` §4.
- The mechanism is a hybrid, because no single layer can cover every case. The `nuxt-auth-utils` session payload carries `light_theme`, `dark_theme`, and `locale`, already loads server-side on every request, and is the source the server uses to render the atmosphere at SSR time for a user whose color mode is an explicit light or dark. There is no client fetch after mount and no database query per render.
- For a `system`-mode user the server cannot know the OS color scheme, so the existing synchronous pre-paint guard in `app/app.vue` still resolves dark versus light on the client via `matchMedia` and reads the atmosphere from the `ui-theme-light` / `ui-theme-dark` cookies before paint. Those cookies are kept in sync with the user's `settings` (see the storage decisions), so the guard reads the persisted choice rather than a stale one. The guard's logic does not need to change; what changes is that the cookies it reads are now written from the database.
- The session payload and the cookie mirror are both populated from the user's `settings` row at every session-creation site: `server/api/magic-link/handlers/verify.ts`, `server/api/auth/handlers/login.ts`, `server/routes/auth/google.get.ts`, and `server/api/onboarding/handlers/complete.ts`. A change made through the write API refreshes both the session and the cookies so the new value is present on the next render without a re-login.
- For the pre-auth screens, the same no-flash guarantee holds by reading the cookie default server-side and in the client guard on each request. A signed-out visitor on the sign-in or sign-up page never sees a flash either.
- Locale is resolved server-side from the session for authenticated users so the first rendered copy is already in the persisted language.

### Write API

- A single endpoint, `/api/me/preferences`, serves this feature, following the backend conventions in the `my-backend-conventions` skill. Route files stay thin, business logic lives in a `handlers/` directory, the Zod model lives in `server/models/`, and every route validates its input with `readValidatedBody` and `.safeParse`. The route uses the authenticated-handler wrapper.
- `GET /api/me/preferences` returns the current user's `light_theme`, `dark_theme`, and `locale`. `PATCH /api/me/preferences` accepts a partial body of those fields, validates them, writes them to the current user's `settings` row, refreshes the session payload, and returns the updated values.
- The Zod model rejects an invalid theme id (not one of the known `themeOptions` ids) and a locale outside `fr` and `en` with a 422.
- Writes are scoped to the current user from the session. A user can never write another user's preferences.
- If the user somehow has no `settings` row when a write arrives (an edge that the backfill and onboarding creation are meant to prevent), the write creates it rather than failing silently.

### Rewiring the client

- `useTheme` reads its initial `lightTheme` / `darkTheme` from the server-resolved session values for an authenticated user, and from the cookie default only when there is no user. It writes a pick to `PATCH /api/me/preferences`, and the cookie is no longer the store for a signed-in user.
- The header language toggle calls the same endpoint with `{ locale }` in addition to calling `setLocale`, so the choice survives a new session on another device. The visible toggle behavior does not change.
- After a successful write, a page reload or a move to another device shows the persisted preference with no flash.

### Copy and i18n

- The theme picker and language toggle labels already exist as verified FR/EN keys under `header.*` and `theme.*` in `i18n/locales/`. This feature is not expected to add visible strings. If any user-facing string is added (for example an error toast on a failed save), it needs researched, correct FR and EN copy, French first. French uses a space before `? ! : ;`. No LLM-guessed copy ships.

### Product non-negotiable

- The app records and restores the user's own choice. It does not police the user. There is no theme or locale the app forces, blocks, or overrides beyond falling back to the documented default when nothing is stored.

## Edge cases

- **Stored theme id no longer exists** (an atmosphere was renamed or removed). The resolver falls back to the default id rather than rendering a broken `data-theme`.
- **`system` color mode on first paint**. The server cannot know the OS color scheme for a `system` user, so the SSR-rendered `data-theme` may not match the mode the client resolves. This is why the cookie mirror exists. The pre-paint guard in `app/app.vue` reads the `ui-theme-light` / `ui-theme-dark` cookies (now DB-synced) and resolves dark versus light via `matchMedia` before paint, so a `system` user in dark mode still lands on the correct dark atmosphere with no flash. The design stage must confirm the write API and every session-creation site update these cookies so the guard never reads a stale value, since a stale cookie here is the one way the flash comes back.
- **New user between session creation and onboarding**. The magic-link `verify` handler can create a user before onboarding, so a brand-new user may briefly have no `settings` row while on the onboarding screens. During that window the session carries no preferences and the app falls back to the documented defaults, which is acceptable on the onboarding flow. Onboarding completion creates the row.
- **Write fails** (network or DB error). The in-memory pick still applies for the session so the UI is responsive, but the failure is surfaced and the persisted value is unchanged. Retry behavior is a design decision.
- **Signed-out user picks a theme on a pre-auth screen**. The choice updates the cookie default only. It is not written to any account and does not leak into another user's settings.
- **Locale toggle before the write resolves**. `setLocale` already switches the UI immediately. The persisted value catches up on the write. A failed write leaves `settings.locale` unchanged while the current session stays on the toggled locale.
- **Concurrent devices**. Two devices can hold different in-memory picks. The last write wins in the database, and each device reflects its own last action until the next reload. No merge is attempted.

## Resolved decisions

These were settled with the owner during the specs stage.

- **Locale consolidates onto `settings`.** Rather than leaving theme on `settings` and locale on `users`, all three preferences live on the `settings` row so one save touches one table. `users.locale` is unused and is dropped by the migration after its values are backfilled.
- **No-flash mechanism is the session payload, plus a DB-synced cookie mirror for the client guard.** The resolved theme and locale ride in the `nuxt-auth-utils` session, which already loads server-side, so there is no per-render database read. Because a `system`-mode user's light-versus-dark choice is only known on the client, the `ui-theme-*` cookies stay as a client-readable mirror of the settings values so the existing `app/app.vue` pre-paint guard keeps working. The tradeoff accepted is that both the session and the cookies must be refreshed when a preference changes, which the write endpoint does.
- **Row creation is backfill plus onboarding.** The migration backfills a `settings` row for every existing user, and onboarding completion creates the row for new users, so read paths can assume a row exists.
- **One endpoint, not two.** A single `/api/me/preferences` route reads and writes all three fields. The client saves "preferences" without knowing the storage layout.
- **Default atmosphere is `pastel`.** Confirmed against `useTheme.ts`; the older `ember` mentions in `spec.md` and `TODO.md` were corrected.

## Open questions

None remaining. All decisions above are settled. Design-stage judgement is still needed on the `system` color-mode guard interaction and on write-failure retry behavior, both captured under Edge cases.

## Notes for later stages

- Relevant files: `app/composables/useTheme.ts` (theme store and defaults), `app/components/app/header.vue` (pickers and locale toggle), `app/app.vue` (the current pre-paint no-flash guard and `useHead` injection), `app/types/auth.d.ts` (the session type, which gains the preference fields), `server/db/schema.ts` (the `settings` and `users` tables), the four session-creation handlers listed under Read and server-side resolution, and `i18n/locales/fr.json` and `i18n/locales/en.json` (existing verified copy).
- Docs to reconcile when this lands: `spec.md` §13 (the language item now persists to `settings.locale`, not `users.locale`) and `docs/TODO.md` (the item-1 notes referencing `users.locale`).
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.
