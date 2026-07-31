import { inArray, isNotNull } from 'drizzle-orm'
import { timingSafeEqual } from 'node:crypto'

import { useDb } from '../../db/index'
import {
  allowedEmails,
  magicLinkTokens,
  settings,
  tasks,
  users,
  workSchedule
} from '../../db/schema'
import { avatarStorage } from '../../utils/avatarStorage'
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

  // Erase any stored avatar object for each purged user so the right-to-erasure purge leaves no
  // orphan. avatarStorage keys off the user id and handles driver selection and the blob-driver
  // token internally, so there is no direct store access here. A missing object or a delete failure
  // (including an unconfigured blob driver) is swallowed: the primary purge is the row deletion
  // below, and the deterministic key means a leftover object is never reachable once the row is gone.
  await Promise.all(
    ids.map(async (id) => {
      try {
        await avatarStorage.del(id)
      } catch (error) {
        console.error('avatar storage delete failed during purge; leftover object is unreachable', {
          userId: id,
          error
        })
      }
    })
  )

  // Delete every dependent row before the users rows, so no foreign key on user_id is ever violated
  // and the outcome never depends on a cascade. A deactivated account is normally already off the
  // allowlist, but any lingering row is removed defensively by email.
  //
  // DO NOT remove the tasks or work_schedule deletes as redundant. They look redundant, because both
  // tables declare onDelete('cascade') in server/db/schema.ts, and they are load-bearing anyway. That
  // cascade only fires when PRAGMA foreign_keys is ON, nothing in this repo issues that pragma, and
  // the schema comment on the tasks foreign key records honestly that it was probed against the
  // development database on 2026-07-29 and that production was never probed. So on the one database
  // where a failed erasure actually matters, the cascade is unverified. This endpoint's entire job is
  // erasure, and a reader seeing four named deletes would reasonably conclude those are all the
  // tables involved, which was false. Naming all six removes the dependency on an unverified platform
  // default rather than adding behaviour, and it stays correct whether the pragma is on or off.
  //
  // The stakes went up in the same change that left the mechanism unverified, which is why this was
  // fixed here rather than filed as a follow-up. The tasks table now carries a free-text notes column
  // holding the user's own prose about client work, so an erasure that silently missed it would leave
  // exactly the kind of personal data the purge exists to destroy.
  await db.delete(tasks).where(inArray(tasks.userId, ids))
  await db.delete(workSchedule).where(inArray(workSchedule.userId, ids))
  await db.delete(settings).where(inArray(settings.userId, ids))
  await db.delete(magicLinkTokens).where(inArray(magicLinkTokens.email, emails))
  await db.delete(allowedEmails).where(inArray(allowedEmails.email, emails))
  await db.delete(users).where(inArray(users.id, ids))

  // No personal data in the response, just the count, so a manual or dashboard invocation stays
  // legible. Running again finds nothing new and reports 0.
  return { purged: purgeable.length }
})
