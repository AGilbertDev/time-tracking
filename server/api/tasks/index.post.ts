import { TaskCreateSchema } from '../../models/tasks'
import { sendZodError } from '../../utils/sendZodError'
import { createTask } from './handlers/create'

// POST /api/tasks. Thin route. The authenticated wrapper enforces the session first, so a missing
// session throws 401 before any work runs. The body is then validated against the create schema and
// a validation failure returns 422 through sendZodError with per-field messages, never a 500. The
// status is set after the handler returns, so a failed create reports its own error code rather than
// a 201 the write never earned. Mirrors server/api/tasks/index.get.ts.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await readValidatedBody(event, TaskCreateSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  const created = await createTask(event, result.data)
  setResponseStatus(event, 201)

  return created
})
