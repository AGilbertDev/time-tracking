# The nine default categories

`PLAN-32a`. Depends on `PLAN-02` and amends it. Shared contract plus i18n plus the dev seed.

## Intent

The category set that shipped in `PLAN-02` has six members and it is wrong. The user gave
the real category set in use on 2026-07-29 and it has nine, so this feature replaces the six
with the nine, confirms every French and English name against what the user actually said, and stops
there. `proofreading` and `dtp` are new, and the single `revision` is replaced by the pair
`revision_internal` and `revision_external`, because the user's two revision quotas are different numbers
and two rates cannot share one category.

This feature changes the _set_ and its _names_. It changes nothing about what a category _holds_.
The per-category quota is `PLAN-32b` and the nine-colour palette is `PLAN-32c`, and both of those
read the ids this feature declares, which is why it goes first. The reasoning behind each name, and
why external revision is the faster quota rather than a transposition, is recorded in
[`overview.md`](overview.md#the-category-set-and-the-real-quotas-from-the-primary-user) and is not
re-argued here.

The work reaches three places. `shared/categories.ts` gains three ids and loses one, the
`categories` object in both locale files follows, and the dev seed is rewritten so the new ids
appear on real seeded rows rather than only in a type. There is no schema change and no DDL, because
`tasks.category` is already free text with no default, no CHECK constraint, no enum, and no index
(`server/db/schema.ts` L77 to L79, agreeing with `0004_add_tasks_table.sql` L41), so a nine-member
set needs no migration to be storable.

## Inputs

No runtime inputs. This is a shared-contract change, so its inputs are the locked decisions it
implements and the shipped code it amends.

1. **The nine categories, their ids, their trackable flags, and their confirmed FR and EN copy.**
   From [the category set](overview.md#the-category-set-and-the-real-quotas-from-the-primary-user),
   given by the user on 2026-07-29 and confirmed the same day. Reproduced in full below.
2. **The shipped contract this amends.** `shared/categories.ts`, the only declaration site for a
   category id in the repo.
3. **The `PLAN-02` spec this amends**, [`task-categories.md`](task-categories.md), whose `AC1`
   locks six categories and whose i18n table lists six names. Both are superseded here.
4. **The existing i18n convention.** All visible strings live in the locale files, keyed
   `categories.<id>`, never in the contract module. `i18n/locales/fr.json` and `en.json` each hold a
   top-level `categories` object at L180 to L187, keys in `DEFAULT_CATEGORY_IDS` order.
5. **The trackable flag has one source.** `isTrackableCategory` in the contract is what the server
   derives `trackable` from (`server/api/tasks/handlers/list.ts` L93) and what the client is handed
   already resolved. That stays true, and this feature adds no second copy of the rule.

## The nine categories

Every string in this table is confirmed with the user and is **locked**. It is reproduced
exactly, no synonym is substituted, no term is improved, and `DTP` is not translated to match
`Mise en page`. Two of those need saying out loud because both look like mistakes and neither is.

**`Relecture` is deliberate.** It was checked against `Correction d'épreuves`, which is the stricter
term the Canadian industry uses for proofreading as a separate billable service, and the user chose the
shorter word. A later stage that "corrects" it is undoing a decision.

**FR and EN diverge on `dtp` on purpose.** French reads `Mise en page` and English reads `DTP`,
because each side is the term its own reader uses. `Layout` was the English name for part of
2026-07-29 and the user rejected it the same day as generic. The set therefore carries one industry
acronym, knowingly.

| Id                  | FR               | EN                | Trackable |
| ------------------- | ---------------- | ----------------- | --------- |
| `translation`       | Traduction       | Translation       | yes       |
| `revision_internal` | Révision interne | Internal revision | yes       |
| `revision_external` | Révision externe | External revision | yes       |
| `proofreading`      | Relecture        | Proofreading      | yes       |
| `terminology`       | Terminologie     | Terminology       | no        |
| `meetings`          | Réunions         | Meetings          | no        |
| `breaks`            | Pauses           | Breaks            | no        |
| `admin`             | Administration   | Admin             | no        |
| `dtp`               | Mise en page     | DTP               | no        |

That order is the locked contract order, trackable members first and `dtp` last, and it is the order
`DEFAULT_CATEGORY_IDS`, `DEFAULT_CATEGORIES`, and the `categories` object in both locale files all
follow.

The ids stay plain lowercase English storage keys never shown to a user, which is why
`revision_internal` and `revision_external` are snake_case while the existing six are single words.
That is the first multi-word id in the set and snake_case matches how the repo names a compound
storage key everywhere else, including every column in `server/db/schema.ts`.

## Non-goals

Each of these is a following feature, and each is stated here so a build stage cannot drift into it.

**Per-category quotas are `PLAN-32b`.** No quota field is added to the `Category` descriptor. Nothing
touches `settings.quota_wph` or its 450 default, and the global quota is left exactly as it is even
though [the overview records it as wrong](overview.md#the-original-category-colours-implemented-in-plan-32c).
Fixing a known-wrong default is tempting and it belongs to the feature that retires the setting
entirely, not to this one.

**The nine-colour palette is `PLAN-32c`.** `CATEGORY_HUE_SLOTS` is not changed and neither is
`categoryEdgeHue`. `edgeSlot` values change only as far as is mechanically required to keep the
contract total and type-correct for nine ids, which is `AC7`. The five non-trackable categories keep
`edgeSlot: null` in this feature. Whether they get a colour is `PLAN-32c`'s decision and
[the user's original colours say they should](overview.md#the-original-category-colours-implemented-in-plan-32c).

**No write path.** `PLAN-09` is not built and this feature does not build any part of it. No Zod
schema for a category, no POST, no PATCH.

**No row layout change.** `PLAN-33` owns the row. `TaskRow.vue` is read, not edited. Adding three
ids changes what that component renders through the existing dynamic i18n lookup, and that is a data
change rather than a component change.

## Outputs and acceptance criteria

### AC1. The nine defaults ship with the correct trackable flags

`DEFAULT_CATEGORY_IDS` (today `shared/categories.ts` L13 to L20) holds exactly the nine ids in the
order of the table above, and `DEFAULT_CATEGORIES` (L58 to L65) holds exactly nine descriptors in the
same order. `translation`, `revision_internal`, `revision_external`, and `proofreading` are
`trackable: true`. `terminology`, `meetings`, `breaks`, `admin`, and `dtp` are `trackable: false`.
The id `revision` no longer appears anywhere in the contract.

Verifiable by asserting the tuple equals the nine ids in order, that the descriptor array has length
nine with ids matching in the same order, that four descriptors are trackable and five are not, and
that every id is unique.

`DefaultCategoryId`, `CategoryId`, `Category`, and `CATEGORY_BY_ID` keep their shapes exactly.
`CATEGORY_BY_ID` (L69 to L71) is derived from `DEFAULT_CATEGORIES`, so it follows the new set with no
edit of its own, and `Category` still carries `id`, `trackable`, and `edgeSlot` and no display name.

### AC2. The FR and EN copy is the confirmed copy, and it lives in i18n

The nine names are exactly the strings in the table above, in `i18n/locales/fr.json` and
`i18n/locales/en.json` under the existing top-level `categories` object, keyed by id under the locked
`categories.<id>` convention. No display name is added to `shared/categories.ts`, which is the
project i18n convention and the reason a name can be corrected later with a locale-file edit that
touches no stored data.

The French typography rule (a space before `? ! : ;`) is **checked and not triggered**. None of the
nine French names carries any of that punctuation, so the rule holds trivially. It is recorded as
checked rather than illustrated with an invented case.

### AC3. Existing `revision` rows are handled, and the no-history claim is verified rather than inherited

The overview assumed no real user history exists. That assumption has been checked, and the answer is
that none exists, on two independent grounds.

**No write path has ever existed.** `server/api/tasks/` contains exactly `index.get.ts` and
`handlers/list.ts`. There is no POST, PUT, PATCH, or DELETE anywhere under it, and no Zod schema in
the repo validates a category. `PLAN-09` is not built, so there has never been a code path by which
a user could create or edit a task, in any environment including production.

**The dev data is one seed pass.** A read-only probe of the dev Turso database found 107 task rows,
of which 9 carry `revision`. Every row in the whole table shares one of two adjacent `created_at`
seconds, `updated_at` equals `created_at` on every row, so nothing has ever been edited after insert,
and one owner holds all 107. The `revision` rows span 2026-07-06 to 2026-08-21, which is exactly the
seed's seven-week window around 2026-07-29. `_applied_migrations` lists all eight migrations applied
with nothing pending, so the database is at `0007` and accepts the nine ids as they are.

**The honest limit.** The probe reached the dev database, the only one this sandbox holds credentials
for, so production rows were not read directly. The no-write-path finding closes that gap, because
production cannot hold rows the application has no code to write.

**So no data migration of real rows is required, and this feature adds no migration.** The nine
seeded `revision` rows are handled by re-running `bun run seed`, which is `AC5`. Four reasons, and
the rejected alternative is recorded underneath so the choice is legible rather than assumed.

1. **No DDL is needed at all.** `tasks.category` is free text with no default, no CHECK, no enum, and
   no index, and no existing SQL migration mentions any category id. Nine ids are storable in the
   database exactly as it stands.
2. **The seed already does the whole job, exactly and idempotently.** It deletes the owner's task and
   work-schedule rows and reinserts seven weeks, so it rewrites every one of the 9 `revision` rows
   along with the other 98. It is destructive by design and it is re-run routinely, and it is the
   command a developer runs after a contract change anyway.
3. **A migration would have to invent the split.** Mapping `revision` to `revision_internal` or to
   `revision_external` is a choice the data never recorded, since the internal-against-external
   distinction did not exist when those rows were written. Writing a guess into a permanent migration
   is worse than rebuilding the rows deliberately, and the project's rule against inventing applies
   directly. The seed instead assigns both members on purpose, which is `AC5`.
4. **In production it would be a permanent no-op.** A `0008` whose header had to say "this is
   expected to affect zero rows" is dead weight in a history that is applied by hand.

**The decision now rests on a written convention rather than on this feature's judgement alone.** The
rule that a migration is for structural change while seed-owned rows are fixed by editing the seed
lives in the `my-backend-conventions` skill, under "A migration is for schema, not for data the seed
owns", and it names the split-value case directly. The four reasons above are this feature applying
that rule rather than arguing it from scratch.

**Rejected alternative, and why it was close.** A `0008_rename_tasks_revision_category.sql` carrying
`UPDATE tasks SET category = 'revision_internal' WHERE category = 'revision'` would fix a dev
database without a reseed, and the cost is only the invented mapping. It was rejected on point 3.
A stale `revision` row folding to `admin` through `coerceCategory` is safe, but it silently
reclassifies revision work as administration, which is a wrong reading rather than a broken one, and
the reseed removes the row rather than relabelling it.

**This has now changed, as of `PLAN-09`.** This paragraph used to read "what would change this" and
described a future condition. That condition has fired. The task write API shipped, so the `tasks`
table now accumulates rows the user created, and the evidence above holds only for the period before
it did.

The consequence is the one this paragraph always predicted. Real rows can carry `revision`, or any
other stale id, so the same change is no longer simple. It needs a real data migration, and the
split between `revision_internal` and `revision_external` has to be resolved with the user rather
than chosen. The reasoning above is still sound and the four arguments still stand for seed-owned
rows, but the premise that every row is seed-owned is no longer true and must not be inherited.

**So re-run the check rather than citing this section for it.** Any later feature reasoning about
what the `tasks` table contains, `PLAN-33`'s `words_done` drop in particular, needs a fresh count of
rows the seed did not write, run against the production database rather than against a fresh
development one, since a development database can still be seed-only while production is not. A
future reader who finds no `0008` should read this section for why one was never written, and should
not read it as evidence that one is still unnecessary today.

**The overview used to say this feature carries "a migration".** That line was written before the
check and it was wrong, so the `PLAN-32a` bullet in [`overview.md`](overview.md) now names the shared
contract, i18n, and the dev seed, and says no migration is needed.

### AC4. `coerceCategory` validates the nine and still falls back to `admin`

`coerceCategory` (L87 to L91) validates against the nine ids and returns `DEFAULT_CATEGORY_ID`
otherwise, and `DEFAULT_CATEGORY_ID` (L79) stays `'admin'`. Its body needs no change, because it
already tests membership of `DEFAULT_CATEGORY_IDS`, so widening the tuple widens the coercion. What
does change is that `'proofreading'` becomes valid and `'revision'` becomes the stale id that folds.

`coerceCategory('revision')` returns `'admin'` and `isTrackableCategory('revision')` returns `false`,
so a stored `revision` resolves to a valid non-trackable id rather than reaching the UI raw. The four
new ids all return themselves unchanged, and `coerceCategory` still folds `''`, `null`, `undefined`,
a number, and an object to `'admin'`.

**The fail-closed reasoning in the existing comments must survive the edit rather than be paraphrased
away.** The comment at L73 to L78 explains why the fallback has to be non-trackable, which is that an
unknown id treated as trackable would push its task's words into the quota numerator and pollute the
headline number read at review time, while a non-trackable fallback contributes no
words and correctly removes its duration from effective hours. That argument is unchanged by this
feature and is load-bearing, so it stays intact. The only sentence in that block that this feature
touches is any count of the defaults.

### AC5. The dev seed is rewritten to the new ids and uses them meaningfully

`scripts/seed.ts` is the only writer of `tasks.category`. After this feature no `'revision'` literal
remains in it, and the new ids appear on real rows rather than everything collapsing onto one
category. The specific edits.

- **`DayPattern.main` stops being a hardcoded two-member union.** L120 is
  `main: 'translation' | 'revision'`, which is now wrong rather than merely narrow. It becomes typed
  from the contract (`DefaultCategoryId`) rather than a new hardcoded list, so the next set change
  does not have to find it again.
- **`PATTERNS` (L140 to L211) uses the new ids meaningfully.** The two `revision`-led patterns split
  across `revision_internal` and `revision_external` rather than both taking one member, at least one
  pattern is led by `proofreading`, and at least one pattern carries a `dtp` entry as non-trackable
  time. Every one of the nine ids appears on at least one seeded row across the seven weeks, so a
  developer opening the dev app sees the whole set rather than a subset. Durations stay whole minutes
  and every pattern keeps landing in the capacity band its comment claims, so the seeded week still
  exercises all three meter colours.
- **The two inlined trackable checks call `isTrackableCategory`.** L384 and L409 both read
  `row.category === 'translation' || row.category === 'revision'`, which is a hand-inlined copy of the
  trackable rule. With four trackable ids a literal list would have to name four ids in two places
  and would need editing again in `PLAN-30`. They call `isTrackableCategory(row.category)` from
  `#shared/categories` instead. **This removes a duplicated rule rather than adding scope**, and the
  contract already declares itself the single source of truth for the flag.
- **The `'translation'` comparisons that genuinely mean translation stay literal.** L231
  (`pattern.main === 'translation'`) and L349 to L350 (`row.category === 'translation'`, finding the
  Wednesday and Thursday halves of the split pair) are about one specific category and not about the
  trackable rule, since a split pair links a translation across two days. They stay as they are and
  are not swapped for `isTrackableCategory`, which would change their meaning.
- **The two hardcoded off-day rows keep their categories.** The Saturday `translation` row at L425 and
  the Sunday `admin` row at L440 are both still valid ids and both still make sense, so neither moves.

Re-run safety is unchanged. `bun run seed` still deletes the owner's task and work-schedule rows and
rebuilds seven weeks, current week plus and minus three, so it recovers a dev database from any
earlier category set in one command.

### AC6. Every one of the nine ids resolves to a real key in both locale files

`TaskRow.vue` L45 resolves the name with a dynamic template key, ``t(`categories.${category.value}`)``,
and that lookup is unvalidated, so a missing key prints the raw key string. Two places make that
visible rather than harmless.

- **The label is the row's visible primary name** whenever `client` and `project` are both empty
  (`TaskRow.vue` L94), which is every non-trackable row. A missing key prints `categories.dtp` where
  the row's own name should be.
- **The label is also printed into an `sr-only` span** inside the first `role="cell"` (L111 to L114),
  as the non-colour equivalent of the coloured edge. A missing key is therefore read aloud as a raw
  key to a screen-reader user, which is the accessibility floor `extend-tasks.md` `AC16` sets.

So both locale files carry a key for every one of the nine ids, the FR and EN `categories` objects
have identical key sets with no missing side, every value is a non-empty string, and the `revision`
key is **removed from both** rather than left behind as a value no id can reach.

The contract edit and both locale edits land in the same change. Shipping nine ids against six keys
is the failure mode above, and shipping nine keys against six ids is harmless but leaves dead copy.

Verifiable by asserting each `DEFAULT_CATEGORY_IDS` entry has a matching non-empty key in both files
and that neither file holds a `categories` key outside the nine.

### AC7. `edgeSlot` is assigned for the four trackable ids, inside the existing ring

`CATEGORY_HUE_SLOTS` (L37) stays exactly `[195, 300, 115, 345, 240, 170, 275, 320]`, eight slots
unchanged, and `categoryEdgeHue` (L108 to L112) keeps its body. Only the `edgeSlot` numbers on the
descriptors move, and only as far as nine ids mechanically require.

| Id                  | `edgeSlot` | Hue it resolves to today |
| ------------------- | ---------- | ------------------------ |
| `translation`       | 0          | 195                      |
| `revision_internal` | 1          | 300                      |
| `revision_external` | 2          | 115                      |
| `proofreading`      | 3          | 345                      |
| the other five      | `null`     | no edge drawn            |

The reasoning is deliberately mechanical. `translation` keeps slot 0, which it already holds.
`revision_internal` takes slot 1, the slot `revision` held, so the shipped revision colour carries
over to the member closest to it. The two new trackable ids take the next unused slots in ring order,
which is exactly the rule the ring comment already states for `PLAN-30`. Four slots stay free, so the
ring still carries more slots than the defaults consume and `PLAN-30` can still assign a user-created
category without a redesign.

**These are placeholders and `PLAN-32c` replaces all of them. Nobody should read them as a design
decision.** The clearest evidence that they are placeholders is that `revision_internal` resolves to
magenta 300 and `revision_external` to green 115, which read as two unrelated categories, while
`PLAN-32c` is required by `AC3` of its own bullet to make the two revision greens read as related but
distinct. Proofreading resolving to pink 345 is likewise nothing to do with the user's pale grey, which the
contract cannot even express today because `categoryEdgeHue` returns a hue angle and grey means
chroma zero. That widening is `PLAN-32c`'s.

The five non-trackable ids keep `edgeSlot: null`, including the new `dtp`. That is the shipped `AC18`
behaviour and it is preserved here unchanged, even though
[the user's original colours overrule it](overview.md#the-original-category-colours-implemented-in-plan-32c),
because colouring them is `PLAN-32c`'s decision and doing it here would be the palette pass arriving
early.

### AC8. The contract's comments describe nine categories, not six

Several comments in `shared/categories.ts` state counts and reasoning that this feature falsifies, so
leaving them is leaving the file lying about itself. Each of these is corrected.

- **L9 to L12**, "The six default category ids". The count changes and the rest of the paragraph,
  which explains that the ids are stable storage keys with names resolved from i18n, stays.
- **L24 to L26**, the `CategoryId` seam comment, which says autocomplete covers "the six defaults" and
  that `PLAN-02` "ships and validates only the frozen six". Both counts change and the `PLAN-30`
  extensibility point stays.
- **L49 to L57**, the `DEFAULT_CATEGORIES` block, which is the most wrong of them. It names
  translation and revision as the two trackable members, lists the four non-trackable ones, and then
  argues that "the distinction the colour exists to make is translation against revision" and that
  "only the two trackable categories take an edge hue". The counts and the membership are rewritten to
  the nine. The colour argument is rewritten to say that the four trackable members take a
  placeholder slot each, that the five non-trackable ones draw no edge in this feature, and that
  `PLAN-32c` owns the real palette and is expected to give every category an edge.
- **L82 to L86**, the `coerceCategory` comment, which says coercion "checks the six defaults only".
  The count changes and the stale-id reasoning stays.
- **L73 to L78**, the fallback comment. Only a count changes if one is present. The fail-closed
  argument is preserved intact, per `AC4`.

The comment style stays the house style the file already uses, full sentences in prose blocks above
the declaration they explain, no em-dashes, and a reason given rather than a restatement of the code.

### AC9. The contract's unit tests follow the nine

`test/shared/categories.test.ts` enumerates the six ids in three literal tables and hardcodes four
counts, so it fails loudly on this change and every one of those has to move deliberately rather than
be made to pass.

- `EXPECTED_ORDER` (L20) becomes the nine ids in contract order.
- `TRACKABLE_TABLE` (L24 to L31) becomes nine rows with the flags from `AC1`.
- `EDGE_HUE_TABLE` (L157 to L164) becomes nine rows with the hues from `AC7`, and it carries a comment
  saying the four trackable hues are `PLAN-32a` placeholders that `PLAN-32c` replaces, so the next
  reader does not treat a failing assertion there as a regression.
- The hardcoded counts become nine ids (L53), nine descriptors (L64), four trackable (L81), and five
  non-trackable (L85).
- **`INVALID_INPUTS` (L36 to L44) currently lists `'proofreading'` as the stale id expected to fold to
  the default, and this feature makes it valid.** That case moves to `'revision'`, which is the
  genuine stale id now and is the exact value the dev database still holds, so the test asserts the
  real safety net rather than a hypothetical one. The case keeps its intent, which is mirroring the
  theme test's removed-id coverage.

The existing assertion that the ring carries more slots than the defaults consume still passes, since
four of eight slots are used.

### AC10. Nothing outside the set and its names changes

Verifiable by reading the diff. No quota field appears on `Category`. `settings.quota_wph` and its 450
default are untouched. `CATEGORY_HUE_SLOTS` and `categoryEdgeHue` are byte-identical. No migration is
added. `server/db/schema.ts` is untouched. No component template changes. Any of those appearing in
the diff is scope drift and a defect against this spec rather than a bonus.

### AC11. No reader of a category id is left behind

Three files import from `#shared/categories` and all three keep working with no edit, which is worth
asserting because it is the whole point of having one declaration site.

- `server/api/tasks/handlers/list.ts` (L5) calls `isTrackableCategory` at L93 to derive `trackable`
  server-side. It needs no change and it must not get one. That derivation is the project's
  logic-belongs-to-the-backend rule in action, and it now resolves four trackable ids instead of two
  purely because the contract changed.
- `app/components/planning/TaskRow.vue` (L2) calls `coerceCategory` at L44 and `categoryEdgeHue` at
  L55. Neither signature changes, so the component needs no edit. What it renders changes, through the
  new locale keys and the new `edgeSlot` values, and that is data flowing rather than code changing.
- `test/shared/categories.test.ts`, covered by `AC9`.

`server/models/tasks.ts` L79 keeps `category: string` raw and uncoerced on the response contract, and
`shared/planning.ts` L16 and L36 to L40 mirror that. That is deliberate, so `PLAN-11` can round-trip a
stale value on save without silently rewriting it, and this feature does not change it. The raw string
still reaches the client and the client still coerces for display.

## Edge cases

- **A stored `revision` value that survives anywhere.** It coerces to `'admin'` on read, so the row
  renders `Administration`, draws no edge, and is treated as non-trackable, which contributes no words
  to the quota and correctly removes its duration from effective hours. It is safe rather than
  correct, because the row silently reads as administration when it was revision work. The dev
  recovery is `bun run seed`, and the standing recovery for any single row once `PLAN-11` ships is
  recategorizing it. Nothing is stranded and nothing is lost, since the stored value is left alone and
  only the read is coerced.
- **The contract lands and the locale files do not.** This is the half-applied state that matters
  most, and it is why `AC6` puts all three edits in one change. A missing `categories.proofreading`
  key prints the raw key as the visible primary name of every non-trackable row and reads it aloud
  through the `sr-only` span, because the `TaskRow.vue` lookup is dynamic and unvalidated. Recovery is
  adding the key, and there is no invalid stored state to clean up afterward, since the failure is
  entirely in the read.
- **One locale updated and not the other.** French is the default and English is fully supported, so
  updating only `fr.json` leaves an English reader on raw keys for the three new ids. `AC6` requires
  identical key sets on both sides for exactly this reason.
- **The seed rewritten but not re-run, or re-run against a database on an older set.** Neither is a
  dead end. The seed deletes and rebuilds the owner's task rows unconditionally and needs no migration
  to have run first, since `tasks.category` accepts any string, so `bun run seed` recovers a dev
  database from any earlier category set in one command. There is no ordering constraint to get wrong
  and no half-migrated state to be stuck in.
- **A `revision` row on a period stat.** Coerced to `admin`, its words leave the quota numerator and
  its duration is subtracted from effective hours, so the period reads lower rather than wrong in an
  unbounded way. This is the fail-closed direction `AC4` protects, and it never inflates the number
  the review reads.
- **`dtp` reading as `DTP` in English and `Mise en page` in French, as a row's primary name.** A
  non-trackable row's name _is_ its category name (`TaskRow.vue` L94), so `dtp` rows render as the two
  divergent strings on the two locales. That is intended rather than a bug, and it is worth looking at
  on screen once because `DTP` is three uppercase letters where every other name in the set is a word,
  and it is the loudest name in the list by default.
- **A future user-created category colliding with one of the nine ids.** Out of scope and `PLAN-30`'s,
  which owns how a custom id is validated against the user's own set. This feature only keeps
  `CategoryId` as `DefaultCategoryId | (string & {})` so that seam does not have to be reopened.
- **Two categories that read as near-synonyms to a user.** `Révision interne`, `Révision externe`, and
  `Relecture` sit close together in ordinary French and the distinctions are the ones in actual professional use. The names
  are the user's and confirmed, so this is not a copy problem to solve. It is a reason no later stage should
  merge or rename any of them without asking the user's.

## Open questions

None block the build.

1. **The dropped migration is settled.** `AC3` decides against a `0008` and the `PLAN-32a` bullet in
   `overview.md` promised one. The project owner confirmed the decision on 2026-07-29 and it is now a
   written convention in the `my-backend-conventions` skill, so the bullet in `overview.md` is corrected
   rather than this spec bending to it. Nothing here is left open.
2. **`PLAN-32c` inherits the placeholder slots.** The four `edgeSlot` values in `AC7` are mechanical
   and will all be replaced, including the hue `translation` has held since it shipped. `PLAN-32c` also
   inherits two problems this feature does not touch, which are that the contract cannot express
   proofreading's chroma-zero grey and that nine categories plus four reserved status hues is a crowded
   ring. Both are named in
   [the original category colours](overview.md#the-original-category-colours-implemented-in-plan-32c).
3. **`PLAN-32b` inherits the quota field.** Four trackable categories now exist with no quota between
   them, so the app keeps using the single wrong 450 default until `32b` lands. That is a known-wrong
   number left in place on purpose, per the non-goals, and it is the reason `32b` follows immediately
   rather than later.
4. **Whether `terminology` should have stayed trackable.** It produces no words in the user's
   model and it shipped non-trackable, and the nine-category list confirms that, so nothing here
   changes. Recorded only because terminology work does produce something and a future conversation
   with the user's might revisit it. Not this feature's to raise.

## Stages

Specs and code review are never skipped.

- **Backend** runs and does the bulk of it. The contract edit, both locale files, and the seed
  rewrite. There is no server route change and no schema change, so this is a shared-contract and
  script change that happens to be the backend stage's shape.
- **Unit-test** runs. `AC9`, rewriting the three literal tables and the four counts in
  `test/shared/categories.test.ts`, moving the stale-id case from `'proofreading'` to `'revision'`, and
  adding coverage that every one of the nine ids resolves to a non-empty key in both locale files,
  which `AC6` needs and which nothing asserts today.
- **Design is skipped.** The palette is `PLAN-32c` and no layout changes. The `edgeSlot` numbers in
  `AC7` are mechanical placeholders and explicitly not a design decision.
- **Frontend is skipped.** No component changes. `TaskRow.vue` reads the contract through functions
  whose signatures do not move.
- **Accessibility is skipped as a stage, and one of its floors is folded into `AC6` instead.** The
  `sr-only` category span is the reason every one of the nine ids must resolve to a real key, so the
  requirement is an acceptance criterion here rather than a later audit. There is no new interactive
  element, no new markup, and no colour change to review.
- **Compliance is skipped.** No new class of personal data, no email, no third-party asset, no public
  content. Renaming a category id changes nothing about what is collected.
- **SEO is skipped.** The planning dashboard is behind sign-in and already `noindex, nofollow`.

## Amendments to shipped specs

- [`task-categories.md`](task-categories.md) (`PLAN-02`). Its `AC1` locking six categories, its
  six-row i18n table, and its `AC4` requiring a key for each of the six are superseded by `AC1`, `AC2`,
  and `AC6` here. Its `AC2` (`trackable` has one source) and `AC3` (an unknown id resolves to a safe
  default) are unchanged and still hold. Per the one-spec-per-feature rule this document does not
  duplicate that spec, it amends the set it declares, and `task-categories.md` should point here.
- [`extend-tasks.md`](extend-tasks.md). Its `AC18` (a non-trackable category reads as neutral) still
  holds through this feature, because the five non-trackable ids keep `edgeSlot: null`.
  `PLAN-32c` is the feature that overturns it.
- [`overview.md`](overview.md). The `PLAN-32a` bullet has dropped "plus a migration" per `AC3`, and its
  `AC3` wording now points at the verification recorded here rather than asking for the check again.
