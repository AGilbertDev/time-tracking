import { TaskIdParamSchema } from '../../models/tasks'
import { sendZodError } from '../../utils/sendZodError'
import { removeTask } from './handlers/remove'

// DELETE /api/tasks/[id]. Thin route. The authenticated wrapper enforces the session first, then the
// path parameter is validated and the handler does the delete. There is no body: the id in the path
// is the entire request, so the route reads nothing else.
export default defineAuthenticatedEventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, TaskIdParamSchema.safeParse)
  if (!params.success) return sendZodError(params.error)

  return removeTask(event, params.data.id)
})
