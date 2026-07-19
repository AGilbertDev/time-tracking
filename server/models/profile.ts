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
