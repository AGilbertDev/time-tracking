import { inArray, isNotNull } from 'drizzle-orm'
import { timingSafeEqual } from 'node:crypto'

import { useDb } from '../../db/index'
import { allowedEmails, magicLinkTokens, settings, users } from '../../db/schema'
import { isPurgeable } from '../../utils/manage-users'

// Constant-time bearer comparison. timingSafeEqual throws on unequal-length buffers, so the byte
// lengths are checked first and a mismatch rejects early; equal-length values are then compared
// without an early-exit branch, so a wrong token cannot be distinguished by response timing.
function timingSafeBearerEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

// GET /api/cron/purge-deactivated. Machine-triggered by Vercel Cron, not an admin-session route.
// It is guarded by a shared bearer secret and permanently deletes accounts that have been
// deactivated for at least one year, as a data-minimization measure.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const secret = config.cronSecret as string

  // Fail closed: an unset secret rejects everything, and any mismatch is a 401. No deletion and no
  // data leak on a bad or missing token. The token is compared in constant time so the endpoint
  // does not leak the secret through response-timing differences.
  const authorization = getHeader(event, 'authorization')
  if (!secret || !authorization || !timingSafeBearerEqual(authorization, `Bearer ${secret}`)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }

  const db = useDb()
  const now = new Date()

  // Read every deactivated account, then keep only those past the one-year boundary. The cutoff
  // math lives in the pure isPurgeable helper so it is unit-testable and the endpoint can never
  // delete an account early.
  const deactivated = await db
    .select({ id: users.id, email: users.email, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(isNotNull(users.deactivatedAt))

  const purgeable = deactivated.filter((row) => isPurgeable(row.deactivatedAt, now))
  if (purgeable.length === 0) {
    return { purged: 0 }
  }

  const ids = purgeable.map((row) => row.id)
  const emails = purgeable.map((row) => row.email)

  // Delete dependent rows before the users rows so the foreign key on settings.user_id is never
  // violated. A deactivated account is normally already off the allowlist, but any lingering row
  // is removed defensively by email.
  await db.delete(settings).where(inArray(settings.userId, ids))
  await db.delete(magicLinkTokens).where(inArray(magicLinkTokens.email, emails))
  await db.delete(allowedEmails).where(inArray(allowedEmails.email, emails))
  await db.delete(users).where(inArray(users.id, ids))

  // No personal data in the response, just the count, so a manual or dashboard invocation stays
  // legible. Running again finds nothing new and reports 0.
  return { purged: purgeable.length }
})
