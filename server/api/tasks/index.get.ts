import { TaskListQuerySchema } from '../../models/tasks'
import { sendZodError } from '../../utils/sendZodError'
import { listTasks } from './handlers/list'

// GET /api/tasks?from=YYYY-MM-DD&to=YYYY-MM-DD. Thin route. The authenticated wrapper enforces the
// session first, so a missing session throws 401 before any work runs. The query is then validated
// against the range schema and a validation failure returns 422 through sendZodError with per-field
// messages, never a 500. Mirrors server/api/admin/users/index.get.ts.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await getValidatedQuery(event, TaskListQuerySchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return listTasks(event, result.data)
})
