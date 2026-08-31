import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import { code } from '../../../../helpers/sourceScan'
import {
  createTaskTestDb,
  OWNER_ID,
  readMagicLinkToken,
  readUserRow,
  readUserRowByEmail,
  seedMagicLinkToken,
  seedUserAccount
} from '../../../../helpers/taskTestDb'

// AC14 of docs/specs/admin/onboarding-reset.md, which is the subtle one.
//
//   "server/api/magic-link/handlers/verify.ts sets onboarded from users.onboarded_at, and its
//   separate redirect rule still tests password_hash. An account with a password is still redirected
//   without a session being minted, and that redirect fires regardless of what onboarded_at holds.
//   This is the criterion that stops a later stage collapsing the two rules onto one column."
//
// One file, two rules, two columns, on purpose. The redirect above is about credentials: it keeps a
// leaked or replayed link inert once the account can authenticate with a password. The session flag
// below is about setup state. Collapsing them either way is a real failure rather than a tidy-up.
// Onto onboarded_at, and a magic link comes back to life for an account whose owner has a password,
// which is a security regression. Onto password_hash, and a reset account can never reach the wizard,
// which is the dead end the whole feature exists to remove.
//
// So the two rules are asserted independently, over the full matrix of the two columns. The four
// cases are what make them separable: no single-column rule can produce all four answers, which is
// precisely why a collapse cannot hide here.
//
// Under the shipped behaviour the redirect returns early for every account that has a password, so
// the session this handler mints is only ever minted for an account without one. The
// password-less-but-onboarded case is therefore a state production does not reach today. It is
// tested anyway and deliberately, because it is the only case that can tell `!!user.onboardedAt`
// apart from a hardcoded false, and the spec says this site moves precisely so a later reader cannot
// collapse it. A criterion that only covered reachable states would be satisfied by the very
// regression it exists to prevent.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { verifyMagicLink } = await import('~~/server/api/magic-link/handlers/verify')

const event = { __event: true } as never

const TOKEN = '11111111-1111-4111-8111-111111111111'
const EMAIL = 'owner@example.com'
const ONBOARDED_AT = new Date('2026-03-01T12:00:00Z')
const PASSWORD_HASH = 'fake-scrypt$whatever-the-owner-chose'

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  vi.clearAllMocks()

  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()

  await seedMagicLinkToken(client, TOKEN, EMAIL)
})

describe('the instrument, before anything is concluded from a verification', () => {
  // Half the cases below conclude from a session NOT being minted. A handler that failed early for an
  // unrelated reason would satisfy every one of them, so the path that does mint one is shown working
  // first.
  it('mints a session for an invitee with no password, so an absent session means something', async () => {
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: null })

    await verifyMagicLink(event, { token: TOKEN })

    expect(recorder.sessions).toHaveLength(1)
  })

  it('burns the token, so a fixture that was never consumed would be visible', async () => {
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: null })

    await verifyMagicLink(event, { token: TOKEN })

    expect(Number((await readMagicLinkToken(client, TOKEN))?.used)).toBe(1)
  })
})

describe('AC14: the session flag reads onboarded_at', () => {
  it('mints onboarded false for an account with neither a password nor a timestamp', async () => {
    // The ordinary brand-new invitee.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: null })

    await verifyMagicLink(event, { token: TOKEN })

    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })
  })

  it('mints onboarded true for an account with a timestamp and no password', async () => {
    // The case that separates reading the column from hardcoding false. Production does not reach it
    // today, and that is the point: it is the only observation that can tell the shipped expression
    // apart from the literal a later reader would be tempted to substitute for it.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: ONBOARDED_AT, passwordHash: null })

    await verifyMagicLink(event, { token: TOKEN })

    expect(recorder.sessions).toHaveLength(1)
    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: true })
  })

  it('gives a brand-new users row it creates itself a null onboarded_at and onboarded false', async () => {
    // No users row for this address at all, so the handler inserts a bare one. The column must arrive
    // null, because an insert default would mark the account as onboarded at the moment it was
    // created, before the wizard had run.
    const freshEmail = 'never-seen-before@example.com'
    await seedMagicLinkToken(client, '22222222-2222-4222-8222-222222222222', freshEmail)

    await verifyMagicLink(event, { token: '22222222-2222-4222-8222-222222222222' })

    expect((await readUserRowByEmail(client, freshEmail))?.onboarded_at).toBeNull()
    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })
  })
})

describe('AC14: the redirect rule still reads password_hash', () => {
  it('redirects an account with a password and a null onboarded_at, minting no session', async () => {
    // The decisive case for this half. A reset account looks exactly like this, and a redirect rule
    // moved onto onboarded_at would let a magic link mint a session for it, which is the security
    // regression the spec names.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: PASSWORD_HASH })

    await verifyMagicLink(event, { token: TOKEN })

    expect(recorder.redirects).toContainEqual({ status: undefined, url: '/' })
    expect(recorder.sessions).toHaveLength(0)
  })

  it('redirects an account with a password and a set onboarded_at, minting no session', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: PASSWORD_HASH
    })

    await verifyMagicLink(event, { token: TOKEN })

    expect(recorder.redirects).toContainEqual({ status: undefined, url: '/' })
    expect(recorder.sessions).toHaveLength(0)
  })

  it('fires the redirect regardless of what onboarded_at holds', async () => {
    // Stated as one assertion over both values of the column, because "regardless" is the word the
    // criterion uses and a pair of separate cases can drift apart.
    for (const onboardedAt of [null, ONBOARDED_AT]) {
      harness = await createTaskTestDb()
      client = harness.client
      dbRef.current = harness.db
      recorder = installNitroGlobals()
      await seedMagicLinkToken(client, TOKEN, EMAIL)
      await seedUserAccount(client, OWNER_ID, { onboardedAt, passwordHash: PASSWORD_HASH })

      await verifyMagicLink(event, { token: TOKEN })

      expect(recorder.redirects.map((redirect) => redirect.url)).toEqual(['/'])
      expect(recorder.sessions).toHaveLength(0)
    }
  })

  it('still burns the token before redirecting, so a redirected link cannot be replayed', async () => {
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: PASSWORD_HASH })

    await verifyMagicLink(event, { token: TOKEN })

    expect(Number((await readMagicLinkToken(client, TOKEN))?.used)).toBe(1)
  })

  it('does not touch the account it turns away', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: PASSWORD_HASH
    })
    const before = await readUserRow(client, OWNER_ID)

    await verifyMagicLink(event, { token: TOKEN })

    expect(await readUserRow(client, OWNER_ID)).toEqual(before)
  })
})

describe('AC14: the two rules, over the full matrix of the two columns', () => {
  // Four combinations, four answers. No rule keyed on a single column can produce this table, which
  // is the whole content of "two rules, two columns" and the thing a collapse would break.
  const matrix: [string, string | null, Date | null, 'redirect' | 'session', boolean][] = [
    ['no password, no timestamp', null, null, 'session', false],
    ['no password, timestamp set', null, ONBOARDED_AT, 'session', true],
    ['password, no timestamp', PASSWORD_HASH, null, 'redirect', false],
    ['password, timestamp set', PASSWORD_HASH, ONBOARDED_AT, 'redirect', false]
  ]

  // The label is the first column, and it is the only one interpolated into the title. The other
  // columns are values rather than descriptions, and a positional %s would print a password hash into
  // the test name.
  it.each(matrix)(
    'with %s, the flag and the redirect each answer from their own column',
    async (_label, passwordHash, onboardedAt, outcome, onboarded) => {
      await seedUserAccount(client, OWNER_ID, { onboardedAt, passwordHash })

      await verifyMagicLink(event, { token: TOKEN })

      if (outcome === 'redirect') {
        expect(recorder.sessions).toHaveLength(0)
      } else {
        expect(recorder.sessions).toHaveLength(1)
        expect(recorder.sessions.at(-1)).toMatchObject({ onboarded })
      }
    }
  )

  it('names both columns in executable code rather than only in its prose', () => {
    // The behavioural matrix above is the real assertion. This is the guard beside it: the file's
    // reasoning for keeping the two apart lives in a long comment, and a collapse that deleted one
    // column from the code while leaving the comment intact would still be a collapse. Read from
    // comment-stripped source, so the prose cannot satisfy the search.
    const source = code('server/api/magic-link/handlers/verify.ts')

    expect(source).toMatch(/passwordHash/)
    expect(source).toMatch(/onboardedAt/)
  })
})

describe('a token that cannot be consumed grants nothing', () => {
  it.each([
    ['an expired token', { expiresAt: new Date(Date.now() - 60_000) }],
    ['an already-used token', { used: true }]
  ])('sends %s to sign-up with the expired flag and mints no session', async (_label, options) => {
    const deadToken = '33333333-3333-4333-8333-333333333333'
    await seedMagicLinkToken(client, deadToken, EMAIL, options)
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: null })

    await verifyMagicLink(event, { token: deadToken })

    expect(recorder.redirects).toContainEqual({ status: 302, url: '/inscription?expired=1' })
    expect(recorder.sessions).toHaveLength(0)
  })

  it('sends an unknown token to sign-up and creates no account', async () => {
    await verifyMagicLink(event, { token: '44444444-4444-4444-8444-444444444444' })

    expect(recorder.redirects).toContainEqual({ status: 302, url: '/inscription?expired=1' })
    expect(recorder.sessions).toHaveLength(0)
  })
})
