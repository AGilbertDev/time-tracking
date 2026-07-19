import { Resend } from 'resend'

interface SendEmailOptions {
  html: string
  subject: string
  to: string
}

// Single place that owns the Resend client and the sender identity. Callers own their content
// (subject and html); this util owns how mail leaves the app. Extracted from the inline Resend
// construction that used to live in magic-link/handlers/request.ts so the from-address logic and
// the failure behaviour stay identical across every transactional email (magic link, invitation,
// deactivation notice) and the real sender identity lives in one audited spot for CASL / CAN-SPAM.
export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  const config = useRuntimeConfig()
  const resend = new Resend(config.resendApiKey as string)

  // Show a human sender name in the inbox rather than the bare noreply local part. If the
  // configured value already carries a display name in angle-bracket form it is used as is.
  const fromEmail = config.resendFromEmail as string
  const from = fromEmail.includes('<') ? fromEmail : `Alexandre Gilbert <${fromEmail}>`

  const { error } = await resend.emails.send({ from, to, subject, html })

  if (error) {
    throw createError({ statusCode: 503, statusMessage: 'Failed to send email. Please try again.' })
  }
}
