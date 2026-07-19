# Pipeline trace

Append-only ledger of every feature built through the spec-driven multi-agent pipeline. One row per feature, added when the feature lands. This file is the source of truth for the coverage stats. Any container running the pipeline appends its own row, so the totals survive across machines and sandboxes without a central service. The readable story and the per-feature detail live in [pipeline.md](pipeline.md). This file is just the data.

## How a container updates this

Add one row to the bottom of the ledger when a feature lands. Do not rewrite existing rows and do not hand-maintain a total, since the total is the row count and rewriting invites conflicts when more than one container appends. Fill every column from what actually happened, not from what was planned.

## Columns

- **Agent-driven** is `yes` when every applicable stage ran through an agent with no hand-written implementation code, from spec to commit.
- **Fully sandboxed** is `yes` when, on top of agent-driven, every stage ran inside the devcontainer sandbox, from spec to opened pull request. This is the headline portfolio number.
- **Slight adjustments after the sandboxed run** (a small fix, copy correction, or formatting) do not flip either column to `no`. The stat records who did the substantive build, so only a substantial hand-written change to the implementation breaks the classification, never a minor touch-up.
- **Spec** links the file in `specs/`. **PR** links the pull request, or reads `none` when the feature landed without one.

## Stats

- Total features through the workflow is the number of rows.
- Built fully through the sandboxed pipeline is the count of `Fully sandboxed` set to `yes` over the total.
- Built agent-driven is the count of `Agent-driven` set to `yes` over the total.

## Ledger

| #   | Date       | Feature             | Agent-driven | Fully sandboxed | Spec                                  | PR   |
| --- | ---------- | ------------------- | ------------ | --------------- | ------------------------------------- | ---- |
| 1   | 2026-07-15 | Visual theme rework | yes          | no              | [spec](specs/appearance/theme-system.md)  | none |
| 2   | 2026-07-15 | Persist user preferences | yes      | no              | [spec](specs/settings/preference-persistence.md) | [#1](https://github.com/AGilbertDev/time-tracking/pull/1) |
| 3   | 2026-07-18 | Profile menu header popover | yes   | yes             | [spec](specs/settings/profile-menu-popover.md) | [#2](https://github.com/AGilbertDev/time-tracking/pull/2) |
| 4   | 2026-07-19 | Theme system redesign | yes          | yes             | [spec](specs/appearance/theme-system.md) | [#3](https://github.com/AGilbertDev/time-tracking/pull/3) |
| 5   | 2026-07-19 | Manage users admin page | yes        | yes             | [spec](specs/admin/manage-users.md) | [#7](https://github.com/AGilbertDev/time-tracking/pull/7) |
| 6   | 2026-07-19 | Profile and settings pages | yes       | no              | [profile](specs/settings/profile-page.md), [settings](specs/settings/settings-page.md) | PR_LINK_PLACEHOLDER |
