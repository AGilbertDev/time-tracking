# Manage users (admin)

## Intent

The owner needs a single admin page to run the whole membership lifecycle of the app: invite a new person by email, see who is invited, active, or deactivated, and deactivate or reactivate an account. The app is invite-only. There is no public sign-up, so an account exists only because an admin put its email on the allowlist first. This page is the admin surface for that allowlist plus the accounts that grew out of it. It reuses the existing magic-link signup flow for invitations, the existing deactivation enforcement in `login.ts` and `validate-session.ts`, and the existing bilingual email pattern. It adds one small schema column, an admin-gated API surface, a client and server admin guard, and a scheduled retention job that permanently deletes accounts deactivated for a year or more.

The page lives at the reserved localized route `admin-users` (`/utilisateurs` FR, `/users` EN), which is already registered in `nuxt.config.ts` and already link-ahead from the header popover (the header shows the Manage users item only when `isAdmin(role)`, per `docs/specs/settings/profile-menu-popover.md`). This feature builds the destination the header already points at. The page is an authenticated admin-only surface and must not be indexed.

See `docs/spec.md` §12 (admin panel), `docs/specs/settings/profile-menu-popover.md` (the header link that lands here and the `role`-on-session work it already did), `server/db/schema.ts`, `server/api/magic-link/handlers/request.ts` and `verify.ts` (the allowlist gate and account creation this reuses), and `server/utils/email-templates.ts` (the bilingual email pattern this extends).

## Scope

In scope:

- The admin page at route name `admin-users`, file `app/pages/admin/users.vue` (this file path produces the `admin-users` route name that `nuxt.config.ts` already localizes). Marked `noindex`.
- A client route middleware that redirects non-admins away from the page, and a server admin-gated event-handler wrapper for the new API routes. Both fail closed.
- A schema addition: `invited_at` on `allowed_emails`, with a hand-written migration `0003` continuing the `0000`-`0002` numbering and a matching `server/db/schema.ts` change.
- Invite by email: add the email to `allowed_emails` and send a bilingual invitation email that links to the signup page. No `users` row is created on invite.
- A paginated, server-side users list (20 per page) that is the union of `allowed_emails` and `users`, with a derived status column.
- Deactivate and reactivate per row, with the deactivation email sent in the target user's persisted locale.
- A scheduled Vercel cron endpoint that permanently deletes accounts deactivated for at least one year, plus the `vercel.json` cron entry.
- Extracting a shared `server/utils/sendEmail.ts` used by both the existing magic-link send and the new invitation and deactivation emails.
- The `adminUsers` i18n namespace (FR default, EN) and the new email templates (bilingual invite, localized deactivation).

Out of scope (do not build):

- Editing a user's role from this page. The role is displayed, never edited here.
- Any profile, settings, or account-detail page. Those are separate features.
- Onboarding or any new user-preference column. The owner has confirmed none is needed; `users.deactivated_at`, `role`, `created_at`, and the new `allowed_emails.invited_at` cover this feature.
- Changing the magic-link or password login flows. This feature reuses them unchanged apart from the `sendEmail.ts` extraction, which must not change magic-link behaviour.

## Inputs

- **Session user** (read, authenticated admin). The page and every API route read the session `user`, in particular `role` (added by the profile-menu-popover feature) and `email` (used to block admin self-deactivation).
- **Invite form**: one email address the admin types to invite.
- **List query**: a `page` number (1-based, default 1) for server-side pagination at 20 rows per page.
- **Row actions**: per row, a Deactivate action (on an invited or active row) or a Reactivate action (on a deactivated row), keyed by the row's email.
- **Cron trigger**: a scheduled GET from Vercel Cron to the retention endpoint, authenticated by a shared secret header. No user input.

## Route and admin gating

### Client

- Page file `app/pages/admin/users.vue`, route name `admin-users`, localized to `/utilisateurs` (FR) and `/users` (EN) by the existing `i18n.pages` map. Creating this file also makes `useLocalePath('admin-users')` resolve to the real localized path, so the header's `navPath('admin-users', locale)` link-ahead in `app/utils/account.ts` now lands on a real page instead of a 404.
- `definePageMeta({ middleware: 'admin' })` applies a new named middleware `app/middleware/admin.ts`. It reads `useUserSession().user` and, when `isAdmin(user.value?.role)` is false, redirects to `localePath('index')`. It reuses the existing `isAdmin` helper from `app/utils/account.ts` so the client gate and the header gate share one strict `=== 'admin'` check. The existing `auth.global.ts` already forces sign-in and onboarding, so this middleware only adds the admin check on top.
- The page sets `noindex` (for example `useSeoMeta({ robots: 'noindex, nofollow' })`). The whole app is auth-gated, but this states the intent explicitly for the SEO stage.

### Server

- A new wrapper `server/utils/defineAdminEventHandler.ts`, mirroring `defineAuthenticatedEventHandler.ts`. It calls `requireUserSession(event)` (401 when unauthenticated), then reads the session `user.role` and throws `createError({ statusCode: 403, statusMessage: 'forbidden' })` unless the role is exactly `'admin'`. It fails closed: any missing, unexpected, or non-`'admin'` role is rejected. Every admin API route below is defined through this wrapper.
- Hiding the header menu item is a UI affordance only. Authorization is enforced here, on the server, on every admin route. A non-admin who types the API path or the page URL is rejected by the server wrapper and redirected by the client middleware respectively.

## Schema and migration

Add one column to `allowed_emails` so invited-only rows carry a real date for the list's date column.

- **`server/db/schema.ts`**: extend the `allowedEmails` table to
  - `email: text('email').primaryKey()` (unchanged)
  - `invitedAt: integer('invited_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())`

  `mode: 'timestamp'` stores Unix **seconds**, matching `users.createdAt`. The application default is set in Drizzle via `$defaultFn` for new inserts.

- **`server/db/migrations/0003_add_allowed_emails_invited_at.sql`**: hand-written, authored in the same style as `0002` (plain statement-broken SQL, applied manually by the owner against the production Turso database, never auto-run, with the same idempotency and no-auto-run notes). It adds the column with a SQL-side default so any pre-existing allowlist rows get a real timestamp rather than null:

  `ALTER TABLE \`allowed_emails\` ADD \`invited_at\` integer NOT NULL DEFAULT (unixepoch());`

  `unixepoch()` returns seconds, matching the timestamp mode. Existing rows take the migration moment as their invited date, which is acceptable since there is effectively one real user and the invited-only rows are new going forward.

No other schema change is required. `users.role`, `users.created_at`, `users.deactivated_at`, and `users.password_hash` already exist and cover the rest of this feature. Do not add onboarding or other settings columns.

## Shared email sender

Extract `server/utils/sendEmail.ts` from the inline Resend construction currently in `magic-link/handlers/request.ts`. It owns the Resend client, the `from` display-name logic (use the configured `resendFromEmail`, and if it has no angle-bracket display name, wrap it as `Alexandre Gilbert <…>`), and the send call. Signature roughly `sendEmail({ to, subject, html }): Promise<void>`, throwing a `503` on a Resend error exactly as `request.ts` does today.

- Refactor `magic-link/handlers/request.ts` to call `sendEmail` instead of constructing `Resend` inline. Its externally observable behaviour must not change (same subject, same body, same neutral responses, same `503` on failure).
- The invite and deactivation handlers below use `sendEmail` too, so the sender identity and `from` formatting live in one place. This satisfies the compliance requirement for a clear, real sender identity across all transactional mail.

## Invite flow

Endpoint: `POST /api/admin/users/invite`, thin `server/api/admin/users/invite.post.ts` delegating to `server/api/admin/users/handlers/invite.ts`, defined through `defineAdminEventHandler`. Body validated by `InviteSchema` (`{ email: z.email() }`) via `readValidatedBody` + `sendZodError`, matching the magic-link route pattern.

Behaviour:

1. Normalize the email (trim, lowercase) so the allowlist key and the later magic-link lookup match.
2. Classify the email against current state (reuse the same status derivation as the list):
   - **Already active** (a `users` row with `password_hash` set and `deactivated_at` null): do not invite, do not send. Return a result the UI renders as "this person already has an account".
   - **Deactivated** (a `users` row with `deactivated_at` set): do not invite through this path. Return a result the UI renders as "use Reactivate for this account". Inviting must not silently re-add a deactivated email to the allowlist without clearing `deactivated_at`, because login would still 403.
   - **Already invited / pending** (in `allowed_emails`, no password yet): treat the invite as a resend. Refresh `invited_at` to now and send the invitation email again.
   - **New**: insert the email into `allowed_emails` (`invited_at` defaults to now) and send the invitation email.
3. Do **not** create a `users` row. Invited people live in the allowlist only until they accept. The `users` row is created later by `magic-link/handlers/verify.ts` when they open their link, exactly as today.
4. Send the invitation email via `sendEmail`. The link points at the signup page (`${config.siteUrl}` + the signup path). From there the person enters their email, the magic-link request checks the allowlist, and the existing flow takes over. Because an invited person has no persisted locale yet, the email is **fully bilingual**: French first then English in one message, with one call-to-action link. Use the default-locale signup path (`/inscription`) for the link.

Invitation email:

- New templates under `emailTemplates`, for example `emailTemplates.invite`, holding a single bilingual subject and body (not a per-locale pair, since the whole message is bilingual). Subject and body are proposals pending owner verification (see Copy).
- Clear sender identity via `sendEmail`. Transactional, owner-initiated, one recipient. Bilingual body satisfies the Law 101 French obligation.

Invite acceptance criteria:

- Inviting a brand-new email adds exactly one `allowed_emails` row with a real `invited_at` and creates **no** `users` row, and the recipient receives one bilingual email whose link opens the signup page.
- After inviting, the new email appears in the list as an **Invited** row with the invited date.
- Inviting an email that already has an active account sends nothing, adds no duplicate row, and the UI reports that the account already exists.
- Inviting a deactivated email sends nothing, does not re-add it to the allowlist, and the UI directs the admin to Reactivate.
- Re-inviting a still-pending email resends the bilingual email and refreshes `invited_at`, without creating a second row.
- A Resend failure surfaces to the admin as a delivery warning; the allowlist entry is harmless and the admin can re-invite to resend.

## Users list

> Superseded in part by `docs/specs/admin/users-table-sort-search.md`. The list endpoint now paginates, sorts, and searches on the server. The page size is 12 (not 20), the query accepts `sort`, `order`, and `search` on top of `page` and `pageSize`, and ordering is a whitelisted server sort that defaults to date descending with the email tie-break described below. Where this section and that spec describe pagination or ordering, that spec wins. Everything else in this section (the data source, columns, and status derivation) still holds.

Endpoint: `GET /api/admin/users?page=<n>`, thin `server/api/admin/users/index.get.ts` delegating to `server/api/admin/users/handlers/list.ts`, defined through `defineAdminEventHandler`. Query validated by `ListQuerySchema` (`{ page: z.coerce.number().int().min(1).default(1) }`).

Data source: the union of `allowed_emails` and `users`, keyed by email (email is unique on `users` and the primary key of `allowed_emails`). One row per distinct email across both tables. Implement as a full outer join on email or as merged queries; the backend stage chooses, but the result contract is fixed below.

Columns per row:

- `firstName`, `lastName` — from the `users` row, null/empty for invited-only rows.
- `email`.
- `role` — from the `users` row, empty for invited-only rows (no role until an account exists).
- `status` — **derived, never stored** (see below).
- `date` — the effective date: `users.created_at` for rows that have a `users` row, otherwise `allowed_emails.invited_at`.

Status derivation (a pure, unit-testable helper, e.g. `server/utils/deriveUserStatus.ts`), evaluated in this order so it is total over every combination:

1. `deactivated_at` set → **Deactivated**.
2. else `password_hash` set → **Active**.
3. else → **Invited** (covers both "in `allowed_emails`, no `users` row" and "a `users` row exists but `password_hash` is null", i.e. accepted the magic link but has not onboarded).

This matches the owner's definitions and stays consistent even after a deactivation removes the email from the allowlist, because Deactivated keys off `deactivated_at` rather than allowlist membership.

Pagination and ordering:

- 20 rows per page, server-side. Order deterministically by the effective date descending, tie-broken by email ascending, so pages are stable across requests.
- Response shape: `{ rows: Row[], page: number, pageSize: 20, total: number, totalPages: number }`. `total` is the full count of distinct emails; `totalPages = max(1, ceil(total / 20))`.

List acceptance criteria:

- The list returns at most 20 rows per page and reports an accurate `total` and `totalPages`.
- An invited-only email shows status **Invited**, empty name and role, and its `invited_at` as the date.
- A `users` row with a password and no `deactivated_at` shows **Active** with `created_at` as the date.
- A `users` row with `deactivated_at` set shows **Deactivated** regardless of allowlist membership.
- A `users` row with a null `password_hash` shows **Invited** (accepted link, not onboarded).
- Ordering is stable and deterministic between two calls to the same page.

## Deactivate and reactivate

Two endpoints, each thin route + handler, each through `defineAdminEventHandler`, each with body `{ email: z.email() }`:

- `POST /api/admin/users/deactivate` → `handlers/deactivate.ts`
- `POST /api/admin/users/reactivate` → `handlers/reactivate.ts`

Email is the identifier because it is the one key shared by invited-only rows and real accounts.

### Deactivate

1. **Block admin self-deactivation.** If the target email equals the session user's email, reject with `createError({ statusCode: 409, statusMessage: 'cannot_deactivate_self' })`. The sole admin must not be able to lock themselves out. The UI also hides or disables the Deactivate control on the admin's own row. This is a safety guard on a destructive admin action, distinct from the product's "do not police the user" rule, which is about time-tracking data, not account lockout.
2. Remove the email from `allowed_emails`. This alone revokes an invited-only invitation and prevents any new magic link (`request.ts` returns neutrally for a non-allowlisted email).
3. Load the `users` row by email.
   - **No `users` row** (pure invited-only): the invitation is now revoked. Send no email. Done.
   - **`users` row exists**: set `deactivated_at = now`. The existing `validate-session.ts` middleware and `login.ts` 403 then enforce the deactivation on the account's next request and login.
4. **Email**, only when the `users` row has `password_hash` set (a real, onboarded account): send a deactivation notice in the user's persisted locale, read via `loadUserPreferences(user.id).locale`. The message states the account is deactivated and to contact the admin at `alexandre.gilbert.dev@gmail.com`. A row with a null `password_hash` (accepted link, never onboarded) gets `deactivated_at` set but no email, since there is no established account to notify.
5. **Email failure does not revert the deactivation.** The security state change (allowlist removal and `deactivated_at`) is committed first; a Resend failure is surfaced to the admin as a delivery warning only. This deliberately differs from the magic-link handler, where a send failure aborts, because here the account must end up deactivated regardless of mail delivery.

Deactivation email:

- Localized templates under `emailTemplates.fr.accountDeactivated` and `emailTemplates.en.accountDeactivated`, selected by the target user's persisted locale (not a UI locale). Sent via `sendEmail`. Copy is a proposal pending owner verification (see Copy).
- Source the contact address from `runtimeConfig.ownerEmail` rather than hardcoding it, so the address lives in config; the owner must set `ownerEmail` to `alexandre.gilbert.dev@gmail.com` for this copy. See open question 1.

### Reactivate

1. Re-add the email to `allowed_emails` (a fresh `invited_at` is fine; the date column shows `users.created_at` for a real account, so `invited_at` is not surfaced for reactivated accounts).
2. If a `users` row exists, clear `deactivated_at` (set null). The account can log in again on its next attempt.
3. No email is sent on reactivation (none was requested).

Deactivate / reactivate acceptance criteria:

- Deactivating an active account removes it from `allowed_emails`, sets `deactivated_at`, and sends one deactivation email in that user's persisted locale naming the contact address; the account's next request is bounced by `validate-session.ts` and its next login returns 403 `account_deactivated`.
- Deactivating an invited-only row removes it from `allowed_emails`, sets no `deactivated_at` beyond the row not existing, and sends no email; the row leaves the Invited set.
- The admin cannot deactivate their own account: the API returns 409 and the UI offers no self-deactivate control.
- Reactivating a deactivated account re-adds it to the allowlist and clears `deactivated_at`, and the user can sign in again.
- A deactivation email send failure still leaves the account deactivated and reports a delivery warning.
- After each action the list reflects the new derived status on reload.

## Retention (scheduled deletion)

Accounts deactivated for at least one year are permanently deleted, as a data-minimization measure.

- Endpoint: `server/routes/api/cron/purge-deactivated.get.ts` (a Nitro route Vercel Cron can GET). It is **not** an admin-session route; it is authenticated by a shared secret. Verify an `Authorization: Bearer <secret>` header against a new `runtimeConfig.cronSecret`, and reject anything else with 401, failing closed. Add `cronSecret: ''` to `runtimeConfig` in `nuxt.config.ts`.
- Logic: delete `users` rows where `deactivated_at` is set and `deactivated_at <= now - 365 days`. Never delete before one year; the comparison is strict on the full year. For each deleted user, also delete dependent rows: the `settings` row(s) by `user_id` (there is a foreign key), and any `magic_link_tokens` by email. A deactivated account is already off the allowlist, so no `allowed_emails` cleanup is normally needed, but the purge may defensively remove a matching allowlist row by email.
- `vercel.json` (new file) gains a `crons` entry, for example `{ "crons": [{ "path": "/api/cron/purge-deactivated", "schedule": "0 3 * * *" }] }` (daily). The schedule cadence is not load-bearing; running daily and only deleting rows past the one-year mark is what matters.
- Response: a small JSON summary (for example `{ deleted: <count> }`) so a manual or dashboard invocation is legible. No personal data in the response.

Retention acceptance criteria:

- The endpoint rejects any request without the correct bearer secret with 401.
- A user deactivated less than one year ago is never deleted.
- A user deactivated at least one year ago is deleted along with its `settings` rows and any `magic_link_tokens` for its email, and the endpoint reports the count.
- Running the endpoint twice is safe: the second run finds nothing new to delete and reports zero.

## i18n copy

Page and control copy lives under a new `adminUsers` namespace in both `i18n/locales/fr.json` and `i18n/locales/en.json`. Email bodies live in `server/utils/email-templates.ts`, following the existing pattern (bilingual for the invite, per-locale for the deactivation notice). All French uses a space before `? ! : ;`.

The user is a professional translator, so every string below is a **proposal pending owner verification**, not final copy. Keys needed:

- Page: title, intro/description, `noindex` needs no copy.
- Invite: section heading, email field label and placeholder, submit button, success toast, "already a user" message, "use reactivate" message, delivery-warning message.
- Table: column headers (first name, last name, email, role, status, date), status labels (`invited`, `active`, `deactivated`), role labels (`user`, `admin`), the Deactivate and Reactivate buttons, a confirmation dialog for each destructive action, an empty-state message, pagination labels.
- Toasts: deactivated, reactivated, generic error.

Proposed key strings (FR first, owner verifies before ship):

| Key                             | FR (proposed)            | EN (proposed)   | Confidence                                                                                                                          |
| ------------------------------- | ------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `adminUsers.title`              | Gestion des utilisateurs | User management | Medium. Owner may prefer "Gérer les utilisateurs" to match the header item wording. Align with whatever `header.manageUsers` ships. |
| `adminUsers.status.invited`     | Invité                   | Invited         | High.                                                                                                                               |
| `adminUsers.status.active`      | Actif                    | Active          | High.                                                                                                                               |
| `adminUsers.status.deactivated` | Désactivé                | Deactivated     | High.                                                                                                                               |
| `adminUsers.invite.submit`      | Inviter                  | Invite          | High.                                                                                                                               |
| `adminUsers.actions.deactivate` | Désactiver               | Deactivate      | High.                                                                                                                               |
| `adminUsers.actions.reactivate` | Réactiver                | Reactivate      | High.                                                                                                                               |

The remaining strings (headings, placeholders, toasts, dialogs, email subjects and bodies) follow the same "proposed, owner-verified" rule and are drafted by the frontend and backend stages for owner review. None of the high-confidence strings above carry `? ! : ;`; any string the owner rewrites to include one takes the French space before it.

## Zod models

`server/models/admin-users.ts`:

- `InviteSchema = z.object({ email: z.email() })`
- `ListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) })`
- `DeactivateSchema = z.object({ email: z.email() })`
- `ReactivateSchema = z.object({ email: z.email() })`

Validated at the route boundary with `readValidatedBody` / `getValidatedQuery` + `sendZodError`, matching the magic-link routes.

## Edge cases

- **Admin self-deactivation.** Blocked. The deactivate endpoint returns 409 `cannot_deactivate_self` when the target equals the session user's email, and the row's Deactivate control is hidden or disabled for the admin's own account. Prevents the sole admin from locking themselves out.
- **Duplicate invite of an already-active user.** No new row, no email; the response tells the admin the account already exists.
- **Invite of an already-deactivated email.** Rejected on the invite path (would otherwise re-add to the allowlist while `deactivated_at` still blocks login). The response directs the admin to Reactivate instead.
- **Re-invite of a still-pending email.** Idempotent on the row (one `allowed_emails` entry), refreshes `invited_at`, resends the bilingual email.
- **Accepted-but-not-onboarded email** (a `users` row with null `password_hash`). Shows as Invited in the list. Deactivating it removes the allowlist entry and sets `deactivated_at` but sends no email, since there is no established account to notify.
- **Pagination out of range.** `page < 1` or non-numeric is coerced to the default 1 by Zod. A `page` beyond `totalPages` returns an empty `rows` array with accurate `total` and `totalPages` rather than an error.
- **Empty states.** No emails at all yields `total: 0`, `totalPages: 1`, an empty `rows` array, and the table renders the empty-state copy.
- **Deactivation email delivery failure.** The account is still deactivated (state committed before send); the admin sees a delivery warning, not a failure that reverts the action.
- **Session minted before `role` shipped.** The server wrapper's strict `=== 'admin'` check treats a missing role as non-admin and returns 403, and the client middleware redirects. Fails closed and is self-healing on the next session refresh.
- **Cron endpoint hit without the secret.** 401, fails closed. No deletion, no data leak.
- **Concurrent deactivate then reactivate.** Each is a discrete write; the final list state reflects whichever committed last. Not specially serialized beyond normal request handling, which is acceptable for a single-admin app.

## Open questions

1. **Deactivation contact address source.** The owner-specified contact address in the deactivation email is `alexandre.gilbert.dev@gmail.com`. This differs from the account's own email (`alexandre.gilbert@hubelia.com`) and from the deploy domain (`agilbert.dev`). Default assumption (proceed): put the address in `runtimeConfig.ownerEmail` and render it from there, and set `ownerEmail` to `alexandre.gilbert.dev@gmail.com`. Confirm the address is correct and that sourcing it from `ownerEmail` (rather than a second config key) is acceptable, since `ownerEmail` may already be intended for a different purpose.

## Notes for later stages

- **Files created:** `app/pages/admin/users.vue`, `app/middleware/admin.ts`, `server/utils/defineAdminEventHandler.ts`, `server/utils/sendEmail.ts`, `server/utils/deriveUserStatus.ts`, `server/models/admin-users.ts`, `server/api/admin/users/index.get.ts`, `server/api/admin/users/invite.post.ts`, `server/api/admin/users/deactivate.post.ts`, `server/api/admin/users/reactivate.post.ts`, their `server/api/admin/users/handlers/*.ts`, `server/routes/api/cron/purge-deactivated.get.ts`, `server/db/migrations/0003_add_allowed_emails_invited_at.sql`, `vercel.json`.
- **Files changed:** `server/db/schema.ts` (add `invited_at`), `server/api/magic-link/handlers/request.ts` (call `sendEmail`, no behaviour change), `server/utils/email-templates.ts` (add invite and deactivation templates), `nuxt.config.ts` (add `cronSecret` to `runtimeConfig`), `i18n/locales/fr.json` and `en.json` (add the `adminUsers` namespace).
- **Migration is hand-applied.** `0003` is authored like `0002`, applied manually by the owner against production Turso, never auto-run in CI or a deploy hook, and there are no database credentials in this environment.
- **Reuse, do not reinvent:** the allowlist gate and account creation stay in `magic-link/handlers/*`; deactivation enforcement stays in `login.ts` and `validate-session.ts`; the admin UI gate reuses `isAdmin` from `app/utils/account.ts`; the localized route reuses the already-registered `admin-users` entry in `nuxt.config.ts`.
- **Compliance touchpoints for that stage:** transactional owner-managed mail with a clear real sender identity (CASL / CAN-SPAM baseline via `sendEmail`), bilingual invitation for the Law 101 French obligation, admin API strictly role-gated and fail-closed, and the one-year retention-then-deletion documented here.
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.

## Design blueprint

Visual direction for the frontend stage. Prose and class lists only, no markup. Every colour is a Nuxt UI semantic token or a fixed status colour, never a raw hex. Icons are Phosphor (`i-ph-*`), which the repo bundles locally. This is the first `UTable` + `UPagination` surface in the repo, so it sets the pattern.

### Shell and page frame

The page renders in the existing `default` layout (`AppHeader` + `UMain` + `AppFooter`) on the flat `bg-muted dark:bg-(--ui-color-neutral-950)` canvas. It does not introduce `UPage`/`UDashboard*` scaffolding, which the repo has not adopted, and it does not use `.page-radial` (reserved for the auth pages). It follows the established idiom: a centered container holding `UCard` blocks, matching `signup.vue` and `onboarding.vue`.

`definePageMeta({ middleware: 'admin' })`, `useSeoMeta({ robots: 'noindex, nofollow' })`, and a `useI18n()` scoped to the `adminUsers` namespace. Data comes from a server-side-paginated `useAsyncData` keyed on the `page` ref (see Users list contract), and toasts come from `useToast()` (the app is already wrapped in `UApp`).

### Layout regions

1. **Page heading.** A title (`adminUsers.title`) and a one-line intro (`adminUsers.intro`) at the top of the content column. No card, sits directly on the canvas.
2. **Invite card.** A `UCard` holding a small heading (`adminUsers.invite.heading`) and a single-field `UForm`: an email `UInput` and an Invite submit `UButton`. Inline field validation, and success / classification / delivery-warning feedback delivered as toasts.
3. **Users table card.** A `UCard` (padding stripped from its body) wrapping the `UTable` edge to edge, with the pagination + count row in the card `#footer` slot. Carries the loading, empty, and populated states.
4. **Confirmation dialog.** One shared `UModal`, opened by any row action, its copy driven by the action and the row's derived status.

### Component hierarchy

- page root: `div.mx-auto.w-full.max-w-5xl.xl:max-w-6xl` container, `px-6 sm:px-6 lg:px-8`, `py-[clamp(2rem,6vh,4rem)]`, `space-y-[clamp(1.5rem,4vh,2.5rem)]`
  - heading region
    - `h1` (title) — `text-[clamp(1.5rem,1.6vw+0.5rem,2.25rem)] font-bold tracking-tight text-highlighted`
    - `p` (intro) — `mt-2 text-sm text-muted text-balance`
  - `UCard` (invite) — `rounded-2xl bg-default ring ring-default`
    - `h2` (invite heading) — `text-lg font-semibold text-highlighted`
    - `UForm` (`:schema` a client `z.object({ email: z.email() })`, `:state`, `@submit`) — layout `flex flex-col gap-4 sm:flex-row sm:items-start`
      - `UFormField` (`name="email"`, label `adminUsers.invite.emailLabel`, class `flex-1`)
        - `UInput` (`v-model`, `type="email"`, `autocomplete="email"`, `icon="i-ph-envelope-simple"`, `size="lg"`, `placeholder` `adminUsers.invite.emailPlaceholder`, `class="w-full"`)
      - `UButton` (submit, primary CTA) — `color="primary"`, `size="lg"`, `class="btn-glow w-full sm:w-auto sm:mt-6"`, `icon="i-ph-user-plus"`, `:loading`, label `adminUsers.invite.submit`
  - `UCard` (table) — `rounded-2xl bg-default ring ring-default`, `:ui="{ body: 'p-0', footer: 'px-4 py-3.5' }"`
    - scroll wrapper `div.overflow-x-auto` (horizontal scroll on narrow screens, per styling conventions)
      - `UTable` (`:data`, `:columns`, `:loading`, `:ui="{ base: 'min-w-full' }"`)
        - `#status-cell` → `UBadge` (colour by status, `variant="subtle"`, `size="sm"`)
        - `#role-cell` → `UBadge` for a set role, `—` in `text-dimmed` when empty
        - `#date-cell` → localized date text, `text-muted tabular-nums`
        - `#actions-cell` → per-row `UButton` (Deactivate / Reactivate) or the self-row marker
        - `#empty` → empty-state block (icon + message)
    - `#footer` → count + pagination row — `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`
      - count text (`adminUsers.pagination.count`, `{ total }`) — `text-sm text-muted`
      - `UPagination` (`v-model:page`, `:total`, `:items-per-page="20"`)
  - `UModal` (shared confirm) — `:title`, body message, `#footer` with a Cancel `UButton` (`color="neutral" variant="ghost"`) and a Confirm `UButton` (`:loading`), colour set by the pending action

### UTable columns

Column order left to right, defined as `TableColumn[]` with `accessorKey` + `header` reading the `adminUsers.table.*` keys. Custom rendering is done with `#<key>-cell` template slots (row data via `row.original`), never inline markup here.

| Key         | Header key                   | Cell                                                                               |
| ----------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `firstName` | `adminUsers.table.firstName` | plain text; `—` in `text-dimmed` when null (invited-only rows)                     |
| `lastName`  | `adminUsers.table.lastName`  | plain text; `—` in `text-dimmed` when null                                         |
| `email`     | `adminUsers.table.email`     | `text-default`, `break-all` so long addresses wrap rather than force width         |
| `role`      | `adminUsers.table.role`      | `#role-cell` badge (see below); `—` `text-dimmed` when empty                       |
| `status`    | `adminUsers.table.status`    | `#status-cell` badge (see below)                                                   |
| `date`      | `adminUsers.table.date`      | `#date-cell`, `Intl.DateTimeFormat(locale)` medium date, `text-muted tabular-nums` |
| `actions`   | `id: 'actions'`, no header   | `#actions-cell` (see below), cell `text-right`                                     |

**Status badge** (`#status-cell`), fixed status colours so the meaning never rethemes, `variant="subtle" size="sm"`, label from `adminUsers.status.*`:

- Invited → `color="info"` (calm, awaiting acceptance)
- Active → `color="success"`
- Deactivated → `color="neutral"` (dormant, greyed)

**Role badge** (`#role-cell`), `variant="subtle" size="sm"`, label from `adminUsers.role.*`:

- `admin` → `color="primary"`
- `user` → `color="neutral"`
- empty (invited-only, no account yet) → `—` in `text-dimmed`, no badge

**Actions cell** (`#actions-cell`), one control per row, label and colour derived from status:

- status Invited or Active → Deactivate: `UButton` `color="error" variant="ghost" size="sm"`, `icon="i-ph-user-minus"`, label `adminUsers.actions.deactivate`. Destructive tone, so no `.btn-glow`.
- status Deactivated → Reactivate: `UButton` `color="primary" variant="soft" size="sm"`, `icon="i-ph-arrow-counter-clockwise"`, label `adminUsers.actions.reactivate`.
- the admin's own row (`row.original.email === user.email`) → no action control; render a `UBadge color="neutral" variant="subtle" size="sm"` reading `adminUsers.actions.you` instead, so the self-deactivation guard is visible, not just a missing button. This matches the server's 409 `cannot_deactivate_self`.

Every action opens the shared confirm modal rather than firing immediately; the row's email is stashed as the pending target.

### Pagination and count feedback

Server-side, 20 per page, following the data-tables "async server-side pagination" recipe. A `const page = ref(1)` drives `useAsyncData('admin-users', () => $fetch('/api/admin/users', { query: { page } }), { watch: [page] })`. The response is `{ rows, page, pageSize, total, totalPages }` per the Users list contract.

- `UTable` binds `:data="data?.rows"`.
- `UPagination` binds `v-model:page="page"`, `:total="data?.total"`, `:items-per-page="20"` (Nuxt UI's `total` is item count, and it derives the page count itself).
- Count text sits to the left of the pagination in the card footer, `adminUsers.pagination.count` interpolating `{ total }`. On mobile it stacks above the pager (`flex-col`), on `sm:` it sits opposite (`sm:justify-between`).
- An out-of-range page returns empty `rows` with accurate `total`, so the footer stays correct and the table body shows nothing rather than erroring.

### Loading and empty states

- **Loading.** `UTable :loading="status === 'pending' || status === 'idle'"` (idle covers first paint). The built-in loading treatment renders over the table; the invite card stays interactive. No custom skeleton needed for a first pass.
- **Empty (no users at all).** The `#empty` slot renders a centered block, `py-[clamp(2.5rem,8vh,4rem)] text-center`: a `UIcon name="i-ph-users" class="mx-auto size-10 text-dimmed"`, a heading `adminUsers.empty.title` in `mt-3 text-sm font-medium text-highlighted`, and a hint `adminUsers.empty.hint` in `mt-1 text-sm text-muted` pointing at the invite field above. Distinct from the out-of-range empty page, which simply shows no rows.

### Confirmation dialog (destructive-ish actions)

Deactivating a real account sends an email and flips a security state, so no row action fires without confirmation. One reusable `UModal` is driven by a small reactive object holding the pending action (`'deactivate' | 'reactivate'`), the target email, and the row's status, so the copy and the confirm-button colour resolve from that single source.

- Title and body from `adminUsers.confirm.*`, selected by three cases so the consequence is honest:
  - **Deactivate an Active account** — states the person loses access and is emailed a notice (`adminUsers.confirm.deactivateActive`).
  - **Deactivate an Invited row** — framed as revoking the invitation, notes no email is sent (`adminUsers.confirm.revokeInvite`).
  - **Reactivate** — states access is restored, no email sent (`adminUsers.confirm.reactivate`).
- `#footer`: Cancel `UButton color="neutral" variant="ghost"` (`adminUsers.confirm.cancel`) and a Confirm `UButton` whose colour matches the action — `color="error"` for either deactivate/revoke, `color="primary"` for reactivate — with `:loading` bound to the in-flight mutation. The confirm button closes the modal on success.
- The same modal covers invited-row revocation and reactivation, so there is one confirmation surface, not three.

### Toasts (feedback)

All post-action feedback is a `useToast().add()` toast, colour-coded, never a raw colour:

- Invite succeeded (new or resent) → `color="success"`, `adminUsers.toast.invited`.
- Invite classified as already-active → `color="info"`, `adminUsers.toast.alreadyUser`.
- Invite classified as deactivated → `color="warning"`, `adminUsers.toast.useReactivate` (directs the admin to Reactivate).
- Deactivation/reactivation succeeded → `color="success"`, `adminUsers.toast.deactivated` / `adminUsers.toast.reactivated`.
- Email delivery warning (state committed, send failed) → `color="warning"`, `adminUsers.toast.deliveryWarning`.
- Any unexpected failure → `color="error"`, `adminUsers.toast.error`.

After a successful mutation the list is refreshed (`refresh()` from the `useAsyncData` handle) so the derived status updates in place.

### Responsive behaviour

- **Container.** `max-w-5xl` on `lg`, `xl:max-w-6xl`, centered with `mx-auto`, horizontal padding `px-6 sm:px-6 lg:px-8`. Vertical rhythm and inter-card spacing scale with `clamp()`.
- **Invite form.** Stacks on mobile (`flex-col`, full-width input, full-width button beneath), goes inline on `sm:` (`sm:flex-row`, button shrinks to `sm:w-auto` and aligns to the field with `sm:mt-6`).
- **Table.** Wrapped in `overflow-x-auto`; below its natural width it scrolls horizontally rather than forcing the page to scroll sideways (styling convention: wide content scrolls in its own container). To reduce the need to scroll on small screens, the lower-priority `role` and `date` columns are hidden below `md` via each column's `meta` class (`{ th: 'hidden md:table-cell', td: 'hidden md:table-cell' }`), keeping name, email, status, and actions always visible. Email uses `break-all` so it wraps instead of widening the table.
- **Footer.** Count and pager stack on mobile (`flex-col gap-3`), sit opposite on `sm:` (`sm:flex-row sm:justify-between`).
- **Modal.** `UModal` is full-width with side gutters on mobile and centered/constrained on larger screens by default; no override needed.

### Motion

No bespoke animation. Row hover tint, modal enter/leave, and toast slide are the Nuxt UI defaults and already respect reduced motion. The only signature accent is `.btn-glow` on the Invite CTA, which in this project is the simple 2px primary hover ring defined in `main.css` (per the theme-system spec AC11), gated behind `prefers-reduced-motion` at its source. It is applied to the primary Invite button only, not to inputs and not to the destructive Deactivate control. Any transition added later must be gated behind `@media (prefers-reduced-motion: reduce)`.

### Copy

All visible strings are placeholders under the `adminUsers` i18n namespace (FR default, EN second), keyed as referenced above (`adminUsers.title`, `adminUsers.intro`, `adminUsers.invite.*`, `adminUsers.table.*`, `adminUsers.status.*`, `adminUsers.role.*`, `adminUsers.actions.*`, `adminUsers.confirm.*`, `adminUsers.pagination.*`, `adminUsers.empty.*`, `adminUsers.toast.*`). Final copy is owner-verified per the spec's Copy section; this blueprint invents no final strings, and any French string that gains `? ! : ;` takes the French space before it.
