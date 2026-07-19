import type { z } from 'zod'

import type { ListQuerySchema } from '../../../../models/admin'
import type { JoinedUserRecord, UserListRow } from '../../../../utils/manage-users'

import { useDb } from '../../../../db/index'
import { allowedEmails, users } from '../../../../db/schema'
import {
  filterUserRows,
  getPageBounds,
  getTotalPages,
  shapeUserListRow,
  sortUserRows
} from '../../../../utils/manage-users'

export interface UserListResponse {
  page: number
  pageSize: number
  rows: UserListRow[]
  total: number
  totalPages: number
}

// The list is the union of allowed_emails and users, one row per distinct email. Rather than a
// full outer join, the two tables are read and merged in memory keyed by lowercased email. The
// dataset is tiny (one real user plus a handful of pending invites), so this stays simple,
// deterministic, and free of raw SQL, which the spec explicitly permits.
export async function listUsers(query: z.infer<typeof ListQuerySchema>): Promise<UserListResponse> {
  const db = useDb()
  const { page, pageSize, sort, order, search } = query

  const accountRows = await db
    .select({
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      passwordHash: users.passwordHash,
      deactivatedAt: users.deactivatedAt,
      createdAt: users.createdAt
    })
    .from(users)

  const allowlistRows = await db
    .select({ email: allowedEmails.email, invitedAt: allowedEmails.invitedAt })
    .from(allowedEmails)

  // Merge keyed by lowercased email so a real account and its allowlist entry collapse into one
  // row even if their casing differs.
  const merged = new Map<string, JoinedUserRecord>()

  for (const account of accountRows) {
    merged.set(account.email.toLowerCase(), {
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
      role: account.role,
      passwordHash: account.passwordHash,
      deactivatedAt: account.deactivatedAt,
      createdAt: account.createdAt,
      invitedAt: null,
      hasAccount: true
    })
  }

  for (const allow of allowlistRows) {
    const key = allow.email.toLowerCase()
    const existing = merged.get(key)
    if (existing) {
      existing.invitedAt = allow.invitedAt
    } else {
      merged.set(key, {
        email: allow.email,
        firstName: null,
        lastName: null,
        role: null,
        passwordHash: null,
        deactivatedAt: null,
        createdAt: null,
        invitedAt: allow.invitedAt,
        hasAccount: false
      })
    }
  }

  const shaped = [...merged.values()].map(shapeUserListRow)

  // Filter and sort the whole merged dataset before slicing the page, so search and sort consider
  // every row rather than one page's worth. Order is fixed: filter, then count, then sort, then
  // slice. `total` is the filtered count so pagination reflects the search. The default
  // sort/order (date desc) reproduces the historical order: newest first, ties by email ascending.
  const filtered = filterUserRows(shaped, search)
  const total = filtered.length
  const totalPages = getTotalPages(total, pageSize)
  const sorted = sortUserRows(filtered, sort, order)
  const { offset, limit } = getPageBounds(page, pageSize)
  const rows = sorted.slice(offset, offset + limit)

  return { rows, page, pageSize, total, totalPages }
}
