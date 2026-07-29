# Time-Tracking App — v1 Spec

First-pass spec for the rebuild. Loosely scoped, and sections marked **TBD** get refined after a working session with the user, a professional translator.

> **Build status & next steps live in [`docs/TODO.md`](./TODO.md).** Read it first if you are picking this up.

---

## Build status (2026-05-31)

**Shipped and live** at `https://time-tracker.agilbert.dev` (Vercel):

- Nuxt 4 + Nuxt UI v4 app shell (header, footer, `auth` + `default` layouts), brand orange palette, Hanken Grotesk font, adaptive light/dark logo + favicon.
- i18n FR (default) / EN with localized routes (`customRoutes: 'config'`), language toggle (flip animation on auth pages, in the profile dropdown on the dashboard).
- Turso + Drizzle DB. Tables: `users` (with `password_hash`, `role`, `deactivated_at`), `allowed_emails`, `magic_link_tokens`, `settings`.
- **Auth, end to end**: two-page split — sign-up (`/inscription`, invite-only magic link) and sign-in (`/connexion`, email + password). Magic-link request/verify, password login (`verifyPassword`), unskippable onboarding (first/last name + confirmed password), NIST-aligned password policy with Have I Been Pwned breach check. Session carries `{ id, email, firstName, lastName, onboarded }`; 7-day cookie. Global middleware enforces sign-in and onboarding gates.
- Owner bootstrap via `bun run seed` (seeds `allowed_emails` + admin `users` row from `NUXT_OWNER_EMAIL`).

**Not built yet** (see TODO): admin user-management UI + routes, the planning week view (the dashboard is an empty placeholder), settings UI, stats, recurring/split tasks.

---

## 1. Audience & purpose

A planning + productivity tool for **freelance translators**. Single user today, but built multi-user from day one so it can grow into a portfolio piece and serve other translators.

Translators work against a **words-per-hour target**, and the target differs by kind of work. The tool's reason for existing is to (a) make daily/weekly planning low-friction and (b) surface the same WPH numbers the work is reviewed against.

---

## 2. Non-negotiables

- **Copy quality**: every visible string must be **researched, verified, and accurate** — never LLM-guessed. The user is a translator; UI grammar/spelling errors are disqualifying. Applies to French first, English second, and any future locale.
- **i18n-first**: locale switching is a core feature, not a retrofit. Default locale: **French**. English support planned. Locale should be persisted per user.
- **Don't police the user**: the app may *signal* (holiday, exceeded daily target, working a non-work day) but never *block*. The user decides what they actually do with their time. The app records reality, not what the schedule says reality should be.

---

## 3. Architecture concepts

### Server route conventions

Inspired by CJ Reynolds' nuxt-travel-log and the Hubelia/Nathan SDK pattern used across Mercuri, Morstowe, and Celebritee.

- **Validation**: every route uses `readValidatedBody` / `getValidatedQuery` (H3 built-ins) with a Zod schema's `.safeParse`. Never call `readBody` without validation.
- **Zod error utility**: `server/utils/sendZodError.ts` converts a `ZodError` into a structured 422 `createError` with per-field data for client-side display.
- **Auth guard wrapper**: `server/utils/defineAuthenticatedEventHandler.ts` wraps `defineEventHandler` — checks session before the handler runs, throws 401 if absent. All protected routes use this instead of bare `defineEventHandler`.
- **No global try/catch boilerplate**: H3 bubbles `createError` responses automatically. Only wrap specific DB operations that can throw known constraint errors (e.g. UNIQUE violations).
- **Handler extraction**: business logic lives in separate handler functions (`server/api/{resource}/handlers/`), not inline in route files. Mirrors Nathan's pattern.
- **Zod schemas**: defined once in `server/schemas/` and reused for both validation and TypeScript inference. Mirrors Nathan's model files.
- **i18n in server routes**: use a plain dictionary in `server/utils/email-templates.ts` — `useI18n()` is Vue-only and unavailable server-side. Locale is passed in the request body by the client.

### Magic link token lifecycle

- **On use**: mark `used = true` immediately to prevent replay attacks. Already enforced in the `WHERE` clause of the verify query (`used = false`).
- **On new request for the same email**: delete all existing tokens for that email before inserting the new one. Keeps the table clean without a separate job.
- **Expired token cleanup**: not implemented yet. Low priority for a 2–3 user app. When needed, use a **Vercel Cron job** — a `vercel.json` schedule that calls a server route (`/api/cron/cleanup-tokens`) on a daily interval. Free on Vercel's hobby plan.

### DB & env pattern

- Drizzle client lives in `server/db/index.ts`, lazy-initialized via `useDb()` using `useRuntimeConfig()`.
- All env vars declared in `nuxt.config.ts` under `runtimeConfig` and auto-mapped from `NUXT_*` env vars.



- **Multi-user**: each user has an account; all data is scoped to the user.
- **Persistent database**: **Turso** (libSQL / SQLite at the edge) accessed through **Drizzle ORM**. Data does not live in the browser; the user can move between devices and find their data intact. Free tier: 500 databases, 9GB — one Turso account covers all projects.
- **Auth**: **owner-managed, two methods split across two pages**. The page determines the flow, so the pre-auth UI never has to detect a user's password state (which it can't, having no session) — this also removes any account-enumeration endpoint.
  - **Sign up page** (`/inscription` fr, `/signup` en) — the invite-only **magic-link** request. "First time? Sign up." Enter email → if allowlisted, receive a one-time link → clicking it authenticates and drops into the unskippable onboarding form (which sets the password). Response is always neutral, so the allowlist is never revealed.
  - **Sign in page** (`/connexion` fr, `/login` en) — email + **password**. The regular method for returning, onboarded users. A new `POST /api/auth/login` verifies credentials with `nuxt-auth-utils`' `verifyPassword` (scrypt) and returns a generic "invalid credentials" on any failure (no enumeration). Links to the sign-up page for first-timers.
  - **Magic link is inert after onboarding** — once `password_hash` is set, a leaked or replayed link cannot grant a normal session. (Forgot-password, planned, will reuse the link to reach a *reset* form rather than logging in directly.)
  - Access is still gated by `allowed_emails`. A deactivated user stays in the table but is blocked at login with a specific message (see §12).
  - **Owner bootstrap**: a seed/migration step reads `OWNER_EMAIL` on first run, inserts it into `allowed_emails`, and creates the owner `users` row with `role = 'admin'`. The owner activates via the sign-up (magic-link) page on first use.
  - Access is still gated by `allowed_emails`. A deactivated user stays in the table but is blocked at login with a specific message (see §12).
  - **Owner bootstrap**: a seed/migration step reads `OWNER_EMAIL` on first run, inserts it into `allowed_emails`, and creates the owner `users` row with `role = 'admin'`. Idempotent.
  - Session payload is minimal (`{ id, email }`); 7-day cookie via `SESSION_MAX_AGE`.
  - No third-party identity providers (Clerk / Auth0 / Supabase Auth) and no identity-server backends (Kratos, Hydra, Keycloak) — simplicity is the priority.
- **i18n layer** in the app shell so every screen renders translated copy from a dictionary, not inline strings.

---

## 4. Domain model (conceptual)

### User
- `id` — text, primary key (uuid)
- `email` — text, unique, not null (login key)
- `first_name` — text, nullable (set during onboarding)
- `last_name` — text, nullable (set during onboarding)
- `password_hash` — text, nullable. Null means onboarding is incomplete and magic-link auto-login is still allowed. Non-null means password login is required.
- `avatar_url` — text, nullable
- `role` — text, `'admin' | 'user'`, default `'user'`. Drives access to the admin panel and role-based permissions.
- `deactivated_at` — timestamp, nullable. Null means active; set means blocked at login.
- `created_at` / `updated_at` — timestamps

`first_name` / `last_name` / `password_hash` being null is the signal that triggers the unskippable onboarding form (see §12).

### Settings (per user)
- `user_id` — FK → users.id
- `daily_work_minutes` — integer, default `450` (= 7h30). Stored as minutes for arithmetic simplicity.
- `work_days` — text (JSON array of 0–6 day numbers, e.g. `[1,2,3,4,5]` for Mon–Fri)
- `default_wph` — integer, default `450` (words per hour)
- `timezone` — text, default `'America/Toronto'`
- `light_theme` — text, default `'pastel'`. The chosen light atmosphere (one of the eight in `useTheme`). The default matches `DEFAULT_THEME` in `useTheme.ts`.
- `dark_theme` — text, default `'pastel'`. The chosen dark atmosphere, independent of the light one.
- `locale` — text, default `'fr'`. The persisted UI language, moved here from `users` so all user preferences live on one row. See [specs/settings/preference-persistence.md](specs/settings/preference-persistence.md).
- TBD: default task category

**Theme persistence (decision)**: the favorited light/dark atmospheres are **stored as user settings (`light_theme` / `dark_theme` on the `settings` row), not cookies**. They are part of the user's account and follow them across devices. `useTheme` should read from and write to the settings API. The current cookie implementation (`ui-theme-light`, `ui-theme-dark`) is an interim stand-in until the settings API exists, and at most stays as a pre-auth default for the sign-in/sign-up screens (where there is no user yet) — not as the source of truth.

**No flash of the wrong theme (requirement)**: the atmosphere must be resolved on the server and written into the initial HTML (`<html data-theme="...">` plus the `.dark` class) before anything renders. On a hard refresh the first paint has no synchronous access to a value that lives in the database, so a theme fetched on the client after mount paints the default atmosphere first and then swaps to the user's choice, which is the visible flash. A client-side inline script cannot fix this, because the source of truth is server-side and is not known at first paint. Since the choice lives in user settings and the server already holds the session, the server resolves `light_theme` / `dark_theme` at render time, whether carried in the session payload or loaded during SSR, and injects them into the response so the correct atmosphere is present on first paint. This is the main reason the theme is stored in user settings rather than fetched on the client. On the pre-auth screens, where there is no user yet, the same no-flash guarantee comes from reading the cookie default server-side on each request.

### Auth tables
- **`allowed_emails`** — `email` text primary key. Owner-managed allowlist. Seeded from `OWNER_EMAIL` env var.
- **`magic_link_tokens`** — `token` text primary key, `email` text, `expires_at` timestamp, `used` boolean default false. Single-use, short TTL (15 min).

### Sessions
Handled by `nuxt-auth-utils` (signed cookie). The session payload stores `{ userId, email }` — no sensitive data.

### Week
A logical grouping of days, not a fixed Mon–Fri block. Internally probably stored as a date range or computed from a per-user week-anchor + active-days mask. The UI lets the user see and edit any week.

### Day
A date within a week. Carries:
- The tasks scheduled on it
- A computed summary: planned time, actual time, remaining vs. daily target, excess
- A flag if it's a holiday and/or a non-working day for this user

### Task
The unit of work. Fields split into **primary** (visible in the compact row) and **secondary** (visible in the expanded edit form).

**Primary** *(working list — confirm with user)*:
- Client
- Project number / name
- Delivery date + time
- Word count (project total)
- Category (translation, revision, terminology, glossary update, admin, …)
- Estimated duration (auto-computed)
- Actual duration (auto-synced from estimated until the user overrides it)
- Status (e.g. Accepté / En cours / Terminé — names TBD)

**Secondary** *(working list — confirm with user)*:
- Project manager
- Per-task WPH quota override
- Exclude-from-stats flag
- Free-text instructions
- Recurrence config (see below)
- Split-task linkage (see below)

**Categories** are an enum we'll define with the user. Not every task is a translation; some categories (admin, training) may default to excluded-from-stats.

### Recurring tasks
Like Google Calendar: a task can repeat
- on selected weekdays
- starting from a date
- until a date OR forever (no end)
- with a way to detach a single occurrence (edit "this one" vs. "all future")

Recurring tasks materialize as individual day-tasks the user can still tweak independently.

### Split tasks
A single project's work can be **split across multiple days**. The user only knows the **total word count for the project**, not how many words they did each day. This creates a stats tension we have to handle deliberately:

Approaches (decide with the user):
1. **Time-weighted split** — divide the project's words across its day-tasks proportionally to actual time spent each day.
2. **Prompt on completion** — when the user marks the project Terminé, ask them to confirm a per-day word breakdown.
3. **Project-level aggregation** — don't try to attribute words to specific days; only aggregate WPH at week/month/year level (the corrected algorithm from the old app already does this).

The old app implicitly used (3). We should confirm what feels right for performance-review use.

### Holiday
A date marked non-working at the user level. The day still exists, the user can still log work on it. The calendar visually marks holidays but doesn't gray them out beyond a hint.

---

## 5. Stats

Goal is to **match the WPH formula the user is measured by**, exactly. Whatever number lands on the throughput review, the app shows the same.

We need to confirm the formula with the user. Working assumption (carried from the old app):

> Group tasks by project, take each project's total word count once, divide total project-words by total actual time on those projects.

Stats periods to surface:
- **Daily** (new vs. old app)
- **Weekly**
- **Monthly**
- **Yearly**

Each period should show:
- The corrected WPH number
- Total words completed
- Total time logged
- Optional: a sparkline or trend indicator vs. the previous period (TBD)

Performance-review surfacing:
- A dedicated view ("Historique de performance" / "Performance history") to look up any past period.
- Export option (CSV / JSON) so the user can bring numbers into a review meeting. Format TBD.

---

## 6. Calendar & week view

- **Default view**: the current week.
- **Day stack**: days stacked vertically (one block per day), each day showing its header summary + its task list.
- **Today is always prominent** — at the top, or pinned, or visually emphasized. Final layout TBD; the rule is "I should never have to hunt for today."
- **Week switcher**: navigate any week back/forward, jump to today.
- **Non-working days** still render (translucent / hint label), since the user may still log work on them.
- **Holidays** render with a holiday label.
- TBD: month view, day view, agenda view.

---

## 7. Task interactions

- **Add** a task to any day (including non-working days and holidays).
- **Edit** inline by expanding the row; collapse on click-outside.
- **Drag and drop** within a day to reorder; across days to move.
- **Copy-paste**: select a task, paste it on another day. Duplicates the task with a new id; not a recurrence link.
- **Delete** a task.
- **Cycle status** with a single click.

Mandatory fields enforce on save (the primary-row fields). Secondary fields are optional. Final mandatory list: **TBD with user**.

---

## 8. What we explicitly carry forward from the old app

- The **corrected WPH algorithm** (group by project, max-words-per-project).
- **Inline row expansion** for editing.
- **Auto-syncing actual duration from estimated** until the user overrides.
- **Status cycling on click**.
- **Exclude-from-stats** flag per task.
- **Drag-and-drop across days**.
- **JSON import/export** as a portable backup (in addition to the database — for the user's peace of mind).

## 9. What we explicitly drop or replace

- localStorage-only persistence → real database.
- Hard-coded 7h30 daily target → per-user setting.
- Fixed Mon–Fri week → flexible per-user working days.
- French-only UI → i18n with at least FR + EN.
- "Recurrence widget that doesn't save" → real recurrence (Google-Calendar-style).
- No categorization of work → typed task categories.

---

## 10. Open decisions

1. **Stats formula**. Confirm the exact WPH formula with the user.
2. **Split-task accounting** — pick from the three approaches in §4.
3. **Status vocabulary** — keep `Accepté / En cours / Terminé` or refine with user.
4. **Mandatory vs. optional task fields** — confirm with user.
5. **Categories list** — define with user.
6. **"Today" placement** in the week view — pinned-top, scroll-to, sticky header, etc.
7. **Holiday data source** — manual entry only, or seed with statutory holidays per region? Quebec stat holidays as a default suggestion?
8. **Performance-review export format** — CSV vs. PDF vs. shareable read-only link.

**Resolved**: database = Turso + Drizzle; auth = owner-managed (see §3).

---

## 11. Questions to bring to the user

(Placeholder — we'll build the full list once the spec stabilizes a bit more.)

Initial seed:
- What does the WPH formula actually look like, in their own words or on a throughput review?
- What task categories does the user use? Which ones should be excluded from WPH stats?
- Which fields are mandatory on every task, and which the user only fills in sometimes?
- How does the user currently handle a task split across two days for word-count purposes?
- What does the user want to see when they open the app on Monday morning? On Friday afternoon?
- Day length: always the same, or does it vary by client / contract?
- Does the user want to log non-work events (vacation, sick day, training)? If so, do those count toward day totals?

---

## 12. Admin panel

Owner-only area for managing users. Protected by a role check on the session (`role: 'admin'`).

Access is gated by `users.role === 'admin'` on the session. Non-admins never see the panel and the admin API routes reject them (403). Role-based permissions are coarse for v1 — just `admin` vs `user` — but the check lives in one guard so finer roles can be added later.

### Onboarding flow (end to end)

1. **Admin opens the user-management page** (admin-only route). Lists all users with email, name, role, status (active / deactivated / pending-onboarding), created date.
2. **Admin invites a user** by entering an email. The app:
   1. Inserts the email into `allowed_emails`.
   2. Creates a stub `users` row (email only — `first_name` / `last_name` / `password_hash` all null, `role = 'user'`).
   3. Sends a **bilingual invitation email** via Resend. Copy (FR + EN both shown):
      > *Vous avez été invité·e à utiliser la nouvelle application de planification de traduction d'Alexandre Gilbert.*
      > *You have been invited to use Alexandre Gilbert's new translation planning app.*
      followed by the **login link** (magic link).
3. **First login (magic link)** — the invited user clicks the link, gets a session, and is dropped on an **unskippable onboarding form** (modal/overlay that re-opens until submitted, blocks the dashboard). Fields:
   - First name
   - Last name
   - Password (with confirm)

   On submit: set `first_name`, `last_name`, hash the password into `password_hash`. From then on the user logs in with **email + password**; the magic link is no longer their entry point.

### Deactivate / reactivate

- **Deactivate** — sets `deactivated_at`. The user stays in `allowed_emails`, but both the password-login and magic-link handlers check `deactivated_at` and reject with a specific message shown on entering their email / credentials:
  > *Votre compte a été désactivé. Contactez l'administrateur.*
  > *Your account has been deactivated. Please contact the administrator.*
  Their data is preserved.
- **Reactivate** — clears `deactivated_at`.

### Admin routes (planned)

```
server/api/admin/
  users/
    index.get.ts          ← list all users
    index.post.ts         ← invite a new user (allowlist + stub row + email)
    [id].patch.ts         ← deactivate / reactivate / change role

server/api/onboarding/
  complete.post.ts        ← set first/last name + password_hash for the current user
```

All protected by the admin-role guard (except onboarding, which is any authenticated user whose onboarding is incomplete).

---

## 13. Profile menu (header popover)

The avatar in the header opens a popover — the single entry point for account info, navigation, and session actions. Replaces the current minimal dropdown (Profile / Language / Logout). Order, top to bottom:

1. **Identity header** *(non-interactive)* — avatar, full name, and email of the signed-in user. Reads `firstName` / `lastName` / `email` from the session and `avatar_url` for the image; falls back to initials when no avatar is set (the existing `UAvatar` behavior).
2. **Profile** — links to the user's own profile page (view / edit name, avatar, change password). Page itself TBD.
3. **Manage users** — **admin only** (`role === 'admin'`). Links to the admin user-management panel (§12). Hidden entirely for non-admins, never just disabled.
4. **Language** — switches locale. With two locales (FR/EN) it toggles to the other and shows the active one; becomes a submenu if a third locale is ever added. Persists to `settings.locale` (i18n-first, §2).
5. **Settings** — links to the settings page (per-user preferences: daily work minutes, working days, default WPH, timezone — §4).
6. **Sign out** — clears the session and returns to the sign-in page.

Notes:
- Grouped with separators: *identity* — *Profile, Manage users* — *Language, Settings* — *Sign out*. Exact grouping TBD in build.
- Built with Nuxt UI (`UDropdownMenu`) per component priority. Icons: Carbon (`i-carbon-*`).
- Every label is an i18n key (FR default), copy verified (§2 non-negotiable). French uses a space before `? ! : ;`.
- Items that link to not-yet-built pages (Profile, Manage users, Settings) can ship as the pages land; Identity, Language, and Sign out work today.

---

## 14. Out of scope (for v1)

- Team / multi-translator collaboration.
- Invoicing or client-facing exports.
- Time-tracking via running timer (only manual duration entry).
- Mobile-first design (responsive yes, mobile-native no).
- Notifications / reminders.
- Integration with an agency TMS or job-assignment system.
