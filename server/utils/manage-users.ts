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
