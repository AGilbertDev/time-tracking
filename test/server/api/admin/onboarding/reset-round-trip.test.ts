import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { fakeHash, installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  OWNER_ID,
  readAllTaskRows,
  readCategoryQuotaRows,
  readSettingsRows,
  readUserRow,
  seedCategoryQuota,
  seedSettings,
  seedTask,
  seedUserAccount
} from '../../../../helpers/taskTestDb'

// AC18 and AC19 of docs/specs/admin/onboarding-reset.md, the two criteria that are only meaningful
// end to end.
//
//   AC18. "The full round trip works. Starting from an onboarded account with a password, a settings
//   row, quota rows, and tasks, calling the reset and then submitting the wizard succeeds, recreates
//   the settings row with the submitted values, sets a fresh onboarded_at, and leaves the tasks
//   untouched."
//
//   AC19. "The password still works for sign-in after a reset. Calling the reset and then calling
//   POST /api/auth/login with the password that worked before the reset returns success. The reset
//   never writes password_hash, so the stored hash is byte-for-byte identical before and after,
//   verified by a raw SELECT."
//
// Three handlers over one database, which is the only way to observe either. The reset's guarantee is
// that an admin who has reset themselves can still get back in and can still finish the wizard, and
// neither half is visible from inside any one handler. AC19 in particular is the safety argument for
// the whole design: the obvious short version of this feature clears password_hash, and what makes
// that wrong is that the admin then has no way back in. A test that only checked the reset's own
// return value would be blind to it.
//
// The session the reset writes becomes the session the next call sees, the way it does in a browser,
// so the sequences below are the real ones rather than three independent calls with hand-built
// sessions between them.

const { dbRef, isBreachedMock } = vi.hoisted(() => ({
  dbRef: { current: null as unknown },
  isBreachedMock: vi.fn()
}))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))
vi.mock('~~/server/utils/checkPasswordBreached', () => ({ isPasswordBreached: isBreachedMock }))

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
const { defineAdminEventHandler } = await import('~~/server/utils/defineAdminEventHandler')
vi.stubGlobal('defineAdminEventHandler', defineAdminEventHandler)

const resetRoute = (await import('~~/server/api/admin/onboarding/reset.post')).default as (
  event: unknown
) => Promise<{ success: true }>
const { completeOnboarding } = await import('~~/server/api/onboarding/handlers/complete')
const { loginWithPassword } = await import('~~/server/api/auth/handlers/login')
const { CompleteOnboardingSchema } = await import('~~/server/models/onboarding')

const event = { __event: true } as never

const EMAIL = 'owner@example.com'
const ORIGINAL_PASSWORD = 'the-password-the-owner-already-had'
const ORIGINAL_HASH = fakeHash(ORIGINAL_PASSWORD)
const ONBOARDED_AT = new Date('2026-03-01T12:00:00Z')

const ADMIN_SESSION = {
  avatarUrl: '/api/me/avatar',
  darkTheme: 'encre',
  email: EMAIL,
  firstName: 'Fixture',
  id: OWNER_ID,
  lastName: 'Owner',
  lightTheme: 'foret',
  locale: 'en',
  onboarded: true,
  role: 'admin'
}

function submission(overrides: Record<string, unknown> = {}) {
  const parsed = CompleteOnboardingSchema.safeParse({
    darkTheme: 'cafe',
    dailyWorkMinutes: 420,
    firstName: 'Fixture',
    lastName: 'Owner',
    lightTheme: 'automne',
    locale: 'fr',
    password: ORIGINAL_PASSWORD,
    timezone: 'America/Toronto',
    workDays: [1, 2, 3, 4, 5],
    ...overrides
  })
  if (!parsed.success) throw new Error(`fixture body is not a valid request: ${parsed.error}`)
  return parsed.data
}

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  vi.clearAllMocks()
  isBreachedMock.mockResolvedValue(false)

  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession(ADMIN_SESSION)

  // An account fully through setup, with a password, configuration, and recorded work.
  await seedUserAccount(client, OWNER_ID, {
    avatarUrl: '/api/me/avatar',
    createdAt: new Date('2026-02-01T09:00:00Z'),
    firstName: 'Fixture',
    lastName: 'Owner',
    onboardedAt: ONBOARDED_AT,
    passwordHash: ORIGINAL_HASH,
    role: 'admin'
  })
  await seedSettings(client, OWNER_ID, 'Europe/Paris')
  await seedCategoryQuota(client, OWNER_ID, 'translation', 310)
  await seedCategoryQuota(client, OWNER_ID, 'revision', 900)
  await seedTask(client, {
    category: 'translation',
    date: '2026-08-20',
    id: 'task-with-snapshot',
    projectWordCount: 4000,
    quotaWphOverride: 310,
    userId: OWNER_ID
  })
  await seedTask(client, {
    category: 'revision',
    date: '2026-08-21',
    id: 'task-without-snapshot',
    projectWordCount: 1200,
    quotaWphOverride: null,
    userId: OWNER_ID
  })
})

describe('AC18: reset then finish the wizard again', () => {
  it('accepts the wizard submission after a reset', async () => {
    await resetRoute(event)

    await expect(completeOnboarding(event, submission())).resolves.toEqual({ success: true })
  })

  it('recreates the settings row with the submitted values', async () => {
    await resetRoute(event)
    expect(await readSettingsRows(client, OWNER_ID)).toEqual([])

    await completeOnboarding(event, submission())

    const rows = await readSettingsRows(client, OWNER_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      daily_work_minutes: 420,
      dark_theme: 'cafe',
      light_theme: 'automne',
      locale: 'fr',
      timezone: 'America/Toronto',
      work_days: '[1,2,3,4,5]'
    })
  })

  it('sets a fresh onboarded_at rather than the one the account had before', async () => {
    const before = (await readUserRow(client, OWNER_ID))?.onboarded_at

    await resetRoute(event)
    await completeOnboarding(event, submission())

    const after = (await readUserRow(client, OWNER_ID))?.onboarded_at
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
    expect(Number(after)).toBeGreaterThan(Number(before))
  })

  it('leaves the tasks untouched across the whole round trip', async () => {
    const before = await readAllTaskRows(client)
    expect(before).toHaveLength(2)

    await resetRoute(event)
    await completeOnboarding(event, submission())

    expect(await readAllTaskRows(client)).toEqual(before)
  })

  it('leaves the quota rows gone, because the wizard does not collect quotas', async () => {
    // Stated because it will surprise otherwise. The wizard rewrites the settings row on Finish and
    // nothing rewrites the quota rows, so the user retypes any custom figures on the settings page and
    // the shipped defaults apply until they do.
    await resetRoute(event)
    await completeOnboarding(event, submission())

    expect(await readCategoryQuotaRows(client, OWNER_ID)).toEqual([])
  })

  it('ends with a session carrying onboarded true, so the wizard is behind them', async () => {
    await resetRoute(event)
    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })

    await completeOnboarding(event, submission())

    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: true })
  })

  it('keeps the role through the whole round trip, so the admin can reset again', async () => {
    await resetRoute(event)
    await completeOnboarding(event, submission())

    expect((await readUserRow(client, OWNER_ID))?.role).toBe('admin')
    await expect(resetRoute(event)).resolves.toEqual({ success: true })
  })
})

describe('AC19: the password still works for sign-in after a reset', () => {
  it('leaves the stored hash byte-for-byte identical', async () => {
    // Read with raw SQL on both sides. This is the assertion the whole design exists to make true:
    // clearing password_hash instead would delete the account's ability to authenticate, and the
    // magic-link path would not necessarily reach them, so a sole admin could land outside every
    // route back in.
    const before = (await readUserRow(client, OWNER_ID))?.password_hash
    expect(before).toBe(ORIGINAL_HASH)

    await resetRoute(event)

    expect((await readUserRow(client, OWNER_ID))?.password_hash).toBe(before)
  })

  it('signs in with the password that worked before the reset', async () => {
    await resetRoute(event)

    await expect(
      loginWithPassword(event, { email: EMAIL, password: ORIGINAL_PASSWORD })
    ).resolves.toEqual({ success: true })
  })

  it('routes that sign-in to the wizard by minting onboarded false', async () => {
    // The recovery the feature depends on: abandon the reset, come back later on another device, sign
    // in with the same password, and be put in front of the wizard rather than a dashboard with no
    // settings.
    await resetRoute(event)
    await loginWithPassword(event, { email: EMAIL, password: ORIGINAL_PASSWORD })

    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })
  })

  it('still refuses a wrong password after a reset, so the credential check is intact', async () => {
    await resetRoute(event)

    await expect(
      loginWithPassword(event, { email: EMAIL, password: 'not-the-password' })
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('survives two resets in a row with the same hash', async () => {
    const before = (await readUserRow(client, OWNER_ID))?.password_hash

    await resetRoute(event)
    await resetRoute(event)

    expect((await readUserRow(client, OWNER_ID))?.password_hash).toBe(before)
    await expect(
      loginWithPassword(event, { email: EMAIL, password: ORIGINAL_PASSWORD })
    ).resolves.toEqual({ success: true })
  })

  it('signs in with the same password after the wizard is finished with it again', async () => {
    // The wizard asks for a password on re-entry and the user is told to expect the question. Typing
    // the same one is a perfectly good answer, and it has to leave them able to sign in.
    await resetRoute(event)
    await completeOnboarding(event, submission())

    await expect(
      loginWithPassword(event, { email: EMAIL, password: ORIGINAL_PASSWORD })
    ).resolves.toEqual({ success: true })
    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: true })
  })

  it('takes a new password when the wizard is finished with a different one', async () => {
    await resetRoute(event)
    await completeOnboarding(event, submission({ password: 'a-different-password-entirely' }))

    await expect(
      loginWithPassword(event, { email: EMAIL, password: 'a-different-password-entirely' })
    ).resolves.toEqual({ success: true })
    // Only pressing Finish changes the password. An abandoned reset leaves the old one working, which
    // is asserted above; this is the other side of that.
    await expect(
      loginWithPassword(event, { email: EMAIL, password: ORIGINAL_PASSWORD })
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
