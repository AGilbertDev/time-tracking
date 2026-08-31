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
- Theming: redesigned to 5 deliberate, subject-grounded themes via `[data-theme]` tokens in `main.css`, each with a primary and a distinct accent (`--ui-color-secondary-*`, consumed by Nuxt UI's `secondary` alias): `pastel` (teal + lilac, default), `encre` (ink blue + teal), `cafe` (espresso + caramel), `automne` (burnt orange + maple red), `foret` (pine green + plum). `useTheme` composable keeps independent light/dark picks, sun/moon color-mode toggle (3D flip) in the nav, theme picker in the account popover, dynamic theme-colored logo (inline SVG) and favicon. Replaces the old 8 atmospheres (`ember`/`onyx`/`coffee`/`forest`/`autumn`/`berry`/`frost`). Built through the pipeline, spec at [`docs/specs/appearance/theme-system.md`](./specs/appearance/theme-system.md), Feature 4 in [`docs/pipeline.md`](./pipeline.md). Migration `server/db/migrations/0001_remap_theme_ids.sql` remaps stored ids (`coffee`→`cafe`, `forest`→`foret`, `autumn`→`automne`; removed themes → `pastel`), with `coerceThemeId` as the runtime fallback. **The migration still needs manual application against the production DB** (no DB creds in the sandbox); until it runs the new default and remap do not take effect in prod.
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

- [ ] Tasks schema in `server/db/schema.ts` (not yet created). Pull fields from `concept.md` (client, project, delivery date/time, word count, category, estimated/actual duration, status, instructions, exclude-from-stats) + ties to `users`. Confirm mandatory vs. optional fields with the user first (spec §11).
- [ ] Week view: Mon–Fri by default but **flexible working days** per user settings; days stacked vertically; today prominent (placement TBD, spec open decision #6); week switcher.
- [ ] Task CRUD API (routes + handlers + Zod models, per backend standards).
- [ ] Task interactions: inline expand-to-edit, status cycle on click, drag-and-drop across days, copy-paste, delete.
- [ ] Estimated duration auto-calc (wordCount / quota, rounded to 5 min); actual auto-syncs until edited.

### 3. Settings page (spec §4)

- [ ] `settings` table already exists (daily_work_minutes, work_days, quota_wph, and now light_theme/dark_theme/locale). Build the API + a settings page so the user can edit daily work duration, working days, default WPH quota, holidays.
- Note: theme and locale persistence already shipped (Persist user preferences, see Done). This item is now only the settings *page* for the work-related fields.

### 4. Stats (spec §5)

- [ ] Corrected WPH (group by project, max words per project) for day / week / month / year. Confirm the exact formula with the user first (open decision #1).

### Smaller follow-ups

- [ ] Forgot-password flow (magic link → reset form; spec §3).
- [ ] Expired `magic_link_tokens` cleanup — Vercel Cron when it matters (spec §3).
- [ ] Set `NUXT_SITE_URL` on Vercel to the production URL (verify it's set so prod magic links don't point at localhost).
- [ ] Wire `favicon.svg` in `nuxt.config` head if we want the adaptive favicon over the `.ico`.
- [ ] **Confidentiality wording in [specs/planning/overview.md](specs/planning/overview.md), owner's decision, raised twice.** The heading at line 126 reads "the real quotas, from the user" and line 128 calls them the user's working categories and actual numbers, line 150 describes an employee's translation against a contractor's, line 160 names specific work a person did, and line 266 attributes the defaults to actual numbers again. The convention says workplace figures ship as ordinary configurable defaults with no provenance attached, and that a third party's internal workings are not ours to publish. This branch did not introduce it and does not touch that file. Two things need deciding: the wording, and whether the git history is worth rewriting, since scrubbing the tree fixes the present only. It is recorded here rather than left in a pull request body because it was raised in [#38](https://github.com/AGilbertDev/time-tracking/pull/38), merged unanswered, and then found again by a later compliance review. Note that renaming the heading breaks three anchors in `per-category-quotas.md`, so do both in one pass.
- [ ] **`UApp` has no `:locale`**, so `useLocale` falls back to English and every Nuxt UI string that is not authored in this repo announces in English on a French-default page. Two surfaces are known. Every `UInputNumber` announces `aria-label="Increment"` and `aria-label="Decrement"`. Every `UModal` close button announces the English dismiss label, which now includes the admin onboarding reset's confirmation dialog and the shared confirmation modal on `app/pages/admin/users.vue`. The list is almost certainly longer, because the fallback is one setting rather than one component, so the fix is to wire the locale rather than to patch each control. Wiring `@nuxt/ui/locale`'s `fr` changes Nuxt UI's visible strings app-wide, so it wants its own small feature rather than riding along. Widened from the `UInputNumber` case by the accessibility read of the admin onboarding reset.
- [ ] **Input boundary contrast fails 1.4.11 app-wide.** An input is `bg-default` inside a `bg-default` card, so its `ring-accented` border is the only thing identifying it as a control, and that ring measures 1.71:1 in pastel light and 1.20:1 in pastel dark against a 3:1 requirement, worst 1.10:1 across the five themes. This is Nuxt UI's default on every input, so it is a theme decision rather than a bug in any one screen.
- [ ] **No skip link anywhere** (WCAG 2.4.1), which the styling conventions require. `UMain` renders `<main>` with no `id`, so there is no target either, and it needs a researched Québécois string for "skip to the main content".
- [ ] **Prettier fails on 19 committed documentation files** on `main`, pre-existing and unenforced since `lint-staged` covers only `js`, `ts` and `vue` and there is no CI workflow. Fixing it reflows 19 unrelated documents, so it wants its own change.
- [x] ~~**Decide whether `tasks.quota_wph_override` survives.**~~ Decided, it stays. Under the snapshot model it is no longer a second way to say the same thing, it is where the figure actually lives, since the server writes the resolved quota onto the task at creation and at recategorisation. What is still open is narrower and belongs to the stats engine, which has to read the task's own figure first and fall back to the category's current row only when the task carries none.
- [x] ~~**`settings.quotas.userSince` renders `1 août` where French wants `1er août`.**~~ Void rather than done. The snapshot model approved on 2026-08-24 takes the effective date off the screen, so the string is renamed `settings.quotas.userValue` with no date parameter and the formatter is deleted rather than corrected. Recorded rather than removed, because the underlying trap is real and will return the day any French date reaches a screen: `Intl.DateTimeFormat` produces no French ordinal at any `dateStyle`, and the fix is `formatToParts` plus `Intl.PluralRules` with `type: 'ordinal'`, since `fr-CA` returns `one` for 1 and `other` for everything else, which is exactly the French rule.

- [ ] **An admin resetting somebody else's onboarding.** The admin onboarding reset
      ([specs/admin/onboarding-reset.md](specs/admin/onboarding-reset.md)) is deliberately self-only, because
      the owner asked for their own and because an endpoint with no target parameter has nothing to aim at
      the wrong account. Aiming it at another user is a feature rather than a parameter. It needs a validated
      target and a rule for the acting admin's own row, a way to reach the target's live session, which does
      not exist today since sessions are stateless signed cookies and only the deactivation check in
      `server/middleware/validate-session.ts` revokes one, and an audit record, since silently wiping another
      person's configuration is a different act from wiping your own.
- [ ] **Nothing in the app writes `work_schedule`.** The effective-dated history table exists, is read by
      `server/utils/loadWorkSchedule.ts` and resolved by `resolveSchedule`, and the only insert anywhere in
      `app/`, `server/`, `shared/` or `scripts/` is in `scripts/seed.ts`. So the capacity denominator for a past
      date answers from a development fixture or from `DEFAULT_SCHEDULE`, never from anything the user entered.
      Either the settings page starts writing a new record when the work hours or work days change, or the table
      is retired in favour of the live settings row. Found while speccing the admin onboarding reset, which had
      to decide whether a reset clears the table and could only answer it by establishing that the rows are a
      fixture rather than reported history.
- [ ] **A live session elsewhere keeps a stale `onboarded` flag after a reset.** The flag lives in the
      sealed session cookie and is set at the three session-creation sites and by the reset endpoint, so an
      admin signed in on a second device keeps `onboarded: true` there until that session is renewed by a
      fresh sign-in. Nothing breaks and it resolves on the next sign-in, so it is a limitation rather than an
      invalid state. The fix is small and its blast radius is not:
      `server/middleware/validate-session.ts` already selects the `users` row on every authenticated request,
      so it would add `onboarded_at` to that select and reconcile the session flag against it. That runs on
      every authenticated request in the application, which is much wider than the feature that found it.
      Found while speccing the admin onboarding reset
      ([specs/admin/onboarding-reset.md](specs/admin/onboarding-reset.md)).
- [ ] **Re-running the onboarding wizard forces a password re-entry.** `CompleteOnboardingSchema` requires a
      password and the wizard's identity step always starts empty, so an admin who resets their onboarding has
      to type a password again and whatever they type becomes their password. The reset itself never touches
      the hash, so an abandoned reset is safe and the old password keeps working; only pressing Finish changes
      it. The admin onboarding reset discloses this in its confirmation copy rather than engineering it away,
      because making the password optional means the wizard grows two modes across the schema, the identity
      step's gating, and the completion handler. Reversing it later is additive, since it is one Zod field
      relaxed to optional plus skipping the hash write when it is absent.
      Added by the compliance review of that feature, because the re-entry has a security shape the entry
      above only describes as an inconvenience. `server/api/me/handlers/changePassword.ts` will not change a
      password without the current one. `server/api/onboarding/handlers/complete.ts` will, because it is the
      initial-set path and its only guard is now `users.onboarded_at`. Between a reset and the wizard's Finish
      an account therefore holds a password while `onboarded_at` is null, and in that window anyone holding a
      live session cookie for that account can set a new password without knowing the old one, and overwrite
      the first and last name at the same time. That turns a temporary session compromise into permanent
      takeover of an admin account, where before this feature the 409 on `password_hash` closed the door. The
      window is opened only by a deliberate action, is expected to last seconds, is shut in production by the
      default runtime switch, and the real owner keeps a working password until Finish, so this is a narrow
      exposure rather than a live hole. It is recorded because relaxing the password to optional, which is
      what the entry above already prices, happens to close it, and because whoever does that work should
      know it is the reason rather than a side effect.
- [ ] **Migration 0006's idempotency note describes a runner this project does not have.** Its header says the
      `ALTER TABLE ADD COLUMN` "is applied through a runner that tolerates the benign duplicate column name
      error and continues, which makes a re-run safe". `scripts/apply-migrations.ts` tolerates no error at all;
      it throws and leaves the file unrecorded. The real guard is the ledger, which is what 0007, 0008 and 0011
      correctly say. 0006 has been applied, and the rule is that an applied migration file is never edited, so
      this is recorded rather than fixed. It matters because the wording gets copied into new files. Found
      while speccing the admin onboarding reset, whose own migration headers deliberately do not repeat it.
- [ ] **No CSRF hardening on authenticated mutations, project-wide.** Every write endpoint is a cookie-bearing
      `POST` or `PATCH` with no token and no origin check, relying on whatever `SameSite` default
      `nuxt-auth-utils` sets. That is not a defect introduced by any one feature and it is not any one feature's
      to fix, so it wants its own pass across every mutating route rather than a bespoke guard on the newest one.

- [ ] **`ADD COLUMN` and `DROP COLUMN` migrations here are protected by the ledger rather than by the
      statement.** SQLite has no `IF NOT EXISTS` on either, so a migration that adds or drops a column
      cannot guard itself and relies entirely on `_applied_migrations` in `scripts/apply-migrations.ts`
      to not be executed twice. That protection holds only while every run reaches the ledger insert. A
      run that applies the statement and then fails before recording it leaves a file that is still
      pending by the ledger's reckoning and can never be applied again, because the second attempt hits
      `duplicate column name` and the runner throws. Recovering from that needs manual intervention,
      either recording the file by hand or baselining, and the operator has to work out which of those
      is correct by reading the schema.
      The backend conventions offer two ways to close this and this project uses neither. Guard the
      statement with `PRAGMA table_info` first, which plain SQL cannot express conditionally, so the
      branch has to live in the runner. Or run through a runner that catches the benign
      `duplicate column name` error and continues. This project's runner tolerates no error at all,
      which is a deliberate choice argued in its own header, because an earlier draft inferred
      "already applied" from an error string and would have replayed `0000`, a data migration that
      fails destructively on a second run. So the honest position is that these migrations are as
      idempotent as the tooling permits, and closing the gap properly means changing the runner rather
      than the migrations.
      Recorded on the accepted basis rather than as a defect to fix in passing. `0012` was reviewed
      against this and accepted as it stands, and `0007`, `0008` and `0011` already rely on the same
      arrangement. The entry exists so this is not re-argued on the next `ADD COLUMN`. It pairs with
      the `0006` entry above, which is the same gap wearing a worse comment.

- [ ] **The app has no legal pages and no compliance record, and it is live on a public domain.** There is no
      `/legal/privacy`, no `/legal/terms`, no account-deletion page, and no `COMPLIANCE.md`, in either
      language. The app is invite-only and authenticated, which limits who sees it but changes nothing about
      what it holds, which is a real person's name, email address, password hash, working hours, working days,
      timezone, and free-text notes about their work. That is personal information collected by technological
      means by a Québec enterprise, so Law 25 wants a privacy policy published in clear terms, a designated
      privacy officer with published contact details, and an assessment of the transfer outside Québec, which
      is unavoidable here because Vercel, Turso, and Resend all store it elsewhere. PIPEDA and GDPR want the
      same disclosures under different names. The Charter of the French Language then requires the French
      version to be at least as prominent, which is easy in this project because French is already the default
      locale. None of this is any one feature's to fix and it is not a blocker for the admin onboarding reset,
      which collects nothing new. It is its own pull request, and it is the largest open compliance gap in the
      repository. Found by the compliance review of the admin onboarding reset.
- [ ] **`defineAdminEventHandler` trusts the role in the session cookie, which nothing reconciles.**
      `server/middleware/validate-session.ts` re-reads the `users` row on every authenticated request and
      checks only `deactivated_at`, so a role changed in the database does not reach a live session until that
      session is renewed. An admin demoted to `user` keeps every admin route until they sign in again.
      `server/api/me/handlers/getMe.ts` gets this right and derives `canResetOnboarding` from the stored role
      it just read, which is worth copying rather than the other way round. The fix is one more column on the
      select that middleware already runs, so it costs a query nothing extra, and it lands in the same file and
      the same select as the stale `onboarded` flag entry above, which makes the two one piece of work rather
      than two. Project-wide and pre-existing, so recorded rather than fixed in a feature that only reuses the
      wrapper. Found by the compliance review of the admin onboarding reset.
- [ ] **Confidentiality question for the owner, in `docs/specs/admin/onboarding-reset-design.md` line 556.**
      The sentence reads that a longer copy set is "a copy set the owner then has to review as a translator
      rather than as an owner", which states the owner's profession in a public repository. The standing rule
      allows describing whoever is behind the project by role, and "a professional translator" is the example
      it gives, so the wording in the spec at `docs/specs/admin/onboarding-reset.md` line 893 is fine. This one
      is different because it attaches the profession to the owner, who is identifiable from the repository
      itself. If the owner is describing their own work then there is nothing to fix and this entry closes. If
      the translator is somebody else, the sentence merges two people and should say "as copy rather than as
      design". Raised rather than edited, because the answer is the owner's, and written down here rather than
      only in the pull request so it outlives the branch whichever way it goes. Note that the git history keeps
      whatever ships, so a later edit fixes the working tree and not the past.

- [ ] **The test harness re-declares production truth in a second place, and it has drifted twice in one feature.**
      `test/helpers/taskTestDb.ts` re-declares the database schema as inline DDL, and
      `test/helpers/nitroGlobals.ts` re-declares the Nitro auto-import surface the server handlers call as
      free identifiers. Both are second copies of something the application already owns, which the
      conventions forbid precisely because the copy that drifts is the one whose results stop meaning
      anything. The admin onboarding reset hit both. Migration 0012 added `users.onboarded_at` and the
      harness DDL lagged it; the runtime switch added a `useRuntimeConfig()` call and the stub set lagged
      that. Neither break was a lapse of care, both are the same structural defect.
      Three candidate fixes, cheapest first, none built here because they are general test infrastructure
      that defends every future feature rather than this one, and one feature per pull request.
      **One.** A test that applies every file in `server/db/migrations/` in filename order to an in-memory
      database, then compares `PRAGMA table_info` for each table against the harness's own DDL and fails on
      any column present in one and absent in the other. That retires the schema-lag class permanently and
      costs one file. The machinery already exists and is already doing most of this in
      `test/server/db/migrations/onboarded-at.test.ts`, which runs the real migration text against real
      in-memory SQLite, so this is mostly assembly rather than new work.
      **Two.** The same idea for the auto-import surface: a guard that scans `server/api/**` for known Nitro
      and nuxt-auth-utils auto-imports and asserts each one appears in `installNitroGlobals`. That would have
      failed the moment `useRuntimeConfig()` landed in the reset handler, before any suite exercised it.
      **Three, and the part most likely to be forgotten.** Neither break was detectable by asking whether the
      tests passed, because in both cases they did. The suite stayed green because no test exercised the
      changed path, so the signal was collection-level rather than pass/fail: the count of tests and files,
      compared against a baseline taken before the change. That is why baselining the counts before a stage
      and comparing after it is load-bearing here rather than a habit, and it belongs written down as a rule.
      A green suite that collects fewer tests than before is a false clean, not a pass.
      Found while writing the unit tests for the admin onboarding reset, after the second occurrence.

- [ ] **Every `error`-coloured control in the app fails WCAG 1.4.3 in light mode.** Measured on the two
      controls the admin onboarding reset adds, but neither the cause nor the blast radius is that
      feature's. The `subtle` Reset button's label measures 3.31:1 against its own tinted background and
      the `solid` confirm button measures 3.82:1 against its fill, where 1.4.3 wants 4.5:1 for text at
      these sizes. Both are ordinary-weight text well under 18.66px, so the 3:1 large-text allowance does
      not apply.
      The cause is the light-mode `--ui-error` anchor sitting on step 500. `app/app.config.ts` sets
      `error: 'red'` and nothing in the repo pins the step, so the fix is one declaration alongside the
      `--ui-color-primary-*` block already in `:root` in `app/assets/css/main.css`:
      `--ui-error: var(--ui-color-error-700);` for light only, leaving dark alone, which already passes.
      That measures 5.33:1 for the subtle label and 6.42:1 for the solid confirm. `red-600` was measured
      and rejected at 3.99:1, which still fails, so the step has to go to 700 rather than to the next one
      along.
      **Not this feature's to apply.** There are eleven `color="error"` call sites across six files, and
      `app/pages/admin/users.vue` already ships a solid error confirm at the same 3.82:1 and a ghost
      deactivate button on the same label colour, so the defect predates this branch. Changing the token
      repaints every error control in the application, including the destructive actions on the task
      editor, the profile page and the dashboard, so it is its own change with its own visual pass and
      its own decision from the owner rather than a line smuggled into a feature branch.
      **One measurement wants confirming in a browser before the change lands.** The audit could not read
      the concrete `--ui-error: var(--ui-color-error-500)` declaration in this repository, because Nuxt UI
      emits it through a virtual module rather than into any file under source control, so the 500 anchor
      is inferred from the module's documented default rather than observed. The numbers above follow from
      it. One devtools read of the computed `--ui-error` on a rendered page settles it, and it should
      happen before anybody trusts the figures rather than after.
- [ ] **A toast fired while a modal is still open is never announced.** Same root cause as the fix already
      applied to the reset success path in `app/pages/settings.vue`. `UModal` calls reka-ui's
      `useHideOthers`, which sets `aria-hidden="true"` on every sibling of the dialog's ancestor chain and
      makes no exception for an `[aria-live]` element, and `UApp`'s toast viewport is a direct child of
      `body`. So any toast added while a dialog is mounted lands inside an `aria-hidden` subtree and no
      screen reader reads it. The success path was fixable in place because it navigates away, which
      unmounts the modal, and the toast simply moved after the navigation.
      **The error path has no navigation to hide behind.** It closes the dialog and toasts, and the 200ms
      exit animation means the toast is still added under `aria-hidden`. Two honest options, neither
      obviously right. Keep the dialog open on failure and render the error inside it, which announces
      correctly and also puts the message where the user's attention already is, at the cost of the dialog
      no longer always closing on a press. Or accept the gap, on the grounds that the failure is
      recoverable by pressing Reset again and the visual toast is still shown.
      Not local to this feature. `app/pages/admin/users.vue` toasts from inside its shared confirmation
      modal in the same shape, so whichever answer is chosen should be applied to both. Recorded rather
      than decided, because the first option changes a modal's dismissal behaviour and that is a product
      decision.
- [ ] **Focus lands on `body` after the onboarding reset confirms.** The confirm navigates to the
      dashboard, and the element focus would be restored to, the Reset button, unmounts with the settings
      page, so focus falls back to `body` and a keyboard user starts the next page from nowhere.
      This project already has an answer to exactly this, in `app/pages/onboarding.vue`, where the step
      heading is a `tabindex="-1"` element carrying a visually hidden step count that takes focus on every
      step change. The same treatment on a destination heading would close this.
      Recorded rather than applied because the destination is the wizard flow rather than the settings
      page, so the fix belongs to whichever page receives focus and to the wizard's own re-entry
      experience, not to the control that sends the user there. It is also not unique to this feature:
      any client-side navigation that unmounts the element focus would return to has the same gap, so it
      is worth answering once for the application rather than per button. Found by the accessibility read
      of the admin onboarding reset.
- [ ] ~~**Reduced motion on the reset confirmation dialog.**~~ Declined rather than open, and recorded so
      the question is not reopened on the next modal. `UModal`'s fade and scale on open and close are not
      vestibular motion in the sense 2.3.3 Animation from Interactions is about, and 2.3.3 is AAA where
      this project targets AA. The design document lists it as left for the accessibility stage; this is
      that stage's answer. The separate `.btn-glow` question named in the same list is app-wide and
      unrelated to this feature.

## Open questions for the user (spec §11)

The exact WPH formula · task categories (which are excluded from stats) · mandatory vs. optional task fields · how split-across-days tasks should attribute word counts · day-length variability · whether to log non-work events (vacation/sick/training).
