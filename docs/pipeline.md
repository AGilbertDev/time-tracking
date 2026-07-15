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

### Feature 1 — Visual theme rework (in progress)

Bringing the app's visual identity in line with the reworked portfolio conventions: Phosphor icons, the signature glow accent, oklch-derived accents, the global container config, and the oversized CTA, all derived from the active theme so they work across all eight atmospheres. Spec and design blueprint at [docs/specs/visual-theme-rework.md](specs/visual-theme-rework.md). Stages completed so far: specs, design.
