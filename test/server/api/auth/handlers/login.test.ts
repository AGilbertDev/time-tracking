import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { fakeHash, installNitroGlobals } from '../../../../helpers/nitroGlobals'
import { code } from '../../../../helpers/sourceScan'
import {
  createTaskTestDb,
  OWNER_ID,
  seedSettings,
  seedUserAccount
} from '../../../../helpers/taskTestDb'

// AC13 of docs/specs/admin/onboarding-reset.md.
//
//   "server/api/auth/handlers/login.ts sets onboarded from users.onboarded_at rather than from a
//   literal. Signing in as an account with a non-null onboarded_at yields onboarded: true, and
//   signing in as an account with a password and a null onboarded_at, which is what a reset account
//   looks like, yields onboarded: false."
//
// This is where the real change lands. The flag used to be the literal true, which was sound only
// while the handler was unreachable without a verified password. An admin who has reset themselves
// still has a password, so the literal would send them to a dashboard they have no settings for
// instead of to the wizard. The recovery this whole feature depends on is an admin signing in from
// another device after abandoning the reset, so this pair of cases is the one that has to hold.
//
// Nothing exercised this handler before this suite existed. The column change moved its source of
// truth and the suite stayed green, which is exactly the condition under which a change ships
// untested, so the ordinary credential branches are covered here too rather than left implied.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { loginWithPassword } = await import('~~/server/api/auth/handlers/login')

const event = { __event: true } as never

const PASSWORD = 'a-password-the-owner-actually-typed'
const EMAIL = 'owner@example.com'
const ONBOARDED_AT = new Date('2026-03-01T12:00:00Z')

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  vi.clearAllMocks()

  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
})

describe('the instrument, before anything is concluded from a sign-in', () => {
  // Every case below reads the session the handler wrote. A handler that threw for an unrelated
  // reason would leave that array empty and several "does not carry onboarded true" assertions would
  // pass for the wrong reason, so a plain successful sign-in is shown working first.
  it('signs in an ordinary onboarded account and records a session', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: fakeHash(PASSWORD)
    })

    await expect(loginWithPassword(event, { email: EMAIL, password: PASSWORD })).resolves.toEqual({
      success: true
    })
    expect(recorder.sessions).toHaveLength(1)
  })
})

describe('AC13: the onboarded flag comes from users.onboarded_at', () => {
  it('yields onboarded true for an account with a non-null onboarded_at', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: fakeHash(PASSWORD)
    })

    await loginWithPassword(event, { email: EMAIL, password: PASSWORD })

    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: true })
  })

  it('yields onboarded false for an account with a password and a null onboarded_at', async () => {
    // What a reset account looks like: credentials intact, setup state cleared. Under the old literal
    // this returned true and the admin landed on a dashboard with no settings and no prompt.
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: null,
      passwordHash: fakeHash(PASSWORD)
    })

    await loginWithPassword(event, { email: EMAIL, password: PASSWORD })

    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })
  })

  it('follows the column when the same account is reset between two sign-ins', async () => {
    // The same account, the same password, two different answers, with only the column moving. A
    // literal cannot produce this and neither can anything keyed on password_hash.
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: fakeHash(PASSWORD)
    })
    await loginWithPassword(event, { email: EMAIL, password: PASSWORD })

    await client.execute({
      sql: 'UPDATE users SET onboarded_at = NULL WHERE id = ?',
      args: [OWNER_ID]
    })
    await loginWithPassword(event, { email: EMAIL, password: PASSWORD })

    expect(recorder.sessions.map((session) => session.onboarded)).toEqual([true, false])
  })

  it('does not read password_hash for the flag, proved by an account whose two columns disagree', async () => {
    // password_hash set, onboarded_at null. Anything still inferring setup state from the credential
    // would answer true here. This is the assertion that would go red if the flag were moved back.
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: null,
      passwordHash: fakeHash(PASSWORD)
    })

    await loginWithPassword(event, { email: EMAIL, password: PASSWORD })

    expect(recorder.sessions.at(-1)?.onboarded).not.toBe(true)
  })

  it('sets no literal true for the flag anywhere in the handler source', () => {
    // The behavioural pair above is the real assertion. This is the guard beside it, because a
    // literal reintroduced alongside a correct-looking branch is the shape a careless merge produces.
    expect(code('server/api/auth/handlers/login.ts')).not.toMatch(/onboarded:\s*true/)
  })

  it('has the instrument to find such a literal, proved where one correctly remains', () => {
    // The positive control. completeOnboarding keeps its literal true on purpose, because there it is
    // a statement about the onboarded_at value the same update just wrote rather than an inference
    // from the password. A search that could never match anything would report the same clean result
    // above.
    expect(code('server/api/onboarding/handlers/complete.ts')).toMatch(/onboarded:\s*true/)
  })
})

describe('the flag is decided independently of the persisted preferences', () => {
  it('carries the stored preferences and the flag from the column at the same time', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: null,
      passwordHash: fakeHash(PASSWORD)
    })
    await seedSettings(client, OWNER_ID, 'Europe/Paris')
    await client.execute({
      sql: 'UPDATE settings SET locale = ?, light_theme = ?, dark_theme = ? WHERE user_id = ?',
      args: ['en', 'foret', 'encre', OWNER_ID]
    })

    await loginWithPassword(event, { email: EMAIL, password: PASSWORD })

    // A reset account normally has no settings row at all. This one does, which is the step-1 partial
    // state from the recovery table, and the flag still has to come from the column rather than from
    // the presence of configuration.
    expect(recorder.sessions.at(-1)).toMatchObject({
      darkTheme: 'encre',
      lightTheme: 'foret',
      locale: 'en',
      onboarded: false
    })
  })
})

describe('the credential branches, which decide whether a session is minted at all', () => {
  it('refuses an unknown email with a generic 401', async () => {
    await expect(
      loginWithPassword(event, { email: 'nobody@example.com', password: PASSWORD })
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'invalid_credentials' })

    expect(recorder.sessions).toHaveLength(0)
  })

  it('refuses an account with no password with the same generic 401', async () => {
    // An invitee who accepted a magic link and never onboarded. The message must not tell the caller
    // which of the failures happened, or it becomes an enumeration vector.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: null })

    await expect(
      loginWithPassword(event, { email: EMAIL, password: PASSWORD })
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'invalid_credentials' })

    expect(recorder.sessions).toHaveLength(0)
  })

  it('refuses a wrong password with the same generic 401', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: fakeHash(PASSWORD)
    })

    await expect(
      loginWithPassword(event, { email: EMAIL, password: 'not-the-password' })
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'invalid_credentials' })

    expect(recorder.sessions).toHaveLength(0)
  })

  it('refuses a deactivated account with 403, only after the credentials check out', async () => {
    await seedUserAccount(client, OWNER_ID, {
      deactivatedAt: new Date('2026-06-01T00:00:00Z'),
      onboardedAt: ONBOARDED_AT,
      passwordHash: fakeHash(PASSWORD)
    })

    await expect(
      loginWithPassword(event, { email: EMAIL, password: PASSWORD })
    ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'account_deactivated' })

    expect(recorder.sessions).toHaveLength(0)
  })

  it('still refuses a deactivated account with a wrong password as invalid credentials', async () => {
    // Disclosing deactivation before the password is verified would make it an enumeration vector,
    // which is the reason the order is what it is.
    await seedUserAccount(client, OWNER_ID, {
      deactivatedAt: new Date('2026-06-01T00:00:00Z'),
      onboardedAt: ONBOARDED_AT,
      passwordHash: fakeHash(PASSWORD)
    })

    await expect(
      loginWithPassword(event, { email: EMAIL, password: 'not-the-password' })
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'invalid_credentials' })
  })
})
