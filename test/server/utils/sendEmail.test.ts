import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_NAME } from '#shared/brand'

// server/utils/sendEmail.ts, the single place that owns the Resend client and the sender identity
// for every transactional email the app sends: the magic link, the invitation, and the deactivation
// notice.
//
// What the spec fixes, docs/specs/admin/manage-users.md line 73:
//
//   "Extract server/utils/sendEmail.ts from the inline Resend construction currently in
//   magic-link/handlers/request.ts. It owns the Resend client, the `from` display-name logic (use
//   the configured resendFromEmail, and if it has no angle-bracket display name, wrap it as
//   `Alexandre Gilbert <…>`), and the send call. Signature roughly sendEmail({ to, subject, html }):
//   Promise<void>, throwing a 503 on a Resend error exactly as request.ts does today."
//
// And why it exists as one module at all, line 76: "the sender identity and `from` formatting live
// in one place. This satisfies the compliance requirement for a clear, real sender identity across
// all transactional mail." Line 260 names the standard: "transactional owner-managed mail with a
// clear real sender identity (CASL / CAN-SPAM baseline via sendEmail)".
//
// ONE DIVERGENCE FROM THAT SPEC LINE, REPORTED RATHER THAN ASSERTED EITHER WAY AS A FAILURE.
//
// The spec sentence above says the display name is the owner's personal name. The shipped code wraps
// with APP_NAME instead, so the inbox reads `Time Tracking App <…>`. That is not drift with nothing
// behind it: shared/brand.ts declares APP_NAME as "The product's public name, shown to users in
// transactional email (the sender identity and the message copy). Kept in one place so the brand
// cannot drift between the sender name and the body", and server/utils/email-templates.ts gives the
// reason, "since a personal sender name alone does not tell them" which app the message is from.
// Two artifacts describe the shipped choice as deliberate and one older spec line describes the
// other. The assertions below therefore read the display name from the shared/brand.ts constant,
// which is the contract that names itself as the source for the sender identity, and never from a
// literal. What needs the owner's ruling is which of the two documents is now wrong, and
// manage-users.md line 73 is the one that looks stale.
//
// The transport is mocked and nothing here sends mail. `resend` is replaced at the module boundary,
// which is the only infrastructure this util touches, so the from-address rule, the argument
// pass-through, and the 503 all run for real.

const { constructedWith, sendMock } = vi.hoisted(() => ({
  constructedWith: [] as unknown[],
  sendMock: vi.fn()
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock }
    constructor(apiKey: unknown) {
      constructedWith.push(apiKey)
    }
  }
}))

const { sendEmail } = await import('~~/server/utils/sendEmail')

const API_KEY = 're_test_key'
const BARE_FROM = 'noreply@time-tracker.agilbert.dev'

const MESSAGE = {
  html: '<p>Bonjour</p>',
  subject: 'Votre lien',
  to: 'invitee@example.com'
} as const

let runtimeConfig: Record<string, unknown>

beforeEach(() => {
  constructedWith.length = 0
  sendMock.mockReset()
  // Resend answers with { data, error }, and this util reads only `error`. A successful send is an
  // error of null, which is what the real client returns.
  sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null })

  runtimeConfig = { resendApiKey: API_KEY, resendFromEmail: BARE_FROM }

  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)
  // An h3 error carrying its own statusCode and statusMessage, matching how every caller in this
  // repository reads the shipped createError. Mirrors test/helpers/nitroGlobals.ts.
  vi.stubGlobal('createError', (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options)
  )
})

// The single argument the mocked Resend client was handed.
function sentPayload() {
  expect(sendMock).toHaveBeenCalledTimes(1)
  return sendMock.mock.calls[0]?.[0] as Record<string, unknown>
}

describe('the instrument, before anything is concluded from a send that did not throw', () => {
  it('reaches the transport at all', async () => {
    await sendEmail(MESSAGE)

    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('can be made to throw, so a resolved send is a verdict', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })

    await expect(sendEmail(MESSAGE)).rejects.toThrow()
  })
})

describe('the Resend client', () => {
  it('is constructed with the configured API key', async () => {
    await sendEmail(MESSAGE)

    expect(constructedWith).toEqual([API_KEY])
  })

  it('reads the key from runtimeConfig rather than from an environment variable directly', async () => {
    runtimeConfig = { resendApiKey: 're_other_key', resendFromEmail: BARE_FROM }

    await sendEmail(MESSAGE)

    expect(constructedWith).toEqual(['re_other_key'])
  })
})

describe('the sender identity, which is the CASL and CAN-SPAM baseline', () => {
  it('wraps a bare configured address with the product name', async () => {
    await sendEmail(MESSAGE)

    expect(sentPayload().from).toBe(`${APP_NAME} <${BARE_FROM}>`)
  })

  it('names the product in the display name, so a recipient can tell which app wrote', async () => {
    // The compliance requirement is identifiability of the sender. shared/brand.ts is the declared
    // source for the name and it is read from there rather than retyped, so a rename of the product
    // cannot leave this assertion passing against a stale literal.
    await sendEmail(MESSAGE)

    expect(String(sentPayload().from)).toContain(APP_NAME)
  })

  it('carries a real routable address in every send', async () => {
    await sendEmail(MESSAGE)

    expect(String(sentPayload().from)).toMatch(/<[^@\s]+@[^@\s]+\.[a-z]{2,}>/i)
  })

  it('uses an already-formatted configured value as it stands', async () => {
    // The owner can override the whole display name through configuration, which is what
    // manage-users.md line 73 assumes when it names a person.
    const configured = 'Alexandre Gilbert <noreply@time-tracker.agilbert.dev>'
    runtimeConfig = { resendApiKey: API_KEY, resendFromEmail: configured }

    await sendEmail(MESSAGE)

    expect(sentPayload().from).toBe(configured)
  })

  it('does not wrap a configured display name a second time', async () => {
    const configured = 'Alexandre Gilbert <noreply@time-tracker.agilbert.dev>'
    runtimeConfig = { resendApiKey: API_KEY, resendFromEmail: configured }

    await sendEmail(MESSAGE)

    expect(String(sentPayload().from)).not.toContain(`${APP_NAME} <`)
    expect(String(sentPayload().from).match(/</g)).toHaveLength(1)
  })

  it.each([
    ['a bare address', 'noreply@example.com', `${APP_NAME} <noreply@example.com>`],
    ['a subdomain address', 'no-reply@mail.example.com', `${APP_NAME} <no-reply@mail.example.com>`],
    ['an address in angle brackets with no name', '<noreply@example.com>', '<noreply@example.com>'],
    [
      'a quoted display name',
      '"Time Tracking" <noreply@example.com>',
      '"Time Tracking" <noreply@example.com>'
    ]
  ])('formats %s as expected', async (_label, configured, expected) => {
    // The rule is a search for '<' anywhere in the configured value, so the third case is passed
    // through untouched. That is the shipped behaviour and it is harmless: a bracketed address with
    // no display name is still a valid From header, it simply carries no product name. It is only
    // reachable by configuring it that way deliberately.
    runtimeConfig = { resendApiKey: API_KEY, resendFromEmail: configured }

    await sendEmail(MESSAGE)

    expect(sentPayload().from).toBe(expected)
  })
})

describe('the caller owns the content and this util owns the envelope', () => {
  it('passes the recipient, subject, and html through unchanged', async () => {
    await sendEmail(MESSAGE)

    expect(sentPayload()).toEqual({
      from: `${APP_NAME} <${BARE_FROM}>`,
      html: MESSAGE.html,
      subject: MESSAGE.subject,
      to: MESSAGE.to
    })
  })

  it('sends exactly the four fields, adding no reply-to, cc, or bcc of its own', async () => {
    await sendEmail(MESSAGE)

    expect(Object.keys(sentPayload()).sort()).toEqual(['from', 'html', 'subject', 'to'])
  })

  it('does not rewrite, escape, or reflow the html it is handed', async () => {
    const html = `<p>Accentué : é à ù — and a "quote" & an <a href="https://x.dev?a=1&b=2">ampersand</a></p>`

    await sendEmail({ html, subject: 's', to: MESSAGE.to })

    expect(sentPayload().html).toBe(html)
  })

  it('does not rewrite a subject carrying accents or a pipe', async () => {
    const subject = 'Invitation à créer votre compte | Invitation to create your account'

    await sendEmail({ html: '<p>x</p>', subject, to: MESSAGE.to })

    expect(sentPayload().subject).toBe(subject)
  })

  it('sends to one recipient, exactly the address it was given', async () => {
    // Transactional, one recipient, per manage-users.md line 96. Nothing here fans a message out.
    await sendEmail({ ...MESSAGE, to: 'someone.else@example.org' })

    expect(sentPayload().to).toBe('someone.else@example.org')
  })

  it('resolves with no value on success', async () => {
    await expect(sendEmail(MESSAGE)).resolves.toBeUndefined()
  })
})

describe('a transport failure is a 503', () => {
  // "throwing a 503 on a Resend error exactly as request.ts does today" (manage-users.md line 73).
  // The exact status and message are asserted rather than the fact of a rejection, because a
  // TypeError from a broken payload also rejects and would look identical to a caller that only
  // checked that the promise failed.
  it('throws with statusCode 503', async () => {
    expect.assertions(2)
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })

    try {
      await sendEmail(MESSAGE)
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(503)
      expect((error as { statusMessage: string }).statusMessage).toBe(
        'Failed to send email. Please try again.'
      )
    }
  })

  it.each([
    ['a Resend error object', { message: 'domain not verified', name: 'validation_error' }],
    ['a rate-limit error', { message: 'Too many requests', name: 'rate_limit_exceeded' }],
    ['an error with no message', {}],
    ['an error reported as a string', 'something went wrong']
  ])('throws 503 given %s', async (_label, error) => {
    expect.assertions(1)
    sendMock.mockResolvedValue({ data: null, error })

    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('does not leak the transport error text to the caller', async () => {
    // The message is a fixed user-facing string, so a Resend diagnostic naming the sending domain or
    // the account does not travel to a client response.
    expect.assertions(1)
    sendMock.mockResolvedValue({ data: null, error: { message: 're_secret_account_detail' } })

    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({
      statusMessage: 'Failed to send email. Please try again.'
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['absent from the response', 'absent']
  ])('resolves when the error field is %s', async (_label, error) => {
    sendMock.mockResolvedValue(error === 'absent' ? { data: { id: 'm' } } : { data: null, error })

    await expect(sendEmail(MESSAGE)).resolves.toBeUndefined()
  })

  it('lets a thrown transport rejection propagate rather than swallowing it', async () => {
    // The util reads the returned error field and has no try of its own, so a client that rejects
    // outright (a socket failure inside the SDK) reaches the caller as-is. Recorded because the
    // failure a caller sees is then not a 503, so a route relying on the 503 alone would surface a
    // 500 for this case. It is the shipped behaviour and the SDK returns errors rather than
    // throwing them for API failures, so this is a narrow path rather than a live problem.
    expect.assertions(1)
    sendMock.mockRejectedValue(new Error('socket hang up'))

    await expect(sendEmail(MESSAGE)).rejects.toThrow('socket hang up')
  })
})
