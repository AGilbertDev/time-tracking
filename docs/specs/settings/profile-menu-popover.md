# Profile menu header popover

## Intent

The avatar button in the header is the single entry point for account info, navigation, and session actions. Today it opens a minimal dropdown that carries a non-interactive Profile row, the atmosphere picker submenu, the language toggle, and Sign out. This feature grows that dropdown into the full account popover described in `docs/spec.md` §13: an identity header, a navigation group (Profile, Settings, and an admin-only Manage users), a preferences group (the atmosphere picker and the language toggle), and Sign out, grouped with separators. It ships complete in one pipeline feature.

The only backend work is surfacing the user's `role` on the session payload so the popover can decide whether to render the admin-only Manage users item. There is no schema change and no migration. The profile page, the settings page, and the admin user-management panel are separate later features and are out of scope here. The navigation items link ahead to their final localized routes now, which 404 until those pages land, per §13's explicit allowance.

See `docs/spec.md` §12 (admin panel, the Manage users destination) and §13 (this popover), `app/components/app/header.vue` (the current dropdown), and `docs/specs/settings/preference-persistence.md` (the persistence this feature builds on and does not change).

## Scope

In scope:

- Rewrite the header avatar dropdown in `app/components/app/header.vue` into the grouped popover below.
- Surface `role` on the `nuxt-auth-utils` session payload at every session-creation site, and augment the session `User` type.
- Add the new i18n labels (FR default, EN) for Settings and Manage users. Profile, Language, the atmosphere names, and Sign out already have verified keys.
- Register the localized navigation routes in `nuxt.config.ts` so the link-ahead items resolve to their final paths.

Out of scope (explicitly, do not build):

- The profile page, the settings page, and the admin user-management panel. The items link to these routes; the destinations 404 until they are built as their own features.
- Any change to preference persistence. The atmosphere picker and language toggle keep their existing behaviour and their existing `savePreferences` wiring from `docs/specs/settings/preference-persistence.md`.
- The Google OAuth handler beyond the `role` note below. It is dead scaffolding whose session shape already predates the `User` type (see the note under Backend contract).

## Spec-versus-code reconciliations

The build stages must apply these. Each is a place where the written spec §13 disagrees with the committed code or the project conventions, and this document resolves the disagreement.

1. **Grouping deviates from the §13 order, intentionally.** §13 lists items top to bottom as Identity, Profile, Manage users, Language, Settings, Sign out, and says "Exact grouping TBD in build." This feature settles that grouping and it is not the raw §13 order. The settled grouping is Identity, then a Navigation group (Profile, Settings, Manage users), then a Preferences group (atmosphere picker, Language), then Sign out. Navigation actions that leave the popover for a page are kept together; in-place preference toggles are kept together. §13's order is superseded by this document for the build, and §13 should be updated to point here.

2. **The atmosphere picker stays and joins Preferences.** §13's written item list omits the theme atmosphere picker entirely, but the committed `header.vue` ships it as a submenu. Code and spec disagree. Resolution: the atmosphere picker **stays** and is grouped under Preferences, above Language. §13's omission is treated as an oversight, not an instruction to remove it. This picker is distinct from the sun and moon `AppColorModeToggle` that sits in the navbar next to the avatar button. That toggle switches light versus dark **mode**; this submenu chooses which of the eight **atmospheres** applies within the current mode. They are two different controls and must not read as two theme buttons. The atmosphere submenu label already reflects the current mode (`theme.light` / `theme.dark`) and its own icon (sun or moon), so the distinction is carried by the label and the submenu contents, not by a duplicated mode toggle inside the popover.

3. **Icons are Phosphor `i-ph-*`, not Carbon.** §13 says "Icons: Carbon (`i-carbon-*`)." The committed `header.vue` and the project frontend convention use Phosphor `i-ph-*`. Resolution: use Phosphor `i-ph-*` throughout. §13's Carbon mention is superseded and should be corrected.

## Inputs

- **Session user** (read, authenticated). The popover reads `firstName`, `lastName`, `email`, `role`, `locale`, `lightTheme`, and `darkTheme` from `useUserSession().user`. All are already on the session except `role`, which this feature adds. The identity header reads `firstName` / `lastName` / `email`. The admin gate reads `role`. The preference controls read `locale`, `lightTheme`, and `darkTheme` as they do today.
- **User actions**:
  - Open and close the popover from the avatar button (existing `UDropdownMenu` behaviour).
  - Click Profile, Settings, or Manage users to navigate to the corresponding localized route.
  - Pick an atmosphere from the theme submenu (existing behaviour, persisted via `savePreferences`).
  - Toggle the language (existing behaviour, persisted via `savePreferences`).
  - Click Sign out (existing `logout()`).
- **Avatar image**: §13 mentions `avatar_url` for the identity image with an initials fallback. `avatar_url` exists on the `users` table but is **not** on the session payload today, and putting it there or wiring avatar upload is out of scope (that belongs to the profile page feature). This feature keeps the existing initials-in-a-primary-circle button as the avatar for both the trigger and the identity header. See open question 1.

## Outputs and acceptance criteria

The popover renders as a `UDropdownMenu` built from a grouped `items` array. Groups are separated by the standard menu separator (a new sub-array is a new group in Nuxt UI's `DropdownMenuItem[][]` shape, which already renders separators between groups). Top to bottom:

### 1. Identity group (non-interactive)

- Shows the avatar (initials circle, matching the trigger), the full name (`firstName` + `lastName`, trimmed), and the email.
- When both names are empty, the name line is empty and the email still shows; the initials fall back to empty rather than crashing (the existing `initials` computed already yields `''` in that case).
- The identity block is not selectable and performs no action on click. It uses a non-interactive slot or a disabled/label item so keyboard focus does not land on a dead actionable row.
- **Acceptance**: the signed-in user sees their own name and email at the top of the popover, and the row cannot be activated.

### 2. Navigation group (links to pages)

Three items, each a real link to its final localized route via `useLocalePath()`:

- **Profile** — `to` the localized `profile` route. Icon `i-ph-user`.
- **Settings** — `to` the localized `settings` route. Icon `i-ph-gear` (or `i-ph-sliders`; frontend picks one Phosphor gear/settings glyph).
- **Manage users** — admin only. `to` the localized admin users route. Icon `i-ph-users`. Rendered **only** when `user.value?.role === 'admin'`. Hidden entirely for non-admins; never rendered disabled or greyed.

Acceptance:

- For a non-admin, exactly two items appear in this group (Profile, Settings) and Manage users is absent from the DOM.
- For an admin, three items appear.
- Each item is a navigating link (`NuxtLink` via the item's `to`), not an `onSelect` no-op. Clicking Profile, Settings, or Manage users navigates to the localized path; until the destination page exists the navigation yields a 404, which is the accepted link-ahead behaviour.
- The three routes resolve to their localized paths in both locales (for example the French Settings path differs from the English one).

### 3. Preferences group (in-place toggles)

- **Atmosphere picker** — the existing submenu, moved into this group. Label is `theme.light` or `theme.dark` depending on the current mode, icon `i-ph-sun` or `i-ph-moon`, children are the eight atmospheres with their swatches and the active check. Selecting one still updates the in-memory theme and calls `savePreferences`. Behaviour is unchanged from today; only its grouping moves.
- **Language** — the existing toggle. Label `header.language` with the active locale code, icon `i-ph-translate`. Selecting it calls `setLocale(otherLocale)` and `savePreferences({ locale })`, unchanged from today.

Acceptance:

- Both controls sit in one group, separated from Navigation above and Sign out below.
- The atmosphere pick and the language toggle persist exactly as they did before this feature (no regression against `docs/specs/settings/preference-persistence.md`).
- The atmosphere submenu is visibly the atmosphere chooser (eight named swatches), not a light/dark mode switch, so it does not read as a duplicate of the navbar `AppColorModeToggle`.

### 4. Sign out

- One item, label `header.logout`, icon `i-ph-sign-out`, calls the existing `logout()` (which clears the session and navigates to the localized `signin` route).
- **Acceptance**: clicking it clears the session and lands on the sign-in page, unchanged from today.

### Cross-cutting acceptance criteria

- **Nuxt UI first.** The popover is a `UDropdownMenu` driven by an `items` array. No custom popover, no custom CSS beyond what already exists for the swatch rows and the trigger button. Solution priority is Nuxt UI, then Nuxt, then Tailwind, then custom, per `my-frontend-conventions`.
- **Icons are Phosphor `i-ph-*`** everywhere in the popover.
- **Admin gate is data-driven.** Manage users appears if and only if `user.value?.role === 'admin'`. No hardcoded email check, no client-only guess. The gate reads the session `role` this feature adds.
- **i18n.** Every visible label is an i18n key, FR default and EN present. No hardcoded strings. French copy uses a space before `? ! : ;` where those marks appear. The new keys are listed under Copy below.
- **Separation of concerns.** Client changes live in `app/`, the session-payload change lives in `server/`, and the shared `role` type augmentation lives in `app/types/auth.d.ts` (the existing home of the session `User` type). No shared `shared/` contract is needed for this feature.
- **Comments** in changed files are full sentences ending in a period, with no dash or colon joining clauses.
- **Product non-negotiable.** The popover signals but never blocks. The admin item is simply absent for non-admins rather than shown-and-blocked, which matches "do not police the user" and §13's "Hidden entirely for non-admins, never just disabled."

## Backend contract: `role` on the session

`role` is a `text` column on the `users` table, `not null` with default `'user'` (verified at `server/db/schema.ts` line 14). Admins hold `role === 'admin'`. **No migration is needed**: the column already exists, and this feature only adds the value to the session payload, which is a runtime cookie shape, not a database schema change.

Changes:

- **`app/types/auth.d.ts`**: add `role: string` to the `#auth-utils` `User` interface. Keep it non-optional and populate it at every creation site so consumers never handle `undefined`. (A `'user' | 'admin'` union would be tighter, but the column is an open `text` field, so `string` matches the source of truth; see open question 2.)
- **`server/api/auth/handlers/login.ts`**: add `role: user.role` to the `setUserSession` user object. The `user` row is already loaded here.
- **`server/api/magic-link/handlers/verify.ts`**: add `role: user!.role` to the `setUserSession` user object. The row is loaded or created just above.
- **`server/api/onboarding/handlers/complete.ts`**: add `role` to the `setUserSession` user object. The handler already has the session `user` and updates the row; read `role` from the loaded users row (or from the existing session user, which carried it in from the magic-link session). Whichever source, the value must be the user's real `role`, not a hardcoded default.
- **`server/routes/auth/google.get.ts`**: out of scope to wire, same as in the preference-persistence spec. This handler sets a session shaped `{ email, name, picture }` that already does not match the `User` type and has no `id`, `firstName`, `lastName`, or `onboarded`. It is dead scaffolding (no OAuth client config in `nuxt.config.ts`, no UI entry point). Do not paper over it. If it is ever completed to resolve a real `users` row, it must set `role` on the session like the three live sites. Flag this to the owner rather than half-wiring it.
- **`server/api/me/handlers/savePreferences.ts`**: no change required. It refreshes the session with `setUserSession(event, { user: { ...user, ...preferences } })`, spreading the existing session `user`, so once the three live creation sites set `role`, this handler carries it through unchanged. Note this so the backend stage does not add a redundant `role` read here.

Acceptance:

- After a fresh login, magic-link verify, or onboarding completion, `useUserSession().user.role` is the user's real role.
- The popover's admin gate works end to end: an admin sees Manage users, a `user`-role account does not.
- No Drizzle migration file is added for this feature. The absence of a migration is itself an acceptance criterion.

## Localized routes (link-ahead)

Register the three destination routes in the `i18n.pages` map in `nuxt.config.ts` alongside the existing `signin`, `signup`, and `onboarding` entries, and link to them with `useLocalePath()` using the route key. Proposed keys and paths (French first; owner may adjust the words):

| Route key | FR path | EN path |
| --- | --- | --- |
| `profile` | `/profil` | `/profile` |
| `settings` | `/parametres` | `/settings` |
| `admin-users` | `/utilisateurs` | `/users` |

Notes for the frontend stage:

- These are the final routes. The destination page files are built later; do not create them here.
- With `customRoutes: 'config'`, a `pages` map entry only produces a resolvable route once the matching page file exists. Until then `useLocalePath('profile')` may return the key unchanged rather than a real path, which would make the link misbehave instead of cleanly 404. This is a real gotcha, captured as open question 3 with a documented default: link via `useLocalePath()` with the route key as the spec directs, and if the frontend stage confirms the key does not resolve without a page file, fall back to an explicit locale-keyed absolute path string (a small map of `{ fr, en }` paths selected by the active locale) so the click lands on the real localized path and yields a genuine 404. Either way the item must be a real link to the final localized path, never a dead or no-op item.

## Copy (i18n keys)

Existing verified keys reused unchanged: `header.profile`, `header.language`, `header.logout`, `theme.light`, `theme.dark`, `theme.default`, and `theme.names.*`.

New keys to add. The user is a professional translator, so the frontend stage must treat these as **proposals pending owner verification**, not final copy. None of the proposed strings contain `? ! : ;`, so the space-before-punctuation rule does not bite; if the owner's wording introduces one of those marks, the French takes the space before it.

| Key | FR (proposed) | EN (proposed) | Confidence |
| --- | --- | --- | --- |
| `header.settings` | Paramètres | Settings | High. "Paramètres" is the standard Québécois and general French term for application settings. |
| `header.manageUsers` | Gérer les utilisateurs | Manage users | Medium. "Gérer les utilisateurs" is a faithful, common rendering; owner may prefer "Gestion des utilisateurs" or "Utilisateurs". Flagged for verification. |

Placement: keep both under the existing `header` namespace to match `header.profile` and `header.logout`. Add them to both `i18n/locales/fr.json` and `i18n/locales/en.json`.

The identity header shows the name and email directly from the session and needs no new string. The avatar's `aria-label` reuses the existing `username` computed.

## Edge cases

- **No name set** (pre-onboarding or a user who never completed it). `firstName` and `lastName` are null. The identity name line renders empty, the email still shows, and the initials fall back to `''`. The popover must not crash or render "null null". The existing `username` and `initials` computeds already trim to empty; keep that behaviour.
- **`role` is some value other than `'user'` or `'admin'`.** The column is open `text`. Any value that is not exactly `'admin'` hides Manage users. The gate is a strict `=== 'admin'` check, so an unexpected role fails closed (no admin item), which is the safe default.
- **Session missing `role`** (a session minted before this feature deploys, still valid in a browser). `user.value?.role` is `undefined`, the strict `=== 'admin'` check is false, and Manage users is hidden. The user sees a correct non-admin popover until their next session refresh repopulates `role`. No crash, fails closed. Acceptable and self-healing.
- **Admin clicks Manage users before the admin panel exists.** Navigates to the localized users route and 404s. Intended link-ahead behaviour, not a bug.
- **Non-admin cannot reach Manage users by other means.** Hiding the menu item is a UI affordance, not authorization. The admin routes and admin APIs enforce their own role guard when they are built (§12 "protected by the admin-role guard"). This feature does not add that guard because it builds no admin route; it only hides the menu entry. State this so a later reviewer does not mistake the hidden item for the access control.
- **Language toggle and atmosphere pick mid-open.** Unchanged from today. Selecting a preference control persists via the existing `savePreferences` path and its documented write-failure toast (from the preference-persistence spec). This feature adds no new failure surface for those controls.
- **Very long name or email overflowing the identity row.** The popover has a fixed width (`w-56` today, may widen). Long values should truncate or wrap rather than break the layout. Frontend applies a truncation utility; not a blocking criterion but noted so it is handled.

## Open questions

1. **Avatar image.** §13 references `avatar_url` for the identity image with an initials fallback. `avatar_url` is on the `users` table but not on the session payload, and avatar upload belongs to the profile page feature. **Default assumption (proceed):** keep the current initials-circle avatar for both the trigger and the identity header, and do not add `avatar_url` to the session in this feature. Revisit when the profile page is built. Confirm the owner is fine shipping the popover without a photo avatar.

2. **`role` type: `string` vs union.** The column is open `text`, so `role: string` on the session type matches the source of truth exactly. A `'user' | 'admin'` union would be tighter and would document the two known roles, but it would lie if a third role is ever stored. **Default assumption (proceed):** type it as `string`, gate on the `'admin'` literal. Flag if the owner wants the tighter union plus a documented set of allowed roles.

3. **Link-ahead resolution with `customRoutes: 'config'`.** Whether `useLocalePath('profile')` resolves to `/profil` before the `profile` page file exists needs a build-time check. **Default assumption (proceed):** register the routes in the `pages` map and link via `useLocalePath()`; if the key does not resolve without a page file, use an explicit locale-keyed absolute path map as the documented fallback so the click reaches the real localized path and 404s cleanly. Frontend confirms which path resolves during the build.

4. **`header.manageUsers` wording.** "Gérer les utilisateurs" is proposed at medium confidence. The owner (a professional translator) verifies the final FR wording before it ships, per the copy non-negotiable. Not a blocker for writing the code, but the string must be owner-confirmed before the feature is considered done.

## Notes for later stages

- **Files touched (build stages):**
  - `app/components/app/header.vue`: regroup the `items` array into Identity, Navigation, Preferences, Sign out; add the admin-gated Manage users item; add Profile and Settings navigation links via `useLocalePath()`; render the identity header block. The atmosphere submenu and language toggle move into the Preferences group but keep their existing logic.
  - `app/types/auth.d.ts`: add `role: string` to `User`.
  - `server/api/auth/handlers/login.ts`, `server/api/magic-link/handlers/verify.ts`, `server/api/onboarding/handlers/complete.ts`: add `role` to the `setUserSession` user object.
  - `server/api/me/handlers/savePreferences.ts`: no change (carries `role` through the spread); noted to prevent a redundant edit.
  - `server/routes/auth/google.get.ts`: no change; flagged as dead scaffolding.
  - `nuxt.config.ts`: add `profile`, `settings`, and `admin-users` to the `i18n.pages` map.
  - `i18n/locales/fr.json` and `i18n/locales/en.json`: add `header.settings` and `header.manageUsers`.
- **No migration.** `role` already exists on `users`. Confirm no Drizzle migration is generated.
- **Docs to reconcile when this lands:** `docs/spec.md` §13 (settled grouping supersedes the listed order, the atmosphere picker is documented as part of Preferences, and the icon family is Phosphor not Carbon). `docs/TODO.md` item 0's "unfinished hand-written WIP in header.vue" warning is **stale**: the tree is clean and the current header is the committed pipeline-built version. Do not treat `header.vue` as WIP to discard.
- This is the specs stage only. No implementation code is written here, and no later stage runs until the owner confirms this spec is correct.
