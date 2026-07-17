import type { H3Event } from 'h3'

import type { UserPreferences } from '../../../utils/loadUserPreferences'

// Returns the current user's persisted preferences. The client's primary read path is the
// session, so this is not on the hot path; it exists for verification and future use. The
// read is always scoped to the session user, never an id from the request.
export async function getPreferences(event: H3Event): Promise<UserPreferences> {
  const { user } = await requireUserSession(event)
  return loadUserPreferences(user.id)
}
