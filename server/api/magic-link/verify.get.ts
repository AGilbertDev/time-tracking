import { VerifySchema } from '../../models/magic-link'
import { sendZodError } from '../../utils/sendZodError'
import { verifyMagicLink } from './handlers/verify'

export default defineEventHandler(async (event) => {
  const result = await getValidatedQuery(event, VerifySchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return verifyMagicLink(event, result.data)
})
