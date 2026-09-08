import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../../helpers/nitroGlobals'
import {
  countRows,
  createTaskTestDb,
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
  seedExtraUser,
  toSeconds
} from '../adminUsersFixtures'

// POST /api/admin/users/reactivate, and the round trip it forms with deactivate.
//
// Expected behaviour comes from the "Reactivate" section of docs/specs/admin/manage-users.md: re-add
// the email to allowed_emails (a fresh invited_at is fine), clear deactivated_at when a users row
// exists, and send no email. Its acceptance criterion is "Reactivating a deactivated account
// re-adds it to the allowlist and clears deactivated_at, and the user can sign in again."
//
// Deactivate and reactivate are a pair with an ordering property, so the round trip is exercised
// here through both real handlers rather than by seeding the deactivated state by hand. Seeding it
// would prove that reactivate clears a column somebody else set; driving the pair proves the two
// halves actually compose, which is the property the admin page depends on.
//
// Both handlers act on another person's row, so every writing case also reads back a bystander
// account and requires it unchanged. The bystander here is itself deactivated, which is the strong
// form of the assertion: an unscoped clear of deactivated_at would reactivate it too, and a
// bystander that was merely active could never show that.

const { dbRef, sendEmailMock } = vi.hoisted(() => ({
  dbRef: { current: null as unknown },
  sendEmailMock: vi.fn()
}))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))
vi.mock('~~/server/utils/sendEmail', () => ({ sendEmail: sendEmailMock }))

const { reactivateUser } = await import('~~/server/api/admin/users/handlers/reactivate')
const { deactivateUser } = await import('~~/server/api/admin/users/handlers/deactivate')

const ADMIN_EMAIL = 'owner@example.com'
const TARGET_EMAIL = 'other@example.com'
const BYSTANDER_EMAIL = 'bystander@example.com'
const BYSTANDER_ID = 'user-bystander'

const CREATED = new Date('2026-02-01T00:00:00Z')
const DEACTIVATED = new Date('2026-05-01T00:00:00Z')
const INVITED = new Date('2026-06-01T00:00:00Z')

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

// The acting admin plus two deactivated accounts. Both targets are off the allowlist, which is the
// state deactivate leaves behind, so reactivate has to put a row back rather than only refresh one.
async function seedTwoDeactivatedAccounts(): Promise<void> {
  await seedUserAccount(client, OWNER_ID, {
    createdAt: CREATED,
    passwordHash: 'hash-owner',
    role: 'admin'
  })
  await seedAllowedEmail(client, ADMIN_EMAIL, INVITED)

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
    deactivatedAt: DEACTIVATED,
    email: BYSTANDER_EMAIL,
    firstName: 'Claire',
    id: BYSTANDER_ID,
    lastName: 'Roy',
    passwordHash: 'hash-bystander'
  })
}

beforeEach(async () => {
  vi.clearAllMocks()

  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  recorder = installNitroGlobals()
  recorder.setRuntimeConfig({ adminContactEmail: 'contact@example.com' })
  sendEmailMock.mockResolvedValue(undefined)
})

describe('reactivateUser', () => {
  it('clears deactivated_at and puts the email back on the allowlist', async () => {
    await seedTwoDeactivatedAccounts()

    const before = Date.now()
    const result = await reactivateUser({ email: TARGET_EMAIL })

    expect(result).toEqual({ result: 'reactivated' })

    const row = await readUserRow(client, OTHER_USER_ID)
    expect(row?.deactivated_at).toBeNull()
    // The account keeps its credentials, so it can actually sign in again rather than merely
    // stopping being refused.
    expect(row?.password_hash).toBe('hash-other')

    const allowed = await readAllowedEmailRow(client, TARGET_EMAIL)
    expect(allowed).toBeDefined()
    expect(Number(allowed?.invited_at)).toBeGreaterThanOrEqual(Math.floor(before / 1000))
  })

  // The scoping half. Both accounts start deactivated, so an unscoped clear would reactivate the
  // bystander as well; the positive and negative halves are in one case so neither passes alone.
  it('reactivates the target while the other deactivated account stays deactivated', async () => {
    await seedTwoDeactivatedAccounts()

    await reactivateUser({ email: TARGET_EMAIL })

    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).toBeNull()
    expect((await readUserRow(client, BYSTANDER_ID))?.deactivated_at).toBe(toSeconds(DEACTIVATED))
    // And the bystander was not quietly re-allowlisted either.
    expect(await readAllowedEmailRow(client, BYSTANDER_EMAIL)).toBeUndefined()
    expect(await countRows(client, 'users')).toBe(3)
  })

  it('leaves the acting admin row byte-identical', async () => {
    await seedTwoDeactivatedAccounts()
    const adminBefore = await readUserRow(client, OWNER_ID)

    await reactivateUser({ email: TARGET_EMAIL })

    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).toBeNull()
    expect(await readUserRow(client, OWNER_ID)).toEqual(adminBefore)
  })

  // Spec: "No email is sent on reactivation (none was requested)."
  it('sends no email', async () => {
    await seedTwoDeactivatedAccounts()

    await reactivateUser({ email: TARGET_EMAIL })

    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  // The allowlist email column is the primary key, so a reactivation of a row that is somehow still
  // allowlisted has to refresh it rather than insert a second one. Spec: "Re-add the email to
  // allowed_emails (a fresh invited_at is fine)".
  it('refreshes an existing allowlist row rather than adding a second one', async () => {
    await seedTwoDeactivatedAccounts()
    await seedAllowedEmail(client, TARGET_EMAIL, INVITED)
    const countBefore = await countRows(client, 'allowed_emails')

    await reactivateUser({ email: TARGET_EMAIL })

    expect(await countRows(client, 'allowed_emails')).toBe(countBefore)
    const allowed = await readAllowedEmailRow(client, TARGET_EMAIL)
    expect(Number(allowed?.invited_at)).toBeGreaterThan(toSeconds(INVITED))
    // Scoped to the reactivated email: the acting admin's own allowlist row keeps the invited date
    // it was seeded with. A refresh with no email in its where clause would restamp every row here,
    // and the count assertion above would not notice.
    expect(await readAllowedEmailRow(client, ADMIN_EMAIL)).toEqual({
      email: ADMIN_EMAIL,
      invited_at: toSeconds(INVITED)
    })
  })

  // The spec's Reactivate section lists no refusal for an account that is already active: step 2 is
  // "If a users row exists, clear deactivated_at (set null)", which is a no-op when it is already
  // null. So this is idempotent rather than an error, matching the "concurrent deactivate then
  // reactivate" edge case where the final state is whichever write committed last.
  it('is a harmless no-op on an already-active account', async () => {
    await seedTwoDeactivatedAccounts()
    await seedUserAccount(client, OTHER_USER_ID, { deactivatedAt: null })

    const result = await reactivateUser({ email: TARGET_EMAIL })

    expect(result).toEqual({ result: 'reactivated' })
    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).toBeNull()
    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeDefined()
    // Still nobody else's business.
    expect((await readUserRow(client, BYSTANDER_ID))?.deactivated_at).toBe(toSeconds(DEACTIVATED))
  })

  // An email that exists in neither table. Reactivate is keyed by email and step 1 re-adds it to
  // the allowlist unconditionally, which is exactly an invitation; step 2 is conditional on a users
  // row existing. So the specced outcome is an allowlist row and no invented account, not a 404.
  it('allowlists an unknown email without inventing an account for it', async () => {
    await seedTwoDeactivatedAccounts()
    const usersBefore = await readAllUserRows(client)

    const result = await reactivateUser({ email: 'nobody@example.com' })

    expect(result).toEqual({ result: 'reactivated' })
    expect(await readAllowedEmailRow(client, 'nobody@example.com')).toBeDefined()
    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect(await countRows(client, 'users')).toBe(3)
  })
})

describe('deactivate and reactivate round trip', () => {
  // The pair's ordering property, driven through both real handlers. Deactivating sets
  // deactivated_at and drops the allowlist row; reactivating clears the column and puts the row
  // back. Each intermediate state is read from the database so the sequence is observed rather than
  // inferred from the final state, which two no-ops would also produce.
  it('returns an active allowlisted account to exactly that state', async () => {
    await seedTwoDeactivatedAccounts()
    // Start from the state the admin page starts from: an active, allowlisted account.
    await seedUserAccount(client, OTHER_USER_ID, { deactivatedAt: null })
    await seedAllowedEmail(client, TARGET_EMAIL, INVITED)

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)

    // Midpoint: deactivated and off the allowlist, which is what blocks the next login and the next
    // magic link respectively.
    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).not.toBeNull()
    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeUndefined()

    await reactivateUser({ email: TARGET_EMAIL })

    // End: back to active and allowlisted, with the credentials and identity columns intact.
    const row = await readUserRow(client, OTHER_USER_ID)
    expect(row?.deactivated_at).toBeNull()
    expect(row?.password_hash).toBe('hash-other')
    expect(row?.first_name).toBe('Bernard')
    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeDefined()
  })

  it('survives a repeated round trip and still leaves the bystander deactivated', async () => {
    await seedTwoDeactivatedAccounts()
    await seedUserAccount(client, OTHER_USER_ID, { deactivatedAt: null })
    await seedAllowedEmail(client, TARGET_EMAIL, INVITED)

    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)
    await reactivateUser({ email: TARGET_EMAIL })
    await deactivateUser({ email: TARGET_EMAIL }, ADMIN_EMAIL)
    await reactivateUser({ email: TARGET_EMAIL })

    expect((await readUserRow(client, OTHER_USER_ID))?.deactivated_at).toBeNull()
    expect(await readAllowedEmailRow(client, TARGET_EMAIL)).toBeDefined()
    // Four writes aimed at one email, and the account count and the bystander are both unmoved.
    expect((await readUserRow(client, BYSTANDER_ID))?.deactivated_at).toBe(toSeconds(DEACTIVATED))
    expect(await countRows(client, 'users')).toBe(3)
    expect(await readAllowedEmailRows(client)).toHaveLength(2)
  })

  // Reactivating something deactivate has revoked as an invitation, rather than as an account. The
  // invited-only row had no users row to stamp, so the round trip is entirely in the allowlist.
  it('restores a revoked invitation as an allowlist row with no account', async () => {
    await seedTwoDeactivatedAccounts()
    await seedAllowedEmail(client, 'invitee@example.com', INVITED)

    const revoked = await deactivateUser({ email: 'invitee@example.com' }, ADMIN_EMAIL)
    expect(revoked).toEqual({ result: 'deactivated', hadAccount: false })
    expect(await readAllowedEmailRow(client, 'invitee@example.com')).toBeUndefined()

    await reactivateUser({ email: 'invitee@example.com' })

    expect(await readAllowedEmailRow(client, 'invitee@example.com')).toBeDefined()
    expect(await countRows(client, 'users')).toBe(3)
  })
})
