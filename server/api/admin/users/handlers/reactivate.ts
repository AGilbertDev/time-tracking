import type { z } from 'zod'

import { eq } from 'drizzle-orm'

import type { ReactivateSchema } from '../../../../models/admin'

import { useDb } from '../../../../db/index'
import { allowedEmails, users } from '../../../../db/schema'

export type ReactivateResult = { result: 'reactivated' }

// Reverses a deactivation, keyed by email. Re-adds the email to the allowlist (a fresh invitedAt
// is fine, since the list surfaces users.createdAt for a real account) and clears deactivated_at
// so the account can sign in again on its next attempt. No email is sent.
export async function reactivateUser(
  body: z.infer<typeof ReactivateSchema>
): Promise<ReactivateResult> {
  const db = useDb()
  const { email } = body
  const now = new Date()

  const allowed = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email)).get()
  if (allowed) {
    await db.update(allowedEmails).set({ invitedAt: now }).where(eq(allowedEmails.email, email))
  } else {
    await db.insert(allowedEmails).values({ email })
  }

  const user = await db.select().from(users).where(eq(users.email, email)).get()
  if (user) {
    await db.update(users).set({ deactivatedAt: null, updatedAt: now }).where(eq(users.id, user.id))
  }

  return { result: 'reactivated' }
}
