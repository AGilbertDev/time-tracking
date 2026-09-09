# Demo accounts

## Intent

A recruiter or interviewer evaluating this project cannot get in today, since sign-up is invite-only.
This adds a page where a visitor types an email, passes a Cloudflare Turnstile check, and receives a
one-time link that mints a throwaway account, seeds it with a week of generic sample data, and walks
them through the same onboarding wizard every real user sees. The account carries no real name and is
permanently erased within 1 hour; the entered email is used only to deliver the link and is never
stored on the account itself. The page is shared privately (README, portfolio page, a message to the
recruiter), never advertised inside the signed-in app.

## Prior art

Discourse's public demo forum and Grafana's play.grafana.org are the closest matches for a
no-signup, anonymous "playground" account, and both restrict what a visitor can change for the same
reason this does: nobody is accountable for what gets typed into a shared, throwaway account. Product
demo modes with real signup (Notion, Linear, HubSpot) seed sample data for the same reason this does,
an empty account teaches an evaluator nothing, but they let the person edit their own profile, because
their account is not anonymous or shared.

An earlier draft of this spec made the account instantly on an unauthenticated `GET`, reasoning that a
private link needs no gate. That is reversed here: a bare, no-throttle endpoint that writes to the
database is a standing invitation to script it, and this app has no rate-limiting anywhere to fall back
on. CAPTCHA-style bot detection in front of a public write, plus proof of owning an inbox before
anything is created, is the ordinary shape of a public sign-up form, and reusing it here is not
over-engineering, it is catching this feature up to the defenses a real sign-up form already needs.
Cloudflare Turnstile is chosen over reCAPTCHA because it sets no tracking cookie and the owner already
holds a Cloudflare account.

## Inputs

`app/pages/demo.vue`, an unauthenticated page (exempted from `auth.global.ts` like sign-in and
sign-up): an email field and a Turnstile widget, submitting `POST /api/demo/request { email,
turnstileToken }`. The emailed link is `GET /api/demo/verify?token=`.

## Outputs and acceptance criteria

AC1. `server/db/schema.ts` adds a `demo_link_tokens` table, shaped exactly like `magic_link_tokens`
(`token` primary key, `email`, `expiresAt`, `used`), and `demoExpiresAt: integer('demo_expires_at',
{ mode: 'timestamp' })` on `users`, nullable, no default. Migration `0015_demo_accounts.sql`. A demo
account is identified by `demoExpiresAt` being non-null; no separate boolean column exists, matching
how `deactivatedAt` alone marks a deactivated account today.

AC2. `POST /api/demo/request` first verifies `turnstileToken` against Cloudflare's siteverify endpoint
using a new private `turnstileSecretKey` runtime config entry. An unset key or a failed verification
returns 403 and writes nothing, the same fail-closed shape `cronSecret` already uses. On success it
mirrors `request.ts`: delete any existing `demo_link_tokens` row for that email, insert a new one with
the same 15-minute TTL, and email the link through the existing `sendEmail` helper with a new template.
It never reads or writes `allowed_emails` or `magic_link_tokens`; this is not the invite-only path.

AC3. `GET /api/demo/verify` validates the token (unused, unexpired) exactly as `verify.ts` does and
marks it used. Only then does it create the account: a generated internal email never shown or reused,
`firstName: 'Demo'`, `lastName: null`, `demoExpiresAt` set to now plus the fixed constant
`DEMO_ACCOUNT_DURATION_HOURS = 1` in `server/utils/demo.ts`. **The entered email is discarded once the
token is consumed and is never written to `users.email`.** It mints a session the same shape
`verify.ts` mints for a fresh invitee (`onboarded: false`), so `auth.global.ts` sends the visitor
straight to onboarding with no new client-side branch.

AC4. The same request seeds the current calendar week (the account's default timezone) with a fixed,
hand-written set of generic tasks across the app's trackable categories, defined once in
`server/utils/seedDemoData.ts`, independent of `scripts/seed.ts`. Every client name, project name, and
note is a placeholder ("Client A", "Projet de traduction FR→EN"); none is drawn from the dev seed's
fixture. A dashboard visit immediately shows a populated week.

AC5. A system-wide cap of `DEMO_ACCOUNT_CONCURRENCY_CAP = 10` live demo accounts
(`demoExpiresAt > now`) is checked both in `POST /api/demo/request` and again in AC3. **No live demo
account is ever deleted to make room.** At the cap, `request` refuses with a distinct, friendly
response before sending any email, and `verify`, for the rare race where the cap filled between
request and click, refuses the same way instead of creating the account. Either refusal lands the
visitor back on `/demo` with a message that every demo slot is in use and to try again shortly, which
in practice is a short wait, since every live account expires within the hour on its own and slots
free up continuously rather than all at once.

AC6. The onboarding wizard runs unmodified for a demo account except its identity step: the name
inputs are pre-filled with the stored generic name and disabled, so nothing is typed into them.
`CompleteOnboardingSchema`'s handler, for a user whose `demoExpiresAt` is non-null, ignores any
`firstName`/`lastName` in the request body and re-writes the same stored generic values instead of
trusting the client, so a hand-crafted request cannot store a real name either. Password, theme,
locale, and work-hours fields are collected and stored exactly as for any other account, since none of
that is personal information.

AC7. `PATCH /api/me/profile`, `PUT /api/me/avatar`, and `DELETE /api/me/avatar` all refuse a caller
whose `demoExpiresAt` is non-null with 403 `forbidden`, before reading or writing anything. On the
profile page, the name fields and the avatar control are hidden for a demo account, gated on a new
`isDemo(me.value)` client helper mirroring `isAdmin`.

AC8. `server/middleware/validate-session.ts` also selects `demoExpiresAt`. A request against an
account whose `demoExpiresAt` has passed erases that account through the shared helper in AC11, clears
the session, and for a page navigation redirects to sign-in with `?demo=expired`; the sign-in page
reads that query param and shows a message that the demo session expired. A deactivated account keeps
taking the existing branch unchanged.

AC9. While signed in with a live demo session, a banner is shown on every page (a new
`app/components/app/demo-banner.vue`, mounted in `app/layouts/default.vue`) stating the account is a
demo and showing the time remaining, computed client-side from `demoExpiresAt` against the current
time. It carries no dismiss control.

AC10. `server/api/cron/purge-deactivated.get.ts` additionally erases accounts whose `demoExpiresAt` has
passed, through the shared helper in AC11, and deletes any `demo_link_tokens` row that is used or
expired. This is the backstop for a demo account nobody revisits and for a requested-but-never-clicked
link. The response reports all three counts.

AC11. A shared helper, `eraseUsers(ids, emails)` in `server/utils/eraseUsers.ts`, factored out of the
cascade currently inlined in `purge-deactivated.get.ts`, is the single place that deletes a user and
every dependent row. AC8 and AC10 both call it; neither re-implements the delete order. AC5 never
calls it, since it never deletes a live account.

AC12. `server/utils/manage-users.ts`'s admin list query excludes any row with a non-null
`demoExpiresAt`. `turnstileSiteKey` ships as this app's first `public` runtime config entry, since the
`/demo` page's widget needs it in the client bundle; the paired secret key stays private and is read
only by AC2.

## Edge cases and interrupted paths

- **Turnstile fails or the widget never loads.** The request is refused with a clear error on the
  page; no token, no email, no account. Not treated as a neutral no-op, since there is no allowlist
  secret to protect here the way `request.ts` protects one.
- **A link is requested but never clicked.** The token simply expires at 15 minutes; no account was
  ever created, and AC10 sweeps the stale token row.
- **Retrying after expiry.** An erased account has no live session, so requesting a fresh link creates
  a brand-new account exactly as the first one did. Nothing correlates a visitor across accounts.
- **The cap is reached while an evaluation is already underway.** The active sessions already granted
  are never touched. Only a new visitor arriving after the cap filled sees the "try again shortly"
  message from AC5, and only until any existing session's hour runs out on its own.
- **Accepted residual risk.** Turnstile stops scripted and automated abuse, not a human manually
  requesting several links to different real or disposable inboxes. The cap in AC5 bounds the damage
  to churn rather than unbounded growth, and this is a deliberate line, not an oversight.
- **The Turnstile widget script.** Loaded from Cloudflare's CDN on the `/demo` page only. It sets no
  tracking cookie, so it does not reopen the cookie-notice question deferred below.

## Out of scope

Admin UI for viewing, filtering, or extending demo accounts. A configurable duration or admin
override. Legal pages and a cookie-consent notice: a real gap this feature makes more visible, tracked
separately, and not a blocker here since the account's own data footprint (no stored email, no real
name, generic seeded data, 1-hour hard erasure) is close to zero by construction. Any throttling beyond
Turnstile itself. Data export before expiry. Email notification before expiry. Avatar upload for a demo
account, since AC7 removes the control entirely.

## Verification

- `bun run test` and `bun run lint` exit 0. `workflow:unit-test` derives fixtures for AC1 through AC12
  from this document before the code exists, arriving failing, including a stubbed Turnstile
  siteverify call for both the pass and fail branches, and the extracted `eraseUsers` helper exercised
  by all three of its callers.
- Manual, against the dev database and a real Turnstile test key: submit the form, confirm a failed
  Turnstile check is refused, confirm a passing one delivers an email, follow the link, confirm the
  onboarding identity step shows a locked generic name, finish onboarding, confirm the current week is
  populated with generic tasks, confirm the profile page hides name and avatar editing, force an
  expiry and confirm the account and every dependent row are gone and the sign-in page shows the
  expiry message, and request an eleventh demo account while ten are live to confirm it is refused
  with the capacity message and that none of the ten live accounts is deleted or its session dropped.
- At code review: the admin users list is checked against a live demo account to confirm it is absent.

## Open questions

Whether the legal-pages gap named above becomes its own near-term feature. Deferred to the owner
rather than decided here.
