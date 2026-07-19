import { z } from 'zod'

// The identity name-field validator, extracted so onboarding and the profile page share one
// source and the bounds cannot drift between them. The rule is the onboarding one, unchanged:
// trimmed, required (at least one character), and at most 100 characters. Reused for both the
// first and last name because they carry the same policy.
export const nameFieldSchema = z.string().trim().min(1).max(100)

// Partial PATCH body for /api/me/profile. Every field is optional so the client sends only what
// changed, each reusing the shared name validator, and the refine rejects an empty object so a
// client bug cannot send a meaningless write. Mirrors PreferencesPatchSchema. The email is not
// part of this contract: it is the login key and is never accepted or written by this route.
export const ProfilePatchSchema = z
  .object({
    firstName: nameFieldSchema.optional(),
    lastName: nameFieldSchema.optional()
  })
  .refine((body) => body.firstName !== undefined || body.lastName !== undefined, {
    message: 'At least one profile field must be provided.'
  })

export type ProfilePatch = z.infer<typeof ProfilePatchSchema>

// Avatar upload policy. These are policy constants, not a Zod body schema, because the payload is a
// binary multipart part rather than a JSON body (see the avatar-upload spec). The upload handler
// validates them directly and returns the same 422 shape the rest of `me` uses.

// The field name of the single file part in the multipart/form-data upload body.
export const AVATAR_UPLOAD_FIELD = 'file'

// Maximum raw upload size, checked against the received buffer length rather than a client-declared
// Content-Length header so a lying header cannot bypass it.
export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024

// Allowed client-declared mime hints. Treated as a hint only; the real bytes are re-verified with
// sharp against AVATAR_ALLOWED_IMAGE_FORMATS below.
export const AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

// The decoded image formats sharp is allowed to report. SVG is deliberately excluded even though
// sharp can rasterize it, because it can carry script. The values match sharp's metadata.format.
export const AVATAR_ALLOWED_IMAGE_FORMATS = ['jpeg', 'png', 'webp'] as const

// The processed output is always a centered-cover square WebP at this edge length.
export const AVATAR_OUTPUT_SIZE = 256

// Decompression-bomb ceiling. A small compressed file can decode to an enormous pixel canvas, and
// decoding it would allocate roughly 4 bytes per pixel, which can OOM a serverless function. sharp
// defaults to ~268 MP; we cap far lower since an avatar source never needs more. 50 MP still covers
// any real camera or phone photo. sharp throws past this, and the handler maps that to a 422.
export const AVATAR_MAX_INPUT_PIXELS = 50 * 1_000_000

// The deterministic per-user storage path. One object per user, overwritten in place, so a user
// never accumulates orphaned blobs on the happy path.
export function avatarBlobPath(userId: string): string {
  return `avatars/${userId}.webp`
}

// Reason codes returned as `data.file` on a 422 so the frontend can map each to its own i18n
// message: too-large -> profile.avatar.error.tooLarge, wrong-type -> .error.type,
// undecodable -> .error.corrupt.
export type AvatarRejectionReason = 'too-large' | 'undecodable' | 'wrong-type'
