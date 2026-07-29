# Expanded multi-step onboarding wizard

## Intent

Today onboarding collects only a first name, last name, and password on a single card (`app/pages/onboarding.vue`), posting once to `/api/onboarding/complete`. That is enough to pass the auth gate but leaves every work parameter at its schema default, so a brand-new user's first dashboard shows generic numbers rather than their real quota, work hours, and days. This feature grows onboarding into a guided multi-step first-run wizard that captures the user's identity, appearance preferences, and core work settings in one guided flow, and persists them atomically on a single submit so the dashboard reflects the user's real work parameters from the very first paint.

The wizard is built to be open and extensible. Steps are declared as data in a single array, not as duplicated hardcoded markup, so adding a future step or field is a one-entry change rather than a rewrite. This extensibility is an explicit, testable requirement, not a nice-to-have.

The owner's intent, verbatim: "Complete the user onboarding." The user is a professional translator paid against a words-per-hour quota, so the work settings captured here (daily work minutes, work days, base quota, timezone) are the same numbers the dashboard surfaces at review time. See `AGENTS.md` (product non-negotiables), `docs/spec.md`, `docs/specs/settings/preference-persistence.md` (the settings row and session plumbing this builds on), and `docs/specs/appearance/theme-system.md` (the five themes and swatch model).

## Scope

In scope:

- Rewrite `app/pages/onboarding.vue` as a three-step wizard driven by a declarative steps array, with a progress indicator and back/next navigation, preserving the existing auth-layout card visual style (`page-radial`, `UCard`, `btn-glow`, `AppLogo`).
- Add a `timezone` column to the `settings` table and generate the `0002` Drizzle migration for it.
- Extend the onboarding completion contract so a single submit persists identity and all appearance and work settings atomically.
- Extend `CompleteOnboardingSchema` (`server/models/onboarding.ts`) with the new fields and their validation, reusing the shared theme and locale contracts in `#shared/theme`.
- Add the new i18n keys (FR default, EN) for the new steps, fields, and labels, reusing existing `onboarding.*` keys where they already exist.

Out of scope (explicitly, do not build):

- A settings page or any post-onboarding editor for these values. This feature captures them at first run only.
- Carrying the new work settings (`daily_work_minutes`, `work_days`, `quota_wph`, `timezone`) on the `nuxt-auth-utils` session payload. The session keeps carrying only the existing `lightTheme` / `darkTheme` / `locale` / `role` preference fields it carries today. The dashboard reads the work settings from the `settings` row through its own read path when it is built. Adding them to the session is a separate concern (see Documented assumptions).
- Applying the migration against production. The migration is authored and committed but applied manually by the owner, matching `0000` and `0001` (see Schema and migration).
- The Google OAuth handler. It remains dead scaffolding, untouched, exactly as the two prior specs left it.

## Wizard structure (settled)

The wizard is a single page rendering one step at a time, with a progress indicator and back/next controls. All step state (identity fields, appearance picks, work settings) is held in page-level reactive state across the whole flow, and a single `$fetch('/api/onboarding/complete', { method: 'POST' })` fires on the final Finish action. There is one network write, not one per step.

### Declarative steps (extensibility contract)

Steps are declared as entries in one ordered array (for example `const steps = [...]`), each entry naming the step's title/subtitle i18n keys and the fields or component it renders. The step chrome (progress indicator, the current-step heading, the Back/Next/Finish buttons, the step-count logic) reads from that array and renders the active entry. No step's markup is duplicated per step. Adding a fourth step later is adding one entry to the array plus its fields to the wizard state and the schema, with no change to the navigation, progress, or submit machinery. This is acceptance criterion **AC1** and the unit-test stage asserts against it.

### Step 1 — Identity (mandatory, the auth gate)

Exactly the fields onboarding collects today: first name, last name, password, and confirm password. This step is what sets `users.password_hash` and marks onboarding complete. It preserves the current behaviour exactly:

- Client-side password-mismatch check before submit (`onboarding.passwordMismatch`), since the password is never echoed back.
- Server-side NIST password policy (8-character floor, generous max, no composition rules) and the Have I Been Pwned breach check in the handler.
- The stable `password_breached` status code the client maps to `onboarding.passwordBreached`, and the generic `onboarding.error` fallback.

These fields are the only mandatory ones. Next is disabled (or surfaces the mismatch error) until first name, last name, password, and a matching confirmation are present, mirroring the `required` inputs today.

### Step 2 — Appearance (defaulted, never blocking)

- A **light theme** selector and a **dark theme** selector, each rendered as swatches, reusing the existing theme swatch presentation and the `useTheme` `themeOptions` data (the five themes `pastel`, `encre`, `cafe`, `automne`, `foret`, each with a light and a dark palette). Each maps to `settings.light_theme` and `settings.dark_theme` respectively. Selecting nothing keeps the schema default (`pastel` for both).
- A **language** selector (FR / EN) mapping to `settings.locale`. Default `fr`.

The selectors are pre-populated with the current in-session preference values (or the schema defaults), so advancing without touching them persists the defaults. Next/Finish is never blocked by this step.

### Step 3 — Work settings (defaulted, never blocking)

- **Work hours per day** → `settings.daily_work_minutes`, stored as minutes, presented to the user as hours and minutes. Default 7h30 = 450 minutes.
- **Days of week worked** → `settings.work_days`, a JSON array of day numbers 0–6 stored as text. Default `[1,2,3,4,5]` (Monday–Friday).
- **Base quota, words per hour** → `settings.quota_wph`. Default 450.
- **Timezone** → `settings.timezone` (new column). Default `America/Toronto`.

Every field is pre-filled with its default, so the user can Finish immediately from this step with defaults intact. Finish is the single submit. This step never blocks the user (product non-negotiable: the app records reality, it does not police the schedule).

### Navigation and progress

- A progress indicator shows the three steps and the current position (Nuxt UI first: use a `UStepper` or equivalent Nuxt UI progress affordance if one fits; otherwise a minimal Tailwind indicator, per component priority). It updates as the user moves.
- Back returns to the previous step without losing entered state. Next advances. On the last step the primary action is Finish, carrying the existing `btn-glow` submit-button style.
- Back is absent or disabled on step 1. Finish replaces Next on the last step.

## Inputs

- **Read on load (authenticated, onboarding user):** the current in-session preference values (`lightTheme`, `darkTheme`, `locale`) to pre-populate step 2, falling back to the schema defaults. No work-setting values are read (a pre-onboarding user has none yet); step 3 shows the schema defaults.
- **User actions:** fill the step-1 identity fields; optionally pick light/dark themes and a language in step 2; optionally adjust work hours, work days, quota, and timezone in step 3; navigate Back/Next; click Finish.
- **Single submit body** posted to `POST /api/onboarding/complete` on Finish. All fields in one body:
  - `firstName: string`, `lastName: string`, `password: string` (unchanged from today).
  - `lightTheme: ThemeId`, `darkTheme: ThemeId`, `locale: Locale`.
  - `dailyWorkMinutes: number` (minutes), `workDays: number[]` (0–6), `quotaWph: number`, `timezone: string` (IANA).
  - The confirm-password value is checked client-side only and is not sent.

## Outputs and acceptance criteria

Each criterion is written so the unit-test stage can author a test from the spec alone.

### Wizard behaviour

- **AC1 — Declarative steps.** The wizard renders three steps from a single ordered steps array with a progress indicator and Back/Next/Finish. Adding a step is a one-array-entry change: there is no per-step duplicated navigation, progress, or submit markup. The unit-test or review stage verifies there is one steps array and one set of navigation controls, not three copies.
- **AC2 — Step 1 preserves current auth behaviour.** The identity step behaves exactly as today: client-side mismatch check surfaces `onboarding.passwordMismatch`; on submit the server runs the breach check; the client maps `password_breached` to `onboarding.passwordBreached` and any other failure to `onboarding.error`. All three error paths still resolve. Name and password remain the only required inputs.
- **AC3 — Single atomic submit.** One `POST /api/onboarding/complete` fires on Finish (not one request per step). On success the client refreshes the session (`useUserSession().fetch()`) and navigates to the localized `index` route, exactly as today.
- **AC4 — Never blocking on preferences.** Steps 2 and 3 are pre-filled with schema defaults and never block Next or Finish. A user who touches nothing on steps 2 and 3 completes onboarding with the documented defaults persisted.
- **AC5 — Password-breach return path.** When the server returns `password_breached` on the final submit, the wizard surfaces `onboarding.passwordBreached` and returns the user to step 1 to change the password, rather than stranding the error on step 3 with no editable password field.

### Schema and migration

- **AC6 — timezone column.** `settings` gains `timezone` as `text('timezone').notNull().default('America/Toronto')` in `server/db/schema.ts`. No other column is added, dropped, or retyped.
- **AC7 — 0002 migration.** The next Drizzle migration file (`0002_*`) is generated with `drizzle-kit generate` (the schema change is a plain column add that drizzle-kit expresses cleanly, unlike the hand-written `0000`/`0001` data migrations), placed in `server/db/migrations/`. It adds the `timezone` column with the `America/Toronto` default so existing rows take it.
- **AC8 — Manual production application.** The migration is applied against the production Turso database **manually by the owner**, matching `0000` and `0001`. There are no database credentials in the sandbox, and no CI job, deploy hook, or dev-boot runner points this migration at production. This is stated in the migration's context and here.

### Backend (validation and persistence)

- **AC9 — Extended schema, shared contracts.** `CompleteOnboardingSchema` in `server/models/onboarding.ts` gains the new fields with validation, reusing `THEME_IDS` and `LOCALES` from `#shared/theme` (no duplicated id lists), matching how `server/models/preferences.ts` already validates theme and locale:
  - `lightTheme` / `darkTheme`: one of `THEME_IDS`.
  - `locale`: one of `LOCALES`.
  - `dailyWorkMinutes`: a positive integer within sane bounds (`z.number().int().min(1).max(1440)`, one day of minutes).
  - `quotaWph`: a positive integer within sane bounds (`z.number().int().min(1).max(10000)`).
  - `workDays`: an array of integers each `0`–`6`, deduplicated or rejected on duplicates, length `0`–`7`.
  - `timezone`: a valid IANA timezone string, validated against the runtime's IANA list (`Intl.supportedValuesOf('timeZone')`) when available, with a conservative `Area/Location` regex as the fallback. The existing `firstName` / `lastName` / `password` rules are unchanged.
  - Invalid input returns 422 through the existing `sendZodError` helper. The route stays a thin `readValidatedBody(event, CompleteOnboardingSchema.safeParse)` + handler + `sendZodError`, unchanged in shape.
- **AC10 — Atomic identity + settings persistence, upsert-correct.** The completion handler persists in one logical operation: it sets `users.first_name`, `users.last_name`, `users.password_hash`, and `users.updated_at` (marking onboarding complete), and it writes the full appearance and work settings onto the user's `settings` row. It **upserts**: if the user already has a `settings` row (for example one created by the migration backfill), it updates that row; if none exists (the common case for a magic-link user who reaches onboarding without a row yet), it inserts one. `work_days` is serialized to its JSON text form before storage. The persisted `settings` row reflects the submitted `lightTheme`, `darkTheme`, `locale`, `dailyWorkMinutes`, `workDays`, `quotaWph`, and `timezone`, not the schema defaults, whenever the user provided values.
- **AC11 — Breach check preserved.** The handler still calls `isPasswordBreached(body.password)` before hashing and still throws `createError({ statusCode: 422, statusMessage: 'password_breached' })` on a hit. The password is hashed with `hashPassword` and the raw value is never stored.
- **AC12 — Session and cookies refresh unchanged in kind.** After persistence the handler reads back through `loadUserPreferences(user.id)` and refreshes the session (`setUserSession`) with the same fields it carries today (`id`, `email`, `firstName`, `lastName`, `onboarded: true`, `role`, `lightTheme`, `darkTheme`, `locale`), and calls `applyPreferenceCookies` so `i18n_redirected` reflects the chosen locale. The work settings are persisted to the row but are not added to the session payload in this feature.

### Copy and i18n

- **AC13 — Every visible string is an i18n key, FR default + EN.** No hardcoded copy. Existing `onboarding.*` keys are reused where they already fit (title, subtitle, firstName, lastName, password, passwordConfirm, passwordHint, passwordMismatch, passwordBreached, submit, error). New keys are added for the new steps, the step titles/subtitles, the appearance labels (light theme, dark theme, language), the work-settings labels (work hours per day, work days, base quota words per hour, timezone), any hour/minute units, the day-of-week names, and the Back/Next/Finish navigation labels.
- **AC14 — Copy quality.** French is Québécois, researched and correct (the user is a translator), French first. French uses a space before `? ! : ;`. No LLM-guessed strings ship; proposed strings are owner-verified before the feature is considered done. Day-of-week and timezone-facing labels in particular are verified.

### Conventions

- **AC15 — Component priority and icons.** Nuxt UI first, then Nuxt, then Tailwind, no custom CSS unless unavoidable. Icons are Phosphor `i-ph-*`. Separation of concerns holds: client in `app/`, server in `server/`, shared contracts in `shared/`.
- **AC16 — Visual match.** The wizard keeps the existing onboarding card look: `auth` layout, `page-radial` background, `UCard`, `AppLogo`, and the `btn-glow` primary action.
- **AC17 — Product non-negotiable.** The wizard may default and hint but never blocks on preferences. Only name and password gate progress. Work settings fall back to schema defaults when left untouched.
- **AC18 — Comments.** Comments in changed files are full sentences ending in a period, no dash or colon joining clauses.

### Green build

- **AC19.** Typecheck, lint, and the unit-test suite pass with the change in place.

## Settings row lifecycle (confirmed, do not re-derive)

Confirmed against the code so the handler upserts correctly either way:

- The magic-link `verify` handler can create a `users` row before onboarding, but it does **not** create a `settings` row. `loadUserPreferences` documents and tolerates the window where a magic-link user has no `settings` row yet, returning the coded defaults. So at onboarding time the common case is **no settings row exists**, and the handler inserts one.
- The `0000` migration backfilled a `settings` row for every user that existed when it was applied. A user who existed before that backfill will already have a row, so the handler must **update** rather than insert to avoid creating a second row (the `settings.user_id` has no unique constraint to conflict on, so a blind insert would duplicate).
- Therefore the handler explicitly checks for an existing row (as `complete.ts` already does for the insert-if-missing case today) and updates it when present, inserts it when absent. This replaces today's insert-only-if-missing logic, which set only the three preference columns from the session, with a full upsert that writes every submitted appearance and work field.

## Edge cases

- **User completes with all defaults.** Untouched steps 2 and 3 submit the schema-default values (`pastel`/`pastel`/`fr`, 450 minutes, `[1,2,3,4,5]`, 450 wph, `America/Toronto`). The row is written with those values and onboarding completes. No blocking.
- **Password mismatch.** Caught client-side on step 1 before any submit, surfacing `onboarding.passwordMismatch`. Next does not advance and Finish does not fire while the confirmation does not match.
- **Breached password.** Surfaces only at the final server submit. The wizard shows `onboarding.passwordBreached` and returns the user to step 1 so the password field is editable again (AC5).
- **Existing settings row (backfilled user).** The handler updates the existing row rather than inserting a duplicate (see Settings row lifecycle).
- **Invalid or spoofed field values** (a client bug or a crafted request: an unknown theme id, a locale outside `fr`/`en`, a day number outside 0–6, a negative or absurd `dailyWorkMinutes` or `quotaWph`, a non-IANA timezone string). The Zod schema rejects them with a 422 through `sendZodError`; nothing partial is written. The client's happy path never produces these because the controls constrain their values.
- **Duplicate day numbers in `work_days`** (for example `[1,1,2]`). The schema deduplicates or rejects; the stored JSON array holds each day at most once.
- **Timezone the runtime cannot enumerate.** If `Intl.supportedValuesOf('timeZone')` is unavailable in the deploy runtime, validation falls back to the `Area/Location` regex so a legitimate zone is not rejected. The default `America/Toronto` always validates.
- **Network or DB failure on the single submit.** No user or settings mutation lands (the write path is a single handler invocation), the wizard stays on its current step, and the user sees `onboarding.error`. Retry re-submits the whole body.
- **Work-days empty array.** Allowed. A user who works no fixed days can store `[]`; the app records reality and does not force a schedule. The dashboard treats an empty set as "no scheduled work days" when it is built.

## Documented assumptions

These resolve every ambiguity the brief left open so the build runs hands-off without stopping to ask.

1. **Model path.** The onboarding Zod model lives at `server/models/onboarding.ts` and the route at `server/api/onboarding/complete.post.ts` with the handler at `server/api/onboarding/handlers/complete.ts`. The brief's reference to `server/api/models/onboarding.ts` is corrected to the actual location; the thin-route + `handlers/` + `server/models/` convention is unchanged.
2. **Work settings are not on the session.** The dashboard reads `daily_work_minutes`, `work_days`, `quota_wph`, and `timezone` from the `settings` row through its own read path (built with the dashboard feature). Putting them on the encrypted session payload is deferred to that feature so this one changes the fewest session-creation sites. The session keeps carrying only `lightTheme` / `darkTheme` / `locale` / `role` as it does today.
3. **`daily_work_minutes` stays nullable in the schema but is always written here.** The column is currently `integer('daily_work_minutes').default(450)` without `notNull`. This feature does not change that column's nullability (out of scope, and no migration churn), but the onboarding upsert always writes a concrete minutes value, so a row created through onboarding is never null on it.
4. **`work_days` storage stays JSON-in-text.** The column is `text('work_days')` holding a JSON array string. The schema validates a real `number[]`; the handler `JSON.stringify`s it before storage and the read path parses it. No column type change.
5. **Timezone validation source.** `Intl.supportedValuesOf('timeZone')` is the primary allowlist because it is the runtime's own IANA list and cannot drift from what the platform accepts. The regex fallback exists only for a runtime that lacks that API. No third-party timezone dependency is added.
6. **Migration generation.** `drizzle-kit generate` produces `0002` for the plain `timezone` column add, matching `drizzle.config.ts` (`out: './server/db/migrations'`, `dialect: 'turso'`). The `0000`/`0001` files were hand-written because they carried data backfills and a drop; this schema-only add does not need hand-authoring. The generated file still gets the manual-application note per AC8.
7. **Timezone picker UI.** Step 3's timezone control is a select/combobox seeded from `Intl.supportedValuesOf('timeZone')` (Nuxt UI `USelectMenu` or equivalent), defaulting to `America/Toronto`. The exact component is a design-stage call within the Nuxt-UI-first priority; the contract only requires a constrained picker that yields a valid IANA string.
8. **Progress affordance.** The design stage picks the progress indicator (Nuxt UI `UStepper` if it fits the card, otherwise a minimal Tailwind step indicator). The contract requires a visible current-position indicator across three steps, not a specific component.

## Open questions

None blocking. The assumptions above resolve the brief's ambiguities for a hands-off build. Two items need owner confirmation before the feature is *done* but do not block the build: the researched Québécois FR wording for the new labels (day names, "work hours per day", "base quota, words per hour", "timezone", Back/Next/Finish), and confirmation that shipping the work settings without also surfacing them on the session (assumption 2) is acceptable until the dashboard feature lands.

## Notes for later stages

- **Files touched (build stages):**
  - `app/pages/onboarding.vue`: rewrite as the declarative three-step wizard with progress + Back/Next/Finish, holding all step state and firing one submit on Finish. Keep the `auth` layout, `page-radial`, `UCard`, `AppLogo`, `btn-glow`.
  - `server/db/schema.ts`: add `timezone: text('timezone').notNull().default('America/Toronto')` to `settings`.
  - `server/db/migrations/0002_*.sql`: generated via `drizzle-kit generate`; add the manual-application note.
  - `server/models/onboarding.ts`: extend `CompleteOnboardingSchema` with the appearance and work fields, importing `THEME_IDS` / `LOCALES` from `#shared/theme`.
  - `server/api/onboarding/handlers/complete.ts`: upsert the full `settings` row (update if present, insert if absent) with all submitted fields, serialize `work_days`, keep the breach check, session refresh, and `applyPreferenceCookies` call.
  - `server/api/onboarding/complete.post.ts`: unchanged in shape (thin route, `safeParse`, `sendZodError`).
  - `i18n/locales/fr.json` and `i18n/locales/en.json`: reuse the existing `onboarding.*` keys and add the new step, field, day-name, unit, and navigation keys.
- **Reused, not duplicated:** `useTheme` `themeOptions` and the header swatch presentation for step 2; `#shared/theme` (`THEME_IDS`, `LOCALES`, `coerceThemeId`, `coerceLocale`) for validation and read-back; `loadUserPreferences` / `applyPreferenceCookies` for the post-submit session and cookie refresh.
- **Build-trail:** this feature gets an entry in the "How this project was built" section of `docs/pipeline.md` and a row in `docs/pipeline-trace.md` when it lands, per `AGENTS.md`.
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.
