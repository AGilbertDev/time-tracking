import { ProfilePatchSchema } from '../../models/profile'
import { sendZodError } from '../../utils/sendZodError'
import { updateProfile } from './handlers/updateProfile'

// Thin route. The authenticated wrapper enforces the session first, then the body is validated
// and the handler does the write. Mirrors server/api/me/preferences.patch.ts.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await readValidatedBody(event, ProfilePatchSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return updateProfile(event, result.data)
})
