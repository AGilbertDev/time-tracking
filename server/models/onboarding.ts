import { z } from 'zod'

// Password policy per NIST SP 800-63B. An 8-character floor and a generous max,
// with no composition rules. Strength comes from length plus a breach check
// against Have I Been Pwned, handled in the onboarding handler.
export const CompleteOnboardingSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(200, 'Password is too long.')
})
