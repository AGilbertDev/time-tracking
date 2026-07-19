import type { Locale } from '#shared/theme'

import { emailTemplates } from './email-templates'

// Pure, database-free helpers for the manage-users admin feature. Every function here is a total
// function over its inputs so the unit-test stage can cover them without a database. The route
// handlers do the querying and pass plain records in.

export type UserStatus = 'invited' | 'active' | 'deactivated'

export interface UserStatusInput {
  deactivatedAt: Date | null
  // From the users row, or null when there is no users row yet.
  passwordHash: string | null
}

// Derived status, never stored. Evaluated in this fixed order so it stays total over every
// combination of inputs:
//   1. deactivatedAt set    -> deactivated (keys off deactivatedAt, not allowlist membership,
//      so a deactivated account still reads Deactivated after it leaves the allowlist).
//   2. else passwordHash set -> active (a real, onboarded account).
//   3. else                  -> invited (covers both "on the allowlist with no users row" and
//      "a users row exists but has no password", i.e. accepted the magic link but never onboarded).
// A separate hasAccount flag is unnecessary: with no users row both fields are null, which falls
// through to invited.
export function deriveUserStatus({ passwordHash, deactivatedAt }: UserStatusInput): UserStatus {
  if (deactivatedAt != null) return 'deactivated'
  if (passwordHash != null) return 'active'
  return 'invited'
}

// A single distinct email merged from the allowed_emails and users tables. Invited-only rows have
// hasAccount false and null user columns; real accounts have hasAccount true.
export interface JoinedUserRecord {
  // users.createdAt, present only for real accounts.
  createdAt: Date | null
  deactivatedAt: Date | null
  email: string
  firstName: string | null
  hasAccount: boolean
  // allowed_emails.invitedAt, present whenever the email is (or was) on the allowlist.
  invitedAt: Date | null
  lastName: string | null
  passwordHash: string | null
  role: string | null
}

export interface UserListRow {
  // Effective date: users.createdAt for real accounts, otherwise allowed_emails.invitedAt.
  date: Date
  email: string
  firstName: string | null
  lastName: string | null
  // Null for invited-only rows; there is no role until an account exists.
  role: string | null
  status: UserStatus
}

// The whitelist of sortable columns, as a runtime array so it is the single source of truth: the
// SortColumn type is derived from it here, and the Zod enum in server/models/admin.ts is built from
// the same array. Never sort by a raw query-string value; only a member of this list is accepted.
export const SORT_COLUMNS = ['firstName', 'lastName', 'email', 'role', 'status', 'date'] as const
export type SortColumn = (typeof SORT_COLUMNS)[number]

export const SORT_ORDERS = ['asc', 'desc'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

// Maps one merged record into the list row contract. Name and role only surface for real
// accounts; the date is createdAt for accounts and invitedAt for invited-only rows, matching the
// spec's date column. The epoch fallback keeps date non-null even in the impossible case where
// both timestamps are missing, so ordering never throws.
export function shapeUserListRow(record: JoinedUserRecord): UserListRow {
  const status = deriveUserStatus({
    passwordHash: record.passwordHash,
    deactivatedAt: record.deactivatedAt
  })

  const date = record.hasAccount ? (record.createdAt ?? record.invitedAt) : record.invitedAt

  return {
    firstName: record.hasAccount ? record.firstName : null,
    lastName: record.hasAccount ? record.lastName : null,
    email: record.email,
    role: record.hasAccount ? record.role : null,
    status,
    date: date ?? new Date(0)
  }
}

// Fold accents and case so search and sort compare on the bare letters. NFD splits an accented
// character into its base letter plus a combining diacritic, the diacritic is stripped, and the
// result is lowercased. Used on both the search term and each field so "eloise" matches "Éloïse".
function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

// Case-insensitive and accent-insensitive substring filter over email, firstName, and lastName.
// The term is normalized once; an empty or whitespace-only term returns every row unchanged. Null
// name fields (invited-only rows) simply do not match on that field rather than throwing.
export function filterUserRows(rows: UserListRow[], search: string | undefined): UserListRow[] {
  const term = normalizeText((search ?? '').trim())
  if (term === '') return rows

  return rows.filter((row) => {
    const fields = [row.email, row.firstName, row.lastName]
    return fields.some((field) => field != null && normalizeText(field).includes(term))
  })
}

// Canonical status order for sorting, independent of any localized label so the order never shifts
// with the UI locale: invited, then active, then deactivated.
const STATUS_RANK: Record<UserStatus, number> = {
  invited: 0,
  active: 1,
  deactivated: 2
}

// Compares one column of two rows in the requested direction, before the email tie-break. Returns 0
// when the values are equal for the column. Null firstName/lastName/role always sort last, in both
// asc and desc, so invited-only rows never lead a name- or role-sorted page.
function compareColumn(a: UserListRow, b: UserListRow, sort: SortColumn, dir: number): number {
  if (sort === 'status') return dir * (STATUS_RANK[a.status] - STATUS_RANK[b.status])
  if (sort === 'date') return dir * (a.date.getTime() - b.date.getTime())

  const av = a[sort]
  const bv = b[sort]
  // Null last regardless of direction, so it is decided before dir is applied.
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1

  return dir * normalizeText(av).localeCompare(normalizeText(bv))
}

// Sorts a copy of the rows by the chosen column and order, leaving the input untouched. Every
// comparison is tie-broken by email ascending so pagination is stable across requests. The default
// call sortUserRows(rows, 'date', 'desc') reproduces the historical order: newest effective date
// first, ties broken by email ascending.
export function sortUserRows(
  rows: UserListRow[],
  sort: SortColumn,
  order: SortOrder
): UserListRow[] {
  const dir = order === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    const byColumn = compareColumn(a, b, sort, dir)
    if (byColumn !== 0) return byColumn
    return a.email.localeCompare(b.email)
  })
}

export interface PageBounds {
  limit: number
  offset: number
}

// Offset/limit for a 1-based page. Both inputs are floored and clamped to at least 1 so a bad
// value degrades to the first page rather than producing a negative offset.
export function getPageBounds(page: number, pageSize: number): PageBounds {
  const safePage = Math.max(1, Math.trunc(page))
  const safeSize = Math.max(1, Math.trunc(pageSize))
  return { limit: safeSize, offset: (safePage - 1) * safeSize }
}

// Page count for a total row count. Always at least 1 so an empty list reports totalPages 1
// rather than 0, matching the empty-state contract.
export function getTotalPages(total: number, pageSize: number): number {
  const safeSize = Math.max(1, Math.trunc(pageSize))
  return Math.max(1, Math.ceil(total / safeSize))
}

const RETENTION_DAYS = 365
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

// The retention boundary: accounts deactivated at or before this instant are eligible for
// permanent deletion. One full year (365 days) before `now`.
export function getRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * MILLISECONDS_PER_DAY)
}

// True only when the account has been deactivated for at least the full retention window. A null
// deactivatedAt (never deactivated) is never purgeable, and an account deactivated less than a
// year ago is never purgeable, so the purge cannot delete anything early.
export function isPurgeable(deactivatedAt: Date | null, now: Date): boolean {
  if (deactivatedAt == null) return false
  return deactivatedAt.getTime() <= getRetentionCutoff(now).getTime()
}

// Picks the deactivation-notice template by the target user's persisted locale (not a UI locale).
// English for 'en', French otherwise, so the default stays French.
export function selectDeactivationTemplate(locale: Locale) {
  return locale === 'en'
    ? emailTemplates.en.accountDeactivated
    : emailTemplates.fr.accountDeactivated
}
