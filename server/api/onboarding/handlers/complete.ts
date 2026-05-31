import type { H3Event } from 'h3'
import type { z } from 'zod'

import { eq } from 'drizzle-orm'

import type { CompleteOnboardingSchema } from '../../../models/onboarding'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'
import { isPasswordBreached } from '../../../utils/checkPasswordBreached'

export async function completeOnboarding(
  event: H3Event,
  body: z.infer<typeof CompleteOnboardingSchema>
) {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Reject passwords known to be compromised. statusMessage is a stable code the client maps to a localized message.
  if (await isPasswordBreached(body.password)) {
    throw createError({ statusCode: 422, statusMessage: 'password_breached' })
  }

  // Hash the password so the raw value is never stored.
  const passwordHash = await hashPassword(body.password)

  // Persist the profile. Setting passwordHash is what marks onboarding complete.
  await db
    .update(users)
    .set({
      firstName: body.firstName,
      lastName: body.lastName,
      passwordHash,
      updatedAt: new Date()
    })
    .where(eq(users.id, user.id))

  // Refresh the session so the middleware stops redirecting to onboarding.
  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      firstName: body.firstName,
      lastName: body.lastName,
      onboarded: true
    }
  })

  return { success: true }
}
