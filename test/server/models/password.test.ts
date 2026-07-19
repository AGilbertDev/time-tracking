import { PasswordChangeSchema, PasswordSchema } from '~~/server/models/password'
import { describe, expect, it } from 'vitest'

// PasswordSchema and PasswordChangeSchema are the validation boundary for PATCH /api/me/password.
// Every expected bound, field requirement, and refine below is derived from
// docs/specs/settings/settings-page.md (the "Shared validator extraction" and "PATCH
// /api/me/password" data contract, plus acceptance criteria 11, 12, 14), not from the code. The
// spec fixes: newPassword follows the shared PasswordSchema (min 8, max 200, no composition rules),
// currentPassword and confirmNewPassword are non-empty strings, and the confirmation-mismatch
// refine reports on the confirmNewPassword path. A drift from any of these fails here.

// A fully valid body; individual tests clone and override one field so a single value is what fails.
const validBody = {
  currentPassword: 'old-password-123',
  newPassword: 'brand-new-password',
  confirmNewPassword: 'brand-new-password'
} as const

function body(overrides: Record<string, unknown> = {}) {
  return { ...validBody, ...overrides }
}

// PasswordSchema is the shared field policy; PasswordChangeSchema.newPassword reuses it, so the
// same bounds must hold in isolation. Onboarding imports the same schema, so this locks the policy
// both flows share.
describe('PasswordSchema', () => {
  it('accepts a password of exactly 8 characters (lower bound)', () => {
    expect(PasswordSchema.safeParse('a'.repeat(8)).success).toBe(true)
  })

  it('rejects a password of 7 characters (below the minimum)', () => {
    expect(PasswordSchema.safeParse('a'.repeat(7)).success).toBe(false)
  })

  it('accepts a password of exactly 200 characters (upper bound)', () => {
    expect(PasswordSchema.safeParse('a'.repeat(200)).success).toBe(true)
  })

  it('rejects a password of 201 characters (above the maximum)', () => {
    expect(PasswordSchema.safeParse('a'.repeat(201)).success).toBe(false)
  })

  // No composition rules per NIST SP 800-63B: an all-lowercase, no-symbol string of sufficient
  // length is accepted. Strength comes from length plus the breach check, never a character mix.
  it('accepts a length-valid password with no composition variety', () => {
    expect(PasswordSchema.safeParse('aaaaaaaaaa').success).toBe(true)
  })

  it('surfaces the too-short message on the min failure', () => {
    const result = PasswordSchema.safeParse('short')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Password must be at least 8 characters.')
  })
})

describe('PasswordChangeSchema', () => {
  it('accepts a fully valid body', () => {
    const result = PasswordChangeSchema.safeParse(validBody)

    expect(result.success).toBe(true)
    expect(result.data).toEqual(validBody)
  })

  describe('newPassword length bounds (NIST 8-200, no composition rules)', () => {
    it('rejects a new password shorter than 8 characters', () => {
      const result = PasswordChangeSchema.safeParse(
        body({ newPassword: 'short7!', confirmNewPassword: 'short7!' })
      )
      expect(result.success).toBe(false)
    })

    it('accepts a new password of exactly 8 characters', () => {
      const eight = 'a'.repeat(8)
      const result = PasswordChangeSchema.safeParse(
        body({ newPassword: eight, confirmNewPassword: eight })
      )
      expect(result.success).toBe(true)
    })

    it('rejects a new password longer than 200 characters', () => {
      const long = 'a'.repeat(201)
      const result = PasswordChangeSchema.safeParse(
        body({ newPassword: long, confirmNewPassword: long })
      )
      expect(result.success).toBe(false)
    })

    it('accepts a new password of exactly 200 characters', () => {
      const twoHundred = 'a'.repeat(200)
      const result = PasswordChangeSchema.safeParse(
        body({ newPassword: twoHundred, confirmNewPassword: twoHundred })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('all three fields required', () => {
    it('rejects an empty currentPassword', () => {
      expect(PasswordChangeSchema.safeParse(body({ currentPassword: '' })).success).toBe(false)
    })

    it('rejects a missing currentPassword', () => {
      const { currentPassword: _omit, ...rest } = validBody
      expect(PasswordChangeSchema.safeParse(rest).success).toBe(false)
    })

    it('rejects a missing newPassword', () => {
      const { newPassword: _omit, ...rest } = validBody
      expect(PasswordChangeSchema.safeParse(rest).success).toBe(false)
    })

    it('rejects a missing confirmNewPassword', () => {
      const { confirmNewPassword: _omit, ...rest } = validBody
      expect(PasswordChangeSchema.safeParse(rest).success).toBe(false)
    })
  })

  describe('confirmation mismatch refine', () => {
    // Spec: the confirmation is validated server-side, independent of the client, and the error is
    // reported on the confirmNewPassword field so the client can bind it there.
    it('rejects a confirmation that does not match the new password', () => {
      const result = PasswordChangeSchema.safeParse(
        body({ newPassword: 'brand-new-password', confirmNewPassword: 'different-password' })
      )
      expect(result.success).toBe(false)
    })

    it('reports the mismatch on the confirmNewPassword path with the contract message', () => {
      const result = PasswordChangeSchema.safeParse(
        body({ newPassword: 'brand-new-password', confirmNewPassword: 'different-password' })
      )

      expect(result.success).toBe(false)
      const mismatch = result.error?.issues.find((issue) => issue.path[0] === 'confirmNewPassword')
      expect(mismatch).toBeDefined()
      expect(mismatch?.message).toBe('Password confirmation must match the new password.')
    })

    // An empty confirmation fails the min(1) before the refine; either way the body is rejected.
    it('rejects an empty confirmNewPassword', () => {
      expect(PasswordChangeSchema.safeParse(body({ confirmNewPassword: '' })).success).toBe(false)
    })
  })
})
