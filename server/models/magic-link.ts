import { z } from 'zod'

export const RequestSchema = z.object({
  email: z.email(),
  locale: z.enum(['fr', 'en']).default('fr')
})

export const VerifySchema = z.object({
  token: z.uuid()
})
