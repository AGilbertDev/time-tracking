import { PasswordChangeSchema } from '../../models/password'
import { sendZodError } from '../../utils/sendZodError'
import { changePassword } from './handlers/changePassword'

// Thin route. The authenticated wrapper enforces the session first, then the body is validated
// and the handler does the change. Mirrors server/api/me/preferences.patch.ts.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await readValidatedBody(event, PasswordChangeSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return changePassword(event, result.data)
})
