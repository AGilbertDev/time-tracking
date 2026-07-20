import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'
import sharp from 'sharp'

import type { AvatarRejectionReason } from '../../../models/profile'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'
import {
  AVATAR_ALLOWED_IMAGE_FORMATS,
  AVATAR_MAX_INPUT_PIXELS,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_OUTPUT_SIZE,
  AVATAR_UPLOAD_FIELD
} from '../../../models/profile'
import { avatarStorage } from '../../../utils/avatarStorage'

// One typed 422 for every avatar validation failure. The reason lands in `data.file` (matching the
// shape sendZodError produces) so the frontend maps it to the right i18n message. The payload is a
// binary multipart part, not a JSON body, so per the spec there is no Zod body schema here; the
// checks are imperative but the returned shape is identical to the rest of `me`.
function rejectFile(reason: AvatarRejectionReason): never {
  throw createError({ statusCode: 422, statusMessage: reason, data: { file: reason } })
}

// PUT /api/me/avatar. Accepts one image as multipart/form-data (field `file`), verifies it is a real
// image of an allowed type, processes it into a 256x256 WebP, stores it through avatarStorage at the
// deterministic per-user key, persists a same-origin proxy path to users.avatar_url, and refreshes
// the session. The target is always the session user; no id is read from the request. All storage
// backend access (and the blob-driver token fail-closed guard) lives in avatarStorage.
export async function uploadAvatar(event: H3Event) {
  const { user } = await requireUserSession(event)

  // Read the multipart body and isolate exactly one file part under `file`. Zero or many is a
  // malformed request; the picker guards this client-side but the server is the authority.
  const parts = await readMultipartFormData(event)
  const fileParts = (parts ?? []).filter(
    (part) => part.name === AVATAR_UPLOAD_FIELD && part.filename !== undefined
  )
  if (fileParts.length !== 1) rejectFile('wrong-type')
  const buffer = fileParts[0]!.data
  if (!buffer || buffer.length === 0) rejectFile('wrong-type')

  // Size check against the received buffer length, so a lying Content-Length cannot bypass it.
  if (buffer.length > AVATAR_MAX_UPLOAD_BYTES) rejectFile('too-large')

  // Content verification, not trust: decode the real bytes with sharp. The client-declared part
  // type is never sufficient. A file that sharp cannot read is undecodable; a decodable file whose
  // real format is not one of the allowed raster formats (for example SVG, GIF, HEIC) is wrong-type.
  let format: string | undefined
  try {
    format = (await sharp(buffer, { limitInputPixels: AVATAR_MAX_INPUT_PIXELS }).metadata()).format
  } catch {
    rejectFile('undecodable')
  }
  if (!format || !(AVATAR_ALLOWED_IMAGE_FORMATS as readonly string[]).includes(format)) {
    rejectFile('wrong-type')
  }

  // Process: honor any EXIF orientation first (.rotate() with no arg auto-orients), then a centered
  // square cover-crop to 256x256 and WebP encode. sharp drops all source metadata by default, so
  // the output carries no EXIF (including any GPS), which also serves data minimization.
  let processed: Buffer
  try {
    processed = await sharp(buffer, { limitInputPixels: AVATAR_MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 80 })
      .toBuffer()
  } catch {
    rejectFile('undecodable')
  }

  // No invalid states / safe recovery (spec: "Upload: store, then row"). Store the object first;
  // only on a successful store do we write the row. If the store fails, nothing is persisted and the
  // previous avatar (or initials) remains. The blob-driver token guard fires here, inside put().
  await avatarStorage.put(user.id, processed, 'image/webp')

  // users.avatar_url holds a same-origin proxy path, not a store URL, so account-avatar can bind it
  // as <img src> and the browser sends the session cookie to the authenticated serve route
  // automatically. The ?v= cache-buster is keyed to this upload's own timestamp, so it changes only
  // on upload and an unrelated profile edit never rebusts the avatar.
  const now = new Date()
  const avatarUrl = `/api/me/avatar?v=${now.getTime()}`

  // Persist. If the row update throws after a successful store, the just-written object would be
  // orphaned; it is self-healing (the next upload overwrites the same key) but we compensate by
  // deleting it so nothing is left dangling, then surface a 500 so the user retries from a clean
  // state. users.avatar_url is never left pointing at a missing object.
  try {
    await useDb().update(users).set({ avatarUrl, updatedAt: now }).where(eq(users.id, user.id))
  } catch (error) {
    try {
      await avatarStorage.del(user.id)
    } catch {
      // The orphan self-heals on the next upload at the same deterministic key, so a failed
      // compensating delete is not surfaced to the user.
    }
    throw createError({ statusCode: 500, statusMessage: 'avatar_persist_failed', cause: error })
  }

  // Refresh the session so the header and Profile page render the new image on the next render
  // without a re-login, mirroring updateProfile.
  await setUserSession(event, { user: { ...user, avatarUrl } })

  return { avatarUrl }
}
