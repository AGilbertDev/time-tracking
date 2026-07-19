import { nameFieldSchema, ProfilePatchSchema } from '~~/server/models/profile'
import { describe, expect, it } from 'vitest'

// nameFieldSchema and ProfilePatchSchema are the validation boundary for PATCH /api/me/profile.
// Every bound and rule below is derived from docs/specs/settings/profile-page.md (the "Shared
// validator extraction", the "PATCH /api/me/profile" contract, and acceptance criteria 4, 5, 8),
// not from the implementation. The spec fixes: the name policy is the onboarding one, unchanged
// (trim, then min 1, max 100); firstName and lastName are each optional (partial PATCH); a .refine
// rejects an empty object; and the email is never part of this contract. A drift fails here.

describe('nameFieldSchema (trim, then 1-100 chars)', () => {
  it('accepts a normal name', () => {
    expect(nameFieldSchema.safeParse('Alexandre').success).toBe(true)
  })

  it('accepts a single character (lower bound after trim)', () => {
    expect(nameFieldSchema.safeParse('A').success).toBe(true)
  })

  it('accepts exactly 100 characters (upper bound)', () => {
    expect(nameFieldSchema.safeParse('a'.repeat(100)).success).toBe(true)
  })

  it('rejects 101 characters (above the maximum)', () => {
    expect(nameFieldSchema.safeParse('a'.repeat(101)).success).toBe(false)
  })

  // Trim happens before the length check. An empty string, or one that is only whitespace, trims
  // to nothing and fails the min(1). This is the "name cleared to empty" guard: rejected, not
  // stored, so the identity display and avatar initials stay coherent.
  it('rejects an empty string', () => {
    expect(nameFieldSchema.safeParse('').success).toBe(false)
  })

  it('rejects a whitespace-only string (trims to empty)', () => {
    expect(nameFieldSchema.safeParse('   ').success).toBe(false)
  })

  // Trim runs before length, so surrounding whitespace is stripped and the stored value is the
  // trimmed one. A name padded to 102 raw characters but trimming to 100 is accepted and stored
  // trimmed.
  it('trims surrounding whitespace and stores the trimmed value', () => {
    const result = nameFieldSchema.safeParse('  Alexandre  ')
    expect(result.success).toBe(true)
    expect(result.data).toBe('Alexandre')
  })

  it('accepts a value that is 100 characters only after trimming', () => {
    const padded = `  ${'a'.repeat(100)}  `
    const result = nameFieldSchema.safeParse(padded)
    expect(result.success).toBe(true)
    expect(result.data).toBe('a'.repeat(100))
  })

  it('rejects a value that is still over 100 characters after trimming', () => {
    const result = nameFieldSchema.safeParse(`  ${'a'.repeat(101)}  `)
    expect(result.success).toBe(false)
  })

  it('rejects a non-string value', () => {
    expect(nameFieldSchema.safeParse(42).success).toBe(false)
  })
})

describe('ProfilePatchSchema', () => {
  describe('valid partial bodies', () => {
    it('accepts a firstName on its own', () => {
      const result = ProfilePatchSchema.safeParse({ firstName: 'Alexandre' })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ firstName: 'Alexandre' })
    })

    it('accepts a lastName on its own', () => {
      const result = ProfilePatchSchema.safeParse({ lastName: 'Gilbert' })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ lastName: 'Gilbert' })
    })

    it('accepts both names together', () => {
      const body = { firstName: 'Alexandre', lastName: 'Gilbert' }
      const result = ProfilePatchSchema.safeParse(body)
      expect(result.success).toBe(true)
      expect(result.data).toEqual(body)
    })

    // The partial-PATCH trim carries through the object schema too, so a padded field is stored
    // trimmed via the reused nameFieldSchema.
    it('trims a provided name field', () => {
      const result = ProfilePatchSchema.safeParse({ firstName: '  Alexandre  ' })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ firstName: 'Alexandre' })
    })
  })

  describe('empty body refine', () => {
    // Spec AC5: an empty submit body (nothing changed) is rejected by the schema .refine as 422,
    // so a client bug cannot send a meaningless write.
    it('rejects an empty object through the refine', () => {
      const result = ProfilePatchSchema.safeParse({})
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('At least one profile field must be provided.')
    })

    it('rejects a body whose only fields are explicitly undefined', () => {
      const result = ProfilePatchSchema.safeParse({ firstName: undefined, lastName: undefined })
      expect(result.success).toBe(false)
    })
  })

  describe('invalid name values', () => {
    it('rejects a firstName that is empty after trim', () => {
      expect(ProfilePatchSchema.safeParse({ firstName: '   ' }).success).toBe(false)
    })

    it('rejects a lastName longer than 100 characters', () => {
      expect(ProfilePatchSchema.safeParse({ lastName: 'a'.repeat(101) }).success).toBe(false)
    })
  })

  describe('email is never part of the contract', () => {
    // Spec: the email is the login key and is never accepted or written by this route. The schema
    // is a plain z.object (not .strict), so an email key is stripped when a valid name is present,
    // and it never appears in the parsed data. It is never enough on its own to satisfy the refine.
    it('strips an email key and keeps only the name', () => {
      const result = ProfilePatchSchema.safeParse({
        firstName: 'Alexandre',
        email: 'attacker@example.com'
      })
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ firstName: 'Alexandre' })
      expect(result.data).not.toHaveProperty('email')
    })

    it('rejects a body whose only field is email (no name field present)', () => {
      expect(ProfilePatchSchema.safeParse({ email: 'attacker@example.com' }).success).toBe(false)
    })
  })
})
