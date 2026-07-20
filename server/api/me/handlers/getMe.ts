import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'

// GET /api/me. Returns the current user's fresh, authoritative record read straight from the
// database, not from the session cookie. This is the read side for the frontend's TanStack `me`
// query, which is the source of truth for user display data (avatar, name, email): the session
// cookie has proven to serve a stale avatarUrl after avatar mutations, so this reflects a
// just-committed avatar upload/remove or name change. Read-only: the session is never touched and
// nothing is written. The read is always scoped to the session user.id, never an id from the
// request, so a user can only ever read their own record.
export async function getMe(event: H3Event) {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarUrl: users.avatarUrl,
      role: users.role
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  // Fail closed if the row vanished mid-session (deleted after the session was issued). The
  // validate-session middleware normally handles deactivation and deletion, but this never returns
  // a partial or empty body in that race: a clean 404 rather than a null user.
  if (!row) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  // Personal data that must never be served stale from any cache. That freshness is the whole
  // point of this endpoint, so keep it out of every cache.
  setResponseHeader(event, 'Cache-Control', 'no-store')

  return row
}
