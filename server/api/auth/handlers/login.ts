import type { H3Event } from 'h3'
import type { z } from 'zod'

import { eq } from 'drizzle-orm'

import type { LoginSchema } from '../../../models/auth'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'

export async function loginWithPassword(event: H3Event, body: z.infer<typeof LoginSchema>) {
  const db = useDb()
  const user = await db.select().from(users).where(eq(users.email, body.email)).get()

  // One generic failure for unknown email, no password set, or wrong password, so the
  // response never reveals which emails have accounts.
  const invalidCredentials = () =>
    createError({ statusCode: 401, statusMessage: 'invalid_credentials' })

  if (!user || !user.passwordHash) throw invalidCredentials()

  const passwordMatches = await verifyPassword(user.passwordHash, body.password)
  if (!passwordMatches) throw invalidCredentials()

  // Only after correct credentials do we disclose deactivation, so it is not an enumeration vector.
  if (user.deactivatedAt) {
    throw createError({ statusCode: 403, statusMessage: 'account_deactivated' })
  }

  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      onboarded: true
    }
  })

  return { success: true }
}
