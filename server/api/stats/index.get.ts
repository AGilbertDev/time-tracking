import { StatsQuerySchema } from '../../models/stats'
import { sendZodError } from '../../utils/sendZodError'
import { getStats } from './handlers/getStats'

// GET /api/stats?date=YYYY-MM-DD. Thin route. The authenticated wrapper enforces the session first,
// so a missing session throws 401 before any work runs. The query is then validated and a malformed
// date returns 422 through sendZodError with a per-field message, never a 500 and never a period
// computed from a value the user did not mean. Mirrors server/api/tasks/index.get.ts.
//
// The date is optional, and an absent one is not an error. The handler resolves today in the user's
// own timezone instead, which is a fact the client has no reason to know.
//
// This takes no page, sort or search parameter, and the list-endpoint convention does not apply to it.
// It is not a list. The answer is four fixed periods, each carrying at most one row per trackable
// category, so the response is bounded by the category contract rather than by the data and there is
// nothing to page through. A screen that wants an arbitrary range is PLAN-24 and gets its own
// contract.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await getValidatedQuery(event, StatsQuerySchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return getStats(event, result.data)
})
