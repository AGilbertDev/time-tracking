import { del as blobDel, get as blobGet, put as blobPut } from '@vercel/blob'

import { avatarBlobPath } from '../models/profile'

// The single module that talks to a storage backend for avatar bytes. Upload, serve, remove, and the
// retention purge all go through here, so there is no scattered direct blob access and no environment
// can write to the wrong store. The storage key is always derived from userId inside this util via
// avatarBlobPath(userId); no caller ever passes a path, URL, or client-supplied identifier, which is
// what makes the whole feature IDOR-proof by construction.
//
// Two drivers, selected once and environment-driven (see resolveDriver):
//   - fs   -> local filesystem under the gitignored .data/ folder (development). No token needed and
//            the production store is never contacted. The unconfigured guard does not apply.
//   - blob -> private Vercel Blob (production). access: 'private' means the object has no directly
//            <img>-loadable URL, which is why the authenticated serve route exists.

type AvatarStorageDriver = 'blob' | 'fs'

// Nitro storage mount for the dev filesystem driver, configured in nuxt.config (nitro.storage). The
// mount base is ./.data, and the item key is avatarBlobPath(userId) = avatars/{id}.webp, so files
// land in .data/avatars/{id}.webp. The mount name is an internal handle and is not part of the path.
const AVATAR_FS_MOUNT = 'avatarStore'

// Single-sourced, environment-driven driver selection. An explicit NUXT_AVATAR_STORAGE_DRIVER
// ('fs' | 'blob') wins so the blob driver can be exercised locally against a scratch store or the fs
// driver forced in a non-prod deploy. When unset, the default is fs in the dev server and blob
// everywhere else. import.meta.dev is true only under `nuxt dev`, so a production build can never
// silently fall back to the filesystem.
function resolveDriver(): AvatarStorageDriver {
  const configured = (useRuntimeConfig().avatarStorageDriver as string | undefined)?.trim()
  if (configured === 'fs' || configured === 'blob') return configured
  return import.meta.dev ? 'fs' : 'blob'
}

function blobToken(): string {
  return (useRuntimeConfig().blobReadWriteToken as string) || ''
}

// Fail closed for the blob driver: with no token configured, a write stores nothing and surfaces a
// 500 rather than attempting a store. Only the blob driver raises this; the fs driver needs no token.
function requireBlobToken(): string {
  const token = blobToken()
  if (!token) {
    throw createError({ statusCode: 500, statusMessage: 'avatar_storage_unconfigured' })
  }
  return token
}

// Store (overwrite in place) the processed bytes for a user at the deterministic per-user key.
async function put(userId: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void> {
  const key = avatarBlobPath(userId)
  // Normalize to a Node Buffer so both the fs driver (setItemRaw) and the blob driver (PutBody)
  // accept the payload; a Uint8Array is not a PutBody member.
  const body = Buffer.from(bytes)

  if (resolveDriver() === 'fs') {
    await useStorage(AVATAR_FS_MOUNT).setItemRaw(key, body)
    return
  }

  await blobPut(key, body, {
    access: 'private',
    contentType,
    token: requireBlobToken(),
    addRandomSuffix: false,
    allowOverwrite: true
  })
}

// Return the stored bytes for a user, or null when nothing is stored. A read never applies the
// unconfigured fail-closed guard: a missing token yields null (the serve route turns that into a 404)
// so no bytes leak and the read is always safe.
async function get(userId: string): Promise<Uint8Array | null> {
  const key = avatarBlobPath(userId)

  if (resolveDriver() === 'fs') {
    const raw = (await useStorage(AVATAR_FS_MOUNT).getItemRaw(key)) as
      | Buffer
      | Uint8Array
      | null
      | undefined
    return raw ?? null
  }

  const token = blobToken()
  if (!token) return null

  // useCache: false reads fresh from origin storage rather than a cached CDN copy, so a just-replaced
  // avatar is never stale. This is the documented consistency mitigation for overwriting a stable
  // pathname (@vercel/blob >= 2.3). get() resolves to null when the object does not exist.
  const result = await blobGet(key, { access: 'private', useCache: false, token })
  if (!result || result.statusCode !== 200) return null

  return Buffer.from(await new Response(result.stream).arrayBuffer())
}

// Delete a user's stored object. A missing object is a safe no-op on both drivers.
async function del(userId: string): Promise<void> {
  const key = avatarBlobPath(userId)

  if (resolveDriver() === 'fs') {
    const storage = useStorage(AVATAR_FS_MOUNT)
    if (await storage.hasItem(key)) await storage.removeItem(key)
    return
  }

  await blobDel(key, { token: requireBlobToken() })
}

// Exported as a single object rather than three top-level functions so Nitro's server/utils
// auto-import does not create generic globals named put/get/del that would collide across the server.
export const avatarStorage = { put, get, del }
