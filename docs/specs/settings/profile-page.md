# Profile page

## Intent

The signed-in user needs an authenticated page that owns their **identity**: the avatar, the first and last name, and the email. Today those values are set once during onboarding and shown read-only in the header popover, with no way to correct a typo in a name afterwards. This page makes the name editable, shows the avatar and the email, and is the destination the header popover's Profile item already links ahead to (`docs/specs/settings/profile-menu-popover.md`). It is one of two account pages: this Profile page holds **identity only**, and the sibling Settings page (`docs/specs/settings/settings-page.md`) holds work configuration and the password change. The split is the locked information architecture for this feature and is not re-litigated here.

Everything that is not identity is deliberately elsewhere. Work settings and the password change live on the Settings page. Appearance and language (theme and locale) persist through the existing preferences flow and header controls (`docs/specs/settings/preference-persistence.md`) and appear on neither page. Keeping identity on its own page means one small write surface (`PATCH /api/me/profile`) that touches only the `users` identity columns and refreshes the session, mirroring how `savePreferences` refreshes the session after a preferences write.

See `server/models/onboarding.ts` (the `firstName` / `lastName` validators this reuses), `server/api/me/handlers/savePreferences.ts` (the write-then-refresh-session pattern this mirrors), `server/api/me/preferences.patch.ts` (the thin-route pattern), `app/utils/account.ts` (`accountInitials`, `accountName` for the avatar and name display), `app/components/app/header.vue` (the identity display this matches and the `navPath` link-ahead this resolves), and `server/db/schema.ts` (`users.firstName`, `users.lastName`, `users.email`, `users.avatarUrl`).

## Scope

In scope:

- A new authenticated page at route name `profile`, file `app/pages/profile.vue`, localized to `/profil` (FR) and `/profile` (EN) by the existing `nuxt.config.ts` i18n `profile` entry, which becomes resolvable once this file exists. Marked `noindex, nofollow`.
- An **editable** first name and last name, submitting to a new `PATCH /api/me/profile`, with the change reflected in the session (and therefore the header popover) on success without a re-login.
- A **read-only** email display (email is the login key, changing it is a separate feature).
- An **avatar display** using the existing initials-circle idiom (`accountInitials`), matching the header. Changing the avatar (upload) is out of scope; see Assumptions.
- Extracting the `firstName` / `lastName` field validators from `server/models/onboarding.ts` into a shared `server/models/profile.ts` so the identity policy lives in one place and cannot drift between onboarding and this page, exactly as the password and work-field validators are extracted for the Settings page.
- A new `profile` i18n namespace (FR default, EN present) for this page's identity strings.

Out of scope (do not build):

- **Work settings and the password change.** They live on the Settings page (`docs/specs/settings/settings-page.md`). This page adds no work or security controls.
- **Appearance and language preferences.** They persist via the existing preferences flow and header controls. This page adds no theme or locale control.
- **Editing the email.** Email is the login key and the magic-link / owner-managed-auth anchor. Changing it is a separate feature with its own verification flow and is not built here. It renders read-only.
- **Avatar upload / asset pipeline.** No upload mechanism, blob storage, or image handling exists in the repo today, and adding one is non-trivial. The avatar renders as the initials circle only. See Assumptions for the minimal path and the owner-adjustable alternative.
- **Role editing.** Role is managed by the admin users feature (`docs/specs/admin/manage-users.md`), not here.
- Any change to the onboarding flow's observable behaviour. The `firstName` / `lastName` validator extraction must be behaviour-preserving for onboarding.

## Route and gating

- Page file `app/pages/profile.vue`, route name `profile`. Because it is a flat page, its i18n page-map key is `profile`, which matches the existing `nuxt.config.ts` entry (`fr: '/profil'`, `en: '/profile'`). Creating the file makes `useLocalePath('profile')` resolve to the localized path. The header currently link-aheads via the `navPath('profile', locale)` shim in `app/utils/account.ts` because `useLocalePath` cannot resolve a pages-map key until the page file exists; once this page lands the header can move to `useLocalePath('profile')`. Either way the Profile item now lands on a real page instead of a 404. No `nuxt.config.ts` change is needed.
- The page relies on the existing global auth middleware to force sign-in and onboarding. Any authenticated, onboarded user reaches their own profile. No admin gate, no new client middleware.
- The page sets `noindex, nofollow` (for example `useSeoMeta({ robots: 'noindex, nofollow' })`). The whole app is auth-gated; this states the intent for the SEO stage.
- The write route below is defined through the existing `defineAuthenticatedEventHandler` wrapper, so an unauthenticated request is rejected with 401 before the handler runs. The write is scoped to the session `user.id`, never an id from the request body, so a user can only ever change their own identity.

## Inputs

- **Session user** (read, authenticated). The page reads `firstName`, `lastName`, and `email` from `useUserSession().user` to pre-fill the name fields, show the read-only email, and render the avatar initials. The session is the read path; there is no `GET /api/me/profile`.
- **Name form** (user-initiated): `firstName`, `lastName`. Pre-filled from the session, editable, submitted on save.

## Data contract

### Shared validator extraction (do first)

To reuse the exact onboarding identity policy without redefining it, extract the name fields so both onboarding and this feature import one source. The extraction is behaviour-preserving for onboarding, and it parallels the `PasswordSchema` / work-field extractions the Settings page performs.

- Extract the `firstName` and `lastName` fields currently inline in `CompleteOnboardingSchema` (`z.string().trim().min(1).max(100)`) into shared field schemas in a new `server/models/profile.ts` (for example `firstNameSchema`, `lastNameSchema`, or a single `nameFieldSchema` reused for both). `CompleteOnboardingSchema` imports them. The trim, the min (1), and the max (100) are unchanged.

### `PATCH /api/me/profile`

Thin route `server/api/me/profile.patch.ts` (mirrors `preferences.patch.ts`) delegating to `server/api/me/handlers/updateProfile.ts`, both behind `defineAuthenticatedEventHandler`. Body validated by a new `ProfilePatchSchema` in `server/models/profile.ts` via `readValidatedBody(event, ProfilePatchSchema.safeParse)` + `sendZodError` on failure.

- `ProfilePatchSchema` is a partial PATCH mirroring `PreferencesPatchSchema`: every field optional, reusing the extracted name field validators, with a `.refine` rejecting an empty object.
  - `firstName: <extracted>.optional()`
  - `lastName: <extracted>.optional()`
  - `.refine(at least one field defined, { message: 'At least one profile field must be provided.' })`
- Request body: any non-empty subset of `{ firstName, lastName }`.
- Handler logic, mirroring `savePreferences`:
  1. `requireUserSession` (enforced by the wrapper), resolve `user.id`.
  2. `db.update(users).set({ ...provided fields, updatedAt: new Date() }).where(eq(users.id, user.id))`. Only the provided fields are written. This is the only mutation.
  3. Refresh the session with `setUserSession(event, { user: { ...user, ...provided fields } })` so the header popover and this page reflect the new name on the next render without a re-login, matching how `savePreferences` merges onto the existing session user.
  4. Return the updated identity so the client can reconcile.
- Response `200`: `{ firstName, lastName }` (the full current identity name, so the client reconciles).
- Error responses (via `sendZodError`): `422` with per-field `data` for a name outside 1–100 characters after trim, or an empty body. No other error surface.
- The email is never accepted in this body and is never written by this route.

## Outputs and acceptance criteria

1. Navigating to `/profil` (FR) or `/profile` (EN) as an authenticated, onboarded user renders the Profile page showing the avatar, an editable first name and last name pre-filled from the session, and a read-only email. The header Profile item lands here and no longer 404s.
2. The avatar renders as the initials circle from `accountInitials(firstName, lastName)`, identical to the header trigger. A user with no name set renders an empty-but-valid avatar (never a stray "null") and the email still shows.
3. The email field is visibly read-only (disabled or presented as static text) and cannot be edited or submitted. No request this page makes writes the email.
4. Editing the first and/or last name to a valid value (1–100 characters after trim) and saving calls `PATCH /api/me/profile`, persists to `users.first_name` / `users.last_name`, returns `{ firstName, lastName }`, and the header popover and this page show the new name immediately without a re-login or hard refresh.
5. A name field that is empty after trim, or longer than 100 characters, is rejected with `422` and a per-field message, and nothing is written. An empty submit body (nothing changed) is rejected by the schema `.refine` as `422`.
6. The write is scoped to the session user. A user can never change another user's identity; the handler never reads an id from the request body.
7. The page is served with `noindex, nofollow`.
8. **Reuse, not reinvention.** The `firstName` / `lastName` bounds are the onboarding ones, imported from the shared `server/models/profile.ts`. The write-then-refresh-session shape is the `savePreferences` pattern. No second copy of the name policy exists after this feature, and onboarding still accepts and rejects exactly what it did before.
9. **Nuxt UI first.** The form uses `UForm`, `UFormField`, `UInput`, and `UAvatar` (or the existing initials-circle component), following `my-frontend-conventions`. Icons are Phosphor `i-ph-*`.
10. **i18n.** Every visible label is an i18n key under a new `profile` namespace, FR default and EN present, no hardcoded strings. French copy takes a space before `? ! : ;`. All new strings are proposals pending owner verification (the user is a professional translator); no LLM-guessed term ships.
11. **Separation of concerns.** Client code in `app/`, the route and handler in `server/`, the Zod contract in `server/models/`. The route file stays thin; logic lives in `handlers/`.
12. **Product non-negotiable.** The page records the user's own identity and never blocks a valid edit. Validation rejects only genuinely invalid input (empty or over-long name).

## Edge cases and failure branches

The name change is a single atomic step (one `db.update`), so there is no half-done identity state.

- **Interrupted or abandoned mid-edit.** Typing in the name field and navigating away writes nothing; the stored name is untouched. There is no token, no multi-request handshake, and no server-side draft, so there is nothing to recover. Re-opening the page starts from the persisted name.
- **Network failure or server error before the update commits.** The single `db.update` either commits or does not. On any failure before commit the old name remains; the user sees an error and can retry. No intermediate state exists.
- **Ambiguous failure after submit (response lost, write may or may not have committed).** Recovery is safe and self-evident: re-opening the page reads the current name from the session, and the user can re-save. Re-saving the same value is accepted (idempotent), so there is no lockout and no invalid state either way.
- **Session expires before submit.** `requireUserSession` returns `401` and the session-validation middleware redirects a page navigation to the locale-appropriate sign-in route. Nothing is written. After re-authenticating the user reaches the profile again and retries.
- **Account deactivated mid-session** (another tab or an admin). The session-validation middleware clears the session and redirects on the next navigation, and the authenticated wrapper `401`s the API call. The edit cannot proceed on a deactivated account, the correct fail-closed outcome.
- **Name cleared to empty.** Rejected with `422` rather than stored, because onboarding requires a non-empty name and this feature keeps that policy so the identity display and avatar initials stay coherent. This is a data-validity guard, not schedule-policing.
- **Stale session name after another device edits.** The name lives on the sealed session cookie per device. A change on device A does not retroactively update device B's session until device B re-renders from a refreshed session or re-authenticates. This matches the existing preferences behaviour and is acceptable for a display name; last write wins in the database.

## Decisions

- **Name is editable; email and avatar are not (here).** The locked IA places identity on this page. Of the identity fields, the name is safely editable with a single scoped write. Email is the login key and needs its own verification flow to change, so it is read-only. Avatar editing needs an upload pipeline that does not exist, so the avatar is display-only. See Assumptions for the avatar path.
- **No `GET /api/me/profile`.** The name and email are already on the session, which is the page's read path, exactly as the header popover reads them. Adding a GET would duplicate the session read for no benefit. The PATCH returns the updated name so the client reconciles.
- **`PATCH`, not `POST`.** The endpoint updates fields on the existing `me` resource, mirroring `PATCH /api/me/preferences`.
- **Session refresh on write.** Because the name is carried on the session (the header popover reads it there), the write must refresh the session so the change is visible immediately, mirroring `savePreferences`.

## Assumptions

Documented assumptions where the brief left a gap. Proceed on these unless the owner says otherwise.

1. **Avatar is display-only; upload is deferred.** No avatar upload mechanism, blob storage, or image pipeline exists in the repo (`avatar_url` is a column with no writer, and the header renders initials only). Building upload is non-trivial and out of proportion to this feature, so the avatar renders as the existing initials circle and the `avatar_url` column is left unwired. This is the minimal approach the brief asked for. **Owner-adjustable alternative:** if editability is wanted now without an upload pipeline, add an optional `avatarUrl` field to `ProfilePatchSchema` (validated as an `https` URL, or empty to clear) and surface `avatar_url` on the session so the avatar can render an image with the initials fallback. That is a small, migration-free addition (the column already exists) and is flagged rather than built, because a paste-a-URL avatar is unusual UX and the owner should choose it deliberately. A real upload (Vercel Blob or similar) is a separate future feature.
2. **The name stays required (1–100 chars), matching onboarding.** Clearing a name is rejected rather than stored, so the avatar initials and the identity display stay coherent. Owner may relax this to allow an empty name; flagged as owner-adjustable, not blocking.
3. **Email is read-only on this page.** Changing the login email is a separate feature with its own verification and is not built here.

## Open questions

None are blocking. The owner-verification items, both non-blocking, are: (a) whether to opt into the URL-field avatar now or defer avatar editing entirely (Assumption 1), and (b) the final FR/EN wording of the new `profile` namespace strings, which the frontend stage drafts as proposals for owner review per the copy non-negotiable.

## Pipeline stages

- **specs** (this document) and **code review** run, never skipped.
- **design** and **frontend** run: the Profile page (`app/pages/profile.vue`) and its name form are the pieces to build.
- **backend** runs for the one new API surface (`PATCH /api/me/profile`) and the name-field validator extraction.
- **compliance** applies: identity data edited under an authenticated, fail-closed write, plus bilingual FR/EN copy for the Law 101 obligation.
- **accessibility** applies: a labelled form with a read-only field and error messaging to audit against WCAG 2.2 AA.
- **SEO is skipped** beyond confirming the `noindex, nofollow` robots meta the frontend stage sets; the page is authenticated and non-indexable.
- **unit-test** applies to `ProfilePatchSchema` (each bound, empty-body refine) and the `updateProfile` handler (provided-fields-only write, session refresh).

## Notes for later stages

- **Files created:** `app/pages/profile.vue`; `server/models/profile.ts` (extracted name field validators, `ProfilePatchSchema`); `server/api/me/profile.patch.ts` and `server/api/me/handlers/updateProfile.ts`.
- **Files changed:** `server/models/onboarding.ts` (import the extracted name validators instead of defining them inline; behaviour-preserving); `app/components/app/header.vue` (optionally swap `navPath('profile', …)` for `useLocalePath('profile')` now that the page exists); `i18n/locales/fr.json` and `en.json` (add the `profile` identity namespace).
- **No schema change and no migration.** `users.first_name`, `users.last_name`, `users.email`, and `users.avatar_url` all exist. The absence of a migration is an acceptance criterion.
- **No `nuxt.config.ts` change.** The `profile` i18n page entry already exists and resolves once `app/pages/profile.vue` is created.
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.
