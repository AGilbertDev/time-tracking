import type { H3Event } from 'h3'

import type { CategoryQuotaEntry } from '../../../utils/loadCategoryQuotas'

// Returns the current user's per-category quotas, already resolved to the figure currently in force,
// through the single read path. One entry per trackable category in contract order, each carrying the
// figure and where it came from. Non-trackable categories are absent rather than present with a null
// quota, so the client renders the list it is handed instead of filtering on a flag of its own.
//
// Nothing here reads a date. Under the snapshot model the table holds one current row per category, so
// the response is not date-dependent and no timezone is loaded to produce it.
//
// The read is always scoped to the session user, never an id from the request, so one user can never
// read another's quotas.
export async function getCategoryQuotas(event: H3Event): Promise<CategoryQuotaEntry[]> {
  const { user } = await requireUserSession(event)
  return loadResolvedCategoryQuotas(user.id)
}
