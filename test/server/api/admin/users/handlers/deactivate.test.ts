import type { Client } from '@libsql/client'

import { emailTemplates } from '~~/server/utils/email-templates'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../../helpers/nitroGlobals'
import {
  countRows,
  createTaskTestDb,
  instrumentedDb,
  OTHER_USER_ID,
  OWNER_ID,
  readUserRow,
  seedUserAccount
} from '../../../../../helpers/taskTestDb'
import {
  readAllowedEmailRow,
  readAllowedEmailRows,
  readAllUserRows,
  seedAllowedEmail,
  seedExtraUser
} from '../adminUsersFixtures'

// POST /api/admin/users/deactivate.
//
// Expected behaviour comes from the "Deactivate" section of docs/specs/admin/manage-users.md and
// its acceptance criteria: block admin self-deactivation with 409 cannot_deactivate_self, remove
// the email from allowed_emails, set deactivated_at on the users row when there is one, email a
// notice only for an established (password-bearing) account in that user's persisted locale, and
// never revert the state change when the send fails.
//
// Two properties get more attention than the rest, because they are the two that a passing suite
// can most easily fail to prove.
//
// The first is scoping. This is an admin acting on another person's account, so every case that
// writes also reads back a bystander account and the acting admin's own row and requires them
// byte-identical. An assertion that some row was not touched is worth nothing on its own, so each
// one is paired with the positive half in the same case: the target changed, and only the target.
//
// The second is the refusal. `expect(...).rejects` alone is satisfied by a TypeError, and this
// project has already been bitten by exactly that: a mutant that broke a comparison threw a
// RangeError, which rejected and touched no data, and only an assertion naming the status code
// could tell a refusal from a crash. So the self-deactivation cases assert statusCode 409 and
// statusMessage cannot_deactivate_self, and then assert the data is untouched as well.
//
// Mail is mocked at its module boundary (server/utils/sendEmail) so nothing is sent, and the
// database is real: useDb hands back Drizzle over in-memory libSQL with the shipped DDL.

const { dbRef, sendEmailMock } = vi.hoisted(() => ({
  dbRef: { current: null as unknown },
  sendEmailMock: vi.fn()
}))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))
vi.mock('~~/server/utils/sendEmail', () => ({ sendEmail: sendEmailMock }))

const { deactivateUser } = await import('~~/server/api/admin/users/handlers/deactivate')

const ADMIN_EMAIL = 'owner@example.com'
const TARGET_EMAIL = 'other@example.com'
const BYSTANDER_EMAIL = 'bystander@example.com'
const BYSTANDER_ID = 'user-bystander'
const CONTACT_EMAIL = 'alexandre.gilbert.dev@gmail.com'

const CREATED = new Date('2026-02-01T00:00:00Z')
const INVITED = new Date('2026-06-01T00:00:00Z')

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder
// The single ordered log of the writes the handler issued, with the mail attempt pushed into the
// same array by the sendEmail mock. One list shows the whole sequence rather than two that have to
// be interleaved by hand, which is what makes "the state is committed before any email" readable.
let order: string[]

// A settings row carrying a chosen locale, so the deactivation notice can be checked against the
// target's *persisted* locale rather than any UI locale. seedSettings in the shared harness takes a
// timezone but no locale, and the shared helpers are off-limits while other agents work, so this is
// a local raw-SQL fixture in the same style.
async function seedPersistedLocale(userId: string, locale: string): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO settings (id, user_id, locale) VALUES (?, ?, ?)',
    args: [`settings-${userId}`, userId, locale]
  })
}

// The acting admin, an onboarded target account, and a bystander account that no case may change.
// The bystander is deliberately an active, password-bearing, allowlisted account, which is the same
// shape as the target: if the delete or the update were unscoped it would come back deactivated and
// off the allowlist, and every scoping case below would fail.
async function seedThreeAccounts(): Promise<void> {
  await seedUserAccount(client, OWNER_ID, {
    createdAt: CREATED,
    firstName: 'Alexandre',
    lastName: 'Gilbert',
    passwordHash: 'hash-owner',
    role: 'admin'
  })
  await seedAllowedEmail(client, ADMIN_EMAIL, INVITED)

  await seedUserAccount(client, OTHER_USER_ID, {
    createdAt: CREATED,
    firstName: 'Bernard',
    lastName: 'Zola',
    passwordHash: 'hash-other',
    role: 'user'
  })
  await seedAllowedEmail(client, TARGET_EMAIL, INVITED)

  await seedExtraUser(client, {
    createdAt: CREATED,
    email: BYSTANDER_EMAIL,
    firstName: 'Claire',
    id: BYSTANDER_ID,
    lastName: 'Roy',
    passwordHash: 'hash-bystander'
  })
  await seedAllowedEmail(client, BYSTANDER_EMAIL, INVITED)
}

beforeEach(async () => {
  vi.clearAllMocks()

  harness = await createTaskTestDb()
  client = harness.client
  order = []
  dbRef.current = instrumentedDb(harness.db, order)

  recorder = installNitroGlobals()
  recorder.setRuntimeConfig({ adminContactEmail: CONTACT_EMAIL })

  sendEmailMock.mockImplementation(async () => {
    order.push('sendEmail')
  })
})

describe('deactivateUser on an established account', () => {
  // Spec criterion: "Deactivating an active account removes it from allowed_emails, sets
  // deactivated_at, and sends one deactivation email in that user's persisted locale naming the
  // contact address."
  it('sets deactivated_at, revokes the allowlist entry, and reports the account as having existed', async () => {
    await seedThreeAccounts()

    const before = Date.now()
    const result = await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)
    const after = Date.now()

    expect(result).toEqual({ result: 'deactivated', hadAccount: true, delivered: true })

    const row = await readUserRow(client, OTHER_USER_ID)
    const deactivatedAt = Number(row?.deactivated_at) * 1000
    expect(row?.deactivated_at).not.toBeNull()
    // Stamped at the moment of the request rather than copied from somewhere. The column holds Unix
    // seconds, so the lower bound is floored to the second the request started in.
    expect(deactivatedAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000)
    expect(deactivatedAt).toBeLessThanOrEqual(after)

    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeUndefined()
  })

  // The scoping half, paired with its positive half in one case so neither can pass alone.
  it('changes the target row and leaves the bystander and the acting admin byte-identical', async () => {
    await seedThreeAccounts()

    const bystanderBefore = await readUserRow(client, BYSTANDER_ID)
    const adminBefore = await readUserRow(client, OWNER_ID)

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    // Positive: the intended row really did change.
    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).not.toBeNull()
    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeUndefined()

    // Negative: and nobody else did, field by field rather than by count.
    expect(await readUserRow(client, BYSTANDER_ID)).toEqual(bystanderBefore)
    expect(await readUserRow(client, OWNER_ID)).toEqual(adminBefore)
    // Read back email-ascending, so bystander@ precedes owner@ and the target's row is simply gone.
    expect(await readAllowedEmailRows(client)).toEqual([
      { email: BYSTANDER_EMAIL, invited_at: Math.floor(INVITED.getTime() / 1000) },
      { email: ADMIN_EMAIL, invited_at: Math.floor(INVITED.getTime() / 1000) }
    ])
    expect(await countRows(client, 'users')).toBe(3)
  })

  // Spec: the notice is "in the user's persisted locale, read via loadUserPreferences(user.id)".
  it.each([
    { locale: 'fr', template: emailTemplates.fr.accountDeactivated },
    { locale: 'en', template: emailTemplates.en.accountDeactivated }
  ])(
    'sends the $locale notice for a target whose persisted locale is $locale',
    async ({ locale, template }) => {
      await seedThreeAccounts()
      await seedPersistedLocale(OTHER_USER_ID, locale)

      await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      expect(sendEmailMock).toHaveBeenCalledWith({
        to: TARGET_EMAIL,
        subject: template.subject,
        html: template.body(CONTACT_EMAIL)
      })
    }
  )

  // The project default is French, and a target with no settings row yet has no persisted locale.
  it('falls back to the French notice for a target with no persisted preferences', async () => {
    await seedThreeAccounts()

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: emailTemplates.fr.accountDeactivated.subject })
    )
  })

  // Spec: the contact address is "sourced from runtimeConfig.ownerEmail rather than hardcoding it",
  // shipped as runtimeConfig.adminContactEmail. A configured address must reach the body, so the
  // notice can never name a stale address baked into the template.
  it('names the configured contact address in the notice', async () => {
    await seedThreeAccounts()
    recorder.setRuntimeConfig({ adminContactEmail: 'support@elsewhere.example' })

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    expect(sendEmailMock.mock.calls[0]?.[0].html).toContain('support@elsewhere.example')
  })

  // Spec: "The security state change (allowlist removal and deactivated_at) is committed first; a
  // Resend failure is surfaced to the admin as a delivery warning only." The order is the guarantee,
  // so it is read off the write log rather than assumed from the fact that both happened.
  it('commits the allowlist removal and the deactivation before attempting any mail', async () => {
    await seedThreeAccounts()

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    expect(order).toEqual(['delete:allowed_emails', 'update:users', 'sendEmail'])
  })
})

describe('deactivateUser when mail fails', () => {
  // Spec criterion: "A deactivation email send failure still leaves the account deactivated and
  // reports a delivery warning." This is the interrupted path, and the spec is explicit that it
  // deliberately differs from the magic-link handler, where a send failure aborts.
  it('leaves the account deactivated and reports delivered false', async () => {
    await seedThreeAccounts()
    sendEmailMock.mockRejectedValueOnce(new Error('resend is down'))

    const result = await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    expect(result).toEqual({ result: 'deactivated', hadAccount: true, delivered: false })
    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).not.toBeNull()
    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeUndefined()
  })

  it('does not touch the bystander when mail fails', async () => {
    await seedThreeAccounts()
    const bystanderBefore = await readUserRow(client, BYSTANDER_ID)
    sendEmailMock.mockRejectedValueOnce(new Error('resend is down'))

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).not.toBeNull()
    expect(await readUserRow(client, BYSTANDER_ID)).toEqual(bystanderBefore)
  })
})

describe('deactivateUser on a row with no established account', () => {
  // Spec criterion: "Deactivating an invited-only row removes it from allowed_emails, sets no
  // deactivated_at beyond the row not existing, and sends no email."
  it('revokes an invited-only invitation, sends nothing, and creates no users row', async () => {
    await seedThreeAccounts()
    await seedAllowedEmail(client, 'invitee@example.com', INVITED)
    const usersBefore = await readAllUserRows(client)

    const result = await deactivateUser({ email: 'invitee@example.com' }, ADMIN_EMAIL)

    expect(result).toEqual({ result: 'deactivated', hadAccount: false })
    expect(await readAllowedEmailRow(client, 'invitee@example.com')).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
    // No account was invented for the revoked invitation, and no existing one was touched.
    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect(await countRows(client, 'users')).toBe(3)
  })

  // Spec edge case: "Accepted-but-not-onboarded email (a users row with null password_hash) ...
  // Deactivating it removes the allowlist entry and sets deactivated_at but sends no email, since
  // there is no established account to notify."
  it('deactivates an accepted-but-not-onboarded account without sending a notice', async () => {
    await seedThreeAccounts()
    await seedExtraUser(client, {
      createdAt: CREATED,
      email: 'accepted@example.com',
      id: 'user-accepted',
      passwordHash: null
    })
    await seedAllowedEmail(client, 'accepted@example.com', INVITED)

    const result = await deactivateUser({ email: 'accepted@example.com' }, ADMIN_EMAIL)

    expect(result).toEqual({ result: 'deactivated', hadAccount: true })
    expect((await readUserRow(client, 'user-accepted'))?.deactivated_at).not.toBeNull()
    expect(await readAllowedEmailRow(client, 'accepted@example.com')).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  // An email that exists nowhere. The spec makes this a no-op rather than an error: the deactivate
  // path is keyed by email, the allowlist delete simply matches nothing, and "No users row (pure
  // invited-only): the invitation is now revoked. Send no email. Done." There is no 404 in the
  // Deactivate section and none in its edge cases, so a refusal here would be the drift.
  it('is a harmless no-op for an email that exists in neither table', async () => {
    await seedThreeAccounts()
    const usersBefore = await readAllUserRows(client)
    const allowlistBefore = await readAllowedEmailRows(client)

    const result = await deactivateUser({ email: 'nobody@example.com' }, ADMIN_EMAIL)

    expect(result).toEqual({ result: 'deactivated', hadAccount: false })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect(await readAllowedEmailRows(client)).toEqual(allowlistBefore)
  })
})

describe('deactivateUser self-deactivation guard', () => {
  // Spec: "Block admin self-deactivation. If the target email equals the session user's email,
  // reject with createError({ statusCode: 409, statusMessage: 'cannot_deactivate_self' }). The sole
  // admin must not be able to lock themselves out."
  it('refuses with 409 cannot_deactivate_self when the target is the acting admin', async () => {
    expect.assertions(6)
    await seedThreeAccounts()

    try {
      await deactivateUser({ email: ADMIN_EMAIL }, ADMIN_EMAIL)
    } catch (error) {
      // The exact status, not merely that the promise rejected: a TypeError rejects too, and a
      // crash that happens to touch no data would satisfy every other assertion in this case.
      expect((error as { statusCode: number }).statusCode).toBe(409)
      expect((error as { statusMessage: string }).statusMessage).toBe('cannot_deactivate_self')
    }

    // Refused before any write: the admin is still active and still allowlisted.
    expect((await readUserRow(client, OWNER_ID))?.deactivated_at).toBeNull()
    expect(await readAllowedEmailRow(client, ADMIN_EMAIL)).toBeDefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(order).toEqual([])
  })

  // The guard is the only thing standing between the sole admin and a locked-out app, so it must
  // not be defeated by the casing or padding of the session email. The spec's whole intent is that
  // the target and the session user are the same person, and two spellings of one address are the
  // same person.
  it.each([
    { label: 'upper-cased', sessionEmail: 'OWNER@EXAMPLE.COM' },
    { label: 'mixed-cased', sessionEmail: 'Owner@Example.com' },
    { label: 'padded', sessionEmail: '  owner@example.com  ' }
  ])('still refuses with 409 for a $label session email', async ({ sessionEmail }) => {
    expect.assertions(4)
    await seedThreeAccounts()

    try {
      await deactivateUser({ email: ADMIN_EMAIL }, sessionEmail)
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(409)
      expect((error as { statusMessage: string }).statusMessage).toBe('cannot_deactivate_self')
    }

    expect((await readUserRow(client, OWNER_ID))?.deactivated_at).toBeNull()
    expect(await readAllowedEmailRow(client, ADMIN_EMAIL)).toBeDefined()
  })

  // The other side of the guard: it must refuse the admin's own address and nothing else. A guard
  // that refused everything would pass every case above.
  it('does not refuse a different address in the same request shape', async () => {
    await seedThreeAccounts()

    await expect(deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)).resolves.toEqual({
      result: 'deactivated',
      hadAccount: true,
      delivered: true
    })
  })
})

describe('deactivateUser on an already-deactivated account', () => {
  // The spec's Deactivate section lists no refusal for an already-deactivated target, and its
  // "Concurrent deactivate then reactivate" edge case says each is a discrete write whose final
  // state reflects whichever committed last. So this is idempotent, not an error: the account ends
  // up deactivated and off the allowlist either way. A 404 or a 409 here would be the drift.
  it('leaves the account deactivated without refusing', async () => {
    await seedThreeAccounts()
    const firstStamp = new Date('2026-05-01T00:00:00Z')
    await client.execute({
      sql: 'UPDATE users SET deactivated_at = ? WHERE id = ?',
      args: [Math.floor(firstStamp.getTime() / 1000), OTHER_USER_ID]
    })

    const result = await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    expect(result.result).toBe('deactivated')
    expect(result.hadAccount).toBe(true)
    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).not.toBeNull()
    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeUndefined()
  })

  it('still touches no other account on a repeat deactivation', async () => {
    await seedThreeAccounts()
    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)
    const bystanderBefore = await readUserRow(client, BYSTANDER_ID)
    const adminBefore = await readUserRow(client, OWNER_ID)

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).not.toBeNull()
    expect(await readUserRow(client, BYSTANDER_ID)).toEqual(bystanderBefore)
    expect(await readUserRow(client, OWNER_ID)).toEqual(adminBefore)
  })
})
