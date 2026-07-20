# The week with task rows

## Summary

This is Bout 1 of three that together build the read-only planning week, and it is the first thing the signed-in owner sees after login. It replaces the empty placeholder at `app/pages/index.vue` with the current Sunday-to-Saturday week, each day showing its date header and its compact read-only task rows. It delivers three of the planning features, `PLAN-04` for the list-tasks API, `PLAN-06` for the compact task row, and `PLAN-07` for the week stack. It writes nothing beyond a dev-only seed. The two later bouts add the day capacity meter and buffer bands (`PLAN-03` plus `PLAN-05`) and the week switcher (`PLAN-08`). Cutting the work this way keeps each bout end to end with its own pull request and leaves the app in a working, shippable state after each one.

The settled decisions live in [`overview.md`](overview.md) and are referenced here rather than restated. The data foundation is already on `main`, the `tasks` table from `PLAN-01` ([`tasks-schema.md`](tasks-schema.md)) and the category contract from `PLAN-02` ([`shared/categories.ts`](../../../shared/categories.ts)). This bout reads both and never mutates a task.

## Visual target and its two guards

The visual target is the real mockup the user built, saved at [`dashboard-mockup.html`](dashboard-mockup.html), a self-contained HTML page. Its real content starts at the `<title>Planning de traduction — maquette</title>` and the `<style>` block after it. The claude.ai frame-runtime `<script>` preamble at the very top of the file is not part of the design and is ignored. The mockup settles the earlier open question 6 on the row field set, so `PLAN-06` is a locked layout to match, not a proposal to invent.

Two guards constrain how the mockup is used, and both are requirements on the design and frontend stages.

- **Scope guard.** The mockup renders the whole dashboard, including pieces that are not in this bout. The "Deferred to later bouts" section lists each out-of-scope piece and which bout or `PLAN` id owns it. Build the row grid, the day card, and the day header to the mockup's final structure now, so a later bout adds behaviour to an existing slot rather than restructuring the markup.
- **Theming guard.** The mockup's `:root` CSS custom properties are a reference palette, not something to import wholesale. Map the mockup's look onto the project's existing theme system and semantic tokens, the five-theme setup and Hanken Grotesk already in the repo per `my-styling-conventions`, so the week respects the active theme and dark mode. Use the mockup for layout, structure, copy, interaction affordances, and the semantic colour roles (primary, accent, good, warn, bad, info), never as a hardcoded hex palette.

## PLAN-04 — List tasks for a date range

Backend. See `overview.md` `PLAN-04` for the locked acceptance criteria, that it returns only the caller's tasks in the range, `401` without a session, and `422` on an invalid range.

### Route and handler

A thin route delegating to a handler, matching the repo pattern in `server/api/me/work-settings.patch.ts` and its handler, with the query validated in a model module and the logic in the handler.

- Route `server/api/tasks/index.get.ts`, wrapped in `defineAuthenticatedEventHandler` so a missing session throws `401` before any work runs. It reads and validates the query with the range schema, calls `sendZodError` on a validation failure, and delegates to the handler.
- Handler `server/api/tasks/handlers/list.ts` reads the session user through `requireUserSession`, so the scope is always the session user and never an id from the request, and it queries the `tasks` table.
- Model `server/models/tasks.ts` holds the Zod query schema, its inferred type, and the `TaskListItem` response type.

### Query contract

Two required query parameters.

- `from`, a calendar day string `'YYYY-MM-DD'`.
- `to`, a calendar day string `'YYYY-MM-DD'`.

What makes a range invalid, each one a `422` and never a crash, so the endpoint fails closed:

- `from` or `to` missing.
- `from` or `to` not matching the `'YYYY-MM-DD'` shape, or not a real calendar date such as `2026-02-31`.
- `from` after `to`, an inverted range. An equal `from` and `to` is valid and returns a single day.
- A span wider than a documented maximum. The endpoint is reused by the month and year views later, so the cap is generous rather than tight. Assumption: the maximum span is 366 days inclusive, which admits a full leap year and bounds the scan so a malformed or hostile query cannot ask for an unbounded range. A wider span is a `422`.

### Response shape and query

On success, `200` with a JSON array of the caller's task rows whose `date` falls in `[from, to]` inclusive, ordered by `date` ascending, then `sortOrder` ascending, then `id` for a stable tie-break. The query is the single indexed range scan the `(user_id, date)` index was built for, `WHERE user_id = <session user> AND date >= from AND date <= to`.

Each item returns the stored task fields the row needs. There is no project-manager field and none is returned, since `PLAN-01` never added that column. Proposed shape:

```
type TaskListItem = {
  id: string
  date: string
  client: string | null
  project: string | null
  category: string
  deliveryDate: string | null
  deliveryTime: string | null
  projectWordCount: number | null
  wordsDone: number | null
  quotaWphOverride: number | null
  estimatedMinutes: number | null
  actualMinutes: number | null
  status: string | null
  instructions: string | null
  splitGroupId: string | null
  sortOrder: number
}
```

- **AC1.** A request with a valid `from` and `to` returns only the session user's tasks whose `date` is in range, ordered by `date` then `sortOrder`, and never returns another user's rows even if a user id is smuggled in the query.
- **AC2.** No session returns `401`. A missing, malformed, inverted, or over-wide range returns `422` through `sendZodError` with per-field messages, and never a `500`.

## PLAN-06 — Compact task row (read-only)

Frontend. See `overview.md` `PLAN-06`, and match the mockup's `.row` exactly. The row is one line at rest with the fields below, left to right. The grid template is taken verbatim from the mockup so later bouts add the hover actions into the existing trailing slot without reflow.

```
grid-template-columns: 20px 12px minmax(0,1.5fr) auto auto auto 104px 96px;
```

The eight columns, left to right:

1. **Drag grip** (20px). The grip icon renders as a visual affordance. Dragging does nothing in this bout, since reorder and move are `PLAN-15` and `PLAN-16`.
2. **Status dot** (12px), a small coloured dot. `Accepté` uses the info role, `En cours` the warn role, `Terminé` the good role, and a non-trackable task uses the faint role at reduced opacity (the mockup's `.sdot.na`).
3. **Who block** (`minmax(0,1.5fr)`). The client in a bold weight, then the project in a muted weight prefixed with a middle dot, for example `Trad-Média · P-4821`. Below sits a faint meta line. For a trackable task the meta shows the delivery, for example `Livraison 16:00`. For a non-trackable task the meta reads `retirée des heures effectives`. For the second slice of a split it reads the mockup's split note, for example `1 400 mots ce jour · reste du projet porté d'hier`, and the who block carries the `⇄ suite` split tag in the accent role.
4. **Mots cell** (auto), an uppercase faint label `Mots` above the value. The value is `wordsDone` formatted with a French thousands space, for example `1 350`. A non-trackable task shows an em dash `—`.
5. **Durée cell** (auto), an uppercase faint label `Durée` above the value. The value is the effective duration formatted as `3 h 00`, computed by `effectiveDuration` below.
6. **Category chip** (auto). `Traduction` uses the primary wash, `Révision` the accent wash, and every other category the neutral chip, driven by `chipVariant` below. The chip text is the localized category name resolved from the `categories.<id>` i18n keys, never a raw stored id.
7. **Status badge** (104px). For a trackable task it shows the status coloured per its role, `Accepté` info, `En cours` warn, `Terminé` good. For a non-trackable task it shows an `N/A` badge with a dashed faint border (the mockup's `.status.na`). Whether a task is trackable is decided by `isTrackableCategory(category)` from `shared/categories.ts`, never hardcoded.
8. **Row-action slot** (96px). Reserved and empty in this bout. The copy, split, and delete buttons are `PLAN-17`, `PLAN-18`, and `PLAN-13`, and they appear on hover in the mockup, so at rest this column is already empty and keeping it reserved matches the at-rest appearance while leaving the later hook in place.

Both the small colour dot and the text badge render together, as in the mockup, so status reads at a glance and in full. Every visible string goes through the i18n layer, and the French copy is the mockup's verbatim copy.

- **AC3.** The row renders on one line with the eight-column grid above, showing grip, status dot, who block, Mots, Durée, category chip, and status badge, with the row-action column reserved and empty.
- **AC4.** A trackable task shows its status colour on both the dot and the badge, mapping `Accepté` to info, `En cours` to warn, and `Terminé` to good. A non-trackable task shows the `N/A` badge and the faint dot, its Mots value is `—`, and its meta reads `retirée des heures effectives`, all driven by `isTrackableCategory`.
- **AC5.** The category chip variant is primary wash for translation, accent wash for revision, and neutral otherwise, and the chip text is the localized category name from the contract.
- **AC6.** Every visible string is i18n, the French copy matches the mockup, and the row respects the active theme and dark mode through the project's tokens.

## PLAN-07 — Week view stack

Frontend. See `overview.md` `PLAN-07` for the locked acceptance criteria, and match the mockup's day cards. Seven days are stacked vertically, the week running Sunday to Saturday in the North American convention.

- **Today** is made prominent with a primary border and the `aujourd'hui` pill in the day header, matching the mockup's `.day.today` and `.todaypill`. Today is determined in the user's timezone, read from the existing `GET /api/me/work-settings`, through `todayInZone` below.
- **Working days** render as normal day cards. **Non-work days** render as dashed off-day hints, matching the mockup's `.day.offday`, with an italic label. The base label is `Jour non travaillé`. Matching the mockup, the Sunday card adds `· début de la semaine` and the Saturday card adds `· le travail reste possible et bonifie le quota de la semaine`. Whether a date is a work day is decided by `isWorkDay(date, workDays)`, with `workDays` read from `GET /api/me/work-settings`.
- **The day header** shows only the day name and date in this bout, in the format `lundi 20 juill.` from `formatDayLabel` below, plus the `aujourd'hui` pill on today. It must leave a clean structural slot where Bout 2 drops the capacity meter, and it must not render any meter, buffer, or state pill yet. This reserved slot is called out again in "Deferred to later bouts".
- **The week label** above the stack reads `Semaine du 19 au 25 juillet 2026`, from `formatWeekLabel` below. The label uses the full French month name, while the day headers use the abbreviated month. This bout renders the current week only, anchored to today, since the switcher is Bout 3.

The date range comes from the shared pure helpers, not from ad-hoc date math in the component. The `from` and `to` sent to `GET /api/tasks` are `getWeekRange(todayInZone(now, timezone))`.

- **AC7.** The stack renders seven day cards in Sunday-to-Saturday order for the week containing today.
- **AC8.** Today is visually distinguished with the primary border and the `aujourd'hui` pill, and today is computed in the user's configured timezone.
- **AC9.** Non-work days render as dashed off-day hints with the italic label, Sunday and Saturday carrying the mockup's contextual suffixes, driven by the user's `workDays`.
- **AC10.** The day header shows the `lundi 20 juill.` label and reserves the capacity slot without rendering a meter, and the week label reads `Semaine du 19 au 25 juillet 2026` for that week.

## Deferred to later bouts

Named here so the reader knows they are coming and so the frontend leaves the right hooks.

- **Day capacity meter, buffer band, and state pill.** Bout 2, `PLAN-03` plus `PLAN-05`. The Bout 1 day header shows only the day name, date, and the `aujourd'hui` pill. It must not render a capacity meter, and it must leave a clean structural slot in the day header so Bout 2's meter, reading, and state pill drop in without a rewrite.
- **Week navigation** (`‹`, Aujourd'hui, `›`). Bout 3, `PLAN-08`. Bout 1 renders the current week only, with the `from` and `to` derived from today. There is no switcher, and the mockup's chevron nav glyphs are not rendered in this bout.
- **View switcher** (`Jour` / `Semaine` segmented control) and the **day view**. `PLAN-25` and `PLAN-26`.
- **Expand-to-edit editor**, `PLAN-11` and `PLAN-12`. The row is not clickable-to-expand in this bout.
- **Add a task** (the `+ Ajouter une tâche` affordance), `PLAN-10`.
- **Row hover actions** (copy, split, delete) and their keyboard shortcuts, `PLAN-17`, `PLAN-18`, `PLAN-13`. The row-action column is reserved and empty.
- **Drag and drop**, `PLAN-15` and `PLAN-16`. The grip renders but does nothing.
- **Import and export** (`Importer / Exporter`), `PLAN-29`.
- **Statistics band and category split**, `PLAN-22`, `PLAN-23`, `PLAN-31`.
- The mockup's **nav bar** (brand, greeting, colour-mode toggle, account popover) is the existing app shell, not part of this feature, and the mockup's **legend block** is documentation, not a shipped element.

## Pure helpers to unit-test

These carry the load-bearing logic and are the target of the later unit-test stage, which writes tests from this spec rather than from the code. Each is pure and DB-free, and they live in a shared module reachable by both client and server, for example `shared/planning.ts`, so the same date and formatting logic is never reimplemented on two sides. The intended behaviour below is enough to test each one from this document alone.

- `todayInZone(now, timeZone)`. Returns the `'YYYY-MM-DD'` calendar day of the instant `now` as seen in `timeZone`, so an instant late on July 20 UTC reads as July 20 in `America/Toronto` rather than drifting a day. This is what makes today and the current week correct for the user's zone.
- `getWeekRange(date)`. Returns `{ from, to }` as `'YYYY-MM-DD'` for the Sunday-to-Saturday week containing `date`. For any date in the week of `2026-07-20` (a Monday) it returns `from` `2026-07-19` (Sunday) and `to` `2026-07-25` (Saturday). A date that is itself a Sunday returns that Sunday as `from`.
- `getWeekDays(date)`. Returns the seven `'YYYY-MM-DD'` strings from the week's Sunday through its Saturday in order. Its first element equals `getWeekRange(date).from` and its last equals `.to`.
- `addDays(date, n)`. Returns the `'YYYY-MM-DD'` that is `n` days after `date`, `n` negative moving backward, correct across month and year boundaries. `addDays('2026-12-29', 7)` is `2027-01-05`.
- `isWorkDay(date, workDays)`. Returns whether the weekday of `date`, numbered 0 for Sunday through 6 for Saturday, is a member of `workDays`. With `[1,2,3,4,5]` a Saturday and a Sunday are false and a Wednesday is true. An empty `workDays` is all false.
- `effectiveDuration(task)`. Returns `actualMinutes` when it is a number, otherwise `estimatedMinutes` when it is a number, otherwise `0`. This is the Durée value the row shows.
- `formatDuration(minutes, locale)`. Formats whole minutes as hours and minutes, `180` to `3 h 00` and `30` to `0 h 30` and `45` to `0 h 45` in French, with the minutes zero-padded to two digits. English uses the same numeric layout.
- `formatCount(n, locale)`. Formats an integer with the locale thousands separator, so `1350` is `1 350` in French with a non-breaking-style space, and `600` is `600`.
- `formatDayLabel(date, locale)`. Returns the lowercase weekday, the day number, and the abbreviated month with its period, so `2026-07-20` in French is `lundi 20 juill.`. The French month abbreviations are `janv.`, `févr.`, `mars`, `avr.`, `mai`, `juin`, `juill.`, `août`, `sept.`, `oct.`, `nov.`, `déc.`. English uses its own abbreviations.
- `formatWeekLabel(from, to, { locale, prefix, separator })`. Composes the localized week label from the range and the i18n connective words, using the full month name. Given the French connectives it produces `Semaine du 19 au 25 juillet 2026` for that week. When the week spans two months each day part carries its month, `Semaine du 29 juin au 5 juillet 2026`. When it spans two years each end carries its year, `Semaine du 29 décembre 2025 au 4 janvier 2026`.
- `statusKey(status, trackable)`. Maps a stored status to the CSS and colour key. For a trackable task `Accepté` gives `accepte`, `En cours` gives `encours`, `Terminé` gives `termine`, and an unknown value gives `na`. For a non-trackable task it always gives `na` regardless of the stored status.
- `chipVariant(categoryId)`. Returns `trad` for `translation`, `rev` for `revision`, and `neutral` for every other category id, so the chip colour is derived once rather than at each call site.

## Dev seed

The user wants to run `bun dev` and see a populated week, so this bout ships a dev-only seed that inserts a handful of representative tasks for the owner across the current week. It is not shipped to production and not auto-run. There is no `work_schedule` seed here, since that table arrives in Bout 2.

### Mechanism

The seed follows the existing `scripts/seed.ts` mechanism, a standalone script that builds its own `@libsql/client` from the `NUXT_TURSO_URL` and `NUXT_TURSO_AUTH_TOKEN` env vars and a Drizzle instance over the schema, run through Bun with `--env-file=.env`. It is a new script `scripts/seed-week.ts` and a new package script `seed:week` reading `bun run --env-file=.env scripts/seed-week.ts`, kept separate from the owner-account `seed` script so the two purposes do not entangle. It resolves the owner from `NUXT_OWNER_EMAIL`, prints a clear warning, and writes to whatever database `.env` points at, so it is the developer's responsibility to point it at a development database and never at production.

Re-run safety. The current week is computed at run time with `getWeekRange(todayInZone(...))`. Before inserting, the script deletes the owner's existing tasks whose `date` falls in the target week, then inserts fresh, so a second run replaces rather than accumulates and never leaves a half-seeded or duplicated week.

### What it inserts

A spread of tasks across the current week, computed from the resolved week days, covering the states the row must show:

- trackable tasks in the `translation` and `revision` categories, carrying `wordsDone`, `projectWordCount`, `estimatedMinutes`, and `deliveryTime`, with a mix of the `Accepté`, `En cours`, and `Terminé` statuses across them.
- non-trackable tasks in the `meetings`, `breaks`, and `terminology` categories, with a null status so the row shows `N/A` and an em dash for Mots.
- at least one multi-day split pair, two rows on adjacent weekdays sharing one `project` and one `splitGroupId`, each carrying its own `wordsDone`, so the connected-slice model is visible with the `⇄ suite` tag on the second slice.
- at least one task on a weekend day so the off-day card still renders its rows.

### How to run

```
bun run seed:week
```

Requires `NUXT_OWNER_EMAIL`, `NUXT_TURSO_URL`, and `NUXT_TURSO_AUTH_TOKEN` in `.env`, and an existing owner user row, which `bun run seed` creates if needed. It is never invoked by CI, a deploy hook, or app boot.

## i18n and copy

FR is the default and EN is supported, with the locale persisted per user, so every visible string in this bout goes through the i18n layer under a new `planning` namespace in `i18n/locales/fr.json` and `i18n/locales/en.json`. Category names are not added here, they already exist under `categories.<id>` from `PLAN-02` and are reused. French is Québécois, never français de France, and uses a space before `? ! : ;`. The mockup is the source of truth for the French copy, so the strings below are taken from it verbatim and must not be re-guessed. The design and frontend stages confirm them against the mockup before shipping.

Required French strings, with their English counterparts:

- Page title. `Planning de traduction`. English `Translation planning`.
- Week label connectives, consumed by `formatWeekLabel`. The prefix `Semaine du` and the separator `au`, so the label reads `Semaine du 19 au 25 juillet 2026`. English prefix `Week of`.
- Today pill. `aujourd'hui`. English `today`.
- Off-day label. `Jour non travaillé`, with the Sunday suffix `· début de la semaine` and the Saturday suffix `· le travail reste possible et bonifie le quota de la semaine`. English `Day off` with matching suffixes.
- Row cell labels. `Mots` and `Durée`. English `Words` and `Time`.
- Non-trackable meta. `retirée des heures effectives`. English `removed from effective hours`.
- Split tag and split meta. `⇄ suite`, and a slice meta of the form `1 400 mots ce jour · reste du projet porté d'hier`. English `⇄ continued` and its equivalent.
- Delivery meta prefix. `Livraison`, as in `Livraison 16:00`. English `Delivery`.
- Status names. `Accepté`, `En cours`, `Terminé`, and `N/A` for non-trackable. English `Accepted`, `In progress`, `Done`, and `N/A`.
- The French month abbreviations for `formatDayLabel` and the full month names for `formatWeekLabel`, as listed in the helpers section.

Status vocabulary note. The three trackable status names come from the old app and are treated as confirmed for this build, matching `overview.md` open question 5. If the user later renames them, only these i18n values and the `statusKey` mapping change, since the stored `status` column is free text.

## Edge cases

- No session on the list endpoint. `GET /api/tasks` returns `401` through `defineAuthenticatedEventHandler` before any query runs, so an expired or absent session never leaks data and the page routes to sign-in through the existing auth flow rather than rendering a broken week.
- Invalid, inverted, missing, or over-wide range. The endpoint returns `422` through `sendZodError`, never a `500` and never an unbounded scan. The client derives the range itself from the pure week helpers, so it should never send an invalid range, and a `422` therefore signals a client bug and the page shows a recoverable message rather than a blank crash.
- A week with no tasks. `GET /api/tasks` returns an empty array and the stack renders seven day headers with an empty state on each, which is a normal state and not an error.
- A day on the far side of a month or year boundary. `getWeekRange`, `getWeekDays`, and `addDays` cross month and year boundaries correctly, and `formatWeekLabel` renders the month-spanning and year-spanning label forms, so a week straddling December into January never produces a malformed range or label.
- Timezone drift for today. Today is computed with `todayInZone` from the user's `settings.timezone`, so the current week and the today marker do not jump a day for an instant near midnight UTC.
- A non-trackable task with a stored status. `statusKey` forces `na` for a non-trackable task regardless of the stored value, so a stray status never colours a meeting or a break.
- A stale or unknown category. `coerceCategory` and `isTrackableCategory` resolve an unknown category to the non-trackable `admin` default, so a value left by a renamed or retired category never reaches the row raw, and its chip is the neutral variant.
- A task with neither actual nor estimated minutes. `effectiveDuration` returns `0`, so the row still renders `0 h 00` rather than throwing on a null.
- Work on a non-work day. The off-day card still renders its rows and shows the Saturday note that work there bonifies the week, honouring the do-not-police rule. Nothing is hidden or blocked.

## Stages

Specs and code review are never skipped. This bout runs specs, design, backend, frontend, accessibility, unit-test, code review, and commit.

- Design runs. It matches the mockup for the row and the week cards and confirms the Québécois copy against the mockup.
- Backend runs. The list-tasks route, handler, and model, and the dev seed.
- Frontend runs. The page, the week stack, the day cards, and the compact row.
- Accessibility runs. This is a new user-facing page, so it gets the a11y pass.
- Unit-test runs. It covers the pure helpers listed above.
- SEO is skipped. This is an authenticated dashboard behind sign-in, not a public or indexable page, so there is nothing to optimize for search.
- Compliance is skipped. The bout reads the owner's own tasks behind the existing authentication, writes no new class of personal data, collects nothing from an external party, and sends no email. The `tasks` data already exists under the compliance posture set when its table landed.

## Assumptions made

Recorded here because the build after approval runs hands-off, so these are decided rather than left open.

- The maximum accepted range span for the list endpoint is 366 days inclusive, and a wider span is a `422`.
- This bout reads `workDays` and `timezone` from the existing `GET /api/me/work-settings`, so it has no dependency on `PLAN-03`. The effective-dated schedule and the buffer arrive in Bout 2 and are not needed to render off-day hints or to compute today.
- The pure week, date, and formatting helpers live in `shared/planning.ts`, reachable by client and server.
- The mockup's chevron week-nav glyphs are deferred to Bout 3, so Bout 1 renders the current week only with no switcher.
- The row keeps the mockup's full eight-column grid, the row-action column reserved and empty, and the grip rendered but non-functional, so the later drag and action features slot in without restructuring.
- The day header reserves a structural slot for the Bout 2 capacity meter and renders no meter in this bout.
- The three trackable status names `Accepté`, `En cours`, and `Terminé` are confirmed for this build, and the free-text `status` column means a later rename touches only i18n and the `statusKey` mapping.
- The off-day label uses the base string `Jour non travaillé` for any non-work day, with the Sunday and Saturday contextual suffixes taken verbatim from the mockup.

## Open questions

None block the build. The row layout that was open question 6 in `overview.md` is now settled by the mockup and is not an open question here.
