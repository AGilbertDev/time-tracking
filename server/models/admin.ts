import { z } from 'zod'

import { SORT_COLUMNS, SORT_ORDERS } from '../utils/manage-users'

// Email is the shared key between invited-only allowlist rows and real accounts, so every admin
// action is keyed by it. Normalize before validating: trim surrounding space, lowercase, then
// check the email format. Doing it in the schema means the allowlist key written here always
// matches the key the magic-link allowlist lookup reads later, and the handlers never see a
// stray-cased or padded address.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export const InviteSchema = z.object({ email: emailSchema })

export const DeactivateSchema = z.object({ email: emailSchema })

export const ReactivateSchema = z.object({ email: emailSchema })

// Server-side pagination, sorting, and search. `page` is 1-based. When a param is absent it falls
// back to its default, so `page` becomes 1 and `pageSize` becomes 12. When a param is present but
// malformed, such as a non-numeric `page` or `page=0`, it fails validation and the route returns a
// 400. A valid `page` past the last page is not an error and simply returns an empty page, handled
// downstream. `pageSize` is bounded so a caller cannot request an unbounded page. Both numbers are
// coerced because they arrive as query strings. `sort` and `order` are Zod enums derived from the
// single-source-of-truth whitelists in manage-users.ts, so a raw column name never reaches the
// sort. `search` is trimmed and length-capped; empty or absent means no filter.
export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  sort: z.enum(SORT_COLUMNS).default('date'),
  order: z.enum(SORT_ORDERS).default('desc'),
  search: z.string().trim().max(200).optional()
})
