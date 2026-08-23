import { CategoryQuotasPatchSchema } from '../../models/category-quotas'
import { sendZodError } from '../../utils/sendZodError'
import { saveCategoryQuotas } from './handlers/saveCategoryQuotas'

// Thin route. The authenticated wrapper enforces the session first, then the body is validated and the
// handler does the write. A validation failure is a 422 with per-field data through sendZodError, and
// there is no other error surface. Mirrors server/api/me/work-settings.patch.ts.
export default defineAuthenticatedEventHandler(async (event) => {
  const result = await readValidatedBody(event, CategoryQuotasPatchSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return saveCategoryQuotas(event, result.data)
})
