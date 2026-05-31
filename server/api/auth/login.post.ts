import { LoginSchema } from '../../models/auth'
import { sendZodError } from '../../utils/sendZodError'
import { loginWithPassword } from './handlers/login'

export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, LoginSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return loginWithPassword(event, result.data)
})
