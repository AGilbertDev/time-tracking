import { DeactivateSchema } from '../../../models/admin'
import { sendZodError } from '../../../utils/sendZodError'
import { deactivateUser } from './handlers/deactivate'

// POST /api/admin/users/deactivate. Admin-gated. Body: { email }. The session user's email is
// read here and passed to the handler so it can block self-deactivation (409).
export default defineAdminEventHandler(async (event) => {
  const result = await readValidatedBody(event, DeactivateSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  const { user } = await requireUserSession(event)
  return deactivateUser(result.data, user.email)
})
