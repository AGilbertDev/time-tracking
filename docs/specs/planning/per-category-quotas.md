# Per-category quotas

`PLAN-32b`. Depends on `PLAN-32a`. Shared contract, backend, two migrations, the task write path, and
the settings and onboarding UI.

## Intent

A quota is a property of a kind of work rather than a property of the user, so the single global
`settings.quota_wph` cannot describe four kinds of work at once. This feature makes the quota a user
setting tied to the category, stores the current figure in its own table, snapshots that figure onto
each task as the task is written, resolves it server-side, gives the settings page a section for
editing it, and retires the global column and every reader of it.

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

## The snapshot model, approved 2026-08-24

**A category quota is a current setting rather than a dated history, and each task carries the figure
it was created against.** This replaces the effective-dated lookup the first two commits on this branch
built. It is an architecture change taken after this spec was approved and after the backend stage had
run, so it is recorded here as a change rather than folded in as though it had always been the plan.

### Where it came from

Research into how tools built for freelance translators actually keep historical figures accurate. The
leading one locks the figure onto the job. Its own documentation states that changing a price at the job
level does not update the rate at the client level, and that changing a rate going forward leaves
existing jobs holding whatever they were created with. A second tool models user-defined services, each
carrying its own unit, which is the same per-category split this feature already builds.

So the per-category shape matches how these tools work and the way this spec preserved history did not.
The industry snapshots the figure onto the record. This spec looked the figure up by date. The owner
read the comparison and chose the snapshot model.

### What changes

`category_quotas` loses `effective_from` and holds one row per user and category, so a save updates that
row in place instead of appending a new one. When a task is written the server resolves the quota for
the task's category and stores that number on the task, the way an invoice line stores the price it was
sold at. Changing a category setting afterwards never moves a number on a task that already exists.

### What does not change

The per-category split, the free-text `category_id`, the four shipped defaults, the trackable gate, the
retirement of `settings.quota_wph`, the settings section, the purge line, and the dev seed. Every one of
those was decided on reasoning that was not about dates, so none of that reasoning is reopened here.

### The new surface this brings, named rather than absorbed

**The snapshot reaches `POST /api/tasks` and `PATCH /api/tasks/[id]`, which the approved spec did not
touch at all.** That is new surface for this feature and it is stated here rather than left to be
discovered in the diff. It is a direct consequence of the approved architecture rather than scope picked
up along the way. A snapshot model with nothing writing the snapshot is not the model, it is the old
model with a column removed, so the write path is the mechanism rather than an extension of it.

It is also the smallest possible reach into that path. No arithmetic is performed, no new column is
added, no request contract changes, and no field becomes required or forbidden. One number is resolved
and stored on two endpoints. `AC12` is the whole of it.

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
6. **The snapshot model**, approved by the owner 2026-08-24 and set out in
   [the snapshot model](#the-snapshot-model-approved-2026-08-24). It arrived after the first two commits
   on this branch, so parts of this document now describe work that has to be undone rather than work
   that has not started. Where that is true it is said in the criterion itself.

### The design blueprint

[`per-category-quotas-design.md`](per-category-quotas-design.md), filed by the design stage after this
spec's first pass. It answers the one question this spec left to it, and it found four places where
this spec was wrong. Three are corrected here in `AC7`, `AC8`, and assumption 3, each marked as
amended after the design stage, and the fourth is a shorthand this spec now states properly. Where a
criterion below and the blueprint disagree, this document is what the review stage reads, so the
correction lands here rather than only there.

**The blueprint predates the snapshot model and is not amended.** Two of its decisions are overtaken by
it, which are the date on the provenance line and the argument that the date was the interesting half of
that line. There is no effective date left to show, so `AC7` and `AC8` below carry the corrected version
and the rule in the paragraph above is what settles the disagreement. Everything else the blueprint
decided still holds, including the colour on the label, the slot and prop assignment, the badge
treatment, and the dynamic row count.

### The shipped code this changes

- `shared/categories.ts`, the ten-member category contract. `DEFAULT_CATEGORY_IDS` (L57 to L68) and
  `DEFAULT_CATEGORIES` (L125 to L136) are the declaration site for every per-category fact, and the
  descriptor carries `trackable`, `deliverable`, and `hue` today.
- `server/db/schema.ts`. `settings.quotaWph` at L45 is the column that retires. `tasks.quotaWphOverride`
  at L111 is the column this feature repurposes as the snapshot, and its comment block above it is
  rewritten to say what it now holds.
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
- `server/api/tasks/handlers/create.ts`, `update.ts`, and `write.ts`, which gain the snapshot per
  `AC12`, and `test/server/api/tasks/write-boundary-guards.test.ts`, whose quota guard this feature now
  amends rather than leaving to `PLAN-22`.
- `scripts/seed.ts`, `test/helpers/taskTestDb.ts`, and the four test files listed under `AC3`.

### The field the snapshot lives in, and why it is the existing one

**`tasks.quota_wph_override` becomes the snapshot rather than a new column being added beside it.**
The column already exists, it is already nullable, it is already validated by `quotaWphSchema`, and it
already holds exactly one thing, which is the words-per-hour figure this one task is measured against.

The alternative was a second column, `quota_wph_snapshot`, with the override kept separate and winning
over it. That is declined for three reasons.

1. **Under this model the per-task figure is not an exception any more, it is the record.** The owner has
   already questioned why a per-task exception exists on top of a per-category target, and the snapshot
   model answers that question by making the per-task figure the primary fact. Two columns would keep
   the exception alive and add the record beside it, which is the shape the question was about.
2. **An invoice line stores one price.** It does not store a catalogue price plus an optional
   override, and the analogy is the whole reason this model was chosen. A user asked why their task
   carries two quotas has no good answer, and neither does the resolver, which would grow a third step
   to break a tie that means nothing.
3. **It needs no migration.** `0010` and `0011` are unapplied, so the branch would have to add a third
   numbered file for a column whose only job is to duplicate the meaning of one that is already there.

**What happens to the name. Nothing, and that is a deliberate refusal rather than an oversight.**
`quota_wph_override` stops describing what it holds, because the normal case is now a server-written
figure rather than a user's exception. The column and the `quotaWphOverride` request and response field
keep their names anyway.

- This project has already settled this exact trade once, on the column immediately above it.
  `project_word_count` is recorded in `server/db/schema.ts` as "mildly misleading and it is kept rather
  than renamed", because a rename means either `ALTER TABLE RENAME COLUMN` plus an edit to every reader
  or a create-copy-swap, and it also renames a field on a request contract that has already shipped,
  which turns an internal tidy into a breaking API change for no behaviour gained. Every word of that
  applies here.
- `quotaWphOverride` is on `POST /api/tasks`, on `PATCH /api/tasks/[id]`, and on the list projection,
  with a live client reading all three. Renaming it is a breaking contract change, and this feature is
  not the one that gets to make it.
- `AC3`'s grep instruction and the shipped write-boundary guard both key on the literal strings
  `quotaWphOverride` and `quota_wph_override`. A rename rewrites both, which is churn in the two places
  this feature most needs to stay readable.

**So the meaning lives in the comment rather than in the name, and a reviewer flagging the name is
right and is declined on the grounds above.** The schema comment, the model comment, and this section
say what the column holds. A rename belongs to whichever later feature is already changing that request
contract, which today looks like `PLAN-12`, and it is a hand-off rather than scope here.

**What this costs, stated plainly.** One column cannot record two facts, so after this change a NULL
cannot distinguish a row written before this feature from a row whose figure the user deliberately
cleared, and a number cannot distinguish a figure the server snapshotted from a figure the user typed.
Both distinctions exist today and both are given up. Nothing shipped or specced reads either one.
`PLAN-22` divides words by a quota and does not care where the number came from, and the editor renders
a number the user can change either way. If a later feature does need the provenance, it adds a small
`quota_wph_source` column rather than unpicking this, and that is a cheaper reversal than carrying two
numeric columns from the start on the chance that it will.

**The files that touch this column and now change.**
`server/api/tasks/handlers/create.ts`, `update.ts`, and `write.ts` gain the snapshot per `AC12`.
`server/models/tasks.ts` keeps `quotaWphSchema` on the field and gains a comment saying the field is now
also server-written. `projection.ts`, `app/utils/taskEditor.ts`, and
[`TaskEditor.vue`](../../../app/components/planning/TaskEditor.vue) field 11 keep their code unchanged,
and the only client-visible difference is that the field usually arrives holding a number instead of
empty. Only the field's hint copy changes, per `AC8`.

## The shape the owner decided

### The table

```
category_quotas
  id           text primary key
  user_id      text not null -> users.id, on delete cascade
  category_id  text not null, the shared ten today, any user-created id later
  quota_wph    integer not null
  created_at   integer, Unix seconds
  updated_at   integer, Unix seconds
  unique (user_id, category_id)
```

**`effective_from` is gone and the unique key is now `(user_id, category_id)`**, so a user has exactly
one current quota per category and a save updates that row in place. This is the snapshot model applied
to the table. The column and the third member of the unique key were both in the approved shape and both
come out.

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

### Why the task carries the figure rather than the table carrying a history

`AC2`'s requirement is unchanged, which is that editing a quota must never restate a period that has
already been reported. Only the mechanism changes. Effective dating met that requirement by keeping every
past figure and choosing between them by date. The snapshot meets it by writing the figure onto the task
at the moment the task is written, so there is nothing left to choose between and no past figure to keep.

**The snapshot is the stronger of the two and that is why it replaces the other.** Under effective dating
a stored figure is correct only as long as the resolver, the task's date, and the row's date agree, so a
task written on one day and moved to another day silently changes which figure it is measured against.
Under the snapshot the figure is a stored fact on the row, so a task moving day, a category setting being
edited, and a row being read a year later all leave it alone. It is the same reason the project already
refuses to store a copy of the estimated duration in `actual_minutes`, which is that a stored fact and a
derived one must not be confusable, read in the other direction. A quota in force at a moment is a fact
about that task, so storing it is recording rather than copying.

It is also what the tools this domain already uses do, per
[where it came from](#where-it-came-from), and matching an established practice beats inventing a second
one for the same problem. That argument was previously used the other way round, to justify copying
`work_schedule`'s pattern, and it now points at the industry practice instead. The `work_schedule`
comparison was never wrong about `work_schedule`. It was wrong that the two problems are the same one. A
work schedule has to answer "how many hours was I available on this past day" for a day nothing was
written down about, so it has nowhere to put the answer but a dated row. A quota has a task to write it
on.

**`work_schedule` keeps its effective dating and nothing about it changes here.** Two patterns now exist
in this database for what looked like one problem, which is a cost, and it is paid down by the fact that
`category_quotas` is no longer an effective-dated table at all, so there is one dated table rather than
two.

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

For a single task, server-side, in this order. **Resolution loses its date logic and does not otherwise
change.**

1. None, when the category is not trackable. This is a gate and it fails closed first.
2. The number stored on the task in `tasks.quota_wph_override`, when it is not null and is a usable
   divisor.
3. The user's current `category_quotas` row for that category.
4. The category's shipped default, from `shared/categories.ts`.

**Step 1 is a gate rather than a last resort, and the difference is real today.** Written in the other
order the list would hand a non-trackable task its stored number, because step 2 would fire before the
gate was ever reached. The app can produce that row right now, since the editor shows the quota field for
every category on purpose ([`TaskEditor.vue`](../../../app/components/planning/TaskEditor.vue) field 11,
"Shown for every category rather than hidden on some"), so a user can type a figure onto a meeting. The
resolver therefore checks `isTrackableCategory` first and returns none for a non-trackable category
whatever else the row holds. That is the same fail-closed direction the contract already documents for
`isTrackableCategory`, which is that words must never reach a quota numerator by accident.

The stored number is left alone rather than cleared, so recategorizing the row to a trackable category
brings it back with it. Nothing is destroyed to enforce the gate.

**Steps 3 and 4 are the fallback for a task that carries no number, and that is a narrower set than it
used to be.** After `AC12` ships, a task written through the API with a trackable category always carries
its own figure, so steps 3 and 4 are reached by exactly three kinds of row. A task written before this
feature, which is every task in the database today. A task whose figure the user deliberately cleared. And
a task inserted by something other than the write path, which today means the dev seed. All three are
real and none of them is broken, so the fallback stays rather than becoming dead code.

**What is gone is the date.** No step compares the task's `date` to anything, no step reads
`effective_from`, and the resolver takes no date argument. `resolveCategoryQuota(categoryId, records)`
loses its `on` parameter, `CategoryQuotaRecord` loses `effectiveFrom`, `ResolvedCategoryQuota` loses
`effectiveFrom`, and `resolveTaskQuota` stops reading `task.date`. The source union renames its per-task
member from `'override'` to `'task'`, because the number is the record rather than an exception to one.

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
- **The unique key is `(user_id, category_id)`.** No ordinal, no positional index, and no column named
  after a category. A fortieth category is more rows rather than a schema change.
  The shape this rule exists to prevent is the one being retired here, which is a fixed set of
  per-category columns on the settings row.
- **The resolution order ends in a shipped default rather than in a required row.** A category with no
  stored quota still resolves, so growth never depends on a bootstrap step or a backfill.

**What a user-created category inherits for free under this shape.** A storable quota with no
migration, the snapshot onto its tasks for free, a label resolved from i18n by its own id, a colour that is
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
- The quota snapshot onto `tasks.quota_wph_override` on both task write endpoints, per `AC12`.
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

**No date anywhere in the quota API or the settings UI.** There is no `effectiveFrom` on the request,
none on the response, and no date control on the form. This was previously a non-goal about a date
picker on top of a dated mechanism. Under the snapshot model there is no date to pick, so the non-goal
is now the stronger statement that the quota endpoints take and return no date at all.

**No quota history, and no view of one.** The table holds the current figure and keeps no past figures,
so there is nothing to display. What preserves the past is the number stored on each task, and reading
those back as a history is `PLAN-23`'s job rather than this feature's.

**No backfill onto existing tasks.** Every task in the database has `quota_wph_override` NULL today,
including the seeded rows, and it stays NULL. See [the decision](#existing-tasks-keep-their-null) below.

**No arithmetic on the snapshot.** The number is resolved and stored. Nothing divides by it, nothing
rounds with it, and `estimated_minutes` is untouched. That is `PLAN-12` and the boundary is drawn in
[how this differs from `PLAN-12`](#how-a-quota-snapshot-differs-from-plan-12s-frozen-estimate).

### The resolver's consumer, decided under the snapshot model

**This section previously said the resolver ships with no runtime consumer. That is no longer true and
the change is a consequence of the snapshot model rather than a change of mind.** The task write path
resolves a category's quota in order to store it, so `resolveCategoryQuota` now has a production caller
on both write endpoints.

**What survives from the old decision.** The task read projection still gains no resolved quota field. It
carries `quotaWphOverride`, which it already did, and that field now happens to hold the snapshot. So the
response shape does not change, no new field goes onto a shipped contract, and reasons 1 and 2 below
still hold for the field that was being considered.

1. **Nothing would read a second resolved field.** No row prints a quota, no stat exists, and the number
   the client can already see is the one on the task.
2. **`PLAN-22` may not want a resolved figure per row.** A bucket is words in a category over hours in
   that category, which is a period-level figure. That stays `PLAN-22`'s call.

**What does not survive is reason 3, and this is the part review has to see.** The shipped guard in
`test/server/api/tasks/write-boundary-guards.test.ts` asserts that no file under `server/api/tasks/`
mentions `quotaWph` beyond the `quotaWphOverride` passthrough. `AC12` writes a resolved quota in exactly
that directory, so **this feature amends that guard rather than leaving it to `PLAN-22`.**

The amendment narrows the guard rather than deleting it. What the guard was protecting was that no wrong
quota reaches a task, and the reason recorded in it is that the only quota available was the global one
whose default the overview records as wrong. That reason is retired by this feature, and the protection
worth keeping is a different one, which is that **no file under `server/api/tasks/` performs quota
arithmetic**. So the guard becomes an assertion that nothing there divides by or multiplies a quota,
which is `PLAN-12`'s and `PLAN-22`'s ground and is still not this feature's. Deleting the guard outright
would be weakening it and is not what is specced. `AC12` states the replacement.

`AC1` is demonstrated by unit tests over the pure resolver plus the resolved figures the settings `GET`
returns, which is unchanged. `resolveTaskQuota` specifically still has no runtime caller, because the
write path resolves a category rather than a task, so that function remains tested code with no
production path until `PLAN-22`. That is accepted for the reason it always was, which is that the
resolution order is a decided rule and writing it once with tests is what stops it being re-derived
under pressure later.

### Existing tasks keep their NULL

**Every task that exists today keeps `quota_wph_override` NULL, and no migration backfills it.** That
includes the dev seed's rows.

1. **A backfill invents a number.** It would write today's category setting onto work done before any
   per-category target was ever recorded, and it would then look like the figure that task was actually
   created against. That is the same argument that stops `settings.quota_wph` being carried into
   `category_quotas` at all, and the same argument that stops `PLAN-32a` writing a permanent `revision`
   to `revision_internal` mapping. A snapshot of a target that did not exist is not a snapshot.
2. **The fallback path is needed anyway.** Steps 3 and 4 of the resolution order have to work for a
   deliberately cleared figure and for a row inserted outside the write path, so a backfill would buy
   nothing that the fallback does not already provide, and it would remove the only real data exercising
   it.
3. **NULL is a working state.** Such a task resolves the user's current setting, and failing that the
   shipped default, so nothing is blank and nothing is broken.

**The honest cost.** Those tasks are still measured against a figure that moves when the user edits their
category setting, which is exactly the behaviour the snapshot exists to end. That is correct rather than
regrettable. The app has no record of what target that work was done against, so the best available
answer is the current one, and pretending otherwise by freezing a guess would be worse. The set is also
closed and shrinking, since every task written from now on carries its own figure.

### How a quota snapshot differs from `PLAN-12`'s frozen estimate

[`overview.md`](overview.md) records that `PLAN-12` owns derived values on tasks, specifically
`estimated_minutes = round_to_5(words / quota x 60)` stored frozen. So this has to say why storing a
quota on a task is not `PLAN-12` arriving early.

**They are different kinds of fact.** The snapshot is a setting captured, which is the target that was in
force for this kind of work when this task was written. The frozen estimate is a computation performed,
which is a duration derived from that target and a word count. One is an input recorded, the other is an
output produced. This feature records the input and performs no computation, so `estimated_minutes` stays
stored verbatim and client-writable exactly as [`task-write-api.md`](task-write-api.md) settled it.

**Every decision `PLAN-12` had, it still has.** Whether to derive the estimate at all, the rounding rule,
whether editing the word count re-derives, whether editing the estimate decouples it, and whether to
backfill estimates for existing rows. None of those is taken here and none of them is constrained by
this.

**`PLAN-12` is unblocked rather than pre-empted, and that is the useful part.**
[`task-write-api.md`](task-write-api.md) refused to derive the estimate on the server for one stated
reason, which is that the only quota available was the global `settings.quota_wph` whose default is
recorded as wrong, and that because the estimate is frozen by definition it would never self-correct. The
snapshot answers that objection directly. It also makes a frozen estimate reproducible, since the divisor
it was derived from is stored on the same row, which it was not under either the global column or the
effective-dated lookup.

**And it satisfies an acceptance criterion `PLAN-12` already carries**, which is that changing the quota
does not change a stored estimate. Under the snapshot that is true of the input as well as the output.

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
rows or the task's own figure say. Verifiable by unit tests over all ten ids.

**`AC1` is unchanged by the snapshot model.** The contract field, the accessor, the coercion, the
fail-closed direction, and the consistency assertion all stand exactly as approved. Nothing in this
criterion was about dates.

### AC2. Editing a quota never restates a past period, and the task's stored figure is what guarantees it

**This criterion is rewritten and it is a replacement of the mechanism rather than a relaxation of the
requirement. Review must not read it as a criterion being dropped.** The requirement is word for word
what it was, which is that editing a quota must never change what a period that has already been
reported was measured against. What changes is how that is achieved. Effective dating was the mechanism.
The snapshot is now the mechanism, and it delivers the same guarantee more directly.

**The requirement.** Editing a category quota changes what future tasks are measured against and changes
nothing about any task that already exists.

**The mechanism.** A task written through the API with a trackable category carries its own resolved
figure in `tasks.quota_wph_override`, per `AC12`. A save to `category_quotas` updates the user's single
row for that category in place. Since resolution reads the task's own figure before it reads the
category row, an edit to the category row cannot reach a task that already has one.

**What is verifiable, and it is a stronger property than the old test asserted.**

1. Create a task in a trackable category. Save a different quota for that category. Resolve the task
   again and assert its figure is unchanged. The old criterion could only assert this about a date
   comparison. This asserts it about the row.
2. A save to `category_quotas` for a category that already has a row leaves one row rather than two, and
   the row holds the new figure. Assert the row count as well as the value, because a stray second row is
   the failure this table's unique key exists to prevent.
3. A task with no stored figure resolves the user's current row, and failing that the shipped default,
   so there is no gap and no discontinuity for the rows described in
   [existing tasks keep their NULL](#existing-tasks-keep-their-null).

**What the replacement gives up, stated so the trade is on the record and not discovered later.** A quota
typed wrong cannot be corrected on tasks that were already created with it. Under effective dating the
user could have written a backdated row and restated the period. Now they would have to edit each affected
task's figure in the editor, which is possible one row at a time and impractical across fifty.

That cost is accepted for three reasons. It is the trade the leading tool in this domain already makes,
so it is the behaviour a user coming from that tool expects. The backdating path it removes was never
reachable from the UI anyway, since the approved spec shipped no date control and the settings form never
sent a past date, so what is lost is a capability the product did not actually offer. And the per-task
figure stays editable, so the recovery for the case that matters, which is one important task with a
wrong number, is a field the user can already see and change.

**What is not given up, and the one place the two mechanisms genuinely differ.** For a task that carries
its own figure, nothing about the requirement is given up: a past period cannot be restated by an ordinary
edit, which was the whole point, and the snapshot delivers it more directly than a dated lookup did.

For a task whose figure is NULL the two mechanisms do not agree, and this criterion must not be read as
claiming they do. Such a task resolves through the category's current row, so editing that row does move
what the task is measured against. Under effective dating it would not have, because a row dated today
does not apply to a task dated last month, and the task would have held the shipped default instead. The
population is the one [existing tasks keep their NULL](#existing-tasks-keep-their-null) describes, which
today is every task in the database, since nothing has been written through `AC12` yet.

That is accepted for the reason recorded there, which is that the app has no record of what target the
older work was done against and freezing a guess would be worse than resolving the current answer. It is
recorded here as well because `AC2` is the criterion a reviewer checks the claim against, and a criterion
saying "nothing is given up" a few lines from a section saying a cost is paid is the kind of contradiction
that gets settled in the wrong direction later. The guarantee is real and it is forward-looking: it covers
every task written from `AC12` onwards, with one exception that keeps the set growing rather than merely
closing it. A resolve that fails leaves `NULL`, on the create and on a recategorising update alike, and a
row with `NULL` is a row this guarantee does not cover. The three-way split in
[the fail-open direction](#ac12-the-task-write-path-stores-the-quota-the-task-was-created-against) makes
that outcome correct rather than wrong, since the alternative was holding another category's figure, but it
does not stop it happening. Read the uncovered population as shrinking in proportion and not as sealed.

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

**`0010` is edited in place rather than corrected by a later numbered file, and that is only true right
now.** The file was written by the backend stage against the effective-dated shape and it has not been
applied anywhere. There are no database credentials in this pipeline and none in the container, the
production apply is the owner's own manual step, and the pull request is open rather than merged. So the
file has never run, its filename is in no ledger, and editing it is editing something that has not
happened yet rather than rewriting history.

**This stops being true the moment the owner applies it.** Once `0010` has run against any database, its
name is in `_applied_migrations` with no checksum, so the runner will skip it whatever the file then says,
and a database created before the edit and one created after would disagree about the table's shape with
nothing to detect the difference. From that point the correction arrives as a new numbered file on top,
which for this change means dropping the index, rebuilding the table without `effective_from`, and
recreating the index, since SQLite cannot drop a column that a unique index names. **If the owner has
already applied `0010`, say so before this is built rather than editing the file.**

The same applies to `0011`, which is unapplied and unchanged by this amendment.

**Two numbered files, not one.**

- `0010_create_category_quotas.sql`, the expand half, edited in place per the note above.
  `CREATE TABLE IF NOT EXISTS category_quotas` with the columns above, no `effective_from`, and the
  cascading foreign key, then
  `CREATE UNIQUE INDEX IF NOT EXISTS category_quotas_user_id_category_id_idx ON category_quotas (user_id, category_id)`.
  **The index is renamed as well as narrowed**, because its old name spells out the column that is gone
  and a name that lies about its own columns is worse than a rename in a file that has never run. Both
  statements are separated by the `--> statement-breakpoint` marker the runner splits on, and both are
  idempotent through `IF NOT EXISTS`, matching `0005`. The comment header is rewritten to describe the
  snapshot model, so its effective-dating and `work_schedule`-pattern paragraphs are replaced rather than
  left standing next to a table that has no dates in it.
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
each already resolved to the figure currently in force.

```
[{ categoryId: string, quotaWph: number, source: 'user' | 'default' }]
```

- Non-trackable categories are **absent** rather than present with a null quota. That is `AC1`
  expressed as absence, and it means the client renders what it is handed instead of filtering on
  `trackable` itself.
- `source` says whether the figure came from a stored row or from the shipped default. It exists so the
  client never infers it. A page comparing a figure against a hardcoded default to decide what to label
  it would be a second copy of the rule, which is the duplication the conventions forbid.
- **`effectiveFrom` comes off the response.** It carried the date of the winning row, and there is no
  winning row and no date any more. Keeping it as a permanent `null` would be a field that only ever says
  nothing. `source` alone satisfies what `AC6` actually required, which is that the client is told rather
  than left to work it out. `AC7` and `AC8` carry the consequence on screen, and `AC8` had already
  recorded the no-date fallback string, so no new copy question opens here.
- **The response is no longer date-dependent, so it no longer reads the timezone.** `todayInZone` and the
  `loadWorkSettings` call both leave these handlers, since nothing in the resolution asks what day it is.
  That removes a dependency rather than adding one.
- The read is always scoped to the session user, never to an id from the request, matching
  `getWorkSchedule`. An unauthenticated request is a `401` through
  `defineAuthenticatedEventHandler`.

**`PATCH /api/me/category-quotas`.** Body is `{ quotas: [{ categoryId, quotaWph }] }`. **`effectiveFrom`
comes off the request**, for the same reason it comes off the response. A date on the body would be a
parameter with nowhere to be stored.

- `quotas` holds at least one entry, no duplicate `categoryId`, each `categoryId` a trackable
  category id, each `quotaWph` validated by the existing `quotaWphSchema` (integer 1 to 10000). The
  floor of 1 matters for the same reason it matters on the task override, which is that the quota is
  the divisor in `estimated = words / quota` and 0 would store a row that divides by zero the moment
  `PLAN-12` reads it.
- A non-trackable `categoryId` is rejected with a `422`. That is a data-validity rule rather than
  policing, because a non-trackable category has no quota by definition, so the row would be
  meaningless rather than unusual.
- **The `calendarDaySchema` reuse this criterion asked for is no longer needed here**, because the body
  carries no date. Wherever that schema currently lives is left exactly as it is, and if the backend
  stage already extracted it into a shared server model for this feature's sake, that extraction is
  harmless and can stay rather than being unpicked.
- The write upserts on `(user_id, category_id)`, so saving twice updates the user's single row for that
  category instead of piling up rows the resolver would have to disambiguate. The narrowed unique index
  is the conflict target. The conflict branch sets `quotaWph` and sets `updatedAt` by hand, because
  `$defaultFn` fires on insert only and an update that forgets it leaves a stale instant, which is the
  mistake `update.ts` already avoids the same way.
- Partial by design, like `saveWorkSettings`. Only the categories present in the body are written and
  the others are untouched.
- The response is the same shape the `GET` returns, read back through the single read path, so the
  client reconciles against what the database actually holds. That is the `saveWorkSettings` idiom.
- Validation errors go through `sendZodError` as a `422` with per-field data, and there is no other
  error surface.

**The read path and the resolver.**

- `server/utils/loadCategoryQuotas.ts` reads a user's rows and is the single read path behind both
  handlers, mirroring `loadWorkSchedule.ts`. **Its `ORDER BY effective_from` goes with the column.** There
  is one row per category now, so there is nothing to order and no ordering for the resolver to be
  independent of.
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

**The provenance has two states, both read from `source`, and neither is an absence.** A figure the user
has never touched is marked as a default. A figure they saved is marked as their own. **Both come from
`source` alone, because `effectiveFrom` is off the response per `AC6` and there is no date to show.**
Marking only the default would leave the other state as an absence, and an absence cannot distinguish a
value the user set from a row the section has nothing to say about, so both states say something. The page
still infers nothing, which is what this criterion was always about.

**This is the one place the design blueprint is overtaken.** It put the effective date on the second state
and argued the date was the interesting half. There is no effective date now, so the string is the plain
one `AC8` already recorded as the fallback. The blueprint's badge treatment, its slot and prop assignment,
and its reasoning about why the two states are deliberately unequal in weight all stand unchanged. So does
the trap it recorded about `new Date('2026-08-23')` parsing as UTC midnight, which is worth keeping in mind
even though this section no longer formats a date, because nothing else in the app has learned it yet.

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
| `settings.quotas.userValue`      | Your value.                                       | **research**                                 |
| `settings.quotas.empty`          | No kind of work currently carries a quota.        | **research**                                 |

**The last two keys were added after the design stage and both are corrections rather than
additions.** `userValue` is the missing half of `defaultBadge`, for the reason in `AC7`. **It was
`settings.quotas.userSince`, taking a `{date}` parameter, and it becomes the parameterless
`settings.quotas.userValue`.** The old key named an effective date that no longer exists. This is exactly
the fallback the previous version of this paragraph had already recorded against the possibility that the
owner did not want a date, so the change is taking a recorded option rather than inventing a string. If the
backend or frontend stage has already added `userSince` on this branch, it is renamed rather than left
beside the new key, because two keys for one state is how a locale file rots. `empty` covers a section with
no rows, which cannot happen against today's contract and is exactly the kind of count the extensibility
rule says not to assume away, so the string exists rather than the state rendering blank.

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
- `planning.editor.fields.quotaHint` reads "Vide : votre quota par défaut." and it is wrong twice over
  now. There is no longer a single default quota, and under the snapshot model the field is not usually
  empty either, because the server writes the category's figure onto every trackable task. So the hint
  stops describing an empty field and describes what the number in the field is, which is this task's own
  target, taken from the category when the task was written and editable here. It also has to say what
  clearing the field does, which is to make the task follow the category setting again. Both locales, FR
  **research**. The French space before the colon is already correct there and stays if the new string
  keeps a colon.
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
- The resolver, covering no stored rows, one stored row, a non-trackable category, a figure stored on the
  task, a figure stored on the task in a non-trackable category, a stored row for an id outside the
  contract, and a row for one category never answering for another.
- The `PATCH` model, covering the bounds inherited from `quotaWphSchema`, a duplicate `categoryId`, a
  non-trackable `categoryId`, and an empty `quotas` array.
- The snapshot on both write endpoints, per `AC12`.

**The effective-dating tests are replaced rather than deleted quietly, and this is the largest single
piece of rework in the amendment.** Roughly seven cases in
`test/server/utils/resolveCategoryQuota.test.ts` exist only to prove the date logic, which is the
`a single stored row (AC2)` block and the `a history of several rows (AC2)` block, plus the boundary-day
case, the not-yet-effective case, the unordered-input case, and the three-row case. They are **wrong now
rather than merely redundant**, because they assert behaviour the resolver must no longer have, so leaving
them would fail the suite and deleting them would leave `AC2` untested.

What replaces them is the list under `AC2`, which is a task keeping its figure across a category-setting
edit, a save leaving one row rather than two, and a task with no figure falling through. The count goes down
and the coverage of the actual requirement goes up, since the old cases tested a date comparison and the new
ones test the guarantee. The same applies to the `effectiveFrom` cases in the `PATCH` model tests and to any
ordering assertion in `test/server/utils/loadCategoryQuotas.test.ts`, both of which lose their subject.

**The unit-test stage owns this and it is not optional.** A stage that deletes the old cases without
adding the new ones has weakened `AC2` while appearing to satisfy the suite.

**Nothing in `app/` computes a quota.** Verifiable in the same style as the shipped write-boundary
guard, by asserting that no file under `app/` resolves a quota from a category id or from a stored
row. The client receives resolved figures and renders them. **The snapshot strengthens this rather than
threatening it**, since the figure a client sees on a task is now a stored column rather than anything it
could have been tempted to work out.

### AC11. The dev seed writes the table it now owns

`scripts/seed.ts` deletes the owner's `category_quotas` rows alongside the task and work-schedule rows
it already deletes, then inserts one row per trackable category holding the four shipped defaults. **The
`effective_from` value it used to write goes with the column.**

**The seeded tasks keep their NULL figure and the seed writes no snapshot onto them.** That is the same
decision as [existing tasks keep their NULL](#existing-tasks-keep-their-null) and it is deliberate here
rather than an omission. The seed inserts rows directly rather than through the write path, so it reaches
the database the same way a pre-feature row did, and leaving them NULL is what gives a developer real data
exercising steps 3 and 4 of the resolution order. The snapshot branch is one click away, since creating a
task in the running app goes through `POST /api/tasks` and gets its figure.

The values are the shipped defaults rather than invented figures, so no number enters the dev database
that the contract does not already carry. The point of seeding them is that the stored-row branch of
the resolver is the branch production uses after the user saves once, so it should be the branch a
developer sees, and the `source` field in the API response is what distinguishes it from the default
branch on screen. Re-run safety is unchanged, since the seed deletes and rebuilds rather than
appending.

### AC12. The task write path stores the quota the task was created against

**This criterion is new and it is the mechanism the whole amendment turns on.** It reaches
`POST /api/tasks` and `PATCH /api/tasks/[id]`, which the approved spec did not touch, and that reach is
named in [the new surface this brings](#the-new-surface-this-brings-named-rather-than-absorbed) rather
than left in the diff.

**On create.** `POST /api/tasks` resolves the quota for the resulting task's category and stores it in
`tasks.quota_wph_override`. **The snapshot** stores nothing when the resulting category is not trackable,
and nothing when the body supplied a figure of its own.

The subject of that second sentence is the snapshot rather than the endpoint, and the distinction is not
pedantry. The snapshot is not the only writer of this column: `quotaWphOverride` is a writable field on
both bodies, so a request carrying a figure stores it whatever the category, which is precedence rule 1
below and is deliberate, because the editor shows the quota field for every category on purpose. A `PATCH`
carrying a figure on a task in `meetings` therefore does store it. Nothing downstream is harmed by that,
since the resolver gates on `trackable` before it reads the column, and
[a task carrying a figure on a non-trackable category](#a-task-carrying-a-figure-on-a-non-trackable-category)
covers the case. Read this paragraph as describing what the resolution writes, never as a claim that the
column is unreachable by any other path.

**On update.** `PATCH /api/tasks/[id]` re-snapshots when and only when the request changes the task's
category. **Yes, changing a task's category re-snapshots it**, because a task recategorised from
translation to proofreading is measured against the wrong target otherwise, and the target it should be
measured against is the one in force for the kind of work it actually is.

**The precedence rules, because a single request can ask for two things.**

1. **A figure in the body always wins.** A request that carries `quotaWphOverride` is the user stating what
   this task's figure is, so the server stores what they sent and does not re-snapshot, whether or not the
   same request also changes the category.
2. **An explicit `null` in the body wins too, and is not immediately overwritten.** Clearing the field is
   the user asking this task to follow their category setting again, which is a legitimate thing to want and
   is the way back out of a snapshot. A re-snapshot on the same request would make the clear a silent no-op.
3. **Otherwise, a category change re-snapshots and anything else does not.** A change of date does not
   re-snapshot, because nothing in the resolution depends on the date any more. A change of word count,
   status, notes, or duration does not either.
4. **A move to a non-trackable category leaves the stored figure alone rather than clearing it.** This is the
   `no-quota-for-category` outcome only, and it does not extend to a resolution that merely failed. That is
   the existing rule for this column, kept deliberately, so the figure survives for as long as the task sits
   in the non-trackable category rather than being destroyed on the way in. It does not survive the way back:
   the return leg is a category change whose result is trackable, so rule 5 re-snapshots and what the task
   ends up holding is the category's current figure rather than the one it left with. An earlier wording of
   this rule promised that a task moved to a meeting and back "brings its figure with it", which rule 5
   contradicts, and the round trip is worth understanding as a replacement rather than a preservation.
   **The cost, since one column holds two facts.** A figure the user typed by hand is indistinguishable from
   one the server snapshotted, so a hand-typed figure on a trackable task is silently replaced by the
   category's when the task makes that round trip. Distinguishing the two would take a second column and is
   not in this feature. The trackable gate is what stops the figure being used in the meantime. This is
   deliberately unlike the status-clearing rule in `update.ts`, which does clear, and the difference is that
   a status a category cannot hold is an invalid row while a stored figure a category does not use is merely
   an unused one.
5. **A move from a non-trackable category to a trackable one re-snapshots**, since it is a category change
   whose resulting category is trackable. So a task that sat in `breaks` holding a stale figure gets a fresh
   one when it becomes real work.

**The common path is the update rather than the create, and this is worth stating because it looks like an
edge case and is not.** `TaskCreateSchema` defaults `category` to `DEFAULT_CATEGORY_ID`, which is `other`,
and `other` is not trackable. The inline editor creates a row from `emptyEditorState`, which holds that same
default. So a task created without a category gets no snapshot on the `POST`, and it gets one on the first
`PATCH` that sets a real category. That is the normal flow through the app, and any implementation that only
snapshots on create would leave most tasks with no figure at all.

**A resolve that fails leaves NULL rather than failing the write, and "no figure" is three different
outcomes rather than one.** The app records reality and never blocks, so a task must never be refused
because a quota could not be read. But the three reasons a resolution produces no figure do not all mean
the same thing to a caller, so `resolveQuotaSnapshot` returns which one it is instead of a nullable number.

| Outcome                 | What it means                                                                                                                                                 | On create     | On a category change                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------- |
| `resolved`              | A figure was found                                                                                                                                            | Store it      | Store it                                       |
| `no-quota-for-category` | The category is not trackable, so it has no quota by definition                                                                                               | Store nothing | Leave the stored figure alone, which is rule 4 |
| `unresolved`            | Trackable, and still nothing resolved. No shipped category reaches this, since all four trackable ids carry a `defaultQuotaWph`. `PLAN-30` makes it reachable | Store nothing | Write `NULL`                                   |
| `read-failed`           | The read threw. Logged, never rethrown                                                                                                                        | Store nothing | Write `NULL`                                   |

**The principle behind the split.** A figure resolved for one category is never correct on a task in
another. So the only question a failure leaves open is whether the row ends up holding a stale figure the
trackable gate ignores, which is harmless, or one the gate will happily use, which is the defect. Rule 4
earns its exemption because the gate closes behind it. A failed resolve onto a trackable category does not,
because the gate is open and the resolver reads the old category's number as this task's own snapshot with
`source: 'task'`.

**Why the create can collapse all three and the update cannot.** On a create there is no previous figure, so
declining to write is genuinely "no figure", the row resolves through steps 3 and 4 like any pre-feature row,
and the user can type one. On a recategorising update the row already holds the number resolved for the
category it is leaving, so declining to write is not "no figure" at all. `NULL` is not a perfect answer there
and it is the right one, since the row then resolves through the _new_ category's current setting, which is
approximately right, where keeping the old category's figure is definitely wrong.

This fail-open direction is therefore not in tension with the trackable gate's fail-closed direction, but the
reason is narrower than "one is about quotas and one is about records". It is that neither path is ever
allowed to leave a usable figure belonging to a different kind of work.

**The write-boundary guard is amended, not deleted.**
`test/server/api/tasks/write-boundary-guards.test.ts` currently asserts that no file under
`server/api/tasks/` mentions `quotaWph` beyond the `quotaWphOverride` passthrough. `AC12` writes a resolved
quota there, so the guard becomes an assertion that **no file under `server/api/tasks/` performs quota
arithmetic**, which keeps `PLAN-12`'s and `PLAN-22`'s ground out of this feature. Its comment is rewritten
to say why the old form retired, which is that the wrong global quota it was protecting against is gone and
the resolver it now calls is the right one. Deleting the guard would be weakening it and is not what is
specced. See
[the resolver's consumer](#the-resolvers-consumer-decided-under-the-snapshot-model) for the full reasoning.

**Verifiable by handler tests.**

- A create in a trackable category stores the resolved figure, and the response carries it.
- A create in a non-trackable category stores NULL.
- A create carrying its own `quotaWphOverride` stores what was sent.
- A patch changing category from one trackable category to another replaces the figure with the new
  category's.
- A patch changing category while also sending `quotaWphOverride` stores the sent figure.
- A patch sending `quotaWphOverride: null` while also changing category stores NULL.
- A patch changing only the date leaves the figure untouched.
- A patch moving a task to a non-trackable category leaves the figure untouched.
- A create for a user with a stored `category_quotas` row uses that row rather than the shipped default.

## Outputs and acceptance criteria that stand unchanged

Recorded as a list so review can see at a glance what the amendment did not touch.

- **`AC1`** stands. The contract field, the accessor, the coercion, and the consistency assertion were never
  about dates.
- **`AC3`** stands word for word. The retirement of `settings.quota_wph`, the exhaustive reader list, the
  grep instruction, and the warning about the number 450 are all unchanged.
- **`AC4`** stands. The research note and the retirement sentence are unaffected.
- **`AC9`** stands. The purge still names `category_quotas`, the count still moves from six to seven, and the
  cascade is still the second line of defence.
- **`AC5`, `AC6`, `AC7`, `AC8`, `AC10`, and `AC11` are amended but not weakened.** `AC5` keeps two files, the
  same apply order, the same undo, and the same headers. `AC6` still resolves server-side and returns finished
  figures, still rejects a non-trackable id with a `422`, still scopes every read to the session user, and is
  still partial. `AC7` keeps every requirement including the measured contrast. `AC8` keeps identical key sets
  in both locales and the French typography rule. `AC10` keeps tests as a criterion and gains the write-path
  cases. `AC11` still seeds the shipped defaults.

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

### A task carrying a figure on a non-trackable category

Storable today, because the editor shows the quota field for every category deliberately, and now also
reachable by moving a task that already carried a snapshot into a non-trackable category. The resolver gates
on `trackable` first, so the figure never produces a quota for a meeting or a break. The value stays stored,
and per `AC12` rule 4 the write path does not clear it either, so recategorising the row to a trackable
category brings it back. See the resolution order above for why this is a gate rather than the last step.

### A partially completed edit

The `PATCH` carries every changed category in one body and one statement per row, so a failure part way
through can leave some rows written and some not. That state is not invalid and not stranded. Every
row that landed is a complete row, every row that did not is still resolving its previous value or the
shipped default, and the recovery is to save again, which upserts on the same `(user_id, category_id)` key
and converges.

The client reconciles against the response rather than against what it sent, so a partial failure shows
the user what actually persisted rather than what they typed. The failure toast plus a re-save is the
recovery, and there is no cleanup step and no half-written row to repair.

**A single-statement transaction is not required for correctness here** and is not specced. Each row is
independently meaningful, unlike a two-table write where half the state is nonsense.

### Two edits to the same category

The second updates the first's row. Editing a figure twice leaves one row for that category holding the
latest value, rather than two rows the resolver would have to break a tie between. That is now true of any
two edits rather than only of two on the same day, because the unique key no longer carries a date.

**A typo is still correctable on the setting and is not correctable on tasks already created with it.** The
second edit fixes what every future task is measured against, and every task already written keeps the wrong
figure until someone edits those rows one at a time. That is the trade `AC2` records, and it is the trade the
leading tool in this domain also makes.

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
- **`0010` applied in its old effective-dated shape before this amendment is built.** Then editing the file
  is not available, per `AC5`, and the fix arrives as a new numbered migration that drops the index, rebuilds
  the table without `effective_from`, and recreates the narrowed index. This is the one case in the list that
  needs the owner to say something rather than the pipeline to do something, because nothing in this
  environment can read the ledger to find out.

### The timezone boundary on "today"

**This case is gone rather than solved.** It existed because `effectiveFrom` defaulted to today and an edit
made late in the evening could land on tomorrow's date. Nothing in the quota endpoints reads a date now, so
there is no boundary to sit on. `todayInZone` stays exactly where it is and keeps its other callers, and it
is simply no longer this feature's business.

### A quota of zero, or an absurd one

Zero is rejected by `quotaWphSchema`'s floor of 1, because the quota is a divisor. An unusually high or
low figure inside the range is accepted without comment, per the do-not-police rule. The app may
signal later, through `PLAN-22`, and it never blocks.

### The settings API errors while the page is open

The shipped pattern covers it. The section renders its `UAlert` and its retry control, the other
sections keep working because they load independently, and a failed save leaves the typed values in the
form so nothing has to be retyped.

### A task created before its category was chosen

The normal flow rather than an edge, and it is spelled out under `AC12`. A create with no category stores
`other`, which is not trackable, so no figure is stored. The first patch that sets a real category stores one.
A task that never gets a real category never gets a figure and never needs one.

### A task whose figure the user cleared, and then the category setting changes

The task follows the new setting, which is what clearing asked for. That reintroduces the moving figure for
that one row, deliberately, because it is the only way back out of a snapshot and the user asked for it
explicitly. The do-not-police rule says a user who asks for this gets it.

### A user changes a category and the same figure they wanted was already there

The editor sends only changed fields, so a user who changes the category and separately types the number the
old snapshot already held sends no `quotaWphOverride` at all, and the server re-snapshots over their intent.
This is the same class of ambiguity the editor already documents for the category selector, where picking the
id the coercion already displays cannot be told from not touching the field. It resolves the same way, which
is that the user can see the resulting number and change it. Not worth a mechanism.

### A write that is interrupted partway

Each write is a single statement per row and there is nothing to unwind. A create that fails writes no task
at all, so there is no task with a missing figure. A patch that fails writes nothing, so the task keeps the
category and the figure it had, which is a consistent pair rather than a new category against an old figure.
A quota read that fails during a create leaves the figure NULL, which resolves through the fallback, per
`AC12`.

### The snapshot and the category setting disagree, which is the normal state

Not an error and not a state to reconcile. A task written in March holding 240 while the setting now says 260
is the feature working. Nothing in the app offers to bring them into line, no banner points it out, and no
migration corrects it. Anyone reading a task's figure is reading what that work was targeted at.

## Assumptions taken rather than asked

Recorded under their own heading because this document was written without a live conversation, so
each of these is a decision made to keep the build unblocked rather than a question left open.

1. **The settings section is a third section on the existing settings page** rather than a new route.
   It is a handful of numeric fields and it belongs next to the work settings it used to live inside.
2. **The `GET` resolves the current figure** and takes no date parameter. It used to say "for today only",
   which was the effective-dated phrasing of the same thing. There is one figure per category now, so there
   is no date to resolve for. `PLAN-22` reads what a period was measured against from the figures stored on
   the tasks in that period rather than from this endpoint.
3. **`source` is on the response and `effectiveFrom` is not.** `source` exists so the client never infers
   whether a figure is a default. **Corrected twice.** It first said dropping both fields would cost the
   default marker and nothing else, which stopped being true when the design put the date on screen. It then
   said both were read by `AC7`. Under the snapshot model there is no effective date at all, so
   `effectiveFrom` leaves the response, `AC7` reads `source` alone, and `AC8`'s recorded no-date string is
   what ships. `source` is what carries the requirement, which is that the page is told rather than
   comparing a figure against a hardcoded default.
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

7. **The snapshot lives in `tasks.quota_wph_override` rather than in a new column, and the column keeps its
   name.** Both halves are argued in
   [the field the snapshot lives in](#the-field-the-snapshot-lives-in-and-why-it-is-the-existing-one). The
   owner approved the snapshot model and not this particular placement, so this is a coordinator decision on
   an implementation question the approval did not reach. It is cheap to revisit before the backend stage
   runs and expensive after, so if the owner wants the override kept separate, say so before the build.
8. **Existing tasks keep their NULL and no migration backfills them.** Per
   [existing tasks keep their NULL](#existing-tasks-keep-their-null).
9. **Changing a task's category re-snapshots it.** Per `AC12`, with the precedence rules for a request that
   does two things at once.
10. **Assumption 6 above is untouched by the architecture change.** The snapshot model changes
    nothing about whether categories become per-user rows, and `category_quotas` is still keyed by a
    free-text `category_id`, so everything item 6 says still holds.

## Stages

Specs and code review are never skipped.

- **Design** runs, small. One new settings section, four numeric inputs, and the default marker. It
  decides whether the category labels take their `PLAN-32c` colour and it measures contrast if they do.
- **Backend** runs and does most of the work. **It has already run once against the effective-dated shape,
  so a large part of its brief is now undoing rather than building.** The contract field, the table, both
  migrations, the read path, the resolver, both handlers, the model, the purge line, and the seed, plus the
  snapshot on the task write path and the amended write-boundary guard.

  What it removes from its own previous output is `effective_from` from the table, the migration and the
  Drizzle definition, the third member of the unique index and the index's name, the `on` parameter from
  `resolveCategoryQuota`, `effectiveFrom` from `CategoryQuotaRecord`, `ResolvedCategoryQuota` and the API
  response, `effectiveFrom` from the `PATCH` body and its schema, the `ORDER BY` in `loadCategoryQuotas`, the
  `todayInZone` and `loadWorkSettings` calls in the quota handlers, and the `effective_from` value the seed
  writes. It renames the `'override'` source to `'task'`. It rewrites the `0010` header, the
  `category_quotas` schema comment, and the `tasks.quotaWphOverride` schema comment.

- **Frontend** runs. The new settings section, the removal of the quota field from `work-fields.vue`
  and the onboarding step, the composable and page edits, and every locale change including the
  researched Québécois strings. Its two changes from the amendment are that the provenance line reads
  `source` alone with no date formatting, and that `settings.quotas.userSince` becomes the parameterless
  `settings.quotas.userValue`. The editor hint copy is the other string that changes, per `AC8`.
- **Unit test** runs, and `AC10` is its brief rather than a suggestion. It also updates the four
  existing test files listed in `AC3`. **Its largest single job is replacing the effective-dating cases
  rather than deleting them**, which `AC10` sets out, plus the new write-path cases from `AC12`.
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
- [`task-inline-editor.md`](task-inline-editor.md). Its editor keeps the quota field unchanged in code. The
  field's hint copy changes per `AC8`, and what the field means changes, because it now usually arrives
  holding the task's own recorded figure rather than empty. That spec should say the field is the task's
  quota rather than an override of a default.
- [`tasks-schema.md`](tasks-schema.md) (`PLAN-01`). Its item 3 and its column table describe
  `quota_wph_override` as "a nullable per-task override of the user's default quota (`settings.quota_wph`)",
  which is wrong in both halves once this ships. The column holds the figure the task was created against
  and the global it names is gone. Corrected in the same pass, on that field only.
- [`task-write-api.md`](task-write-api.md) (`PLAN-09`). Two things. Its statement that nothing in the write
  path reads a quota stops being true, per `AC12`, and its handoff paragraph explaining why the estimate is
  not derived there keeps its conclusion while losing its stated reason, since the wrong global quota it
  named is replaced by a correct per-category one. The estimate is still not derived, and now the reason is
  simply that deriving it is `PLAN-12`'s decision rather than that no usable divisor exists. It also gains
  the note that `quotaWphOverride` is now server-written as well as client-writable.
- [`docs/TODO.md`](../../TODO.md). Its line describing the settings page as editing a "default WPH
  quota" is stale once this ships and is corrected in the same pass.

## Open questions

**One of these now blocks, which was not true before.** Question 6 has to be answered before the build
starts, because the answer decides whether a migration file may be edited or must be superseded. The rest
do not block.

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
5. **What `PLAN-22` wants from the resolver.** `resolveTaskQuota` still ships with no runtime caller, so
   `PLAN-22` decides whether it reads per task, per category, or both. **It no longer inherits the
   write-boundary guard amendment**, because `AC12` needs that amendment now and makes it, leaving
   `PLAN-22` the narrower job of relaxing the arithmetic guard when it has arithmetic to do.
6. **Whether `0010` has already been applied against any database.** This decides whether `AC5`'s
   edit-in-place instruction is available or whether the change needs a new numbered migration on top.
   Nothing in this environment can read the ledger, and the answer is the owner's. **The build should not
   start until this is answered**, because getting it wrong in the optimistic direction leaves two databases
   with different table shapes and nothing to detect it. It is the one question in this list that does block.
7. **Whether the snapshot belongs in `tasks.quota_wph_override` or in a column of its own, and whether that
   column should be renamed.** The owner approved the snapshot model and did not rule on the placement.
   Assumption 7 is the coordinator's decision and the reasoning is in
   [the field the snapshot lives in](#the-field-the-snapshot-lives-in-and-why-it-is-the-existing-one). It does
   not block, and it is much cheaper to change before the backend stage runs than after.

## What this architecture costs, in one place

The reasons are argued where each decision is made. They are collected here so the trade is readable
without hunting, and so nothing on this list can be presented later as a surprise.

1. **A typo'd target cannot be retroactively fixed on tasks already created with it.** The setting is
   correctable and the tasks are not, except one row at a time in the editor. This is the trade the leading
   tool in this domain already makes and its users live with, and it is the direct cost of preferring a
   stored fact over a dated lookup. `AC2` records it.
2. **Every trackable task row now stores a number.** One integer per row, which is nothing in storage terms,
   but it also means the editor's quota field is normally populated rather than normally empty, which changes
   how that field reads and is why its hint copy changes again in `AC8`.
3. **Roughly seven effective-dating tests become wrong rather than merely redundant**, plus the boundary and
   ordering cases around them. They assert behaviour the resolver must no longer have, so they are replaced
   rather than deleted quietly. `AC10` says what replaces them and why deleting without replacing weakens
   `AC2` while appearing to pass.
4. **One column cannot record two facts.** Repurposing `quota_wph_override` gives up the distinction between
   a figure the server snapshotted and a figure the user typed, and between a row written before this feature
   and a row the user deliberately cleared. Nothing shipped or specced reads either distinction.
   [The field the snapshot lives in](#the-field-the-snapshot-lives-in-and-why-it-is-the-existing-one) records
   the cheaper reversal if one is ever needed.
5. **The column's name stops describing what it holds**, and it is kept anyway on the project's own
   `project_word_count` precedent. A reviewer flagging it is right and is declined on those grounds, which is
   written down so the point is settled rather than re-argued on every future pull request.
6. **Two patterns now exist in this database for what looked like one problem.** `work_schedule` stays
   effective-dated and `category_quotas` does not. The reason they differ is real, which is that a work
   schedule has no record to write itself onto and a quota has a task, and it is stated in
   [why the task carries the figure](#why-the-task-carries-the-figure-rather-than-the-table-carrying-a-history)
   so the difference reads as a decision rather than an inconsistency.
7. **The feature reaches the task write path, which the approved spec did not.** Named in
   [the new surface this brings](#the-new-surface-this-brings-named-rather-than-absorbed), argued as a
   consequence of the approved architecture rather than absorbed scope, and kept to one resolved number on two
   endpoints with no arithmetic and no contract change.
