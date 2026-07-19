# Settings page

## Intent

The signed-in user needs an authenticated page for **configuration**: the per-user numbers the dashboard surfaces at review time, and the account password. This is the sibling of the Profile page (`docs/specs/settings/profile-page.md`); the split is the locked information architecture and is not re-litigated here. The Profile page holds identity (avatar, name, email); this Settings page holds two clearly separated sections on **one** page, following the Nuxt UI dashboard-settings pattern:

- **Work** — daily work target, work days, words-per-hour quota, and timezone. These are captured once during onboarding and, until now, cannot be edited afterwards, even though they are the exact numbers the employer uses at review time.
- **Security** — changing the account password, authorized by the current password, under the same NIST-aligned policy and Have I Been Pwned breach check the onboarding wizard already enforces.

This is the destination the header popover's Settings item link-aheads to (`docs/specs/settings/profile-menu-popover.md`). It reuses the established `/api/me/*` server-route conventions, the shared password and work-field validators, the `loadUserPreferences` single-read-path pattern, and the onboarding work-step UI idiom.

Appearance and language preferences (theme and locale) are deliberately out of scope on both pages. They already persist through `server/api/me/handlers/savePreferences.ts` and the header controls (`docs/specs/settings/preference-persistence.md`); duplicating them here would create a second write path for the same data.

See `server/models/onboarding.ts` (the password policy and work-field validators this reuses), `server/api/onboarding/handlers/complete.ts` (`hashPassword` and the atomic write), `server/api/auth/handlers/login.ts` (`verifyPassword`), `server/api/me/preferences.patch.ts` and `handlers/savePreferences.ts` (the route and insert-if-missing pattern this mirrors), `server/utils/loadUserPreferences.ts` (the read-path pattern the work-settings loader copies), `server/db/schema.ts` (the `settings` table columns), and `app/components/onboarding/step-work.vue` (the work-field UI this reuses).

## Scope

In scope:

- A new authenticated page at route name `settings`, file `app/pages/settings.vue`, localized to `/parametres` (FR) and `/settings` (EN) by the existing `nuxt.config.ts` i18n `settings` entry, which becomes resolvable once this file exists. Marked `noindex, nofollow`.
- A **Work** section: daily work target (shown as hours + minutes, stored as minutes in `daily_work_minutes`), work days, words-per-hour quota (`quota_wph`), and timezone, read from `GET /api/me/work-settings` and written to `PATCH /api/me/work-settings`.
- A **Security** section: current password, new password, confirm new password, submitting to `PATCH /api/me/password`.
- The two sections visually separated on one page (a section header and card per group), following the Nuxt UI dashboard-settings pattern.
- Extracting the password field and the work-field validators from `server/models/onboarding.ts` into shared Zod pieces (`server/models/password.ts`, `server/models/work-settings.ts`) so the policy and the ranges live in one place and cannot drift between onboarding and this page.
- A `server/utils/loadWorkSettings.ts` read path mirroring `loadUserPreferences.ts`.
- A new `settings` i18n namespace (FR default, EN present) with `settings.work.*` and `settings.security.*` groups, reusing existing `onboarding.work.*` day and unit keys where they already fit.

Out of scope (do not build):

- **Identity (avatar, name, email).** They live on the Profile page (`docs/specs/settings/profile-page.md`). This page adds no identity controls.
- **Appearance and language preferences.** They persist via the existing preferences flow and header controls. This page adds no theme or locale control, and adds no second write path for them.
- **Cross-device session invalidation** on password change (a password-version column checked in `validate-session.ts`). See the session decision below.
- Any change to the onboarding flow's observable behaviour. The validator extraction must be behaviour-preserving.

## Spec-versus-code reconciliation

- **The words-per-hour column is `quota_wph`, not `default_wph`.** `server/db/schema.ts` defines `quotaWph: integer('quota_wph').notNull().default(450)`, and the onboarding form and schema use `quotaWph`. This spec uses the real column, `quota_wph` / `quotaWph`, throughout. There is no `default_wph` column and none is added.

## Route and gating

- Page file `app/pages/settings.vue`, route name `settings`. Because it is a flat page, its i18n page-map key is `settings`, matching the existing `nuxt.config.ts` entry (`fr: '/parametres'`, `en: '/settings'`). Creating the file makes `useLocalePath('settings')` resolve to the localized path. The header currently link-aheads via the `navPath('settings', locale)` shim in `app/utils/account.ts`; once this page lands the header can move to `useLocalePath('settings')`. Either way the Settings item now lands on a real page instead of a 404. No `nuxt.config.ts` change is needed.
- The page relies on the existing global auth middleware to force sign-in and onboarding. Any authenticated, onboarded user reaches their own settings. No admin gate, no new client middleware.
- The page sets `noindex, nofollow`. The whole app is auth-gated; this states the intent for the SEO stage.
- Every API route below is defined through the existing `defineAuthenticatedEventHandler` wrapper, so an unauthenticated request is rejected with 401 before the handler runs. Every write is scoped to the session `user.id`, never an id from the request body, so a user can only ever read or change their own settings.

## Inputs

- **Work settings** (read on load). `GET /api/me/work-settings` returns the current user's `dailyWorkMinutes`, `workDays`, `quotaWph`, and `timezone` from the `settings` row, or the column defaults when no row exists.
- **Work-settings form** (user-initiated): daily target as hours + minutes (combined client-side into total minutes), the set of work days, the words-per-hour quota, and the timezone.
- **Change-password form** (user-initiated): `currentPassword`, `newPassword`, `confirmNewPassword`.

## Data contract

### Shared validator extraction (do first)

To reuse the exact onboarding policy without redefining it, extract these pieces so both onboarding and this feature import one source. The extraction is behaviour-preserving for onboarding.

- **Password.** Extract the password field currently inline in `CompleteOnboardingSchema` (`z.string().min(8, 'Password must be at least 8 characters.').max(200, 'Password is too long.')`) into a shared `PasswordSchema` in `server/models/password.ts`. `CompleteOnboardingSchema.password` becomes `PasswordSchema`. The min (8), max (200), and messages are unchanged. No composition rules, per NIST SP 800-63B; strength comes from length plus the breach check.
- **Work fields.** Extract `isValidTimezone` and the four work-field schemas (`dailyWorkMinutes`, `workDays`, `quotaWph`, `timezone`) from `server/models/onboarding.ts` into `server/models/work-settings.ts`, and have `CompleteOnboardingSchema` import them. The bounds are unchanged: `dailyWorkMinutes` int 1–1440, `quotaWph` int 1–10000, `workDays` an array of ints 0–6, max length 7, no duplicates, empty array allowed, `timezone` validated against the runtime's own IANA list via `isValidTimezone`.

### `GET /api/me/work-settings`

Thin route `server/api/me/work-settings.get.ts` delegating to `server/api/me/handlers/getWorkSettings.ts`, behind `defineAuthenticatedEventHandler`. No request body.

- Handler resolves `user.id` and returns `loadWorkSettings(user.id)`.
- `server/utils/loadWorkSettings.ts` mirrors `loadUserPreferences.ts`: it reads the four columns from the `settings` row and returns `{ dailyWorkMinutes: number, workDays: number[], quotaWph: number, timezone: string }`. When no row exists it returns the coded defaults matching the column defaults (`450`, `[1,2,3,4,5]`, `450`, `America/Toronto`). `work_days` is stored as JSON text, so the loader `JSON.parse`s it and coerces the result to a clean `number[]`: on a parse error or a non-array it falls back to `[1,2,3,4,5]`, and it drops any entry that is not an integer 0–6 and de-duplicates, so a corrupted or legacy value can never reach the client as a broken shape. This is the single read path reused by the GET handler and by the PATCH handler's read-back.
- Response `200`: `{ dailyWorkMinutes, workDays, quotaWph, timezone }`.

### `PATCH /api/me/work-settings`

Thin route `server/api/me/work-settings.patch.ts` delegating to `server/api/me/handlers/saveWorkSettings.ts`, behind `defineAuthenticatedEventHandler`. Body validated by `WorkSettingsPatchSchema` (new, in `server/models/work-settings.ts`) via `readValidatedBody` + `sendZodError`.

- `WorkSettingsPatchSchema` is a partial PATCH mirroring `PreferencesPatchSchema`: every field optional, reusing the extracted field validators, with a `.refine` rejecting an empty object.
  - `dailyWorkMinutes: <extracted>.optional()`
  - `workDays: <extracted>.optional()`
  - `quotaWph: <extracted>.optional()`
  - `timezone: <extracted>.optional()`
  - `.refine(at least one field defined, { message: 'At least one work setting must be provided.' })`
- Request body: any non-empty subset of the four fields. `workDays` when present is the full replacement array (no element-wise merge).
- Handler logic mirrors `savePreferences`: update only the provided fields on the user's `settings` row; if the row is missing, insert it with the provided fields and let the column defaults fill the rest rather than failing the write. `workDays`, when provided, is serialized to its JSON text form (`JSON.stringify`) because the column stores text. Then read back through `loadWorkSettings(user.id)` and return the full current set.
- Response `200`: `{ dailyWorkMinutes, workDays, quotaWph, timezone }` (the full current state, so the client can reconcile).
- Error responses: `422` with per-field `data` from `sendZodError` for any out-of-range or malformed field (minutes outside 1–1440, quota outside 1–10000, a weekday outside 0–6, a duplicate weekday, more than seven days, an invalid IANA timezone, or an empty body). No other error surface.

### `PATCH /api/me/password`

Thin route `server/api/me/password.patch.ts` (mirrors `preferences.patch.ts`) delegating to `server/api/me/handlers/changePassword.ts`, both behind `defineAuthenticatedEventHandler`. Body validated by `PasswordChangeSchema` in `server/models/password.ts` via `readValidatedBody(event, PasswordChangeSchema.safeParse)` + `sendZodError` on failure.

- `PasswordChangeSchema = z.object({ currentPassword: z.string().min(1), newPassword: PasswordSchema, confirmNewPassword: z.string().min(1) }).refine(newPassword === confirmNewPassword, { path: ['confirmNewPassword'], message: <mismatch> })`. Confirmation is validated server-side as well as client-side so the contract does not rely on the client.
- Request body: `{ currentPassword: string, newPassword: string, confirmNewPassword: string }`.
- Handler logic, in order:
  1. `requireUserSession` (enforced by the wrapper), resolve `user.id`.
  2. Load the user's `passwordHash` from the `users` row by id.
  3. If the row has no `passwordHash` (an edge; onboarded users always have one), fail with the same generic current-password error below. It fails closed and does not disclose the account's password state.
  4. `verifyPassword(passwordHash, body.currentPassword)`. On mismatch, throw `createError({ statusCode: 401, statusMessage: 'current_password_incorrect' })`. This is the one generic authorization failure; it never reveals anything beyond "the current password is wrong".
  5. Reject an unchanged password: if `newPassword === currentPassword` (a direct comparison is sufficient since the current password was just verified), throw `createError({ statusCode: 422, statusMessage: 'password_unchanged' })`. Reason under Decisions.
  6. Breach check: `if (await isPasswordBreached(body.newPassword))` throw `createError({ statusCode: 422, statusMessage: 'password_breached' })`, matching onboarding. `isPasswordBreached` fails open on a HIBP outage, so a breach-list outage never blocks a legitimate change.
  7. `hashPassword(body.newPassword)`, then a single `db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id))`. This is the only mutation and it is atomic.
  8. Refresh the current session with `setUserSession(event, { user })` carrying the existing user unchanged, so the current device stays cleanly signed in. See the session decision.
- Response `200`: `{ success: true }`. The response never echoes any password value.
- Error responses (all via `createError`, `statusMessage` a stable code the client maps to a localized message):
  - `422` with per-field `data` from `sendZodError` for a schema failure (new password too short or too long, empty current password, confirmation mismatch).
  - `401 current_password_incorrect` for a wrong (or unverifiable) current password.
  - `422 password_unchanged` when the new password equals the current one.
  - `422 password_breached` when the new password appears in a known breach.
- Secrets are never logged. The handler logs no request body, no password, and no hash. `statusMessage` codes carry no secret material.

## Outputs and acceptance criteria

### Page and layout

1. Navigating to `/parametres` (FR) or `/settings` (EN) as an authenticated, onboarded user renders the Settings page with two clearly separated sections, Work and Security, each under its own heading. The header Settings item lands here and no longer 404s.
2. The page is served with `noindex, nofollow`.
3. The two sections are independent: submitting the Work form does not touch the password, and submitting the Security form does not touch the work settings.

### Work settings

4. On load the Work section is pre-populated from `GET /api/me/work-settings`: the daily target split into hours and minutes, the work days selected, the quota, and the timezone. A user with no `settings` row sees the coded defaults (7 h 30 min, Mon–Fri, 450 wph, America/Toronto).
5. Saving a valid change persists only the changed fields to the `settings` row and the reloaded page reflects the persisted values. The daily target round-trips through minutes with no drift (for example 7 h 30 min stores 450 and reloads as 7 h 30 min).
6. `workDays` persists as JSON text and reloads as the same set. An empty selection is allowed and persists as `[]` (the app records reality and does not force a schedule).
7. Out-of-range or malformed input is rejected with `422` and a per-field message: minutes outside 1–1440, quota outside 1–10000, a weekday outside 0–6, a duplicate weekday, or an invalid timezone. Rejection is limited to genuinely invalid data; any valid configuration is accepted, including a zero-day week or an unusually high quota.
8. The timezone control offers the runtime's IANA zones and the persisted value is one the server's `isValidTimezone` accepts, so a saved timezone always survives a reload.

### Change password

9. Submitting the correct current password, a policy-valid new password that is not breached and differs from the current one, with a matching confirmation, updates `users.password_hash`, returns `{ success: true }`, and the user can immediately sign in with the new password and can no longer sign in with the old one.
10. A wrong current password returns `401 current_password_incorrect` and changes nothing. The message is generic and identical whether the current password is wrong or (edge) the account has no password hash. Nothing beyond "current password incorrect" is disclosed.
11. A new password shorter than 8 or longer than 200 characters returns `422` with a per-field message and changes nothing.
12. A confirmation that does not match the new password returns `422` on the `confirmNewPassword` field (server-side, independent of the client check) and changes nothing.
13. A new password that appears in the Have I Been Pwned corpus returns `422 password_breached` and changes nothing. If the HIBP lookup is unreachable, the change is allowed to proceed (fail open), matching onboarding.
14. A new password equal to the current password returns `422 password_unchanged` and changes nothing.
15. No password value or hash appears in any log or in any response body.
16. After a successful change the current session remains valid and the user is not signed out on the current device (see the session decision).

### Cross-cutting

17. **Reuse, not reinvention.** The password policy, breach check, `hashPassword` / `verifyPassword` usage, and the four work-field validators are the same ones onboarding uses, imported from the shared modules. No second copy of any bound, message, or policy exists after this feature. The onboarding flow still accepts and rejects exactly what it did before.
18. **Nuxt UI first.** The forms use `UForm`, `UFormField`, `UInput`, `UInputNumber`, and `USelectMenu`, following `my-frontend-conventions`. The Work section reuses the onboarding work-step idiom (hours/minutes `UInputNumber` pair, the Monday-first day toggle group, the quota input with a `mots/heure` hint, the timezone `USelectMenu`) from `app/components/onboarding/step-work.vue`. Icons are Phosphor `i-ph-*`.
19. **i18n.** Every visible label is an i18n key under a new `settings` namespace (`settings.work.*`, `settings.security.*`), FR default and EN present, no hardcoded strings. French copy takes a space before `? ! : ;`. Existing `onboarding.work.*` day and unit keys are reused where they already fit. All new strings are proposals pending owner verification (the user is a professional translator); no LLM-guessed translator-domain term ships.
20. **Separation of concerns.** Client code in `app/`, server routes and handlers in `server/`, the shared Zod contracts in `server/models/`. Route files stay thin; logic lives in `handlers/`.
21. **Product non-negotiable.** The page signals but never blocks. Validation rejects only genuinely invalid input and never enforces a schedule or a "correct" quota.

## Edge cases and failure branches

### Change password (single atomic step, so no half-done state)

- **Interrupted or abandoned mid-form.** Filling the form and navigating away writes nothing; the account is untouched and the old password still works. There is no token, no multi-request handshake, and no server-side draft, so there is no partial state to recover from. Re-opening the page starts clean.
- **Network failure or server error before the update commits.** The single `db.update` either commits or does not. On any failure before commit, the old password remains the only valid one; the user sees an error and can retry. No intermediate state exists in which neither password works.
- **Ambiguous failure after submit (response lost, write may or may not have committed).** Recovery is safe and self-evident: if the write committed, the new password works and the old one is now rejected as `current_password_incorrect`; if it did not, the old password still works. The user resolves the ambiguity by trying again (the new password, if already set, is rejected as `password_unchanged`, a legible signal that the earlier change succeeded). Either branch ends at a fully valid, usable account, never a locked-out one.
- **Session expires before submit.** `requireUserSession` returns `401`, and the session-validation middleware redirects a page navigation to the locale-appropriate sign-in route. Nothing is written. After re-authenticating, the user reaches settings again and retries.
- **Account deactivated mid-session** (another tab or an admin). The session-validation middleware clears the session and redirects on the next navigation, and the authenticated wrapper `401`s the API call. The password change cannot proceed on a deactivated account, the correct fail-closed outcome.
- **Account has no `passwordHash`** (a defensive edge; onboarded users always have one). The current-password verification fails closed with the generic `current_password_incorrect`. This flow is a change, not an initial set, so it does not create a first password.

### Work settings

- **No `settings` row yet.** The GET returns coded defaults and a PATCH inserts the row with the provided fields plus defaults, so the user can save from a clean slate. This matches `savePreferences` insert-if-missing behaviour.
- **Corrupted or legacy `work_days` text.** `loadWorkSettings` parses defensively: a non-JSON or non-array value falls back to `[1,2,3,4,5]`, and any out-of-range or duplicate entry is dropped, so the client never receives a broken shape.
- **Empty work-days selection.** Allowed and persisted as `[]`. The app does not force at least one work day.
- **Partial save.** Sending only one field updates only that column; the others are untouched. An empty body is rejected by the schema `.refine` as `422`, so a client bug cannot send a meaningless write.
- **Timezone the runtime cannot enumerate.** The client select falls back to showing the current value (as the onboarding step does), and the server validates against its own IANA list, so a saved value is always one the server accepts.

### Cross-section

- **One section saving does not affect the other.** The Work write touches only the `settings` row; the password write touches only `users.password_hash`. A failure in one leaves the other untouched, and neither can leave the account in an invalid state.

## Security and compliance notes

- **Authorization.** The current password authorizes the change, verified with `nuxt-auth-utils` `verifyPassword` against the stored hash, the same primitive `login.ts` uses. The new hash is produced with `hashPassword`, the same primitive onboarding uses. Neither is reimplemented.
- **No enumeration, generic failure.** The user is already authenticated, so account existence is not in question, but the current-password check still returns one generic `current_password_incorrect` for both a wrong password and the no-hash edge, disclosing nothing about the account's internal state.
- **Fail closed.** Any missing session, missing hash, or verification failure rejects the change and leaves the password unchanged. Recovery always routes back to a clean, usable state; a failed change never produces a locked-out account.
- **No secret logging.** The handler logs no password and no hash, and `statusMessage` codes carry no secret material.
- **Breach check.** The new password is checked against Have I Been Pwned via the existing k-anonymity `isPasswordBreached` (only a five-character SHA-1 prefix leaves the server; it fails open on outage), reused as-is.
- **No new rate limiting.** The current-password check runs against the authenticated user's own hash, so it is not an enumeration or credential-stuffing surface, and the project has no existing rate-limit infrastructure to extend. If a global auth rate limit is added later it should cover this route too; this feature adds none.
- **noindex.** The page is authenticated and marked `noindex, nofollow`.

## Decisions

- **Work and Security share one Settings page; identity is on the Profile page.** This is the locked IA. Work and Security are both configuration, so they sit together under two headings on one page. Identity (avatar, name, email) is a different concern and lives on the Profile page.
- **Changing the password does not invalidate other devices' sessions, and does not sign the current device out.** `nuxt-auth-utils` sessions are stateless sealed cookies with no server-side session store (confirmed by `server/middleware/validate-session.ts`, which revalidates account existence and deactivation, not a password version). There is no revocation list to clear, so a password change cannot force other cookies to expire without adding a password-version column to `users` and checking it on every request. That is a larger cross-cutting change and is out of scope. The convention-aligned behaviour is: keep the stateless model, refresh the current session so the current device stays cleanly signed in, and accept that any other active session remains valid until its own `maxAge` expiry. This is a documented tradeoff, not an oversight. Per-change global sign-out is its own future feature (a `passwordChangedAt` or session-version column enforced in `validate-session.ts`).
- **A new password equal to the current one is rejected (`password_unchanged`).** A mild credential-hygiene guard, not schedule-policing: silently accepting a no-op rotation would mislead a user into believing they rotated a possibly-compromised credential when they did not. The "do not police the user" rule governs time-tracking data, not credential-hygiene guards on a security action. Owner may drop this check; flagged as owner-adjustable, not blocking.
- **`PATCH`, not `POST`, for both writes.** Both endpoints update fields on the existing `me` resource, mirroring `PATCH /api/me/preferences`.
- **Work settings are not put on the session.** Unlike theme and locale, the work fields have no first-paint or no-flash requirement, so they are read on demand via `GET /api/me/work-settings` rather than carried in the session payload. This keeps the session small and avoids a fourth write path through the session-creation sites.

## Assumptions

Documented assumptions where the brief left a gap. Proceed on these unless the owner says otherwise.

1. **New words-per-hour field maps to the existing `quota_wph` column.** No `default_wph` column exists or is added; see the reconciliation above.
2. **The `password_unchanged` guard stays.** Owner-adjustable per the decision above.
3. **Both sections live on one Settings page.** The locked IA places Work and Security together here. This is not the earlier single-page draft that also carried identity; identity now lives on the separate Profile page.

## Open questions

None are blocking. The owner-verification items, both non-blocking, are the `password_unchanged` guard (keep or drop) and the final FR/EN wording of the new `settings` namespace strings, which the frontend stage drafts as proposals for owner review per the copy non-negotiable.

## Pipeline stages

- **specs** (this document) and **code review** run, never skipped.
- **design** and **frontend** run: the Settings page (`app/pages/settings.vue`) with its two sections is the piece to build.
- **backend** runs for the three API surfaces (`GET`/`PATCH /api/me/work-settings`, `PATCH /api/me/password`) and the shared validator extraction, plus the `loadWorkSettings` read path.
- **compliance** applies: a security action (password change) with a credential-breach control, authenticated and fail-closed, plus bilingual FR/EN copy for the Law 101 obligation.
- **accessibility** applies: two forms with labelled fields, error messaging, and keyboard-reachable controls to audit against WCAG 2.2 AA.
- **SEO is skipped** beyond confirming the `noindex, nofollow` robots meta the frontend stage sets; the page is authenticated and non-indexable.
- **unit-test** applies to `loadWorkSettings`'s `work_days` parse-and-coerce fallback, `WorkSettingsPatchSchema` (each bound, dedupe, empty-body refine), `PasswordChangeSchema` (length bounds, confirmation mismatch), and the `changePassword` handler's decision order (no-hash fail-closed, wrong current, unchanged, breached, success).

## Notes for later stages

- **Files created:** `app/pages/settings.vue`; `server/models/password.ts` (`PasswordSchema`, `PasswordChangeSchema`); `server/models/work-settings.ts` (`isValidTimezone`, the four field validators, `WorkSettingsPatchSchema`); `server/utils/loadWorkSettings.ts`; `server/api/me/password.patch.ts` and `server/api/me/handlers/changePassword.ts`; `server/api/me/work-settings.get.ts`, `server/api/me/work-settings.patch.ts`, and `server/api/me/handlers/getWorkSettings.ts` / `saveWorkSettings.ts`.
- **Files changed:** `server/models/onboarding.ts` (import `PasswordSchema` and the extracted work-field validators instead of defining them inline; behaviour-preserving); `app/components/app/header.vue` (optionally swap `navPath('settings', …)` for `useLocalePath('settings')` now that the page exists); `i18n/locales/fr.json` and `en.json` (add the `settings` namespace with `work.*` and `security.*` groups, reuse `onboarding.work.*` day/unit keys where they fit).
- **No schema change and no migration.** All four work columns and `users.password_hash` already exist. The absence of a migration is an acceptance criterion.
- **No `nuxt.config.ts` change.** The `settings` i18n page entry already exists and resolves once `app/pages/settings.vue` is created.
- **Reuse, do not reinvent:** the password policy, breach check, and hashing come from the onboarding path; the work-field ranges come from the same validators; the route shape and insert-if-missing write come from the preferences flow; the read path copies `loadUserPreferences`; the work UI copies `app/components/onboarding/step-work.vue`.
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.
