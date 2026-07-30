import { TaskIdParamSchema, TaskUpdateSchema } from '../../models/tasks'
import { sendZodError } from '../../utils/sendZodError'
import { updateTask } from './handlers/update'

// PATCH /api/tasks/[id]. Thin route. The authenticated wrapper enforces the session first, then the
// path parameter and the body are each validated and the handler does the write.
//
// The id is validated before the body, because a path parameter is untrusted input like any other
// and a missing or malformed one should fail at the boundary rather than reach the database.
//
// PATCH rather than PUT. The house already uses PATCH for a partial field write and reserves PUT for
// replacing a whole resource, a partial body is what the status cycle actually sends, and a patch
// touching only one field cannot clobber a field the other open tab just wrote.
export default defineAuthenticatedEventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, TaskIdParamSchema.safeParse)
  if (!params.success) return sendZodError(params.error)

  const result = await readValidatedBody(event, TaskUpdateSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return updateTask(event, params.data.id, result.data)
})
