# time-tracking

Two things at once.

**The product** is a time and productivity tracker for freelance translators. It has a real user, a real deploy at `time-tracker.agilbert.dev`, and a real domain problem. Translators work to a words-per-hour target that differs by kind of work, and the app surfaces the same throughput numbers the work is reviewed and priced against. The product spec lives in [docs/spec.md](docs/spec.md); the original app it rebuilds is captured in [docs/concept.md](docs/concept.md).

**The method** is why the repo exists as a portfolio piece. This project is the proof of concept for the AGilbertDev multi-agent pipeline. Every feature is built one at a time through the full pipeline, and the commit and pull-request history is left as a visible trail of that process. The methodology is documented in [docs/pipeline.md](docs/pipeline.md), and the portfolio project page tells the same story to visitors.

## How work happens here

Pipeline-driven, not hand-written. Every feature, page, route, or non-trivial change goes through the agent pipeline described in [docs/pipeline.md](docs/pipeline.md): specs, then design, then the build stages, then review, then commit. One feature at a time, start to finish, before the next one begins. The autonomous build stages are meant to run isolated in the devcontainer sandbox (`.devcontainer/`). Specs and code review are never skipped.

This replaces the old tutorial mode. The project used to be a learning exercise where the code was written by hand, step by step. It is now a demonstration of the pipeline, so the agents do the building and the trail they leave is the artifact.

## Maintaining the build trail

This repo is the proof of concept for the pipeline, so the record of how each feature was built is part of what the repo delivers. Keeping that record current is the orchestrator's job. Every feature that ships through the pipeline gets an entry in the "How this project was built" section of [docs/pipeline.md](docs/pipeline.md), written as part of the same feature rather than batched later. Each entry names the feature, lists which stages ran and which were skipped with the reason, notes how it was verified, and links the spec in `docs/specs/` and the pull request.

A missing or stale trail means the demonstration failed even when the product works, so the documentation is a pipeline output rather than an afterthought.

The coverage numbers in that section are derived from an append-only ledger at [docs/pipeline-trace.md](docs/pipeline-trace.md). Every feature that lands gets one row there, added during the pipeline run so any container on any machine records its own work and the totals survive across sandboxes. Append the row when the feature lands and refresh the derived coverage line in pipeline.md from it, and never rewrite existing rows or hand-maintain a total, since the total is the row count. A feature counts as fully sandboxed only when every applicable stage ran through an agent inside the devcontainer sandbox with no hand-written implementation code, from spec to opened pull request. Slight adjustments made after the sandboxed run, such as a small fix, a copy correction, or formatting, do not break a feature's agent-driven or fully-sandboxed classification, since the stat records who did the substantive build. A substantial hand-written change to the implementation does break it, a minor touch-up does not. The ledger is the source of truth, so keep it honest rather than flattering. The portfolio tells its story from these counts.

The ledger is listed in `.prettierignore`, and it has to stay there for the append-only rule to mean anything. Prettier formats a Markdown table by re-padding every column to its widest cell, so appending one row wider than the rest rewrites every row above it. The values do not change, but a one-line append becomes a whole-table diff, which is review noise, a conflict magnet on any branch that also appends, and an audit trail nobody can read as untouched. So write new rows by hand in the existing style and do not line the columns up, because Markdown renders a ragged table exactly like a padded one. A reviewer asking for the rows to be restored byte-for-byte is right, and this exclusion is what makes honouring that possible.

## Conventions and skills

This repo uses the shared [agilbertdev-recipes](https://github.com/AGilbertDev/agilbertdev-recipes) (vendored as the `.recipes` submodule). Personal conventions and the curated skill set come from there, not from this file. After cloning:

```bash
git submodule update --init && bash .recipes/bin/install
```

The always-loaded core conventions (git identity, writing voice, security, confidentiality, and the agent pipeline) load through `.recipes/CLAUDE.md`. Stack rules load on demand from the `my-frontend-conventions`, `my-styling-conventions`, and `my-backend-conventions` skills.

## Product non-negotiables

- **Copy quality**: the user is a translator, so every visible string must be researched and correct, never LLM-guessed. French first, English second. French uses a space before `? ! : ;`.
- **i18n-first**: FR default, EN supported, locale persisted per user. Not a retrofit.
- **Do not police the user**: the app may signal (over target, a non-work day) but never blocks. It records reality, not what the schedule says reality should be.

## Stack

Nuxt 4, Nuxt UI 4, Tailwind 4, Turso + Drizzle, nuxt-auth-utils (owner-managed auth), @nuxtjs/i18n, Zod, Resend. Deployed on Vercel.
