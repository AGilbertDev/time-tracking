import type { H3Event } from 'h3'
import type { z } from 'zod'

import { and, eq, gt } from 'drizzle-orm'

import type { VerifySchema } from '../../../models/magic-link'

import { useDb } from '../../../db/index'
import { magicLinkTokens, users } from '../../../db/schema'

export async function verifyMagicLink(event: H3Event, query: z.infer<typeof VerifySchema>) {
  const db = useDb()
  const { token } = query

  // Validate that the token exists, has not been used, and has not expired.
  const record = await db
    .select()
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.token, token),
        eq(magicLinkTokens.used, false),
        gt(magicLinkTokens.expiresAt, new Date())
      )
    )
    .get()

  if (!record) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired link.' })
  }

  // Mark the token as used immediately to prevent replay attacks.
  await db.update(magicLinkTokens).set({ used: true }).where(eq(magicLinkTokens.token, token))

  // Find or create the user row for this email.
  let user = await db.select().from(users).where(eq(users.email, record.email)).get()
  if (!user) {
    const [created] = await db.insert(users).values({ email: record.email }).returning()
    user = created
  }

  // Set the session cookie so subsequent requests are authenticated.
  await setUserSession(event, {
    user: { id: user!.id, email: user!.email, onboarded: !!user!.passwordHash }
  })

  return sendRedirect(event, '/')
}
