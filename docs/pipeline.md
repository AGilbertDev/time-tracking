# The multi-agent pipeline

This project is the proof of concept for how I build software with AI agents. The product is a real translator time tracker, but the repo doubles as a working demonstration of a disciplined, multi-stage pipeline. Every feature is built one at a time, each stage handled by a specialist agent, and the commit and pull-request history is left intact so the process is visible after the fact.

This document is the source of truth for that process. The portfolio project page tells the same story in a shorter form for visitors.

## The flow at a glance

A feature moves through ten steps. Some are mine to decide, some are run by an agent, and one is automation. The design, build, and test steps run inside an isolated devcontainer sandbox so the autonomous work never touches my machine directly.

| Step | Who | What happens |
| --- | --- | --- |
| 1. Intent | Me | I decide what to build and describe it in a sentence or two. |
| 2. Specs | Agent | The `specs` agent writes a spec in `docs/specs/`. |
| 3. Spec review | Me | I confirm the spec is right before any code exists. |
| 4. Design | Agent (sandbox) | The `design` agent produces a visual blueprint. |
| 5. Build | Agent (sandbox) | The `frontend` and `backend` agents implement it, with `compliance`, `seo`, and `accessibility` passes where they apply. |
| 6. Tests | Agent (sandbox) | The `unit-test` agent writes Vitest coverage for the logic. |
| 7. Test review | Me | I review the implementation and the test results. |
| 8. Commit | Agent | The `code-review` agent reviews the diff, then the `commit` agent commits under the AGilbertDev identity. |
| 9. CI | Automation | The CI action runs on the push and reports on the pull request. |
| 10. PR review | Me | I read the pull request and merge. |

The human gates at steps 1, 3, 7, and 10 are the point. The agents do the work, but I stay responsible for intent, correctness, and the final merge.

## The devcontainer sandbox

Steps 4 through 6 are meant to run inside the devcontainer defined in `.devcontainer/`. That is a Node base image with git, Bun, and the Claude Code CLI, so an agent can design, build, and test a feature in isolation without reaching into my working environment. The sandbox is what makes "let the agents build it autonomously" safe rather than reckless.

Status as of the current pass: the flow is documented and the sandbox is installed, but the pipeline is being driven from the main environment for now. Wiring each build stage to actually execute inside the container is a tracked follow-up, not yet done. This section will be updated to past tense once real isolation is in place, so the doc never claims something the repo does not do.

## The agents

Each agent is a plain Markdown definition in `.claude/agents/agilbertdev/`, symlinked from the shared `ai-agents` repository so the same set is reused across all my personal projects. The `pipeline` agent orchestrates the rest.

### pipeline

The front door for all feature work. It routes each stage to the correct specialist, hands off explicitly at every transition, and gates the commit. It never writes code itself. Every feature starts here, one agent per stage, and an incomplete result gets sent back to its agent before the pipeline advances.

### specs

Writes the feature spec to `docs/specs/<feature-name>.md` before any code is written. The spec covers intent, inputs, outputs with acceptance criteria, edge cases, and open questions. It asks at least one clarifying question first and never writes implementation code. This stage is never skipped.

### design

Produces the visual blueprint for a feature: layout regions, component hierarchy, the specific Tailwind classes, responsive behaviour, and motion. It leans on Nuxt UI primitives first and semantic tokens throughout, never raw hex. It writes no `.vue` code. Skipped when a change has no UI.

### frontend

Implements the Nuxt pages, Vue components, and composables from the spec and the design blueprint. All user-facing copy goes through i18n with both French and English added together, colours are semantic tokens, and icon-only controls get an `aria-label`. It never writes server or database code. Skipped for backend-only work.

### backend

Implements Nitro server routes, Drizzle queries, and Zod schemas for Turso. Every input is validated at the boundary before any database call, secrets never reach the client, and handlers stay thin with logic in `server/utils/`. It never touches a `.vue` file. Skipped for pure UI work.

### compliance

Reviews a feature against Québec Law 25, GDPR, PIPEDA, the CASL and CAN-SPAM email rules, Law 101 French-language obligations, and WCAG 2.2 AA. It reports gaps ranked critical, warning, and suggestion, and it does not fix them itself. Skipped only when no personal data, auth, payment, email, or public page is involved.

### seo

Audits and implements on-page SEO: per-page title and description, Open Graph tags with absolute image URLs, JSON-LD structured data, canonical URLs, sitemap, robots.txt, and `hreflang` for the bilingual pages. Skipped for internal or admin pages not exposed to search.

### accessibility

Audits pages and components against WCAG 2.2 AA and fixes the clear, contained issues directly, reporting the architectural ones. Findings carry a file, a line, the WCAG criterion, and a severity. Icon-only controls without a label and a removed focus indicator are treated as critical. Skipped for internal-only surfaces.

### unit-test

Writes Vitest tests targeting 80 percent branch coverage for pure functions, server utilities, and composable logic. Tests sit next to the code they cover. It never mocks a pure function and never writes a test that only passes because the meaningful parts are mocked away. Skipped when a change has no logic worth testing in isolation.

### code-review

Reviews the diff for correctness, security, convention adherence, and quality before every commit. It reports findings with a file, a line, and a severity, and it never edits code during the review. Anything that could leak a secret or user data is critical. This stage is never skipped.

### commit

Commits, and pushes or opens a pull request only when asked. It verifies the git identity is AGilbertDev and runs the relevant tests first, and it refuses to commit if a test fails. It stages files by name, never with `git add -A`, and never skips hooks or force-pushes without being told to. The identity check is never skipped.

## One feature at a time

The discipline is the demonstration. A feature goes all the way from spec to merged pull request before the next one starts, so each entry in the history is a complete, reviewed unit of work rather than a pile of half-finished branches. Specs and code review are never skipped, and a failing test blocks the commit with no bypass.

## How this project was built

This section is the trail. Each feature shipped through the pipeline gets an entry here, linking its spec and its pull request, so the methodology can be read end to end without digging through git.

**Pipeline coverage.** 2 of 4 features (50 percent) have been built fully start to finish through the sandboxed pipeline. 4 of 4 (100 percent) were built agent-driven with no hand-written implementation code, from spec to commit. A feature counts toward the sandboxed figure only when every applicable stage ran through an agent inside the devcontainer sandbox, from spec to an opened pull request. Feature 1 ran the agents from the main environment. Feature 2 ran its build stages through agents in the devcontainer but was orchestrated interactively rather than as an isolated autonomous run, so it counts as agent-driven and not fully sandboxed. Its pull request was opened once the owner authenticated `gh` in the container. Feature 3 is the first fully sandboxed run, orchestrated end to end by the pipeline agent inside the devcontainer with every applicable stage delegated to a specialist and no hand-written implementation code, from spec to opened pull request. Feature 4 is the second fully sandboxed run, built the same way. Both numbers update as each feature lands and feed the story told on the portfolio. These counts are derived from the append-only ledger in [pipeline-trace.md](pipeline-trace.md), which every container updates as it lands a feature.

### Feature 1 — Visual theme rework

Bringing the app's visual identity in line with the reworked portfolio conventions. The change swaps every icon from Carbon to Phosphor and bundles the Phosphor set locally, adds the signature glow ring to the primary calls to action, gives the auth pages a faint theme-derived page glow, registers the global container padding and an oversized button size, and derives every new accent from the active theme through oklch relative color so it works across all eight atmospheres in light and dark. Spec and design blueprint at [docs/specs/appearance/visual-theme-rework.md](specs/appearance/visual-theme-rework.md).

Stages run: specs, design, frontend, accessibility, code review, commit. Compliance, SEO, and unit tests were skipped because nothing about data handling, search surface, or business logic changed. Verification confirmed the icons render, the app boots, and lint and the accessibility pass are clean; the look across the eight atmospheres is a manual eyeball at `localhost:8080`. This first run was driven from the main environment rather than the devcontainer sandbox, which is the tracked next step for the process itself.

### Feature 2 — Persist user preferences

Making the user's account the source of truth for the theme and language picks so they follow the user across devices instead of living in browser cookies. Theme (light and dark atmospheres) and locale now persist on the `settings` row, carried in the `nuxt-auth-utils` session and resolved server-side so the correct atmosphere is in the initial HTML with no flash on first paint. The server injects the resolved `data-light-theme` and `data-dark-theme` ids onto the `html` element, and a small inline pre-paint script reads those to resolve the one thing the server cannot know, the `system` color mode. One `/api/me/preferences` endpoint reads and writes all three fields, and `users.locale` was retired since nothing read it. A follow-up pass dropped an earlier `ui-theme-*` cookie mirror after it caused a flash, and a web-sourced research review confirmed the resulting design matches accepted flash-free practice (see [docs/research/theme-language-persistence.md](research/theme-language-persistence.md)). Spec and design blueprint at [docs/specs/settings/preference-persistence.md](specs/settings/preference-persistence.md).

Stages run: specs, design, backend, frontend, unit tests, code review, commit. The spec was written interactively with the owner rather than delegated, and its four resolved decisions are recorded in it. Code review found three issues, a broken out-of-scope header row, a double write per theme pick, and a missing fallback for a removed theme id, all fixed by the agents before commit. Compliance, SEO, and accessibility were skipped: no new personal data beyond the user's own settings and the cookies are strictly-necessary functional cookies, nothing public or search-facing changed, and no interactive UI was added or changed beyond a Nuxt UI toast that is accessible by default. The unit-test stage also bootstrapped the repo's first vitest setup and covers the validation schema and the theme and locale coercers, with 33 tests passing. Verification: typecheck, lint, and the unit suite are all clean. The Drizzle migration is written but not applied, since the sandbox has no database credentials, so applying it remains an owner step. The pull request ([#1](https://github.com/AGilbertDev/time-tracking/pull/1)) was opened after the owner installed and authenticated `gh` in the container. This run was orchestrated interactively in the devcontainer rather than as an isolated autonomous sandbox run, so it counts as agent-driven but not fully sandboxed. For honesty, two pre-existing header bugs surfaced during live testing, a slot that nested an anchor inside an anchor and a timezone-dependent greeting, and were fixed by hand rather than through the pipeline. They are a bugfix, not part of the persistence feature, so they are not counted as feature work in the ledger.

### Feature 3 — Profile menu header popover

Expanding the header avatar dropdown into the full account popover from spec section 13. The single menu is now grouped with separators into an identity block (avatar, full name, and email read from the session), a navigation group (Profile, Settings, and an admin-only Manage users item), a preferences group (the eight-atmosphere theme picker and the language toggle), and Sign out. The admin item is gated on a new `role` field surfaced on the `nuxt-auth-utils` session, sourced from the trusted `users` row at every live session-creation site, and it is absent from the DOM for non-admins rather than merely hidden. Profile, Settings, and Manage users link ahead to their final localized routes even though those pages are not built yet, so they cleanly 404 until later features land. The build reconciled two disagreements between the written spec and the code, the theme picker that section 13 omits but the code carries stays and joins the preferences group, and the icons resolve to Phosphor rather than the section's Carbon mention. Spec at [docs/specs/settings/profile-menu-popover.md](specs/settings/profile-menu-popover.md).

Stages run: specs, design, backend, frontend, compliance, accessibility, unit tests, code review, commit. SEO was skipped because no new public page ships in this feature, only link-ahead items whose destination pages are out of scope. Compliance passed and recorded one forward-looking requirement, the future admin routes and pages must enforce their own server-side role authorization since the client-side hide is a UI affordance and not a security boundary. Accessibility found and fixed two real defects, the trigger button had no accessible name for a user with no name set, now a `username` then email then static-label fallback chain, and the active atmosphere was signalled by a decorative check icon only, now carried by a visually-hidden label. The unit-test stage extracted the popover's pure logic into `app/utils/account.ts`, following the repo's existing testable-helper pattern, and covers the admin gate, the initials and name derivations, the trigger fallback chain, and the link-ahead route map, bringing the suite to 62 passing tests. Verification: lint and the full unit suite are clean, and code review passed with nothing to fix. `nuxi typecheck` could not run in the sandbox because of a vue-tsc and TypeScript tooling mismatch, so the types are left for CI to confirm at the pull-request gate. No database migration was needed, the change adds a field to the session payload only and `role` already exists on the `users` table. This is the first feature orchestrated end to end by the pipeline agent as an autonomous sandbox run, every applicable stage delegated to a specialist with no hand-written implementation code, so it is the first entry to count as fully sandboxed. Two copy strings need the owner's final read before the feature is closed, the medium-confidence `header.manageUsers` French wording and the two accessibility strings, all recorded in the spec and surfaced on the pull request.

### Feature 4 — Theme system redesign

Replacing the eight loosely-themed atmospheres with five deliberate, subject-grounded themes for a translator's tool, each with a matched light and dark rendering under one name and, new here, a primary and a distinct accent chosen as a colour-harmony pairing. The five are `pastel` (teal seafoam with a lilac accent, the default), `encre` (ink blue with a teal accent), `cafe` (espresso with a caramel accent), `automne` (burnt orange with a maple-red accent), and `foret` (pine green with a plum accent). Each accent is wired per theme as a `--ui-color-secondary-*` ramp so Nuxt UI's `secondary` alias renders the pairing. The data layer gains an idempotent migration, `0001_remap_theme_ids.sql`, that remaps stored ids (`coffee` to `cafe`, `forest` to `foret`, `autumn` to `automne`, and the removed `ember`, `onyx`, `berry`, and `frost` folded to the `pastel` default), with `coerceThemeId` as the runtime backstop so any invalid stored value still resolves to the default before it reaches `<html data-theme>`. The feature also brings a few owner-approved portfolio-aligned touches, the 3D flip kept on the colour-mode toggle, a logo hover-scale, vertically centred nav, and dynamic hover effects, while deliberately not copying the portfolio's nav language toggle, since language stays in the account popover, or its page gradient. Spec and design blueprint at [docs/specs/appearance/theme-system-redesign.md](specs/appearance/theme-system-redesign.md).

Stages run: specs, design, frontend, backend, accessibility, unit tests, code review, commit. Compliance and SEO were skipped because nothing about data handling, auth, email, or a public search surface changed, only stored theme ids are rewritten and no new page ships. The design gate took several palette iterations of taste direction from the owner, including a mid-build revert of the default from a lilac-and-turquoise "pastel goth" palette to the teal seafoam that shipped, which is normal gate input rather than hand-written implementation code. Accessibility passed AA on all five themes across light and dark, 50 of 50 checks. Code review passed with zero critical and zero warning findings and two non-blocking suggestions left for the owner's judgement. The unit-test stage covers the new theme set, the accent ramps, and the id remap and coercion, bringing the suite to 119 passing tests. Verification: the full unit suite and lint are clean. The Drizzle migration `0001_remap_theme_ids.sql` is written but not applied, since the sandbox has no database credentials, so applying it against the production database remains an owner step and the new default and remap do not take effect in prod until it runs. This is the second feature built end to end as an autonomous sandbox run, every applicable stage delegated to a specialist with no hand-written implementation code, so it counts as fully sandboxed.
