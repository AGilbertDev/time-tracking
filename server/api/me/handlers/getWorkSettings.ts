import type { H3Event } from 'h3'

import type { WorkSettings } from '../../../utils/loadWorkSettings'

// Returns the current user's persisted work settings through the single read path. The read is
// always scoped to the session user, never an id from the request.
export async function getWorkSettings(event: H3Event): Promise<WorkSettings> {
  const { user } = await requireUserSession(event)
  return loadWorkSettings(user.id)
}
