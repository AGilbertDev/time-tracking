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

| #   | Date       | Feature                                      | Agent-driven | Fully sandboxed | Spec                                                                                                                        | PR                                                          |
| --- | ---------- | -------------------------------------------- | ------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | 2026-07-15 | Visual theme rework                          | yes          | no              | [spec](specs/appearance/theme-system.md)                                                                                    | none                                                        |
| 2   | 2026-07-15 | Persist user preferences                     | yes          | no              | [spec](specs/settings/preference-persistence.md)                                                                            | [#1](https://github.com/AGilbertDev/time-tracking/pull/1)   |
| 3   | 2026-07-18 | Profile menu header popover                  | yes          | yes             | [spec](specs/settings/profile-menu-popover.md)                                                                              | [#2](https://github.com/AGilbertDev/time-tracking/pull/2)   |
| 4   | 2026-07-19 | Theme system redesign                        | yes          | yes             | [spec](specs/appearance/theme-system.md)                                                                                    | [#3](https://github.com/AGilbertDev/time-tracking/pull/3)   |
| 5   | 2026-07-19 | Manage users admin page                      | yes          | yes             | [spec](specs/admin/manage-users.md)                                                                                         | [#7](https://github.com/AGilbertDev/time-tracking/pull/7)   |
| 6   | 2026-07-19 | Profile and settings pages                   | yes          | no              | [profile](specs/settings/profile-page.md), [settings](specs/settings/settings-page.md)                                      | [#9](https://github.com/AGilbertDev/time-tracking/pull/9)   |
| 7   | 2026-07-19 | Avatar upload and private storage            | yes          | no              | [spec](specs/settings/avatar-upload.md)                                                                                     | [#10](https://github.com/AGilbertDev/time-tracking/pull/10) |
| 8   | 2026-07-20 | Tasks schema and migration                   | yes          | yes             | [spec](specs/planning/tasks-schema.md)                                                                                      | [#13](https://github.com/AGilbertDev/time-tracking/pull/13) |
| 9   | 2026-07-20 | Task categories contract                     | yes          | yes             | [spec](specs/planning/task-categories.md)                                                                                   | [#14](https://github.com/AGilbertDev/time-tracking/pull/14) |
| 10  | 2026-07-20 | Week with task rows                          | yes          | yes             | [spec](specs/planning/week-with-task-rows.md)                                                                               | [#16](https://github.com/AGilbertDev/time-tracking/pull/16) |
| 11  | 2026-07-20 | Finish the read-only week                    | yes          | yes             | [spec](specs/planning/read-only-week-capacity-and-nav.md)                                                                   | [#17](https://github.com/AGilbertDev/time-tracking/pull/17) |
| 12  | 2026-07-28 | Lighten the planning week                    | yes          | no              | [spec](specs/planning/alleger-la-semaine.md)                                                                                | [#18](https://github.com/AGilbertDev/time-tracking/pull/18) |
| 13  | 2026-07-28 | Progressive disclosure for the planning week | yes          | no              | [spec](specs/planning/extend-tasks.md), [design](specs/planning/extend-tasks-design.md)                                     | [#20](https://github.com/AGilbertDev/time-tracking/pull/20) |
| 14  | 2026-07-29 | The nine default categories                  | yes          | yes             | [spec](specs/planning/nine-task-categories.md)                                                                              | [#21](https://github.com/AGilbertDev/time-tracking/pull/21) |
| 15  | 2026-07-29 | The category column with coloured names      | yes          | no              | [spec](specs/planning/category-column-coloured-names.md), [design](specs/planning/category-column-coloured-names-design.md) | [#22](https://github.com/AGilbertDev/time-tracking/pull/22) |
| 16  | 2026-07-30 | The task write API                           | yes          | no              | [spec](specs/planning/task-write-api.md)                                                                                    | [#30](https://github.com/AGilbertDev/time-tracking/pull/30) |
| 17  | 2026-07-31 | The inline task editor                       | yes          | no              | [spec](specs/planning/task-inline-editor.md), [design](specs/planning/task-inline-editor-design.md)                         | [#36](https://github.com/AGilbertDev/time-tracking/pull/36) |
| 18  | 2026-07-31 | The tenth category, Autre                    | yes          | no              | [spec](specs/planning/other-category.md), [design](specs/planning/other-category-design.md)                                 | [#36](https://github.com/AGilbertDev/time-tracking/pull/36) |
