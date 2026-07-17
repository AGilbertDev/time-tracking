# Persist user preferences (theme and language)

## Intent

The theme selector (the light and dark atmospheres defined in `useTheme`) and the FR/EN language toggle already ship in the header, but both persist only to cookies today. This feature makes the user's account the source of truth for those preferences so they follow the user across devices instead of living in one browser. It wires the existing UI to a real settings API, carries the resolved preferences in the encrypted `nuxt-auth-utils` session so the server reads them during SSR, and keeps the no-flash guarantee on first paint by resolving the chosen atmosphere server-side. Nothing new is added to the visible UI. This is plumbing behind controls that already exist.

The feature is being pulled forward because building the pickers without wiring real persistence risks the persistence being forgotten now that the visible parts look finished. See `AGENTS.md`, `docs/spec.md` §4, and `docs/TODO.md`.

## Storage decisions (settled, do not re-derive)

- **All three preferences live on the `settings` row.** Theme is two independent columns, `light_theme` and `dark_theme`, each holding a theme id from `themeOptions` in `app/composables/useTheme.ts`. Locale is a third column, `locale`. Keeping the three together means one row, one read path, and one write path for a "save preferences" action.
- **Locale moves off `users`.** `users.locale` exists today (`text`, not null, default `'fr'`) but nothing in the server or client reads it, so it is a defined-but-unused column. This feature retires it and makes `settings.locale` the source of truth. `spec.md` §13 previously said locale "persists to `users.locale`", and that reference is now updated to `settings.locale`.
- **Theme default is `pastel`.** The column default matches `DEFAULT_THEME` in `useTheme.ts`. The owner confirmed the coded value is authoritative over the older `ember` mention in the docs, which were corrected.
- There is no separate theme cookie. The database is the authority and the three values are delivered to the server through the encrypted `nuxt-auth-utils` session payload, which the server already reads on every request. At SSR the server renders `data-theme` on `<html>` and also injects `data-light-theme` and `data-dark-theme`, the two resolved ids from the session. The one thing the server cannot know, a `system`-mode user's light-versus-dark choice, is resolved before paint by a small synchronous inline `<head>` script that reads those two `data-*` attributes plus `matchMedia`. That script reads no cookie. Locale is the one exception that keeps a cookie: it is still mirrored to `i18n_redirected` because `@nuxtjs/i18n` reads that cookie server-side to render the right language on first paint, so the mirror is the module's own mechanism rather than part of the removed theme mirror. The `nuxt-color-mode` cookie/localStorage keeps driving light versus dark mode as it does today. This feature does not change light/dark mode persistence, only which atmosphere is chosen within each mode.

## Inputs

- **Read on load (authenticated user)**: the current user's `light_theme`, `dark_theme`, and `locale` from the `settings` row, carried in the session payload so they are present on first paint with no per-render database read.
- **Read on load (pre-auth screens)**: nothing preference-specific. No theme picker exists before auth, so a signed-out visitor gets the coded default atmosphere and `@nuxtjs/color-mode` decides their light versus dark. No theme cookie is involved.
- **Write**: a single request from the client when the user picks an atmosphere or toggles language in the header. Body carries only the changed fields, for example `{ lightTheme: <themeId> }`, `{ darkTheme: <themeId> }`, or `{ locale: 'fr' | 'en' }`. The exact route shape is defined under Outputs.
- Both write triggers are user-initiated actions on controls that already exist in `app/components/app/header.vue`.

## Outputs and acceptance criteria

### Schema and migration

- `settings` gains three columns: `light_theme` (text, not null, default `'pastel'`), `dark_theme` (text, not null, default `'pastel'`), and `locale` (text, not null, default `'fr'`). The theme defaults match `DEFAULT_THEME` in `useTheme.ts`.
- A Drizzle migration adds the three columns, backfills a `settings` row for every existing user who lacks one, and copies each existing `users.locale` value into the new `settings.locale` during the backfill so no one's language is lost. After the backfill, the migration drops `users.locale`. Dropping it is safe because nothing reads it, which was verified against the server and client code.
- The `settings` row is also created when a user completes onboarding, in `server/api/onboarding/handlers/complete.ts`, so every user onboarded after this migration has a row from the start. Between the migration backfill and onboarding creation, every user ends up with exactly one row.

### Read and server-side resolution (no flash)

- The resolved atmosphere is written into the initial HTML (`<html data-theme="...">` and the `.dark` class) before anything renders. On a hard refresh there is no flash of the default atmosphere followed by a swap to the user's choice. This is the primary acceptance criterion and it restates the "No flash of the wrong theme (requirement)" paragraph in `spec.md` §4.
- This design was validated against a web-sourced research review recorded at `docs/research/theme-language-persistence.md`. The review confirmed it matches accepted flash-free practice: the database is the source of truth, the values are delivered through a server-readable channel, and an inline pre-paint script covers only the case the server cannot know, `system` color mode.
- The `nuxt-auth-utils` session payload carries `light_theme`, `dark_theme`, and `locale`, already loads server-side on every request, and is the source the server uses to render the atmosphere at SSR time. The session is itself an encrypted, server-readable cookie, so the server has the values in hand during SSR. There is no client fetch after mount and no database query per render.
- At SSR the server renders `data-theme` on `<html>` and also injects `data-light-theme` and `data-dark-theme`, the two resolved ids from the session, onto the same element. For a `system`-mode user the server cannot know the OS color scheme, so a small synchronous inline `<head>` script in `app/app.vue` runs before paint, reads those two `data-*` attributes plus the color-mode value and `matchMedia`, and sets `data-theme` to the correct atmosphere. The script reads no cookie. A `system` user in dark mode lands on the correct dark atmosphere with no flash.
- The session payload is populated from the user's `settings` row at every session-creation site: `server/api/magic-link/handlers/verify.ts`, `server/api/auth/handlers/login.ts`, and `server/api/onboarding/handlers/complete.ts` (the Google OAuth site is out of scope, see the note at the end). A change made through the write API refreshes the session so the new value is present on the next render without a re-login.
- For the pre-auth screens the guarantee is trivial. There is no theme picker before auth, so a signed-out visitor gets the coded default and never sees a flash.
- Locale is resolved server-side from the session for authenticated users, and mirrored to the `i18n_redirected` cookie that `@nuxtjs/i18n` reads server-side, so the first rendered copy is already in the persisted language.

### Write API

- A single endpoint, `/api/me/preferences`, serves this feature, following the backend conventions in the `my-backend-conventions` skill. Route files stay thin, business logic lives in a `handlers/` directory, the Zod model lives in `server/models/`, and every route validates its input with `readValidatedBody` and `.safeParse`. The route uses the authenticated-handler wrapper.
- `GET /api/me/preferences` returns the current user's `light_theme`, `dark_theme`, and `locale`. `PATCH /api/me/preferences` accepts a partial body of those fields, validates them, writes them to the current user's `settings` row, refreshes the session payload, and returns the updated values.
- The Zod model rejects an invalid theme id (not one of the known `themeOptions` ids) and a locale outside `fr` and `en` with a 422.
- Writes are scoped to the current user from the session. A user can never write another user's preferences.
- If the user somehow has no `settings` row when a write arrives (an edge that the backfill and onboarding creation are meant to prevent), the write creates it rather than failing silently.

### Rewiring the client

- `useTheme` reads its initial `lightTheme` / `darkTheme` from the server-resolved session values for an authenticated user, and from the coded default as the only fallback when there is no user. It performs no theme-cookie reads or writes at all. The pick is written to `PATCH /api/me/preferences` from the header, through the shared `usePreferences().savePreferences` path.
- The header language toggle calls the same endpoint with `{ locale }` in addition to calling `setLocale`, so the choice survives a new session on another device. The visible toggle behavior does not change.
- After a successful write, a page reload or a move to another device shows the persisted preference with no flash.

### Copy and i18n

- The theme picker and language toggle labels already exist as verified FR/EN keys under `header.*` and `theme.*` in `i18n/locales/`. This feature is not expected to add visible strings. If any user-facing string is added (for example an error toast on a failed save), it needs researched, correct FR and EN copy, French first. French uses a space before `? ! : ;`. No LLM-guessed copy ships.

### Product non-negotiable

- The app records and restores the user's own choice. It does not police the user. There is no theme or locale the app forces, blocks, or overrides beyond falling back to the documented default when nothing is stored.

## Edge cases

- **Stored theme id no longer exists** (an atmosphere was renamed or removed). The resolver falls back to the default id rather than rendering a broken `data-theme`.
- **`system` color mode on first paint**. The server cannot know the OS color scheme for a `system` user, so the SSR-rendered `data-theme` may not match the mode the client resolves. This is why the inline pre-paint script exists. The script in `app/app.vue` reads the `data-light-theme` and `data-dark-theme` ids that SSR injected from the session, resolves dark versus light via `matchMedia`, and sets `data-theme` before paint, so a `system` user in dark mode still lands on the correct dark atmosphere with no flash. Because the ids ride in the session and are re-read on every render, there is no cookie to go stale and no separate write to keep in sync.
- **New user between session creation and onboarding**. The magic-link `verify` handler can create a user before onboarding, so a brand-new user may briefly have no `settings` row while on the onboarding screens. During that window the session carries no preferences and the app falls back to the documented defaults, which is acceptable on the onboarding flow. Onboarding completion creates the row.
- **Write fails** (network or DB error). The in-memory pick still applies for the session so the UI is responsive, but the failure is surfaced and the persisted value is unchanged. Retry behavior is a design decision.
- **Signed-out visitor and the theme picker**. There is no theme picker before auth, so a signed-out visitor cannot pick an atmosphere. They get the coded default, and `savePreferences` no-ops when there is no session, so nothing is ever written to an account or leaked into another user's settings.
- **Locale toggle before the write resolves**. `setLocale` already switches the UI immediately. The persisted value catches up on the write. A failed write leaves `settings.locale` unchanged while the current session stays on the toggled locale.
- **Concurrent devices**. Two devices can hold different in-memory picks. The last write wins in the database, and each device reflects its own last action until the next reload. No merge is attempted.

## Resolved decisions

These were settled with the owner during the specs stage.

- **Locale consolidates onto `settings`.** Rather than leaving theme on `settings` and locale on `users`, all three preferences live on the `settings` row so one save touches one table. `users.locale` is unused and is dropped by the migration after its values are backfilled.
- **No-flash mechanism is the session payload, with an inline pre-paint script for the `system` case.** The resolved theme and locale ride in the `nuxt-auth-utils` session, which is an encrypted server-readable cookie that already loads server-side, so there is no per-render database read. SSR renders `data-theme` and injects `data-light-theme` and `data-dark-theme` from the session; a small synchronous inline `<head>` script reads those attributes plus `matchMedia` to resolve the one thing the server cannot know, `system` color mode, and reads no cookie. There is no theme cookie mirror; the earlier per-theme cookie approach was removed. Only the session needs refreshing when a preference changes, which the write endpoint does. This mechanism was validated against a web-sourced research review recorded at `docs/research/theme-language-persistence.md`, which confirmed it matches accepted flash-free practice: a database source of truth, delivered through a server-readable channel, with an inline script only for the `system` case.
- **Row creation is backfill plus onboarding.** The migration backfills a `settings` row for every existing user, and onboarding completion creates the row for new users, so read paths can assume a row exists.
- **One endpoint, not two.** A single `/api/me/preferences` route reads and writes all three fields. The client saves "preferences" without knowing the storage layout.
- **Default atmosphere is `pastel`.** Confirmed against `useTheme.ts`; the older `ember` mentions in `spec.md` and `TODO.md` were corrected.

## Open questions

None remaining. All decisions above are settled. Design-stage judgement is still needed on the `system` color-mode guard interaction and on write-failure retry behavior, both captured under Edge cases.

## Notes for later stages

- Relevant files: `app/composables/useTheme.ts` (theme store and defaults), `app/components/app/header.vue` (pickers and locale toggle), `app/app.vue` (the current pre-paint no-flash guard and `useHead` injection), `app/types/auth.d.ts` (the session type, which gains the preference fields), `server/db/schema.ts` (the `settings` and `users` tables), the four session-creation handlers listed under Read and server-side resolution, and `i18n/locales/fr.json` and `i18n/locales/en.json` (existing verified copy).
- Docs to reconcile when this lands: `spec.md` §13 (the language item now persists to `settings.locale`, not `users.locale`) and `docs/TODO.md` (the item-1 notes referencing `users.locale`).
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.

## Design blueprint

This feature is plumbing, not visible UI. There are no new layout regions, no new components, and no new visual states. The header dropdown, the atmosphere swatches, and the language row all stay exactly as they render today. What follows is the data-flow and architecture contract the backend and frontend stages implement. The only user-facing visual addition is one error toast on a failed save, covered under "Write-failure behaviour".

### Shared theme id source

The theme id list currently lives only in `app/composables/useTheme.ts` (`themeOptions`), which the server cannot import. To validate ids server-side without drifting from the real list, extract the canonical ids into a shared module both sides import. Create `shared/theme.ts` (Nuxt 4 loads `shared/` for both app and server) exporting:

- `export const THEME_IDS = ['pastel', 'ember', 'onyx', 'coffee', 'forest', 'autumn', 'berry', 'frost'] as const`
- `export type ThemeId = (typeof THEME_IDS)[number]`
- `export const DEFAULT_THEME_ID: ThemeId = 'pastel'`
- `export const LOCALES = ['fr', 'en'] as const` and `export type Locale = (typeof LOCALES)[number]`

`useTheme.ts` keeps `themeOptions` (it owns the palettes and names) but its `DEFAULT_THEME` re-exports or references `DEFAULT_THEME_ID` so there is one default. The Zod model and the session types both import from `shared/theme.ts`. This is what "validated against the real `themeOptions` ids" means in practice, one list, imported in three places.

### 1. Session payload shape

The three preferences are added as flat fields on the session `user` object, matching how `firstName`, `lastName`, and `onboarded` already sit there. No sibling object, so consumers read `user.lightTheme` with no extra nesting and the four handlers change the least.

In `app/types/auth.d.ts` the `User` interface gains:

- `lightTheme: string`
- `darkTheme: string`
- `locale: Locale` (the `'fr' | 'en'` type from `shared/theme.ts`)

These stay non-optional. Every session-creation site populates them, using the user's `settings` row when one exists and the coded defaults (`pastel`, `pastel`, `fr`) when it does not. That covers the pre-onboarding window where a magic-link user has no `settings` row yet, so consumers never handle `undefined`.

### 2. Preference delivery and the locale cookie

The database is the authority. The three values reach the server through the encrypted `nuxt-auth-utils` session payload, so there is no theme cookie. SSR injects the resolved theme ids onto `<html>` as `data-*` attributes for the inline pre-paint script to read, and one cookie mirrors the locale for `@nuxtjs/i18n`.

- Theme is delivered in the session, not a cookie. At SSR the `app/app.vue` `useHead` block writes `data-theme` and injects `data-light-theme` and `data-dark-theme` (the resolved ids from `useTheme`, which reads them from the session) onto the html element. The inline `noFlashTheme` script reads those `data-*` attributes, so no theme cookie is needed and none is written. Removing the theme cookie is what removed the class of flash a stale or missing cookie used to cause.
- `i18n_redirected` is the locale mirror and the one cookie this feature writes. It is the cookie `@nuxtjs/i18n` already reads through `detectBrowserLanguage` (default `useCookie: true`, `cookieKey: 'i18n_redirected'`, `redirectOn: 'root'`). Writing it server-side is what lets the module resolve the persisted locale on the first request. Write it with the module's own attributes (`path: '/'`, `maxAge` of one year, not `httpOnly`).

Who writes it:

- The session-creation handlers call `applyPreferenceCookies` from the `settings` row (or defaults) at the moment they call `setUserSession`, which writes `i18n_redirected`.
- The `PATCH /api/me/preferences` handler calls it again so the next render, and the next hard reload, both read the new locale with no re-login.

`applyPreferenceCookies(event, { lightTheme, darkTheme, locale })` lives in `server/utils/` and now writes only `i18n_redirected`. It still takes the full preference object so its signature stays stable and the caller sites do not have to know which fields map to a cookie. Pair it with a `loadUserPreferences(userId)` util that returns `{ lightTheme, darkTheme, locale }` from the `settings` row and falls back to the defaults, reused by the session sites, the GET handler, and the PATCH handler so the read path exists once.

The `app/app.vue` inline script reads `nuxt-color-mode`, resolves dark via `matchMedia`, and reads `data-dark-theme` / `data-light-theme` from the html element. It reads no theme cookie.

### 3. `useTheme` refactor plan

The read surface stays stable. `useTheme` still returns `colorMode`, `isDark`, `lightTheme`, `darkTheme`, `themes`, `activeId`, `active`, and `activeOnPrimary`, and `lightTheme` / `darkTheme` stay writable `useState` refs. `header.vue` keeps setting `current.value = option.id`, and gains one `savePreferences` call next to it.

What changes:

- **Initial read.** The `useState` initializers read the session, with the coded default as the only fallback. Bring in `const { user } = useUserSession()` and initialize `lightTheme` with `() => user.value?.lightTheme ?? DEFAULT_THEME`, same for dark. During SSR the session is present, so an authenticated user gets the correct atmosphere in the rendered HTML with no client fetch, and SSR writes those ids onto the html element as the `data-*` attributes the pre-paint script reads. A signed-out visitor has no picker and falls through to the default. `useTheme` performs no cookie reads or writes.
- **On a pick.** `header.vue` sets `current.value = option.id` and calls `usePreferences().savePreferences(isDark ? { darkTheme: option.id } : { lightTheme: option.id })` in the same handler. The write lives at the call site rather than in a `useTheme` watcher, which keeps `useTheme` free of an HTTP dependency and means there is no watcher that could fire on the initial session read and loop. The session refresh after a successful PATCH updates the `user` ref, not the theme `useState` refs, so it also cannot loop back.

New composable `usePreferences()` owns the write side so both theme and locale share one path. It exposes `savePreferences(patch: Partial<{ lightTheme: ThemeId; darkTheme: ThemeId; locale: Locale }>)`, which no-ops when there is no session (a signed-out visitor never reaches it since there is no pre-auth picker), otherwise `PATCH`es `/api/me/preferences`, refreshes the session with the session `fetch()` so the client cache matches the persisted values, and on failure shows the toast under decision 5. Keeping the write here means `useTheme` does not grow an HTTP dependency and the header locale toggle reuses the same function.

### 4. API contract

One route, `/api/me/preferences`, two methods, following the backend conventions. Route files stay thin, logic lives in `server/api/me/handlers/`, the Zod model lives in `server/models/preferences.ts`, and both methods run behind the session.

Zod model in `server/models/preferences.ts`:

```
PreferencesPatchSchema = z.object({
  lightTheme: z.enum(THEME_IDS).optional(),
  darkTheme: z.enum(THEME_IDS).optional(),
  locale: z.enum(LOCALES).optional()
}).refine(has at least one defined field)
```

All three fields optional is the partial-PATCH contract, the body carries only what changed. The `.refine` rejects an empty object so a client bug does not send a meaningless write. An unknown theme id or a locale outside `fr` / `en` fails the enum and returns 422 through the existing `sendZodError` helper, which the client already knows how to read.

`GET /api/me/preferences`

- Request: none.
- Handler: `defineAuthenticatedEventHandler`, reads the current user's `settings` via `loadUserPreferences`.
- Response `200`: `{ lightTheme: string, darkTheme: string, locale: 'fr' | 'en' }`.
- The client's primary read path is the session, so GET is not on the hot path. It exists per the spec for verification and future use.

`PATCH /api/me/preferences`

- Route: `requireUserSession`, then `readValidatedBody(event, PreferencesPatchSchema.safeParse)`, then `sendZodError` on failure, then call the handler, mirroring `server/api/onboarding/complete.post.ts`.
- Handler: resolve `userId` from the session, update the user's `settings` row with the provided fields only. If the row is missing (the edge the backfill and onboarding creation are meant to prevent), insert it with defaults plus the provided fields rather than failing. Then refresh the session with `setUserSession` merging the new values onto the existing `user` so the next SSR render is not stale, call `applyPreferenceCookies` to refresh the `i18n_redirected` locale cookie, and return the full updated set. The client re-reads the refreshed session with the session `fetch()`.
- Response `200`: `{ lightTheme, darkTheme, locale }` (the full current state, not just the patched fields, so the client can reconcile).
- Writes are always scoped to the session user, never a user id from the body. A user cannot write another user's preferences.

### 5. The two deferred design decisions

**(a) Write-failure behaviour.** On a failed PATCH the in-memory pick stays applied, the value is not reverted, and a non-blocking toast tells the user the choice did not persist. Reverting would fight the product non-negotiable of not policing the user, and a silent failure would hide a real problem, so a toast plus keep-the-pick is the middle path the spec's edge case already leans toward. Use `useToast()` with `color: 'warning'`. This adds one user-facing string, so it needs a researched FR/EN key under a new `preferences` namespace, French first, and the frontend stage confirms the final wording before it ships. Proposed copy, chosen to avoid the space-before-punctuation cases entirely:

- `preferences.saveError` FR: "Votre préférence n'a pas pu être enregistrée. Elle s'appliquera pour cette session seulement."
- `preferences.saveError` EN: "Your preference could not be saved. It will apply for this session only."

If the confirmed wording introduces `? ! : ;`, the French copy takes the space before it.

**(b) `system` color-mode inline script, end to end.** A `system`-mode user's dark-versus-light choice is only knowable on the client, which is why SSR alone cannot render their atmosphere. The flow is: SSR resolves the theme ids from the session and the `app/app.vue` `useHead` block writes them onto `<html>` as `data-light-theme` and `data-dark-theme` alongside `data-theme`. On load the `noFlashTheme` script runs before paint, reads `nuxt-color-mode`, resolves dark via `matchMedia`, reads the matching `data-*` attribute, and sets `data-theme`, so a `system` user in OS dark mode lands on their persisted dark atmosphere with no flash. The ids ride in the session and are re-resolved on every render, so there is no cookie to go stale. This is the flash-free pattern the research review at `docs/research/theme-language-persistence.md` confirmed.

### 6. Locale on first paint

Locale rides in the session for authenticated users and is mirrored to the `i18n_redirected` cookie that `@nuxtjs/i18n` already consumes. Because the app uses localised route paths (`/connexion` vs `/signin`) under the default strategy, the cookie mirror is the mechanism that keeps the module, the URL, and the persisted choice in agreement without a fragile SSR `setLocale` call. On the first request to the root the module reads `i18n_redirected` (written from `settings.locale` at session creation) and resolves the persisted locale, so the first rendered copy is already in the right language.

The header toggle keeps working unchanged in behaviour. `setLocale(other)` still switches the UI immediately and updates `i18n_redirected` client-side as it does today. The addition is a `savePreferences({ locale: other })` call right after `setLocale`, so the choice reaches the database and follows the user to another device. This is the locale half of the two `savePreferences` calls `header.vue` gains, the other being the theme pick in section 3.

### Files touched (for the build stages)

- `shared/theme.ts` (new): `THEME_IDS`, `ThemeId`, `DEFAULT_THEME_ID`, `LOCALES`, `Locale`.
- `app/types/auth.d.ts`: add `lightTheme`, `darkTheme`, `locale` to `User`.
- `app/composables/useTheme.ts`: session-first initial read with the coded default as the only fallback, no cookie reads or writes, default sourced from `shared/theme.ts`.
- `app/composables/usePreferences.ts` (new): `savePreferences` with the session refresh and the failure toast.
- `app/components/app/header.vue`: a `savePreferences` call on the theme pick and a `savePreferences({ locale })` call after `setLocale`.
- `server/models/preferences.ts` (new): `PreferencesPatchSchema`.
- `server/utils/applyPreferenceCookies.ts` (writes only the `i18n_redirected` locale cookie) and `server/utils/loadUserPreferences.ts` (new).
- `server/api/me/preferences.get.ts`, `server/api/me/preferences.patch.ts`, and `server/api/me/handlers/` (new).
- `server/api/magic-link/handlers/verify.ts`, `server/api/auth/handlers/login.ts`, `server/api/onboarding/handlers/complete.ts`: load preferences, attach to session, write the locale cookie. `server/routes/auth/google.get.ts` is out of scope, see the note below.
- `server/db/schema.ts` and a Drizzle migration: the three `settings` columns, the backfill, and dropping `users.locale`, per the spec's schema section.
- `i18n/locales/fr.json` and `i18n/locales/en.json`: the `preferences.saveError` key.

### Note for the backend stage: Google OAuth site

`server/routes/auth/google.get.ts` currently sets a session with `{ email, name, picture }`, which does not match the `User` type (no `id`, `firstName`, `lastName`, `onboarded`) and looks incomplete or unwired. Adding the preference fields there is only meaningful once that handler resolves or creates a real `users` row like the other sites do. Flag this to the owner: either the handler is brought in line with the others (resolve a user row, then `loadUserPreferences` and `applyPreferenceCookies`), or it is confirmed dead and left alone. Do not silently paper over the mismatch.

Backend stage note: Google auth was ruled out of scope and left untouched as dead scaffolding (no OAuth client config in `nuxt.config.ts`, no UI entry point, and its session shape already predates the `User` type), so if that handler is ever completed it must also call `loadUserPreferences` and `applyPreferenceCookies` and populate `lightTheme`, `darkTheme`, and `locale` on the session like the three live session-creation sites now do.
