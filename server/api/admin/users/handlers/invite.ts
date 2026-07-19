import type { z } from 'zod'

import { eq } from 'drizzle-orm'

import type { InviteSchema } from '../../../../models/admin'

import { useDb } from '../../../../db/index'
import { allowedEmails, users } from '../../../../db/schema'
import { emailTemplates } from '../../../../utils/email-templates'
import { deriveUserStatus } from '../../../../utils/manage-users'
import { sendEmail } from '../../../../utils/sendEmail'

// Classification the frontend toasts on. `invited` covers a brand-new invite and a resend to a
// still-pending email; `delivered` reports whether the invitation email actually went out so the
// UI can show a delivery warning without failing the whole action. `already-active` and
// `deactivated` are the two rejected paths.
export type InviteResult =
  | { result: 'invited'; delivered: boolean }
  | { result: 'already-active' }
  | { result: 'deactivated' }

// Adds an email to the allowlist and sends the bilingual invitation. It never creates a users
// row: the account is created later by magic-link/handlers/verify.ts when the person opens their
// link. Deactivated and already-active emails are rejected without any allowlist write or email.
export async function inviteUser(body: z.infer<typeof InviteSchema>): Promise<InviteResult> {
  const config = useRuntimeConfig()
  const db = useDb()
  const { email } = body

  // Reject the two states that must not be invited. A deactivated email must not be silently
  // re-added to the allowlist, because deactivated_at would still 403 the login; the admin is
  // directed to Reactivate instead. An already-active account needs no invite.
  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  if (existing) {
    const status = deriveUserStatus({
      passwordHash: existing.passwordHash,
      deactivatedAt: existing.deactivatedAt
    })
    if (status === 'deactivated') return { result: 'deactivated' }
    if (status === 'active') return { result: 'already-active' }
    // status 'invited' here means a users row exists with no password (accepted the link, never
    // onboarded). That is still a pending invite, so fall through and resend.
  }

  // New or still-pending: keep exactly one allowlist row and refresh invitedAt to now so a resend
  // updates the invited date rather than creating a duplicate.
  const allowed = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email)).get()
  if (allowed) {
    await db
      .update(allowedEmails)
      .set({ invitedAt: new Date() })
      .where(eq(allowedEmails.email, email))
  } else {
    await db.insert(allowedEmails).values({ email })
  }

  // The link points at the default-locale signup page. From there the person enters their email,
  // the magic-link request checks the allowlist, and the existing flow takes over. The message is
  // fully bilingual because an invited person has no persisted locale yet.
  const signupUrl = `${config.siteUrl}/inscription`

  // The allowlist row is already committed, so a send failure is a delivery warning, not a hard
  // failure: the admin can re-invite to resend and the row is harmless in the meantime.
  let delivered = true
  try {
    await sendEmail({
      to: email,
      subject: emailTemplates.invite.subject,
      html: emailTemplates.invite.body(signupUrl)
    })
  } catch {
    delivered = false
  }

  return { result: 'invited', delivered }
}
