# Task CRUD write API

`PLAN-09`. Depends on `PLAN-01`. Backend only, plus one small addition to the shared contract.

## Intent

This is the first write path the application has ever had. Before this feature every task row came from the dev seed, because the `tasks` table had a reader (`PLAN-04`) and no writer at all. That is stated in the past tense on purpose, since this feature is what ends it, and a later change must not reuse the claim as though it were still true. This feature adds create, update, and delete for a task, each validated with Zod, each with its logic in `server/api/tasks/handlers/`, and each scoped to the session user so a caller can only ever touch their own rows. Each returns the written row in the exact shape the list endpoint already returns, so the client never needs a second read.

The schema was written permissive on purpose. `PLAN-01` left almost every column nullable and left `category` and `status` as free text, recording in its own spec that validation and coercion sit at the write boundary rather than in the columns. Two comments in [`schema.ts`](../../../server/db/schema.ts) name this feature directly, on `category` and on `status`, both reading "validated at the PLAN-09 write boundary". This feature is that boundary. It is the only place where the meaning the schema declined to enforce actually gets enforced, so what it accepts is what the database will hold forever.

It ships no UI. Adding a task is `PLAN-10`, the inline editor is `PLAN-11`, deleting from the row is `PLAN-13`, and the status cycle is `PLAN-14`. All four consume this API and none of them are in scope. Splitting (`PLAN-18`), reordering (`PLAN-15`), moving across days (`PLAN-16`), and the timer (`PLAN-34`) each write tasks too, and each owns its own endpoint or its own later pass over this one.

**No schema change and no migration.** Everything below is possible against the live `tasks` table as it stands. The one place that had to be checked before the spec could say so is `words_done`, which turns out to be nullable with no default, and the reasoning that hangs off that is in [the words_done question](#the-words_done-question-and-how-it-was-settled).

This feature is also the moment a standing assumption in the project stops being true. See [the PLAN-32a finding goes stale](#the-plan-32a-finding-goes-stale-the-moment-this-ships).

## Inputs

This feature takes two kinds of input. The runtime inputs are three HTTP requests, described first. The design inputs are the locked decisions and the shipped code this feature has to agree with, listed after them.

### The three request bodies

Each body arrives as JSON and is read with `readValidatedBody` against a Zod schema, never with a bare `readBody`. The route calls `.safeParse` and hands a failure to [`sendZodError`](../../../server/utils/sendZodError.ts), so a malformed request is a structured 422 with per-field messages rather than a thrown 500. The mechanics of that contract are under [validation and the error contract](#validation-and-the-error-contract).

**Create.** `POST /api/tasks` carries the whole task in the body. Only `date` and `category` are required, because they are the only two `NOT NULL` columns without a default. Every other writable field is optional, and an omitted field is stored as `NULL` or as its column default rather than being inferred from anything else in the body. The smallest legal request is a day and a kind of work, which is what adding a break or a meeting should cost the user.

**Update.** `PATCH /api/tasks/[id]` carries only what changed. The id travels in the path and never in the body, so there is no second place it can appear and no way for the two to disagree. The body is a genuine partial patch, so every writable field is optional, but it must carry at least one of them, since an empty patch is a meaningless write and almost always a client bug. An absent field leaves its column alone and a field sent as `null` clears it, and that distinction matters enough to have its own section under [partial update semantics](#partial-update-semantics-absent-against-explicit-null).

**Delete.** `DELETE /api/tasks/[id]` has no body. The id in the path is the entire request, and the handler reads nothing else.

**The path parameter is untrusted input too.** Both `[id]` routes validate it as a non-empty string before any query runs, so a missing or malformed id fails at the boundary instead of reaching the database.

### What each body accepts

The authority on every individual field is [the writable field contract](#the-writable-field-contract), which gives the create column, the update column, and the validation rule for each one. It is not repeated here, because two copies of a field list drift and the copy further from the schema is the one that goes stale. The grouping below is the shape of the request at a glance.

| Field group                                                                 | Create       | Update   |
| --------------------------------------------------------------------------- | ------------ | -------- |
| `date` and `category`, the day and the kind of work                         | **required** | optional |
| `client` and `project`, free text                                           | optional     | optional |
| `deliveryDate` and `deliveryTime`                                           | optional     | optional |
| `projectWordCount`, `quotaWphOverride`, `estimatedMinutes`, `actualMinutes` | optional     | optional |
| `status` and `excludeFromStats`                                             | optional     | optional |
| `id`, `userId`, `createdAt`, `updatedAt`, all server-owned                  | refused      | refused  |
| `wordsDone`, `sortOrder`, `splitGroupId`, each owned by another feature     | refused      | refused  |

**Refused means a 422, not a silent drop.** Both object schemas are `.strict()`, so an unknown key and a server-owned key are both errors. A client that sends `userId` and gets a 200 has been told its write succeeded as sent, which is false, and the owning user always comes from the session regardless of what the body claims.

### Formats, ranges, and the little coercion there is

Dates are `YYYY-MM-DD` and are checked as real calendar days rather than as a shape, so `2026-02-31` is a 422 instead of a value JavaScript rolls forward into March. Delivery times are `HH:MM` on a 24-hour clock. The numeric fields are integers with generous anti-garbage bounds rather than policy bounds, since the app signals and never blocks, and `quotaWphOverride` starts at 1 because it is a divisor. `excludeFromStats` is a real boolean.

**Types are not coerced.** A number sent as `"12000"` is a 422 rather than a parsed integer, and a boolean sent as `"true"` is a 422 rather than a `true`. The request should be honest about its own types, and a body that is loose about them is usually a client bug worth surfacing.

**The one coercion is the empty string.** `client` and `project` are trimmed, and an empty string becomes `null`, so a cleared field is stored as absent rather than as a blank value the database then holds in two forms.

**Category is validated, not coerced.** [`shared/categories.ts`](../../../shared/categories.ts) exports `coerceCategory`, which narrows an unknown id to a known one and falls back to `admin`. The write path does not call it. `coerceCategory` defends the read path against ids already sitting in the database, left behind by a renamed or retired category, and at the write boundary the client picked from a list the server gave it, so an unknown id is a bug or a hostile request rather than history. Silently storing `admin` on a task the user labelled as translation would be data corruption dressed as robustness, so an unknown category is a 422 on both endpoints. The reasoning in full is under [category validation rejects rather than coerces](#category-validation-rejects-rather-than-coerces). The valid set is read from `DEFAULT_CATEGORY_IDS` in the same module rather than retyped.

### Two fields whose absence from the body is the point

**`actualMinutes` is accepted, and it is never inferred.** Both bodies take it as an optional integer, and an explicit value from the user is the only thing that ever writes the column. No request that carries `estimatedMinutes` fills `actualMinutes` as a side effect, on create or on update. Storing the copy would make a duration the user confirmed and a duration the app assumed into identical rows, and nothing downstream could tell them apart afterwards. The fallback is resolved at read time instead, and the argument is under [do not store the fallback](#do-not-store-the-fallback).

**`wordsDone` is in neither body, and sending it is a 422.** The column is nullable with no default, so declining it costs nothing structurally and no write breaks for want of it. Two reasons to decline it anyway. The user already gives that figure as `projectWordCount`, and for an ordinary single-day task the two are the same number, so a writer here would be asking the same question twice. And the column is scheduled for removal in `PLAN-33`, so keeping it out of the request contract means that feature is an internal cleanup rather than a breaking change for `PLAN-10` and `PLAN-11`. Nothing writes it server-side either, and the reasoning for declining the tempting mirror is settled under [the words_done question](#the-words_done-question-and-how-it-was-settled).

### Design inputs

1. **The live schema.** [`server/db/schema.ts`](../../../server/db/schema.ts), the `tasks` table. It is the authority over every document, including this one. Which columns are nullable and which carry defaults decides what a create can legally omit, and it is the reason only two fields are required.
2. **Four locked decisions from 2026-07-29**, recorded in [`overview.md`](overview.md). The quota is per-category buckets measured against the time spent in each, `estimated_minutes` is derived and frozen while `actual_minutes` is the measurement and the quota denominator, the estimate-to-actual fallback is resolved at read time and **never stored**, and `words_done` is scheduled for removal in `PLAN-33`. Each is honoured below and each is named where it bites.
3. **The shared contract.** [`shared/categories.ts`](../../../shared/categories.ts) for the nine ids, `coerceCategory`, and `isTrackableCategory`. [`shared/planning.ts`](../../../shared/planning.ts) for `effectiveDuration`, `statusKey`, and the `PlanningTask` shape.
4. **The read path this must match.** [`server/api/tasks/index.get.ts`](../../../server/api/tasks/index.get.ts) and [`server/api/tasks/handlers/list.ts`](../../../server/api/tasks/handlers/list.ts) set the house pattern of a thin route plus an extracted handler, and `TaskListItem` in [`server/models/tasks.ts`](../../../server/models/tasks.ts) is the row shape the response has to reproduce.
5. **The write precedents.** [`saveWorkSettings.ts`](../../../server/api/me/handlers/saveWorkSettings.ts) for partial-patch field mapping, [`deactivate.ts`](../../../server/api/admin/users/handlers/deactivate.ts) for `createError` shape and for setting `updatedAt` by hand, [`work-settings.patch.ts`](../../../server/api/me/work-settings.patch.ts) for the thin PATCH route, and [`WorkSettingsPatchSchema`](../../../server/models/work-settings.ts) for how a partial body is validated and how an empty one is refused.
6. **The house error contract.** [`sendZodError`](../../../server/utils/sendZodError.ts) turns a `ZodError` into a 422 with per-field messages, and [`defineAuthenticatedEventHandler`](../../../server/utils/defineAuthenticatedEventHandler.ts) throws 401 before any handler code runs.

## Scope

In scope: create, update, and delete a task. The Zod schemas for all three. The ownership rule. The response projection shared with the list handler. One new export in `shared/planning.ts`. Two documentation annotations in `overview.md`.

Out of scope, each its own later pipeline run: `PLAN-10`, `PLAN-11`, `PLAN-12`, `PLAN-13`, `PLAN-14`, `PLAN-15`, `PLAN-16`, `PLAN-18`, `PLAN-33`, `PLAN-34`. No frontend work at all, and no schema change.

### The PLAN-09 / PLAN-10 / PLAN-11 split holds, with one correction elsewhere

The split as the overview draws it is right and this feature does not redraw it. A write API with no UI is independently testable, which is the whole argument for the boundary, and `PLAN-10` and `PLAN-11` are genuinely two features rather than one, because adding a task and editing every field of an existing one have different failure modes.

One neighbouring entry is wrong and should be corrected when it comes up rather than here. **`PLAN-12` is listed as "Frontend plus shared"**, and it cannot be. It owns `estimated_minutes = words / quota`, which is a derived value, and the project convention puts derivation on the server. When `PLAN-12` runs it will change this write path, so its stage list needs a backend stage. This is recorded as an observation and is not acted on here, because acting on it would mean building `PLAN-12`.

## Outputs and acceptance criteria

### Route shape

File-based Nitro routing with the method in the filename, which is what `server/api/` already does everywhere. The task id travels in the path rather than in the body.

| Verb     | File                              | Handler                             | Success          |
| -------- | --------------------------------- | ----------------------------------- | ---------------- |
| `POST`   | `server/api/tasks/index.post.ts`  | `handlers/create.ts` → `createTask` | `201` + row      |
| `PATCH`  | `server/api/tasks/[id].patch.ts`  | `handlers/update.ts` → `updateTask` | `200` + row      |
| `DELETE` | `server/api/tasks/[id].delete.ts` | `handlers/remove.ts` → `removeTask` | `200` + `{ id }` |

**The id goes in the path.** It is the documented Nitro dynamic-route form, it is what REST expects, and putting it in the body would create a second place an id could appear and therefore a way for the path and the body to disagree. This introduces the repo's first `[param]` route, which is a new file shape but not a new convention, since it is the framework's own.

**Update is `PATCH`, not `PUT`.** Three reasons, in order of weight. The house already uses `PATCH` for a partial field write and reserves `PUT` for replacing a whole resource, which is exactly the `me/password.patch.ts` and `me/work-settings.patch.ts` against `me/avatar.put.ts` division. A partial body is what `PLAN-14`'s status cycle actually sends, one field, and forcing it to send the whole task to change one value would make every cycle click a round-trip of fields it does not own. And a partial body narrows the blast radius when two tabs are open, because a patch touching only `status` cannot clobber an `actual_minutes` the other tab just wrote, where a `PUT` would.

**The handler file is `remove.ts` exporting `removeTask`.** Every handler in the repo names its file after its exported function (`list.ts` and `listTasks`, `deactivate.ts` and `deactivateUser`), and `delete` cannot be an identifier in JavaScript, so `remove` keeps the pair aligned where `delete.ts` and `deleteTask` would break it.

- **AC1.** The three route files exist at the paths above and each is thin in the shipped sense: it validates and delegates, holding no database access, no ownership check, and no business rule. `index.post.ts` and `[id].patch.ts` read and validate their body, return `sendZodError(result.error)` on failure, and call their handler. Each is at most a handful of lines, matching `index.get.ts`.
- **AC2.** All logic lives in `server/api/tasks/handlers/`, in `create.ts`, `update.ts`, and `remove.ts`, each exporting one function that takes the `H3Event` and the validated input. No handler is called from anywhere but its route.

### Authentication and ownership

Every route is wrapped in `defineAuthenticatedEventHandler`, so a request with no session throws 401 before any handler runs. The owning user is always read from the session, never from the request, which is the same rule `listTasks` follows and states.

**A task the session user does not own returns 404, not 403.** The overview's `PLAN-09` `AC1` originally said 403, and this spec departed from it deliberately. That divergence is now closed rather than standing: `AC1` was corrected to 404 on 2026-07-30, so the two planning documents describe one contract and there is no longer a criterion an implementer could follow back into the weaker behaviour. The reasoning is kept here because it is why the criterion changed. `AC1`'s guarantee is "a user can only mutate their own tasks", and the status code is how that guarantee is reported rather than the guarantee itself. A 403 on someone else's task id confirms that the id exists, so a caller holding a session can enumerate ids and learn which ones are real. A 404 for the missing case and the not-yours case alike leaks nothing and satisfies the guarantee strictly more safely.

**An earlier draft of this section called the risk close to theoretical on the grounds that this is a single-owner app with no second user. That was wrong and is corrected here.** The app is multi-user by design and has been since `PLAN-05`. There is an `allowed_emails` allowlist, a `role` column, an admin page for inviting people, and an invitation email. Signup is owner-managed rather than public, which limits who can get an account, but it does not mean only one account exists, and every invited user is a second user with their own tasks to leak. So the enumeration risk is real rather than hypothetical, and the 404 is a live protection rather than a cheap precaution. A 404 is also easier to keep correct than a 403, because there is only one branch to write. The real tradeoff is that a genuine client bug sending a stale id now looks the same as an authorization failure, which is acceptable because the client's recovery for both is identical and is described under [interrupted and abandoned paths](#interrupted-and-abandoned-paths).

- **AC3.** All three endpoints return 401 when there is no session, thrown by the wrapper before any handler code runs.
- **AC4.** `PATCH` and `DELETE` return 404 when the id matches no row, and 404 when the id matches a row belonging to another user. The two cases are indistinguishable from outside: same status, same body, no message difference. A test that seeds a task under user B and patches it as user A gets a 404 and finds user B's row unchanged afterwards.
- **AC5.** No handler reads a user id from the path, the query, or the body. The owning user comes from `requireUserSession(event)` in every case, so a `userId` smuggled into a request cannot change which rows are touched.

### Validation and the error contract

Every body is parsed with Zod at the route, and a failure returns a structured 422 through `sendZodError` with per-field messages, never a 500. The path parameter is validated too, since an id is untrusted input like any other.

**The object schemas are `.strict()`.** An unknown key is a 422 rather than a silently dropped field. This is the mass-assignment protection, and making it an error rather than an omission matters: a client that sends `userId` and gets a 200 has been told its write succeeded as sent, which is false. Rejecting the request says plainly that the field is not writable.

- **AC6.** An invalid body returns 422 through `sendZodError`, with a `data` object keyed by field name. A body failing two fields reports both.
- **AC7.** `id`, `userId`, `createdAt`, and `updatedAt` are never client-writable on either endpoint, and sending any of them returns 422 rather than being ignored. The same holds for `wordsDone`, `sortOrder`, and `splitGroupId`, each for its own reason given below. A test posting `{ date, category, userId: '<other user>' }` gets a 422 and creates no row.
- **AC8.** An empty `PATCH` body is a 422, matching `WorkSettingsPatchSchema`'s refine and its recorded reason, which is that a client bug should not be able to send a meaningless write. The consequence for `PLAN-11` is that its editor must not fire a save when nothing changed, which is the right place for that check because only the client knows whether the form is dirty.
- **AC9.** The `[id]` path parameter is validated as a non-empty string before any query runs, so a missing or malformed id is a 422 and never reaches the database.

### The writable field contract

Field by field over the live schema. "Create" and "Update" say whether a client may send the field on that endpoint.

| Column             | Create             | Update             | Rule                                                                                |
| ------------------ | ------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| `id`               | never              | never              | Server-owned, `$defaultFn` uuid.                                                    |
| `userId`           | never              | never              | Server-owned, from the session.                                                     |
| `date`             | **required**       | optional           | `isValidCalendarDay`. Column is `NOT NULL`.                                         |
| `client`           | optional, nullable | optional, nullable | Trimmed, max 200, empty string becomes `null`.                                      |
| `project`          | optional, nullable | optional, nullable | Trimmed, max 200, empty string becomes `null`.                                      |
| `category`         | **required**       | optional           | Must be one of `DEFAULT_CATEGORY_IDS`. Column is `NOT NULL`.                        |
| `deliveryDate`     | optional, nullable | optional, nullable | `isValidCalendarDay`.                                                               |
| `deliveryTime`     | optional, nullable | optional, nullable | `HH:MM`, 24-hour.                                                                   |
| `projectWordCount` | optional, nullable | optional, nullable | Integer, `0` to `10000000`.                                                         |
| `wordsDone`        | never              | never              | Never written at all. See [below](#the-words_done-question-and-how-it-was-settled). |
| `quotaWphOverride` | optional, nullable | optional, nullable | Integer, `1` to `10000`. Never zero.                                                |
| `estimatedMinutes` | optional, nullable | optional, nullable | Integer, `0` to `100000`. Stored verbatim, never computed here.                     |
| `actualMinutes`    | optional, nullable | optional, nullable | Integer, `0` to `100000`. **Never auto-filled.**                                    |
| `status`           | optional, nullable | optional, nullable | One of the shared status tuple, cross-checked against trackability.                 |
| `excludeFromStats` | optional           | optional           | Boolean. Defaults to `false` through the column default.                            |
| `splitGroupId`     | never              | never              | `PLAN-18` owns it.                                                                  |
| `sortOrder`        | never              | never              | Server-assigned. `PLAN-15` owns reordering.                                         |
| `createdAt`        | never              | never              | Server-owned.                                                                       |
| `updatedAt`        | never              | never              | Server-owned, set by hand on update.                                                |

**Only `date` and `category` are required on create**, because they are the only two columns that are `NOT NULL` without a default. Everything else the table needs is either nullable or defaulted, so the smallest legal task is a day and a kind of work. That matches the product and not only the schema: the user adds a break or a meeting with nothing but those two, and `PLAN-10`'s `AC3` says adding is never blocked.

**`splitGroupId` is not writable**, so no task created through this API can join a split group. That is `PLAN-18`'s job and it needs its own endpoint anyway, since creating a slice is a two-row operation. Accepting the field here would also let a client attach its own task to a group id it guessed, which is a quiet way to reach across a shared key.

**Empty string becomes `null`** on the two free-text fields, so a cleared field is stored as absent rather than as an empty value. Without the normalization the database ends up holding both, and a row with `client = ''` renders as a blank cell where a row with `client = NULL` renders as missing, which are the same thing to the user and two different things to every reader.

- **AC10.** A create with only `{ date, category }` succeeds and returns 201. The stored row has `sortOrder` assigned, `excludeFromStats` false, and every other unset column `NULL`.
- **AC11.** A create or update sending `client: ''` stores `NULL`, not `''`. The same holds for `project`.
- **AC12.** `quotaWphOverride: 0` is a 422. Zero is not merely out of range, it is the divisor in `estimated = words / quota`, so admitting it would store a row that divides by zero the moment `PLAN-12` reads it.
- **AC13.** Numeric fields reject negatives and non-integers with a 422, at the exact bounds in the table.

**The bounds are anti-garbage limits, not policy limits**, and the distinction decides how they were picked. The app signals and never blocks, so a forgotten timer producing a sixty-hour Monday is a number the user corrects rather than one the API refuses, per the recorded decision under [a running timer](overview.md#a-running-timer-clickups-shape-minimal). The duration cap of 100000 minutes is about seventy days, far past any honest entry, and exists only so a garbage or overflowing value cannot land in the column. A tight cap of one day would be the app policing the user and would reject the very sixty-hour case the owner said to allow.

**`quotaWphOverride` reuses the existing bounds deliberately.** `quotaWphSchema` in [`server/models/work-settings.ts`](../../../server/models/work-settings.ts) is already `int().min(1).max(10000)` for the global setting, and a per-task override is the same quantity, so it takes the same range rather than inventing a second opinion about what a plausible words-per-hour figure is. If those bounds ever change, they should change in one place.

### Partial update semantics, absent against explicit null

A `PATCH` distinguishes a field that is absent from a field explicitly set to `null`. Absent means leave the stored value alone. `null` means clear it.

This is not a detail. `effectiveDuration` reads `actualMinutes` as "the user measured this" and `NULL` as "the user did not", so a user who typed a wrong duration needs a way back to unmeasured, and clearing to `0` is not that. Zero minutes is a measurement. The handler therefore builds its update object by checking `!== undefined` per field, exactly as `saveWorkSettings` does, and passes `null` through when it is sent.

- **AC14.** A `PATCH` that omits a field leaves that column unchanged. A `PATCH` sending `{ "actualMinutes": null }` sets the column to `NULL`, and a subsequent read shows the row falling back to its estimate through `effectiveDuration` again. A `PATCH` sending `{ "actualMinutes": 0 }` stores `0` and the row does not fall back.
- **AC15.** Every update sets `updatedAt` to the current instant explicitly. `$defaultFn` fires on insert only, so an update that forgets it leaves a stale instant, which is the mistake `deactivate.ts` avoids by setting `updatedAt` alongside `deactivatedAt`.

### Do not store the fallback

**`actual_minutes` stays `NULL` until the user sets it. The write API never fills it from `estimated_minutes`.**

This is the locked decision from 2026-07-29 and it is the one most likely to be undone by a later implementer acting helpfully, because auto-filling looks like a convenience and the old app did exactly that. It is not a convenience. Storing the copy makes a duration the user confirmed at 2 h 00 and a duration the app assumed at 2 h 00 into identical rows, and nothing afterwards can tell them apart. `effectiveDuration` in [`shared/planning.ts`](../../../shared/planning.ts) already resolves the fallback at read time, the quota engine reads the same function, and the column is already nullable, so leaving it `NULL` behaves identically on screen and keeps the distinction for free.

The same rule holds for `estimated_minutes`, which is covered separately below because its reasoning is different.

- **AC16.** A create carrying `estimatedMinutes` and no `actualMinutes` stores `actual_minutes` as `NULL`. Verified against the database row rather than against the response, because the response resolves the fallback for display and would show the estimate either way. The test asserts `SELECT actual_minutes` is `NULL`, and it exists specifically to fail if a later change adds the auto-fill back.
- **AC17.** No code path in `create.ts` or `update.ts` reads `estimatedMinutes` in order to write `actualMinutes`. An update that changes `estimatedMinutes` leaves `actual_minutes` exactly as it was, `NULL` included.

### `estimated_minutes` is stored, not derived, and this feature derives nothing

The locked decision says `estimated_minutes` is derived from `words / the category quota` and frozen when written. This feature does not implement that derivation, and it does not accept the derivation's inputs and compute a value either. It takes `estimatedMinutes` as a validated optional integer and stores exactly what it is given.

The reasoning against computing it here, since the "logic belongs to the backend" convention would otherwise demand it. The derivation needs a per-category quota. Per-category quotas are `PLAN-32b`, which is not built, and the only quota available today is the global `settings.quota_wph`, whose default of 450 is recorded in the overview as wrong and whose column `PLAN-32b` deletes outright. So the server can compute a number, but only a wrong one, and because the estimate is frozen by definition it would never self-correct. `PLAN-32b` landing later would fix the quota and leave every task written in the meantime carrying a frozen estimate derived from a number nobody believes. Writing no estimate is recoverable, because `PLAN-12` can backfill from a real quota once one exists. Writing a wrong frozen estimate is not, because nothing downstream can tell a frozen-correct value from a frozen-wrong one.

The convention is satisfied in the direction that matters, which is that no derivation happens on the client either. Nothing derives the estimate anywhere in this feature. The field is a plain stored fact today, like `projectWordCount`, and it becomes a derived one in `PLAN-12`.

**Handoff to `PLAN-12`, stated so it is not rediscovered.** When it lands, the derivation belongs in these handlers, `estimatedMinutes` stops being client-writable, and it moves to the never column of the table above. That is a contract change to this API and should be specced as one.

This is also what keeps the feature from blocking on `PLAN-32b`, which was the constraint.

- **AC18.** A create with no `estimatedMinutes` stores `estimated_minutes` as `NULL`. It is not computed from `projectWordCount`, from `quotaWphOverride`, or from `settings.quota_wph`.
- **AC19.** Neither handler imports or reads `settings.quota_wph`. A search for `quotaWph` under `server/api/tasks/` returns nothing outside the per-task `quotaWphOverride` passthrough.

### Category validation rejects rather than coerces

An unknown category id is a 422. The write path does not call `coerceCategory`.

A read path coercing and a write path rejecting is not an inconsistency, it is the two boundaries doing their own jobs. `coerceCategory` exists to defend against values that are **already in the database**, left behind by a renamed or retired category, and its job is to stop a stale id reaching the UI raw. At the write boundary the situation is different: the client picked from a list the server gave it, so an unknown id is a client bug or a hostile request rather than history. Coercing it would silently store `admin` on a task the user labelled as translation, and the user would then see the wrong category with no error to explain it, which is a data corruption dressed as robustness. The schema comment already records this division, reading "coerced at read, validated at the PLAN-09 write boundary".

**Forward note for `PLAN-30`.** When users can create their own categories, the valid set becomes the nine defaults plus that user's own, so this validation grows from a static enum into a per-user lookup. Written down because a static `z.enum` is easy to leave behind.

- **AC20.** `category: 'revision'`, the retired id from the six-member set, is a 422 on both create and update. So is any other string outside `DEFAULT_CATEGORY_IDS`.
- **AC21.** The valid set is read from `DEFAULT_CATEGORY_IDS` in `shared/categories.ts` rather than retyped, so adding a category to the contract makes it writable with no change here.

### Status is validated against the category, on the resulting row

The three stored statuses are `Accepté`, `En cours`, and `Terminé`, and they apply to trackable categories only. A non-trackable task has no status and reads as `N/A`.

Two rules, and the split between them is what keeps the trackability logic on the server.

1. **A body that asserts a contradiction is a 422.** If the request sets a non-null `status` and the resulting row's category is non-trackable, the request is refused. The client stated something false and should hear about it.
2. **A body that changes the category to a non-trackable one, and says nothing about status, clears the stored status to `NULL` as part of the same update.** The client asserted nothing, so the server keeps the row valid on its own. The alternative, refusing until the client sends `status: null` too, would force `PLAN-11` to know which categories are trackable in order to compose a valid request, which is precisely the backend rule leaking into the frontend that the conventions forbid.

**The cross-check runs against the merged row, not against the body.** An update sending only `{ category: 'breaks' }` on a task currently holding `En cours` has a perfectly valid body and produces an invalid row, so the handler reads the existing row, overlays the patch, and validates the result. This cannot be done in Zod alone, because Zod only sees the request, so it is a handler-level check after the row is loaded.

**The accents are load-bearing.** `Terminé` is compared as a literal string in the list query's overdue expression (`DONE_STATUS` in `list.ts`). A row storing `Termine` would never match, so a finished task would be reported late forever. A strict enum is what prevents that, which is a stronger reason than tidiness.

- **AC22.** `status` outside the three values is a 422, including a de-accented `Termine` and including `N/A`, which is a display value the read path derives and never a stored one.
- **AC23.** Creating or updating a task with a non-trackable category and a non-null status is a 422. A test with `{ category: 'breaks', status: 'En cours' }` fails on both endpoints.
- **AC24.** Patching a trackable task that holds `En cours` with `{ category: 'breaks' }` succeeds, and the stored `status` is `NULL` afterwards. The response's `statusKey` is `na`.
- **AC25.** Trackability is read from `isTrackableCategory` in `shared/categories.ts`, never from a list of category ids written out again in the write path.

### `sort_order` is assigned by the server

On create, `sort_order` is `max(sort_order) + 1` across the session user's tasks on that `date`, or `0` when the day has none. It is not client-writable.

The server assigns it because the correct value depends on rows the client may not have loaded, which makes it a backend decision by the same rule that puts filtering and ordering on the server. A new task lands at the end of its day, which is what adding to a list means.

**On an update that changes `date`, the server reassigns `sort_order` by the same rule, to the end of the destination day.** The old value was an ordinal within a different day and means nothing on the new one, so carrying it over would drop the task at an arbitrary position. Reassigning keeps one invariant true everywhere, which is that `sort_order` is always the server's answer relative to the row's own day.

**No transaction and no lock.** Two creates racing on the same day can produce two rows with the same `sort_order`, and that is not an invalid state: the list orders by `(date, sortOrder, id)` with the id as a stable tie-break, so a collision degrades to a deterministic order rather than a bug. This is a single-owner app, so the race is close to unreachable anyway, and the tie-break means it costs nothing when it happens.

- **AC26.** Creating into an empty day gives `sort_order` 0. Creating into a day whose highest is 3 gives 4. Another user's tasks on the same date do not affect the result, because the scan is scoped to the session user.
- **AC27.** `sortOrder` in a request body is a 422 on both endpoints. Reordering is `PLAN-15` and gets its own endpoint, which it needs regardless because moving one row renumbers others.
- **AC28.** A patch changing only `date` reassigns `sort_order` to the end of the target day.

### The `words_done` question, and how it was settled

**Superseded 2026-07-30. The column is gone, dropped by `PLAN-33` in migration `0008`**, specced in [row-simplification-words-total.md](row-simplification-words-total.md). This section is annotated rather than rewritten, because the decision it records was correct and is the reason the drop was an internal cleanup rather than a breaking API change, which is worth keeping legible. Read it as history. Three things follow from the drop. Route C's choice not to expose a writer is what made `PLAN-33` cheap, so the cost it accepted was paid off rather than merely tolerated. `AC29`, `AC30`, and `AC31` retire with the column, and their guards are removed or repointed under that spec's test-surface section rather than left asserting the absence of something that cannot exist. And Route C's stated cost, that every task created through this API renders as `— / 12 000` until `PLAN-33` lands, is discharged, along with the recommendation that `PLAN-33` should land before `PLAN-10`, which it did. **The `actual_minutes` sections of this spec are untouched by any of that**, and their guards stay, because that column is live and its never-derived rule is the one most likely to be undone by a helpful implementer.

`words_done` is scheduled for removal in `PLAN-33`, and the question is whether a write API should expose a writer for a column that is about to be dropped. It was settled by checking the schema first, then weighing three routes.

**The schema check, which decides what is even possible.** `wordsDone: integer('words_done')` is **nullable with no default**. So a create that never mentions it inserts `NULL` and the write succeeds. Omitting a writer is possible with no schema change, which means this was a real choice rather than one the table made for us.

**Route A, expose a client writer.** Rejected. It asks the user for a number they already typed as `project_word_count`, and the owner's decision is explicit that for an ordinary single-day task the two are the same figure and the app should set it rather than ask twice. It also puts the column into the public request contract, so `PLAN-33` becomes a breaking API change for `PLAN-10` and `PLAN-11` rather than an internal cleanup.

**Route B, no client writer and the server mirrors `project_word_count` into `words_done`.** Rejected, and it is the tempting one, because [the words decision](overview.md#words-are-a-total-not-a-progress-pair-deferred-to-a-later-feature) contains a line that reads as an instruction to do exactly this: for an ordinary single-day task `words_done` is the total, "and the app should set it rather than ask twice for the same number". It would ask the user for nothing and would keep a numerator populated. It fails on two counts.

It is the same defect as auto-filling `actual_minutes`, applied to a different column. Both store a value the app assumed into a column that is supposed to hold a value the user supplied, and afterwards nothing can tell the two apart. The section above rejects that for durations. Accepting it for words two sections later would be the same mistake with a different name.

And it is actively wrong on screen, which is what settles it. [`TaskRow.vue`](../../../app/components/planning/TaskRow.vue) prints `words done / project total`, so a brand-new task carrying a 12 000-word project would render `12 000 / 12 000`, a task that reads as finished before it has been started. The row's own comment says it was built to avoid exactly this, that a null `wordsDone` prints an em dash "rather than `0`, so a planned task is never misread as a recorded zero". Mirroring makes every planned task misread in the other direction, which is worse than the reading the component was designed to prevent.

**Route C, chosen. No writer at all. `words_done` is never written by this API and stays `NULL` on every row it creates.**

The argument for mirroring rests on `words_done` being the live quota numerator, and it is not. **Nothing reads it for a statistic.** A search across `app/`, `shared/`, `server/`, and `test/` returns five occurrences: the column in `schema.ts`, the passthrough in the list select, two type declarations, and the display in `TaskRow.vue`. There is no quota engine, because `PLAN-22` is not built. So there is no numerator to keep correct, and the window in which one might exist is empty by the roadmap's own ordering, since `PLAN-33` deletes the column at position 2 and `PLAN-22` arrives at position 4.

The target model does not want the column either. `PLAN-33` settles that work spanning several days becomes several rows, each carrying the words actually done that day as its own total, so the numerator sums row totals from `project_word_count` and `words_done` has no successor role. Writing to it now would be populating a column on its way out, against a model that has already replaced it.

Not writing it also honours the owner's reason for killing the field, which is a reliability argument rather than a simplicity one: "sinon on n'aura jamais des stats fiables. l'utilisateur ne perdra pas son temps à entrer chaque tâche manuellement." A figure the user will not reliably fill produces worse statistics than no figure. Neither asking for it nor faking it satisfies that.

**The cost of Route C, stated plainly, because it is real.** Until `PLAN-33` lands, every task created through this API renders as `— / 12 000` in the words column. That em dash is the `-- /` the owner asked to have removed. `PLAN-09` ships no UI so nothing is visible from this feature alone, and the artefact first appears when `PLAN-10` lets a user create a task through the interface. [The overview](overview.md#what-to-pick-up-next) already recommends slotting `PLAN-33` in early and calls it "a recommendation rather than a dependency". This finding sharpens it for one step: **`PLAN-33` should land before `PLAN-10`, or `PLAN-10` ships a known-rejected artefact on every row the user creates.** It remains no dependency of `PLAN-09`.

**`AC29` through `AC31` are retired, not current contract.** They were met when they were written and they went with the column on 2026-07-30, so nothing below this line describes a check that exists or a query that can run. `SELECT words_done` fails outright now. They are kept as the record of what was guaranteed while the column lived, and the guard that replaced all three is a repo-wide assertion that no source file mentions the field, in [row-simplification-words-total.md](row-simplification-words-total.md).

- **AC29, retired.** `wordsDone` in a request body is a 422 on both endpoints.
- **AC30, retired.** No code path in `create.ts` or `update.ts` writes `words_done`. A create with `projectWordCount: 12000` stores `12000` in `project_word_count` and leaves `words_done` `NULL`. A grep for `wordsDone` under `server/api/tasks/handlers/` returns only the list handler's existing passthrough.
- **AC31, retired.** The regression this protects against is the mirror, so the test asserts `SELECT words_done` is `NULL` on a row created with a project word count, and carries a comment naming this decision. A later implementer reading the "the app should set it" line in `overview.md` should hit this test before they ship the mirror.

### The `PLAN-32a` finding goes stale the moment this ships

`PLAN-32a` recorded that no user task history has ever existed, and it verified that on the grounds that no write path existed. The finding was correct when it was written, and it was correct only because of this feature's absence.

**This feature is what makes it false.** From the moment these endpoints ship, the `tasks` table accumulates rows the user created, so any later statement about `tasks` containing only seed data is wrong, and any change reasoning from it is reasoning from a fact this feature invalidated.

Two consequences to carry forward.

- **`PLAN-33` must re-check for real user rows rather than reuse the `PLAN-32a` finding.** Its `words_done` drop is a migration against a table with real data in it, not against a seed-only table. The check is a count of rows the seed did not write, run against the target database rather than inferred from any document, and it has to be run against production rather than against a fresh dev database, since a dev database can be seed-only while production is not.
- **The same warning applies to any later migration touching `tasks`**, including `PLAN-32b` if it reaches the table, and the `project_word_count` rename that `PLAN-33` is asked to decide on. The general rule is that "no user history exists" was a finding with an expiry date, and shipping this feature is the expiry.

**Where the warning is written.** In this spec, in [`overview.md`](overview.md), and in [`nine-task-categories.md`](nine-task-categories.md). Three places rather than one, because three different readers arrive by three different routes and only one of them opens the `PLAN-09` spec. Someone planning the next feature reads the overview entry. Someone checking whether the no-history claim can be trusted opens `nine-task-categories.md`, because that is where the finding actually lives, in about sixty lines of evidence that the overview only summarises in a sentence. Annotating the summary and leaving the evidence reading as current would be the worse of the two half-measures, since the evidence is the more convincing document and it is the one that would be cited.

The `nine-task-categories.md` edit is a small one and it is the highest-value of the three. Its `AC3` already carries a paragraph headed "What would change this", which says that once `PLAN-09` ships real rows can carry `revision` and the same change stops being simple. That paragraph is correct and it is written in the future conditional, so a reader who finds it after this ships reads a condition that has already fired as though it were still pending. Turning that one paragraph from "what would change this" into "this has now changed, as of `PLAN-09`" is the whole job.

This documentation work is in scope for this feature rather than deferred to `PLAN-33`, on the judgement that a warning written only where it is not read has not been written, and that the finding expires **because of** this feature. A note added later would be written by someone who had already hit the problem it exists to prevent. All three are docs changes and not schema changes, so no constraint is broken.

- **AC32.** `overview.md`'s `PLAN-33` entry carries a note saying the `PLAN-32a` no-history finding expired when `PLAN-09` shipped, that the column drop is now a migration against real user rows, and that the row check must be re-run against production rather than inherited.
- **AC33.** `overview.md`'s `PLAN-32a` entry, which summarises the finding and already says a later feature has to re-check, is annotated to say the expiry has now occurred rather than being a future condition. The `PLAN-09` entry is annotated too, noting that its `AC1` status code is superseded by this spec's 404 decision.
- **AC34.** `nine-task-categories.md`'s `AC3`, which is where the finding is recorded in full, is annotated at its "What would change this" paragraph so it reads as expired rather than as pending. A reader who lands on the evidence sees that it no longer holds without having to cross-reference another document.

### Delete is a hard delete

The row is removed with `DELETE`. There is no soft delete.

**The structural reason comes first, because it is decisive.** There is no `deleted_at` column on `tasks`, and adding one is a schema change this feature may not make. So soft delete was not available, and the honest framing is that the constraint chose before the argument did.

**It also wins on merit, which is worth recording so nobody reopens it.** A soft delete would silently change every existing read path, because `listTasks` has no `WHERE deleted_at IS NULL` and would start returning deleted rows until it got one, which is a larger and riskier change than the feature it serves. And the recovery the convention asks for does not need the column: a task row is small and entirely client-known at the moment of deletion, so an undo is a re-create from the row the client already holds. That undo affordance belongs to `PLAN-13`, and this spec recommends it carry either a confirmation or an undo rather than deleting silently on one click.

**One property of that recovery to state plainly.** Re-creating produces a **new** `id`, so an undo is a re-create and not a restore. For a personal task row that is acceptable, since nothing references a task by id except the row itself, and `split_group_id` is the only cross-row link and is not writable here. It stops being acceptable once something else points at a task, and `PLAN-34`'s running-timer task id would be the first example, so `PLAN-34` should check this assumption rather than inherit it.

**Split siblings are untouched.** Deleting one slice of a split group deletes that row only. The other slices keep their `split_group_id` unchanged, including when exactly one slice is left. That is not an orphan needing cleanup: the schema comment already defines it, reading "a group of one (an interrupted split) is a valid state", so the interrupted case is a defined state rather than a dead end and there is nothing to recover from. Any richer behaviour, such as offering to reabsorb a remaining slice, is `PLAN-18`'s to design. Note also that since `splitGroupId` is not writable here, no task this API creates can be in a group at all, so during this window only seeded rows are affected.

- **AC35.** `DELETE` removes the row. A subsequent list over a range containing its date does not return it, and it does not come back after a reload.
- **AC36.** Deleting one row of a `split_group_id` group leaves the sibling rows present and their `split_group_id` unchanged, including when one sibling remains.
- **AC37.** No `deleted_at` column is added and no migration is written. The feature applies cleanly to the schema as it stands.

### Idempotency and the not-found case

`DELETE` on an id that is already gone returns 404. So does `PATCH` on a nonexistent id, and so does either on another user's id, per the ownership rule.

The alternative for `DELETE` was a uniform 204, which is the more idempotent-looking answer. It was rejected because it interacts badly with the ownership decision: to avoid leaking existence, a 204 for a nonexistent id would also have to be a 204 for another user's id, and then `DELETE` always succeeds and the client can never learn that anything went wrong. Returning 404 keeps the endpoint honest while leaving it idempotent in effect, since the row is gone either way and a repeated call changes nothing.

**The client rule that makes this safe**, and a handoff to `PLAN-13`: a 404 on delete means the row is already gone, which is the outcome the user asked for, so the client treats it as success plus a refresh rather than as an error. Showing a failure for a row that is correctly absent would be the dead end.

- **AC38.** A second `DELETE` of the same id returns 404 and changes nothing.
- **AC39.** `PATCH` on a nonexistent id returns 404 and writes nothing. No row is created as a side effect, so `PATCH` never behaves as an upsert.

### Response shape, shared with the list handler

All three endpoints return JSON. `POST` returns 201 with the created row and `PATCH` returns 200 with the updated row, both as a **`TaskListItem`, the exact shape `listTasks` returns**, derived `statusKey` and `trackable` included.

The client can therefore splice the response straight into the list it already holds, with no second request and no derivation of its own, which is the "logic belongs to the backend" rule at the response boundary. Returning the raw inserted row instead would hand the client a `status` string plus the rules for interpreting it, and `PLAN-11` would end up recomputing `statusKey` and `trackable` in the component, which is the duplicated rule the conventions specifically forbid.

Producing that shape means resolving the same things `listTasks` does, including the overdue comparison, which needs the user's timezone and the current instant in it. **Two copies of that would drift**, so the projection is extracted rather than reimplemented: the select column list, the overdue SQL expression, and the row-to-`TaskListItem` mapper move into one server-side module that `list.ts`, `create.ts`, and `update.ts` all use. `list.ts` is refactored to consume it and its behaviour does not change.

`DELETE` returns 200 with `{ id }`, matching the house habit of a small result object over a bare 204, visible in `deactivate.ts` returning `{ result, hadAccount }`. The id confirms which row went, which a client reconciling an optimistic removal can use.

- **AC40.** `POST` returns 201 and `PATCH` returns 200, each with a body matching `TaskListItem` field for field, including `statusKey` and `trackable`.
- **AC41.** The overdue expression and the row mapper exist in exactly one place and are used by all three of `list.ts`, `create.ts`, and `update.ts`. A search for the overdue `CASE WHEN` returns one occurrence under `server/`.
- **AC42.** The extraction is behaviour-preserving for `listTasks`, which returns exactly what it returned before. **There is no existing test to lean on**, since `test/server/api/` today covers only the cron purge and the `me` handlers and nothing under `tasks/`, so this cannot be verified by a suite passing unchanged. The unit-test stage therefore covers the extracted projection module directly, including the overdue comparison at its boundaries and the `statusKey` and `trackable` resolution, which is coverage `list.ts` never had and which all three callers then inherit.
- **AC43.** A task created with a delivery date already in the past and a status of `Accepté` comes back from `POST` with `statusKey` of `retard`, resolved server-side, so the client is handed the verdict rather than the inputs.

### What grows in `shared/`, and what does not

**The request schemas do not go in `shared/`.** The house puts them in `server/models/`, which is where `TaskListQuerySchema`, `DeactivateSchema`, and `WorkSettingsPatchSchema` all live. So `TaskCreateSchema`, `TaskUpdateSchema`, and the id-param schema join `TaskListQuerySchema` in [`server/models/tasks.ts`](../../../server/models/tasks.ts), reusing the `isValidCalendarDay` already there and adding an `HH:MM` validator beside it. This is right on the merits too, since a request schema is a server boundary concern and the client has no business parsing one.

**One thing does grow, and it is the status vocabulary.** The three stored statuses are currently written out in **three** places in executable code, the switch in `statusKey`, the `DONE_STATUS` constant in `list.ts`, and `STATUS_BY_PHASE` in [`scripts/seed.ts`](../../../scripts/seed.ts), and this feature needs them a fourth time for validation. Four copies of a domain vocabulary drift, and the seed's copy is the dangerous one rather than an incidental third, because the seed is the only one of the three that **writes these values into the database**. A seed that drifts from the contract produces rows whose status `DONE_STATUS` can never match, and those rows then read as late forever with nothing to explain why. So `shared/planning.ts` gains one export, an ordered readonly tuple of the three values, and `statusKey`, `DONE_STATUS`, the seed, and the write schema all read it.

It goes in `shared/` rather than `server/` because both sides genuinely need it, which is the convention's one acceptable form of sharing. The client needs it for `PLAN-14`'s cycle, and the tuple is ordered so that its order **is** the cycle order, `Accepté` then `En cours` then `Terminé`, which means `PLAN-14` reads the sequence from the contract instead of hardcoding it a fourth time.

**The i18n status strings are a different vocabulary and must not be reused for this.** `i18n/locales/fr.json` holds a `planning.status` object whose French values are `Accepté`, `En cours` and `Terminé`, and it is tempting to treat that as the existing source. It is not. Those entries are keyed by `StatusKey`, the derived presentation key, so they are `accepte`, `encours`, `termine`, plus `retard` and `na`, which have no stored counterpart at all. That mismatch is the proof the two vocabularies are independent: one is what the row prints and it is translated, the other is what the column holds and it never is. The English locale makes this obvious, since its values are English while the stored values stay French. Validating a write against the locale file would break the moment a display string is reworded and would make the server depend on i18n, so the write schema reads the shared tuple and nothing else.

- **AC44.** `shared/planning.ts` exports the ordered status tuple, and `statusKey`'s switch, `list.ts`'s done-status comparison, `scripts/seed.ts`'s `STATUS_BY_PHASE`, and the write schema's enum all derive from it. No executable literal `'Accepté'`, `'En cours'`, or `'Terminé'` remains in `app/`, `server/`, `shared/`, or `scripts/`. The seed is inside the scope on purpose, because it is the copy that writes stored values, so leaving it out would exempt the only one that can put an unmatchable status in the database. Three things are deliberately exempt and must not be "fixed": prose inside comments, the `planning.status` values in the locale files, which are display copy keyed by `StatusKey` as described above, and test fixtures, which should keep asserting against the literal strings because a test that reads the same constant as the code under test proves nothing about the value.
- **AC45.** The write path does not import from `i18n/`. The stored status vocabulary and the displayed status copy stay independent, so renaming a French display string changes no stored data and fails no validation.
- **AC46.** The write schemas live in `server/models/tasks.ts` and no new module is added under `shared/` beyond the export above.

### User-facing copy

**This API returns no user-facing copy, so the French-first copy rules do not apply to its responses.** Zod messages are developer-facing English, matching the shipped `TaskListQuerySchema` messages such as "Must be a real calendar day in the YYYY-MM-DD format.", and `createError` uses machine codes rather than prose, matching `cannot_deactivate_self`. Everything the user reads is rendered by the client from i18n keys, and that copy belongs to `PLAN-10`, `PLAN-11`, and `PLAN-13`.

The one French thing this feature handles is **data rather than copy**: the three stored status values are French domain values and are stored with their exact accents. They are not normalized, not de-accented, and not translated, because they are the values every other reader compares against.

- **AC47.** No response from these endpoints contains a string intended for direct display to the user. A client rendering an error renders its own i18n copy, keyed off the status code and the field names in `data`.

### Three questions this feature closes in `tasks-schema.md`

[`tasks-schema.md`](tasks-schema.md) ends with four open questions, and three of them name `PLAN-09` as the feature that resolves them. It wrote them that way on purpose, because the table was deliberately left permissive so the meaning would be enforced at the write boundary instead of in the columns. This is that boundary, so those three stop being open here.

- **Its question 1, the status vocabulary.** Answered by [status is validated against the category](#status-is-validated-against-the-category-on-the-resulting-row). The stored set is the three French values plus `NULL`, `N/A` is a display value and is refused as a stored one, and the enum reads the shared tuple.
- **Its question 2, the mandatory-field list.** Answered by [the writable field contract](#the-writable-field-contract). It is `date` and `category`, and nothing else.
- **Its question 3, keeping `updated_at` fresh.** Answered by `AC15`. The write API sets it explicitly on every mutation rather than the table adding a Drizzle `$onUpdate`, which is the default that question already expected and which keeps `tasks` matching the `users` pattern it was built to match.

Its question 4, the `drizzle-kit generate` meta baseline, is untouched, because this feature writes no migration.

- **AC48.** Those three questions are marked resolved in `tasks-schema.md` with a pointer to this spec, rather than left reading as open. A reader who opens the schema spec looking for the required-field set finds the answer or a link to it, and does not conclude the decision is still to be made.

## Edge cases

### Interrupted and abandoned paths

**No server-side draft exists.** A task comes into being on a single `POST` and not before, so a user who opens `PLAN-10`'s add form and walks away leaves nothing behind. This is what makes `PLAN-13`'s `AC2`, "empty placeholder rows are never persisted", true by construction rather than by cleanup, and it is why there is no half-created state to recover from.

**The session expires mid-edit.** The `PATCH` returns 401 and the row is untouched. The recovery constraint this places on `PLAN-11` is that a 401 must not discard the form: the user's typed values are the only copy of that work, so the editor keeps them, sends the user through re-authentication, and re-submits or lets them re-save. Discarding the form on a 401 would destroy work in response to an entirely recoverable condition, which is the dead end the convention forbids.

**A second tab already deleted the row.** The `PATCH` returns 404. The client refreshes its list and tells the user the task no longer exists rather than retrying, since retrying cannot succeed and `PATCH` is not an upsert.

**A second tab is editing the same row.** Last write wins, per field. Because the body is partial, a patch carrying only `status` overwrites only `status`, so two tabs editing different fields both land. Two tabs editing the same field is genuinely last-write-wins and is not defended against, which is proportionate for a single-owner app. If it ever needs defending, the answer is an `updatedAt` precondition, and that is a later feature rather than a gap to close here.

**The request fails partway.** Each endpoint touches exactly one row with one statement, so there is no partial write to unwind and no transaction is needed. The one multi-statement path is create, which reads the day's highest `sort_order` before inserting, and a failure between the two writes nothing at all.

**The patched date leaves the loaded range.** Changing a task's `date` to a day outside the week the client is showing returns the row as written, and the client is responsible for dropping it from a view whose range no longer contains it. That is presentation, so the server does not filter its own response.

### Validation and data edge cases

**A delivery date before the task date.** Allowed. It is odd but it is not impossible, and the app records reality rather than policing it. The row will read as late, which is the correct signal.

**A delivery time with no delivery date.** Allowed and stored. The list query reads a time only when a date is present, so a stray time is inert rather than harmful, and refusing it would be the app policing a combination the user may be part way through entering.

**`2026-02-31`.** Rejected. `isValidCalendarDay` round-trips the parsed components, so a date that passes the shape check but is not a real day is a 422 rather than a value JavaScript silently rolls into March.

**A task on a non-work day, or on a day already overbooked.** Both allowed, with no warning and no refusal from the API. The signal is the client's to draw, per the product rule that the app signals and never blocks.

**A trackable category given no status.** Allowed. `NULL` is a legitimate state for a trackable task that has not been accepted yet, and `statusKey` maps it to `na`. Requiring a status on create would block `PLAN-10`'s minimal add.

**`projectWordCount` on a non-trackable task.** Allowed, and stored as given. A meeting with a word count is strange but harmless, since the quota engine filters on trackability before it reads words, and blanking it would be the app deciding what the user is allowed to record. `client` and `project` are left alone on a non-trackable row for the same reason. `status` is the one field cleared on a non-trackable row, and it is cleared because every reader already treats it as absent there, so leaving it would store a value that contradicts what the row reports. That is a different case from a value that is merely unusual.

**`quotaWphOverride` on a non-trackable task.** Allowed and stored, which is the one place this spec knowingly leaves an inert value in a column. A words-per-hour override on a category that produces no words describes nothing, and `PLAN-30`'s `AC4` sets the opposite precedent for user-created categories, that a non-trackable one "stores none rather than storing an unused number that later reads as real". It is left alone here because nothing reads a quota for a non-trackable category, so the value cannot affect a number, and because clearing it would need the same two-part treatment `status` gets rather than a one-line rule. Flagged as a small [open question](#open-questions) rather than settled quietly.

**An id that is a valid string but not a uuid.** Treated as not found, so 404. The id column is free text with a uuid default rather than a constrained type, so the write path does not assert a uuid shape it cannot rely on and simply fails the lookup.

## Open questions

None of these block the build. The first is the only one that changes a shipped contract, and it is the one worth a decision before the backend stage runs.

1. **404 instead of the 403 the roadmap names.** `PLAN-09`'s `AC1` in [`overview.md`](overview.md) says "a user can only mutate their own tasks (403 otherwise)", and this spec returns 404 for both the missing case and the not-yours case, for the reasoning under [authentication and ownership](#authentication-and-ownership). The guarantee is met either way and only the reported status differs. Confirm the departure, or say 403 and the spec follows the roadmap. This is the one place the spec knowingly contradicts its own feature entry.

2. **The three status names are still unconfirmed with the user.** `Accepté`, `En cours`, and `Terminé` are [overview open question 5](overview.md#open-questions) and this feature makes them a validation enum, so from here a rename is a data migration rather than a copy change. Hoisting them into one shared tuple is what keeps that rename to a single edit, which is why `AC43` exists, but it does not remove the need to ask. Worth confirming before the write path starts producing rows carrying them.

3. **`quotaWphOverride` is left on a non-trackable task.** `status` is cleared on such a row and the override is not, which is a small inconsistency argued under [the edge cases](#validation-and-data-edge-cases). `PLAN-30`'s `AC4` points the other way. Nothing reads it, so it changes no number today, and it becomes a real question when `PLAN-32b` makes quotas per-category.

4. **The mandatory-field set is `date` and `category`, and `PLAN-10` may want more.** This is [`tasks-schema.md`](tasks-schema.md) open question 2 and `PLAN-10`'s `AC2`. The API enforces only what the schema requires, on the principle that the write boundary should not refuse a task the database would accept, so any richer requirement is `PLAN-10`'s form validation rather than a 422 from here. Confirm that is the right division.

5. **Whether the date should be bounded at all.** This spec validates that `date` is a real calendar day and does not bound how far away it can be. The app has no task search and only week-by-week navigation, so a typo of `2206` for `2026` creates a real row the user cannot see, cannot reach, and cannot delete, which is a dead end in the sense the conventions rule out. A bound is the cheap fix and the endpoints are arbitrary, which is why it is a question rather than a criterion. `PLAN-10` could also solve it in the form, and `PLAN-24`'s history view would make the row reachable again.

Two things are settled here rather than left open, and are recorded above so a later feature revisits them deliberately: `estimatedMinutes` stays client-writable until `PLAN-12` makes it derived, and `words_done` is never written until `PLAN-33` drops the column.
