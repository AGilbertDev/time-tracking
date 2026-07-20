# Finish the read-only week — capacity, buffer, and week nav

## Summary

This is Bout 2 of the read-only planning week, one larger vertical slice that finishes what Bout 1 started. It sits on top of the task rows shipped in [`week-with-task-rows.md`](week-with-task-rows.md) (Bout 1, PR #16) and delivers three planning features together in one feature and one pull request: `PLAN-03` the effective-dated work schedule and buffer, `PLAN-05` the day capacity header, and `PLAN-08` the week switcher. After this bout the read-only week is complete: each work day shows a real capacity meter with its buffer band and state pill, and the user can page from week to week and jump back to today.

The settled decisions live in [`overview.md`](overview.md) and are referenced here rather than restated. The visual target is the mockup at [`dashboard-mockup.html`](dashboard-mockup.html), the same one Bout 1 built against. The data foundation from `PLAN-01` ([`tasks-schema.md`](tasks-schema.md)) and the category contract from `PLAN-02` ([`task-categories.md`](task-categories.md)) are already on `main`. Bout 1's list endpoint (`GET /api/tasks`), the compact rows, the week stack, and the shared pure helpers in [`shared/planning.ts`](../../../shared/planning.ts) are also on `main`. This bout reads all of them and adds a new read-only table, a read endpoint, capacity helpers, and the switcher. It writes no task and adds no write endpoint.

## Base and sequencing

This slice branches from a clean `main` **after** PR #16 (branch `feat/planning-week-with-task-rows`) merges. It extends Bout 1 and assumes the task rows, the day cards, the off-day hints, the week label, and the shared helpers already exist on `main`. The Bout 1 day header already reserves the capacity slot (`.cap`) that `PLAN-05` fills here, and the Bout 1 controls area already has room for the switcher that `PLAN-08` adds. Nothing in Bout 1 is torn down; this bout only fills the reserved slot and adds the navigation controls.

## Visual target and its two guards

The two guards from Bout 1 carry over unchanged and are requirements on the design and frontend stages.

- **Scope guard.** The mockup renders the whole dashboard. Only the day capacity header (`.cap`, `.meter`, `.buffer`, `.cap-read`, `.state`) and the week nav group (`.navgroup`) are in scope here. The stats band, view switcher, import/export button, row hover actions, drag and drop, and the expand-to-edit editor are other features and are not built in this bout.
- **Theming guard.** The mockup's `:root` custom properties are a reference palette, never imported wholesale. Map the mockup's look onto the project's five-theme semantic tokens and Hanken Grotesk per `my-styling-conventions`, so the capacity header and the switcher respect the active theme and dark mode. Use the mockup for layout, structure, copy, and the semantic colour roles (`good`, `warn`, `bad`, `primary`, and the neutral `track`), never as a hardcoded hex palette.

---

## PLAN-03 — Effective-dated work schedule and buffer

Backend plus shared. See `overview.md` `PLAN-03` for the locked acceptance criteria: a date before a change resolves the old value, a date on or after resolves the new one, `buffer_minutes` defaults to 60, and a pure resolver returns the effective schedule for any date and falls back to the default before the first record.

### Why a history table and not the settings row

The `settings` row already holds the user's **current** `dailyWorkMinutes`, `workDays`, and `timezone`, and the settings page (another agent) edits them. That row is mutable, so it cannot answer "what was the work-day length on a date in the past". A period's quota denominator reads the work-hours setting in effect on that day (`overview.md` "History must stay correct when settings change"), so the setting is versioned by date in its own effective-dated history table, the SCD Type 2 pattern payroll systems use. This bout does not compute the quota (`PLAN-22` does), but it lays the history-safe table and the pure resolver the quota engine and the capacity meter both read.

### The `work_schedule` table

A new `work_schedule` table in `server/db/schema.ts`, in the exact style of the existing tables (Drizzle `sqliteTable`, `text` / `integer` columns, snake_case DB names with camelCase JS keys, `integer(..., { mode: 'timestamp' })` instants defaulted through `$defaultFn(() => new Date())`, and `foreignKey(...)` in the table callback). The column contract, JS key on the left, DB column in the middle:

| JS key | DB column | Type | Null? | Notes |
| --- | --- | --- | --- | --- |
| `id` | `id` | `text`, primary key | no | `$defaultFn(() => crypto.randomUUID())`, matching `users.id`, `settings.id`, and `tasks.id`. |
| `userId` | `user_id` | `text` | no | Foreign key to `users.id`, `onDelete: 'cascade'` (see decisions). |
| `workMinutes` | `work_minutes` | `integer` | no | The daily work-target in minutes for a **work day** under this record. Whole minutes. |
| `workDays` | `work_days` | `text` | no | JSON array of weekday numbers `0`–`6` (`0` = Sunday), the same representation as `settings.work_days`. Default `'[1,2,3,4,5]'`. |
| `bufferMinutes` | `buffer_minutes` | `integer` | no | The buffer the user keeps for urgent work. Default `60`. |
| `effectiveFrom` | `effective_from` | `text` | no | `'YYYY-MM-DD'`, the calendar day this record takes effect. Lexicographic order equals chronological order. |
| `createdAt` | `created_at` | `integer` (`mode: 'timestamp'`) | matches `users` | `$defaultFn(() => new Date())`, Unix-seconds instant. |
| `updatedAt` | `updated_at` | `integer` (`mode: 'timestamp'`) | matches `users` | `$defaultFn(() => new Date())`, Unix-seconds instant. |

Effective-dating semantics: a record applies from its `effective_from` up to but not including the next record's `effective_from`. The value for any target date is the record whose `effective_from` is the latest one **on or before** that date. A date before the first record, or an empty history, resolves to the documented defaults below.

### Decisions this schema locks

- **On-delete `cascade` on the user foreign key**, declared through `foreignKey(...).onDelete('cascade')` in the table callback, matching how `tasks` declares it. A user's schedule history is their own personal data with no reason to outlive the account, so a cascade leaves no orphan rows and gives the future erasure path a clean sweep. As with `tasks`, the cascade fires only when the libSQL / Turso client has `PRAGMA foreign_keys = ON`, which the backend stage confirms is already enabled by the app's client (it is required by the `tasks` cascade shipped in `PLAN-01`).
- **`work_days` is JSON text, not a normalized child table**, matching `settings.work_days`. It is a tiny fixed-size set (weekday numbers), and storing it as JSON text keeps the read a single row fetch with no join. The server read path coerces it defensively before it reaches the pure resolver, reusing the same discipline as `loadWorkSettings.coerceWorkDays` (drop any entry that is not an integer `0`–`6`, remove duplicates, and preserve a legitimately empty array).
- **A unique index on `(user_id, effective_from)`**, which both prevents an invalid state (two schedule records for the same user on the same effective date, which would make resolution ambiguous) and serves the resolution query `WHERE user_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`. Named descriptively, for example `work_schedule_user_id_effective_from_idx`. `user_id` first for the equality match, `effective_from` second for the range and the ordering.
- **Documented resolver defaults**, derived from the overview and the existing settings defaults so there is no discontinuity when the history is empty: `work_minutes` **450** (7 h 30, matching `settings.dailyWorkMinutes` and the mockup's day length), `work_days` **`[1,2,3,4,5]`** (Monday through Friday, matching `settings.work_days`), and `buffer_minutes` **60** (the overview's locked buffer default).

### The pure resolver

A pure, DB-free resolver lives in `shared/planning.ts` beside the existing planning helpers, so the client and the server resolve the schedule against one implementation and the unit-test stage can cover it in isolation.

Shared types and constant:

```
export type WorkScheduleRecord = {
  workMinutes: number
  workDays: number[]
  bufferMinutes: number
  effectiveFrom: string // 'YYYY-MM-DD'
}

export type ResolvedSchedule = {
  workMinutes: number
  workDays: number[]
  bufferMinutes: number
}

export const DEFAULT_SCHEDULE: ResolvedSchedule = {
  workMinutes: 450,
  workDays: [1, 2, 3, 4, 5],
  bufferMinutes: 60
}

export function resolveSchedule(
  records: readonly WorkScheduleRecord[],
  date: string
): ResolvedSchedule
```

Behaviour:

- Considers only records whose `effectiveFrom <= date` (a plain string comparison, since `'YYYY-MM-DD'` sorts chronologically), and returns the `workMinutes`, `workDays`, and `bufferMinutes` of the one with the **greatest** `effectiveFrom` among them.
- Returns `DEFAULT_SCHEDULE` (a fresh copy, so a caller cannot mutate the constant's `workDays` array) when no record qualifies, that is when the history is empty or `date` precedes every record's `effectiveFrom`.
- Treats `effectiveFrom == date` as a match (inclusive lower bound), so a record takes effect on its own effective date.
- Is order-independent of the input array: it does not assume the records are pre-sorted.
- Is deterministic if two records somehow share the greatest qualifying `effectiveFrom` (which the unique index prevents at the DB level): it returns one of them by a fixed rule (the last encountered after a stable ascending sort), so the function never throws and never returns `undefined`.

### Read path and endpoint

`PLAN-05` (the frontend) needs the resolved schedule for the visible days, so this bout ships a read endpoint. Read-only, no write endpoint.

- A single read path `server/utils/loadWorkSchedule.ts`, mirroring `loadWorkSettings.ts`. It reads all of the given user's `work_schedule` rows, coerces each row's `work_days` JSON to a clean number array (same defensive coercion as `loadWorkSettings`), and returns `WorkScheduleRecord[]` ordered by `effectiveFrom` ascending. An empty history returns an empty array; the resolver then supplies the defaults, so the caller never special-cases "no schedule".
- Route `server/api/me/work-schedule.get.ts`, a thin route wrapped in `defineAuthenticatedEventHandler` so a missing session throws `401` before any work runs, matching `server/api/me/work-settings.get.ts`.
- Handler `server/api/me/handlers/getWorkSchedule.ts` reads the session user through `requireUserSession`, so the scope is always the session user and never an id from the request, and it delegates to `loadWorkSchedule`.
- Response: `200` with a JSON array of `WorkScheduleRecord`. The client fetches it once and resolves each visible day with the shared `resolveSchedule`, so paging to another week refetches tasks but not the schedule.

### Migration

The migration is the next sequential file, expected `server/db/migrations/0005_add_work_schedule_table.sql`, hand-authored in the statement-broken style of `0000`–`0004`, with the same header comment block (rationale, the calendar-day-as-text note, an idempotency note, the cascade note, and the "DO NOT auto-run this against production" note). It is produced with `bunx drizzle-kit generate` or hand-authored to match, exactly as `0004_add_tasks_table.sql` was.

- **Generate-only, owner-applied.** There are no production database credentials in this sandbox, so the migration is written and verified locally against a fresh SQLite database but is **not** applied to production. Applying it against the production Turso database is an owner step, matching every prior migration. It must not be pointed at a live database by CI, a deploy hook, or a dev-boot runner.
- Both statements use `IF NOT EXISTS` (`CREATE TABLE IF NOT EXISTS work_schedule (...)` and `CREATE UNIQUE INDEX IF NOT EXISTS work_schedule_user_id_effective_from_idx ON work_schedule (user_id, effective_from)`), so re-applying the migration is a no-op rather than a duplicate-object error.

### Acceptance criteria

- **AC1.** The `work_schedule` table exists in `server/db/schema.ts` with exactly the columns above and the stated SQLite types, a `user_id` foreign key to `users.id` with `onDelete: 'cascade'`, and a unique index on `(user_id, effective_from)`. The generated migration applies cleanly on a fresh SQLite database, verifiable with `PRAGMA table_info(work_schedule)`, `PRAGMA index_list(work_schedule)`, and `PRAGMA foreign_key_list(work_schedule)`.
- **AC2.** `resolveSchedule([], anyDate)` returns `DEFAULT_SCHEDULE` (`workMinutes` 450, `workDays` `[1,2,3,4,5]`, `bufferMinutes` 60), and mutating the returned `workDays` does not change the constant.
- **AC3.** Given a record effective `2026-01-01` with `workMinutes` 450 and a later record effective `2026-07-01` with `workMinutes` 480, `resolveSchedule` returns 450 for `2026-06-30`, 480 for `2026-07-01` (the exact boundary resolves the new record), and 480 for `2026-08-15`. A date before the first record, `2025-12-31`, returns `DEFAULT_SCHEDULE`.
- **AC4.** `resolveSchedule` is order-independent: the same records passed in any array order produce the same result for a given date.
- **AC5.** `GET /api/me/work-schedule` returns `401` without a session, and with a session returns only that user's schedule records with `work_days` coerced to a clean number array, ordered by `effective_from` ascending. An empty history returns `[]`.
- **AC6.** The migration is generated only and recorded as owner-applied. It is not run against production by this bout, and re-applying it against a database that already has the table or index is a no-op.

---

## PLAN-05 — Day capacity header

Frontend. See `overview.md` `PLAN-05` and the "Day capacity has a buffer" locked decision. This drops the capacity header from the mockup into the `.cap` slot the Bout 1 day header already reserved on **work-day** cards.

### Where it renders

The capacity header renders inside the day header of a **work-day** card, in the reserved `.cap` slot, matching the mockup's structure: a meter bar with a hatched buffer band, the reading text, and the state pill, in that order.

```
<div class="cap">
  <div class="meter"><div class="fill {state}"></div><div class="buffer"></div></div>
  <div class="cap-read">{reading}</div>
  <span class="state {state}">{state label}</span>
</div>
```

An **off-day** card renders no capacity header. It keeps the Bout 1 off-day hint (the dashed card with the italic `Congé` label and its Sunday / Saturday suffixes), so a non-work day is never shown as "overbooked" merely because work was logged on it. This is the do-not-police rule, and it matches the mockup, where the Sunday and Saturday cards carry the off-day label and no meter. See "Non-work-day behaviour" below.

### Capacity math

Written as unambiguous conditions so the unit-test stage can test from this spec alone. All durations are whole minutes.

- **`booked`** is the sum of the effective duration of **all** of that day's tasks, both trackable and non-trackable (a meeting still eats the day). The effective duration of a task is `actualMinutes` when it is a number, otherwise `estimatedMinutes` when it is a number, otherwise `0`. This reuses the existing `effectiveDuration` helper, summed by the new `sumEffectiveDuration` helper.

```
booked = Σ effectiveDuration(task) over all tasks on the day
```

- **`workMinutes`** and **`bufferMinutes`** come from `resolveSchedule(records, date)` for that day's date.

- **`remaining`** and **`excess`**:

```
remaining = workMinutes - booked      // may be negative
excess    = booked > workMinutes ? booked - workMinutes : 0
```

- **Colour band / state**, evaluated in this order:

```
if      remaining < 0             -> 'bad'   // overbooked; booked > workMinutes
else if remaining > bufferMinutes -> 'good'  // comfortable; booked < workMinutes - bufferMinutes
else                              -> 'warn'  // into the buffer; 0 <= remaining <= bufferMinutes
```

These thresholds are taken verbatim from the overview's locked decision. Note the boundaries: `remaining` exactly equal to `bufferMinutes` is **`warn`** (into the buffer, not comfortable), and `remaining` exactly `0` is **`warn`** (not overbooked). Overbooked begins only when `booked` strictly exceeds `workMinutes`. This intentionally uses the overview's `>` for the good boundary rather than `≥`.

These conditions reproduce every mockup reading against `workMinutes = 450` and `bufferMinutes = 60`: `5 h 15` booked leaves `2 h 15` remaining (`good`), `7 h 15` leaves `0 h 15` (`warn`), `8 h 35` is `1 h 05` over (`bad`), `3 h 25` leaves `4 h 05` (`good`), and `1 h 20` leaves `6 h 10` (`good`).

- **Meter geometry**:

```
fillPct   = workMinutes > 0 ? min(100, (booked / workMinutes) * 100) : (booked > 0 ? 100 : 0)
bufferPct = workMinutes > 0 ? min(100, (bufferMinutes / workMinutes) * 100) : 0
```

The fill is drawn from the left in the state colour and never exceeds 100 %. The hatched buffer band is a static overlay on the right edge of the track, its width `bufferPct` (13.3 % for the mockup's 60 / 450), matching the mockup's `.buffer`. The divide-by-zero guards protect against a degenerate `workMinutes` of 0; in normal operation `workMinutes` is at least 1 (the field's floor) or the default 450.

### The reading

- Not overbooked (`good` or `warn`): the reading is the booked duration then the remaining duration, joined by a middle-dot separator.

```
{formatDuration(booked)} planifié · {formatDuration(remaining)} restant
```

- Overbooked (`bad`): the reading shows the excess instead of the remaining, and the excess portion is rendered in the `bad` colour role.

```
{formatDuration(booked)} planifié · <span class="bad">{formatDuration(excess)} en trop</span>
```

The separator is a middle dot with a space on each side (` · `). `formatDuration` already clamps a negative input to `0 h 00`, so `remaining` is only ever displayed when it is `≥ 0` (the `good` / `warn` case) and `excess` only when overbooked, which is exactly the overview's "when negative, the excess is shown and remaining is not shown".

### Duration formatting

Durations use the existing `formatDuration(minutes)` helper from Bout 1, which renders whole minutes as `H h MM` with a space on each side of `h` and the minutes zero-padded to two digits, so `315` is `5 h 15`, `135` is `2 h 15`, and `65` is `1 h 05`. This matches the mockup's Québécois `h`-style exactly, so no new format helper is needed here.

### The state pill

The state pill shows one of three labels, coloured per its role and matching the mockup's `.state.good` / `.state.warn` / `.state.bad`:

- `good` -> `à l'aise`
- `warn` -> `dans la marge`
- `bad` -> `surchargé`

### Non-work-day behaviour

A non-work day renders the day card and its rows (Bout 1) and never blocks input, honouring the do-not-police rule. It shows **no** capacity meter, no remaining figure, and no overbooked state. It keeps the Bout 1 off-day hint. This is deliberate: computing `remaining` against a zero scheduled length would paint any logged work as overbooked, which is precisely the policing the product forbids, and the mockup confirms off-day cards carry the label and no meter. Whether a date is a work day is decided as in Bout 1 by `isWorkDay(date, workDays)` with `workDays` from `GET /api/me/work-settings`; see the assumption on work-day sourcing below.

### New shared helpers

Added to `shared/planning.ts`, pure and DB-free, for the unit-test stage:

```
export function sumEffectiveDuration(
  tasks: readonly Pick<PlanningTask, 'actualMinutes' | 'estimatedMinutes'>[]
): number

export type CapacityState = 'good' | 'warn' | 'bad'

export type DayCapacity = {
  booked: number
  remaining: number
  excess: number
  state: CapacityState
  fillPct: number
  bufferPct: number
}

export function computeCapacity(
  booked: number,
  workMinutes: number,
  bufferMinutes: number
): DayCapacity
```

`sumEffectiveDuration` reduces over `effectiveDuration`. `computeCapacity` implements the math above and returns everything the header needs, so the component holds no capacity logic of its own.

### Acceptance criteria

- **AC7.** `booked` equals the sum of the effective durations of all of that day's tasks, trackable and non-trackable, using `actualMinutes` when present and otherwise `estimatedMinutes` and otherwise `0`.
- **AC8.** `remaining = workMinutes - booked` and `excess = max(0, booked - workMinutes)`, computed against the resolved `workMinutes` for that day's date.
- **AC9.** The state is `good` when `remaining > bufferMinutes`, `warn` when `0 <= remaining <= bufferMinutes`, and `bad` when `remaining < 0`, with the boundary cases (`remaining == bufferMinutes` and `remaining == 0`) both resolving to `warn`.
- **AC10.** The reading reads `{booked} planifié · {remaining} restant` when not overbooked and `{booked} planifié · {excess} en trop` when overbooked, with the `en trop` portion in the `bad` colour role, and durations formatted `H h MM`.
- **AC11.** The state pill shows `à l'aise`, `dans la marge`, or `surchargé` for `good` / `warn` / `bad`, and the meter fill and buffer band render at `fillPct` and `bufferPct`.
- **AC12.** A non-work day renders no capacity meter and never blocks input, keeping the Bout 1 off-day hint. A work day with zero tasks renders `0 h 00 planifié · {workMinutes} restant` in the `good` state.
- **AC13.** Every visible string is i18n, the French copy matches the mockup verbatim, and the header respects the active theme and dark mode through the project's semantic tokens.

---

## PLAN-08 — Week switcher

Frontend. See `overview.md` `PLAN-08`. The switcher is the mockup's `.navgroup`, sitting in the controls area of the top bar.

### Controls and structure

The control group is the `.navgroup`, an inline group of three **text** controls in this order:

1. A previous-week button reading `‹ Précédente` (the chevron glyph then the visible text `Précédente`).
2. A `Cette semaine` button that returns to the current week.
3. A next-week button reading `Suivante ›` (the visible text `Suivante` then the chevron glyph).

```
<div class="navgroup">
  <button>‹ Précédente</button>
  <button>Cette semaine</button>
  <button>Suivante ›</button>
</div>
```

### Labels, glyphs, and accessible names

The user reversed the earlier chevron-only decision, so the three controls carry visible text labels rather than being chevron icon buttons. The chevron glyphs remain as decorative affordances beside the text.

- The previous control shows the visible text `Précédente` with the chevron glyph `‹` (U+2039) before it. The glyph is `aria-hidden`, so the accessible name is the visible text `Précédente`.
- The middle control shows the visible text `Cette semaine`, which is also its accessible name. This is a **separate** i18n key (`nav.currentWeek`) from the lowercase `aujourd'hui` today-pill string Bout 1 already uses; the today pill is unchanged.
- The next control shows the visible text `Suivante` with the chevron glyph `›` (U+203A) after it. The glyph is `aria-hidden`, so the accessible name is the visible text `Suivante`.

### Behaviour

The page holds an `anchorDate` (a `'YYYY-MM-DD'`), initialized to `todayInZone(now, timezone)` with `timezone` from `GET /api/me/work-settings`. The visible range is `getWeekRange(anchorDate)` and the visible days are `getWeekDays(anchorDate)`, both from the existing shared helpers.

- **Précédente (`‹ Précédente`)** sets `anchorDate = addDays(anchorDate, -7)` and refetches tasks for the new range via the existing `GET /api/tasks` range endpoint, deriving `from` / `to` from `getWeekRange`.
- **Suivante (`Suivante ›`)** sets `anchorDate = addDays(anchorDate, +7)` and refetches the same way.
- **Cette semaine** recomputes `anchorDate = todayInZone(now, timezone)`, returning to the current week and bringing today into view, then refetches. It is safe to press when already on the current week (it re-anchors to the same week and is effectively a refresh).
- The week label, the day headers, the off-day hints, and every day's capacity all recompute from the new range. The `aujourd'hui` today pill and the today card's prominence show only when the visible week actually contains today, so paging away removes the today marker and pressing `Cette semaine` brings it back.
- Shifting is always by exactly one week (seven days), correct across month and year boundaries because `addDays` and `getWeekRange` already are. The client derives the range from the pure helpers and never sends an invalid range to the endpoint.
- The work-schedule records fetched for `PLAN-05` are loaded once and reused across week switches; only tasks refetch, and each visible day resolves its schedule with `resolveSchedule` for its own date.

### Interruption and recovery

- **A failed refetch** (network error, `500`, or an unexpected `422`) does not blank the week. It surfaces the existing recoverable error state from Bout 1 (`planning.loadError` with a `planning.retry` action). `anchorDate` stays at the range the user asked for, so retrying refetches that range, and `Cette semaine` always re-anchors to a known-good current week. There is no dead end.
- **Rapid paging** (several prev or next presses in flight) must not let a slow earlier response overwrite a newer one. The refetch is guarded so only the response for the currently anchored range is applied (a stale response for a superseded range is discarded). Recovery from any confused state is `Cette semaine`.
- **Session expiry mid-navigation** returns `401` from `GET /api/tasks`, and the page routes to sign-in through the existing auth flow rather than rendering a broken week.
- **An unexpected `422`** signals a client bug (the client should never send an invalid range) and shows the recoverable message rather than crashing.

### Acceptance criteria

- **AC14.** Précédente and Suivante shift the visible range by exactly one week and refetch tasks for the new range via `GET /api/tasks`, correct across month and year boundaries.
- **AC15.** Cette semaine returns to the current week (recomputed in the user's timezone) and brings today into view, and is safe to press repeatedly.
- **AC16.** The control group matches the `.navgroup` structure and order as three text buttons, the previous and next controls show the visible text `Précédente` and `Suivante` with the `‹` and `›` chevron glyphs (the glyphs `aria-hidden`, so the accessible name is the visible text), and the middle control shows the visible text `Cette semaine`.
- **AC17.** The week label, day headers, off-day hints, and per-day capacity recompute on each switch, and the today marker appears only on the week that contains today.
- **AC18.** A failed refetch shows a recoverable error with a retry rather than a blank or broken week, and `Cette semaine` recovers to a clean current week.

---

## Dev seed extension

Bout 1's `scripts/seed-week.ts` seeds the owner's tasks for the current week and explicitly left the `work_schedule` seed to this bout. So the user can run `bun dev` and see a populated capacity meter, this bout extends that script to insert **one** `work_schedule` record for the owner: `work_minutes` 450, `work_days` `[1,2,3,4,5]`, `buffer_minutes` 60, and an `effective_from` on or before the seeded week (for example the first of the current month, or a fixed early date). Re-run safety follows the existing pattern: before inserting, delete the owner's existing `work_schedule` rows (or the one for that `effective_from`) so a second run replaces rather than accumulates. The seed is dev-only, never run by CI, a deploy hook, or app boot, and it is the developer's responsibility to point `.env` at a development database. With this record present the meter shows real numbers; with it absent the resolver's defaults produce the identical 450 / 60 figures anyway.

## i18n and copy

Every new visible string goes in the existing `planning` namespace in `i18n/locales/fr.json` and `i18n/locales/en.json`. FR is default and Québécois, EN is second. The mockup is the source of truth for the FR copy, so the strings below are taken from it verbatim and must not be re-guessed. None of the new strings contains `? ! : ;`, so the space-before-punctuation rule is respected but not triggered. English copy is researched, not machine-guessed: `planifié` reads as `planned`, `restant` as `remaining`, `en trop` as `over`, and the three states as `comfortable` / `in the buffer` / `overbooked`, matching the overview's own wording for the bands.

New keys, grouped under `planning`:

| Key | FR | EN |
| --- | --- | --- |
| `capacity.planned` | `{value} planifié` | `{value} planned` |
| `capacity.remaining` | `{value} restant` | `{value} remaining` |
| `capacity.excess` | `{value} en trop` | `{value} over` |
| `capacity.state.good` | `à l'aise` | `comfortable` |
| `capacity.state.warn` | `dans la marge` | `in the buffer` |
| `capacity.state.bad` | `surchargé` | `overbooked` |
| `nav.previousWeek` | `Précédente` | `Previous` |
| `nav.currentWeek` | `Cette semaine` | `This week` |
| `nav.nextWeek` | `Suivante` | `Next` |

The switcher uses visible text labels (per user feedback reversing the earlier chevron-only decision), so each button's accessible name is its own visible text. The chevron glyphs `‹` and `›` are rendered beside the text and are `aria-hidden`, decorative only. The middle-dot separator (` · `) between the booked figure and the remaining or excess figure is punctuation and is rendered by the component, not stored as translatable copy. The existing `planning.today` (lowercase `aujourd'hui`) stays the today-pill string and is not reused for the switcher button.

The Bout 1 off-day label is also corrected here as a copy change, since this slice already edits the `planning` namespace: the base label reads `Congé` (EN `Day off`) rather than `Jour non travaillé`, keeping the verbatim contextual suffixes (`Congé · début de la semaine` on Sunday, `Congé · le travail reste possible et bonifie le quota de la semaine` on Saturday, and plain `Congé` otherwise).

## Styling

Map the mockup onto the repo's five-theme semantic tokens and Hanken Grotesk per `my-styling-conventions`, never the mockup's raw `:root` palette. The semantic colour **roles** map as: `good` to the success role, `warn` to the warning role, `bad` to the danger role, plus the neutral `track` for the meter background. The hatched buffer band is a repeating diagonal gradient overlay as in the mockup's `.buffer`, using a token-derived low-opacity ink rather than a hardcoded `rgba`. Dark mode is respected in both directions. The meter, the reading, and the pill sit in the reserved `.cap` slot without reflowing the Bout 1 day header, and the switcher matches the `.navgroup` and the existing `.iconbtn` / `.ghostbtn` affordances already themed in the repo.

## Pure helpers to unit-test

These carry the load-bearing logic and are the target of the unit-test stage, which writes tests from this spec rather than from the code. All live in `shared/planning.ts` and are pure and DB-free.

- `resolveSchedule(records, date)`. Empty history and a date before the first record return `DEFAULT_SCHEDULE`; the greatest `effectiveFrom <= date` wins; the exact-boundary date resolves the new record; the result is order-independent; the returned `workDays` is a copy that does not mutate the constant.
- `sumEffectiveDuration(tasks)`. Sums `effectiveDuration` across a mix of tasks with `actualMinutes`, with only `estimatedMinutes`, and with neither (contributing `0`); an empty array is `0`.
- `computeCapacity(booked, workMinutes, bufferMinutes)`. Verifies each state boundary (`remaining > bufferMinutes` good, `remaining == bufferMinutes` warn, `remaining == 0` warn, `remaining < 0` bad), the `excess` value when overbooked, the `remaining` value when not, and the `fillPct` / `bufferPct` including the clamp at 100 % and the divide-by-zero guard when `workMinutes` is 0.

## Edge cases

- **Empty work-schedule history.** The user has no `work_schedule` rows yet, because the editing UI is on the settings page and out of scope here. `resolveSchedule` returns the defaults, so the capacity meter renders with 450 / 60 and nothing is broken.
- **Date before the first schedule record.** Resolves to the defaults rather than throwing, so a week far in the past still renders a meter.
- **Exact effective-date boundary.** A record effective on a date applies on that date, not the day after, so there is no one-day gap where the old value lingers.
- **A work day with no tasks.** `booked` is `0`, `remaining` is the full `workMinutes`, the state is `good`, and the reading is `0 h 00 planifié · {workMinutes} restant`. Normal, not an error.
- **A non-work day with logged work.** No meter, no overbooked state; the off-day hint stands and the rows render. The do-not-police rule holds.
- **A task with neither actual nor estimated minutes.** Contributes `0` to `booked` through `effectiveDuration`, so the meter never breaks on a null duration.
- **Non-trackable tasks in the booked sum.** A meeting or a break contributes its duration to `booked` (it eats the day) even though it produces no words, exactly as the overview specifies.
- **Overbooked day.** `booked > workMinutes` gives `remaining < 0`, the `bad` state, the fill capped at 100 %, and the reading showing the excess `en trop` in the danger colour, with the remaining figure suppressed.
- **Boundary states.** `remaining` exactly equal to `bufferMinutes`, and `remaining` exactly `0`, both render as `warn`, never `good` and never `bad`.
- **Degenerate `workMinutes` of 0.** The `fillPct` and `bufferPct` guards avoid a divide-by-zero; the state falls out of the same conditions (`booked > 0` gives `bad`, `booked == 0` gives `warn`).
- **A failed or superseded task refetch during paging.** Shows a recoverable error with retry, never a blank week; stale responses for a superseded range are discarded; `Aujourd'hui` always recovers to a clean current week. No interrupted navigation can strand the user.
- **Session expiry mid-navigation.** `GET /api/tasks` or `GET /api/me/work-schedule` returns `401` and the page routes to sign-in through the existing auth flow.
- **A week spanning a month or year boundary.** Paging with `addDays`/`getWeekRange` and labelling with `formatWeekLabel` already handle the month-spanning and year-spanning forms, so December-into-January weeks page and label correctly and their capacity meters resolve per date.
- **Corrupt or legacy `work_days` JSON in a schedule row.** The server read path coerces it (drop non-integers and out-of-range values, dedupe, allow empty), so a broken stored shape never reaches the resolver or the client raw.

## Stages

Specs and code review are never skipped. This bout runs specs, design, backend, frontend, accessibility, unit-test, code review, and commit.

- **Design** runs. It maps the capacity header and the switcher onto the semantic tokens and confirms the Québécois copy against the mockup.
- **Backend** runs. The `work_schedule` table and migration, the `loadWorkSchedule` read path, and the `GET /api/me/work-schedule` route and handler, plus the seed extension.
- **Frontend** runs. The capacity header in the reserved slot and the week switcher, wired to the resolver and the existing task refetch.
- **Accessibility** runs. The meter and the switcher are new interactive and informational UI, so they get the a11y pass: the reading text must convey capacity without relying on colour or the bar alone, the state pill must not be colour-only, and the switcher's chevron buttons must carry their accessible names.
- **Unit-test** runs. It covers `resolveSchedule`, `sumEffectiveDuration`, and `computeCapacity`.
- **SEO** is skipped. This is an authenticated dashboard behind sign-in, not indexable.
- **Compliance** is skipped. The bout reads the owner's own schedule and tasks behind the existing authentication, adds a schedule table holding the owner's own work-hours preferences (not a new class of third-party personal data), writes no task, and sends no email. The `tasks` compliance posture already covers the read path.

## Assumptions made

Recorded here because the build after approval runs hands-off.

- **The state thresholds follow the overview verbatim:** `good` when `remaining > bufferMinutes`, `warn` when `0 <= remaining <= bufferMinutes`, `bad` when `remaining < 0`. This uses the overview's `>` at the good boundary, so `remaining == bufferMinutes` is `warn`. Where the task brief suggested `>=`, the overview and the mockup are followed instead.
- **The switcher uses three text buttons**, `‹ Précédente`, `Cette semaine`, and `Suivante ›`, with the chevron glyphs `aria-hidden` beside the visible text. The user reversed the earlier chevron-only icon-button decision, so each button's accessible name is its own visible text. The middle button reads `Cette semaine` rather than `Aujourd'hui`.
- **`PLAN-05` sources `workMinutes` and `bufferMinutes` from the resolved `work_schedule`,** and continues to source work-day classification (whether a date is a work day, which decides off-day rendering) from `settings.workDays` via `GET /api/me/work-settings`, unchanged from Bout 1. Both default to `[1,2,3,4,5]`, so they agree today. Unifying work-day classification onto the resolved schedule's `workDays` is deferred to `PLAN-22` (the quota engine, which needs history-safe day classification) and to the settings page, which must write `settings` and `work_schedule` in sync. This keeps the slice tight without a visible regression.
- **The schedule is read client-side and resolved with the shared resolver.** `GET /api/me/work-schedule` returns the coerced history records once, and the client resolves each visible day with `resolveSchedule`, so paging weeks refetches only tasks. This exercises the one shared resolver on both sides.
- **The resolver defaults are 450 / `[1,2,3,4,5]` / 60,** derived from the existing settings defaults and the overview's buffer default, so an empty history matches the mockup's day length exactly.
- **The unique index on `(user_id, effective_from)`** prevents duplicate-date records at the DB level and doubles as the resolution index. Inserts are the settings page's job (out of scope here).
- **The seed inserts one `work_schedule` record** for the owner so `bun dev` shows a populated meter, re-run safe, dev-only.
- **The read endpoint lives under `/api/me/`** (`work-schedule.get.ts`), matching `work-settings.get.ts`, as a per-user read.

## Out of scope

- **The running quota** (the live intraday pace) and any quota computation. That is `PLAN-22` and later. This slice computes only booked / remaining / excess capacity, not the availability quota.
- **Editing the work schedule or the buffer.** The `work_schedule` table is read-only here; the create/update UI lives on the settings page (another agent). This bout ships no write endpoint.
- **Any task write** (add, edit, delete, status cycle, reorder, move, copy, split). Those are Phase 2 and 3 features.
- **The view switcher, the day view, the stats band, import/export, drag and drop, and the expand-to-edit editor**, all owned by their own `PLAN` ids.

## Open questions

None block the build. The three trackable status names, the row field set, and the buffer default are already settled in `overview.md` and Bout 1. The unification of work-day classification onto the resolved schedule is a recorded follow-up for `PLAN-22` and the settings page, not a blocker here.
