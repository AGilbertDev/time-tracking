import { RequestSchema } from '../../models/magic-link'
import { sendZodError } from '../../utils/sendZodError'
import { requestMagicLink } from './handlers/request'

export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, RequestSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return requestMagicLink(result.data)
})
