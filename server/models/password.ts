import { z } from 'zod'

// Password policy per NIST SP 800-63B. An 8-character floor and a generous max, with no
// composition rules. Strength comes from length plus a breach check against Have I Been
// Pwned, handled in the handlers. This is the single source for the policy: onboarding and
// the change-password flow both import it, so the bound and messages cannot drift.
export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(200, 'Password is too long.')

// Request body for PATCH /api/me/password. The current password authorizes the change and is
// only required non-empty here; the real authorization is verifyPassword in the handler. The
// new password must satisfy the shared policy, and the confirmation is checked server-side as
// well as client-side so the contract does not rely on the client. The mismatch error is
// reported on confirmNewPassword so the client can bind it to that field.
export const PasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
    confirmNewPassword: z.string().min(1)
  })
  .refine((body) => body.newPassword === body.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: 'Password confirmation must match the new password.'
  })

export type PasswordChange = z.infer<typeof PasswordChangeSchema>
