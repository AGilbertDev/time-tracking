# TODO — pick up here

Working state as of **2026-05-31**. Read this with [`spec.md`](./spec.md). The original-app reference is [`concept.md`](./concept.md).

## How to work on this repo

- **Pipeline-driven now, not tutorial mode.** This repo is the proof of concept for the multi-agent pipeline. Build one feature at a time through the full pipeline (specs, design, build, review, commit). See [`AGENTS.md`](../AGENTS.md) and [`docs/pipeline.md`](./pipeline.md). Tutorial mode is retired here.
- **Comment style**: end every comment with a period; no dashes or colons in comments — full sentences.
- **Copy quality is non-negotiable** (the user is a translator). Every visible FR/EN string must be correct. French uses a space before `? ! : ;`.
- **Component priority**: Nuxt UI → Nuxt → Tailwind. No custom CSS unless unavoidable. Icons: Phosphor (`i-ph-*`), brand icons via Simple Icons.
- **Backend conventions** live in the portfolio repo: `AGilbertDev/my-portfolio` → `docs/backend-standards.md` (thin route files, handlers in `handlers/`, Zod models in `server/models/`, `sendZodError`, validate every route).
- **Git**: commit/push only when asked. Push as the **AGilbertDev** gh account (`gh auth switch --user AGilbertDev`, set git user, then switch back to AlexHubelia after). Husky runs eslint + prettier on commit.
- **Restart the dev server** after any `nuxt.config.ts` i18n/route change (HMR does not pick those up). The owner runs the dev server.

## Done

- App shell, layouts, brand theme, font, logo, favicon, i18n FR/EN, language toggle.
- Turso + Drizzle schema and migrations (`bunx drizzle-kit push`).
- Full auth: magic-link invite, password login, onboarding, password policy + breach check, roles + deactivation fields, session, middleware gates.
- Owner seed script. Deployed to Vercel at `time-tracker.agilbert.dev`.
- Theming: 8 atmospheres via `[data-theme]` tokens in `main.css`, `useTheme` composable (independent light/dark picks), sun/moon color-mode toggle in the nav, theme pickers in the profile dropdown, dynamic theme-colored logo (inline SVG) and favicon. Default `pastel` (Seafoam light, Ocean dark).
- Persist user preferences: theme and language now live on the `settings` row as the source of truth and follow the user across devices, resolved server-side for no flash on first paint. Built through the pipeline, spec at [`docs/specs/settings/preference-persistence.md`](./specs/settings/preference-persistence.md), Feature 2 in [`docs/pipeline.md`](./pipeline.md). Shipped as PR #1, and the migration is applied against the production DB (verified 2026-07-19: the `settings` preference columns exist and `users.locale` was dropped).
- Profile menu — header popover (spec §13): the header avatar dropdown is now the full grouped account popover (identity block, Profile, Settings, admin-only Manage users, the atmosphere theme picker, Language, Sign out). `role` is surfaced on the session so the admin item gates on it, and Profile, Settings, and Manage users link ahead to their final localized routes (the pages themselves are separate later features and 404 until built). Built through the pipeline as the first fully sandboxed autonomous run, spec at [`docs/specs/settings/profile-menu-popover.md`](./specs/settings/profile-menu-popover.md), Feature 3 in [`docs/pipeline.md`](./pipeline.md). No migration was needed. Two copy strings still need the owner's final read, the French `header.manageUsers` wording and the two accessibility labels.

## Next up (in rough priority order)

### 1. Admin user-management panel (spec §12)

Owner-only (`role === 'admin'`). Lets the owner invite, deactivate, reactivate users.

- [ ] Decide route + layout (e.g. `/admin` page, admin-only). Localize the route in `nuxt.config` `pages` map.
- [ ] Guard: extend the global middleware (or a dedicated one) so non-admins can't reach admin pages; admin API routes reject non-admins with 403. Consider building `server/utils/defineAdminEventHandler.ts` (wraps `requireUserSession` + role check) — mirrors the standards doc's `defineAuthenticatedEventHandler`.
- [ ] `server/models/admin.ts` — Zod schemas (invite body, patch body).
- [ ] `server/api/admin/users/index.get.ts` — list users (email, name, role, status: pending/active/deactivated, created).
- [ ] `server/api/admin/users/index.post.ts` — invite: insert `allowed_emails` + stub `users` row + send bilingual invitation email (reuse `magic-link/handlers/request` logic or a shared sender). Invitation copy is in spec §12.
- [ ] `server/api/admin/users/[id].patch.ts` — deactivate (set `deactivated_at`) / reactivate (clear it) / change role.
- [ ] Admin page UI: `UTable` of users + actions; an invite form (email).
- [ ] i18n keys for the admin UI (FR/EN).
- Note: the magic-link `verify` handler currently does find-**or-create**. Once invite always creates the stub row, tighten it to find-**or-reject** (a valid invitee always has a row). See spec §4.

### 2. Planning week view — the core app (spec §6, §7)

The dashboard (`app/pages/index.vue`) is an empty placeholder. This is the heart of the product.

- [ ] Tasks schema in `server/db/schema.ts` (not yet created). Pull fields from `concept.md` (client, project, delivery date/time, word count, category, estimated/actual duration, status, instructions, exclude-from-stats) + ties to `users`. Confirm mandatory vs. optional fields with the primary user first (spec §11).
- [ ] Week view: Mon–Fri by default but **flexible working days** per user settings; days stacked vertically; today prominent (placement TBD, spec open decision #6); week switcher.
- [ ] Task CRUD API (routes + handlers + Zod models, per backend standards).
- [ ] Task interactions: inline expand-to-edit, status cycle on click, drag-and-drop across days, copy-paste, delete.
- [ ] Estimated duration auto-calc (wordCount / quota, rounded to 5 min); actual auto-syncs until edited.

### 3. Settings page (spec §4)

- [ ] `settings` table already exists (daily_work_minutes, work_days, quota_wph, and now light_theme/dark_theme/locale). Build the API + a settings page so the user can edit daily work duration, working days, default WPH quota, holidays.
- Note: theme and locale persistence already shipped (Persist user preferences, see Done). This item is now only the settings *page* for the work-related fields.

### 4. Stats (spec §5)

- [ ] Corrected WPH (group by project, max words per project) for day / week / month / year. Confirm the employer's exact formula with the primary user first (open decision #1).

### Smaller follow-ups

- [ ] Forgot-password flow (magic link → reset form; spec §3).
- [ ] Expired `magic_link_tokens` cleanup — Vercel Cron when it matters (spec §3).
- [ ] Set `NUXT_SITE_URL` on Vercel to the production URL (verify it's set so prod magic links don't point at localhost).
- [ ] Wire `favicon.svg` in `nuxt.config` head if we want the adaptive favicon over the `.ico`.

## Open questions for the primary user (spec §11)

Employer's exact WPH formula · task categories (which are excluded from stats) · mandatory vs. optional task fields · how split-across-days tasks should attribute word counts · day-length variability · whether to log non-work events (vacation/sick/training).
