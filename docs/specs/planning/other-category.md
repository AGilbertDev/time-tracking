# The other category

New scope, ruled by the owner on 2026-07-31 while the inline editor was being built. It amends
`PLAN-32a` ([nine-task-categories.md](nine-task-categories.md)) and it supersedes two settled
decisions in [task-inline-editor.md](task-inline-editor.md), listed in full under [what this
supersedes](#what-this-supersedes-in-the-inline-editor-spec). Shared contract, i18n, the read path,
the write boundary, and the editor's category and status controls. **No migration.**

**Criteria in this file are numbered `UC1` upward rather than `AC1` upward, on purpose.** This
feature lands on the same branch as an editor spec that already numbers to `AC70`, and two `AC1`s on
one branch is a citation a test author cannot resolve. Cite these as `UC` numbers and the editor's as
`AC` numbers, and nothing in either file is renumbered. **Criteria added after the first version of this
spec are numbered at the end rather than inserted where they read**, which is why `UC38` to `UC41` sit
before `UC17` and `UC42` sits inside the colour section. Nothing already quoted from this file moves.

## Intent

A tenth category exists, `other`, and it is both the coercion fallback and the default a task gets
when nobody picks one. That is one id with two jobs, and both of them are currently done by `admin`,
which is wrong in both.

**Coercion.** `coerceCategory` folds an unknown or retired stored id onto the default, and today that
default is `admin`. The owner's reason for moving it, quoted so it survives the next reader who would
pick `admin` again:

> "Admin is time tracking, email, etc"

Administration is real work a translator books time against. Coercing an unknown value into it makes
the row assert something false about what the user did, and it quietly inflates a real category, so
the one place in the app that exists to fail safely is instead adding fictional administration hours.
`other` asserts only what is actually known, which is that the kind of work is not recorded. The
shipped contract argues the opposite in a comment, that "admin is the natural catch-all bucket for
uncategorized work", and that sentence is exactly what the owner's ruling retires.

**The default.** A task saved with no category choice stores `other`, so category stops being
required on create. The inline editor spec declined to preselect anything on the grounds that both
plausible defaults corrupt statistics, `translation` by labelling a break as translation work and
`admin` by removing real work from the quota numerator. That reasoning was correct about those two
candidates and it does not reach this one. `other` is non-trackable, so it produces no words and
contributes nothing to a quota, and a figure it cannot move is a figure it cannot corrupt. It also
brings the create form in line with **do not police the user**, because a save blocked by a dropdown
nobody touched is the app refusing to record something that happened.

**The id is `other` because the copy is `Autre`, and that order matters.** This spec first proposed
`Sans catégorie` and `No category` against an id of `uncategorized`, and the owner chose `Autre` and
`Other` instead. The id followed the copy rather than the other way round, and the rename is a design
consequence rather than tidying. `Autre` reads as a real category, one more kind of work the user did,
where `Sans catégorie` reads as a field left empty. An id that says the row has no category, sitting
under a name that says the row is other work, is how the next reader concludes the two are different
things and starts writing code for a distinction that does not exist. So the stored id, the file name,
and the visible name all say the same thing.

Four things needed working out rather than assuming. The status field, the dropdown's membership, and
where the default is supplied are settled here, each with its reason written down. The colour went to
the design stage, which returned hue 90 with no exception to the palette rule, and the owner accepted
that in full, so it is recorded here as a decision under [the colour](#the-colour-decided-by-the-design-stage-and-accepted-in-full).

## Inputs

### Runtime inputs

Only two, and neither is new machinery.

1. A category chosen in the editor's category control, which now has a tenth option.
2. A create request that carries no `category` key at all, which is newly legal.

### The decisions and the code this builds on

1. **The owner's rulings of 2026-07-31**, the fallback move with the quoted sentence above as its
   recorded reason, and the copy choice of `Autre` and `Other` that the id follows.
2. **The shipped category contract.** `shared/categories.ts` is the only declaration site for a
   category id, its trackable flag, and its hue, and `nine-task-categories.md` is the spec that locked
   the nine.
3. **The colour mechanism.** `.planning-cat-name` in `app/assets/css/main.css` reads
   `--planning-cat-hue` with lightness and chroma fixed per mode, light at 0.47 and 0.11 and dark at
   0.74 and 0.13. `.planning-cat-edge` reads the same three properties for the editor's left edge.
4. **`PLAN-32c`'s contrast rule**, recorded in
   [category-column-coloured-names.md](category-column-coloured-names.md), that no member of the
   palette is a neutral and that contrast therefore follows from a single hue integer across the whole
   wheel.
5. **The write boundary.** `server/models/tasks.ts` for `categorySchema` and the two bodies,
   `server/api/tasks/handlers/write.ts` for `assertStatusFitsCategory` and the status-clearing rule.
6. **The read path.** `server/api/tasks/handlers/list.ts` resolves `trackable` and `statusKey` and
   hands them to the client already decided.
7. **The inline editor spec and the shipped editor**, whose category control, status control, and
   mandatory-field rule this changes, plus `app/utils/taskEditor.ts` and
   `app/components/planning/TaskEditor.vue`.
8. **The accessibility stage's findings of 2026-07-31**, one of which is fixed here and three of which
   are recorded as follow-ups.
9. **The conventions.** `AGENTS.md` and `.recipes/CLAUDE.md`. Logic belongs to the backend, the data
   layer decides where it can, one declaration rather than two copies that drift, do not police the
   user, French first and researched.

### Verified in this container, not assumed

1. **No migration is needed for stored values, and this is confirmed from the DDL rather than
   inferred.** `server/db/schema.ts` line 79 is `category: text('category').notNull()`, and
   `server/db/migrations/0004_add_tasks_table.sql` line 41 is `` `category` text NOT NULL ``. There is
   no CHECK constraint and no enum on the column in any migration, and the only `DEFAULT` clause in
   that file is on `sort_order`. So the column already accepts a tenth value, every existing row keeps
   whatever it holds, and this feature adds no migration file.
2. **There are exactly nine ids today**, in `DEFAULT_CATEGORY_IDS`, and `DEFAULT_CATEGORY_ID` is
   `'admin'`.
3. **There are exactly nine `categories.*` keys in each locale file**, `i18n/locales/fr.json` and
   `en.json`, in a `categories` object starting at line 180 in each and at parity. A tenth id without
   a tenth key in both files is ten ids shipping against nine keys and a missing translation on
   screen, which is why the contract and the i18n move as one step.
4. **The existing suite hardcodes both numbers this feature changes.**
   `test/shared/categories.test.ts` asserts `toHaveLength(9)` twice, asserts `DEFAULT_CATEGORY_ID` is
   `'admin'`, and asserts that unknown values coerce to `'admin'`. Those assertions fail the moment
   the contract changes, and that is the suite doing its job. They are updated to the new ruling and
   the contract is not reverted to get back to green. **This happened as predicted while the contract
   step was in flight**, with six test files red asserting a nine-member set. That is the expected
   middle of `UC34` rather than a defect, and it clears when the contract step finishes.
5. **The editor already gates the status field on trackability in two places.**
   `diffEditorState` in `app/utils/taskEditor.ts` sends `status` only when
   `isTrackableCategory(current.category)` is true, and `statusModel` is a computed in
   `app/components/planning/TaskEditor.vue`. Both are what the separation below rewrites, and both are
   where the stale-display defect lives.

## Scope

In scope. The tenth id, its descriptor, its hue, and its locale keys in both files. `coerceCategory`
landing on it. The separation of the two things `trackable` currently means, described under [the
status field](#the-status-field-and-the-two-meanings-of-non-trackable). The stale status display the
accessibility stage found, under [the stale status display](#the-stale-status-display). The create
body's category becoming optional and defaulted. The editor's selector with its separator above `Autre`,
its preselected value, and its status control. The row's words cell, which needs the same separation. The prose in
`shared/categories.ts` and in the two specs this contradicts. The seed. The tests.

Out of scope.

- **A migration.** None is needed, per the verified DDL above.
- **`PLAN-30`, user-created categories.** The second per-category fact this feature adds is one more
  thing a custom category will have to declare, and that is `PLAN-30`'s to handle when it lands.
- **Per-category quotas, `PLAN-32b`.** `other` is non-trackable, so it never divides by a quota and
  needs no rate.
- **Any change to which of the existing nine is trackable.** The four trackable ids and the five
  non-trackable ones keep their flags exactly as `PLAN-32a` locked them.
- **A backfill of existing rows.** Nothing rewrites a stored category. A row holding the retired
  `revision` keeps holding it and simply reads better than it did, because coercion now resolves it to
  a truthful label instead of to Administration.
- **Renaming `nine-task-categories.md`.** The file name goes stale and a rename costs every link into
  it. It is annotated instead.
- **The three accessibility chores** under [follow-ups](#follow-ups-recorded-not-built-here).

## Outputs and acceptance criteria

### The tenth id and the fallback

`other` joins `DEFAULT_CATEGORY_IDS` in tenth place, after `dtp`, and the existing nine keep their
order and their indexes. Last is where a catch-all belongs in a list of specific kinds of work, and
leaving the nine untouched means nothing that reads the tuple by position shifts.

`DEFAULT_CATEGORY_ID` becomes `'other'`, and it keeps doing both jobs from one constant. The fallback
and the create default are deliberately the same value rather than two constants that happen to agree,
because the question they answer is the same question, which is what a task's category is when nothing
reliable says. If a later feature ever needs them to differ, that feature splits the constant and says
why.

- **UC1.** `DEFAULT_CATEGORY_IDS` holds exactly ten ids, the existing nine in their existing order
  followed by `other`. No existing id changes index.
- **UC2.** `DEFAULT_CATEGORIES` holds ten descriptors in the same order, and `other` is declared
  `trackable: false`.
- **UC3.** `DEFAULT_CATEGORY_ID` is `'other'`, and its comment records the owner's quoted sentence and
  why `admin` is the wrong fallback, so the reasoning is next to the value rather than only in this
  file.
- **UC4.** `coerceCategory` returns `'other'` for every value that is not one of the ten, covering
  `null`, `undefined`, a number, an empty string, an id with surrounding whitespace, an object, and the
  retired `'revision'`. It returns `'admin'` for the input `'admin'` and for nothing else.
- **UC5.** `isTrackableCategory('other')` is false, and `isTrackableCategory` of any unknown value is
  false, so the fail-closed property `PLAN-32a` relied on survives the change of fallback.
- **UC6.** `categoryHue('other')` returns the single integer the design stage supplies, and
  `categoryHue` of an unknown value returns that same integer rather than `admin`'s 305. The comment in
  `categoryHue` that says an unknown value borrows `admin`'s colour is corrected.
- **UC7.** No file outside `shared/categories.ts` names `'admin'` as a fallback or as a default. A
  search for the literal finds it as an ordinary member of the set, in the locale files, in the tests,
  and nowhere else. No file under `shared/`, `server/`, `app/`, `scripts/`, `test/`, or `i18n/`
  contains the string `uncategorized`, since the id, the file name, and the visible name all say the
  same thing now. The word survives only in this spec, where it appears twice on purpose, once quoting
  the contract comment being retired and once recording that the id followed the copy.

### The status field, and the two meanings of non-trackable

**Ruled by the owner. `other` is not trackable and it does carry a status.** Non-trackable means the
row contributes no words and no quota. It does not mean the row has no status. That is not a special
case bolted onto the flag, it is a second declared fact, because `trackable` currently answers two
different questions at once and this is the category that pulls them apart.

The two questions are whether the row's words count toward the quota, and whether the row is a piece
of work that can be in progress and therefore has a meaningful status and a meaningful word count. For
all nine existing ids the answers agree, so one boolean has served both and nobody had to notice. A
break, a meeting, administration, desktop publishing, and terminology work are consumed time with no
deliverable, so they have no status and a word count on them means nothing. The four trackable ids are
deliverables that count. `other` is the first member where the answers differ. It is other work, of a
kind the user did not name, so a word count and a status are both meaningful on it, and it still must
not touch the quota.

**Why it carries a status rather than staying disabled.** The row that ends up as `other` is a real
working row with a client, a delivery date, and words to do, whose category the user either did not
pick or did not find in the list. Marking it `Terminé` is the most ordinary thing the user will want
from it. Requiring a classification first makes the app charge a category for the use of the status
field, which is policing, and it is worse than the field simply being absent because the user can see
the control and cannot use it. It also misinforms the week at a glance, since `statusKey` would resolve
`na` and the row would read in the same visual class as a break, which is the same shape of false claim
that moving the fallback off `admin` exists to stop. And the coercion path makes it concrete. A legacy
row holding the retired `revision` with a stored `Terminé` reads as `na` today, its status hidden by a
coercion the user never asked for, and after this change it reads as finished, which is what it is.

**What it costs, said plainly.** A second per-category fact reaches further than a tenth id would on
its own. It touches the descriptor type, the ten descriptors, a new helper beside
`isTrackableCategory`, `statusKey`'s guard, `PlanningTask`, the list handler that resolves it,
`assertStatusFitsCategory`, the update handler's status-clearing rule, the row's words cell,
`diffEditorState`, and `statusModel`. **The cheaper alternative was considered and rejected**, which is
to let `other` behave exactly as `admin` behaves today, leaving the status disabled and the words cell
reading not-applicable. It ships in an afternoon and it leaves two defects on what will be the most
common non-trackable row in the app, a status the user cannot set and a word count the user typed that
the row refuses to print. Both would need this same separation to fix later, on rows by then holding
real data.

**The name of the second fact is the contract stage's to finalize.** This spec proposes `deliverable`
on the descriptor, with `isDeliverableCategory(id)` beside `isTrackableCategory(id)` and a resolved
`deliverable` boolean on `PlanningTask`. Any other name is acceptable provided it is not a synonym of
`trackable`, reads positively so call sites are not double negatives, and carries a comment saying
which of the two questions it answers. What is not acceptable is overloading `trackable`, or deriving
the answer from an id comparison against `'other'`, because that is a special case where a declared
fact belongs and `PLAN-30` would inherit it.

- **UC8.** The `Category` type carries a second declared boolean beside `trackable`, true for the four
  trackable ids and for `other`, false for `terminology`, `meetings`, `breaks`, `admin`, and `dtp`. A
  helper resolves it from an arbitrary value and coerces first, so an unknown id inherits `other`'s
  answer.
- **UC9.** A test asserts the invariant that no descriptor declares `trackable: true` with the second
  flag false, so the two facts cannot be declared in a combination that means nothing. The invariant is
  a check rather than a comment, because `PLAN-30` will add descriptors nobody reviews.
- **UC10.** `statusKey` resolves `na` for a category that does not carry a status and resolves the
  stored value normally for `other`. A stored `Terminé` on an `other` task resolves `termine`, and the
  same stored value on a `breaks` task still resolves `na`. The late guard applies to an `other` task
  like any other, so an overdue one that is not finished resolves `retard`.
- **UC11.** `PlanningTask` carries the resolved flag alongside `trackable`, decided in the list handler
  and handed to the client finished. No component derives it from a raw category id, with the single
  exception the editor already has, which is reading the shared helper for the **pending** selection
  because that selection has not been saved yet.
- **UC12.** `assertStatusFitsCategory` refuses a status only when the resulting category does not carry
  one. A create or update sending `category: 'other'` with `status: 'Terminé'` succeeds. The same body
  with `category: 'breaks'` is still a 422 whose `data` names `status`.
- **UC13.** The update handler's status-clearing rule clears the stored status when a write moves a task
  to a category that carries no status, and leaves it alone when a write moves a task to `other`. A
  translation task holding `Terminé` moved to `other` still holds `Terminé` afterwards, read back from
  the row. The same task moved to `breaks` holds null afterwards.
- **UC14.** The `Mots` cell prints an `other` row's stored word count rather than the em dash, and
  prints the em dash with `planning.notSet` when the count is null. The cell's not-applicable case keys
  on the new flag rather than on `trackable`, so the five categories that carry no status keep exactly
  today's rendering of the em dash with `planning.notApplicable`.
- **UC15.** A day's capacity is unchanged. An `other` task's effective duration still counts in the
  day's booked minutes, because time spent is time spent whatever the work is called.
  **The two predicates fail in opposite directions, on purpose, and the reason has to sit next to them.**
  `isTrackableCategory` fails **closed** on an unknown id, so a stray or retired value cannot inflate a
  quota. `isDeliverableCategory` fails **open** on an unknown id, so a stray value cannot hide a status the
  user actually stored. Read side by side those look inconsistent, and a later reader who sees only the
  mismatch will make one match the other and quietly break whichever they touch. **The unifying principle
  is that the safer error is the one that does not destroy or misstate the user's own data.** Inflating a
  quota invents work that was never done. Hiding a stored status conceals something the user deliberately
  recorded. Both directions follow that single rule applied to two different risks, so the apparent
  inconsistency is the rule working rather than a defect.

**Not every reader of `trackable` moves to the new flag, so this is not a blanket rename.** The readers
that move are the ones asking whether the row has a status or a meaningful word count. A reader asking a
quota question stays exactly as it is, and `showExcluded` in `TaskRow.vue` is one of those, because
excluding a row from statistics is about the quota and not about the status. A sweep that renames every
occurrence would change behaviour while looking like a refactor.

- **UC16.** Nothing an `other` task holds reaches a quota numerator or denominator, because `trackable`
  is false, and a test asserts that from the contract rather than from a quota engine that does not
  exist yet.

### The stale status display

**Found by the accessibility stage on 2026-07-31 and fixed here.** The criteria are `UC38` to `UC41`,
numbered at the end rather than inserted, so nothing already quoted from this file moves.

The defect. When the pending category flips to one that carries no status, the `Statut` control is
disabled but keeps displaying the value it already held, while `diffEditorState` omits `status` from
the payload and the server clears the stored value as part of the same write. So the screen says
`Terminé`, the user presses save, and the status is silently discarded. This is worse than the
legacy stale-stored-value case the editor spec already accepts as harmless, because that one is history
nobody touched and this one is caused by the user's own action inside the same interaction, two controls
apart.

**Why it belongs to this feature rather than to a separate fix, stated precisely, because the obvious
reason is not quite right.** The accessibility stage tied it to non-trackability and to `other` becoming
the most common way a row turns non-trackable. Under the separation ruled above that is not what
triggers it, since `other` carries a status and flipping to it clears nothing. The real reason is that
the guard is written against `isTrackableCategory` in both places, so this feature has to rewrite it
whatever else happens, and getting the rewrite wrong in the other direction would be worse than the
defect. A version that kept clearing on non-trackability would wipe a status the moment the user chose
`other`, which is a data-loss path this feature would have created rather than inherited.

**The invariant the fix is written to.** What the status control shows is what will be stored. So the
displayed value is derived rather than held, from the pending category and the user's choice together,
and it is never a value the pending category cannot carry. Flipping to a category that carries no status
shows the none state, and flipping back shows the value that will still be stored, which is the loaded
row's status when the user has chosen nothing else. Nothing is restored that would not be stored, and
nothing is displayed that would be thrown away.

- **UC38.** Changing the pending category to one that carries no status clears the `Statut` control to
  its none state immediately, before any save, and leaves it disabled. The control never shows a value
  the pending category cannot hold.
- **UC39.** Changing the pending category back to one that carries a status restores the display to the
  value that will still be stored, which is the loaded row's status when the user chose nothing else. A
  round trip through a statusless category and back leaves the row unchanged and the save control
  disabled, because nothing differs from what was loaded.
- **UC40.** The payload still omits `status` when the pending category carries none, per the editor
  spec's `AC23`, and `diffEditorState` reports no status change caused only by the category flip. An
  edit that changes only the category sends a body with exactly one key.
- **UC41.** `diffEditorState` and the status model are unit-tested for all four transitions, from a
  status-carrying category to a statusless one and back, and from `other` to a trackable category and
  back, asserting both the displayed value and the payload each time. The tests read the new flag rather
  than `isTrackableCategory`, so a later reader cannot restore the old guard and stay green.

### `other` is selectable, not only arrived at by omission

**Decided. It is a real option in the dropdown**, listed tenth so it follows contract order, with its
name printed in its own colour like every other option.

Three reasons. **A value the user can arrive at must be a value the user can return to.** A row can
become `other` without a deliberate act, so if the option is absent the user can leave that state and
never re-enter it, and moving a row back to other work when the specific category was wrong would need a
separate clear affordance on the control. One option in the list is one mechanism for one meaning, where
a hidden value plus a clear button is two. **An existing `other` row has to open in a coherent control.**
If the stored value is not a member of the options, the selector displays a value absent from its own
list, which is the awkward state the editor spec already documents for retired ids, and there is no
reason to manufacture it for a value the contract declares. **It corrupts nothing**, so unlike
`translation` or `admin` there is no statistical argument for withholding it.

The name the owner chose makes this easier rather than harder. A list of ten where the tenth reads
`Autre` is an ordinary catch-all at the end of a list of specific kinds of work, which is a shape every
user already knows.

- **UC17.** The editor's category selector lists ten options in contract order with `other` tenth, each
  printing its name in its own colour, and the closed control shows the selected category's colour as it
  already does. One separator sits above `Autre`, per `UC42`.
- **UC18.** Selecting `other` on an existing task sends `category: 'other'` and the save succeeds, so a
  row can be moved back to other work and the refreshed row reads as `Autre`.
- **UC19.** `categorySchema` accepts `'other'` on both write endpoints, so an explicit choice and an
  omission reach the same stored value by two legal routes.

### Where the default is supplied

**Decided. The write boundary supplies it, declaratively, from `DEFAULT_CATEGORY_ID`. The column keeps
`NOT NULL` with no DDL default and this feature adds no migration.**

The project's rule is that the data layer decides where it can, and the honest reading here is that the
database cannot, at an acceptable price, for two reasons.

**SQLite cannot add a default to an existing column.** `ALTER TABLE` supports renaming, adding, and
dropping a column and nothing else, so putting `DEFAULT 'other'` on `tasks.category` means the full
create-copy-drop-rename rebuild of the app's main table. The migration runner is keyed on filenames with
no checksum and tolerates no error, the production row count is still unverified as an open question in
the inline editor spec, and the same branch already carries two migrations. That is real risk against a
behaviour difference of zero.

**A DDL default would be a second copy of the fallback id, and it is the copy that cannot import.** The
whole design of `shared/categories.ts` is that the id set and the default are declared once and every
reader imports them. A string literal in a migration file and in `schema.ts` cannot read that module, so
a later rename of the fallback leaves a stale default in the DDL that nothing in the code references and
nothing catches. This feature is itself the proof that the fallback id can change, since it just did.
The conventions put a shared rule in one place precisely to stop that drift, and here the one-place rule
and the data-layer rule point in opposite directions, so the one that prevents a silent drift wins.

What the data-layer rule does get is the part that matters, which is that no handler decides anything.
The default sits on the schema declaration both endpoints already draw from, so there is no
`if (!body.category)` anywhere in `create.ts`, and the value is read from the shared constant rather
than retyped.

**This follows the write boundary's own existing rule rather than making an exception to it.** The
comment on `TaskCreateSchema` says date and category are required "because they are the only two NOT
NULL columns without a default", so a defaulted category stops being required by the rule already
written there. The comment still needs correcting, because the reason changes from the column having no
default to the boundary supplying one.

- **UC20.** `TaskCreateSchema` no longer requires `category`. A create body carrying only `date` is a
  201, and the smallest legal add is now a day.
- **UC21.** A create body with no `category` stores `other`, asserted by reading the stored row rather
  than by inspecting the parsed body alone. The value comes from `DEFAULT_CATEGORY_ID` and not from a
  literal repeated at the boundary.
- **UC22.** `tasks.category` stays `text NOT NULL` with no DDL default, `server/db/schema.ts` is
  unchanged for that column apart from its comment, and this feature adds no file under
  `server/db/migrations/`.
- **UC23.** No server handler contains a branch, a fallback expression, or a nullish coalescing on a
  missing category. The single decision is the schema declaration, and a test proves it by parsing a
  body with no category and reading the category off the parse result.
- **UC24.** The comment in `server/models/tasks.ts` explaining what a create requires is corrected to
  say that `date` is the only required field and that category arrives defaulted, and the comment on
  `categorySchema` that describes the set as nine says ten.
- **UC25.** A draft editor opens with `other` preselected and named on screen, so the value that will be
  stored is visible before the save rather than appearing on the row afterwards. **The design stage
  ruled it a plain selected value rather than a muted or placeholder-like one**, because it is a real
  choice the save will honour and styling it as provisional would say otherwise. Its save control is
  enabled from the moment the draft opens, and pressing the add control and then save immediately
  creates one task holding its day and `other`.
- **UC26.** A fresh draft's `Statut` field is enabled rather than disabled, because the preselected
  category carries a status. Choosing `breaks` disables it and clears it per `UC38`, and choosing
  `Autre` again enables it.
- **UC27.** No client-side category-required check remains, and the save control is never disabled for a
  missing category. `planning.editor.validation.categoryRequired` and
  `planning.editor.fields.categoryPlaceholder` are removed from both locale files unless a reader for
  each survives, and if one does, the reader is named in a comment. **Settled during the editor step.**
  All three readers are gone, so both keys are removed rather than kept with a named reader.

**The save-enabled condition is two conditions rather than one, and the reason has to be on the page.**
An edit becomes saveable when something changed. A draft is saveable the moment it opens, per `UC25`,
because a day and a defaulted category are already a legal create. `dirty` alone cannot express that,
since an untouched draft is not dirty, so the editor step split the condition and the owner upheld the
split.

**The obvious simplification is wrong, and it is wrong in a way that costs the user rather than the
code.** Making a bare draft report itself dirty would collapse the two conditions into one and would
also make a mis-clicked add control followed by a click outside cost a discard confirmation for work
nobody did. Splitting the condition instead leaves the page's discard logic treating an untouched draft
as **clean**, which is the behaviour that actually matters, and it keeps `dirty` meaning what its name
says. A later reader who sees two conditions where one would do will collapse them unless this is
written down, so it is.

- **UC45.** The save-enabled condition is split. An edit is saveable only when the diff is non-empty, and
  a draft is saveable from the moment it opens. **An untouched draft is clean**, so cancelling one,
  clicking outside it, collapsing its day card, or switching the week closes it with no discard
  confirmation and writes nothing. A draft the user typed into is dirty and behaves exactly as the editor
  spec's recovery table says.

### The colour, decided by the design stage and accepted in full

**Hue 90, an ordinary member at the shared chroma. No exception was taken.** The design stage ran on
2026-07-31 and the owner accepted its answer in full, so this section records a decision rather than a
question. It also ruled a separator above `Autre` in the selector and nothing else, and a plain
preselected value on a fresh draft rather than a muted one.

**The colour is carried by the printed category name, not by an edge on the row.** `PLAN-32c` retired
the row edge deliberately and moved the colour onto the name, which the shipped `TaskRow.vue` confirms
by putting `.planning-cat-name` on the name element and setting `--planning-cat-hue` there. Any wording
anywhere that describes the collapsed row as carrying a coloured edge is stale, and a stage
implementing it literally would reinstate something that was removed on purpose. **The editor's left
border is a different thing and it stays.** `.planning-cat-edge` in `app/assets/css/main.css` is new
with the inline editor, it colours the editor panel's left edge, and it reads the same shared hue
custom property rather than a second copy of the mapping. So the tenth hue lands on the printed name in
the row and on the editor's left border, and on no edge of the collapsed row.

**The constraint the decision was made inside.** `.planning-cat-name` resolves
`oklch(var(--planning-cat-l) var(--planning-cat-c) var(--planning-cat-hue))`, with lightness and chroma
fixed per mode at 0.47 and 0.11 in light and 0.74 and 0.13 in dark, and only the hue arriving per
category. `PLAN-32c` ruled that no member of the palette is a neutral, and that ruling is what buys the
guarantee that every integer hue from 0 to 359 clears 4.5:1 on all twenty card surfaces, the worst
readings being 5.02:1 in light and 6.07:1 in dark. Hue 90 is an ordinary member of that set, so it
inherits the guarantee and nothing needed re-measuring.

**Why an ordinary hue rather than a neutral, which an earlier draft of this spec argued for.** That
draft reasoned that the member means the absence of a choice and that only a neutral communicates
absence. The premise weakened when the owner chose `Autre`, because other work is a thing rather than a
gap, so the tenth member is one more kind of work in a list of kinds of work and a neutral would
understate it. The no-neutrals rule was therefore never really in tension here, and no exception had to
be justified.

**The design stage's actual argument for hue 90, kept uncompressed because the reasoning is the part
that transfers.** The best available placement for a tenth hue sits 0.0493 from its nearest neighbour,
against the sibling pair's 0.0469, so the margin over the next-tightest pair in the palette falls from
roughly twenty percent to about five. That is a real reduction in separation and it is accepted **on
this member specifically**, for a reason that does not generalise. `Autre` is the shortest label of the
ten and it shares no prefix with any other, so a user telling it apart is reading a five-letter word
that looks like nothing else in the column and the colour is doing almost no scanning work. Compare
`Révision interne` against `Révision externe`, where the two labels are near-identical at a glance and
the colour carries real disambiguation load, which is why that pair was given the tightest spacing in
the palette on purpose.

**Do not compress this into the contrast figure.** Hue 90 clears the contrast floor like every other
integer, and quoting only that would let a later reader conclude that any tenth hue is fine because the
guarantee covers the whole wheel. The guarantee is about legibility and it says nothing about telling
two categories apart, which is the question this decision actually turned on, and the answer depended
on which label the colour was supporting.

**What a later addition inherits, and what it does not.** An eleventh category cannot reuse this
reasoning by pointing at hue 90. It has to make the argument again for its own label, because the
palette is now tighter than it was and the next placement will be tighter still. `PLAN-30` hands the
user the whole wheel, so uniqueness is that feature's problem to solve rather than a property it can
assume, exactly as `shared/categories.ts` already records.

- **UC28.** `other`'s descriptor carries `hue: 90`, the contract records next to it that this is an
  ordinary member at the shared chroma with the label-length reasoning summarised in one sentence, and
  no colour value for it exists anywhere outside `shared/categories.ts` and the fixed properties in
  `main.css`.
- **UC29.** No exception to `PLAN-32c`'s fixed lightness and chroma exists anywhere in this feature. The
  hue inherits the existing whole-wheel guarantee, which is cited rather than re-measured, and no
  per-category chroma or lightness override is added to the `Category` type, to `main.css`, or to any
  component.
- **UC42.** The selector renders one separator, immediately above `Autre` and nowhere else. It is
  `aria-hidden`, it is not focusable, and keyboard navigation from `Mise en page` reaches `Autre` in one
  step in both directions. **The pinning is split rather than uniform**, and the split is written into
  the criterion because an earlier version of it asked for one test covering all four and that test
  cannot honestly exist. When the separator lands, a render assertion covers the placement, the
  `aria-hidden`, and the separator not being a member of the item collection, which is the mechanism
  behind both the non-focusability and the skip. **The keypress behaviour itself stays a named gap**, and
  no test is written before the separator exists. Both halves of that, with the technique and the
  refusal, are under [what the accessibility pass
  proved](#what-the-accessibility-pass-proved-and-what-it-declined-to-guard).

### The contract and i18n ship as one step

Ten ids against nine keys is a missing translation on screen, and the two files are the only place a
name exists, so they move together in one step rather than in two.

- **UC30.** `i18n/locales/fr.json` and `en.json` each hold ten `categories.*` keys, at parity, in
  contract order, with `categories.other` carrying the settled copy under [copy](#copy).
- **UC31.** A guard test fails when the contract holds an id with no `categories.<id>` key in either
  file, and the test is shown able to fail by being run against a deliberately missing key before being
  trusted, because a parity check that cannot produce a failure is not a check.
- **UC32.** No visible string for the tenth category is a literal in any component, and the name is
  resolved from `categories.<id>` exactly as the other nine are.

### Prose, tests, and the seed

- **UC33.** `shared/categories.ts` no longer describes its own set as nine anywhere in its comments, and
  the sentence calling `admin` the natural catch-all bucket for uncategorized work is gone rather than
  left contradicting the code.
- **UC34.** `test/shared/categories.test.ts` is updated from nine to ten and from `admin` to `other`,
  covering the membership, the order, the new flag on all ten, the invariant in `UC9`, the coercion cases
  in `UC4`, and the locale parity in `UC31`. The failures the contract change causes in that file are
  fixed by updating the expectations to the ruling, never by softening the contract to keep the file
  green.
- **UC35.** `nine-task-categories.md` is annotated where it is now wrong, at its `AC1` locking the count
  at nine and at its `AC4` locking the fallback to `admin`, each pointing at this file. The reasoning is
  marked superseded rather than deleted, so the record shows a decision changing rather than a document
  that was always right.
- **UC36.** `task-inline-editor.md` is annotated at each passage listed under [what this
  supersedes](#what-this-supersedes-in-the-inline-editor-spec), with no existing acceptance criterion
  renumbered, because several stages are already building against those numbers.
- **UC37.** `scripts/seed.ts` writes at least one `other` task, so the colour, the enabled status field,
  and the words cell are all visible on a freshly seeded week without hand-entering a row.
- **UC43.** `shared/categories.ts` carries one comment covering **both** predicates together, recording
  that `isTrackableCategory` fails closed and `isDeliverableCategory` fails open and that the unifying
  principle is that the safer error is the one that does not destroy or misstate the user's own data. One
  comment next to both rather than a sentence on each, because the thing a later reader needs is the
  relationship and two separate notes are what let it be read as an inconsistency.
- **UC44.** The move from `trackable` to the new flag is per-reader rather than a sweep. Every reader
  that moved asks whether the row has a status or a meaningful word count, and every reader that asks a
  quota question stays. `showExcluded` in `TaskRow.vue` still reads `trackable`, and a comment there says
  why, so a later blanket rename does not change behaviour while looking like a refactor.

## Edge cases

- **A stored row holding the retired `revision`.** It coerces to `other` instead of `admin`, so it reads
  as other work, which is true, instead of as administration, which was not. Its stored status becomes
  visible again and its word count becomes visible again, both because the row is now resolved as
  carrying a status. Nothing rewrites the stored value, and editing any other field on that row still
  works because the patch carries no `category` key unless the user picks one.
- **A stored row holding a genuinely unknown string**, from a hand edit or a future custom category that
  was deleted. Same path, same result, and it fails closed for the quota because `trackable` is false.
- **A create that explicitly sends `category: 'other'`.** Legal and identical in outcome to omitting it.
  Two routes to one stored value is the point of `UC19` rather than a redundancy.
- **A create that sends `category: null`.** Still a 422. The column is `NOT NULL`, an omitted field means
  "you decide" and an explicit null means "store nothing", and only the first of those is answerable.
- **An `other` task with a word count and a quota override.** Both stored, both shown, and neither reaches
  a quota because the row is not trackable. The override is inert on it, which inherits the write API's
  already recorded inconsistency and adds nothing new.
- **An `other` task marked `Terminé` and then moved to `breaks`.** The display clears the moment the
  category changes, per `UC38`, and the server clears the stored value as part of the same write, so the
  screen and the row agree at every point.
- **An `other` task moved to `translation`.** Its stored status survives, its word count starts counting
  toward the quota, and nothing warns, because classifying a row later is the workflow this default exists
  to allow.
- **An abandoned create.** Unchanged. A draft issues no request until save, so a draft opened and closed
  writes nothing, and the preselected category never reaches the database.
- **A save interrupted partway.** Unchanged, and nothing new is interruptible here. This feature adds no
  step, no token, and no session to the write, so the editor spec's recovery table still describes every
  failure path in full. The one property worth restating is that a create can no longer fail for a missing
  category, which removes a validation failure rather than adding one.
- **A stale client after the deploy.** An old bundle sends `category` on every create, which stays valid,
  and it does not know the tenth id, so a row that comes back as `other` coerces through its own
  `coerceCategory` to `admin` and reads wrongly until the page reloads. That is a page refresh rather than
  a dead end, and it is the ordinary cost of a contract gaining a member.

## Copy

**Settled by the owner on 2026-07-31.** `Autre` in French and `Other` in English, chosen over the
`Sans catégorie` and `No category` this spec first proposed and over `Non catégorisé`. The id, the file
name, and the visible name all agree, and the reason the id followed the copy is under
[intent](#intent).

| Key                | French | English |
| ------------------ | ------ | ------- |
| `categories.other` | Autre  | Other   |

**Neither string carries `?`, `!`, `:` or `;`, so neither needs a no-break space.** The rule still binds
any hint, helper text, or message a later stage adds for this category, where the space before such
punctuation is a real U+00A0 in the JSON rather than a plain space.

**One identifier changes and no user-visible string changes with it.**
`planning.editor.validation.statusNotTrackable` is named after the flag this feature splits, so the name
goes stale and is renamed. **The French and English strings it holds are already correct**, because both
describe the status concern rather than trackability, so this is a stale identifier and not a wrong
explanation shown to anyone. Nothing here needs the owner's copy read, which is the reason it is recorded
in this section rather than sent to the follow-ups with the label question.

## Stages

The owner set this order on 2026-07-31, and the middle step is ordered the way it is for a reason worth
keeping.

- **Specs.** This document.
- **Design.** Ran on 2026-07-31 and was accepted in full. Hue 90 as an ordinary member with no
  exception taken, one separator above `Autre` and nothing else, and a plain preselected value. The
  reasoning is under [the colour](#the-colour-decided-by-the-design-stage-and-accepted-in-full). **The
  contract stage was blocked on this and is now unblocked**, and it is unblocked in the stronger sense
  as well, because no exception means the `Category` type gains no chroma or lightness member and the
  descriptor is one integer.
- **Contract and i18n, as one step.** The tenth id, the descriptor, the second per-category fact, the
  helpers, `statusKey`, the write boundary, the read path, and the tenth key in both locale files.
  **These move together rather than in two steps so that ten ids can never ship against nine keys**, not
  even inside one branch, because that intermediate state renders a missing translation on screen and
  nothing in the build catches it between two commits.
- **Editor.** The selector's tenth option and its separator, the preselected draft value, the split
  save-enabled condition per `UC45`, the status control's new enabled rule and its clearing behaviour,
  and the words cell. **The words cell is in scope and stays**, per `UC14`. A later brief omitted it, this
  section is what assigns it to this step, and the editor step was right to build it and right to offer a
  revert rather than assume. There is no revert.
- **Unit test.** Per `UC1` through `UC45`, with the existing `test/shared/categories.test.ts` updated per
  `UC34` and the parity guard proven able to fail per `UC31`.
- **Compliance.** Skipped. No new personal data, no new field, no new column, no email, and no public
  page. The one visible change is a category name in two locale files.
- **SEO.** Skipped. An authenticated dashboard already marked `noindex, nofollow`.
- **Accessibility.** Ran a short pass on 2026-07-31, scoped to exactly two things and not a re-audit.
  The separator's behaviour in the listbox, per `UC42`, and `Statut` opening enabled on a fresh draft,
  per `UC26`. The stale status display is already this stage's own finding and is built here rather than
  audited again. What it proved and what it declined to guard is under [what the accessibility pass
  proved](#what-the-accessibility-pass-proved-and-what-it-declined-to-guard), including two upheld
  refusals, and the one guard it did write is green at 23 tests.

  **Why the rule was widened, said plainly so the next reader does not conclude a stage ran without
  cause.** This spec first said the stage runs only if the colour exception is taken. No exception was
  taken, and the pass runs anyway, because that rule was written when contrast was the only risk anyone
  foresaw and neither of these two things is a contrast question. One is an interaction guarantee that
  design verified by reading the component and that no test pins, so nothing stops it regressing. The
  other is a visible behaviour change from every previous state of this form, since the status control
  has never opened enabled on a fresh draft before. A rule that only catches contrast was too narrow
  rather than wrong, and the correction is recorded here rather than left to look like an unexplained
  extra stage.

- **Code review**, then **commit**, which opens the pull request and stops there.

## Follow-ups recorded, not built here

Three things the accessibility stage found on 2026-07-31, each with its diagnosis attached so nobody has
to rediscover it. None is a defect in this feature and none blocks it.

1. **The same duplicate-id and unnamed-pair defect exists in two shipped components.**
   `app/components/settings/work-fields.vue` and `app/components/onboarding/step-work.vue` carry it
   identically, because this feature's hours-and-minutes control copied the shipped precedent and
   inherited the fault along with the shape. Accessibility fixed the copy here and left the originals,
   so the repository currently holds one correct version and two wrong ones. The fix is the same three
   lines in each file.
2. **`app/layouts/default.vue` has no skip link**, which the styling conventions require by name.
   Recorded with the finding that accessibility **correctly judged this is not a criterion failure as
   things stand**, because the main landmark, the heading structure, and roughly three header tab stops
   already give a keyboard user a short path to the content. It becomes a real problem when the header
   grows, so it is a chore rather than a bug today.
3. **Every row's edit form announces as "Modification de la tâche" with no indication which task.** A
   screen reader user opening the third row hears the same name as the first. Composing the row's name
   into the label needs a new copy key, and the primary user is a professional translator, so the French
   wording needs the owner's read rather than a string slipped in at the end of a run. That is why it is
   a follow-up and not a quick fix.

## Two gaps that stay open, and go into the pull request

Both are deliberate. Neither is closed by guessing, and both are named here so the pull request carries
them rather than leaving them to be rediscovered.

1. **The `@4xl/day` help-line reserve is not applied.** The design position is that a wrong reserved
   height is worse than no reserve at all, and the right value can only be measured against the shipped
   control on screen, which no agent can do because nobody can render the app. The editor step derived
   **5.25rem** as a candidate from the generated theme files rather than from a rendered control, so it
   is **a number for the owner to confirm on screen and explicitly not an applied value**. The derivation
   travels with the figure into the pull request, so the owner can check the working rather than trust
   the number, and a figure quoted without its derivation should be treated as unverified.
2. **A cosmetic filter artifact stays unfixed and named.** Searching the selector for text that excludes
   `Autre` leaves a trailing separator hairline with nothing under it. That is shipped Nuxt UI behaviour
   rather than anything this feature does, and working around it would cost more machinery than the
   artifact costs the user. It is written down so it reads as a known cosmetic artifact rather than as a
   bug someone rediscovers and chases into a dependency.

## What this feature's verification is worth, and what it is not

Recorded so that nothing in this document reads as stronger evidence than it is. **The split below is the
honest core of it and it must not be compressed into "verified" or "audited"**, because those words claim
the middle column that does not exist here. The same wording goes into the pull request body.

- **Executed.** The three gates, plus a nine-assertion probe proven able to fail by reverting the fix it
  covers, which is what makes a passing run a finding rather than a probe that could never fail.
- **Static reading only.** Everything about rendered appearance and everything about interaction,
  including the separator's keyboard skip. Every such conclusion comes from reading the modules together
  with the Nuxt UI, Reka, and Vue source, not from operating the interface.
- **Nobody has signed in to the application at any point.** Not a stage and not a person. Authentication
  needs credentials from `.env` that no agent may read, and minting a throwaway development account
  instead was refused by the permission system. No stage looked for a way around either, which was the
  right call.

**Per stage, the same split holds and the accessibility stage labelled it itself.** Its behavioural
conclusions, including the stale status display fixed here, are static reading. The only things it
executed were the contrast maths and mutation probes run against its own guards. It marked which was
which per finding, and this spec keeps that rather than flattening both into "audited".

**The live region guard proves less than its name suggests.** The test written for the editor spec's
`AC43` proves that the region's structure cannot drift into the panel that gets destroyed on close. It
does not prove that a screen reader speaks, and nothing in this repository can prove that without a
person and a screen reader. That limit is already written in the test file's header and it is repeated
here so this document does not imply the stronger claim.

**`.vue` files are not typechecked by any gate in this repository, and that is an absent gate rather
than a tool finding problems.** The distinction matters because it was first written down the other way
round. `bunx vue-tsc` failed on this branch because `bunx` fetched an incompatible pairing, so the tool
never ran properly and **reported nothing whatever about this code**. Nobody should cite it as evidence
in either direction. The substance stands on its own and is a real blind spot, because the central
artifact of the feature this one folds into is a large Vue component and no gate typechecks it.

**What the working tool found, with the instrument verified before its results were trusted.** The local
`tsc` was shown able to report a planted `TS2322` and to pass a clean file, so a clean reading is a
finding rather than a broken probe. The shared and node projects are clean. The server project reports 46
errors, **identical at `HEAD`**, in four files nobody on this branch has touched, all of them the same
pre-existing session `User` augmentation issue. That is pre-existing and not introduced here, and it is
recorded rather than fixed because fixing it is not this feature's scope and hiding it would leave the
next reader to rediscover the same 46.

**What follows from that.** The first person to sign in and use the category control is doing first-pass
manual verification rather than confirming something already seen working. The three things most worth
watching are the status control clearing and restoring across a category flip per `UC38` and `UC39`, the
tenth option's colour against the real popover, and a create saved with nothing but a day.

## What the accessibility pass proved, and what it declined to guard

The short pass of 2026-07-31, recorded at this length because two of its three results are refusals and a
refusal that is not written down reads later as an oversight.

**The typeahead risk is on `Statut` and not on the category selector, which is the opposite of how it was
first described to this spec.** Reka's `Combobox` binds no typeahead at all, and the category selector is
a `Combobox`. That is a real absence rather than a failed search, because the same search run against
`Select` finds four modules, which is the positive control that proves the instrument can see the thing
when it is there. The control that does bind printable-character typeahead on a closed trigger is
`Statut`, through `USelect`.

**Accessibility declined to guard that, and the refusal is upheld here.** Typeahead on a collapsed select
is native behaviour and is the documented ARIA select-only-combobox pattern, so a test asserting its
absence would pin a regression in place and make the correct behaviour the thing that fails. The severity
argument also runs the other way from how it was first framed. A status is announced text in a labelled
field, so a user who lands on the wrong one is told, where a category swap changes only a hue and tells
nobody. **The invisible-failure case this was meant to protect against therefore cannot occur on the
control that has the behaviour**, which is why there is nothing to guard rather than something being left
unguarded.

**The separator's keyboard skip comes from the render branch keeping it out of the `ComboboxItem`
collection.** It does not come from `isStructural`, which governs search filtering only. The conclusion is
the same and the reason is sturdier, and it is written down at the level of the mechanism so that a later
reader repairing a regression does not go and change the filtering predicate believing it is what makes
the separator unreachable.

**Two of the three guards asked for were correctly not written, because the separator does not exist in
the component yet.** The only half that could be written today would touch none of this repository's code
and would pass whether or not the separator is ever built, which is exactly the test that retires a
concern while protecting nothing. It is not added as a placeholder, and this is the same principle the
rest of this feature keeps applying, that a check unable to produce a failure is not a check.

**The technique for when the separator lands is proven and needs no install.** `createSSRApp` with
`renderToString` from `vue/server-renderer`, verified with negative controls, because
`ComboboxSeparator` still renders its `aria-hidden` with no document present. **The keyboard-skip half is
genuinely not pinnable without real key events and stays a named gap**, which is stated plainly here
rather than folded into the render assertion so that `UC42` does not read as fully covered when it is not.

**The guard that was written is green at 23 tests.** And the awareness check came back clean, since the
editor's coloured edge already binds to the model rather than to the row, so nothing in the shipped
implementation needed changing for it.

## What this supersedes in the inline editor spec

Recorded here in full so the record is complete even before the cross-references land in
[task-inline-editor.md](task-inline-editor.md). Nothing there is renumbered, and the retired reasoning is
marked superseded rather than removed.

1. **"Mandatory fields, and where validation lives", the sentence "The user must supply a category, and
   nothing else."** Category is no longer mandatory. Only `date` is required on a create, and it is never
   typed because it comes from the card the draft opened in.
2. **The paragraph "The category has no preselected value."** Its argument about `translation` and `admin`
   both corrupting statistics stands for those two candidates and does not reach `other`, which is
   non-trackable and therefore moves no figure.
3. **"The client validates two things and no more", the clause naming a chosen category as one of them.**
   The client now validates one thing, which is that something changed.
4. **`AC45`.** The save control is no longer disabled until a category is chosen, and the smallest legal
   add is a day rather than a day and a category.
5. **The field table's row 1**, which marks `Catégorie` as `Required`.
6. **"Statut on a non-trackable category"**, wherever the disabled state is justified by non-trackability
   alone. The rule becomes whether the category carries a status, which is a different fact for exactly
   one member. The same paragraph's claim that the editor reads `isTrackableCategory` for the pending
   selection becomes the new helper.
7. **`AC23`**, insofar as it reads as a rule about every non-trackable category. It stays true for the
   five that carry no status and is not true for `other`.
8. **The words cell rules**, the third table row for the not-trackable case and `AC3`'s non-trackable
   sentence, which now key on the new flag rather than on `trackable`.
9. **"The shared contracts" input**, which says nine ids.
10. **`AC40`**, whose worked example says a retired id displays "the coerced value". Still true, and the
    coerced value is now `other` rather than `admin`, which is worth saying because the example is what a
    test author will copy.
11. **The copy tables**, for `planning.editor.fields.categoryPlaceholder` and
    `planning.editor.validation.categoryRequired`, per `UC27`.
12. **`AC46`**, whose prohibition stands unchanged and whose enumeration does not. The client still copies
    no contract rule, and the contract functions it reads are now two rather than one.

Two things in that file were checked and are **not** superseded, so nobody spends an edit on them. The
non-trackable edge cases covering a word count, a quota override, and a note on a non-trackable task all
still hold. And the recovery table still describes every interrupted path in full, because this feature
adds no step to the write.

## Classification in the build trail

**This feature is not fully sandboxed, and that is recorded here rather than discovered later.**

It is new scope arriving mid-flight, after the unit-test stage of the inline editor had already completed.
That is the exact shape that cost Features 12, 13, and 17 their fully-sandboxed status in the build trail,
and it costs this one the same, because the classification records who did the substantive build and a
feature whose scope arrives after the stages have run has not been through the pipeline end to end.

**The owner's reason for folding it in anyway.** The alternative is shipping a create form that forces a
category choice and coerces unknown values into a real work category, then reopening the same component
next week to undo both. Getting it right now is worth the classification, and the classification is worth
recording honestly rather than protecting.

**One more thing this run exposed, which belongs in the record rather than in a retrospective nobody
writes.** The run also stalled for about two hours waiting on a relay that never came. Stage agents
cannot message the orchestrator, so every report has to pass back through the top-level session, and a
pipeline that depends on a human relaying between its own stages has a weakness that no amount of
per-stage rigour fixes. It is written here because the build trail is the artifact this repository
delivers, and a trail that records only the parts that went well is worth less than one that does not.

The ledger row in [docs/pipeline-trace.md](../../pipeline-trace.md) is appended when this lands, marked
agent-driven and not fully sandboxed with this file as the reason, and the derived coverage line in
[docs/pipeline.md](../../pipeline.md) is refreshed from the ledger rather than hand-maintained. No
existing row is rewritten.

## Open questions

Two of the three questions this section used to carry are closed, and both closed as decisions in the
body rather than as answers recorded here. The owner chose `Autre` and `Other` on 2026-07-31 and the id
follows the copy, under [copy](#copy) and [intent](#intent). The design stage returned hue 90 with no
exception, a separator above `Autre`, and a plain preselected value, and the owner accepted all of it,
under [the colour](#the-colour-decided-by-the-design-stage-and-accepted-in-full). Nothing now blocks the
contract stage.

1. **The name of the second per-category fact.** `deliverable` is proposed and the contract stage may
   choose better, within the three constraints under [the status
   field](#the-status-field-and-the-two-meanings-of-non-trackable). This is a naming question rather than
   a behaviour question, so it does not block anything.
