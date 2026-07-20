# Avatar upload and private storage

## Intent

The Profile page renders an initials-only avatar and left `users.avatar_url` unwired (see `docs/specs/settings/profile-page.md`). This feature delivers the deferred avatar: the signed-in user chooses a photo for their own avatar, previews it locally before storing, replaces it, or removes it and falls back to the initials circle. The stored image then renders everywhere the avatar appears (the header trigger, the header account popover, and the Profile page).

An avatar photo is personal data. It ships **private and authenticated from the start**: the image bytes live in the owner's private Vercel Blob store in production and are served only to their owner through an authenticated same-origin route, never from a directly loadable public URL. There is no public store to migrate away from; this is the first and only shape the feature takes.

Because the private production store must never be written to from a developer machine, storage goes through a thin server-side abstraction with two drivers selected by environment: a local filesystem folder in development and private Vercel Blob in production. Every place that touches avatar bytes (upload, serve, remove, retention purge) goes through this one util so there is no scattered direct blob access and no environment can write to the wrong store.

The write surface is small and scoped to the session user, mirroring the identity write already in place. All logic follows the existing `me` conventions: thin routes delegating to `handlers/`, `defineAuthenticatedEventHandler`, the typed `422` error shape, and write-then-refresh-session.

See `docs/specs/settings/profile-page.md` (the parent feature this resolves), `app/pages/profile.vue` (the page this extends), `app/components/app/account-avatar.vue` (the shared initials circle that gains an image mode), `app/components/app/header.vue` (the two other render sites), `server/models/profile.ts` (where the upload validators and path helper live), and `server/db/schema.ts` (`users.avatar_url`, the existing nullable target column).

## Provenance

The implementation is **adapted from existing uncommitted work** already in the tree (the public-blob upload, remove, and purge handlers, the Profile controls, and the `account-avatar` image mode), not written from scratch. This spec re-frames that work to the private, environment-driven storage design described below. The substantive changes over the uncommitted draft are: a storage-driver abstraction (`server/utils/avatarStorage.ts`), a private blob store in production and a filesystem store in development, a new authenticated serve route, and a same-origin proxy representation in `users.avatar_url` instead of a public blob URL. It ships as **one pull request**.

## Scope

In scope:

- A **storage-driver util** (`server/utils/avatarStorage.ts`) exposing `put(userId, bytes, contentType)`, `get(userId)`, and `del(userId)`, backed by a filesystem driver in dev and a private Vercel Blob driver in prod, selected by environment. Every avatar byte operation goes through it.
- An **authenticated upload endpoint** (`PUT /api/me/avatar`) accepting one image as `multipart/form-data`, processing it into a 256×256 WebP, storing it through the util, persisting a same-origin proxy path to `users.avatar_url`, and refreshing the session.
- A **new authenticated serve endpoint** (`GET /api/me/avatar`) that streams the session user's own stored avatar bytes with private cache and content-type-hardening headers, or `404` when none is stored.
- An **authenticated remove endpoint** (`DELETE /api/me/avatar`) that deletes the stored object through the util and nulls `users.avatar_url`, reverting to the initials circle, then refreshes the session.
- **Retention-purge erasure** routed through the util so a purged user's avatar object is deleted with no direct blob call.
- **`avatarUrl` on the session.** The session `User` type already carries `avatarUrl: string | null`; it is populated at every full session-build site from `users.avatar_url` (already wired at login, magic-link verify, and onboarding).
- **`account-avatar` image mode** (already present): render the stored image when an avatar URL is present, else the initials circle, unchanged at all three call sites.
- **Profile-page controls** (already present): a file picker with a live local preview, a save action with pending and error states, a cancel action, and a remove action shown only when an avatar is set.
- i18n string keys under the `profile` namespace (FR default, EN present); wording researched at the frontend stage.
- The `@vercel/blob` and `sharp` dependencies (already installed) and the `runtimeConfig.blobReadWriteToken` token (already declared).

Out of scope (do not build):

- Editing name or email (owned by the parent Profile spec).
- Cropping, rotation, filters, or multi-image galleries. The server does a fixed centered square cover-crop; the user does not position it.
- Avatars for any user other than the session user. No admin avatar editing.
- A general asset/upload framework. This builds exactly one avatar flow behind one narrow util.
- Avatar history. One object per user, overwritten in place; the previous image is discarded on replace.

## Storage-driver design (core decision)

A single util, `server/utils/avatarStorage.ts`, is the only module in the codebase that talks to a storage backend for avatars. It exposes exactly three async operations, all keyed by `userId`:

- `put(userId, bytes, contentType)` — store (overwrite in place) the processed bytes for that user.
- `get(userId)` — return the stored bytes for that user, or `null` when nothing is stored.
- `del(userId)` — delete that user's stored object; a missing object is a safe no-op.

The storage key is always derived from `userId` inside the util, using the existing deterministic `avatarBlobPath(userId)` (`avatars/{userId}.webp`). No caller ever passes a raw path, URL, or client-supplied identifier, which is what makes the whole feature IDOR-proof by construction.

### Two drivers

- **Development driver → local filesystem.** Uses Nitro `useStorage` / unstorage's `fs` driver mounted on a gitignored folder (`.data/avatars/`, already covered by `.data` in `.gitignore`). No Vercel token is needed locally, and dev never writes to the production store. The `avatar_storage_unconfigured` guard does **not** apply to this driver.
- **Production driver → private Vercel Blob.** `put` / `get` / `del` against Vercel Blob with `access: 'private'`, the token read from `runtimeConfig.blobReadWriteToken` (env override `NUXT_BLOB_READ_WRITE_TOKEN`) and passed explicitly, never from ambient `process.env`. A private object has no directly `<img>`-loadable URL, which is why the serve route (below) exists. Reads should fetch fresh from origin rather than a cached CDN copy so a just-replaced avatar is never stale (see Consistency).

### Driver selection

The selection mechanism must be stated plainly in code, not inferred implicitly at each call site. The proposed default is `import.meta.dev` → filesystem driver, otherwise the Vercel Blob driver. An explicit `runtimeConfig` flag that defaults by environment but can be overridden (for example to exercise the blob driver locally against a scratch store, or to force the fs driver in a non-prod deploy) is acceptable and preferred if it stays simple. The design agent finalizes the exact mechanism; the requirement is that selection is single-sourced in the util, environment-driven, and overridable, and that production can never silently fall back to the filesystem.

### The `avatar_storage_unconfigured` guard

The fail-closed `500` for a missing token applies **only to the Vercel Blob driver**. When the blob driver is selected and no token is configured, `put` / `del` throw `avatar_storage_unconfigured` (`500`) and store nothing. The filesystem driver needs no token and never raises this guard.

## Route and gating

- All three routes live under `server/api/me/` and are thin, delegating to handlers in `server/api/me/handlers/`, mirroring `profile.patch.ts` → `updateProfile.ts`.
- Every route enforces the session **in the request path**, through `defineAuthenticatedEventHandler` (which runs `requireUserSession` per route) — not through global middleware. This matters most for the serve route: private-blob authorization must be checked in the handler, and an unauthenticated request is `401` before any storage read.
- The target user is always the session `user.id`. No id, path, or key is ever read from the request. A user can only ever read, change, or remove their own avatar. There is no admin gate.
- Endpoints:
  - Upload: `PUT /api/me/avatar` → `server/api/me/avatar.put.ts` → `handlers/uploadAvatar.ts`.
  - Serve: `GET /api/me/avatar` → `server/api/me/avatar.get.ts` → `handlers/serveAvatar.ts` (new).
  - Remove: `DELETE /api/me/avatar` → `server/api/me/avatar.delete.ts` → `handlers/removeAvatar.ts`.

## Inputs

### Upload (`PUT /api/me/avatar`)

- **Session user** (from the wrapper): supplies `user.id` (storage key and row to update) and the current `user.avatarUrl`.
- **Body**: `multipart/form-data` with exactly one file part (field name `file`), read with `readMultipartFormData(event)`. No JSON body. The client-declared part `type` is a hint only and is re-verified server-side.

### Serve (`GET /api/me/avatar`)

- **Session user** only. Supplies `user.id`, from which the storage key is derived. Any `?v=` query is a cache-busting token only and is ignored by the handler. No other input is read.

### Remove (`DELETE /api/me/avatar`)

- **Session user** only. No body. The handler resolves `user.id` and the current `user.avatarUrl`.

### Frontend (Profile page)

- **File picker** (user-initiated), constrained to images, feeding a live local preview and the save action.
- **Save action**: sends the chosen file to `PUT /api/me/avatar`.
- **Cancel action**: discards the staged file and preview.
- **Remove action**: sends `DELETE /api/me/avatar`, shown only when the session carries an avatar URL and nothing is staged.

## Data contract

### Validation model (`server/models/profile.ts`)

Policy constants, not a Zod body schema, because the payload is binary multipart rather than JSON:

- **Allowed decoded formats**: `jpeg`, `png`, `webp` (SVG deliberately excluded; it can carry script). The client-declared mime is a hint only.
- **Maximum upload size**: 5 MB, checked against the received buffer length, not a client header.
- **Decompression-bomb ceiling**: `AVATAR_MAX_INPUT_PIXELS` caps the decoded pixel canvas so a small file cannot OOM the function.
- **Output**: a centered-cover square WebP at `AVATAR_OUTPUT_SIZE` (256) px.
- **Path helper**: `avatarBlobPath(userId)` → `avatars/{userId}.webp`, used only inside the storage util.
- **Rejection reasons** returned as `data.file` on a `422`: `too-large`, `wrong-type`, `undecodable`, mapped to distinct i18n messages.

### Avatar URL representation (display)

`users.avatar_url` stores a **same-origin proxy path**, not a store URL. On a successful upload the column is set to `/api/me/avatar?v=<version>`, where `<version>` is a cache-busting token keyed to that upload (for example the upload's millisecond timestamp). On remove it is set to `null`.

- The session `avatarUrl` mirrors the column, and `account-avatar` binds it as the `<img src>`. Because the path is same-origin, the browser sends the session cookie automatically, so the authenticated serve route receives the session on the image request with no extra wiring.
- Storing the full versioned proxy path (rather than a bare version token in a separate column) keeps the existing idiom completely intact: the column holds a string, the session mirrors it, the component binds it, and a non-null value still means "has avatar". The only change from the draft is that the string is now a same-origin proxy path instead of a blob URL.
- The `?v=` token changes only on upload. A name edit through `updateProfile` writes `first_name`/`last_name`/`updated_at` but never touches `avatar_url`, and the session merge preserves it, so an unrelated profile edit does not rebust the avatar. This is the chosen representation; the design/backend stage confirms it and may substitute an equivalent one only if it preserves this idiom.

### `PUT /api/me/avatar` (handler `uploadAvatar.ts`)

1. `requireUserSession`; resolve `user.id`.
2. When the Vercel Blob driver is active and its token is unset, fail closed with `500 avatar_storage_unconfigured` before reading the body. (No-op for the fs driver.)
3. Read the multipart body; reject `422 wrong-type` if there is not exactly one non-empty `file` part.
4. Size check against the received buffer; reject `422 too-large` past 5 MB.
5. Content verification: decode with `sharp` and read the real format; reject `422 undecodable` if it cannot decode, `422 wrong-type` if the real format is not jpeg/png/webp.
6. Process: `.rotate()` (auto-orient from EXIF), centered cover-crop, resize 256×256, encode WebP, drop all source metadata (removes any EXIF/GPS; also data minimization). Target ~10–30 KB.
7. **Store** through `avatarStorage.put(user.id, processed, 'image/webp')` (overwrite in place at the deterministic key).
8. **Persist**: set `users.avatar_url = '/api/me/avatar?v=<version>'` and `updated_at` for `user.id`.
9. **Refresh the session**: `setUserSession(event, { user: { ...user, avatarUrl } })`.
10. Return `200 { avatarUrl }`.

Because storage is now a single deterministic object per user keyed only by `userId`, the previous public-blob "old object at a different path" cleanup branch is no longer needed and is removed.

### `GET /api/me/avatar` (handler `serveAvatar.ts`, new)

1. `requireUserSession` **in the handler**; `401` without a session. Do not rely on middleware for this route's authorization.
2. Derive the key from the session `user.id` only. Never read an id, path, or key from the request; the `?v=` query is ignored.
3. `const bytes = await avatarStorage.get(user.id)`. When `null`, respond `404` (`setResponseStatus(event, 404)`) and return.
4. Set response headers with H3 primitives (`setResponseHeader`): `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-cache`.
5. Return the bytes. Avatars are ~10–30 KB, so returning the buffer directly is fine; streaming (`sendStream` / a web stream) is an equally acceptable implementation choice, not a requirement.
6. **Optional 304**: for the blob driver, if `get` can surface a stable `ETag`, read `getRequestHeader(event, 'if-none-match')` and respond `304` on a match, else set `ETag`. This optimization may be skipped entirely (in particular for the fs driver) given the tiny payload; it is documented as optional and not part of acceptance.

### `DELETE /api/me/avatar` (handler `removeAvatar.ts`)

1. `requireUserSession`; resolve `user.id` and `user.avatarUrl`.
2. If `user.avatarUrl` is already `null`, return `200 { avatarUrl: null }` (idempotent no-op; no storage call).
3. Fail-closed token guard for the blob driver only, as in upload.
4. Null `users.avatar_url` (and set `updated_at`) first, so the app never references an object it is about to delete.
5. `await avatarStorage.del(user.id)`. A delete failure after the column is nulled is logged and swallowed; the row is already correct and the leftover object is unreferenced and overwritten by any future upload.
6. Refresh the session with `avatarUrl: null`.
7. Return `200 { avatarUrl: null }`.

### Retention purge (`server/api/cron/purge-deactivated.get.ts`)

For each purged user, call `avatarStorage.del(userId)` instead of a direct `@vercel/blob` `del`. A missing object or a delete failure is swallowed; the row deletion is the primary purge and the deterministic key means a leftover object is unreachable once the row is gone. No behavior change beyond routing through the util.

### Ordering and compensation (no invalid states)

- **Upload: store, then row.** Store first; only on success write the column. If the store fails, nothing is persisted and the old avatar (or initials) remains. If the store succeeds but the row write fails, the object is orphaned but self-healing (the next upload overwrites the same key); the handler additionally attempts a compensating `avatarStorage.del(user.id)` and returns `500`. `users.avatar_url` never points at a missing object.
- **Remove: row, then object.** Null the column first, then delete. A column-update failure changes nothing and the user retries. A delete failure after nulling still leaves the correct end state; a repeat remove is a safe no-op.
- The deterministic per-user key means a fresh upload always reconverges the stored object and the row regardless of any prior partial failure.

### Response shapes

- `PUT` success `200`: `{ avatarUrl: string }`.
- `GET` success `200`: `image/webp` bytes; `404` when none stored; `401` without a session; optional `304`.
- `DELETE` success `200`: `{ avatarUrl: null }`.
- Validation failures `422` with `data: { file: <reason> }`, reasons distinguishing `too-large`, `wrong-type`, `undecodable`.
- Missing token (blob driver), store failure, or row-write failure surface as `500`.

## Outputs and acceptance criteria

1. On the Profile page an authenticated user can choose an image and see a **live local preview** in the avatar before anything is uploaded; choosing a different file replaces the preview.
2. Uploading a valid image (jpeg/png/webp, ≤ 5 MB) calls `PUT /api/me/avatar`, stores a processed 256×256 WebP through the storage util, sets `users.avatar_url` to a same-origin proxy path, returns `{ avatarUrl }`, and the avatar renders in the **header trigger, the header account popover, and the Profile page** immediately, without a re-login or hard refresh.
3. The stored object is a square 256×256 WebP of ~10–30 KB regardless of input dimensions or aspect ratio, produced by a centered cover-crop with source metadata stripped.
4. **Private, authenticated serve.** `GET /api/me/avatar` returns the session user's own avatar bytes only. It enforces the session **in the handler** and returns `401` with no session, `404` when no object is stored, and on success sends `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-cache`. The stored object is never exposed as a directly loadable public URL.
5. **No IDOR.** The served (and stored, and deleted) object is always keyed from the session `user.id`; no id, path, or key is ever read from the request, and `?v=` is treated as an opaque cache-buster. No request can address another user's avatar.
6. **Dev filesystem driver.** In development, `put` / `get` / `del` operate on the gitignored `.data/avatars/` folder via `useStorage`, no Vercel token required, and the production blob store is never contacted. The `avatar_storage_unconfigured` guard does not fire for this driver.
7. **Prod private blob driver.** In production, `put` / `get` / `del` operate on Vercel Blob with `access: 'private'`, the token read from `runtimeConfig` and passed explicitly. With no token configured, upload and remove fail closed with `500 avatar_storage_unconfigured` and store nothing.
8. **Single storage surface.** The upload handler, serve handler, remove handler, and purge cron all go through `server/utils/avatarStorage.ts`. No `@vercel/blob` import remains in any of the four call sites.
9. A non-image file, a real format other than jpeg/png/webp (including a spoofed content type), or an undecodable/corrupt image is rejected with `422` and nothing is stored or written. A file over 5 MB is rejected with `422` before any processing.
10. When an avatar is set, a **Remove** control is shown; activating it calls `DELETE /api/me/avatar`, deletes the object through the util, nulls the column, and reverts to the initials circle in all three places immediately. When none is set, no Remove control is shown and calling remove anyway is a safe `200` no-op.
11. **Erasure.** The retention purge deletes each purged user's stored avatar object through the util, leaving no orphan.
12. `account-avatar` renders the stored image when an avatar URL is present and the initials circle otherwise, unchanged at all three call sites, including for a user with no name.
13. **No invalid state.** After any single failure (store, row write, delete) the system is either fully unchanged or recoverable by retry, and `users.avatar_url` never references a missing object. The upload and remove orderings hold.
14. **No new column and no migration.** `users.avatar_url` already exists (nullable). The absence of a migration is an acceptance criterion.
15. **Reuse, not reinvention.** The thin-route + `handlers/` split, `defineAuthenticatedEventHandler`, the `422` shape, and write-then-refresh-session all match existing `me` endpoints. `sharp`, `@vercel/blob`, and unstorage are used through their documented APIs.
16. **i18n.** Every visible label and message is an i18n key under `profile`, FR default and EN present, no hardcoded strings, French spacing before `? ! : ;`. All new strings are proposals pending owner verification (the user is a professional translator).
17. **Separation of concerns.** Client in `app/`, routes and handlers in `server/`, storage in `server/utils/`, policy constants in `server/models/`. Routes stay thin.
18. **Do not police the user.** A valid image is never blocked; validation rejects only genuinely invalid input.

## Edge cases and failure branches

- **Oversized file**: `422` before processing, checked against the received buffer so a lying `Content-Length` cannot bypass it.
- **Wrong or spoofed mime**: a renamed non-image, or a real GIF/SVG/HEIC sent as `image/png`, is caught by decoding the actual bytes; `422`. SVG is rejected even though `sharp` could rasterize it.
- **Corrupt/undecodable image**: `sharp` fails to read; `422`; nothing stored.
- **Store failure** (network, quota, bad/missing token on the blob driver): nothing persisted, previous avatar/initials remain, user gets a retry error; no dangling reference.
- **Row write fails after a successful store**: orphaned object is self-healing and the handler attempts a compensating `del`; user gets `500` and retries from a clean state.
- **Delete fails during remove** after the column is nulled: end state is correct from the user's view; the stray object is unreferenced and overwritten by any future upload; a repeat remove is a safe no-op.
- **Remove when none is set**: `avatar_url` already `null`; `200 { avatarUrl: null }`, no storage call.
- **Serve when no object exists** (column set but object missing, or a direct hit with no avatar): `404`, not a `500` or an empty `200`.
- **Serve without a session** (expired or missing cookie, or a hotlink from another origin that carries no cookie): `401`; no bytes leak. A page navigation is redirected to the locale sign-in route by the session middleware; the `<img>` request itself simply fails to load and the initials show on the next render.
- **Upload chosen but never submitted**: the preview is a local object URL; navigating away revokes it and writes nothing; the stored avatar is untouched.
- **Session expires mid-upload**: `requireUserSession` returns `401`, nothing is stored, and the user retries after re-authenticating.
- **Account deactivated mid-session**: the wrapper `401`s the call; the upload cannot proceed on a deactivated account (fail closed).
- **Stale session avatar across devices**: `avatarUrl` lives on the per-device sealed session cookie, so a change on device A is not reflected on device B until it re-renders from a refreshed session; the database holds the authoritative last write. This matches existing name/preferences behavior.
- **Concurrent uploads to the same key** (two tabs/devices): both write the deterministic key with overwrite, so last-write-wins on both the object and the row, ending consistent with no per-user accumulation.

## Consistency (CDN staleness)

Overwriting the same blob pathname can serve a stale CDN copy for up to ~60 s. Two mitigations, used together:

- The same-origin proxy URL carries a `?v=<version>` that changes on every upload, so the browser always requests the fresh representation after a replace.
- The blob-driver read in `avatarStorage.get` fetches fresh from origin rather than a cached CDN copy (for example the read's `useCache: false` equivalent), so the proxy route returns the just-written bytes immediately. The design/backend stage confirms the exact option name for the installed `@vercel/blob`.

The fs driver has no CDN and needs neither mitigation beyond the `?v=` bust.

## Compliance handoff

An avatar photo is personal data under Québec Law 25 and the GDPR, and it is the first user-supplied file this app stores. This design is materially stronger than a public-URL avatar, and the earlier **"avatars are effectively public" caveat is now resolved**:

- **Private and authenticated.** Bytes are served only to their owner through `GET /api/me/avatar`, which enforces the session **in the handler** (not middleware-only), keys strictly off the session `user.id` (**no IDOR**), sends `X-Content-Type-Options: nosniff`, and marks the response `Cache-Control: private, no-cache` so personal data is not shared-cached. The stored object has no directly loadable public URL.
- **Data minimization.** Only the processed 256×256 WebP is stored; the original upload is not retained and source metadata (including any EXIF GPS) is stripped. Confirm no original bytes are logged or cached.
- **Right to erasure.** Remove deletes the object and nulls the column, and the retention purge deletes each purged user's object through the util, so erasure leaves no orphan.
- **French-language obligation (Law 101).** All avatar copy is bilingual, FR default, French spacing before `? ! : ;`, pending owner wording verification.
- **Cross-border storage.** Confirm the Vercel Blob storage region and whether it raises a Law 25 cross-border-transfer disclosure.

## Dependencies and build notes

- `@vercel/blob` is installed at `^2.6.1`, which satisfies the `>= 2.3` requirement for the server-side `get()` download API used by the serve route.
- `sharp` is installed at `^0.35.3`. It ships a platform-specific native binary. On Vercel's Node serverless runtime it must bundle the correct binary for the build target; Nitro's native-module bundling can ship the wrong platform binary and fail only in the deployed function. **Verify the deployed upload works on Vercel**, not just in the devcontainer, before the feature is done; the documented fallback is marking `sharp` external to the server bundle or pinning the platform binary.
- Verify the private-blob `get` read (and any streaming) works in the deployed Vercel function, since it is exercised only against the real private store, not the fs driver used locally.

## Files

- **New**: `server/utils/avatarStorage.ts` (driver abstraction), `server/api/me/avatar.get.ts`, `server/api/me/handlers/serveAvatar.ts`.
- **Changed**: `server/api/me/handlers/uploadAvatar.ts` (route through the util; store the proxy path; drop the public-URL cleanup branch and direct `@vercel/blob` import), `server/api/me/handlers/removeAvatar.ts` (route through the util), `server/api/cron/purge-deactivated.get.ts` (route through the util), `server/models/profile.ts` (unchanged policy constants; `avatarBlobPath` now used only inside the util), `app/components/app/account-avatar.vue` and `app/pages/profile.vue` (already carry the image mode and controls; verify they bind the proxy path), `app/components/app/header.vue` (passes the avatar URL to the two avatar call sites), `i18n/locales/fr.json` and `en.json` (the `profile.avatar.*` keys).
- **Already in place (no change needed)**: `app/types/auth.d.ts` (`avatarUrl` on the session `User`), the session-build sites `server/api/auth/handlers/login.ts`, `server/api/magic-link/handlers/verify.ts`, and `server/api/onboarding/handlers/complete.ts` (populate/carry `avatarUrl`), `nuxt.config.ts` (`runtimeConfig.blobReadWriteToken`), and `.gitignore` (`.data`). `server/routes/auth/google.get.ts` is a stub that does not build a full `User` session and is out of scope here; if it is ever completed, it must populate `avatarUrl` like the other build sites.

## i18n keys

Wording is researched at the frontend stage, not guessed here: `profile.avatar.label`, `profile.avatar.choose`, `profile.avatar.replace`, `profile.avatar.hint`, `profile.avatar.save`, `profile.avatar.cancel`, `profile.avatar.remove`, `profile.avatar.uploading`, `profile.avatar.removing`, `profile.avatar.uploadSuccess`, `profile.avatar.removeSuccess`, `profile.avatar.error.tooLarge`, `profile.avatar.error.type`, `profile.avatar.error.corrupt`, `profile.avatar.error.generic`.

## Open questions

None are blocking; the design and backend stages can proceed on the decisions above. Items for owner confirmation:

- **(a) Driver-selection mechanism.** Confirm the plain `import.meta.dev` default (fs in dev, private blob in prod) versus an explicit overridable `runtimeConfig` flag. Either is acceptable; the requirement is single-sourced, environment-driven selection that cannot silently fall back to the filesystem in production.
- **(b) `?v=` version source.** Confirm keying the cache-bust to the upload's own timestamp (stable until the next upload) rather than to `users.updated_at` (which changes on unrelated profile edits). The former is proposed.
- **(c) Serve-route 304/ETag.** Confirm leaving conditional-request support out for now (payloads are ~10–30 KB); it is specified as an optional blob-driver-only optimization.
- **(d) Upload ceiling and allowed types.** 5 MB and jpeg/png/webp are the proposed defaults; the owner may adjust.
- **(e) Final FR/EN wording** of the `profile.avatar.*` keys, drafted at the frontend stage for owner review.
