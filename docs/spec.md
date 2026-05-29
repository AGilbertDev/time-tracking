# Time-Tracking App — v1 Spec

First-pass spec for the rebuild. Loosely scoped — we will refine sections marked **TBD** after a working session with the primary user (the developer's partner, a professional translator).

---

## 1. Audience & purpose

A planning + productivity tool for **professional translators**. Single primary user today (the developer's partner) but built multi-user from day one so it can grow into a portfolio piece and serve other translators.

Translators are paid against a **words-per-hour quota** set by their employer. The tool's reason for existing is to (a) make daily/weekly planning low-friction and (b) surface the same WPH numbers the employer uses for performance reviews.

---

## 2. Non-negotiables

- **Copy quality**: every visible string must be **researched, verified, and accurate** — never LLM-guessed. The primary user is a translator; UI grammar/spelling errors are disqualifying. Applies to French first, English second, and any future locale.
- **i18n-first**: locale switching is a core feature, not a retrofit. Default locale: **French**. English support planned. Locale should be persisted per user.
- **Don't police the user**: the app may *signal* (holiday, exceeded daily target, working a non-work day) but never *block*. The user decides what they actually do with their time. The app records reality, not what the schedule says reality should be.

---

## 3. Architecture concepts

### DB & env pattern

- Env vars validated at startup with **Zod** via `server/lib/env.ts` — fails fast if a required var is missing.
- Drizzle client lives in `server/db/index.ts`, imports the validated env, passes `authToken: undefined` in development.
- `casing: 'snake_case'` on the Drizzle instance — JS schema uses camelCase, SQL columns use snake_case automatically.
- Schema imported directly into the Drizzle instance for query type inference.



- **Multi-user**: each user has an account; all data is scoped to the user.
- **Persistent database**: **Turso** (libSQL / SQLite at the edge) accessed through **Drizzle ORM**. Data does not live in the browser; the user can move between devices and find their data intact. Free tier: 500 databases, 9GB — one Turso account covers all projects.
- **Auth**: **owner-managed, lightweight**. Magic-link only — user submits their email, gets a one-time link, clicks it, they're in. **Resend** sends the emails.
  - Access is gated by an **allowlist table** (`allowed_emails`) in Turso. The owner adds approved addresses directly; anyone else can submit the form but never receives a link. The sign-in UI returns the same neutral confirmation message either way, so the allowlist contents aren't leaked.
  - **Owner bootstrap**: a seed/migration step reads an `OWNER_EMAIL` env var on first run and inserts that row into `allowed_emails`. Idempotent — no manual DB ritual on a fresh deployment.
  - Conceptual auth surface: `users` table, `allowed_emails` table, `magic_link_tokens` table (short TTL, single-use), two API routes (request / verify), session cookie.
  - No third-party identity providers (Clerk / Auth0 / Supabase Auth) and no identity-server backends (Kratos, Hydra, Keycloak) — simplicity is the priority. Vercel single-test-user limits and Google OAuth verification are sidestepped by construction.
- **i18n layer** in the app shell so every screen renders translated copy from a dictionary, not inline strings.

---

## 4. Domain model (conceptual)

### User
- `id` — text, primary key (nanoid or cuid)
- `email` — text, unique, not null (login key)
- `first_name` — text
- `last_name` — text
- `avatar_url` — text, nullable
- `locale` — text, default `'fr'`
- `created_at` — timestamp

Profile fields are deliberately minimal — that's the whole identity surface.

### Settings (per user)
- `user_id` — FK → users.id
- `daily_work_minutes` — integer, default `450` (= 7h30). Stored as minutes for arithmetic simplicity.
- `work_days` — text (JSON array of 0–6 day numbers, e.g. `[1,2,3,4,5]` for Mon–Fri)
- `default_wph` — integer, default `450` (words per hour)
- `timezone` — text, default `'America/Toronto'`
- TBD: theme, default task category

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

**Primary** *(working list — confirm with primary user)*:
- Client
- Project number / name
- Delivery date + time
- Word count (project total)
- Category (translation, revision, terminology, glossary update, admin, …)
- Estimated duration (auto-computed)
- Actual duration (auto-synced from estimated until the user overrides it)
- Status (e.g. Accepté / En cours / Terminé — names TBD)

**Secondary** *(working list — confirm with primary user)*:
- Project manager
- Per-task WPH quota override
- Exclude-from-stats flag
- Free-text instructions
- Recurrence config (see below)
- Split-task linkage (see below)

**Categories** are an enum we'll define with the primary user. Not every task is a translation; some categories (admin, training) may default to excluded-from-stats.

### Recurring tasks
Like Google Calendar: a task can repeat
- on selected weekdays
- starting from a date
- until a date OR forever (no end)
- with a way to detach a single occurrence (edit "this one" vs. "all future")

Recurring tasks materialize as individual day-tasks the user can still tweak independently.

### Split tasks
A single project's work can be **split across multiple days**. The user only knows the **total word count for the project**, not how many words they did each day. This creates a stats tension we have to handle deliberately:

Approaches (decide with the primary user):
1. **Time-weighted split** — divide the project's words across its day-tasks proportionally to actual time spent each day.
2. **Prompt on completion** — when the user marks the project Terminé, ask them to confirm a per-day word breakdown.
3. **Project-level aggregation** — don't try to attribute words to specific days; only aggregate WPH at week/month/year level (the corrected algorithm from the old app already does this).

The old app implicitly used (3). We should confirm what feels right for performance-review use.

### Holiday
A date marked non-working at the user level. The day still exists, the user can still log work on it. The calendar visually marks holidays but doesn't gray them out beyond a hint.

---

## 5. Stats

Goal: **match the employer's WPH formula** exactly. Whatever number the employer puts on the performance review, the app shows the same.

We need to confirm the employer's formula with the primary user. Working assumption (carried from the old app):

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

Mandatory fields enforce on save (the primary-row fields). Secondary fields are optional. Final mandatory list: **TBD with primary user**.

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

1. **Stats formula** — confirm the employer's exact WPH formula with the primary user.
2. **Split-task accounting** — pick from the three approaches in §4.
3. **Status vocabulary** — keep `Accepté / En cours / Terminé` or refine with primary user.
4. **Mandatory vs. optional task fields** — confirm with primary user.
5. **Categories list** — define with primary user.
6. **"Today" placement** in the week view — pinned-top, scroll-to, sticky header, etc.
7. **Holiday data source** — manual entry only, or seed with statutory holidays per region? Quebec stat holidays as a default suggestion?
8. **Performance-review export format** — CSV vs. PDF vs. shareable read-only link.

**Resolved**: database = Turso + Drizzle; auth = owner-managed (see §3).

---

## 11. Questions to bring to the primary user

(Placeholder — we'll build the full list once the spec stabilizes a bit more.)

Initial seed:
- What does the employer's WPH formula actually look like, in their own words / on a performance review?
- What task categories does she use? Which ones should be excluded from WPH stats?
- Which fields are mandatory on every task, and which she only fills in sometimes?
- How does she currently handle a task split across two days for word-count purposes?
- What does she want to see when she opens the app on Monday morning? On Friday afternoon?
- Day length: always the same, or does it vary by client / contract?
- Does she want to log non-work events (vacation, sick day, training)? If so, do those count toward day totals?

---

## 12. Out of scope (for v1)

- Team / multi-translator collaboration.
- Invoicing or client-facing exports.
- Time-tracking via running timer (only manual duration entry).
- Mobile-first design (responsive yes, mobile-native no).
- Notifications / reminders.
- Integration with employer's TMS or job-assignment system.
