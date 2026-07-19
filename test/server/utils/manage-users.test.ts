import { emailTemplates } from '~~/server/utils/email-templates'
import {
  deriveUserStatus,
  filterUserRows,
  getPageBounds,
  getRetentionCutoff,
  getTotalPages,
  isPurgeable,
  type JoinedUserRecord,
  selectDeactivationTemplate,
  shapeUserListRow,
  sortUserRows,
  type UserListRow
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

// Base shaped row for the filter/sort helpers; tests clone and override so one field drives the case.
function row(overrides: Partial<UserListRow> = {}): UserListRow {
  return {
    firstName: 'Alexandre',
    lastName: 'Gilbert',
    email: 'person@example.com',
    role: 'user',
    status: 'active',
    date: new Date('2026-01-15T00:00:00Z'),
    ...overrides
  }
}

describe('filterUserRows', () => {
  // Spec "Search behaviour" + acceptance criteria: case-insensitive AND diacritic-insensitive
  // substring match over email, firstName, and lastName. Trimmed; empty/whitespace/absent means no
  // filter and every row passes. Null name fields never match on name but still match on email.

  const rows = [
    row({ email: 'genevieve@example.com', firstName: 'Geneviève', lastName: 'Tremblay' }),
    row({ email: 'francois@example.com', firstName: 'François', lastName: 'Bouchard' }),
    row({ email: 'invited@example.com', firstName: null, lastName: null, status: 'invited' })
  ]

  // Empty term is not a filter: all rows pass, unchanged.
  it('returns all rows for an empty search string', () => {
    expect(filterUserRows(rows, '')).toEqual(rows)
  })

  // Whitespace-only trims to empty, so it is also treated as no filter.
  it('returns all rows for a whitespace-only search string', () => {
    expect(filterUserRows(rows, '   ')).toEqual(rows)
  })

  // Absent term (undefined) is no filter.
  it('returns all rows when search is undefined', () => {
    expect(filterUserRows(rows, undefined)).toEqual(rows)
  })

  // Case-insensitive match on email.
  it('matches email case-insensitively', () => {
    const result = filterUserRows(rows, 'FRANCOIS@EXAMPLE')
    expect(result).toHaveLength(1)
    expect(result[0]?.email).toBe('francois@example.com')
  })

  // Case-insensitive match on firstName.
  it('matches firstName case-insensitively', () => {
    const result = filterUserRows(rows, 'genevieve')
    expect(result).toHaveLength(1)
    expect(result[0]?.firstName).toBe('Geneviève')
  })

  // Case-insensitive match on lastName.
  it('matches lastName case-insensitively', () => {
    const result = filterUserRows(rows, 'BOUCHARD')
    expect(result).toHaveLength(1)
    expect(result[0]?.lastName).toBe('Bouchard')
  })

  // Diacritic-insensitive, unaccented term against an accented field.
  it('matches an unaccented term against an accented field (genevieve -> Geneviève)', () => {
    const result = filterUserRows(rows, 'genevieve')
    expect(result).toHaveLength(1)
    expect(result[0]?.firstName).toBe('Geneviève')
  })

  // Diacritic-insensitive the other direction: an accented term against an unaccented field. Both
  // sides are folded, so the comparison is symmetric.
  it('matches an accented term against an unaccented field (Geneviève -> Genevieve)', () => {
    const unaccented = [row({ email: 'g@example.com', firstName: 'Genevieve', lastName: 'Roy' })]
    const result = filterUserRows(unaccented, 'Geneviève')
    expect(result).toHaveLength(1)
    expect(result[0]?.firstName).toBe('Genevieve')
  })

  // Substring, not just a prefix: an interior fragment still matches.
  it('matches a substring that is not a prefix', () => {
    const result = filterUserRows(rows, 'remblay')
    expect(result).toHaveLength(1)
    expect(result[0]?.lastName).toBe('Tremblay')
  })

  // The term is trimmed before matching, so surrounding whitespace does not defeat a real match.
  it('trims the term before matching', () => {
    const result = filterUserRows(rows, '  Bouchard  ')
    expect(result).toHaveLength(1)
    expect(result[0]?.lastName).toBe('Bouchard')
  })

  // Invited-only rows have null firstName/lastName. A term that only exists in a name never matches
  // them, and null fields must not throw.
  it('does not match an invited-only row on its null name fields', () => {
    const result = filterUserRows(rows, 'Tremblay')
    expect(result.every((r) => r.email !== 'invited@example.com')).toBe(true)
  })

  // But an invited-only row still matches on its email.
  it('matches an invited-only row on its email even with null name fields', () => {
    const result = filterUserRows(rows, 'invited@example')
    expect(result).toHaveLength(1)
    expect(result[0]?.email).toBe('invited@example.com')
  })

  // A term that matches nothing returns an empty array.
  it('returns an empty array when nothing matches', () => {
    expect(filterUserRows(rows, 'zzz-no-such-user')).toEqual([])
  })
})

describe('sortUserRows', () => {
  // Spec "Sortable column whitelist" + acceptance criteria: sort the full set by the chosen column
  // and direction; nulls last for firstName/lastName/role in both directions; status sorts by the
  // canonical rank (invited < active < deactivated), not the localized label; every sort is
  // tie-broken by email ascending; the default sortUserRows(rows, 'date', 'desc') is newest-first.

  // A copy is returned and the input is never mutated.
  it('returns a new array and does not mutate the input', () => {
    const input = [
      row({ email: 'b@example.com', firstName: 'Bruno' }),
      row({ email: 'a@example.com', firstName: 'Anna' })
    ]
    const snapshot = [...input]
    const result = sortUserRows(input, 'firstName', 'asc')

    expect(result).not.toBe(input)
    expect(input).toEqual(snapshot)
  })

  // firstName ascending / descending, case-insensitive.
  it('sorts by firstName ascending', () => {
    const rows = [
      row({ email: 'c@example.com', firstName: 'Charlie' }),
      row({ email: 'a@example.com', firstName: 'anna' }),
      row({ email: 'b@example.com', firstName: 'Bruno' })
    ]
    expect(sortUserRows(rows, 'firstName', 'asc').map((r) => r.firstName)).toEqual([
      'anna',
      'Bruno',
      'Charlie'
    ])
  })

  it('sorts by firstName descending', () => {
    const rows = [
      row({ email: 'a@example.com', firstName: 'anna' }),
      row({ email: 'c@example.com', firstName: 'Charlie' }),
      row({ email: 'b@example.com', firstName: 'Bruno' })
    ]
    expect(sortUserRows(rows, 'firstName', 'desc').map((r) => r.firstName)).toEqual([
      'Charlie',
      'Bruno',
      'anna'
    ])
  })

  // lastName ascending.
  it('sorts by lastName ascending', () => {
    const rows = [
      row({ email: 'a@example.com', lastName: 'Tremblay' }),
      row({ email: 'b@example.com', lastName: 'Bouchard' }),
      row({ email: 'c@example.com', lastName: 'Gagnon' })
    ]
    expect(sortUserRows(rows, 'lastName', 'asc').map((r) => r.lastName)).toEqual([
      'Bouchard',
      'Gagnon',
      'Tremblay'
    ])
  })

  // email ascending / descending.
  it('sorts by email ascending', () => {
    const rows = [
      row({ email: 'c@example.com' }),
      row({ email: 'a@example.com' }),
      row({ email: 'b@example.com' })
    ]
    expect(sortUserRows(rows, 'email', 'asc').map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com'
    ])
  })

  it('sorts by email descending', () => {
    const rows = [
      row({ email: 'a@example.com' }),
      row({ email: 'c@example.com' }),
      row({ email: 'b@example.com' })
    ]
    expect(sortUserRows(rows, 'email', 'desc').map((r) => r.email)).toEqual([
      'c@example.com',
      'b@example.com',
      'a@example.com'
    ])
  })

  // role ascending.
  it('sorts by role ascending', () => {
    const rows = [
      row({ email: 'a@example.com', role: 'user' }),
      row({ email: 'b@example.com', role: 'admin' })
    ]
    expect(sortUserRows(rows, 'role', 'asc').map((r) => r.role)).toEqual(['admin', 'user'])
  })

  // status sorts by the canonical rank invited < active < deactivated, NOT by the alphabetical label
  // (which would give active, deactivated, invited).
  it('sorts by status ascending using the canonical rank (invited < active < deactivated)', () => {
    const rows = [
      row({ email: 'd@example.com', status: 'deactivated' }),
      row({ email: 'a@example.com', status: 'active' }),
      row({ email: 'i@example.com', status: 'invited' })
    ]
    expect(sortUserRows(rows, 'status', 'asc').map((r) => r.status)).toEqual([
      'invited',
      'active',
      'deactivated'
    ])
  })

  it('sorts by status descending using the canonical rank (deactivated first)', () => {
    const rows = [
      row({ email: 'a@example.com', status: 'active' }),
      row({ email: 'i@example.com', status: 'invited' }),
      row({ email: 'd@example.com', status: 'deactivated' })
    ]
    expect(sortUserRows(rows, 'status', 'desc').map((r) => r.status)).toEqual([
      'deactivated',
      'active',
      'invited'
    ])
  })

  // date is a timestamp compare.
  it('sorts by date ascending (oldest first)', () => {
    const rows = [
      row({ email: 'c@example.com', date: new Date('2026-03-01T00:00:00Z') }),
      row({ email: 'a@example.com', date: new Date('2026-01-01T00:00:00Z') }),
      row({ email: 'b@example.com', date: new Date('2026-02-01T00:00:00Z') })
    ]
    expect(sortUserRows(rows, 'date', 'asc').map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com'
    ])
  })

  // Null firstName sorts last in both directions.
  it('sorts null firstName last in ascending order', () => {
    const rows = [
      row({ email: 'n@example.com', firstName: null }),
      row({ email: 'b@example.com', firstName: 'Bruno' }),
      row({ email: 'a@example.com', firstName: 'Anna' })
    ]
    expect(sortUserRows(rows, 'firstName', 'asc').map((r) => r.firstName)).toEqual([
      'Anna',
      'Bruno',
      null
    ])
  })

  it('sorts null firstName last in descending order (nulls stay at the end)', () => {
    const rows = [
      row({ email: 'n@example.com', firstName: null }),
      row({ email: 'a@example.com', firstName: 'Anna' }),
      row({ email: 'b@example.com', firstName: 'Bruno' })
    ]
    expect(sortUserRows(rows, 'firstName', 'desc').map((r) => r.firstName)).toEqual([
      'Bruno',
      'Anna',
      null
    ])
  })

  // Null lastName sorts last regardless of direction.
  it('sorts null lastName last in ascending order', () => {
    const rows = [
      row({ email: 'n@example.com', lastName: null }),
      row({ email: 'a@example.com', lastName: 'Aubin' })
    ]
    expect(sortUserRows(rows, 'lastName', 'asc').map((r) => r.lastName)).toEqual(['Aubin', null])
  })

  // Null role sorts last regardless of direction (invited-only rows have no role).
  it('sorts null role last in descending order', () => {
    const rows = [
      row({ email: 'n@example.com', role: null }),
      row({ email: 'a@example.com', role: 'admin' }),
      row({ email: 'u@example.com', role: 'user' })
    ]
    expect(sortUserRows(rows, 'role', 'desc').map((r) => r.role)).toEqual(['user', 'admin', null])
  })

  // Every sort is tie-broken by email ascending. Equal primary key, different emails.
  it('breaks ties by email ascending when the sort column is equal (firstName)', () => {
    const rows = [
      row({ email: 'c@example.com', firstName: 'Same' }),
      row({ email: 'a@example.com', firstName: 'Same' }),
      row({ email: 'b@example.com', firstName: 'Same' })
    ]
    expect(sortUserRows(rows, 'firstName', 'asc').map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com'
    ])
  })

  // The email tie-break stays ascending even when the primary sort is descending.
  it('breaks ties by email ascending even under a descending status sort', () => {
    const rows = [
      row({ email: 'c@example.com', status: 'active' }),
      row({ email: 'a@example.com', status: 'active' }),
      row({ email: 'b@example.com', status: 'active' })
    ]
    expect(sortUserRows(rows, 'status', 'desc').map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com'
    ])
  })

  // Two invited-only rows (null name) tie on the null field and sort among themselves by email asc.
  it('tie-breaks null-name rows by email ascending', () => {
    const rows = [
      row({ email: 'z@example.com', firstName: null }),
      row({ email: 'm@example.com', firstName: null })
    ]
    expect(sortUserRows(rows, 'firstName', 'asc').map((r) => r.email)).toEqual([
      'm@example.com',
      'z@example.com'
    ])
  })

  // The historical default: sortUserRows(rows, 'date', 'desc') is newest-first, ties by email asc.
  it('reproduces the historical default order with date desc and an email-ascending tie-break', () => {
    const older = new Date('2026-01-01T00:00:00Z')
    const newer = new Date('2026-05-01T00:00:00Z')
    const rows = [
      row({ email: 'old@example.com', date: older }),
      row({ email: 'z-new@example.com', date: newer }),
      row({ email: 'a-new@example.com', date: newer })
    ]
    // Newer date first; the two newer rows are ordered by email ascending.
    expect(sortUserRows(rows, 'date', 'desc').map((r) => r.email)).toEqual([
      'a-new@example.com',
      'z-new@example.com',
      'old@example.com'
    ])
  })
})
