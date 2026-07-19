import { ListQuerySchema } from '../../../models/admin'
import { sendZodError } from '../../../utils/sendZodError'
import { listUsers } from './handlers/list'

// GET /api/admin/users?page=<n>&pageSize=<n>. Admin-gated, server-side paginated. Thin handler:
// validate the query, delegate to the handler.
export default defineAdminEventHandler(async (event) => {
  const result = await getValidatedQuery(event, ListQuerySchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return listUsers(result.data)
})
