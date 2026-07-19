import type { z } from 'zod'

import { eq } from 'drizzle-orm'
import { Resend } from 'resend'

import type { RequestSchema } from '../../../models/magic-link'

import { useDb } from '../../../db/index'
import { allowedEmails, magicLinkTokens, users } from '../../../db/schema'
import { MINUTE_IN_MILLISECONDS } from '../../../utils/constants/time'
import { emailTemplates } from '../../../utils/email-templates'

export async function requestMagicLink(body: z.infer<typeof RequestSchema>) {
  const config = useRuntimeConfig()
  const db = useDb()
  const { email, locale } = body

  // Return without sending so the response does not reveal whether the email is on the allowlist.
  const allowed = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email)).get()
  if (!allowed) return { success: true }

  // Do not send a link to an account that already has a password. Those users sign in with their
  // password instead. The response stays neutral so it never reveals that an account exists.
  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  if (existing?.passwordHash) return { success: true }

  // Delete previous tokens for this email before creating a new one to keep the table clean.
  await db.delete(magicLinkTokens).where(eq(magicLinkTokens.email, email))

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 15 * MINUTE_IN_MILLISECONDS)

  // Persist the token before sending so a failed delivery does not leave an orphaned token.
  await db.insert(magicLinkTokens).values({ token, email, expiresAt })

  const verificationUrl = `${config.siteUrl}/api/magic-link/verify?token=${token}`
  const resend = new Resend(config.resendApiKey as string)
  const template = locale === 'en' ? emailTemplates.en.magicLink : emailTemplates.fr.magicLink

  // Show a human sender name in the inbox rather than the bare noreply local part. If the
  // configured value already carries a display name in angle-bracket form it is used as is.
  const fromEmail = config.resendFromEmail as string
  const from = fromEmail.includes('<') ? fromEmail : `Alexandre Gilbert <${fromEmail}>`

  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: template.subject,
    html: template.body(verificationUrl)
  })

  if (error) {
    throw createError({ statusCode: 503, statusMessage: 'Failed to send email. Please try again.' })
  }

  return { success: true }
}
