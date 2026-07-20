import type { H3Event } from 'h3'

import type { WorkScheduleRecord } from '../../../../shared/planning'

// Returns the current user's effective-dated work-schedule records through the single read path.
// The read is always scoped to the session user, never an id from the request, so one user can
// never read another's schedule. An empty history returns an empty array.
export async function getWorkSchedule(event: H3Event): Promise<WorkScheduleRecord[]> {
  const { user } = await requireUserSession(event)
  return loadWorkSchedule(user.id)
}
