import { z } from 'zod'

// Email is the shared key between invited-only allowlist rows and real accounts, so every admin
// action is keyed by it. Normalize before validating: trim surrounding space, lowercase, then
// check the email format. Doing it in the schema means the allowlist key written here always
// matches the key the magic-link allowlist lookup reads later, and the handlers never see a
// stray-cased or padded address.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export const InviteSchema = z.object({ email: emailSchema })

export const DeactivateSchema = z.object({ email: emailSchema })

export const ReactivateSchema = z.object({ email: emailSchema })

// Server-side pagination. `page` is 1-based and any out-of-range or non-numeric value coerces to
// the default 1 rather than erroring (an over-range page simply returns no rows). `pageSize`
// defaults to 20 (the spec's page size) and is bounded so a caller cannot request an unbounded
// page. Both are coerced because they arrive as query strings.
export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})
