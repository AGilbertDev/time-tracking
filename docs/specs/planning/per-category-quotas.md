# Per-category quotas

`PLAN-32b`. Depends on `PLAN-32a`. Shared contract, backend, two migrations, and the settings and
onboarding UI.

## Intent

A quota is a property of a kind of work rather than a property of the user, so the single global
`settings.quota_wph` cannot describe four kinds of work at once. This feature makes the quota a user
setting tied to the category, stores it in its own effective-dated table, resolves it server-side,
gives the settings page a section for editing it, and retires the global column and every reader of
it.

The owner's words, which are the shape this document records rather than reopens.

> since categories are now custom and expandable, I want quotas to be a user setting that is tied to
> the category.

Two things follow from that sentence and both are load-bearing. The quota belongs to the category, so
it is keyed by category id rather than living as one number per user. And it is a user setting rather
than a constant, so a shipped default is a starting value the user can change rather than a figure
baked into code.

What this feature does **not** do is compute anything with a quota. The engine that divides words by
hours is `PLAN-22` and the per-category stats rows are `PLAN-23`, so this feature ships the storage,
the resolver, the API, the settings UI, and the removal of the global, and stops there. The reasoning
behind the numbers and behind the per-category shape is in
[`overview.md`](overview.md#one-quota-per-category-not-one-quota-for-everything) and
[the quota is buckets](overview.md#the-quota-is-buckets-one-per-category-measured-against-time-spent),
and is not re-argued here.

## Inputs

### The locked decisions this implements

1. **One quota per category rather than one for everything**, decided 2026-07-28 and recorded in
   [one quota per category](overview.md#one-quota-per-category-not-one-quota-for-everything). The
   change came from the owner describing how the work is actually targeted, so the global setting was
   wrong in shape rather than wrong in value, which is why the column retires instead of getting a
   better default.
2. **A quota is measured against the time spent in its own category**, decided 2026-07-29 and
   recorded in
   [the quota is buckets](overview.md#the-quota-is-buckets-one-per-category-measured-against-time-spent).
   Nothing in this feature performs that division, and the decision matters here only because it
   means there is no shared pool left to split and therefore nothing open for this feature to decide.
3. **The four shipped defaults and the direction of the revision pair**, from
   [the category set](overview.md#the-category-set-and-the-real-quotas-from-the-user).
4. **The table shape and the resolution order**, decided by the owner and reproduced in full below.
5. **The mandatory convention headed "Any list is customizable, modular, and extensible"**, in
   [`.recipes/CLAUDE.md`](../../../.recipes/CLAUDE.md). It arrived mid-run, after the shape above was
   agreed, and it changes none of it. What it changes is the standing of the choices, which are a
   named requirement the design is measured against rather than a happy consequence. The section
   [the extensibility rule](#the-extensibility-rule-and-where-each-choice-satisfies-it) goes through
   them one by one.

### The design blueprint

[`per-category-quotas-design.md`](per-category-quotas-design.md), filed by the design stage after this
spec's first pass. It answers the one question this spec left to it, and it found four places where
this spec was wrong. Three are corrected here in `AC7`, `AC8`, and assumption 3, each marked as
amended after the design stage, and the fourth is a shorthand this spec now states properly. Where a
criterion below and the blueprint disagree, this document is what the review stage reads, so the
correction lands here rather than only there.

### The shipped code this changes

- `shared/categories.ts`, the ten-member category contract. `DEFAULT_CATEGORY_IDS` (L57 to L68) and
  `DEFAULT_CATEGORIES` (L125 to L136) are the declaration site for every per-category fact, and the
  descriptor carries `trackable`, `deliverable`, and `hue` today.
- `server/db/schema.ts`. `settings.quotaWph` at L45 is the column that retires, and `workSchedule` at
  L189 onward is the effective-dated pattern the new table copies.
- `server/utils/loadWorkSettings.ts`, whose `WorkSettings` interface, `DEFAULT_QUOTA_WPH` constant,
  and select list all carry the global quota.
- `server/models/work-settings.ts`, which owns `quotaWphSchema` and includes `quotaWph` in
  `WorkSettingsPatchSchema`. **The validator itself survives**, because `server/models/tasks.ts` L240
  reuses it for `quotaWphOverride` and the new per-category write path reuses it again.
- `server/models/onboarding.ts` and `server/api/onboarding/handlers/complete.ts`, which capture and
  persist the global quota during the wizard.
- `server/api/me/handlers/saveWorkSettings.ts`, `app/pages/settings.vue`,
  `app/components/settings/work-fields.vue`, `app/pages/onboarding.vue`,
  `app/components/onboarding/step-work.vue`, `app/composables/useOnboardingForm.ts`, and
  `app/composables/useCompleteOnboarding.ts`.
- `scripts/seed.ts`, `test/helpers/taskTestDb.ts`, and the four test files listed under `AC3`.

### The surviving field this must not be confused with

`tasks.quota_wph_override` stays exactly as it is. It is the per-task exception to the category's
quota, it is written by the task editor
([`TaskEditor.vue`](../../../app/components/planning/TaskEditor.vue) field 11), it is validated by
`quotaWphSchema`, and it is the first step of the resolution order below. Every file that touches only
the override keeps it unchanged, which is `server/api/tasks/handlers/write.ts`, `projection.ts`,
`server/models/tasks.ts`, `app/utils/taskEditor.ts`, and `TaskEditor.vue`.

## The shape the owner decided

### The table

```
category_quotas
  id             text primary key
  user_id        text not null -> users.id, on delete cascade
  category_id    text not null, the shared ten today, any user-created id later
  quota_wph      integer not null
  effective_from text not null, 'YYYY-MM-DD', matching work_schedule
  created_at     integer, Unix seconds
  updated_at     integer, Unix seconds
  unique (user_id, category_id, effective_from)
```

The `id` primary key is the one addition to what was agreed, and it is a consistency choice rather
than a change of shape. Every table in `server/db/schema.ts` carries a `text` primary key defaulted
through `$defaultFn(() => crypto.randomUUID())`, `work_schedule` included, so the new table matches
its sibling exactly and the unique index carries the real identity of a row.

### Why not a quota column on a categories table

There is no per-user category record to put a column on. Categories are a code contract in
`shared/categories.ts`, ten frozen descriptors with no table behind them, so "a quota column on the
category" would mean building the categories table first. That table is `PLAN-30`, it is a feature
with its own spec, and absorbing it here would break the one-feature-per-pull-request rule for
exactly the reason that rule exists, which is that the spec every later stage reads would stop
describing what is being built.

**So `PLAN-30` is not built here and not specced here.** No `categories` table, no user-created
category, no category form, no per-user id validation.

### Why a standalone table keyed by category id

Because `category_id` is free text, the table already accepts an id that does not exist yet. When
`PLAN-30` lands and the user creates their own category, a quota for it is an insert rather than a
migration, and nothing about this table has to change. That is the same seam
`CategoryId = DefaultCategoryId | (string & {})` already keeps open in the contract, expressed in the
database rather than only in the type.

The cost of that freedom is that a stored row can name a category the app does not know, which the
edge cases below handle rather than prevent.

### Why the effective dating copies work_schedule

`AC2` requires effective dating regardless of the table's shape, because editing a quota must not
restate a period that has already been reported. The repo already has that pattern for exactly this
purpose. `work_schedule` is SCD Type 2, one row per effective date, `effective_from` held as
`'YYYY-MM-DD'` text so lexicographic order equals chronological order, and resolution is an
index-friendly range scan over `(user_id, effective_from)`. The reasoning is written out in
[`0005_add_work_schedule_table.sql`](../../../server/db/migrations/0005_add_work_schedule_table.sql)
and it applies here unchanged.

Following it rather than inventing a second pattern is the whole point. A second arrangement for the
same problem in the same database is two things to learn and two things to get wrong.

### The four shipped defaults

| Id                  | Trackable | Default quota (words per hour) |
| ------------------- | --------- | ------------------------------ |
| `translation`       | yes       | 240                            |
| `revision_internal` | yes       | 1000                           |
| `revision_external` | yes       | 1300                           |
| `proofreading`      | yes       | 2000                           |

The other six ids (`terminology`, `meetings`, `breaks`, `admin`, `dtp`, `other`) are non-trackable and
carry no quota at all.

**External revision is deliberately the faster number.** 1300 for external against 1000 for internal
looks like a transposition and it is not one, and it is recorded here as well as in
[the category set](overview.md#the-category-set-and-the-real-quotas-from-the-user) so that no later
reader "fixes" it. Revising work that came from outside is expected to move quicker than revising work
from inside. Any stage that swaps these two numbers is undoing a decision rather than correcting a
typo.

These are ordinary configurable defaults. They are the values a user starts with, every one of them is
editable from the settings page the moment this feature ships, and no reading of the app depends on
them staying what they are.

They live in the shared contract as code, on the category descriptor, so a fresh user with zero rows
in `category_quotas` still resolves working quotas for all four trackable categories. There is no
bootstrap step, no seeding requirement, and no state in which a trackable category has no answer.

### The resolution order

For a single task, server-side, in this order.

1. `tasks.quota_wph_override`, when it is not null.
2. The user's `category_quotas` row for that category whose `effective_from` is the latest date less
   than or equal to the task's `date`.
3. The shipped default for that category, from the contract.
4. None, when the category is not trackable.

**Step 4 is a gate rather than a last resort, and the difference is real today.** Read as written, the
list would hand a non-trackable task its override, because step 1 fires before step 4 is ever
reached. The app can produce that row right now, since the editor shows the quota field for every
category on purpose ([`TaskEditor.vue`](../../../app/components/planning/TaskEditor.vue) field 11,
"Shown for every category rather than hidden on some"), so a user can type an override onto a meeting.
The resolver therefore checks `isTrackableCategory` first and returns none for a non-trackable
category whatever else the row holds. That is the same fail-closed direction the contract already
documents for `isTrackableCategory`, which is that words must never reach a quota numerator by
accident.

The stored override is left alone rather than cleared, so recategorizing the row to a trackable
category brings the override back with it. Nothing is destroyed to enforce the gate.

**Nothing in this resolution happens in a Vue component.** The server resolves and the client is
handed finished figures, per the project's logic-belongs-to-the-backend rule.

### The extensibility rule, and where each choice satisfies it

The conventions carry a mandatory rule headed "Any list is customizable, modular, and extensible". A
set of named things is user-owned data rather than constants in a file, so assume from the first
version that the set will grow, that a member will be renamed, that one will be retired without
deleting the rows that reference it, and that the user will want their own on top of whatever ships.
Paying for that on the way in costs almost nothing, and retrofitting it is a migration plus a
contract change plus a rewrite of everything that switched on the old members.

The rule is a requirement this design is measured against rather than a property it happens to have,
so each choice is listed here against the part of the rule it satisfies.

- **The quota table is keyed by `category_id` as free text rather than by a foreign key to a category
  record.** This is the rule's "key related settings by the member's id so a member that does not
  exist yet is already accepted", almost literally. A quota for a category nobody has created yet is
  already storable today.
- **`PLAN-30` therefore needs no migration to this table.** When user-created categories arrive, a
  quota for one is an insert. No column is added, no constraint is relaxed, and no stored row is
  rewritten. The same seam `CategoryId = DefaultCategoryId | (string & {})` keeps open in the type is
  expressed in the database rather than only in TypeScript.
- **`defaultQuotaWph` is declared explicitly on all ten descriptors rather than resolved by a lookup
  that special-cases the trackable four.** This is the rule's "give a member its own declared flags
  rather than letting code special-case one id, because a user-created member inherits the flags and
  cannot inherit the special case". It is the same reason `deliverable` is declared on all ten rather
  than derived from `trackable`, and the same reason an id comparison against `other` is not an
  acceptable substitute for either flag.
- **The display names stay in the i18n layer keyed by id.** This is the rule's "keep the display name
  in the i18n layer keyed by id, never in the stored value, so renaming a label never touches data".
  This feature adds no display name to the contract, and it labels each settings input from the
  existing `categories.<id>` key, so renaming a category renames its own quota field with no edit
  here and no stored value touched.
- **The accessor is total and coerces an unknown id.** This is the rule's "a member will be retired
  without deleting the rows that reference it". A stale or unknown id resolves through
  `coerceCategory` to `other` and therefore to no quota, so a retired member leaves working code
  behind rather than a crash or a wrong number.
- **The unique key is `(user_id, category_id, effective_from)`.** No ordinal, no positional index, and
  no column named after a category. A fortieth category is more rows rather than a schema change.
  The shape this rule exists to prevent is the one being retired here, which is a fixed set of
  per-category columns on the settings row.
- **The resolution order ends in a shipped default rather than in a required row.** A category with no
  stored quota still resolves, so growth never depends on a bootstrap step or a backfill.

**What a user-created category inherits for free under this shape.** A storable quota with no
migration, effective dating on it, a label resolved from i18n by its own id, a colour that is
readable by construction anywhere on the hue circle (already guaranteed by `PLAN-32c`), the
fail-closed unknown-id path, and erasure through both the purge and the cascade.

**What it does not inherit, and must therefore declare.** Its own `trackable` and `deliverable` flags,
and its own quota. There is no shipped default for an id outside the four, so `defaultQuotaWph`
returns `null` for a user-created trackable category and the resolver has no third step to fall back
on. `PLAN-30` has to collect a quota when the user creates a trackable category, or decide its own
default at that moment. That is a hand-off note rather than scope here, and it is the one thing this
feature genuinely cannot pre-answer, because a number for a kind of work nobody has described yet
would be invented.

**One part of the design is in tension with the rule, and this feature does not resolve it.** The
categories themselves are still a code union in `shared/categories.ts`, ten frozen descriptors with no
table behind them, and the rule argues against exactly that. Turning them into per-user rows is
`PLAN-30`'s data model, and whether that comes into this feature or stays next is the owner's call
rather than this spec's, so it is recorded as open question 1 below and left there. The quota table is
correct either way, which is the whole point of keying it by id.

The rule's own second limit is what keeps this from widening the feature. It does not license building
a management screen before the feature that needs one, and it does not override one feature per pull
request.

## Scope

### What ships

- The `defaultQuotaWph` field on the category descriptor and its accessor, in `shared/categories.ts`.
- The `category_quotas` table, its Drizzle definition, and two migrations.
- A server read path over the table and a pure resolver, both unit-tested.
- `GET` and `PATCH /api/me/category-quotas`.
- A Quotas section on the settings page that edits one figure per trackable category.
- The removal of `settings.quota_wph` and every reader of it, including the onboarding field.
- The purge path erasing the new table.
- FR and EN copy for everything new, and corrections to the copy the removal falsifies.

### Non-goals, each stated so a build stage cannot drift into it

**`PLAN-22`, the quota engine, is not here.** Nothing divides words by hours, nothing sums a bucket,
and no stat changes. The resolver this feature ships is what `PLAN-22` will call.

**`PLAN-23`, the per-category stats rows, is not here.** No new display of a quota anywhere except the
settings page section that edits it.

**`PLAN-30`, user-created categories, is not here.** No `categories` table, no category form, no
per-user id validation. The extensibility rule does not change this, because its own second limit says
the data model accepting growth is the point rather than every screen shipping at once, and it does not
override one feature per pull request. The quota table accepts an id `PLAN-30` has not created yet, and
that is this feature's whole obligation to it.

**No estimate derivation.** `estimated_minutes` stays exactly as it is, stored verbatim and never
computed, per the note in `server/models/tasks.ts` L241 to L244. That derivation is `PLAN-12`'s and it
needs decisions this feature does not take.

**No quota on the task read projection.** See the consumer decision below.

**No date picker in the settings UI.** The API accepts an explicit `effectiveFrom` and the UI does not
send one, so an edit is always effective from today. The mechanism is there for a deliberate
correction and for `PLAN-30`, and shipping a date control with it would be a second question to answer
on a settings form for a case the user does not have yet.

**No quota history view.** The table keeps the history and nothing displays it. `PLAN-23` is where a
past period's figure becomes visible, and showing a list of past quotas before any stat reads them
would be a screen with nothing to say.

### The resolver's consumer, decided

**The resolver ships with unit tests and no per-task consumer. The only shipped consumer of stored
quota rows is the settings API's own read.** The task read projection gains no quota field.

Three reasons, and the smaller surface is the deciding one.

1. **Nothing would read it.** The row does not print a quota, the editor does not print one, and no
   stat exists yet. A field on a shipped API contract that no client reads is a contract this feature
   would have to keep correct for nobody's benefit.
2. **`PLAN-22` may not want it per row.** A bucket is words in a category over hours in that category,
   which is a period-level figure resolved once per category and date rather than once per task. A
   per-row field shipped now would be built against a guess about a consumer that does not exist.
3. **The shipped guard test forbids it, and that guard is correct.**
   `test/server/api/tasks/write-boundary-guards.test.ts` asserts that no file under
   `server/api/tasks/` mentions `quotaWph` beyond the override passthrough, and the reason recorded
   there is that the only quota available was the wrong global one. Putting a resolved quota under
   `server/api/tasks/` means amending that guard, so the smaller surface is also the one that leaves a
   deliberate protection alone. `PLAN-22` amends it when it has a reader.

`AC1` is demonstrable either way, and here it is demonstrated by unit tests over the pure resolver
plus the resolved figures the settings `GET` returns. That makes the resolver's tests a requirement of
this feature rather than a nice-to-have, which `AC10` states.

The honest cost is that `resolveTaskQuota` has no runtime caller until `PLAN-22`, so it is tested code
with no production path through it. That is accepted deliberately. The resolution order is a decided
rule, writing it once with tests now is what stops it being re-derived under pressure later, and the
alternative costs a contract change plus a guard amendment to gain a field nothing reads.

## Outputs and acceptance criteria

### AC1. Every trackable category resolves its own quota, and every non-trackable one has none

The `Category` descriptor in `shared/categories.ts` gains `defaultQuotaWph: number | null`, and every
one of the ten descriptors declares it explicitly rather than taking a default, for the same reason
`deliverable` is declared explicitly on all ten. The four trackable ids carry the four numbers from
the table above and the six non-trackable ids carry `null`.

An accessor mirrors the existing ones, `defaultQuotaWph(id)`, coercing the id first through
`coerceCategory` so an unknown or stale value resolves to `other` and therefore to `null`. That keeps
the function total and fails closed, exactly as `categoryHue` and `isTrackableCategory` do.

`defaultQuotaWph` is **not** a substitute for `trackable` and neither is derived from the other.
`trackable` stays the answer to whether words reach a quota, and the number is a number. For the ten
defaults the two agree, and a test asserts that agreement as a consistency check on the contract,
which is not the same as deriving one from the other.

The resolver returns none, expressed as `null`, for every non-trackable category, whatever the stored
rows or the task's override say. Verifiable by unit tests over all ten ids.

### AC2. The quota is effective-dated, and an edit never restates a past period

Editing a quota inserts or updates the row for the effective date being edited and never touches a row
with an earlier `effective_from`. Resolving a date before the earliest stored row for a category
returns the shipped default, so there is no discontinuity and no gap.

Verifiable by a resolver test that reads a category on three dates against a two-row history and gets
the pre-history default, then the first value, then the second. The property to assert is that adding a
row dated today changes nothing about what any earlier date resolves to.

An `effectiveFrom` in the past is accepted by the API and is a deliberate correction rather than a
mistake to block. The guarantee `AC2` makes is about the mechanism, which is that an ordinary edit
writes a new dated row instead of mutating the old one. The app never backdates on its own, the UI
never sends a past date, and the project's do-not-police rule means a user who explicitly asks to
correct a past period gets to.

A future `effectiveFrom` is accepted for the same reason and resolves for dates from that day onward.

### AC3. `settings.quota_wph` is gone, with no reader left behind

The column leaves the schema and every reader leaves with it. The exhaustive list, from a tracked-file
search rather than from memory.

**Server.**

- `server/db/schema.ts` L45, the column definition.
- `server/utils/loadWorkSettings.ts`, the `quotaWph` field on `WorkSettings`, the
  `DEFAULT_QUOTA_WPH` constant, the select entry, and both return branches.
- `server/models/work-settings.ts`, the `quotaWph` entry in `WorkSettingsPatchSchema` and the
  matching clause in its non-empty refine. **`quotaWphSchema` itself stays**, because
  `server/models/tasks.ts` reuses it for the task override and the new per-category write path reuses
  it again. Its comment stops calling it "the same quantity as the global setting" and names the
  per-category quota and the task override instead.
- `server/models/onboarding.ts`, the `quotaWph` field on `CompleteOnboardingSchema` and its import.
- `server/api/onboarding/handlers/complete.ts`, the `quotaWph` entry in `settingsValues`.
- `server/api/me/handlers/saveWorkSettings.ts`, the `quotaWph` field on the values type and the line
  that maps it.

**Client.**

- `app/pages/settings.vue`, the field on the local `WorkSettings` interface, the reactive default, the
  `watchEffect` assignment, the PATCH body entry, and the `v-model:quota-wph` binding.
- `app/components/settings/work-fields.vue`, the `quotaWph` `defineModel` and its `UFormField`.
- `app/pages/onboarding.vue`, the form default and the submit payload entry.
- `app/components/onboarding/step-work.vue`, the `UFormField`.
- `app/composables/useOnboardingForm.ts` and `app/composables/useCompleteOnboarding.ts`, the field on
  each interface.

**Tests and scaffolding.**

- `test/server/models/work-settings.test.ts`. The `quotaWphSchema` block stays, because the schema
  stays, and its comment stops describing the schema as the `quota_wph` column's validator. The
  `WorkSettingsPatchSchema` cases that send `quotaWph` go.
- `test/server/utils/loadWorkSettings.test.ts`. Every `quotaWph` expectation and row fixture.
- `test/server/models/onboarding.test.ts`. The `quotaWph` payload field and the whole
  `quotaWph bounds` describe block, which is covered by the surviving schema's own tests.
- `test/helpers/taskTestDb.ts`. The `quota_wph integer DEFAULT 450 NOT NULL` line in the inline
  `settings` DDL, the `quotaWph = 450` parameter, and the insert that uses it.
- `test/server/api/tasks/write-boundary-guards.test.ts`. The guard itself stays and still passes. Its
  comment currently explains itself by saying the only quota available is the global one, which stops
  being true, so the comment is rewritten to say the per-category resolver exists and that
  `PLAN-22` is the feature that gets to read it here.
- `scripts/seed.ts` writes no `quota_wph` today and gains nothing, so nothing about the global is
  removed from it. What it does gain is `AC11`.

**Verified by grep rather than by assumption**, and the search has to be run correctly for the result
to mean anything.

- Run it as `git ls-files -z | xargs -0 grep -n 'quotaWph\|quota_wph'` rather than as `grep -r`. There
  are stale, untracked, gitignored worktree directories under `.claude/worktrees/` holding old copies
  of app files, and a recursive grep reports phantom readers from them.
- Keep `2>&1` on the search and read the error text. An empty result from a mistyped path reads
  exactly like a clean pass.
- The only surviving matches are `quotaWphOverride` and `quota_wph_override`, the schema `quotaWphSchema`
  and its call sites, and prose in `docs/`.

**The number 450 is not the search term, and this trap is worth stating in full.**
`settings.daily_work_minutes` also defaults to 450, because 450 minutes is a seven and a half hour
day, and **that column stays**. So does `DEFAULT_DAILY_WORK_MINUTES` in `loadWorkSettings.ts`, the
`450` in `DEFAULT_SCHEDULE` in `shared/planning.ts`, the `work_schedule.work_minutes` seed value, and
every 450 in the daily-minutes tests. A grep for `450` hits all of them and none of them is this
feature's business. Search for the identifier, never for the number, and when a `450` does turn up,
read which quantity it belongs to before touching it.

### AC4. The research note reads as context, and the retirement line reads as done

This is a verify-and-tidy criterion rather than a rewrite, because most of it is already done.

The research note in [`overview.md`](overview.md#research-notes) already carries its correction, which
is that published throughput norms no longer support the 450 default and that the claim they did was
wrong, and it already says to read the norms as context for what a CAT tool reports rather than as
evidence for a default. **Confirm that wording still stands and leave it alone.**

What is left is one forward-looking sentence, "Once quota is a per-category setting, the global default
retires with it", which becomes past tense the moment this ships. It moves to saying the global default
retired in `PLAN-32b` and links here.

Nothing else in the overview's research section changes, and no source is removed. The rest of that
note still supports what it always supported, which is that effective hours are fewer than clock hours.

### AC5. Two migrations, in the order the deploy needs

**Two numbered files, not one.**

- `0010_create_category_quotas.sql`, the expand half. `CREATE TABLE IF NOT EXISTS category_quotas`
  with the columns above and the cascading foreign key, then
  `CREATE UNIQUE INDEX IF NOT EXISTS category_quotas_user_id_category_id_effective_from_idx ON category_quotas (user_id, category_id, effective_from)`.
  Both statements are separated by the `--> statement-breakpoint` marker the runner splits on, and
  both are idempotent through `IF NOT EXISTS`, matching `0005`.
- `0011_drop_settings_quota_wph.sql`, the contract half. `ALTER TABLE settings DROP COLUMN quota_wph`.
  SQLite has supported `DROP COLUMN` since 3.35 and `quota_wph` is not a primary key, not unique, not
  indexed, and not referenced by a constraint or a generated column, so the drop is permitted rather
  than needing a create-copy-swap. There is no `IF EXISTS` for `DROP COLUMN` in SQLite, so re-running
  is guarded by the runner's ledger alone, which is the same arrangement `0007` and `0008` rely on.

**Why two files rather than one.** The ledger records a file only after every statement in it has
succeeded ([`scripts/apply-migrations.ts`](../../../scripts/apply-migrations.ts)), and it is keyed on
the filename with no checksum. One file holding both statements could therefore leave the table
created and the file unrecorded, with no way to resume except by editing SQL that has already run in
part. Two files also let the ledger express the state the deploy actually sits in, which is create
applied and drop pending. That state exists on purpose and a single file cannot represent it.

**The apply order, and the window it leaves.**

1. Apply `0010`. The old build does not know the table exists, so this changes nothing for it.
2. Deploy the new build. `quota_wph` still exists at this point, and it is `NOT NULL` with a
   database-level `DEFAULT 450`, so the new build's settings insert and the onboarding insert both
   succeed without naming it. This is what makes the window zero rather than merely short.
3. Apply `0011`. The new build never mentions the column.

The evidence for step 2 is in the migration history rather than assumed.
[`0000_persist_user_preferences.sql`](../../../server/db/migrations/0000_persist_user_preferences.sql)
inserts `settings` rows naming only `id`, `user_id`, and `locale`, which can only succeed if every
other `NOT NULL` column on that table carries a database-level default, and
`test/helpers/taskTestDb.ts` mirrors the column as `quota_wph integer DEFAULT 450 NOT NULL`. Confirm
it directly with `PRAGMA table_info(settings)` against the target database before relying on the
ordering, since the `settings` table predates the migration files and no tracked migration created
that column.

**The runner does not enforce the split for you.** `bun run apply-migrations --yes` applies every
pending file in filename order in a single pass, so running it once between two deploys applies both
halves at once. That order is not wrong, it just reintroduces a window in which the old build's
settings read and settings save both fail, the same window
[`0008`](../../../server/db/migrations/0008_drop_tasks_words_done.sql) accepted, and the read side is
already covered by the settings page's error state and its `Réessayer` control. The deploy is the
owner's own and there is one real user, so the three-step order above is realistic and is the
instruction. Both headers say so.

**Undo.**

- `0011`. `ALTER TABLE settings ADD quota_wph integer NOT NULL DEFAULT 450;` restores a working old
  build in one statement. SQLite permits a `NOT NULL` `ADD COLUMN` when a non-null default is given,
  which this has. The contents are gone, which costs nothing for the reason in the data decision
  below.
- `0010`. Nothing to undo. The old build does not know the table, so a rollback leaves it in place.
  `DROP TABLE category_quotas` is only correct before the user has saved a quota, and after that it
  destroys their settings, so the undo is deliberately to do nothing.

**Both headers carry the standing notes**, matching `0005` and `0008` word for word in intent. `DO NOT
auto-run this against production`, because there is one real user and these are applied by hand by the
owner against the production Turso database. `DO NOT renumber or rename this file once applied
anywhere`, because the ledger is keyed on the filename with no checksum, so a rename replays the file
and the runner tolerates no error. Plain statement-broken SQL with a long comment header, because the
project keeps no drizzle-kit meta snapshot directory.

**What happens to the existing data, decided.** The stored `settings.quota_wph` value is **discarded**
rather than migrated into any `category_quotas` row.

Three reasons, and the first is sufficient on its own.

1. **Carrying it forward would propagate a number the owner has ruled wrong.** The value is the global
   450 default, and the overview records that default as wrong rather than merely stale. Writing it
   into four per-category rows would put a rejected figure into the new table on day one, and it would
   then look like a decision rather than a leftover.
2. **A global figure cannot be split without inventing the split.** One number covering four kinds of
   work carries no information about any one of them, so attributing it to a category would be an
   invention. That is the same argument that stopped `PLAN-32a` writing a `revision` to
   `revision_internal` mapping into a permanent migration.
3. **Zero rows is a working state, not an empty one.** The shipped defaults resolve for every
   trackable category, so a user with no rows sees four sensible figures rather than a blank form.
   There is nothing for a backfill to rescue.

**Read the value out before dropping it, and write it down.** The production row cannot be read from
the container this is built in, so if it holds something other than 450 the owner is the only one who
can see it. `SELECT quota_wph FROM settings` into the pull request before applying `0011` costs one
query and makes the discard a decision rather than a loss. **The pull request body carries the actual
figure the query returned, not a statement that somebody checked it**, and it is recorded before
`0011` is applied rather than afterward. A claim that the value was verified is not the value, and
only the value survives in the history as evidence of what was discarded. If it does hold a figure
other than 450, the discard still stands on reason 2, and the owner can type it into whichever
category it belonged to on the new settings section in a few seconds.

### AC6. The API resolves and returns finished figures

**`GET /api/me/category-quotas`.** Returns one entry per **trackable** category, in contract order,
each already resolved for today in the user's stored timezone.

```
[{ categoryId: string, quotaWph: number, source: 'user' | 'default', effectiveFrom: string | null }]
```

- Non-trackable categories are **absent** rather than present with a null quota. That is `AC1`
  expressed as absence, and it means the client renders what it is handed instead of filtering on
  `trackable` itself.
- `source` says whether the figure came from a stored row or from the shipped default, and
  `effectiveFrom` is the date of the winning row or `null` for a default. Both exist so the client
  never infers either. A page comparing a figure against a hardcoded default to decide what to label
  it would be a second copy of the rule, which is the duplication the conventions forbid.
- Today is computed with `todayInZone` from `shared/planning.ts` against the timezone from
  `loadWorkSettings`, so no date arrives from the client and no client clock decides which quota is
  current.
- The read is always scoped to the session user, never to an id from the request, matching
  `getWorkSchedule`. An unauthenticated request is a `401` through
  `defineAuthenticatedEventHandler`.

**`PATCH /api/me/category-quotas`.** Body is `{ effectiveFrom?: 'YYYY-MM-DD', quotas: [{ categoryId, quotaWph }] }`.

- `quotas` holds at least one entry, no duplicate `categoryId`, each `categoryId` a trackable
  category id, each `quotaWph` validated by the existing `quotaWphSchema` (integer 1 to 10000). The
  floor of 1 matters for the same reason it matters on the task override, which is that the quota is
  the divisor in `estimated = words / quota` and 0 would store a row that divides by zero the moment
  `PLAN-12` reads it.
- A non-trackable `categoryId` is rejected with a `422`. That is a data-validity rule rather than
  policing, because a non-trackable category has no quota by definition, so the row would be
  meaningless rather than unusual.
- `effectiveFrom` is optional, validated by the `calendarDaySchema` the task write boundary already
  uses so the shape and real-date rules cannot drift, and defaults to today in the user's timezone.
  If reusing it from `server/models/tasks.ts` reads as the wrong import direction, extract it to a
  shared server model rather than writing a second copy, which is exactly what the work fields did
  when they moved into `models/work-settings.ts`.
- The write upserts on `(user_id, category_id, effective_from)`, so saving twice on the same day
  updates that day's row instead of piling up rows the resolver would have to disambiguate. The unique
  index is the conflict target.
- Partial by design, like `saveWorkSettings`. Only the categories present in the body are written and
  the others are untouched.
- The response is the same shape the `GET` returns, read back through the single read path, so the
  client reconciles against what the database actually holds. That is the `saveWorkSettings` idiom.
- Validation errors go through `sendZodError` as a `422` with per-field data, and there is no other
  error surface.

**The read path and the resolver.**

- `server/utils/loadCategoryQuotas.ts` reads a user's rows ordered by `effective_from` ascending and is
  the single read path behind both handlers, mirroring `loadWorkSchedule.ts`.
- The pure resolution lives in `server/utils/`, **not in `shared/`**, and is unit-tested directly.
  This is a deliberate departure from how `resolveSchedule` was done. That function is pure and lives
  in `shared/planning.ts`, and `app/pages/index.vue` calls it, so the client resolves the schedule
  itself. A pure resolver in `shared/` is an open invitation to do that, and there is no second
  consumer here that needs it on the client, because the API returns finished numbers. Keeping it
  server-side is what makes "no quota is computed in a component" enforceable rather than hoped for.
- The resolved shape is declared once, next to the read path, the way `WorkSettings` is declared in
  `loadWorkSettings.ts`. The settings page types its own `useAsyncData` interface locally exactly as it
  already does for work settings, which is the shipped idiom rather than a third arrangement, and the
  small duplication that comes with it is inherited knowingly rather than introduced here.

### AC7. The settings page edits every trackable category's quota, and onboarding stops asking

**Settings.** A new section on `app/pages/settings.vue`, alongside Work and Security, loading from
`GET /api/me/category-quotas` and saving with one `PATCH`. It follows the shipped section idiom
exactly, which is `useAsyncData` with the SSR cookie header forwarded, a reactive editable copy seeded
through `watchEffect`, a `USkeleton` block while pending, a `UAlert` with a retry control on load
failure, a `UForm` with `UFormField` and `UInputNumber` per row, and a toast on success or failure.
The three sections save independently, so saving quotas never touches work settings.

One numeric input per entry the API returned, in the order it returned them, labelled with the
category name from the existing `categories.<id>` i18n key so the label cannot drift from the row's
own name. Each input takes a `min` of 1 matching the schema.

**The count is not part of the criterion.** This section used to say "the four quotas" throughout,
which was shorthand for today's four trackable defaults and read as a requirement. It is neither. The
form renders whatever the response holds, one row or forty, so nothing here may be built as a
four-field form. That is the extensibility rule applied to this screen rather than a new requirement,
and the phrasing is corrected because the design stage rightly flagged that the old wording invited
the wrong build.

**The unit and the provenance take two different props, and this is the amended half of the
criterion.** The original wording asked for the unit hint and the provenance marker without noticing
that both wanted the same slot, which made it unsatisfiable. The resolution from the design stage is
that `hint` carries the unit, as the plain string the shipped quota field already passes
(`:hint="t('onboarding.work.unitWph')"`), and `help` carries the provenance.

**Both are passed as plain string props, and that is an accessibility constraint rather than a style
choice.** `UFormField` builds its `aria-describedby` from its **props and not its slots**.
`useFormField.js` filters `hint`, `help`, `description`, and `error` on the prop being truthy, so a
`#hint` or `#help` slot used on its own renders text on screen that no screen reader ever reaches, and
nothing about the page looks wrong. A slot may render the same value the prop carries, which is how the
default case gets its badge, but a slot may never be the only carrier. This is written here rather than
left in the blueprint because this criterion is what the review stage reads.

**The provenance has two states and neither is an absence.** A figure the user has never touched is
marked as a default from the response's `source`, and a figure they saved says when it took effect from
the response's `effectiveFrom`. Marking only the default would leave the other state as an absence, and
an absence cannot distinguish a value the user set from a row the section has nothing to say about.
Both values come from the response, so the page infers neither. Formatting the date for display is
presentation and stays in the component, and the blueprint records the UTC-parse trap that makes a
naive `new Date('2026-08-23')` render the previous day in a negative offset.

The category name is the label, so the coloured-name treatment from `PLAN-32c` applies here. The
blueprint takes it, carrying the colour on a span inside the `#label` slot, which keeps reka-ui's
`:for` association intact, and it measures the contrast on this card's own surfaces rather than
inheriting the row's measurements. The requirement this criterion keeps is that the contrast is
measured rather than assumed.

**Onboarding.** The quota field leaves the work step entirely and is **not** replaced by one input per
trackable category. A wizard asking for a number per kind of work before the user has seen a single
task is a worse first run than sensible defaults they can change on the settings page, and the defaults
resolve from the contract whether or not anyone ever visits that page. The step keeps daily hours,
work days, and timezone.

`app/components/settings/work-fields.vue` loses its quota model and field, and since it is the shared
idiom between onboarding and settings, both surfaces lose the field in one edit.

**Nothing blocks.** Validation rejects only genuinely invalid input, an unusually high or low quota is
accepted, and the app never refuses a figure because it looks wrong.

### AC8. Every visible string is an i18n key, in both locales

New keys, added to `i18n/locales/fr.json` and `en.json` with identical key sets on both sides.

| Key                              | EN                                                | FR                                           |
| -------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `settings.quotas.heading`        | Quotas                                            | Quotas                                       |
| `settings.quotas.subtitle`       | Your target words per hour for each kind of work. | **research**                                 |
| `settings.quotas.submit`         | Save                                              | Enregistrer                                  |
| `settings.quotas.success`        | Your quotas have been saved.                      | **research**                                 |
| `settings.quotas.loadError`      | Your quotas could not be loaded.                  | **research**                                 |
| `settings.quotas.retry`          | Try again                                         | Réessayer                                    |
| `settings.quotas.errors.generic` | Something went wrong. Please try again.           | Une erreur est survenue. Veuillez réessayer. |
| `settings.quotas.defaultBadge`   | Default value                                     | **research**                                 |
| `settings.quotas.userSince`      | Your value, in effect since {date}.               | **research**                                 |
| `settings.quotas.empty`          | No kind of work currently carries a quota.        | **research**                                 |

**The last two keys were added after the design stage and both are corrections rather than
additions.** `userSince` is the missing half of `defaultBadge`, for the reason in `AC7`, and it takes a
`{date}` parameter the component formats. If the owner would rather no date appeared, the recorded
fallback is a plain "your value" string in the same place with no parameter, and nothing else about the
section changes. `empty` covers a section with no rows, which cannot happen against today's contract
and is exactly the kind of count the extensibility rule says not to assume away, so the string exists
rather than the state rendering blank.

`Enregistrer`, `Réessayer`, and the generic error are copied verbatim from the shipped
`settings.work.*` keys, so those three are settled rather than researched. Every FR string marked
**research** is for the frontend stage to establish in Québécois French rather than invent, and none
of them should be a translation of the English cell above. The English column is the intent, not the
source text.

**Copy that the removal falsifies, and has to change rather than be left standing.**

- `onboarding.work.quota` ("Quota de base" / "Base quota") is removed from both locales. No field
  reads it once the step loses the input.
- `onboarding.steps.work.subtitle` reads "Vos heures, vos journées et votre quota." and the step no
  longer holds a quota. Reworded in both locales, FR **research**.
- `planning.editor.fields.quotaHint` reads "Vide : votre quota par défaut." and there is no longer a
  single default quota. It becomes a hint naming the category's quota, in both locales, FR
  **research**. The French space before the colon is already correct there and stays.
- `settings.quotas.*` is a sibling of `settings.work.*` rather than a replacement, and
  `settings.work.subtitle` still describes the hours, days, and timezone it keeps, so it does not
  change.

**The French typography rule is checked rather than assumed.** FR needs a space before `? ! : ;`, and
the reworded editor hint is the one new string likely to carry a colon, so it keeps its space. Any
researched string that lands with one of those marks carries the space.

`onboarding.work.unitWph` ("mots/heure") stays where it is and keeps its name. After this feature its
readers are the task editor and the new quotas section rather than the onboarding step, so the key
sits under a namespace that no longer uses it, which is a naming oddity and not a bug. Renaming it
means touching three call sites and both locale files, or inventing a `common` namespace for a single
string, and neither earns its place inside this feature. Recorded so the next reader knows it is known.

### AC9. The account purge erases the new table explicitly

`server/api/cron/purge-deactivated.get.ts` deletes `category_quotas` rows for the purged user ids,
before the `users` delete like every other dependent table, and its header comment's count of named
deletes moves from six to seven.

The comment there already explains why this is not redundant with the cascade, which is that the
cascade only fires when `PRAGMA foreign_keys` is `ON`, nothing in the repo issues that pragma, and
production was never probed. A quota is the user's own configuration and it has no reason to outlive
the account, so the erasure has to name it.

The new table declares `onDelete('cascade')` in the schema anyway, matching `work_schedule`, so the
guarantee holds under either mechanism.

Verifiable by the existing purge row tests, extended with a `category_quotas` row that must be gone
after the purge.

### AC10. The resolver is tested, and no component computes a quota

**Tests are a criterion here rather than a later stage's option**, because they are how `AC1` and `AC2`
are demonstrated in the absence of a UI consumer.

- `defaultQuotaWph` over all ten ids, plus an unknown id, an empty string, `null`, `undefined`, a
  number, and an object, all of which resolve through `coerceCategory` to `other` and therefore to
  `null`.
- The consistency assertion that a default descriptor is trackable exactly when it carries a number.
- The resolver, covering an empty history, a single row, a row not yet effective, several rows across
  a boundary date, unordered input, a non-trackable category, a task override, a task override on a
  non-trackable category, and a stored row for an id outside the contract.
- The `PATCH` model, covering the bounds inherited from `quotaWphSchema`, a duplicate `categoryId`, a
  non-trackable `categoryId`, an empty `quotas` array, a malformed `effectiveFrom`, and a
  syntactically valid but impossible date such as `2026-02-31`.

**Nothing in `app/` computes a quota.** Verifiable in the same style as the shipped write-boundary
guard, by asserting that no file under `app/` resolves a quota from a category id or from a stored
row. The client receives resolved figures and renders them.

### AC11. The dev seed writes the table it now owns

`scripts/seed.ts` deletes the owner's `category_quotas` rows alongside the task and work-schedule rows
it already deletes, then inserts one row per trackable category at the same `effective_from` the
work-schedule record uses, holding the four shipped defaults.

The values are the shipped defaults rather than invented figures, so no number enters the dev database
that the contract does not already carry. The point of seeding them is that the stored-row branch of
the resolver is the branch production uses after the user saves once, so it should be the branch a
developer sees, and the `source` field in the API response is what distinguishes it from the default
branch on screen. Re-run safety is unchanged, since the seed deletes and rebuilds rather than
appending.

## Edge cases

### A stored row for a category id that no longer exists

The resolver is always asked about a specific category, so a row naming an id outside the current set
is never selected and simply never participates. The settings section lists the current trackable
categories, so an orphan row is invisible rather than broken.

**The row is left in place rather than deleted.** If the id comes back, whether because a `PLAN-30`
category is recreated or a default is restored, its quota comes back with it. Deleting orphans would be
a cleanup that destroys a setting to tidy a table nobody is reading.

A task whose stored category is stale is a separate and already-solved case. `coerceCategory` folds it
to `other`, `other` is not trackable, and the resolver therefore returns none, which is the fail-closed
direction the contract documents.

### A stored row for a category that is trackable today and not tomorrow

Possible once `PLAN-30` can change a category. The resolver reads `trackable` at resolution time
rather than at write time, so the row stops contributing the moment the category stops being
trackable, and starts again if it becomes trackable once more. Nothing has to be migrated and no row
has to be rewritten.

### A task carrying an override on a non-trackable category

Storable today, because the editor shows the quota field for every category deliberately. The resolver
gates on `trackable` first, so the override never produces a quota for a meeting or a break. The value
stays stored, so recategorizing the row to a trackable category brings it back. See the resolution
order above for why this is a gate rather than the last step.

### A partially completed edit

The `PATCH` carries every changed category in one body and one statement per row, so a failure part way
through can leave some rows written and some not. That state is not invalid and not stranded. Every
row that landed is a complete, correctly dated row, every row that did not is still resolving its
previous value or the shipped default, and the recovery is to save again, which upserts on the same
`(user_id, category_id, effective_from)` key and converges.

The client reconciles against the response rather than against what it sent, so a partial failure shows
the user what actually persisted rather than what they typed. The failure toast plus a re-save is the
recovery, and there is no cleanup step and no half-written row to repair.

**A single-statement transaction is not required for correctness here** and is not specced. Each row is
independently meaningful, unlike a two-table write where half the state is nonsense.

### Two edits on the same day

The second upserts the first day's row. Editing a figure twice in a morning leaves one row for that
day holding the latest value, rather than two rows the resolver would have to break a tie between. This
is also how a typo is corrected, which is why the settings UI needs no date control to be useful.

### A user with no rows at all

Every trackable category resolves its shipped default, the settings section shows those four figures
marked as defaults, and nothing is blank or broken. This is the state the one real user is in the
moment `0011` is applied, and it is a working state rather than an empty one.

### The migrations and the deploy get out of step

- `0010` applied and the deploy not done. Nothing happens. The old build does not know the table.
- Both migrations applied before the deploy. The old build's settings read and settings save fail until
  the deploy lands, because both name a column that is gone. The read is covered by the page's existing
  error state and its retry control. The save is the one that can lose typed work, which is why the
  three-step order in `AC5` exists.
- `0011` applied and the deploy rolled back. One `ADD COLUMN` from `AC5`'s undo restores a working old
  build, with the contents gone and nothing of value lost.
- The new build deployed and `0010` never applied. The settings section's read fails and its error
  state shows, and nothing else in the app is affected, because no other surface reads the table. The
  recovery is to apply the migration.

### The timezone boundary on "today"

`effectiveFrom` defaults to today in the user's stored timezone rather than in UTC, so an edit made
late in the evening does not land on tomorrow's date. `todayInZone` already exists for exactly this
and is reused rather than reimplemented.

### A quota of zero, or an absurd one

Zero is rejected by `quotaWphSchema`'s floor of 1, because the quota is a divisor. An unusually high or
low figure inside the range is accepted without comment, per the do-not-police rule. The app may
signal later, through `PLAN-22`, and it never blocks.

### The settings API errors while the page is open

The shipped pattern covers it. The section renders its `UAlert` and its retry control, the other
sections keep working because they load independently, and a failed save leaves the typed values in the
form so nothing has to be retyped.

## Assumptions taken rather than asked

Recorded under their own heading because this document was written without a live conversation, so
each of these is a decision made to keep the build unblocked rather than a question left open.

1. **The settings section is a third section on the existing settings page** rather than a new route.
   It is a handful of numeric fields and it belongs next to the work settings it used to live inside.
2. **The `GET` resolves for today only** and takes no date parameter. Nothing shipped needs another
   date, and `PLAN-22` resolves per period through the server-side resolver rather than through this
   endpoint.
3. **`source` and `effectiveFrom` are on the response.** They exist so the client never infers whether
   a figure is a default. **Corrected after the design stage.** This item used to say that dropping
   both would cost "the default marker in the UI and nothing else", which stopped being true once the
   design put the date on screen. Both fields are now read by `AC7`, so dropping `effectiveFrom` costs
   the only visible trace of the effective dating this feature exists to introduce, and the fallback in
   `AC8` is what replaces it.
4. **Onboarding drops the quota question entirely** rather than moving it or asking four. Stated in
   `AC7` with the reason.
5. **The seed writes the four defaults** rather than leaving the table empty, per `AC11`.
6. **`PLAN-30` stays next, and this feature does not build per-user category rows.** Stated
   2026-08-23. The category set remains the code contract in `shared/categories.ts` for now, and
   `category_quotas` is keyed by `category_id`, so it already accepts ids that do not exist yet and
   `PLAN-30` adds user-created categories with no migration to this table.

   **This is the pipeline coordinator's working assumption and recommendation. It is not the owner's
   ruling.** The fork was put to the owner four times and the owner has not answered
   it. The build needed a shape rather than another wait, so the owner was told plainly that work was
   proceeding on the recommendation, and there has been no objection since. Silence is not consent, so
   nothing here is the owner's approval, the owner's agreement, or a decision the owner made, and it
   must not be read or reported as any of those. What the
   owner has not answered is [open question 1](#open-questions), which stays open on its own terms.

   **What changes if the owner rules the other way**, so this is already answered rather than needing a
   re-read. The categories become per-user rows, which is `PLAN-30`'s data model, and that is a
   separate spec and a separate pull request rather than an extension of this one. `category_quotas`
   does not change, because a free-text `category_id` is as correct against a category row as against
   a contract member, and the resolution order does not change either. What does change is the
   contract's own shape, so `DEFAULT_CATEGORIES` stops being the source of a category's flags and its
   `defaultQuotaWph`, and the four shipped defaults have to move from code into whatever seeds a new
   user's category rows. The resolver's third step would then read that seeded row rather than the
   descriptor.

   **On reversibility, the honest version rather than the reassuring one.** This was described as
   reversible until the backend stage commits to the shape. The backend stage is running now and is
   writing `shared/`, `server/`, and the migrations, so that window is closing or already closed.
   Treat it as closed. Reversing it after `0010` is applied anywhere means a migration rather than an
   edit, and the migration files must not be renumbered or rewritten once applied, so the reversal
   arrives as new numbered files on top rather than as a correction to these two.

## Stages

Specs and code review are never skipped.

- **Design** runs, small. One new settings section, four numeric inputs, and the default marker. It
  decides whether the category labels take their `PLAN-32c` colour and it measures contrast if they do.
- **Backend** runs and does most of the work. The contract field, the table, both migrations, the read
  path, the resolver, both handlers, the model, the purge line, and the seed.
- **Frontend** runs. The new settings section, the removal of the quota field from `work-fields.vue`
  and the onboarding step, the composable and page edits, and every locale change including the
  researched Québécois strings.
- **Unit test** runs, and `AC10` is its brief rather than a suggestion. It also updates the four
  existing test files listed in `AC3`.
- **Compliance** runs, briefly. No new class of personal data, since a quota is a work setting the app
  already stored, but the feature adds a table holding user data and `AC9` is the erasure path, so the
  purge change is worth a compliance read rather than only a code review.
- **Accessibility** runs on the new form section. Labelled numeric inputs, a default marker that is
  not colour alone, and the error and success states reaching a screen reader.
- **SEO is skipped.** The settings page is behind sign-in and already `noindex, nofollow`.

The migrations are applied by hand against the development database during the build, and the
production apply stays with the owner per the header notes. The trail entry in
[`docs/pipeline.md`](../../pipeline.md) and the row in
[`docs/pipeline-trace.md`](../../pipeline-trace.md) are part of this feature rather than a later batch,
and the ledger row is appended by hand in the existing ragged style because that file is in
`.prettierignore` for a reason.

## Amendments to shipped specs

- [`overview.md`](overview.md). The `PLAN-32b` bullet is the source of this spec and stays. The
  forward-looking retirement sentence becomes past tense per `AC4`, and the `PLAN-32a` note that
  `32b` inherits a known-wrong global default is answered here.
- [`nine-task-categories.md`](nine-task-categories.md) (`PLAN-32a`). Its `AC10` says no quota field
  appears on the `Category` descriptor and its open question 3 hands the quota field to this feature.
  Both are honoured rather than contradicted, since `AC10` was a non-goal for that feature and this is
  the feature it deferred to. `AC1` here adds the field.
- [`settings-page.md`](../settings/settings-page.md). Its Work section, its `GET` and `PATCH` response
  shapes, its `quota_wph` reconciliation note, and its acceptance criteria that name a words-per-hour
  quota are superseded on that field only. The daily target, work days, and timezone are unchanged.
  That spec should point here for where the quota went.
- [`onboarding-wizard.md`](../onboarding/onboarding-wizard.md). Its base-quota field, its `quotaWph`
  payload entry, its bounds criterion, and the work-settings list in its atomic-persistence criterion
  drop the quota. The step keeps its other three fields.
- [`task-inline-editor.md`](task-inline-editor.md). Its editor keeps the quota override field
  unchanged. Only the field's hint copy changes, per `AC8`, because the hint named a global default
  that no longer exists.
- [`docs/TODO.md`](../../TODO.md). Its line describing the settings page as editing a "default WPH
  quota" is stale once this ships and is corrected in the same pass.

## Open questions

None block the build.

1. **Whether the categories themselves become per-user rows now or next, which is the owner's call and
   is with the owner now.** The mandatory rule headed "Any list is customizable, modular, and
   extensible" argues against the ten-member code union in `shared/categories.ts`, and the union is what `PLAN-30` was
   already going to replace. This spec does not decide it, does not build it, and does not widen on the
   strength of the rule. Two things hold whichever way it goes. The quota table is correct either way,
   because it is keyed by a free-text category id rather than by a foreign key to a category record.
   And a later `PLAN-30` needs no migration to `category_quotas`, so nothing here has to be undone.
   If the answer is "now", it is a separate spec and a separate pull request rather than an extension
   of this one.

   **The build is not waiting on this answer, and that is recorded separately rather than folded in
   here.** Assumption 6 under
   [assumptions taken rather than asked](#assumptions-taken-rather-than-asked) is the shape the build
   is standing on, and it is the pipeline coordinator's recommendation rather than anything the owner
   said. This question stays the record of what the owner has not answered. Neither entry settles the other,
   and a later reader needs both.

2. **The production `settings.quota_wph` value.** It cannot be read from a container with no production
   credentials. `AC5` says to read it out and record it before applying `0011`, and the discard decision
   holds whatever it turns out to be. This is an action for the owner rather than an open decision.
3. **The Québécois strings marked research in `AC8`.** They are the frontend stage's to establish and
   they are the owner's to confirm before the feature is done. None of them blocks the build, and none
   of them should be invented.
4. **Whether the category labels in the new section take their category colour. Answered.** The
   design stage took the colour, on a span inside the `#label` slot, and measured the contrast on this
   card's own surfaces. Kept in this list as a closed question rather than deleted, so a later reader
   sees it was decided rather than skipped.
5. **What `PLAN-22` wants from the resolver.** The consumer decision above ships the resolution with no
   per-task consumer, so `PLAN-22` decides whether it reads per task, per category and date, or both,
   and it is the feature that gets to amend the write-boundary guard when it does.
