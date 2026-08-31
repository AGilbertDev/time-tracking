# Reset onboarding (admin)

## Intent

The owner wants a fast way to walk through the first-run wizard again without rebuilding an account
by hand. In their words, "I want a way to quick reset my onboarding process as admin", and on what
it should do, "it resets all my settings and calls onboarding again". Asked whether it should be
limited to development, they answered "for admins only", so this is a real product feature guarded
by the admin role rather than a development-mode shortcut, and it is built to the standard of one.

That sentence was written before the runtime switch existed, and the switch qualifies it rather than
contradicting it. The owner later said the control would be turned off once the app is finished, so
the feature gained a configuration key whose unset default does resolve through `import.meta.dev`.
The distinction that matters is unchanged. The role check is the access rule and it is never
environment-dependent, while the switch decides whether a finished product still carries a control
built for building it. Turning the switch on in production would leave a fully guarded admin
feature rather than exposing a development shortcut.

The feature adds one nullable timestamp column that records when an account finished setup, moves
the session's `onboarded` flag onto that column, and adds one admin-gated endpoint that clears the
acting admin's own configuration and that timestamp together. The password is never touched, so the
admin stays signed in, walks the wizard again, and can sign back in normally from any device if they
abandon it partway.

### Why this exists, and why it has a finite life

The stated purpose is repeatedly comparing the settings page against the onboarding wizard as both
of them grow. Every time a setting is added or reworded, the two surfaces have to be checked against
each other, and doing that by hand today means rebuilding an account. So the real user of this
control is the owner doing manual passes during development, not an administrator managing somebody's
account, and that is the only reason a destructive action sits on a settings page at all.

The owner has said it goes away once the app is finished. Whoever eventually removes it needs to know
what it was for, which is why the purpose is written down here rather than left to be inferred from a
button.

That finite life is also why the control ships behind a runtime switch rather than as a permanent
part of the settings page. If turning it off meant deleting a section, an endpoint, a composable,
several test files, and two groups of locale keys, then the off switch would be a pull request, and a
chore that size does not get done. It would leave a destructive action live in a finished product.
The switch is specified in [the runtime switch](#the-runtime-switch) and it is one configuration
value, not a feature-flag system.

Related documents are [`docs/specs/onboarding/onboarding-wizard.md`](../onboarding/onboarding-wizard.md)
for the wizard this re-enters, [`docs/specs/admin/manage-users.md`](manage-users.md) for the admin
gating pattern this reuses, [`docs/specs/settings/settings-page.md`](../settings/settings-page.md)
for the page the control is added to, and
[`docs/specs/planning/per-category-quotas.md`](../planning/per-category-quotas.md) for the quota
snapshot that makes clearing quota rows safe for past work.

## Prior art

The conventions require looking up how the industry already answers a problem before committing to a
shape, so this was researched before the document was finalised. The findings below are reported
whether or not they agree with the plan.

### How other applications separate "has a credential" from "has finished setup"

Every product examined that could be verified to source stores setup completion explicitly, and none
of them infers it from the existence of a password.

| Product | Mechanism | Scope |
| --- | --- | --- |
| GitLab | A boolean column `users.onboarding_in_progress`, plus a JSONB `user_details.onboarding_status` holding a `step_url` pointer and the answers collected so far | Per user |
| Home Assistant | A list of completed step names in `.storage/onboarding`, shaped `{"done": ["user", "core_config", "analytics", "integration"]}`, with storage migrations that backfill `done` whenever a new step is added | Per instance |
| Discourse | No flag at all. Each completed step is an append-only `UserHistory` row with `action: :wizard_step`, and `Wizard#completed?` compares the step ids against those rows | Per instance |
| Jellyfin | A plain boolean `IsStartupWizardCompleted` on the application configuration, serialised to `system.xml` | Per instance |
| Gitea | `INSTALL_LOCK` in `app.ini`, which closes the installation page once true | Per instance |
| Sentry | One `OrganizationOnboardingTask` row per task, unique on organization and task, each carrying a status and a `date_completed` | Per organization |
| Metabase | `has-user-setup` is derived rather than stored, by querying whether any real user row exists | Per instance |

Metabase is the exception, and it is the one that proves the point. Because its setup state is
derived from "does a user exist", there is no supported way to re-run setup, and the community answer
to the request is to wipe the application database. That is the same coupling this feature exists to
remove, one step further along.

Mastodon's `finished_onboarding` could not be confirmed in the user model or the settings schema, so
it is reported as unverified rather than cited. Nextcloud, Grafana, WordPress, Keycloak, Supabase,
and Firebase could not be verified to source level in the time available.

### Whether a re-run is offered, and what it does

Discourse is the closest match to what the owner asked for and it is the strongest evidence for the
shape here. Its `/wizard` is permanently reachable by an admin and is documented as a normal
maintenance tool, with the guidance that it can be re-run as many times as necessary without
restrictions. The admin stays signed in throughout, and because completion is recorded as
append-only history rows, re-running is naturally idempotent.

Jellyfin, Gitea, and Home Assistant offer no in-app action. An operator flips the boolean in
`system.xml`, sets `INSTALL_LOCK=false`, or deletes `.storage/onboarding`, then restarts. In each
case the configuration survives and only the gate moves.

### How a settings reset is confirmed

Typed confirmation is reserved for deletion, and GitHub draws that line explicitly in its own
documentation. Deleting a repository requires typing the repository name. Changing repository
visibility sits in the same danger zone, is not a deletion, and asks only for a click plus an
acknowledgement checkbox with no typing.

Chrome's `chrome://settings/reset` is the canonical settings-reset dialog. It lists the consequences,
offers a single Reset settings button, and explicitly reassures the reader that saved bookmarks and
passwords will not be deleted or changed.

So the pattern for a settings reset is a danger-zone section with a plain modal that names both what
is cleared and what is kept. Typed confirmation would be off-convention here, and this document
specifies the plain modal.

### Whether a reset deletes rows or writes defaults back

Deleting the override rows and letting the read path fall back to coded defaults is the dominant
pattern. Discourse's `remove_override!` destroys the `site_settings` row and re-reads the default
from `site_settings.yml`, because that table holds only overrides. VS Code has the same shape, where
`settings.json` is an override layer and resetting everything is documented as deleting the entries
between the braces. Kubernetes server-side apply is the counter-example, resetting a dropped field to
its default value on write, but it has no coded read-time fallback to fall back to.

### Where this feature agrees, and where it differs

It agrees on the storage decision, which the owner had already taken independently. It agrees on
deleting rows rather than writing defaults back, which is what this project's read paths already
support. It agrees on the plain confirmation modal that names both halves.

It differs in three places and each difference is deliberate.

1. **Discourse prefills the wizard and deletes nothing. This wizard starts its identity step empty
   and this reset deletes rows.** Discourse's wizard edits live site settings, so prefilling is the
   whole point of it. This wizard is a first-run flow that collects a password, and it already starts
   its identity fields empty on every entry. Making the reset non-destructive would leave a control
   labelled "reset" that resets nothing, which is not what was asked for.
2. **GitLab and Home Assistant store a resumable position through the steps. This stores one
   timestamp.** A step pointer is storage for a resumption the wizard does not offer, because this
   wizard submits every step at once on Finish and has no partial save. A pointer would be a field
   nothing could ever read. If the wizard later grows partial saves, a `step` column beside the
   timestamp is an additive migration.
3. **The research recommends doing the reset inside one transaction. This project has no transaction
   to use.** Verified by search across the tracked files, which contain no `db.transaction` call and
   no `db.batch` call anywhere. The established practice is the purge endpoint's
   sequence of awaited deletes with the ordering argued in a comment. So the safety here comes from
   an ordering whose every partial outcome is recoverable, plus full idempotency, rather than from
   atomicity. That is set out in [Failure and recovery](#failure-and-recovery), and it is a weaker
   guarantee stated as such rather than papered over.

## The mechanism, as decided

The owner has decided the mechanism and this document records it rather than reopening it. A new
nullable `users.onboarded_at` timestamp stores when an account finished setup. Completing onboarding
sets it. The session's `onboarded` flag reads it. The reset clears it along with the settings rows,
and never touches the password.

### Why the password hash is not the reset switch

The obvious short version of this feature is to clear `password_hash`, because the session already
derives `onboarded` from it. That is rejected, and the reasoning is worth keeping because it is the
whole argument for the column.

Deriving setup state from the password hash conflates two different facts that happen to coincide
today. "This account has credentials" and "this account has finished setup" are separate questions,
and a reset needs to change the second without changing the first. Clearing the hash is not resetting
onboarding. It is deleting the account's ability to authenticate, and then hoping a recovery path
catches the fall.

That recovery path does not catch it. `server/api/magic-link/handlers/request.ts` returns neutrally
without sending unless the address is on the `allowed_emails` allowlist, and it also refuses to send
to an account that still has a password. An admin who reset themselves by clearing their own hash
would have no password to sign in with, and a magic link would only reach them if their address
happened to still be on the allowlist, which a deactivation removes. A sole admin can therefore land
outside every route back in, with no second admin able to re-invite them. That is exactly the dead
end the mandatory "No invalid states and safe recovery" convention forbids, and it is the same
failure Metabase's derived setup state produces.

The stored column removes the whole class. After a reset the admin still has a password, so they stay
signed in, they can sign in again from any device, and the only thing that changed is which page the
router sends them to.

### The three session-creation sites move together

Three places mint a session and set `onboarded`. All three move to the stored column in one change,
or none of them does. A half-moved flag means two sources of truth for the same fact, which is the
duplication the conventions forbid and which drifts silently.

| Site | Today | After |
| --- | --- | --- |
| `server/api/magic-link/handlers/verify.ts` | `onboarded: !!user.passwordHash` | `onboarded: !!user.onboardedAt` |
| `server/api/auth/handlers/login.ts` | `onboarded: true` | `onboarded: !!user.onboardedAt` |
| `server/api/onboarding/handlers/complete.ts` | `onboarded: true`, guarded by `if (existing?.passwordHash) throw 409` | `onboarded: true`, guarded by `if (existing?.onboardedAt) throw 409` |

Three notes on what actually changes behaviour, because the three sites are not equally affected.

**`verify.ts` changes no behaviour today, and moves anyway.** The redirect above it already returns
early for any account that has a password, so the session it mints is only ever minted for an account
without one, and the flag it computes is therefore always `false` under either expression. It moves
because leaving one site reading the password would keep the conflation alive in the one file where
the two rules sit next to each other, which is precisely where a later reader would collapse them.

**`login.ts` is where the real change lands.** Today the flag is the literal `true`, which is sound
only because the handler is unreachable without a verified password. After the change, an admin who
reset themselves and then signs in on another device gets `onboarded: false` and is routed to the
wizard. That is the recovery this feature depends on and it is the reason the literal cannot stay.

**`complete.ts` keeps its literal `true` and moves its guard.** The handler sets `onboarded_at` in the
same update that sets `passwordHash`, so `true` there is a statement about a column the handler just
wrote rather than an inference from the password. The substantive move is the re-entry guard. If that
guard kept reading `passwordHash`, a reset user would reach the wizard and be rejected with 409
`already_onboarded` on Finish, with the global middleware bouncing them straight back to the wizard
they cannot leave. That is a closed loop with no exit, so the guard moving is not a tidy-up, it is
what makes the feature work at all.

### The rule in `verify.ts` that stays on `password_hash`

`verify.ts` carries a second, separate rule and it must not move.

```
// A magic link cannot grant a session once the account has a password.
if (user!.passwordHash) {
  return sendRedirect(event, '/')
}
```

That rule is about credentials. It keeps a leaked or replayed magic link inert once the account can
authenticate with a password, and it must go on keying off `password_hash` after this change. The
session flag beneath it is about setup state and keys off `onboarded_at`.

Two rules, two columns, in one file, on purpose. This is the entire modelling correction the feature
makes, and collapsing them back onto one column would either make a magic link live again for an
account that has a password, which is a security regression, or make a reset account unable to reach
the wizard, which is the dead end above. **No later stage may unify them, and a review comment asking
why one file tests two different columns for what looks like the same thing is answered here.**

`request.ts` also refuses to send a link to an account with a password, and it stays on
`password_hash` for the same reason. A reset account keeps its password, so it is correctly still
outside the magic-link path.

### What does not move

`server/utils/manage-users.ts` derives the admin list's Invited, Active, and Deactivated statuses,
and its middle branch reads `password_hash`. **It stays exactly as it is.** That derivation answers
"does this person have a usable account", not "has this person finished setup", and a reset account
is genuinely still active because it can still sign in. A reset admin correctly continues to show as
Active in the users table. A later stage moving it would change what the admin list means for no
reason this feature gives.

`app/middleware/auth.global.ts` needs no change of its own. It reads the session flag, forces a
logged-in user with `!user.onboarded` onto the onboarding page, and bounces an onboarded user away
from it. Changing where that flag comes from touches every authenticated route in the app, which the
owner has named as the risky part of this feature, so it is covered by tests rather than trusted. See
AC12 through AC15.

## The runtime switch

The control and the endpoint are both gated on one configuration value, so the feature can be turned
off without a code change when the app is finished.

### The configuration entry

One new key in the existing `runtimeConfig` block in `nuxt.config.ts`, in the private section
alongside `cronSecret` and `avatarStorageDriver`. There is no `public` section in this project's
config today and this does not add one.

```
onboardingResetEnabled: ''
```

The default is an empty string rather than a boolean, and the resolution lives in
`server/utils/onboardingReset.ts`, which returns true for `'true'`, false for `'false'`, and otherwise
falls back to `import.meta.dev`. This follows the `avatarStorageDriver` entry beside it, where an
empty default means decide by environment. It was specced as a boolean `process.env.NODE_ENV` check
first and changed during the build, because an explicit parse is written down where it can be read
and tested rather than depending on Nuxt coercing an environment string by the default's type, and
because `import.meta.dev` is true only under `nuxt dev` where `NODE_ENV !== 'production'` is also
true under `NODE_ENV=test` and when the variable is unset. The shipped form is the more fail-closed
of the two.

It is private rather than public because a private key is readable by the server, which is where the
decision has to be made. The client is told the resolved answer through an existing payload, as set
out below, rather than reading the flag itself.

The default is evaluated at build time, so a production build bakes `false` and `nuxt dev` bakes
`true`. That is the requested default of enabled in development and disabled in production. The name
matches the camelCase of every existing key, so Nuxt's documented environment override is
`NUXT_ONBOARDING_RESET_ENABLED`, and because the default is a boolean, Nuxt coerces the environment
string to a boolean rather than leaving the truthy string `"false"` behind.

Reading `process.env` for a default in this file is the pattern already used one entry above, where
`blobReadWriteToken` defaults to `process.env.BLOB_READ_WRITE_TOKEN || ''`, and the idea of a default
that decides by environment is the one `avatarStorageDriver` already documents. Nothing is invented
here.

**Turning it on in production is an environment change, not a deploy of different code.** Setting
`NUXT_ONBOARDING_RESET_ENABLED=true` in the hosting environment enables it, and removing that
variable returns it to the baked default of off. Locally the same variable in `.env` turns it off
while `nuxt dev` is running. Both directions are configuration.

### How the client learns the resolved answer

`GET /api/me` gains one derived boolean field.

```
canResetOnboarding: boolean
```

The server computes it as "the caller's role is exactly `admin` **and** the flag is on", so the
client receives one finished answer and renders on a single condition rather than combining two facts
of its own. That is the logic-belongs-to-the-backend rule applied to a switch, and the conventions
explicitly allow a derived field on an API response that no column backs.

**Why `GET /api/me` rather than a new endpoint.** The conventions say to carry a derived field on an
existing payload rather than to add a route for one boolean. `/api/me` is already documented as the
fresh authoritative read, it already returns `role`, it already sets `Cache-Control: no-store`, and
the client already runs it through `app/composables/useMeQuery.ts` with `staleTime: 0`, so a flipped
flag reaches the interface on that query's next fetch.

**Why not the session user object, and what that would have cost.** The session is a sealed cookie
written at sign-in, so a flag flipped afterwards would not reach an admin who is already signed in
until their session was renewed. A runtime switch that needs a sign-out to take effect is not a
runtime switch, and this is the same staleness that `useMeQuery` was introduced to work around for
the avatar. So the session user object gains nothing, and this feature does not add a field to it.

**One consequence for the first paint, so the frontend stage handles it deliberately.** `useMeQuery`
seeds its `initialData` from the session user, which does not carry this field, so
`canResetOnboarding` is absent until the authoritative fetch resolves. The field is therefore
optional on the client-side `MeUser` contract and an absent value reads as false. The section does
not render on the first paint and appears once `/api/me` answers. That direction is correct, because
a control that must not appear when the flag is off should be hidden while the answer is unknown
rather than shown and then withdrawn.

### The endpoint gate is the real one

Hiding the section is presentation. When the flag is off, `POST /api/admin/onboarding/reset` refuses
every request **with the same 403 `forbidden` it already returns for a non-admin**, including a
request from a genuine admin, and it writes nothing.

Reusing the existing shape rather than adding a new error code is deliberate. From outside, a feature
that is switched off and a caller who is not allowed to use it are the same answer, which is that this
caller may not do this. A distinct code would tell an unauthenticated prober that the route exists and
is merely disabled, and it would give the client a second failure branch to render for a state the
user can do nothing about.

### What this switch is not

**It is not a feature-flag system and nothing here builds toward one.** There is no flags table, no
flag registry, no per-user targeting, no admin screen for toggling anything, and no second feature
gated on anything. It is one boolean in the configuration file, read in two places, for one control
whose life is known to be finite. If a real flag system is ever wanted, it is its own feature with its
own spec, and it would replace this one line rather than extend it.

## Schema and migrations

### The Drizzle column

`server/db/schema.ts`, on the `users` table.

```
onboardedAt: integer('onboarded_at', { mode: 'timestamp' })
```

Nullable, Unix seconds through `mode: 'timestamp'`, matching `createdAt`, `updatedAt`, and
`deactivatedAt` on the same table.

**No `$defaultFn` and no database-level default, deliberately.** `verify.ts` inserts a bare `users`
row for a brand-new invitee, so any insert default would mark that account as onboarded at the moment
it was created, before the wizard had run. Null is the correct state for a new row and the column is
written only by the handler that completes onboarding.

### Two migration files, 0012 and 0013

`server/db/migrations/0012_add_users_onboarded_at.sql`

```sql
ALTER TABLE `users` ADD `onboarded_at` integer;
```

`server/db/migrations/0013_backfill_users_onboarded_at.sql`

```sql
UPDATE `users`
SET `onboarded_at` = COALESCE(`created_at`, unixepoch())
WHERE `password_hash` IS NOT NULL AND `onboarded_at` IS NULL;
```

Both are hand-authored plain SQL with a long comment header, matching how 0000 through 0011 are
maintained, because the repository keeps no drizzle-kit meta snapshot directory. Both headers carry
the project's standing notes, which are that the file must not be auto-run against production, that
there is one real user and the owner applies these by hand against the production Turso database, and
that the file must never be renumbered, renamed, or edited once it has been applied anywhere, because
the runner's `_applied_migrations` ledger is keyed on the filename with no checksum.

### Why two files rather than one

The runner in `scripts/apply-migrations.ts` records a file in its ledger only after every statement in
that file has succeeded, and it tolerates no error at all. One file holding both statements could
therefore add the column, fail on the backfill, and leave the file unrecorded. The next run would then
die immediately on the `ADD COLUMN` with a duplicate column error, and the only way forward would be
hand-editing SQL that had already partly run, which the 0010 header calls out by name as the thing to
avoid.

Split, the failure is resumable. 0012 records on its own, and 0013 is written so it can be re-run
freely.

### Idempotency, stated against the runner that actually exists

SQLite supports no `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN`, so 0012 carries no statement-level
guard. Its idempotency comes entirely from the runner's ledger, which is the same arrangement 0007,
0008, and 0011 rely on. Re-running 0012 against a database that already has the column would fail
with `duplicate column name`, and the ledger is what prevents that from ever being attempted.

**The header of 0012 must not repeat the wording used in 0006**, which says the statement "is applied
through a runner that tolerates the benign duplicate column name error and continues, which makes a
re-run safe". The runner does not do that. It throws on any error and does not record the file. That
sentence describes a runner this project does not have, and copying it into a new file would carry a
false claim forward.

0013 is genuinely idempotent at the statement level. Its `WHERE password_hash IS NOT NULL AND
onboarded_at IS NULL` clause means a second run matches no rows, and it also means the backfill can
never overwrite a real completion timestamp or undo a deliberate reset that happened after it. SQLite
runs a single `UPDATE` as one implicit transaction, so it either fully applies or does not apply at
all.

### The backfill value and what it means

The value written is `COALESCE(users.created_at, unixepoch())`.

**Why a backfill is not optional.** Every account that already has a password has completed
onboarding. Leaving `onboarded_at` null for them would mint `onboarded: false` on their next session,
the global middleware would force them onto the wizard, and the re-entry guard now reads a null
`onboarded_at` so it would accept the submission and overwrite their name, their password, and their
settings row. Every existing user would be silently re-onboarded on deploy. That is a live incident,
not a rough edge.

**Why `created_at` rather than the migration instant.** A `users` row in this app is created when a
magic link is verified, and onboarding follows in the same sitting, usually within minutes. So
`created_at` is the closest true instant available, and it preserves the invariant that an account
never reads as having finished setup before it existed. The migration instant is further from the
truth by however long the account has been in use.

**Why `COALESCE` rather than `created_at` alone.** `users.created_at` is nullable in the schema, so
`created_at` alone would leave a null `onboarded_at` on any row that lacks one, which is the exact
failure the backfill exists to prevent. `unixepoch()` returns Unix seconds, matching the column's
`mode: 'timestamp'`, and it is the honest fallback because it says the migration moment rather than
inventing a plausible earlier one.

**What the value means.** It means this account had a password before the migration ran, and was
therefore already through setup. **What it does not mean** is that setup finished at that instant. It
is a reconstruction, not a record. No shipped or specced feature reads the instant, because the only
consumer is the null check, so the imprecision costs nothing today. Any later feature that needs a
real completion time must treat a value at or before the migration as a reconstruction.

**What the backfill deliberately leaves alone.** Rows with a null `password_hash` stay null. Those
accounts accepted a magic link and never onboarded, they are genuinely not through setup, and the old
build agreed with that because `!!passwordHash` was false for them. So after 0013, for every row that
existed before this feature, `!!onboarded_at` equals `!!password_hash`. That equality is the property
that makes the deploy invisible, and it is AC5.

### Expand then contract, and the ordering

There is nothing to contract here. The change is purely additive, no column is dropped, and no
existing column changes meaning. What still needs stating is the order, because the new build reads a
column the old database does not have.

The correct order is three steps.

1. Apply 0012 and 0013. They run in one pass in filename order, so a single
   `bun run apply-migrations --yes` gives the right sequence. The build that is live never names
   `onboarded_at`, so nothing changes for it.
2. Deploy the new build. It reads a populated column.
3. There is no third step. The old build can be redeployed at any time without touching the database,
   because it never names the column.

Two orders are forbidden and both must be named in the headers.

**Deploying the new build before 0012 is applied.** Every session-creation site and the onboarding
re-entry guard select `onboarded_at`, so the query throws `no such column`. Magic-link verification,
password sign-in, and onboarding completion all fail at once. That is a total authentication outage
and it is the worst outcome available here.

**Applying 0012 without 0013 and then deploying.** This is the silent re-onboarding described above.
It is worse than the outage because nothing errors, so nobody finds out until a profile has been
overwritten.

**This is the opposite instruction to 0010 and 0011, and a reader must not generalise from them.**
Those two are deliberately split across the deploy, because one is an expand and the other is a
destructive contract. 0012 and 0013 are two halves of one additive change and they must land together,
before the deploy, in the same pass.

**Undo.** 0013 has nothing to undo, because the column it fills disappears with 0012's undo and the
old build never reads it. 0012 undoes with `ALTER TABLE users DROP COLUMN onboarded_at;`, which SQLite
permits because the column is not a primary key, not unique, not indexed, and not referenced by a
constraint or a generated column. The contents are lost, which costs only the reconstruction, since
the old build re-derives the same answer from the password. In practice a rollback of the build alone
is enough and the column can simply stay.

### What can and cannot be verified here

There are no database credentials in this environment, so nothing in this feature can be applied or
loaded against real data, and this must be said plainly rather than implied.

**Verifiable in the pipeline.** Every handler and helper behaviour, against the real in-memory libSQL
harness in `test/helpers/taskTestDb.ts`, which inserts fixtures with raw SQL and reads assertions back
with raw SQL. That covers the reset handler's writes, the three session-creation sites' flag, the
re-entry guard, the idempotency of a second reset, and the tables that must be left untouched. The
harness's inline `users` DDL needs `onboarded_at integer` added so it matches the migrated shape.

The runtime switch is verifiable here too, and it needs no database. `onboardingResetEnabled` is read
through `useRuntimeConfig()`, which a test stubs directly, so both halves of AC26 are ordinary unit
tests. The handler is called once with the flag on and once with it off, and the section's render
condition is exercised against a `canResetOnboarding` that is true, false, and absent.

**Not verifiable in the pipeline.** That 0012 and 0013 apply cleanly against the production Turso
database, how many production `users` rows have a null `created_at`, and what timestamps the backfill
actually writes. Those are the owner's manual apply step. The pull request should record the row count
the backfill reported, so the reconstruction is a recorded fact rather than an assumption.

Also not verifiable here, that the production deploy actually bakes the flag off. The default resolves through
`import.meta.dev`, which Nuxt substitutes as a literal at build time, and this environment runs no
production build, so the first deploy should be checked by confirming the section does not render for
the admin on the live site before any `NUXT_ONBOARDING_RESET_ENABLED` variable is set.

## Inputs

- **Session user**, read, authenticated admin. The endpoint reads the session `user.id` and nothing
  else. There is no target parameter.
- **A single user-initiated action**, the Reset control on the settings page, followed by a
  confirmation in a modal.
- **No request body.** See [API contract](#api-contract) for why.
- **No query parameters.**

## What the reset clears, grouped by kind

The enumeration is grouped by work parameter against account setting. That grouping is a deliverable
in its own right, because a separate feature that splits work parameters out of user settings is
being specced independently and will read this list. It is recorded here and nothing else in this
feature acts on it. The enumeration is made against the settings as they exist today, and this feature
moves, renames, and regroups nothing.

### Work parameters

| Candidate | In or out | Reason |
| --- | --- | --- |
| `settings.daily_work_minutes` | **In**, via the row delete | Collected by the wizard's work step and rewritten by it on Finish. `loadWorkSettings` falls back to a coded 450 when no row exists, so zero rows is a working state. |
| `settings.work_days` | **In**, via the row delete | Same. `loadWorkSettings` falls back to `[1,2,3,4,5]`. |
| `settings.timezone` | **In**, via the row delete | Same. `loadWorkSettings` falls back to `America/Toronto`. |
| `category_quotas` rows | **In** | A quota is explicitly a user setting per the per-category-quotas spec, and a fresh account has zero rows. With no rows `resolveCategoryQuota` falls back to the shipped `defaultQuotaWph` figures in `shared/categories.ts`, so zero rows is a working state rather than an empty one. |
| `work_schedule` rows | **Out** | Argued below. |

**Why `work_schedule` is out**, since it is a work parameter and the mandate is to reason it out
rather than assume either way.

Verified by search across the tracked files rather than assumed. Nothing in the application writes
this table. `scripts/seed.ts` is the only inserter, `server/utils/loadWorkSchedule.ts` is the only
reader, and `server/api/cron/purge-deactivated.get.ts` deletes it as part of erasure. There is no API
route and no page that creates a row.

That single fact decides it. A reset must leave the user able to get back to a configured state
through the application, and every other item on the In list can be rewritten, by the wizard for the
settings row and by the settings page's Quotas section for the quota rows. `work_schedule` cannot be
rewritten by anything the user can reach. Deleting it would destroy data with no path to restore it
short of running the development seed against production, which is not a recovery.

The second reason stands on its own. `work_schedule` is effective-dated history rather than a live
setting, and it feeds the quota denominator for past periods. Clearing it would restate periods that
have already been reported, which the project holds as a standing position in AC2 of the per-category
quotas spec. An explicit destructive reset is genuinely not the same thing as an edit, so that
position does not automatically settle the question, but combined with the unrecoverability it does.

Out, then, and named here so nobody reads it as forgotten.

### Account and appearance settings

| Candidate | In or out | Reason |
| --- | --- | --- |
| `settings.light_theme` | **In**, via the row delete | Collected by the wizard's appearance step and rewritten on Finish. `loadUserPreferences` falls back to `DEFAULT_THEME_ID`. |
| `settings.dark_theme` | **In**, via the row delete | Same. |
| `settings.locale` | **In**, via the row delete | Same, falling back to `DEFAULT_LOCALE`, which is French. |
| `users.first_name` | **Out** | The wizard always starts its identity fields empty and overwrites both names on Finish whatever the database holds, so clearing them buys nothing. It does cost something, because an abandoned reset would leave the header name and the avatar initials blank on a working account. Leave them. |
| `users.last_name` | **Out** | Same. |
| `users.avatar_url` and the stored avatar object | **Out** | Onboarding never collects an avatar, so re-running the wizard would not restore one, and deleting the stored object is unrecoverable. Named explicitly so a reader does not think it was overlooked. |
| `users.role` | **Out, never** | Clearing it would strip the sole admin of the very role that guards this endpoint, so the reset would be a one-way door out of the admin surface. This is the lockout the recovery convention forbids. |
| `users.password_hash` | **Out, never** | The whole point of the decided mechanism. See [why the password hash is not the reset switch](#why-the-password-hash-is-not-the-reset-switch). |
| `users.email` | **Out** | Identity, not a setting. It is also the key the allowlist and any future magic link match on. |
| `allowed_emails` | **Out** | Access control, not a setting. |
| `magic_link_tokens` | **Out** | Access control, not a setting. A reset account has a password, so `request.ts` will not issue it a link anyway. |
| `users.deactivated_at` | **Out** | Account status, not a setting, and clearing it would let a reset silently reverse a deactivation. |

### The owner's data, which is never touched

**`tasks` rows are never read, never written, and never deleted by this feature.** The owner's
recorded work is not a setting, and a reset that touched it would be a data loss dressed as a
configuration action. This is AC8 rather than an implied consequence.

Clearing `category_quotas` cannot move what past work was measured against, because every task written
since the per-category quotas feature carries its own frozen figure in `tasks.quota_wph_override`, the
way an invoice line stores the price it was sold at. The resolver reads the task's own number before
it reads any category row.

The honest exception, which the quotas spec already records, is the set of tasks whose
`quota_wph_override` is null. Those are rows written before that feature, rows whose figure the user
deliberately cleared, and rows inserted by the development seed. They resolve through the category's
current figure, so clearing the quota rows does move them from the user's own numbers to the shipped
defaults. That population is closed and shrinking, it is the same one the quotas spec accepts as
uncovered, and the cost is stated here rather than discovered later.

### What is deleted rather than reset to default values

The reset deletes the `settings` row and the `category_quotas` rows. It does not write default values
into them.

Three reasons. Every read path already falls back to coded defaults when no row exists, so zero rows
is precisely the state a brand-new magic-link user is in and is a clean pre-onboarding state rather
than a broken one. `completeOnboarding` already upserts the settings row, so it handles a missing row
without change. And writing defaults back would put a second copy of every default value in the reset
handler, free to drift from the ones in `loadUserPreferences`, `loadWorkSettings`, and
`shared/categories.ts`, which the conventions forbid. The prior art agrees, since deleting the
override row and falling back is what Discourse and VS Code both do.

The `settings` row is deleted whole rather than column by column. All six of its user-facing columns
are collected by the wizard, so the whole row is exactly the set being reset, and clearing part of a
row is impossible without writing values into the rest, which is the second-copy problem again.

**The visible consequence, stated because it will surprise otherwise.** Deleting the row clears the
theme and the interface language along with the work fields. The reset refreshes the session and the
preference cookies from `loadUserPreferences`, which now returns the coded defaults, so the interface
switches to the default theme and to French at the moment of the reset. The wizard's appearance step
seeds from the session, so it will show those defaults and the user picks again there. The
confirmation copy names the theme and the language for this reason.

## API contract

**`POST /api/admin/onboarding/reset`**

- Thin route file `server/api/admin/onboarding/reset.post.ts`, delegating to
  `server/api/admin/onboarding/handlers/reset.ts`, matching the thin-route-plus-handler layout every
  server route in this repository already uses.
- Defined through the existing `server/utils/defineAdminEventHandler.ts` wrapper, which every admin
  route already uses. It calls `requireUserSession` and then rejects any role that is not exactly
  `'admin'`. It fails closed, so a missing role or a session minted before the role field shipped is
  denied.
- **Gated on the runtime switch as well as on the role.** The handler reads
  `useRuntimeConfig().onboardingResetEnabled` and, when it is off, throws the same
  403 `forbidden` the wrapper throws for a non-admin, before reading or writing anything. The order
  does not matter for the outcome, since both refusals are identical from outside, but the check
  belongs in the handler rather than in the shared wrapper, because the wrapper is used by every
  admin route and this switch governs one of them.
- **No request body and no query parameters**, so no Zod model and no `sendZodError` call. There is
  nothing to parameterise, because the endpoint always acts on the session user. A `confirm: true`
  field was considered and rejected, because the confirmation is a user-interface concern and a
  boolean the client sets itself adds no safety while putting a second copy of the confirmation rule
  on the server.
- **Response** `{ success: true }`, matching `loginWithPassword` and `completeOnboarding`, the other
  two handlers that reset a session as their main effect. The response also carries the refreshed
  session cookie and the refreshed preference cookies.

Error codes.

| Status | `statusMessage` | When |
| --- | --- | --- |
| 401 | from `requireUserSession` | No session, or a session the `validate-session` middleware has already cleared because the account is gone or deactivated. |
| 403 | `forbidden` | An authenticated user whose role is not exactly `admin`, **or** any caller at all, admin included, while `onboardingResetEnabled` is off. The two cases are deliberately indistinguishable from outside. |
| 500 | unhandled | An unexpected database error. The partial states this can leave are analysed below and every one of them is recoverable. |

There is deliberately **no 409 for an account that is not onboarded**. Calling the endpoint when
`onboarded_at` is already null is a no-op that succeeds. Idempotency is load-bearing here rather than
merely tidy, because the documented recovery from any partial failure is to call the endpoint again,
and a 409 would break that recovery in exactly the state that needs it. The prior art agrees, since
Discourse's documented position is that the wizard can be re-run as many times as necessary without
restrictions.

There is also no 404. The acting user always exists, because `validate-session` queries their row on
every authenticated request and clears the session when it is gone, so a missing row presents as a 401
before this handler runs.

## Whose onboarding is reset

**The acting admin's own, and only their own.** The endpoint takes no target.

The owner asked for "my onboarding", so this is the ask rather than a narrowing of it. It is also the
safer shape, because an endpoint with no target parameter has nothing to aim wrongly and cannot be
pointed at another account by a malformed or hostile request. And it is the only shape that fully
works today, because the mechanism that puts the user in front of the wizard is the session refresh on
the response, which only reaches the session making the request. A reset aimed at somebody else would
clear their rows and leave their live session still saying onboarded, so they would sit on a dashboard
showing default settings with no prompt, which is a half-working feature.

**What a later feature would have to add** to reset another user's onboarding. A validated target in
the request body, keyed by email to match the other admin routes. A decision on whether an admin may
target another admin, and on whether targeting yourself through that path is allowed or redirected
here. A way to make the target's live sessions notice, which does not exist today and would mean
either re-deriving the flag in `server/middleware/validate-session.ts` on every authenticated request
or invalidating the target's session outright. And a record of who reset whom, since a destructive
action on somebody else's account needs a trail where a self-action does not.

## Failure and recovery

The reset has to be safe when it stops halfway, because there is no transaction available. Verified by
search across the tracked files, this repository contains no `db.transaction` call and no `db.batch`
call. The established practice for a multi-table write is the purge endpoint's sequence of awaited
statements with the ordering argued in a comment, and that is what this follows.

So the guarantee is not atomicity. It is that **every partial outcome is a valid state, and the
recovery from every one of them is either calling the endpoint again or signing in again**, neither of
which needs state the user no longer holds.

### The write order

1. **Clear `onboarded_at`** on the acting user's `users` row, setting `updated_at` to now at the same
   time, matching how `reactivate.ts` bumps it. The update names only those two columns, so
   `password_hash`, `role`, `first_name`, `last_name`, `avatar_url`, `email`, and `deactivated_at` are
   untouched.
2. **Delete the `settings` row** for the user.
3. **Delete the `category_quotas` rows** for the user.
4. **Refresh the session and the cookies.** Read the preferences back through `loadUserPreferences`,
   which now returns the coded defaults, call `setUserSession` with `onboarded: false` and those
   preferences while carrying `id`, `email`, `firstName`, `lastName`, `avatarUrl`, and `role` forward
   unchanged, then mirror them with `applyPreferenceCookies`, which is what every other
   session-writing handler in this repository does.

### Why that order, and not another

**The flag clear must come first, and the session refresh must come last, for the same reason.** A
session saying `onboarded: false` over a row whose `onboarded_at` is still set is a trap. The global
middleware forces that user onto the wizard, and the wizard's re-entry guard reads the still-set
column and rejects the Finish submission with 409 `already_onboarded`. The user cannot finish and
cannot leave, because every other route bounces them back. Putting the database change first and the
session change last makes that combination unreachable by construction, rather than merely unlikely.

**The row deletes sit in the middle because their partial outcomes are all benign.** A read path with
no row returns coded defaults, and the wizard's Finish upserts over any settings row that survived.

**Settings before quotas is the tiebreak.** There is no foreign key between them and no correctness
argument either way, so the order goes on which loss is easier to undo. The wizard rewrites the
settings row on Finish. Nothing rewrites the quota rows, so the user retypes those figures on the
settings page. Deleting the recoverable one first leaves the harder one intact for one more attempt.

### Every partial state, and what it looks like

| Stops after | Database | What the user sees | Recovery |
| --- | --- | --- | --- |
| Nothing | Unchanged | An error toast, no visible change | Press Reset again |
| Step 1 | Flag cleared, settings and quotas intact | An error toast, no visible change, because the session was not refreshed | Press Reset again, or sign in again and be routed to the wizard, which upserts over the stale settings row |
| Step 2 | Flag cleared, settings gone, quotas intact | An error toast. Read paths now return coded defaults, so the interface may show the default theme and French on the next load | Press Reset again, which deletes the remaining quota rows and refreshes the session |
| Step 3 | Fully reset, session stale | An error toast, and the app still behaves as onboarded with default settings | Press Reset again, which is a no-op on the database and succeeds at the session refresh, or sign in again |
| Step 4 | Fully reset | The wizard | None needed |

Every row of that table is a valid state, and every recovery is available from the settings page or
the sign-in page with nothing but the password the user still has.

### Abandoning the wizard

This is the interrupted path the recovery convention cares most about, so it is stated separately.

The reset never touches `password_hash`. So an admin who resets themselves, closes the tab, and comes
back a week later on a different device signs in with the same password they always used. `login.ts`
mints `onboarded: false` from the stored column, and the global middleware puts them in front of the
wizard. They can abandon and return as many times as they like. There is no token to expire, no
one-shot link to consume, and no state held anywhere but the account row.

The wizard itself is a single submit with no partial save, so it is either finished or not started,
and not started is a state the account can sit in indefinitely without harm.

### The session expiring mid-reset

If the session cookie expires between loading the settings page and pressing Confirm, the endpoint
returns 401 and nothing is written. The client shows the generic error, and the next navigation is
sent to sign-in by the global middleware. Signing in returns the user to a completely unchanged
account. Failing closed, with no partial write.

### Other live sessions keep a stale flag

**Stated as a known limitation rather than left to be discovered.** The `onboarded` flag lives in the
sealed session cookie and is set at session creation and by this endpoint. An admin signed in on a
second device keeps `onboarded: true` there until that session is renewed by a fresh sign-in. That
device shows the dashboard with the coded default settings and is not prompted to onboard.

It is not an invalid state. Nothing breaks, nothing is corrupted, and if that device saves settings
before the wizard finishes, the wizard's Finish upserts over whatever it wrote. It resolves on that
device's next sign-in.

**Reversal cost if the owner wants it fixed.** `server/middleware/validate-session.ts` already selects
the `users` row on every authenticated request, so it would add `onboardedAt` to that select and
reconcile the session flag against it. That is a small change to a file that runs on every
authenticated request in the application, which is a much wider blast radius than this feature, so it
is left out and recorded in `docs/TODO.md` as a candidate for its own pull request.

## The control, its behaviour, and the confirmation

Visual design belongs to the design stage. What follows is behaviour and copy.

### Where it lives

A **new fourth section on the settings page** at `app/pages/settings.vue`, appended after the existing
Security section. The page already holds three independent sections and this is a fourth, so nothing
is moved, renamed, or regrouped. **The three existing sections stay exactly where they are and exactly
as they are.** A separate feature to split work parameters out of user settings is being specced
independently and owns any reorganisation.

The settings page is the right home rather than the admin users page, because this is a self-action
about the acting account's own configuration, and the settings page is where the acting account's own
configuration lives. Putting it on the users table would frame it as a per-row action aimed at
somebody, which is exactly the shape this feature declines.

### Gating

The section renders only when `canResetOnboarding` on the `GET /api/me` payload is true. That single
boolean already carries both conditions, which are that the caller's role is exactly `admin` and that
`onboardingResetEnabled` is on, so the page renders on one condition and works out nothing for itself.
An absent value, which is what the first paint sees before the query resolves, reads as false.

The client does not call `isAdmin` for this section and does not read the runtime flag. It cannot read
the flag in any case, since the key is private and never reaches the client bundle.

**That is an affordance, not the gate.** The server is the real authorization boundary. A non-admin
who calls the path directly is refused with 403, and so is an admin who calls it while the switch is
off.

The page itself keeps the middleware it has today. It is not turned into an admin-only page, because
the other three sections belong to every user.

### The flow

1. The admin presses the Reset button. Nothing is sent.
2. A modal opens. It names what is cleared, names what is kept, notes that the wizard will ask for a
   password again, and states that the action cannot be undone. It offers Cancel and Reset.
3. Cancel closes the modal and sends nothing.
4. Reset calls `POST /api/admin/onboarding/reset` with the button in a loading state.
5. On success the client refreshes the session through `useUserSession().fetch()`, shows the success
   toast, and navigates to the dashboard route.
6. **`auth.global.ts` sees `onboarded: false` and redirects to the onboarding wizard.** The client
   never names the onboarding route for this purpose, so the rule about where an un-onboarded user
   belongs stays in exactly one place, which is the global middleware that already owns it.
7. On failure the modal closes and an error toast appears. Nothing else changes, and pressing Reset
   again is the documented recovery.

If the session refresh in step 5 fails, the client still holds a stale flag and lands on the
dashboard. The session cookie on the response is already updated, so a page reload re-reads it and the
middleware routes correctly. Not a dead end.

### Why a confirmation is not policing

The project's "do not police the user" rule is about recording reality. It forbids blocking a user
from entering the work they actually did. This action is destructive and irreversible and it operates
on configuration rather than on recorded work, so a confirmation is the correct pattern and is not
policing. The confirmation warns once, in one modal, and Confirm always proceeds. There is no second
dialog, no cooling-off, and no condition under which the app refuses.

**No typed confirmation.** The prior art is clear that typing a name to confirm is reserved for
deletion of something irreplaceable, and GitHub draws that line in its own documentation by requiring
typing to delete a repository and not requiring it to change visibility in the same danger zone.
Chrome's settings reset, which is the closest analogue to this action, uses a plain dialog listing the
consequences with a single button. What is cleared here is a handful of numbers and preferences the
user can retype in a minute or two, and the tasks are not at risk. A typed confirmation would be
off-convention and would read as a heavier warning than the action deserves.

### The password re-entry, and why the wizard is not changed

`CompleteOnboardingSchema` requires a password, and the wizard's identity step always starts empty. So
an admin re-running the wizard has to type a password again, and whatever they type becomes their
password when they press Finish.

**That is left as it is**, and the consequence is disclosed in the confirmation copy rather than
engineered away. Making the password optional on re-entry would mean changing the onboarding schema,
the identity step's gating, and the completion handler so the wizard has two modes, which is a
meaningful widening of a feature whose only job is to clear rows and a flag. Typing the same password
again is a perfectly good answer, and the user is told to expect the question.

The safety property this feature actually needs is unaffected, because the reset itself never touches
the hash. An abandoned reset leaves the old password working. Only pressing Finish changes it.

**Reversal cost.** Making the password optional later is an additive change, since it means relaxing
one Zod field to optional and skipping the hash write when it is absent. Nothing built here has to be
unpicked, and this is recorded in `docs/TODO.md`.

## i18n copy

New keys under the existing `settings` namespace in `i18n/locales/fr.json` and `i18n/locales/en.json`,
nested as `settings.reset.*`. French is the default and comes first. Every French string with `?`
takes a no-break space before it, written as U+00A0, which is the character the existing French copy
in this repository already uses.

The vocabulary is taken from the strings already shipped rather than invented, so "jours travaillés",
"heures de travail", and "fuseau horaire" match `onboarding.work.*`, and the generic error string is
reused word for word from `settings.work.errors.generic`.

| Key | FR | EN |
| --- | --- | --- |
| `settings.reset.heading` | Réinitialisation | Reset |
| `settings.reset.subtitle` | Effacez vos paramètres et refaites la configuration initiale. | Clear your settings and go through the initial setup again. |
| `settings.reset.submit` | Réinitialiser | Reset |
| `settings.reset.confirm.title` | Réinitialiser vos paramètres ? | Reset your settings? |
| `settings.reset.confirm.cleared` | Vos heures de travail, vos jours travaillés, votre fuseau horaire, votre thème, votre langue et vos quotas seront effacés et reprendront leurs valeurs par défaut. | Your work hours, work days, timezone, theme, language and quotas will be cleared and go back to their default values. |
| `settings.reset.confirm.kept` | Vos tâches, votre nom et votre mot de passe ne sont pas touchés. | Your tasks, your name and your password are not affected. |
| `settings.reset.confirm.password` | La configuration initiale vous redemandera un mot de passe. Vous pouvez saisir le même. | The initial setup will ask you for a password again. You can enter the same one. |
| `settings.reset.confirm.irreversible` | Cette action est irréversible. | This cannot be undone. |
| `settings.reset.confirm.cancel` | Annuler | Cancel |
| `settings.reset.confirm.submit` | Réinitialiser | Reset |
| `settings.reset.success` | Vos paramètres ont été réinitialisés. | Your settings have been reset. |
| `settings.reset.errors.generic` | Une erreur est survenue. Veuillez réessayer. | Something went wrong. Please try again. |

The heading is a bare noun to match the three headings already on the page, which are Travail,
Quotas, and Sécurité.

**The runtime switch needs no visible string in either language.** When it is off the section is
absent rather than disabled, so there is nothing to label and nothing to explain, and the 403 the
endpoint returns is the same one a non-admin already gets, which the client renders with the existing
`settings.reset.errors.generic`. The key list above is therefore complete.

The confirmation copy names what is cleared and what is kept in two separate strings, which is the
Chrome reset dialog's structure and is also what makes the reassurance legible rather than buried.
Splitting them into their own keys rather than one paragraph lets the design stage lay them out
without re-cutting the sentences.

**Strings the owner should read before ship.** Every string is a proposal, since the user is a
professional translator, and three of them carry more risk than the rest. `settings.reset.subtitle`
and `settings.reset.confirm.password` both use "la configuration initiale" for the onboarding wizard,
which is descriptive and avoids the anglicism but is a term the application does not use anywhere
today, since the wizard's own French title is simply "Bienvenue". `settings.reset.heading` uses the
bare noun "Réinitialisation", which may read as terse next to "Travail" and "Sécurité". If the owner
prefers a different word for the wizard, it should be changed in both keys at once so the two agree.

## Outputs and acceptance criteria

The unit-test stage writes tests from these and never from the implementation, so each is checkable
without reading the code. Database assertions are read back with raw SQL against the in-memory harness
in `test/helpers/taskTestDb.ts`, so the code under test is never also what sets up or reads its own
state.

### Schema and migration

**AC1.** `server/db/schema.ts` declares `onboardedAt: integer('onboarded_at', { mode: 'timestamp' })`
on `users`, nullable, with no `$defaultFn` and no database-level default. Inserting a `users` row
naming only `email` leaves `onboarded_at` null.

**AC2.** `server/db/migrations/0012_add_users_onboarded_at.sql` exists, contains exactly one executable
statement adding the column, and its comment header does not claim that the runner tolerates a
duplicate column error.

**AC3.** `server/db/migrations/0013_backfill_users_onboarded_at.sql` exists and contains exactly one
executable statement, an `UPDATE` restricted by `password_hash IS NOT NULL AND onboarded_at IS NULL`.

**AC4.** Running 0013 twice against the same database changes nothing on the second run. Applied to a
fixture where one row has a password and a `created_at`, one has a password and a null `created_at`,
one has no password, and one already has a non-null `onboarded_at`, the first row takes its
`created_at`, the second takes a non-null value at or after the migration moment, the third stays
null, and the fourth keeps the value it already had.

**AC5.** After 0013, for every row that existed before this feature, `onboarded_at IS NOT NULL` equals
`password_hash IS NOT NULL`. This is the property that makes the deploy invisible to existing users,
and it is the criterion that proves the backfill leaves existing onboarded users onboarded.

### The endpoint

**AC6.** `POST /api/admin/onboarding/reset` is defined through `defineAdminEventHandler`. An
unauthenticated request is refused with 401 and writes nothing.

**AC7.** An authenticated user whose role is not exactly `admin`, including a user with role `user`
and a session carrying no role at all, is refused with 403 and writes nothing. The refusal happens at
the server, independently of whether the client renders the control.

**AC8.** **A successful reset leaves the `tasks` table byte-for-byte unchanged.** With tasks present
for the acting user before the call, `SELECT * FROM tasks` returns the same rows afterwards, including
every `quota_wph_override` value. No task is deleted, inserted, or updated.

**AC9.** A successful reset deletes the acting user's `settings` row and every `category_quotas` row
whose `user_id` is the acting user, verified by a raw `SELECT` returning zero rows for each. Another
user's `settings` and `category_quotas` rows are untouched, verified by count.

**AC10.** A successful reset sets the acting user's `users.onboarded_at` to null and leaves
`password_hash`, `role`, `first_name`, `last_name`, `avatar_url`, `email`, and `deactivated_at`
holding exactly the values they held before the call. `updated_at` is the only other column that
changes.

**AC11.** Calling the endpoint twice in a row succeeds both times and returns `{ success: true }` both
times. The second call finds no rows to delete and a null `onboarded_at`, and it neither errors nor
returns 409.

### The session and the routing

**AC12.** The session written by a successful reset carries `onboarded: false`, and carries `id`,
`email`, `firstName`, `lastName`, `avatarUrl`, and `role` unchanged from the session that made the
request. The preference cookies written alongside it carry the coded defaults, because
`loadUserPreferences` now finds no row.

**AC13.** `server/api/auth/handlers/login.ts` sets `onboarded` from `users.onboarded_at` rather than
from a literal. Signing in as an account with a non-null `onboarded_at` yields `onboarded: true`, and
signing in as an account with a password and a null `onboarded_at`, which is what a reset account
looks like, yields `onboarded: false`.

**AC14.** `server/api/magic-link/handlers/verify.ts` sets `onboarded` from `users.onboarded_at`, and
its separate redirect rule still tests `password_hash`. An account with a password is still redirected
without a session being minted, and that redirect fires regardless of what `onboarded_at` holds. This
is the criterion that stops a later stage collapsing the two rules onto one column.

**AC15.** `app/middleware/auth.global.ts` is unchanged and still routes on the session flag. Given a
logged-in session with `onboarded: false` and a target that is not the onboarding path, it returns a
redirect to the onboarding path. Given `onboarded: true` and the onboarding path, it returns a
redirect to the dashboard. Given `onboarded: false` and the onboarding path, it returns nothing.

### Re-running the wizard

**AC16.** `server/api/onboarding/handlers/complete.ts` rejects with 409 `already_onboarded` when
`users.onboarded_at` is non-null, and accepts when it is null, regardless of whether `password_hash`
is set. This is the criterion that proves a reset account can finish the wizard again rather than
hitting the guard.

**AC17.** A successful onboarding completion sets `users.onboarded_at` to a non-null timestamp in the
same update that sets `password_hash`, and the session it writes carries `onboarded: true`.

**AC18.** The full round trip works. Starting from an onboarded account with a password, a settings
row, quota rows, and tasks, calling the reset and then submitting the wizard succeeds, recreates the
settings row with the submitted values, sets a fresh `onboarded_at`, and leaves the tasks untouched.

**AC19.** **The password still works for sign-in after a reset.** Calling the reset and then calling
`POST /api/auth/login` with the password that worked before the reset returns success. The reset never
writes `password_hash`, so the stored hash is byte-for-byte identical before and after, verified by a
raw `SELECT`.

### Partial failure

**AC20.** With the settings delete forced to throw, the acting user's `onboarded_at` is null
afterwards, the `settings` row and the `category_quotas` rows are still present, and the session is
not refreshed. Calling the endpoint again then succeeds and completes the reset. This is the criterion
that proves the ordering, because the reverse order would leave a refreshed session over a database
that still says onboarded.

**AC21.** With the quota delete forced to throw, `onboarded_at` is null, the `settings` row is gone,
the `category_quotas` rows are still present, and calling the endpoint again succeeds and removes
them.

**AC22.** No partial failure can produce the trap state, which is a session carrying
`onboarded: false` over a row whose `onboarded_at` is still set. The session write is the last step and
the flag clear is the first, so the state is unreachable by construction.

### The control

**AC23.** With `onboardingResetEnabled` on, the Reset section renders on the settings page for a
session whose role is exactly `admin` and does not render for any other role, including an undefined
one. The three existing sections render identically in both cases, so the presence of the section
changes nothing else on the page.

**AC24.** Pressing Reset sends no request until the confirmation is confirmed. Cancelling sends
nothing.

**AC25.** Every visible string in the section and the modal resolves from `settings.reset.*` in both
`fr.json` and `en.json`, with no hardcoded text, and the key sets in the two files match exactly.

### Turning the feature off

**AC26.** The switch turns the whole feature off, at the server and on the page.

1. With `onboardingResetEnabled` off, `POST /api/admin/onboarding/reset` returns 403 with
   `statusMessage` `forbidden` for a caller whose role is exactly `admin`, and writes nothing. The
   acting user's `onboarded_at`, `settings` row, and `category_quotas` rows are unchanged afterwards,
   verified by a raw `SELECT`. The status and the `statusMessage` are identical to the 403 AC7
   produces for a non-admin, so the two refusals cannot be told apart from the response.
2. With `onboardingResetEnabled` off, `GET /api/me` returns `canResetOnboarding: false` for a caller
   whose role is exactly `admin`. With it on, the same caller receives `true`, and a caller whose role
   is not exactly `admin` receives `false` whatever the flag holds.
3. The settings page renders the Reset section when `canResetOnboarding` is true and does not render
   it when the value is false or absent. No Reset control, heading, or confirmation modal is present
   in the rendered output in either of those two cases.

## Edge cases

- **The endpoint is called on an account that is already reset.** Succeeds as a no-op. Idempotency is
  the documented recovery from a partial failure, so a 409 here would break the recovery in the exact
  state that needs it.
- **The endpoint is called by a non-admin who guessed the path.** 403 from the wrapper. The client
  gate is an affordance only.
- **The endpoint is called by a real admin while the switch is off.** The same 403 `forbidden`, and
  nothing is written. Deliberately indistinguishable from the previous case.
- **The switch is turned off while an admin is sitting on the settings page with the section open.**
  The section stays on screen until the `me` query refetches, since the page holds a rendered result
  rather than polling. Pressing Reset then fails with the generic error and writes nothing, because
  the endpoint is the real gate. Reloading removes the section.
- **The switch is turned on and an already-signed-in admin is looking at the settings page.** The
  section appears on the next `me` fetch rather than requiring a sign-out, which is the whole reason
  the flag rides on `GET /api/me` instead of on the session cookie.
- **`NUXT_ONBOARDING_RESET_ENABLED` is set to the string `false`.** Nuxt coerces the environment value
  to the type of the default, which is a boolean here, so it resolves to `false` rather than to a
  truthy string. This is the trap that makes the boolean default load-bearing rather than cosmetic.
- **The endpoint is called with a body.** The handler reads no body, so anything sent is ignored
  rather than validated. There is nothing to inject through.
- **The reset is abandoned after the session refresh.** The password is untouched, so the admin signs
  back in from anywhere and is routed to the wizard again. There is no token to expire and no one-shot
  link to consume.
- **The session expires between opening the settings page and confirming.** 401, nothing is written,
  and the next navigation goes to sign-in. Fails closed.
- **The request fails partway.** Analysed in full in [Failure and recovery](#failure-and-recovery).
  Every partial state is valid and recovers by calling the endpoint again or by signing in again.
- **A second live session on another device.** Keeps a stale `onboarded: true` until it is renewed.
  Not an invalid state, resolves on that device's next sign-in, and recorded in `docs/TODO.md` with its
  reversal cost.
- **A concurrent settings save from another device during the wizard.** Recreates a settings row.
  The wizard's Finish upserts over it, so the last write wins and nothing is corrupted.
- **The admin resets themselves and then a browser tab reloads mid-wizard.** The wizard has no partial
  save, so it starts at step one with the identity fields empty, which is its normal entry state. The
  account is unchanged and the user simply fills it in again.
- **`users.created_at` is null on a production row.** The `COALESCE` in 0013 writes the migration
  instant instead, so the backfill is total and no onboarded account is left null.
- **The migration is applied but the deploy is rolled back.** Safe. The old build never names
  `onboarded_at`, so the column simply sits unread.
- **The build is deployed before the migration.** A total authentication outage, named in the headers
  as forbidden. This is the ordering that must not happen.
- **0012 is applied without 0013 and the build is deployed.** Every existing user is silently sent
  back through the wizard and can overwrite their own profile. Also named in the headers as forbidden,
  and the more dangerous of the two because nothing errors.
- **A category quota was set for a category the app no longer knows.** The delete is keyed on
  `user_id` alone, so an unknown `category_id` is removed with the rest and no coercion is involved.
- **The user had no settings row to begin with.** The delete matches nothing and the reset succeeds.
  That is the state a magic-link user sits in before onboarding.
- **A task carries a null `quota_wph_override`.** Clearing the quota rows moves that task from the
  user's own figure to the shipped default. Named and accepted in
  [the owner's data](#the-owners-data-which-is-never-touched), and the population is closed and
  shrinking.

## Out of scope

Nothing below is built or specced here.

- **Resetting another user's onboarding.** Self-only, argued in
  [whose onboarding is reset](#whose-onboarding-is-reset), with the list of what a later feature would
  need.
- **Any reorganisation of the settings page.** The three existing sections are not moved, renamed,
  regrouped, or restyled. The separate feature that splits work parameters out of user settings owns
  that entirely, and this feature's grouped enumeration is the input it will read, not a change it can
  act on.
- **Re-deriving the session flag in `validate-session.ts`.** Recorded in `docs/TODO.md`.
- **Making the wizard's password optional on re-entry.** Recorded in `docs/TODO.md`.
- **Any change to the wizard itself**, beyond the completion handler's guard and the `onboarded_at`
  write. No new step, no prefilling, no partial save, no resumable step pointer.
- **Any change to `manage-users.ts` or the admin users list.** A reset account correctly still shows
  as Active there.
- **Any change to the magic-link flow, the allowlist, or the deactivation flow.**
- **Clearing `work_schedule`, the avatar, or the names.** Each argued in the enumeration.
- **An audit record of resets.** A self-action on your own configuration needs no trail. A later
  feature that lets an admin reset somebody else does.
- **Anything to do with `tasks`.**
- **A feature-flag system.** The runtime switch is one boolean in `runtimeConfig` read in two places
  for one control. No flags table, no registry, no per-user targeting, no admin screen for toggling
  it, and no second feature gated on anything. See
  [what this switch is not](#what-this-switch-is-not).

## Open questions

None. Every point the owner left open is decided in this document with its reasoning, and the two
places where genuine uncertainty remains are recorded as assumptions below rather than as questions,
each with what it would cost to reverse.

## Documented assumptions

**Assumption 1. The reset includes the theme and the interface language.** They live in the same
`settings` row as the work fields, the wizard's appearance step collects all three, and clearing part
of a row would mean writing default values into the rest. Deleting the whole row is therefore the
clean answer, and the confirmation copy names the theme and the language so the switch to the default
theme and to French is expected rather than alarming. **Reversal cost is low.** Preserving them would
mean the reset updates the row's work columns to their coded defaults instead of deleting the row,
which puts one copy of three default values in the handler. That is a change to one handler and one
line of the confirmation copy, with no schema or contract change.

**Assumption 2. The reset includes the `category_quotas` rows.** A quota is explicitly a user setting,
a fresh account has zero rows, and zero rows resolves to the shipped defaults. The cost is that the
wizard does not collect quotas, so the user retypes any custom figures on the settings page, where the
Quotas section will show the shipped defaults with the existing "Valeur par défaut" badge so the change
is visible. **Reversal cost is low.** Removing the quota delete is deleting one statement and one
acceptance criterion, and adjusting the confirmation copy. No schema or contract change either way.

## Notes for later stages

- **Files created.** `server/api/admin/onboarding/reset.post.ts`,
  `server/api/admin/onboarding/handlers/reset.ts`,
  `server/db/migrations/0012_add_users_onboarded_at.sql`,
  `server/db/migrations/0013_backfill_users_onboarded_at.sql`.
- **Files changed.** `nuxt.config.ts` for the `onboardingResetEnabled` entry,
  `server/api/me/handlers/getMe.ts` for the derived `canResetOnboarding` field,
  `server/db/schema.ts` for the column,
  `server/api/magic-link/handlers/verify.ts` and `server/api/auth/handlers/login.ts` for the flag,
  `server/api/onboarding/handlers/complete.ts` for the guard and the `onboarded_at` write,
  `app/pages/settings.vue` for the fourth section, `i18n/locales/fr.json` and `i18n/locales/en.json`
  for the `settings.reset` keys, and `test/helpers/taskTestDb.ts` for the `onboarded_at integer`
  column on its inline `users` DDL.
- **The migrations are hand-applied.** There are no database credentials in this environment, so
  neither file can be run or verified here. The owner applies both together with
  `bun run apply-migrations --yes` before deploying the new build, and records the backfill's row
  count in the pull request.
- **Reuse rather than reinvent.** The admin gate is the existing `defineAdminEventHandler`, the client
  affordance is the existing `isAdmin`, the session refresh follows the existing
  `setUserSession` plus `applyPreferenceCookies` pattern, the read-back goes through the existing
  `loadUserPreferences`, and the routing stays entirely in the existing `auth.global.ts`.
- **For the compliance stage.** The endpoint is strictly role-gated and fails closed. It deletes only
  the acting user's own configuration rows, never another user's and never recorded work. It sends no
  email and collects no new personal data. It stores one new timestamp about the account holder, which
  is already erased by the purge endpoint's existing `users` delete, so no change to erasure is needed.
- **For the code-review stage.** The runtime switch is one configuration value with a finite life, not
  the beginning of a flag framework, and the reason it exists at all is in
  [why this exists](#why-this-exists-and-why-it-has-a-finite-life). The two columns in `verify.ts` are
  not a mistake, and the reason is in
  [the rule that stays on `password_hash`](#the-rule-in-verifyts-that-stays-on-password_hash). The
  `manage-users.ts` status derivation staying on `password_hash` is also deliberate.
- This is the specs stage only. No implementation code is written here, and no later stage runs until
  the owner confirms this document is correct.
