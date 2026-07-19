import type { z } from 'zod'

import { eq } from 'drizzle-orm'

import type { DeactivateSchema } from '../../../../models/admin'

import { useDb } from '../../../../db/index'
import { allowedEmails, users } from '../../../../db/schema'
import { loadUserPreferences } from '../../../../utils/loadUserPreferences'
import { selectDeactivationTemplate } from '../../../../utils/manage-users'
import { sendEmail } from '../../../../utils/sendEmail'

// `hadAccount` tells the frontend whether this was a real account or a revoked invitation.
// `delivered` is present only when a deactivation email was attempted; false means the state
// change still committed but delivery failed (a warning, not a failure).
export type DeactivateResult = {
  result: 'deactivated'
  hadAccount: boolean
  delivered?: boolean
}

// Deactivates an account or revokes an invitation, keyed by email. The security state change
// (allowlist removal, then deactivated_at) is committed before any email, so a send failure never
// reverts it. `sessionEmail` is the current admin's email, used to block self-deactivation.
export async function deactivateUser(
  body: z.infer<typeof DeactivateSchema>,
  sessionEmail: string
): Promise<DeactivateResult> {
  const config = useRuntimeConfig()
  const db = useDb()
  const { email } = body

  // Block admin self-deactivation so the sole admin cannot lock themselves out. Both sides are
  // lowercased (body.email is normalized by the schema) so a casing difference cannot slip past.
  if (email === sessionEmail.trim().toLowerCase()) {
    throw createError({ statusCode: 409, statusMessage: 'cannot_deactivate_self' })
  }

  // Remove from the allowlist first. This alone revokes an invited-only invitation and blocks any
  // new magic link (request.ts returns neutrally for a non-allowlisted email).
  await db.delete(allowedEmails).where(eq(allowedEmails.email, email))

  const user = await db.select().from(users).where(eq(users.email, email)).get()

  // Pure invited-only row: the invitation is now revoked and there is no account to notify.
  if (!user) {
    return { result: 'deactivated', hadAccount: false }
  }

  const now = new Date()
  await db.update(users).set({ deactivatedAt: now, updatedAt: now }).where(eq(users.id, user.id))

  // Only email an established, onboarded account. A users row with no password (accepted the link
  // but never onboarded) gets deactivated_at set but no email, since there is no account to notify.
  if (!user.passwordHash) {
    return { result: 'deactivated', hadAccount: true }
  }

  // Notify in the user's persisted locale (not a UI locale), with the contact address sourced
  // from config. Email failure does not revert the deactivation: the state is already committed,
  // so a Resend error surfaces as a delivery warning only.
  const preferences = await loadUserPreferences(user.id)
  const template = selectDeactivationTemplate(preferences.locale)

  let delivered = true
  try {
    await sendEmail({
      to: email,
      subject: template.subject,
      html: template.body(config.adminContactEmail as string)
    })
  } catch {
    delivered = false
  }

  return { result: 'deactivated', hadAccount: true, delivered }
}
