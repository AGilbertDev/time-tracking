import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'
import { isOnboardingResetEnabled } from '../../../utils/onboardingReset'

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

  // A derived field with no column behind it, which the conventions explicitly allow on a response.
  // It folds both conditions server-side, so it is true only when this caller's role is exactly
  // 'admin' and the runtime switch is on. The settings page then renders its Reset section on one
  // finished answer rather than combining two facts of its own, which is the logic-belongs-to-the-
  // backend rule applied to a switch. Shipping the raw flag and letting the client AND it with the
  // role would put half the rule back on the client.
  //
  // The role compared here is the stored one this handler just read rather than the session's copy,
  // so a role changed since sign-in is reflected on the next fetch. The exact-match test deliberately
  // mirrors server/utils/defineAdminEventHandler.ts and isAdmin in app/utils/account.ts so the three
  // cannot drift, and it is written out rather than imported because server code must not import from
  // app/. It fails closed on a missing or unexpected role.
  //
  // This is an affordance and not the gate. POST /api/admin/onboarding/reset checks the switch
  // itself and refuses with 403 whatever the client rendered.
  //
  // It rides on this endpoint rather than on a new one, because this is already the fresh
  // authoritative read the client trusts over the session cookie, it already returns the role, and
  // it already sets no-store. It deliberately does not go into the session user, since a sealed
  // session cookie would keep serving the old answer after the switch moved until that session was
  // renewed, and a switch that needs a sign-out to take effect is not a runtime switch.
  const canResetOnboarding = row.role === 'admin' && isOnboardingResetEnabled()

  return { ...row, canResetOnboarding }
}
