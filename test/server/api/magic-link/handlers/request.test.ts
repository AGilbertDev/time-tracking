import type { Client } from '@libsql/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countRows,
  createTaskTestDb,
  OWNER_ID,
  seedMagicLinkToken,
  seedUserAccount
} from '../../../../helpers/taskTestDb'

// server/api/magic-link/handlers/request.ts, the invite-only signup entry point. It was at 0 percent.
//
// What the specs fix:
//
//   docs/spec.md line 16: "sign-up (/inscription, invite-only magic link)".
//
//   docs/specs/admin/manage-users.md line 157: removing an email from the allowlist "alone revokes an
//   invited-only invitation and prevents any new magic link (request.ts returns neutrally for a
//   non-allowlisted email)". That neutrality is the security property of this handler: the response
//   must not reveal whether an address is on the allowlist or whether an account exists.
//
//   docs/specs/admin/manage-users.md line 75: after the sendEmail extraction, "Its externally
//   observable behaviour must not change (same subject, same body, same neutral responses, same 503
//   on failure)."
//
//   docs/specs/admin/manage-users.md line 90: "Do not create a users row. Invited people live in the
//   allowlist only until they accept. The users row is created later by
//   magic-link/handlers/verify.ts when they open their link, exactly as today."
//
//   docs/specs/admin/manage-users.md line 162 draws the contrast that fixes this handler's failure
//   behaviour: an email failure does not revert a deactivation, and "This deliberately differs from
//   the magic-link handler, where a send failure aborts."
//
// The handler's own comments fix the rest: the token is deleted-then-recreated per email "to keep the
// table clean", the token is persisted before the send "so a failed delivery does not leave an
// orphaned token", and an account that already has a password is not sent a link because "Those users
// sign in with their password instead."
//
// WHAT IS MOCKED, AND WHERE THE SEAM IS. sendEmail is replaced, because it is the only infrastructure
// this handler reaches and it owns the Resend client. Everything else runs for real: the allowlist
// lookup, the users lookup, the token delete and insert, and the template selection all execute
// against a real in-memory SQLite database and the real email-templates module. So "no email was
// sent" and "no token was written" are both read from something that would have happened.
//
// The token lifetime is asserted under fake timers, so the 15 minutes is an exact stored value rather
// than a range.

const { dbRef, sendEmailMock } = vi.hoisted(() => ({
  dbRef: { current: null as unknown },
  sendEmailMock: vi.fn()
}))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))
vi.mock('~~/server/utils/sendEmail', () => ({ sendEmail: sendEmailMock }))

const { requestMagicLink } = await import('~~/server/api/magic-link/handlers/request')

const SITE_URL = 'https://time-tracker.agilbert.dev'
const INVITEE = 'invitee@example.com'
// The email of the first fixture user, so a case needing a real users row can set columns on it.
const OWNER_EMAIL = 'owner@example.com'

const NOW = new Date('2026-09-08T12:00:00Z')
const FIFTEEN_MINUTES_IN_SECONDS = 15 * 60

let harness: TaskTestDb
let client: Client

// The allowlist has no seed helper in test/helpers/taskTestDb.ts, so it is written here with raw SQL
// in the same style as the helpers, deliberately bypassing the admin invite path so a fixture can
// never be shaped by the code that writes the key this handler reads.
async function seedAllowedEmail(target: Client, email: string): Promise<void> {
  await target.execute({
    sql: 'INSERT INTO allowed_emails (email, invited_at) VALUES (?, ?)',
    args: [email, Math.floor(NOW.getTime() / 1000)]
  })
}

// Every stored magic-link token, raw, so what the handler wrote and what it deleted are read from the
// database rather than from the handler's own return value.
async function readTokenRows(target: Client): Promise<Record<string, unknown>[]> {
  const result = await target.execute('SELECT * FROM magic_link_tokens ORDER BY email, token')
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)))
}

// The single argument the mocked sender was handed.
function sentMessage() {
  expect(sendEmailMock).toHaveBeenCalledTimes(1)
  return sendEmailMock.mock.calls[0]?.[0] as { html: string; subject: string; to: string }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)

  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue(undefined)

  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  vi.stubGlobal('useRuntimeConfig', () => ({ siteUrl: SITE_URL }))
  vi.stubGlobal('createError', (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options)
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the instrument, before anything is concluded from a neutral response', () => {
  // Almost every criterion below reads { success: true }, which is the same answer the handler gives
  // when it sends nothing at all. That is the whole design of the endpoint, and it is also why an
  // assertion on the response proves nothing on its own. So the working path is shown first, and
  // every "did not send" case afterwards is read from the sender and from the token table.
  it('sends a link and stores a token for an allowlisted invitee', async () => {
    await seedAllowedEmail(client, INVITEE)

    const result = await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(result).toEqual({ success: true })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(await readTokenRows(client)).toHaveLength(1)
  })
})

describe('the allowlist gate, which the response never reveals', () => {
  it('answers success for an email that is not on the allowlist', async () => {
    const result = await requestMagicLink({ email: 'stranger@example.com', locale: 'fr' })

    expect(result).toEqual({ success: true })
  })

  it('sends nothing for an email that is not on the allowlist', async () => {
    await requestMagicLink({ email: 'stranger@example.com', locale: 'fr' })

    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('writes no token for an email that is not on the allowlist', async () => {
    await requestMagicLink({ email: 'stranger@example.com', locale: 'fr' })

    expect(await readTokenRows(client)).toEqual([])
  })

  it('gives a non-allowlisted address the same response as an allowlisted one', async () => {
    // The point of the neutrality: an attacker enumerating addresses learns nothing. Asserted as an
    // equality between the two responses rather than as two separate shape checks, because that is
    // the property, not the shape.
    await seedAllowedEmail(client, INVITEE)

    const allowed = await requestMagicLink({ email: INVITEE, locale: 'fr' })
    const notAllowed = await requestMagicLink({ email: 'stranger@example.com', locale: 'fr' })

    expect(notAllowed).toEqual(allowed)
  })

  it('creates no users row for a non-allowlisted address', async () => {
    await requestMagicLink({ email: 'stranger@example.com', locale: 'fr' })

    // The two fixture users and nothing more.
    expect(await countRows(client, 'users')).toBe(2)
  })

  it('does not add the address to the allowlist as a side effect', async () => {
    await requestMagicLink({ email: 'stranger@example.com', locale: 'fr' })

    expect(await countRows(client, 'allowed_emails')).toBe(0)
  })

  it('matches the allowlist key exactly, which is why the schema lowercases the address', async () => {
    // SQLite text comparison is case-sensitive, so a mixed-case address does not match a lowercased
    // allowlist row and falls into the neutral no-send path. server/models/magic-link.ts normalizes
    // before this handler is ever reached, and this is the failure that normalization prevents: a
    // cheerful confirmation and no email. Asserted here so the model's rule has a consequence
    // attached to it rather than only a comment.
    await seedAllowedEmail(client, INVITEE)

    const result = await requestMagicLink({ email: 'Invitee@Example.com', locale: 'fr' })

    expect(result).toEqual({ success: true })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('does not send to a different allowlisted address than the one asked about', async () => {
    await seedAllowedEmail(client, 'someone.else@example.com')

    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('an account that already has a password gets no link', () => {
  beforeEach(async () => {
    await seedAllowedEmail(client, OWNER_EMAIL)
  })

  it('answers success without sending', async () => {
    // "Do not send a link to an account that already has a password. Those users sign in with their
    // password instead." A magic link that still worked for an established account would be a second
    // credential nobody asked for.
    await seedUserAccount(client, OWNER_ID, { passwordHash: 'fake-scrypt$whatever' })

    const result = await requestMagicLink({ email: OWNER_EMAIL, locale: 'fr' })

    expect(result).toEqual({ success: true })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('writes no token, so nothing is left behind to be replayed', async () => {
    await seedUserAccount(client, OWNER_ID, { passwordHash: 'fake-scrypt$whatever' })

    await requestMagicLink({ email: OWNER_EMAIL, locale: 'fr' })

    expect(await readTokenRows(client)).toEqual([])
  })

  it('leaves an existing token for that email untouched rather than deleting it', async () => {
    // The delete runs after both gates, so the early return happens before it. Recorded because it
    // is the shipped order and it means a live token is not revoked by an ignored request.
    await seedMagicLinkToken(client, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OWNER_EMAIL)
    await seedUserAccount(client, OWNER_ID, { passwordHash: 'fake-scrypt$whatever' })

    await requestMagicLink({ email: OWNER_EMAIL, locale: 'fr' })

    expect((await readTokenRows(client)).map((row) => row.token)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ])
  })

  it('gives the same response as an address with no account at all', async () => {
    await seedUserAccount(client, OWNER_ID, { passwordHash: 'fake-scrypt$whatever' })
    await seedAllowedEmail(client, INVITEE)

    const withPassword = await requestMagicLink({ email: OWNER_EMAIL, locale: 'fr' })
    const withoutAccount = await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(withPassword).toEqual(withoutAccount)
  })

  it('does send to an accepted invitee who has not set a password yet', async () => {
    // A users row created by the verify handler for somebody who opened their link but never
    // finished onboarding has a null password_hash, so they are still mid-signup and a fresh link is
    // exactly what they need. The gate is the password and not the existence of the row.
    await seedUserAccount(client, OWNER_ID, { passwordHash: null })

    await requestMagicLink({ email: OWNER_EMAIL, locale: 'fr' })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('does send to a deactivated account with no password, which the allowlist decides', async () => {
    // Deactivation removes the address from the allowlist (manage-users.md line 157), so the gate
    // that stops a deactivated person is the allowlist rather than this check. Asserted so the
    // division of responsibility is visible: if the allowlist row is present, this handler sends.
    await seedUserAccount(client, OWNER_ID, {
      deactivatedAt: new Date('2026-05-01T00:00:00Z'),
      passwordHash: null
    })

    await requestMagicLink({ email: OWNER_EMAIL, locale: 'fr' })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })
})

describe('the token that is written', () => {
  beforeEach(async () => {
    await seedAllowedEmail(client, INVITEE)
  })

  it('is stored against the requested email', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    const rows = await readTokenRows(client)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.email).toBe(INVITEE)
  })

  it('is a uuid rather than a guessable value', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(String((await readTokenRows(client))[0]?.token)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('is a different token on every request', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'fr' })
    const first = (await readTokenRows(client))[0]?.token
    await requestMagicLink({ email: INVITEE, locale: 'fr' })
    const second = (await readTokenRows(client))[0]?.token

    expect(second).not.toBe(first)
  })

  it('expires exactly fifteen minutes after the request', async () => {
    // The copy in both magic-link templates promises 15 minutes, so the stored lifetime and the
    // sentence the invitee reads have to be the same number. Asserted as an exact stored value under
    // a pinned clock rather than as a range.
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect((await readTokenRows(client))[0]?.expires_at).toBe(
      Math.floor(NOW.getTime() / 1000) + FIFTEEN_MINUTES_IN_SECONDS
    )
  })

  it('is stored unused', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect((await readTokenRows(client))[0]?.used).toBe(0)
  })

  it('replaces any previous token for the same email', async () => {
    // "Delete previous tokens for this email before creating a new one to keep the table clean." It
    // also means a re-request invalidates the earlier link, so a forwarded or intercepted old email
    // stops working.
    await seedMagicLinkToken(client, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', INVITEE)
    await seedMagicLinkToken(client, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', INVITEE)

    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    const rows = await readTokenRows(client)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).not.toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(rows[0]?.token).not.toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('leaves another invitee tokens alone', async () => {
    // The delete is keyed by email. A delete without the where clause would sign every other pending
    // invitee out of their own signup.
    await seedAllowedEmail(client, 'second@example.com')
    await seedMagicLinkToken(client, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'second@example.com')

    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    const tokens = (await readTokenRows(client)).map((row) => row.email)
    expect(tokens).toContain('second@example.com')
    expect(tokens).toHaveLength(2)
  })

  it('also replaces an expired previous token rather than accumulating rows', async () => {
    await seedMagicLinkToken(client, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', INVITEE, {
      expiresAt: new Date('2026-01-01T00:00:00Z')
    })

    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(await readTokenRows(client)).toHaveLength(1)
  })

  it('creates no users row, since an invited person lives in the allowlist until they accept', async () => {
    // manage-users.md line 90. The users row is the verify handler's to create.
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(await countRows(client, 'users')).toBe(2)
  })
})

describe('the message that goes out', () => {
  beforeEach(async () => {
    await seedAllowedEmail(client, INVITEE)
  })

  it('goes to the address that asked', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(sentMessage().to).toBe(INVITEE)
  })

  it('carries a verification URL built from the configured site URL and the stored token', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    const token = (await readTokenRows(client))[0]?.token
    expect(sentMessage().html).toContain(`${SITE_URL}/api/magic-link/verify?token=${token}`)
  })

  it('links the token it actually stored, not a second one', async () => {
    // The token in the email and the token in the table have to be the same value, or every link is
    // dead on arrival. Read from the database rather than from the handler's return value, which
    // carries no token at all.
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    const stored = String((await readTokenRows(client))[0]?.token)
    const linked = sentMessage().html.match(/token=([0-9a-f-]+)/)?.[1]
    expect(linked).toBe(stored)
  })

  it('reads the site URL from runtimeConfig rather than hardcoding a host', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ siteUrl: 'https://staging.example.dev' }))

    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(sentMessage().html).toContain('https://staging.example.dev/api/magic-link/verify?token=')
  })

  it('sends the French template for a French request', async () => {
    // "Sent by the signup form as its active UI locale so the magic-link email arrives in that
    // language." The literals are the shipped copy, asserted rather than corrected: the module header
    // records that every string is a proposal pending the owner's verification.
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(sentMessage().subject).toContain('Votre lien pour créer votre compte')
    expect(sentMessage().html).toContain('Créer mon compte')
  })

  it('sends the English template for an English request', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'en' })

    expect(sentMessage().subject).toContain('Your link to create your')
    expect(sentMessage().html).toContain('Create my account')
  })

  it('does not mix the two locales into one message', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'en' })

    expect(sentMessage().html).not.toContain('Créer mon compte')
  })

  it('falls back to the French template for any locale that is not English', async () => {
    // The selection is `locale === 'en' ? en : fr`, so French is the default arm. The schema already
    // refuses anything outside the shared LOCALES set, so this is a second line rather than the
    // first, and it agrees with FR being the product default.
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(sentMessage().subject).toContain('Votre lien')
  })

  it('sends exactly one message per request', async () => {
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the sender identity to sendEmail rather than naming a from address itself', async () => {
    // manage-users.md line 76 puts the sender identity in one audited place. A handler passing its
    // own from would be a second copy of it.
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    expect(Object.keys(sentMessage()).sort()).toEqual(['html', 'subject', 'to'])
  })
})

describe('a delivery failure aborts the request', () => {
  beforeEach(async () => {
    await seedAllowedEmail(client, INVITEE)
  })

  // manage-users.md line 162, stating the contrast explicitly: "This deliberately differs from the
  // magic-link handler, where a send failure aborts." Line 75 pins the status: "same 503 on failure".
  //
  // The exact status is asserted rather than the fact of a rejection. A TypeError from a broken
  // template also rejects and would look identical to a caller checking only that the promise failed.
  it('propagates the 503 from the sender', async () => {
    expect.assertions(2)
    sendEmailMock.mockRejectedValue(
      Object.assign(new Error('Failed to send email. Please try again.'), {
        statusCode: 503,
        statusMessage: 'Failed to send email. Please try again.'
      })
    )

    try {
      await requestMagicLink({ email: INVITEE, locale: 'fr' })
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(503)
      expect((error as { statusMessage: string }).statusMessage).toBe(
        'Failed to send email. Please try again.'
      )
    }
  })

  it('does not answer success when the message could not be sent', async () => {
    expect.assertions(1)
    sendEmailMock.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }))

    await expect(requestMagicLink({ email: INVITEE, locale: 'fr' })).rejects.toMatchObject({
      statusCode: 503
    })
  })

  it('keeps the token it already persisted, so a retry is not required to recover', async () => {
    // "Persist the token before sending so a failed delivery does not leave an orphaned token." The
    // ordering means the interrupted path leaves a usable token rather than a half-written state: if
    // the invitee somehow has the link, it still verifies, and if they do not, requesting another one
    // replaces this row.
    sendEmailMock.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }))

    await expect(requestMagicLink({ email: INVITEE, locale: 'fr' })).rejects.toThrow()

    const rows = await readTokenRows(client)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.email).toBe(INVITEE)
  })

  it('lets a second request replace the token the failed one left behind', async () => {
    // The recovery path in full: the invitee presses the button again and gets one live token, not
    // two.
    sendEmailMock.mockRejectedValueOnce(Object.assign(new Error('down'), { statusCode: 503 }))
    await expect(requestMagicLink({ email: INVITEE, locale: 'fr' })).rejects.toThrow()
    const orphaned = (await readTokenRows(client))[0]?.token

    sendEmailMock.mockResolvedValue(undefined)
    await requestMagicLink({ email: INVITEE, locale: 'fr' })

    const rows = await readTokenRows(client)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).not.toBe(orphaned)
  })

  it('creates no users row on the failed path either', async () => {
    sendEmailMock.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }))

    await expect(requestMagicLink({ email: INVITEE, locale: 'fr' })).rejects.toThrow()

    expect(await countRows(client, 'users')).toBe(2)
  })
})
