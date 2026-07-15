import { PreferencesPatchSchema } from '../../models/preferences'
import { sendZodError } from '../../utils/sendZodError'
import { savePreferences } from './handlers/savePreferences'

// Thin route. The authenticated wrapper enforces the session first, then the body is
// validated and the handler does the write. Mirrors server/api/onboarding/complete.post.ts.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await readValidatedBody(event, PreferencesPatchSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return savePreferences(event, result.data)
})
