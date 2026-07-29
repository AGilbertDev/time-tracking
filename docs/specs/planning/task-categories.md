# Task categories contract

**Superseded in part.** The six-category set below is replaced by the nine of `PLAN-32a`, specified in [nine-task-categories.md](nine-task-categories.md), so build the set from there rather than from this spec.

## Intent

`PLAN-02` defines the shared contract for the small set of task categories the planning dashboard uses. A category answers one load-bearing question about a task: does it produce billable words that count toward the quota, or does it consume scheduled time without producing words. That single fact is the `trackable` flag, and it is the one thing every other planning feature needs to agree on. The availability-quota engine (`PLAN-22`) sums `words_done` only across trackable tasks and subtracts non-trackable durations from effective hours, and the task row UI (`PLAN-06`) shows a real status on trackable tasks and `N/A` on the rest. Both read the same flag from here so the two can never disagree.

This feature ships a single `shared/` module, no UI and no database change. It mirrors `shared/theme.ts` exactly in shape: a frozen id list `as const`, a derived union type, a `DEFAULT_*` constant, and a pure `coerce*` function that narrows unknown input to a known id and falls back to the default. The `tasks` table stores `category` as free text (`PLAN-01`), the write API validates it (`PLAN-09`), and the read path coerces a stale or unknown id through this contract so it never reaches the UI raw, the same discipline `coerceThemeId` gives theme ids. Per project convention all visible strings live in the i18n layer, so this module carries only stable ids and the `trackable` flag, never display names. The type is designed so user-created categories can be layered on top later (`PLAN-30`), but `PLAN-02` ships only the six frozen defaults.

## Inputs

This is a shared-contract feature with no runtime user inputs. Its inputs are the locked decisions from [`overview.md`](overview.md) and the existing repo conventions it must match:

1. **The six default categories.** From the `overview` locked decisions and open question 4: Traduction / Translation and Révision / Revision are trackable; Terminologie / Terminology, Réunions / Meetings, Pauses / Breaks, and Administration / Admin are non-trackable.
2. **`trackable` is the meaning.** Trackable categories produce words and count toward the quota numerator; non-trackable categories produce no words and remove their duration from effective hours (`overview` locked decisions, `PLAN-22`).
3. **Categories are stored as free text and coerced at read.** `tasks.category` is a free-text id (`PLAN-01`); an unknown or retired id must resolve to a safe default rather than reach the UI, mirroring how `coerceThemeId` handles a stale theme id (`tasks-schema.md`).
4. **The `shared/theme.ts` module style.** A frozen id list `as const`, a derived union type, a `DEFAULT_*` constant, and a pure `coerce*` function. This new module copies that style so the client and the Nitro server validate against one list.
5. **Copy lives in i18n.** `i18n/locales/fr.json` and `en.json` are nested-object JSON files keyed by a top-level namespace. Category display names go there, not in the module.
6. **Extensibility for `PLAN-30`.** The user will be able to create their own categories, each with its own `trackable` flag, layered on top of these six. The type shape must accommodate that without a rewrite, but `PLAN-02` ships only the frozen six.

## Outputs and acceptance criteria

### The categories module

A new `shared/categories.ts` module in the exact style of `shared/theme.ts`, auto-imported by Nuxt into both `app/` and `server/`. It exports:

- **`DEFAULT_CATEGORY_IDS`**, a frozen `as const` tuple of the six default id strings, in this locked order: `['translation', 'revision', 'terminology', 'meetings', 'breaks', 'admin']`.
- **`DefaultCategoryId`**, the union type derived from that tuple (`(typeof DEFAULT_CATEGORY_IDS)[number]`), mirroring `ThemeId`.
- **`CategoryId`**, the broader id type that permits a custom id string while keeping autocomplete on the defaults (`DefaultCategoryId | (string & {})`). This is the extensibility seam for `PLAN-30`; `PLAN-02` uses only the six default ids.
- **A category descriptor type**, `Category`, with exactly two fields: `id: CategoryId` and `trackable: boolean`. It deliberately carries no display name. The display name is resolved from i18n by the id (see the i18n decision below).
- **`DEFAULT_CATEGORIES`**, a frozen `readonly Category[]` of the six defaults with their locked `trackable` flags, in the same order as `DEFAULT_CATEGORY_IDS`.
- **`DEFAULT_CATEGORY_ID`**, the safe fallback id constant, locked to `'admin'` (a non-trackable default, justified below), mirroring `DEFAULT_THEME_ID`.
- **`coerceCategory(value: unknown): CategoryId`**, a pure function that returns `value` when it is one of `DEFAULT_CATEGORY_IDS` and otherwise returns `DEFAULT_CATEGORY_ID`. Pure and database-free so it is unit-testable, exactly like `coerceThemeId`.
- **A trackable lookup** so `trackable` is read from one place rather than re-derived. Ship `isTrackableCategory(id: unknown): boolean`, which coerces `id` through `coerceCategory` and returns the coerced category's `trackable` flag. Because it coerces first, an unknown id resolves to the non-trackable default and can never be reported as trackable. Optionally back it with a `CATEGORY_BY_ID` record keyed by `DefaultCategoryId` for direct descriptor lookup.

The module contains only ids, the `trackable` flag, and the pure functions above. No display strings, no database access, no Vue or Nitro imports.

- **AC1.** `DEFAULT_CATEGORIES` contains exactly the six defaults with the correct flags: `translation` and `revision` are `trackable: true`; `terminology`, `meetings`, `breaks`, and `admin` are `trackable: false`. No seventh category ships. Verifiable by asserting the array length is six and each id maps to its locked flag.
- **AC2.** `trackable` is read from this contract and nowhere else. `isTrackableCategory(id)` returns the flag for a known id, and the quota engine (`PLAN-22`) and the task row UI (`PLAN-06`) both source the flag from this module rather than hardcoding which categories are trackable. Verifiable by unit-testing every default id through `isTrackableCategory` and by the absence of any duplicate trackable list elsewhere in the codebase.
- **AC3.** An unknown or stale id resolves to a safe default rather than reaching the UI raw. `coerceCategory('does-not-exist')`, `coerceCategory(undefined)`, `coerceCategory(null)`, `coerceCategory(42)`, and `coerceCategory('')` all return `DEFAULT_CATEGORY_ID` (`'admin'`), and `coerceCategory('translation')` returns `'translation'` unchanged. `isTrackableCategory('does-not-exist')` returns `false`.

### Display names in the i18n layer

A `categories` namespace is added to `i18n/locales/fr.json` and `i18n/locales/en.json`, keyed by the stable category id, following the existing nested-object structure. The i18n key convention is locked as `categories.<id>`, so a component resolves a name with `t('categories.' + category.id)` (or `t(\`categories.${id}\`)`). The entries are:

| id | `categories.<id>` FR | `categories.<id>` EN |
| --- | --- | --- |
| `translation` | Traduction | Translation |
| `revision` | Révision | Revision |
| `terminology` | Terminologie | Terminology |
| `meetings` | Réunions | Meetings |
| `breaks` | Pauses | Breaks |
| `admin` | Administration | Admin |

- **AC4.** `i18n/locales/fr.json` and `i18n/locales/en.json` each carry a `categories` object with a key for every one of the six default ids, and every key resolves to a non-empty string in both locales. The FR and EN objects have the same key set (no missing translation on either side). Verifiable by asserting each `DEFAULT_CATEGORY_IDS` entry has a matching key in both files.

### Decisions this contract locks

**Module location and name: `shared/categories.ts`.** It goes under `shared/` because it is a contract both the client and the Nitro server validate against, which is exactly what `shared/` is for under the separation-of-concerns convention (client in `app/`, server in `server/`, shared contracts in `shared/`). Nuxt 4 auto-imports everything under `shared/` into both sides, so declaring the ids and the `trackable` flag once here is the reason the two cannot drift. It sits beside `shared/theme.ts`, whose pattern it copies. It is a separate file from `theme.ts` because categories are a distinct domain concept from appearance preferences and deserve their own module rather than being bolted onto the theme file.

**Stable English ids decoupled from display names.** The id strings are `translation`, `revision`, `terminology`, `meetings`, `breaks`, and `admin`: plain lowercase English words, no kebab needed since none is multi-word. They are stable storage keys, never shown to the user, exactly as theme ids (`pastel`, `encre`, …) are stable strings decoupled from their palette display names. Display names are resolved from i18n by id, so renaming a French label is a locale-file edit that never touches stored data or the id union. This is what lets FR copy be corrected later without a migration.

**Descriptor shape: id plus `trackable`, names resolved from i18n by id.** The `Category` descriptor carries only `id` and `trackable`. It deliberately does not carry `nameFr` / `nameEn` fields, because per project convention all visible strings live in the i18n layer, not hardcoded in a module. The display name is derived from the id through the locked `categories.<id>` key convention. Keeping the descriptor to two fields also keeps it identical in spirit to how `THEME_IDS` carries ids while `useTheme.ts` owns the display names, and it means a category is fully described for logic (its id and whether it is trackable) with presentation left to the i18n layer.

**`coerceCategory` falls back to `'admin'`, a non-trackable default.** An unknown id resolves to `admin` rather than to `translation` or the first list entry. The fallback must be non-trackable for a safety reason: if an unknown or stale category were treated as trackable, its task's `words_done` would wrongly enter the quota numerator and pollute the headline number read at review time, and its time would be miscounted. A non-trackable fallback fails closed for the quota, contributing no words and correctly removing its duration from effective hours, which is the conservative, recoverable outcome. `admin` is chosen over the other non-trackable ids because it is the natural catch-all bucket for uncategorized work, so a coerced task reads sensibly to the user as well as computing safely. This mirrors `coerceThemeId` falling back to a valid default rather than leaving a raw stored value in play, and it satisfies the no-invalid-states rule: a bad category id can never strand a task or corrupt a period stat.

**Extensibility for `PLAN-30`, defaults only for now.** The `CategoryId` type is `DefaultCategoryId | (string & {})`, which permits a user-created id string while preserving editor autocomplete on the six defaults, so `PLAN-30` can layer custom categories on top without changing the descriptor shape or this module's exports. `PLAN-30` will introduce the user's own category records (each with its own `trackable` flag) and, at that point, extend the coercion path so a known custom id validates against the user's set rather than falling back. `PLAN-02` ships only the frozen six: `DEFAULT_CATEGORY_IDS`, `DEFAULT_CATEGORIES`, and `coerceCategory` know nothing about custom categories yet, and that is deliberate, so this contract stays small and correct on its own.

## Edge cases

- **A retired or renamed category id in stored data.** A task saved under a category id that no longer exists in the set (a future retirement, or data carried over from import) coerces through `coerceCategory` to `admin` on read, so the UI shows a valid, non-trackable category and the quota engine excludes its words. The stored value is left untouched; only the read is coerced, matching the theme-id pattern. Recovery is that the owner can recategorize the task to a valid category at any time, and nothing is lost in the meantime.
- **An unknown id reaching the quota engine.** Because `isTrackableCategory` coerces before reading the flag, an unknown id is treated as non-trackable, so it can never inflate the quota numerator. The failure mode is fail-closed: at worst a genuinely trackable task with a corrupted id would be under-counted (words dropped) rather than a non-trackable task being over-counted, and the fix is recategorizing the task.
- **Empty, null, or non-string input.** `coerceCategory` narrows any `unknown` (`undefined`, `null`, a number, an empty string, an object) to `DEFAULT_CATEGORY_ID`, so no non-string value can leak through to the UI or the engine as a category id.
- **A missing i18n key.** If a locale file lacks a `categories.<id>` entry, i18n falls back per the app's existing i18n configuration rather than crashing. AC4 requires all six keys in both locales so this does not occur for the defaults; the case matters once `PLAN-30` adds custom categories whose names live outside these static files, which `PLAN-30` must handle (a custom category's name is user-entered data, not a static locale key).
- **The trackable set drifting from the UI or the engine.** The whole point of this contract is that both the UI (`PLAN-06`) and the engine (`PLAN-22`) read `trackable` from here. If either reimplements its own list of which categories are trackable, they can silently disagree. AC2 guards against this: the flag has one source, and any second copy is a defect to remove.

## Open questions

None block this contract. The items below are recorded so downstream stages resolve them deliberately.

1. **FR copy is owner-accepted as-is, correction deferred.** The six FR names (Traduction, Révision, Terminologie, Réunions, Pauses, Administration) are used as given. The owner has accepted that any FR wording correction is a later minor touch-up that does not block the build. Because names live in the locale files keyed by stable id, any correction is a locale-file edit with no data migration and no change to this module. French copy follows the Québécois rules (a space before `? ! : ;`), though none of the six names carries such punctuation today.
2. **Custom-category coercion is `PLAN-30`'s to design.** How `coerceCategory` (or a successor) validates a user-created id against the user's own set, and how a custom category's display name is stored and resolved (user-entered data, not a static locale key), is out of scope here and owned by `PLAN-30`. This contract only ensures the type shape does not have to change to get there.
3. **Whether the status vocabulary is derived from `trackable`.** Status applies only to trackable tasks (`overview` open question 5, `PLAN-14`), so the UI will read `trackable` from this contract to decide whether a task shows a status or `N/A`. The status names themselves live elsewhere (`PLAN-09` / `PLAN-14`); this module only supplies the trackable flag that gates them.
