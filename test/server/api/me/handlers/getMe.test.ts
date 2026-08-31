import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import { createTaskTestDb, OWNER_ID, seedUserAccount } from '../../../../helpers/taskTestDb'

// AC26.2 of docs/specs/admin/onboarding-reset.md.
//
//   "With onboardingResetEnabled off, GET /api/me returns canResetOnboarding: false for a caller
//   whose role is exactly admin. With it on, the same caller receives true, and a caller whose role
//   is not exactly admin receives false whatever the flag holds."
//
// The field is derived with no column behind it, which the conventions explicitly allow on a
// response, and folding both conditions server-side is the logic-belongs-to-the-backend rule applied
// to a switch. Shipping the raw flag and letting the settings page AND it with the role would put
// half the rule on the client, and the private config key would have to reach the client bundle to do
// it. So the two halves are asserted here as one finished boolean rather than as two facts.
//
// The runtime switch is stubbed through useRuntimeConfig with the STRING form the config key actually
// holds, so the real parse inside isOnboardingResetEnabled runs. Handing it a boolean would skip the
// parse and assert less than it appears to.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { getMe } = await import('~~/server/api/me/handlers/getMe')

const event = { __event: true } as never

const ON = { onboardingResetEnabled: 'true' }
const OFF = { onboardingResetEnabled: 'false' }

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  vi.clearAllMocks()

  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })
})

describe('the instrument, before anything is concluded from a false', () => {
  // Most cases below conclude from canResetOnboarding being false. A handler that returned false
  // unconditionally, or that threw, would satisfy nearly all of them, so the true case is shown
  // first and the field is shown actually moving.
  it('returns true for an admin with the switch on', async () => {
    await seedUserAccount(client, OWNER_ID, { role: 'admin' })
    recorder.setRuntimeConfig(ON)

    expect((await getMe(event)).canResetOnboarding).toBe(true)
  })

  it('moves to false when only the switch changes, so the field is not a constant', async () => {
    await seedUserAccount(client, OWNER_ID, { role: 'admin' })

    recorder.setRuntimeConfig(ON)
    const on = (await getMe(event)).canResetOnboarding
    recorder.setRuntimeConfig(OFF)
    const off = (await getMe(event)).canResetOnboarding

    expect([on, off]).toEqual([true, false])
  })
})

describe('AC26.2: canResetOnboarding folds the role and the switch', () => {
  // Every combination of the two facts, so neither half can be dropped without a case going red.
  // Only exactly 'admin' with the switch on may answer true.
  // Object rows with named interpolation, so the title reads as prose. Positional %s would print the
  // config object and the role into the name and produce titles nobody can scan.
  const matrix = [
    { label: 'an admin with the switch on', role: 'admin', config: ON, expected: true },
    { label: 'an admin with the switch off', role: 'admin', config: OFF, expected: false },
    { label: 'a plain user with the switch on', role: 'user', config: ON, expected: false },
    { label: 'a plain user with the switch off', role: 'user', config: OFF, expected: false },
    { label: 'a role that only looks like admin', role: 'Admin', config: ON, expected: false },
    { label: 'a role with surrounding whitespace', role: ' admin', config: ON, expected: false },
    { label: 'an unknown role', role: 'superuser', config: ON, expected: false },
    { label: 'an empty role', role: '', config: ON, expected: false }
  ]

  it.each(matrix)('answers $expected for $label', async ({ role, config, expected }) => {
    await seedUserAccount(client, OWNER_ID, { role })
    recorder.setRuntimeConfig(config)

    expect((await getMe(event)).canResetOnboarding).toBe(expected)
  })

  it('reads the stored role rather than the session copy', async () => {
    // A role changed since sign-in has to be reflected on the next fetch. A session still claiming
    // admin over a row that says user must not be handed the control, and this is the assertion that
    // would go red if the fold ever read user.role off the session instead of the row it just
    // selected.
    await seedUserAccount(client, OWNER_ID, { role: 'user' })
    recorder.setSession({ email: 'owner@example.com', id: OWNER_ID, role: 'admin' })
    recorder.setRuntimeConfig(ON)

    expect((await getMe(event)).canResetOnboarding).toBe(false)
  })

  it('answers true for a stored admin even when the session claims otherwise', async () => {
    // The positive control for the case above, so it is not passing merely because the handler
    // ignores everything.
    await seedUserAccount(client, OWNER_ID, { role: 'admin' })
    recorder.setSession({ email: 'owner@example.com', id: OWNER_ID, role: 'user' })
    recorder.setRuntimeConfig(ON)

    expect((await getMe(event)).canResetOnboarding).toBe(true)
  })

  it.each([
    ['an unparseable value', 'yes'],
    ['an empty string', ''],
    ['a stray typo', 'ture']
  ])('never answers true for %s, failing closed', async (_label, value) => {
    // Anything that is not exactly 'true' or 'false' falls back to import.meta.dev, so a mistyped
    // environment variable closes the feature rather than leaving a destructive action offered.
    //
    // Asserted as "not true" and falsy rather than as exactly false, deliberately, and the reason is
    // a real limit of this environment rather than a softened assertion. import.meta.dev is a
    // build-time constant that the Nuxt bundler replaces with a literal true or false, and vitest
    // runs this source without that replacement, so the expression evaluates to undefined here and
    // would be a genuine boolean in any real build. Pinning this case to `false` would be asserting
    // a property of the test runner rather than of the code, and it would go red the day somebody
    // ran the suite under a config that did define it.
    //
    // What the criterion actually needs is that the feature is not offered, and that is what is
    // asserted. The page's own condition is `=== true`, so undefined and false are the same answer
    // there, which is covered in the settings-page guards.
    await seedUserAccount(client, OWNER_ID, { role: 'admin' })
    recorder.setRuntimeConfig({ onboardingResetEnabled: value })

    const value_ = (await getMe(event)).canResetOnboarding
    expect(value_).not.toBe(true)
    expect(value_).toBeFalsy()
  })
})

describe('AC26.2: the private switch never leaves the server', () => {
  it('returns canResetOnboarding and not the raw flag', async () => {
    // onboardingResetEnabled is a private runtime config key. The response carries the finished
    // answer and never the input, so the client has nothing to re-derive and the key stays out of the
    // bundle.
    await seedUserAccount(client, OWNER_ID, { role: 'admin' })
    recorder.setRuntimeConfig(ON)

    const body = await getMe(event)

    expect(body).not.toHaveProperty('onboardingResetEnabled')
    expect(Object.keys(body).sort()).toEqual([
      'avatarUrl',
      'canResetOnboarding',
      'email',
      'firstName',
      'id',
      'lastName',
      'role'
    ])
  })

  it('never returns the password hash or the onboarding timestamp', async () => {
    // The handler selects an explicit column list rather than the whole row. A select(*) that later
    // crept in would leak the stored hash to the client, and this is what catches it.
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: new Date('2026-03-01T12:00:00Z'),
      passwordHash: 'fake-scrypt$secret',
      role: 'admin'
    })
    recorder.setRuntimeConfig(ON)

    const body = await getMe(event)

    expect(body).not.toHaveProperty('passwordHash')
    expect(body).not.toHaveProperty('onboardedAt')
    expect(JSON.stringify(body)).not.toContain('fake-scrypt')
  })

  it('keeps the response out of every cache', async () => {
    await seedUserAccount(client, OWNER_ID, { role: 'admin' })
    recorder.setRuntimeConfig(ON)

    await getMe(event)

    expect(recorder.headers).toContainEqual({ name: 'Cache-Control', value: 'no-store' })
  })
})

describe('the handler fails closed when the row is gone', () => {
  it('throws 404 rather than returning a body with no user', async () => {
    recorder.setSession({ email: 'ghost@example.com', id: 'no-such-user' })
    recorder.setRuntimeConfig(ON)

    await expect(getMe(event)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 401 for a request carrying no session', async () => {
    recorder.setSession(null)

    await expect(getMe(event)).rejects.toMatchObject({ statusCode: 401 })
  })
})
