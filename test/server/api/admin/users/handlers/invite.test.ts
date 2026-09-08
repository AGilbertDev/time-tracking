import type { Client } from '@libsql/client'

import { emailTemplates } from '~~/server/utils/email-templates'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../../helpers/nitroGlobals'
import {
  countRows,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readUserRowByEmail,
  seedUserAccount
} from '../../../../../helpers/taskTestDb'
import {
  readAllowedEmailRow,
  readAllowedEmailRows,
  readAllUserRows,
  seedAllowedEmail,
  seedExtraUser,
  toSeconds
} from '../adminUsersFixtures'

// POST /api/admin/users/invite.
//
// Expected behaviour comes from the "Invite flow" section of docs/specs/admin/manage-users.md and
// its six acceptance criteria: classify the email against current state, add exactly one
// allowed_emails row for a new or still-pending address, never create a users row, send one fully
// bilingual invitation whose link opens the signup page, reject an already-active address and a
// deactivated one without any write or send, and treat a send failure as a delivery warning.
//
// The mail sender is mocked at its module boundary (server/utils/sendEmail) so nothing leaves the
// process, and the failure case injects the failure there rather than by stubbing any of the
// handler's own steps: every statement either side of the chosen moment still runs for real, so a
// run that stops halfway leaves exactly the partial state production would leave.
//
// On that partial state, the spec is explicit rather than silent. "A Resend failure surfaces to the
// admin as a delivery warning; the allowlist entry is harmless and the admin can re-invite to
// resend." So the allowlist row surviving a failed send is the specced outcome, not a half-created
// invitation to be reported as a defect: nothing is granted by an allowlist row on its own, because
// the person still has to request and open a magic link to get an account. The cases below assert
// that shape, and also assert the thing that would be a real half-creation, a users row appearing
// for somebody who never accepted.
//
// Every case that writes also reads back a bystander account and a bystander allowlist row and
// requires them unchanged, paired with the positive half in the same case.

const { dbRef, sendEmailMock } = vi.hoisted(() => ({
  dbRef: { current: null as unknown },
  sendEmailMock: vi.fn()
}))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))
vi.mock('~~/server/utils/sendEmail', () => ({ sendEmail: sendEmailMock }))

const { inviteUser } = await import('~~/server/api/admin/users/handlers/invite')

const SITE_URL = 'https://time-tracker.agilbert.dev'
// Spec: "Use the default-locale signup path (/inscription) for the link", because an invited person
// has no persisted locale yet.
const SIGNUP_URL = `${SITE_URL}/inscription`

const ACTIVE_EMAIL = 'owner@example.com'
const DEACTIVATED_EMAIL = 'other@example.com'
const BYSTANDER_EMAIL = 'bystander@example.com'
const BYSTANDER_ID = 'user-bystander'
const PENDING_EMAIL = 'pending@example.com'
const NEW_EMAIL = 'newcomer@example.com'

const CREATED = new Date('2026-02-01T00:00:00Z')
const DEACTIVATED = new Date('2026-05-01T00:00:00Z')
const INVITED = new Date('2026-06-01T00:00:00Z')

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

// One account in each state the classification has to tell apart, plus a bystander account and a
// bystander allowlist row that no invite may touch.
async function seedExistingState(): Promise<void> {
  await seedUserAccount(client, OWNER_ID, {
    createdAt: CREATED,
    firstName: 'Alexandre',
    lastName: 'Gilbert',
    passwordHash: 'hash-owner',
    role: 'admin'
  })

  await seedUserAccount(client, OTHER_USER_ID, {
    createdAt: CREATED,
    deactivatedAt: DEACTIVATED,
    firstName: 'Bernard',
    lastName: 'Zola',
    passwordHash: 'hash-other',
    role: 'user'
  })

  await seedExtraUser(client, {
    createdAt: CREATED,
    email: BYSTANDER_EMAIL,
    firstName: 'Claire',
    id: BYSTANDER_ID,
    lastName: 'Roy',
    passwordHash: 'hash-bystander'
  })
  await seedAllowedEmail(client, BYSTANDER_EMAIL, INVITED)

  // Still pending: on the allowlist, no users row, has not opened its link.
  await seedAllowedEmail(client, PENDING_EMAIL, INVITED)
}

beforeEach(async () => {
  vi.clearAllMocks()

  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  recorder = installNitroGlobals()
  recorder.setRuntimeConfig({ siteUrl: SITE_URL })
  sendEmailMock.mockResolvedValue(undefined)
})

describe('inviteUser with a brand-new email', () => {
  // Spec criterion: "Inviting a brand-new email adds exactly one allowed_emails row with a real
  // invited_at and creates no users row, and the recipient receives one bilingual email whose link
  // opens the signup page."
  it('adds exactly one allowlist row with a real invited_at', async () => {
    await seedExistingState()
    const countBefore = await countRows(client, 'allowed_emails')
    const before = Date.now()

    const result = await inviteUser({ email: NEW_EMAIL })

    expect(result).toEqual({ result: 'invited', delivered: true })
    expect(await countRows(client, 'allowed_emails')).toBe(countBefore + 1)

    const row = await readAllowedEmailRow(client, NEW_EMAIL)
    expect(row).toBeDefined()
    // A real date the list can show for the Invited row, stamped now rather than left to a
    // placeholder. The column holds Unix seconds, so the bound is floored to the request's second.
    expect(Number(row?.invited_at)).toBeGreaterThanOrEqual(Math.floor(before / 1000))
  })

  // "No users row is created on invite. Invited people live in the allowlist only until they
  // accept." The users row is created later by magic-link/handlers/verify.ts.
  it('creates no users row for the invited address', async () => {
    await seedExistingState()
    const usersBefore = await readAllUserRows(client)

    await inviteUser({ email: NEW_EMAIL })

    expect(await readUserRowByEmail(client, NEW_EMAIL)).toBeUndefined()
    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect(await countRows(client, 'users')).toBe(3)
  })

  it('sends one bilingual invitation whose single link opens the signup page', async () => {
    await seedExistingState()

    await inviteUser({ email: NEW_EMAIL })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: NEW_EMAIL,
      subject: emailTemplates.invite.subject,
      html: emailTemplates.invite.body(SIGNUP_URL)
    })

    // The two properties the spec fixes about that message, asserted on the sent body rather than
    // on the template alone: it carries both languages in one message (French first), and its
    // call-to-action points at the configured site's default-locale signup path.
    const html = sendEmailMock.mock.calls[0]?.[0].html as string
    expect(html).toContain(`href="${SIGNUP_URL}"`)
    expect(html.indexOf('Créer mon compte')).toBeGreaterThan(-1)
    expect(html.indexOf('Create my account')).toBeGreaterThan(html.indexOf('Créer mon compte'))
  })

  it('builds the signup link from the configured site url', async () => {
    await seedExistingState()
    recorder.setRuntimeConfig({ siteUrl: 'https://preview.example' })

    await inviteUser({ email: NEW_EMAIL })

    expect(sendEmailMock.mock.calls[0]?.[0].html).toContain(
      'href="https://preview.example/inscription"'
    )
  })

  // The scoping half: the invite lands on the intended email and on no other row in either table.
  it('leaves every other allowlist and users row byte-identical', async () => {
    await seedExistingState()
    const usersBefore = await readAllUserRows(client)
    const allowlistBefore = await readAllowedEmailRows(client)

    await inviteUser({ email: NEW_EMAIL })

    // Positive: the intended row exists now.
    expect(await readAllowedEmailRow(client, NEW_EMAIL)).toBeDefined()
    // Negative: and it is the only difference, field by field rather than by count.
    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect((await readAllowedEmailRows(client)).filter((row) => row.email !== NEW_EMAIL)).toEqual(
      allowlistBefore
    )
  })
})

describe('inviteUser on an address that must not be invited', () => {
  // Spec criterion: "Inviting an email that already has an active account sends nothing, adds no
  // duplicate row, and the UI reports that the account already exists."
  it('reports an already-active account without writing or sending anything', async () => {
    await seedExistingState()
    const usersBefore = await readAllUserRows(client)
    const allowlistBefore = await readAllowedEmailRows(client)

    const result = await inviteUser({ email: ACTIVE_EMAIL })

    expect(result).toEqual({ result: 'already-active' })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(await readAllowedEmailRow(client, ACTIVE_EMAIL)).toBeUndefined()
    expect(await readAllowedEmailRows(client)).toEqual(allowlistBefore)
    expect(await readAllUserRows(client)).toEqual(usersBefore)
  })

  // Spec criterion: "Inviting a deactivated email sends nothing, does not re-add it to the
  // allowlist, and the UI directs the admin to Reactivate." The reason is load-bearing: re-adding
  // it would leave deactivated_at set, so login would still 403 and the invitation would be a
  // dead end.
  it('refuses a deactivated address and leaves it off the allowlist and still deactivated', async () => {
    await seedExistingState()
    const usersBefore = await readAllUserRows(client)
    const allowlistBefore = await readAllowedEmailRows(client)

    const result = await inviteUser({ email: DEACTIVATED_EMAIL })

    expect(result).toEqual({ result: 'deactivated' })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(await readAllowedEmailRow(client, DEACTIVATED_EMAIL)).toBeUndefined()
    expect(await readAllowedEmailRows(client)).toEqual(allowlistBefore)
    // And nothing cleared deactivated_at behind the refusal, which is the state that keeps the
    // login refusing.
    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect((await readUserRowByEmail(client, DEACTIVATED_EMAIL))?.deactivated_at).toBe(
      toSeconds(DEACTIVATED)
    )
  })

  // A deactivated account that is somehow still allowlisted must not have its invited_at refreshed
  // either: the refusal happens before any allowlist write at all.
  it('does not refresh an allowlist row that belongs to a deactivated account', async () => {
    await seedExistingState()
    await seedAllowedEmail(client, DEACTIVATED_EMAIL, INVITED)

    const result = await inviteUser({ email: DEACTIVATED_EMAIL })

    expect(result).toEqual({ result: 'deactivated' })
    expect(await readAllowedEmailRow(client, DEACTIVATED_EMAIL)).toEqual({
      email: DEACTIVATED_EMAIL,
      invited_at: toSeconds(INVITED)
    })
  })
})

describe('inviteUser on a still-pending address', () => {
  // Spec criterion: "Re-inviting a still-pending email resends the bilingual email and refreshes
  // invited_at, without creating a second row."
  it('refreshes invited_at, keeps one row, and resends the invitation', async () => {
    await seedExistingState()
    const countBefore = await countRows(client, 'allowed_emails')

    const result = await inviteUser({ email: PENDING_EMAIL })

    expect(result).toEqual({ result: 'invited', delivered: true })
    expect(await countRows(client, 'allowed_emails')).toBe(countBefore)

    const row = await readAllowedEmailRow(client, PENDING_EMAIL)
    expect(Number(row?.invited_at)).toBeGreaterThan(toSeconds(INVITED))
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: PENDING_EMAIL, subject: emailTemplates.invite.subject })
    )
  })

  it('refreshes only the re-invited row and leaves the other allowlist row alone', async () => {
    await seedExistingState()

    await inviteUser({ email: PENDING_EMAIL })

    expect(Number((await readAllowedEmailRow(client, PENDING_EMAIL))?.invited_at)).toBeGreaterThan(
      toSeconds(INVITED)
    )
    expect(await readAllowedEmailRow(client, BYSTANDER_EMAIL)).toEqual({
      email: BYSTANDER_EMAIL,
      invited_at: toSeconds(INVITED)
    })
  })

  // Spec edge case: an accepted-but-not-onboarded email is a users row with a null password_hash,
  // which derives to Invited. "That is still a pending invite, so fall through and resend." So it
  // is neither of the two rejected classifications.
  it('resends to an account that accepted its link but never onboarded', async () => {
    await seedExistingState()
    await seedExtraUser(client, {
      createdAt: CREATED,
      email: 'accepted@example.com',
      id: 'user-accepted',
      passwordHash: null
    })
    const usersBefore = await readAllUserRows(client)

    const result = await inviteUser({ email: 'accepted@example.com' })

    expect(result).toEqual({ result: 'invited', delivered: true })
    expect(await readAllowedEmailRow(client, 'accepted@example.com')).toBeDefined()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    // No second users row for the same person, and the existing one is untouched.
    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect(await countRows(client, 'users')).toBe(4)
  })
})

describe('inviteUser when mail fails', () => {
  // Spec criterion: "A Resend failure surfaces to the admin as a delivery warning; the allowlist
  // entry is harmless and the admin can re-invite to resend." So the allowlist row is expected to
  // survive: the failure is reported as delivered: false rather than as a thrown error, and the
  // invitation is not half-created in any way that grants access, because the address still has to
  // request and open a magic link before an account exists.
  it('reports a delivery warning without throwing and keeps the allowlist entry', async () => {
    await seedExistingState()
    sendEmailMock.mockRejectedValueOnce(new Error('resend is down'))

    const result = await inviteUser({ email: NEW_EMAIL })

    expect(result).toEqual({ result: 'invited', delivered: false })
    expect(await readAllowedEmailRow(client, NEW_EMAIL)).toBeDefined()
  })

  // The half-creation that would matter: an account for somebody who never accepted. A failed send
  // must leave no users row, so nobody can sign in off an invitation that was never delivered.
  it('creates no users row when the send fails', async () => {
    await seedExistingState()
    const usersBefore = await readAllUserRows(client)
    sendEmailMock.mockRejectedValueOnce(new Error('resend is down'))

    await inviteUser({ email: NEW_EMAIL })

    expect(await readUserRowByEmail(client, NEW_EMAIL)).toBeUndefined()
    expect(await readAllUserRows(client)).toEqual(usersBefore)
  })

  it('touches no other row when the send fails', async () => {
    await seedExistingState()
    const allowlistBefore = await readAllowedEmailRows(client)
    sendEmailMock.mockRejectedValueOnce(new Error('resend is down'))

    await inviteUser({ email: NEW_EMAIL })

    expect(await readAllowedEmailRow(client, NEW_EMAIL)).toBeDefined()
    expect((await readAllowedEmailRows(client)).filter((row) => row.email !== NEW_EMAIL)).toEqual(
      allowlistBefore
    )
  })

  // The admin's recovery path from the warning, which the spec names explicitly: re-inviting
  // resends. A second attempt after a failed first one must succeed and must not duplicate the row.
  it('lets a re-invite resend successfully after a failed send', async () => {
    await seedExistingState()
    sendEmailMock.mockRejectedValueOnce(new Error('resend is down'))

    await inviteUser({ email: NEW_EMAIL })
    const second = await inviteUser({ email: NEW_EMAIL })

    expect(second).toEqual({ result: 'invited', delivered: true })
    expect(sendEmailMock).toHaveBeenCalledTimes(2)
    expect(
      (await readAllowedEmailRows(client)).filter((row) => row.email === NEW_EMAIL)
    ).toHaveLength(1)
  })
})
