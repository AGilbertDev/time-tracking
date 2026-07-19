import { InviteSchema } from '../../../models/admin'
import { sendZodError } from '../../../utils/sendZodError'
import { inviteUser } from './handlers/invite'

// POST /api/admin/users/invite. Admin-gated. Body: { email }. Thin handler: validate, delegate.
export default defineAdminEventHandler(async (event) => {
  const result = await readValidatedBody(event, InviteSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return inviteUser(result.data)
})
