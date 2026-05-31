import { CompleteOnboardingSchema } from '../../models/onboarding'
import { sendZodError } from '../../utils/sendZodError'
import { completeOnboarding } from './handlers/complete'

export default defineEventHandler(async (event) => {
  const result = await readValidatedBody(event, CompleteOnboardingSchema.safeParse)
  if (!result.success) return sendZodError(result.error)

  return completeOnboarding(event, result.data)
})
