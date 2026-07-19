import { emailTemplates } from '~~/server/utils/email-templates'
import {
  deriveUserStatus,
  getPageBounds,
  getRetentionCutoff,
  getTotalPages,
  isPurgeable,
  type JoinedUserRecord,
  selectDeactivationTemplate,
  shapeUserListRow
} from '~~/server/utils/manage-users'
import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, type Locale } from '#shared/theme'

// Pure-logic tests for the manage-users admin helpers. Every expected value is derived from
// docs/specs/admin/manage-users.md (the "Users list", "Retention", and "Deactivate" sections and
// their acceptance criteria), not from the implementation. The implementation is read only to
// resolve the exported names and signatures. Where the spec fixes a rule (status derivation order,
// the createdAt-vs-invitedAt date source, totalPages = max(1, ceil(total/20)), the <= now - 1 year
// purge boundary, and the French default for the deactivation template) the assertions encode the
// spec so a drift from it fails here.

describe('deriveUserStatus', () => {
  // Spec "Status derivation": evaluated in a fixed order so it is total:
  //   1. deactivatedAt set -> deactivated  2. else passwordHash set -> active  3. else invited.

  it('returns deactivated when deactivatedAt is set', () => {
    expect(deriveUserStatus({ passwordHash: null, deactivatedAt: new Date() })).toBe('deactivated')
  })

  // Ordering rule: deactivated wins even when passwordHash is also set (rule 1 before rule 2).
  it('returns deactivated when deactivatedAt is set even if passwordHash is also set', () => {
    expect(deriveUserStatus({ passwordHash: 'hash', deactivatedAt: new Date() })).toBe(
      'deactivated'
    )
  })

  // A real, onboarded account: password set, not deactivated.
  it('returns active when passwordHash is set and deactivatedAt is null', () => {
    expect(deriveUserStatus({ passwordHash: 'hash', deactivatedAt: null })).toBe('active')
  })

  // Invited: on the allowlist with no users row (both columns null).
  it('returns invited when both passwordHash and deactivatedAt are null (allowlist, no account)', () => {
    expect(deriveUserStatus({ passwordHash: null, deactivatedAt: null })).toBe('invited')
  })

  // Accepted the magic link but never onboarded: a users row exists but passwordHash is null and
  // it is not deactivated. Spec rule 3 explicitly covers this as Invited.
  it('returns invited for an accepted-but-not-onboarded row (null passwordHash, not deactivated)', () => {
    expect(deriveUserStatus({ passwordHash: null, deactivatedAt: null })).toBe('invited')
  })
})

// Base record for a real account; individual tests clone and override so one field drives the case.
function record(overrides: Partial<JoinedUserRecord> = {}): JoinedUserRecord {
  return {
    createdAt: new Date('2026-01-15T00:00:00Z'),
    deactivatedAt: null,
    email: 'person@example.com',
    firstName: 'Alexandre',
    hasAccount: true,
    invitedAt: new Date('2026-01-01T00:00:00Z'),
    lastName: 'Gilbert',
    passwordHash: 'hash',
    role: 'user',
    ...overrides
  }
}

describe('shapeUserListRow', () => {
  // Spec "Users list" columns + acceptance criteria.

  // Active account: password set, not deactivated. Name and role pass through, date is createdAt.
  it('shapes an active account with createdAt as the date and passthrough name/role', () => {
    const row = shapeUserListRow(record())

    expect(row).toEqual({
      firstName: 'Alexandre',
      lastName: 'Gilbert',
      email: 'person@example.com',
      role: 'user',
      status: 'active',
      date: new Date('2026-01-15T00:00:00Z')
    })
  })

  // Deactivated account: deactivatedAt set. Status is deactivated regardless of allowlist state,
  // and the date is still the account's createdAt.
  it('shapes a deactivated account as deactivated with createdAt as the date', () => {
    const row = shapeUserListRow(record({ deactivatedAt: new Date('2026-06-01T00:00:00Z') }))

    expect(row.status).toBe('deactivated')
    expect(row.date).toEqual(new Date('2026-01-15T00:00:00Z'))
  })

  // Accepted-but-not-onboarded: a users row (hasAccount true) with null passwordHash shows Invited.
  it('shapes an accounted row with null passwordHash as invited', () => {
    const row = shapeUserListRow(record({ passwordHash: null }))

    expect(row.status).toBe('invited')
    // It still has a users row, so the date source is createdAt.
    expect(row.date).toEqual(new Date('2026-01-15T00:00:00Z'))
  })

  // Invited-only row: no users row. Name and role are forced null, date is invitedAt, status invited.
  it('shapes an invited-only row with null name/role, invitedAt date, and invited status', () => {
    const row = shapeUserListRow(
      record({
        hasAccount: false,
        createdAt: null,
        passwordHash: null,
        role: null,
        firstName: null,
        lastName: null
      })
    )

    expect(row).toEqual({
      firstName: null,
      lastName: null,
      email: 'person@example.com',
      role: null,
      status: 'invited',
      date: new Date('2026-01-01T00:00:00Z')
    })
  })

  // Invited-only rows never surface user columns even if a stray value were present: name and role
  // are null because there is no account, per the spec's "null/empty for invited-only rows".
  it('forces name and role to null for an invited-only row regardless of stray user columns', () => {
    const row = shapeUserListRow(
      record({
        hasAccount: false,
        createdAt: null,
        firstName: 'Ghost',
        lastName: 'Row',
        role: 'admin'
      })
    )

    expect(row.firstName).toBeNull()
    expect(row.lastName).toBeNull()
    expect(row.role).toBeNull()
  })

  // Null name/role on a real account pass through as null (empty cells), not forced by hasAccount.
  it('passes through null name and role on a real account', () => {
    const row = shapeUserListRow(record({ firstName: null, lastName: null, role: null }))

    expect(row.firstName).toBeNull()
    expect(row.lastName).toBeNull()
    expect(row.role).toBeNull()
    expect(row.status).toBe('active')
  })

  // The admin role passes through unchanged on a real account.
  it('passes through the admin role on a real account', () => {
    expect(shapeUserListRow(record({ role: 'admin' })).role).toBe('admin')
  })
})

describe('getPageBounds', () => {
  // Spec: 20 rows per page, server-side, 1-based page. offset = (page - 1) * pageSize.

  it('returns offset 0 for page 1 at the default page size of 20', () => {
    expect(getPageBounds(1, 20)).toEqual({ limit: 20, offset: 0 })
  })

  it('returns offset 40 for page 3 at page size 20', () => {
    expect(getPageBounds(3, 20)).toEqual({ limit: 20, offset: 40 })
  })

  it('computes the offset from an arbitrary page size', () => {
    expect(getPageBounds(2, 10)).toEqual({ limit: 10, offset: 10 })
  })
})

describe('getTotalPages', () => {
  // Spec: totalPages = max(1, ceil(total / pageSize)). Empty list reports 1 page.

  it('returns 1 for a total of 0 (empty-state contract)', () => {
    expect(getTotalPages(0, 20)).toBe(1)
  })

  it('returns 1 when the total exactly fills a single page', () => {
    expect(getTotalPages(20, 20)).toBe(1)
  })

  it('returns 2 when the total is one over an exact page (remainder rounds up)', () => {
    expect(getTotalPages(21, 20)).toBe(2)
  })

  it('returns 2 for an exact multiple of two pages', () => {
    expect(getTotalPages(40, 20)).toBe(2)
  })

  it('returns 3 when the total spills one row past two full pages', () => {
    expect(getTotalPages(41, 20)).toBe(3)
  })
})

describe('getRetentionCutoff', () => {
  // Spec "Retention": the boundary is now - one year (365 days). Accounts deactivated at or before
  // this instant are eligible for deletion.
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

  it('returns the instant exactly one year (365 days) before now', () => {
    const now = new Date('2026-07-19T00:00:00Z')
    expect(getRetentionCutoff(now)).toEqual(new Date(now.getTime() - ONE_YEAR_MS))
  })
})

describe('isPurgeable', () => {
  // Spec "Retention" + acceptance criteria: delete accounts deactivated at least one year ago;
  // never before one year. Boundary is deactivatedAt <= now - 365 days. Fixed dates keep this
  // deterministic rather than clock-dependent.
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
  const now = new Date('2026-07-19T00:00:00Z')

  it('is never purgeable when deactivatedAt is null (never deactivated)', () => {
    expect(isPurgeable(null, now)).toBe(false)
  })

  // Exactly one year ago sits on the boundary and the comparison is inclusive (<=), so it purges.
  it('purges an account deactivated exactly one year ago (inclusive boundary)', () => {
    const deactivatedAt = new Date(now.getTime() - ONE_YEAR_MS)
    expect(isPurgeable(deactivatedAt, now)).toBe(true)
  })

  // One millisecond short of a full year must not purge: nothing is deleted before one year.
  it('does not purge an account deactivated one millisecond under a year', () => {
    const deactivatedAt = new Date(now.getTime() - ONE_YEAR_MS + 1)
    expect(isPurgeable(deactivatedAt, now)).toBe(false)
  })

  it('does not purge an account deactivated well under a year (one day ago)', () => {
    const deactivatedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    expect(isPurgeable(deactivatedAt, now)).toBe(false)
  })

  it('purges an account deactivated well over a year (400 days ago)', () => {
    const deactivatedAt = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000)
    expect(isPurgeable(deactivatedAt, now)).toBe(true)
  })
})

describe('selectDeactivationTemplate', () => {
  // Spec "Deactivation email": template chosen by the target user's persisted locale. English for
  // 'en', French otherwise, so the default (fr) stays French for unknown/missing locales.

  it('returns the French template for locale fr', () => {
    expect(selectDeactivationTemplate('fr')).toBe(emailTemplates.fr.accountDeactivated)
  })

  it('returns the English template for locale en', () => {
    expect(selectDeactivationTemplate('en')).toBe(emailTemplates.en.accountDeactivated)
  })

  // The spec's default locale is French, so anything that is not 'en' falls back to French.
  it('falls back to the French template for an unknown locale', () => {
    expect(selectDeactivationTemplate('de' as Locale)).toBe(emailTemplates.fr.accountDeactivated)
  })

  it('falls back to the French template for a missing locale, matching the fr default', () => {
    expect(DEFAULT_LOCALE).toBe('fr')
    expect(selectDeactivationTemplate(undefined as unknown as Locale)).toBe(
      emailTemplates.fr.accountDeactivated
    )
  })
})
