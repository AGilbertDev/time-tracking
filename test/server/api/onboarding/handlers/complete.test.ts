import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { fakeHash, installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  instrumentedDb,
  OWNER_ID,
  readSettingsRows,
  readUserRow,
  seedSettings,
  seedUserAccount
} from '../../../../helpers/taskTestDb'

// AC16 and AC17 of docs/specs/admin/onboarding-reset.md.
//
//   AC16. "server/api/onboarding/handlers/complete.ts rejects with 409 already_onboarded when
//   users.onboarded_at is non-null, and accepts when it is null, regardless of whether password_hash
//   is set. This is the criterion that proves a reset account can finish the wizard again rather than
//   hitting the guard."
//
//   AC17. "A successful onboarding completion sets users.onboarded_at to a non-null timestamp in the
//   same update that sets password_hash, and the session it writes carries onboarded: true."
//
// The guard moving is what makes the feature work at all rather than being a tidy-up. A reset clears
// the timestamp and deliberately leaves the password, so a guard still reading the hash would let the
// reset admin reach the wizard and then reject their Finish with 409, while the global middleware
// bounced them straight back to the wizard they could not leave. That is a closed loop with no exit,
// which is why the guard is asserted over both values of password_hash rather than only the one a
// happy path produces.
//
// isPasswordBreached is mocked at its own module boundary, because the real one calls the Have I Been
// Pwned range API and nothing here is testing that. Everything else runs for real against the real
// database.

const { dbRef, isBreachedMock } = vi.hoisted(() => ({
  dbRef: { current: null as unknown },
  isBreachedMock: vi.fn()
}))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))
vi.mock('~~/server/utils/checkPasswordBreached', () => ({ isPasswordBreached: isBreachedMock }))

const { completeOnboarding } = await import('~~/server/api/onboarding/handlers/complete')
const { CompleteOnboardingSchema } = await import('~~/server/models/onboarding')

const event = { __event: true } as never

const SESSION = {
  avatarUrl: null,
  email: 'owner@example.com',
  id: OWNER_ID,
  onboarded: false,
  role: 'admin'
}

const PASSWORD = 'a-brand-new-password'
const OLD_PASSWORD_HASH = fakeHash('the-password-from-before-the-reset')
const ONBOARDED_AT = new Date('2026-03-01T12:00:00Z')

// A wizard submission, put through the shipped schema so the fixture is a request the route would
// actually accept rather than a shape invented here. A body the contract would reject is not evidence
// about the handler.
function submission(overrides: Record<string, unknown> = {}) {
  const parsed = CompleteOnboardingSchema.safeParse({
    darkTheme: 'encre',
    dailyWorkMinutes: 390,
    firstName: 'Fixture',
    lastName: 'Owner',
    lightTheme: 'foret',
    locale: 'en',
    password: PASSWORD,
    timezone: 'Europe/Paris',
    workDays: [1, 2, 3, 4],
    ...overrides
  })
  if (!parsed.success) throw new Error(`fixture body is not a valid request: ${parsed.error}`)
  return parsed.data
}

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder
let statements: string[]

beforeEach(async () => {
  vi.clearAllMocks()
  isBreachedMock.mockResolvedValue(false)

  harness = await createTaskTestDb()
  client = harness.client
  statements = []
  dbRef.current = instrumentedDb(harness.db, statements)
  recorder = installNitroGlobals()
  recorder.setSession(SESSION)
})

describe('the instrument, before anything is concluded from a rejection', () => {
  // Several cases below conclude from a 409. A handler that threw 409 unconditionally would satisfy
  // all of them, so the accepting path is shown working first.
  it('accepts a submission from an account that has never onboarded', async () => {
    await expect(completeOnboarding(event, submission())).resolves.toEqual({ success: true })
  })

  it('rejects a breached password with 422, so a rejection is not always the guard', async () => {
    isBreachedMock.mockResolvedValue(true)

    await expect(completeOnboarding(event, submission())).rejects.toMatchObject({
      statusCode: 422,
      statusMessage: 'password_breached'
    })
  })
})

describe('AC16: the re-entry guard reads onboarded_at, not password_hash', () => {
  it('rejects with 409 already_onboarded when onboarded_at is set and a password exists', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: OLD_PASSWORD_HASH
    })

    await expect(completeOnboarding(event, submission())).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'already_onboarded'
    })
  })

  it('rejects with 409 when onboarded_at is set even though there is no password', async () => {
    // The guard keys on the timestamp alone. Anything still reading the hash would accept this
    // submission and overwrite a profile that is already through setup.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: ONBOARDED_AT, passwordHash: null })

    await expect(completeOnboarding(event, submission())).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'already_onboarded'
    })
  })

  it('accepts when onboarded_at is null even though a password is already set', async () => {
    // This is what a reset account looks like, and it is the case the whole feature turns on. A guard
    // still reading password_hash rejects here, the global middleware bounces the admin back to the
    // wizard, and they can neither finish nor leave.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: OLD_PASSWORD_HASH })

    await expect(completeOnboarding(event, submission())).resolves.toEqual({ success: true })
  })

  it('accepts when both columns are null, which is the ordinary first run', async () => {
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: null })

    await expect(completeOnboarding(event, submission())).resolves.toEqual({ success: true })
  })

  it('writes nothing when the guard rejects', async () => {
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: OLD_PASSWORD_HASH
    })
    const before = await readUserRow(client, OWNER_ID)

    await expect(completeOnboarding(event, submission())).rejects.toThrow()

    expect(await readUserRow(client, OWNER_ID)).toEqual(before)
    expect(await readSettingsRows(client, OWNER_ID)).toEqual([])
    expect(recorder.sessions).toHaveLength(0)
  })

  it('rejects a second submission from an account it has just onboarded', async () => {
    // Idempotency in the other direction. Completing writes the timestamp, so the guard it just armed
    // is what stops the wizard URL being reopened and re-submitted.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null, passwordHash: null })
    await completeOnboarding(event, submission())

    await expect(completeOnboarding(event, submission())).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'already_onboarded'
    })
  })
})

describe('AC17: what a successful completion writes', () => {
  beforeEach(async () => {
    // role: 'admin' on the row rather than only in the session, because the criterion below asserts
    // the handler leaves the stored role alone. The column defaults to 'user', so a row left at the
    // default would read as 'user' afterwards whether the handler had touched it or not, and the
    // assertion would be satisfied by a fixture rather than by the code.
    await seedUserAccount(client, OWNER_ID, {
      onboardedAt: null,
      passwordHash: null,
      role: 'admin'
    })
  })

  it('sets onboarded_at to a non-null timestamp at the moment of completion', async () => {
    const before = Math.floor(Date.now() / 1000)

    await completeOnboarding(event, submission())

    const onboardedAt = (await readUserRow(client, OWNER_ID))?.onboarded_at
    expect(onboardedAt).not.toBeNull()
    expect(Number(onboardedAt)).toBeGreaterThanOrEqual(before)
    expect(Number(onboardedAt)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1)
  })

  it('sets password_hash in the same statement as onboarded_at', async () => {
    // "In the same update" is the criterion's wording, and it matters: two statements would leave a
    // window in which the account holds a new password without the timestamp that says it is through
    // setup, and a crash in that window would put the account back through the wizard with a password
    // it did not have before. Asserted by counting the statements the handler issued against users.
    await completeOnboarding(event, submission())

    expect(statements.filter((entry) => entry === 'update:users')).toHaveLength(1)

    const row = await readUserRow(client, OWNER_ID)
    expect(row?.password_hash).toBe(fakeHash(PASSWORD))
    expect(row?.onboarded_at).not.toBeNull()
  })

  it('writes the submitted names alongside them', async () => {
    await completeOnboarding(event, submission({ firstName: 'Given', lastName: 'Family' }))

    const row = await readUserRow(client, OWNER_ID)
    expect(row?.first_name).toBe('Given')
    expect(row?.last_name).toBe('Family')
  })

  it('leaves the role alone, so re-running the wizard cannot demote an admin', async () => {
    await completeOnboarding(event, submission())

    expect((await readUserRow(client, OWNER_ID))?.role).toBe('admin')
  })

  it('writes a session carrying onboarded true', async () => {
    // Still a literal in the handler, and correctly so. It is a statement about the onboarded_at value
    // the same update just wrote rather than an inference from the password.
    await completeOnboarding(event, submission())

    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: true })
  })

  it('carries the submitted appearance and locale into the session and the cookie', async () => {
    await completeOnboarding(event, submission())

    expect(recorder.sessions.at(-1)).toMatchObject({
      darkTheme: 'encre',
      lightTheme: 'foret',
      locale: 'en'
    })
    expect(recorder.cookies).toContainEqual({ name: 'i18n_redirected', value: 'en' })
  })

  it('creates the settings row with every submitted work value', async () => {
    await completeOnboarding(event, submission())

    const rows = await readSettingsRows(client, OWNER_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      daily_work_minutes: 390,
      dark_theme: 'encre',
      light_theme: 'foret',
      locale: 'en',
      timezone: 'Europe/Paris',
      work_days: '[1,2,3,4]'
    })
  })

  it('updates a settings row that already exists rather than adding a second', async () => {
    // The step-1 partial state from the recovery table: the flag was cleared but the settings delete
    // never ran, so the wizard's Finish meets a stale row. It has to upsert over it.
    await seedSettings(client, OWNER_ID, 'America/Toronto')

    await completeOnboarding(event, submission())

    const rows = await readSettingsRows(client, OWNER_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.timezone).toBe('Europe/Paris')
  })
})
