import { ReactivateSchema } from '../../../models/admin'
import { sendZodError } from '../../../utils/sendZodError'
import { reactivateUser } from './handlers/reactivate'

// POST /api/admin/users/reactivate. Admin-gated. Body: { email }. Thin handler: validate, delegate.
export default defineAdminEventHandler(async (event) => {
  const result = await readValidatedBody(event, ReactivateSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return reactivateUser(result.data)
})
