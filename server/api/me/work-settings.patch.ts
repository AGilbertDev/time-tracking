import { WorkSettingsPatchSchema } from '../../models/work-settings'
import { sendZodError } from '../../utils/sendZodError'
import { saveWorkSettings } from './handlers/saveWorkSettings'

// Thin route. The authenticated wrapper enforces the session first, then the body is validated
// and the handler does the write. Mirrors server/api/me/preferences.patch.ts.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await readValidatedBody(event, WorkSettingsPatchSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return saveWorkSettings(event, result.data)
})
