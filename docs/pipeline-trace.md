# Pipeline trace

Append-only ledger of every feature built through the spec-driven multi-agent pipeline. One row per feature, added when the feature lands. This file is the source of truth for the coverage stats. Any container running the pipeline appends its own row, so the totals survive across machines and sandboxes without a central service. The readable story and the per-feature detail live in [pipeline.md](pipeline.md). This file is just the data.

## How a container updates this

Add one row to the bottom of the ledger when a feature lands. Do not rewrite existing rows and do not hand-maintain a total, since the total is the row count and rewriting invites conflicts when more than one container appends. Fill every column from what actually happened, not from what was planned.

## Columns

- **Agent-driven** is `yes` when every applicable stage ran through an agent with no hand-written implementation code, from spec to commit.
- **Fully sandboxed** is `yes` when, on top of agent-driven, the design, build, test, and commit stages ran hands-off as one autonomous pass in the devcontainer, with no intervention between spec approval and the opened pull request. The human gates, spec review and PR review, are expected; intervening inside the sandboxed block is what makes it `no`. This is the headline portfolio number.
- **Spec** links the file in `specs/`. **PR** links the pull request, or reads `none` when the feature landed without one.

## Stats

- Total features through the workflow is the number of rows.
- Built fully through the sandboxed pipeline is the count of `Fully sandboxed` set to `yes` over the total.
- Built agent-driven is the count of `Agent-driven` set to `yes` over the total.

## Ledger

| #   | Date       | Feature             | Agent-driven | Fully sandboxed | Spec                                  | PR   |
| --- | ---------- | ------------------- | ------------ | --------------- | ------------------------------------- | ---- |
| 1   | 2026-07-15 | Visual theme rework | yes          | no              | [spec](specs/appearance/visual-theme-rework.md)  | none |
| 2   | 2026-07-15 | Persist user preferences | yes      | no              | [spec](specs/settings/preference-persistence.md) | [#1](https://github.com/AGilbertDev/time-tracking/pull/1) |
