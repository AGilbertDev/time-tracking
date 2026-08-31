import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../../helpers/nitroGlobals'
import { code } from '../../../../../helpers/sourceScan'
import {
  countRows,
  createTaskTestDb,
  instrumentedDb,
  OTHER_USER_ID,
  OWNER_ID,
  readAllTaskRows,
  readCategoryQuotaRows,
  readSettingsRows,
  readUserRow,
  seedCategoryQuota,
  seedSettings,
  seedTask,
  seedUserAccount
} from '../../../../../helpers/taskTestDb'

// AC6 through AC12 and AC20 through AC22 of docs/specs/admin/onboarding-reset.md.
//
// The seam is useDb, which hands back a genuine Drizzle instance over an in-memory libSQL database
// carrying the shipped DDL. Every fixture is inserted with raw SQL and every assertion reads raw SQL,
// so the handler is never also what sets up or reports on its own state. That matters more than usual
// here, because most of these criteria are about what the reset does NOT touch, and a faked query
// builder that recorded three statements would satisfy all of them while proving nothing about what
// any table ends up holding.
//
// There is no transaction anywhere in this repository, so the reset is a sequence of awaited
// statements and its safety comes entirely from the write order. That is why the partial-failure
// cases below inject a failure at a chosen statement rather than asserting a comment: the ordering is
// the guarantee, and only a run that stops halfway can show it holding.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

// defineEventHandler wraps the route at import time, so it is stubbed before the imports below and
// unwraps to the raw async function the tests call directly.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)

// The real admin wrapper, put on globalThis so the route file picks up the shipped authorization
// boundary rather than a stand-in. AC6 and AC7 are about that wrapper actually refusing, so replacing
// it with a pass-through would leave the two criteria asserting nothing.
const { defineAdminEventHandler } = await import('~~/server/utils/defineAdminEventHandler')
vi.stubGlobal('defineAdminEventHandler', defineAdminEventHandler)

const resetRoute = (await import('~~/server/api/admin/onboarding/reset.post')).default as (
  event: unknown
) => Promise<{ success: true }>

const event = { __event: true }

// A session that differs from the coded defaults in every field the reset is supposed to carry
// forward or replace, so "unchanged" and "reset to the default" are both observable. A session
// already holding the defaults would satisfy AC12 whether the handler carried anything forward or
// simply invented a fresh user object.
const ADMIN_SESSION = {
  avatarUrl: '/api/me/avatar',
  darkTheme: 'encre',
  email: 'owner@example.com',
  firstName: 'Fixture',
  id: OWNER_ID,
  lastName: 'Owner',
  lightTheme: 'foret',
  locale: 'en',
  onboarded: true,
  role: 'admin'
}

const STORED_PASSWORD_HASH = 'fake-scrypt$the-password-that-must-survive'
const ONBOARDED_AT = new Date('2026-03-01T12:00:00Z')
const CREATED_AT = new Date('2026-02-01T09:00:00Z')

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

// The account as it looks the moment before a reset: through setup, holding a password, carrying a
// settings row, three quota rows, and recorded work.
async function seedOnboardedAdminWithConfiguration(): Promise<void> {
  await seedUserAccount(client, OWNER_ID, {
    avatarUrl: '/api/me/avatar',
    createdAt: CREATED_AT,
    firstName: 'Fixture',
    lastName: 'Owner',
    onboardedAt: ONBOARDED_AT,
    passwordHash: STORED_PASSWORD_HASH,
    role: 'admin'
  })

  await seedSettings(client, OWNER_ID, 'Europe/Paris')
  await seedCategoryQuota(client, OWNER_ID, 'translation', 310)
  await seedCategoryQuota(client, OWNER_ID, 'revision', 900)
  // A quota naming a category the app no longer knows. The delete is keyed on user_id alone, so this
  // has to go with the rest rather than survive as an orphan.
  await seedCategoryQuota(client, OWNER_ID, 'category-that-no-longer-exists', 120)

  // The other user's configuration, which nothing about this feature may touch.
  await seedSettings(client, OTHER_USER_ID, 'America/Toronto')
  await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 275)
}

// Recorded work, including a task with a null quota_wph_override, which is the population the spec
// names as the one whose resolution moves when the quota rows go. Its row still may not change.
async function seedRecordedWork(): Promise<void> {
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
  await seedTask(client, {
    category: 'translation',
    date: '2026-08-22',
    id: 'task-of-another-user',
    quotaWphOverride: 200,
    userId: OTHER_USER_ID
  })
}

beforeEach(async () => {
  vi.clearAllMocks()

  harness = await createTaskTestDb()
  client = harness.client
  recorder = installNitroGlobals()
  dbRef.current = instrumentedDb(harness.db, recorder.order)

  await seedOnboardedAdminWithConfiguration()
})

describe('the instrument, before anything is concluded from a reset', () => {
  // Every criterion below concludes from rows being gone, or from rows still being there. A fixture
  // that never landed would satisfy the first kind for the wrong reason and make the second kind
  // impossible to fail, so the starting state is asserted before anything runs against it.
  it('starts from an onboarded admin holding a settings row and three quota rows', async () => {
    const row = await readUserRow(client, OWNER_ID)

    expect(row?.onboarded_at).toBe(Math.floor(ONBOARDED_AT.getTime() / 1000))
    expect(row?.password_hash).toBe(STORED_PASSWORD_HASH)
    expect(row?.role).toBe('admin')
    expect(await readSettingsRows(client, OWNER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toHaveLength(3)
  })

  it('starts with the other user holding their own configuration', async () => {
    expect(await readSettingsRows(client, OTHER_USER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OTHER_USER_ID)).toHaveLength(1)
  })
})

describe('AC6: the route is admin-gated and an unauthenticated request writes nothing', () => {
  it('is defined through defineAdminEventHandler', () => {
    // The wrapper is the real authorization boundary, and it is what makes the 401 and the 403 below
    // properties of the route rather than of something the handler happened to do. Read from the
    // comment-stripped source so the prose about the wrapper cannot satisfy the search on its own.
    expect(code('server/api/admin/onboarding/reset.post.ts')).toContain('defineAdminEventHandler')
  })

  it('refuses a request carrying no session with 401', async () => {
    recorder.setSession(null)

    await expect(resetRoute(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('writes nothing at all when the request is unauthenticated', async () => {
    recorder.setSession(null)
    const before = await readUserRow(client, OWNER_ID)

    await expect(resetRoute(event)).rejects.toThrow()

    expect(await readUserRow(client, OWNER_ID)).toEqual(before)
    expect(await readSettingsRows(client, OWNER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toHaveLength(3)
    expect(recorder.sessions).toHaveLength(0)
  })
})

describe('AC7: any role that is not exactly admin is refused with 403 and writes nothing', () => {
  // Fails closed, so a missing role and a role the wrapper has never heard of are both denied rather
  // than allowed through. A session minted before the role field shipped carries no role at all, and
  // that is the case a permissive check would let past.
  const refusedRoles: [string, string | undefined][] = [
    ['a plain user', 'user'],
    ['no role at all', undefined],
    ['a role that only looks like admin', 'Admin'],
    ['a role with surrounding whitespace', ' admin'],
    ['an unknown role', 'superuser']
  ]

  it.each(refusedRoles)('refuses %s with 403 forbidden', async (_label, role) => {
    recorder.setSession({ ...ADMIN_SESSION, role })

    await expect(resetRoute(event)).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'forbidden'
    })
  })

  it.each(refusedRoles)('writes nothing when the role is %s', async (_label, role) => {
    recorder.setSession({ ...ADMIN_SESSION, role })
    const before = await readUserRow(client, OWNER_ID)

    await expect(resetRoute(event)).rejects.toThrow()

    expect(await readUserRow(client, OWNER_ID)).toEqual(before)
    expect(await readSettingsRows(client, OWNER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toHaveLength(3)
    expect(recorder.sessions).toHaveLength(0)
  })

  it('accepts exactly admin, so the refusals above are not refusing everything', async () => {
    // The positive control for the whole block. A wrapper that threw 403 unconditionally would
    // satisfy every case above.
    recorder.setSession(ADMIN_SESSION)

    await expect(resetRoute(event)).resolves.toEqual({ success: true })
  })
})

describe('AC8: a successful reset leaves the tasks table unchanged', () => {
  beforeEach(async () => {
    await seedRecordedWork()
    recorder.setSession(ADMIN_SESSION)
  })

  it('returns the same rows from SELECT * FROM tasks afterwards', async () => {
    // Read as whole rows rather than as a count, because a count alone would pass while every row had
    // been rewritten. Every column is compared, quota_wph_override included, which is the one a
    // careless "reset the quotas" implementation would be most tempted to clear.
    const before = await readAllTaskRows(client)
    expect(before).toHaveLength(3)

    await resetRoute(event)

    expect(await readAllTaskRows(client)).toEqual(before)
  })

  it('keeps the frozen figure on a task that carries one', async () => {
    await resetRoute(event)

    const rows = await readAllTaskRows(client)
    const task = rows.find((row) => row.id === 'task-with-snapshot')

    expect(task?.quota_wph_override).toBe(310)
  })

  it('keeps a task whose quota_wph_override is null exactly as it was, null included', async () => {
    // The population the spec names as the one whose resolution moves to the shipped defaults when
    // the quota rows go. Its resolution moving is accepted; its row changing is not.
    await resetRoute(event)

    const rows = await readAllTaskRows(client)
    const task = rows.find((row) => row.id === 'task-without-snapshot')

    expect(task).toBeDefined()
    expect(task?.quota_wph_override).toBeNull()
  })

  it('never names the tasks table in any statement it issues', async () => {
    // The stronger form of the same guarantee. The rows being equal proves no net change; this proves
    // the handler did not read, write, or delete a tasks row on the way to that.
    await resetRoute(event)

    expect(recorder.order.filter((entry) => entry.endsWith(':tasks'))).toEqual([])
  })
})

describe('AC9: the acting user loses their settings row and every quota row, nobody else does', () => {
  beforeEach(() => {
    recorder.setSession(ADMIN_SESSION)
  })

  it('leaves zero settings rows for the acting user', async () => {
    await resetRoute(event)

    expect(await readSettingsRows(client, OWNER_ID)).toEqual([])
  })

  it('leaves zero category_quotas rows for the acting user', async () => {
    await resetRoute(event)

    expect(await readCategoryQuotaRows(client, OWNER_ID)).toEqual([])
  })

  it('removes a quota row naming a category the app no longer knows', async () => {
    // Keyed on user_id alone, so an unknown category id goes with the rest and no coercion is
    // involved. Asserted separately because a delete keyed on the known category list would pass
    // every other case in this block and strand this row.
    await resetRoute(event)

    const result = await client.execute({
      sql: 'SELECT COUNT(*) AS n FROM category_quotas WHERE category_id = ?',
      args: ['category-that-no-longer-exists']
    })

    expect(Number(result.rows[0]?.n)).toBe(0)
  })

  it('leaves the other user their settings row and their quota row', async () => {
    await resetRoute(event)

    expect(await readSettingsRows(client, OTHER_USER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OTHER_USER_ID)).toHaveLength(1)
    // The whole table, so nothing is left over from the acting user either.
    expect(await countRows(client, 'settings')).toBe(1)
    expect(await countRows(client, 'category_quotas')).toBe(1)
  })

  it('leaves the other user their work_schedule row, which is out of scope for the reset', async () => {
    // work_schedule is deliberately not cleared for anybody. Nothing in the application can write it
    // back, so deleting it would destroy data with no path to restore it.
    const { seedWorkSchedule } = await import('../../../../../helpers/taskTestDb')
    await seedWorkSchedule(client, OWNER_ID)

    await resetRoute(event)

    expect(await countRows(client, 'work_schedule')).toBe(1)
  })
})

describe('AC10: the users row loses onboarded_at and nothing else but updated_at', () => {
  beforeEach(() => {
    recorder.setSession(ADMIN_SESSION)
  })

  it('sets onboarded_at to null', async () => {
    await resetRoute(event)

    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).toBeNull()
  })

  it('changes exactly onboarded_at and updated_at, and no other column', async () => {
    const before = (await readUserRow(client, OWNER_ID)) as Record<string, unknown>

    await resetRoute(event)
    const after = (await readUserRow(client, OWNER_ID)) as Record<string, unknown>

    const changed = Object.keys(before).filter((key) => before[key] !== after[key])

    expect(changed.sort()).toEqual(['onboarded_at', 'updated_at'])
  })

  it.each([
    ['password_hash', STORED_PASSWORD_HASH],
    ['role', 'admin'],
    ['first_name', 'Fixture'],
    ['last_name', 'Owner'],
    ['avatar_url', '/api/me/avatar'],
    ['email', 'owner@example.com'],
    ['deactivated_at', null]
  ])('leaves %s holding exactly what it held before', async (column, expected) => {
    // Named one by one rather than only as a set difference, because the set assertion above would
    // also pass if two columns had swapped values. The password in particular is the whole safety
    // argument for this design, so it is asserted against its literal stored value.
    await resetRoute(event)

    expect((await readUserRow(client, OWNER_ID))?.[column]).toEqual(expected)
  })

  it('bumps updated_at to the moment of the reset', async () => {
    const before = Math.floor(Date.now() / 1000)

    await resetRoute(event)

    const updatedAt = Number((await readUserRow(client, OWNER_ID))?.updated_at)
    expect(updatedAt).toBeGreaterThanOrEqual(before)
    expect(updatedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1)
  })

  it('leaves the other user’s row completely untouched', async () => {
    await seedUserAccount(client, OTHER_USER_ID, {
      onboardedAt: ONBOARDED_AT,
      passwordHash: 'fake-scrypt$other-password',
      role: 'user'
    })
    const before = await readUserRow(client, OTHER_USER_ID)

    await resetRoute(event)

    expect(await readUserRow(client, OTHER_USER_ID)).toEqual(before)
  })
})

describe('AC11: the endpoint is idempotent', () => {
  beforeEach(() => {
    recorder.setSession(ADMIN_SESSION)
  })

  it('succeeds twice in a row and returns { success: true } both times', async () => {
    // Idempotency is load-bearing rather than tidy. Calling again is the documented recovery from
    // every partial failure, so a 409 here would break the recovery in exactly the state that needs
    // it.
    expect(await resetRoute(event)).toEqual({ success: true })
    expect(await resetRoute(event)).toEqual({ success: true })
  })

  it('does not reject the second call with 409 or any other status', async () => {
    await resetRoute(event)

    await expect(resetRoute(event)).resolves.toEqual({ success: true })
  })

  it('leaves the same state after the second call as after the first', async () => {
    await resetRoute(event)
    const afterFirst = await readUserRow(client, OWNER_ID)

    await resetRoute(event)

    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).toBeNull()
    expect((await readUserRow(client, OWNER_ID))?.password_hash).toBe(afterFirst?.password_hash)
    expect(await readSettingsRows(client, OWNER_ID)).toEqual([])
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toEqual([])
  })

  it('refreshes the session on the second call too, which is what makes it a recovery', async () => {
    // The step-3 partial state in the spec's recovery table is a fully reset database over a stale
    // session, and the documented fix is to press Reset again. That only works if a call which finds
    // nothing to delete still writes the session.
    await resetRoute(event)
    const afterFirst = recorder.sessions.length

    await resetRoute(event)

    expect(recorder.sessions.length).toBe(afterFirst + 1)
    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })
  })

  it('succeeds on an account that was never onboarded and has no rows to delete', async () => {
    // The state a magic-link user sits in before onboarding. The delete matches nothing and the reset
    // succeeds.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null })
    await client.execute({ sql: 'DELETE FROM settings WHERE user_id = ?', args: [OWNER_ID] })
    await client.execute({ sql: 'DELETE FROM category_quotas WHERE user_id = ?', args: [OWNER_ID] })

    await expect(resetRoute(event)).resolves.toEqual({ success: true })
  })
})

describe('AC12: the session and cookies the reset writes', () => {
  beforeEach(() => {
    recorder.setSession(ADMIN_SESSION)
  })

  it('writes exactly one session, carrying onboarded false', async () => {
    await resetRoute(event)

    expect(recorder.sessions).toHaveLength(1)
    expect(recorder.sessions[0]).toMatchObject({ onboarded: false })
  })

  it.each([
    ['id', OWNER_ID],
    ['email', 'owner@example.com'],
    ['firstName', 'Fixture'],
    ['lastName', 'Owner'],
    ['avatarUrl', '/api/me/avatar'],
    ['role', 'admin']
  ])('carries %s forward unchanged from the session that made the request', async (key, value) => {
    // The role especially. Clearing it would strip the sole admin of the very role that guards this
    // endpoint, which is a one-way door out of the admin surface.
    await resetRoute(event)

    expect(recorder.sessions[0]?.[key]).toBe(value)
  })

  it('replaces the preferences with the coded defaults, because there is no settings row left', async () => {
    const { DEFAULT_LOCALE, DEFAULT_THEME_ID } = await import('#shared/theme')

    await resetRoute(event)

    // The session went in holding foret, encre, and en. It comes out holding the defaults, which is
    // the visible consequence the confirmation copy names.
    expect(recorder.sessions[0]).toMatchObject({
      darkTheme: DEFAULT_THEME_ID,
      lightTheme: DEFAULT_THEME_ID,
      locale: DEFAULT_LOCALE
    })
  })

  it('mirrors the default locale into the cookie the no-flash guard reads', async () => {
    const { DEFAULT_LOCALE } = await import('#shared/theme')

    await resetRoute(event)

    expect(recorder.cookies).toContainEqual({ name: 'i18n_redirected', value: DEFAULT_LOCALE })
  })

  it('reads the preferences after the deletes rather than before them', async () => {
    // If the read happened first it would find the row that is about to go and hand the session the
    // old theme and the old language, so the interface would keep showing preferences the database no
    // longer holds. Asserted through the outcome: a French default over a stored locale of en can
    // only come from a read taken after the delete.
    await resetRoute(event)

    expect(recorder.sessions[0]?.locale).toBe('fr')
  })
})

describe('AC20: the settings delete fails and the reset stops there', () => {
  beforeEach(() => {
    recorder.setSession(ADMIN_SESSION)
    dbRef.current = instrumentedDb(harness.db, recorder.order, 'settings')
  })

  it('rejects rather than reporting success', async () => {
    await expect(resetRoute(event)).rejects.toThrow(/forced failure/)
  })

  it('has already cleared onboarded_at', async () => {
    // This is the criterion that proves the ordering. The reverse order would leave a refreshed
    // session over a database that still said onboarded, which is the trap AC22 names.
    await expect(resetRoute(event)).rejects.toThrow()

    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).toBeNull()
  })

  it('leaves the settings row and the quota rows in place', async () => {
    await expect(resetRoute(event)).rejects.toThrow()

    expect(await readSettingsRows(client, OWNER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toHaveLength(3)
  })

  it('does not refresh the session', async () => {
    await expect(resetRoute(event)).rejects.toThrow()

    expect(recorder.sessions).toHaveLength(0)
    expect(recorder.cookies).toHaveLength(0)
  })

  it('completes the reset when the endpoint is called again', async () => {
    await expect(resetRoute(event)).rejects.toThrow()

    // The documented recovery: press Reset again. The database is healthy on the second attempt,
    // which is what a transient failure looks like.
    dbRef.current = instrumentedDb(harness.db, recorder.order)
    await expect(resetRoute(event)).resolves.toEqual({ success: true })

    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).toBeNull()
    expect(await readSettingsRows(client, OWNER_ID)).toEqual([])
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toEqual([])
    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })
  })
})

describe('AC21: the quota delete fails and the settings row is already gone', () => {
  beforeEach(() => {
    recorder.setSession(ADMIN_SESSION)
    dbRef.current = instrumentedDb(harness.db, recorder.order, 'category_quotas')
  })

  it('has cleared onboarded_at and removed the settings row', async () => {
    await expect(resetRoute(event)).rejects.toThrow(/forced failure/)

    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).toBeNull()
    expect(await readSettingsRows(client, OWNER_ID)).toEqual([])
  })

  it('leaves the quota rows in place', async () => {
    // Settings before quotas is the tiebreak, and this is what it buys. The wizard rewrites the
    // settings row on Finish; nothing rewrites the quota rows, so the harder loss is the one left
    // intact for one more attempt.
    await expect(resetRoute(event)).rejects.toThrow()

    expect(await readCategoryQuotaRows(client, OWNER_ID)).toHaveLength(3)
  })

  it('does not refresh the session', async () => {
    await expect(resetRoute(event)).rejects.toThrow()

    expect(recorder.sessions).toHaveLength(0)
  })

  it('removes the quota rows when the endpoint is called again', async () => {
    await expect(resetRoute(event)).rejects.toThrow()

    dbRef.current = instrumentedDb(harness.db, recorder.order)
    await expect(resetRoute(event)).resolves.toEqual({ success: true })

    expect(await readCategoryQuotaRows(client, OWNER_ID)).toEqual([])
    expect(recorder.sessions.at(-1)).toMatchObject({ onboarded: false })
  })
})

describe('AC22: the trap state is unreachable by construction', () => {
  // The trap is a session carrying onboarded: false over a row whose onboarded_at is still set. The
  // global middleware forces that user onto the wizard and the wizard's re-entry guard reads the
  // still-set column and rejects Finish with 409, so they can neither finish nor leave.
  //
  // The construction that makes it unreachable is the ordering: the flag clear is the first statement
  // and the session write is the last. So the property is asserted twice over, once as the ordering
  // itself and once as the invariant holding at every point a run can stop.

  it('clears the flag before it writes anything else, and writes the session last', async () => {
    recorder.setSession(ADMIN_SESSION)

    await resetRoute(event)

    expect(recorder.order).toEqual([
      'update:users',
      'delete:settings',
      'delete:category_quotas',
      'setUserSession',
      'setCookie:i18n_redirected'
    ])
  })

  it('holds the invariant at every point a run can stop', async () => {
    // Each failure point in turn, including no failure at all. In every outcome the pair
    // (session says not onboarded, row still says onboarded) must never both be true.
    const failurePoints: (undefined | 'category_quotas' | 'settings' | 'users')[] = [
      'users',
      'settings',
      'category_quotas',
      undefined
    ]

    expect.assertions(failurePoints.length * 2)

    for (const failOn of failurePoints) {
      harness = await createTaskTestDb()
      client = harness.client
      recorder = installNitroGlobals()
      recorder.setSession(ADMIN_SESSION)
      dbRef.current = instrumentedDb(harness.db, recorder.order, failOn)
      await seedOnboardedAdminWithConfiguration()

      await resetRoute(event).catch(() => undefined)

      const row = await readUserRow(client, OWNER_ID)
      const sessionSaysNotOnboarded = recorder.sessions.some(
        (session) => session.onboarded === false
      )
      const rowStillSaysOnboarded = row?.onboarded_at !== null

      expect(
        sessionSaysNotOnboarded && rowStillSaysOnboarded,
        `trap state reached with the failure injected at ${failOn ?? 'nothing'}`
      ).toBe(false)

      // The other half, so the invariant is not satisfied by a run that simply did nothing. Whenever
      // a session was written at all, the row must already be clear.
      expect(
        !sessionSaysNotOnboarded || !rowStillSaysOnboarded,
        `a session was written over a row still saying onboarded at ${failOn ?? 'nothing'}`
      ).toBe(true)
    }
  })

  it('never writes a session before the flag clear has succeeded', async () => {
    // The ordering read straight off the log rather than inferred from the outcome. A session index
    // lower than the users update index is the trap being built, whatever the final row happens to
    // say.
    recorder.setSession(ADMIN_SESSION)

    await resetRoute(event)

    const flagClear = recorder.order.indexOf('update:users')
    const sessionWrite = recorder.order.indexOf('setUserSession')

    expect(flagClear).toBeGreaterThanOrEqual(0)
    expect(sessionWrite).toBeGreaterThan(flagClear)
  })

  it('writes no session at all when the flag clear itself fails', async () => {
    recorder.setSession(ADMIN_SESSION)
    dbRef.current = instrumentedDb(harness.db, recorder.order, 'users')

    await expect(resetRoute(event)).rejects.toThrow(/forced failure/)

    expect(recorder.sessions).toHaveLength(0)
    // Nothing else ran either, so the account is exactly as it was and pressing Reset again is a
    // fresh first attempt.
    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).not.toBeNull()
    expect(await readSettingsRows(client, OWNER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toHaveLength(3)
  })
})

describe('AC26.1: with the switch off the endpoint refuses and writes nothing', () => {
  // The switch exists because the owner has said this feature's life is finite, so turning it off
  // must not be a code change. The refusal is deliberately the same 403 'forbidden' the wrapper
  // throws for a non-admin: from outside, a feature that is switched off and a caller who may not use
  // it are the same answer, and a distinct code would tell a prober that the route exists and is
  // merely disabled.
  //
  // The stub holds the STRING 'false' rather than a boolean, because isOnboardingResetEnabled parses
  // 'true' and 'false' out of the runtime config and falls back to import.meta.dev for anything else.
  // Handing it a boolean would bypass the parse this is supposed to be exercising.
  const switchedOff = { onboardingResetEnabled: 'false' }

  beforeEach(() => {
    recorder.setSession(ADMIN_SESSION)
  })

  it('refuses an admin with 403 forbidden', async () => {
    recorder.setRuntimeConfig(switchedOff)

    await expect(resetRoute(event)).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'forbidden'
    })
  })

  it('is indistinguishable from the refusal a non-admin gets', async () => {
    // The criterion's own wording: the two refusals cannot be told apart from the response. Captured
    // as whole objects and compared, rather than each asserted separately against the same literals,
    // because two assertions that happen to name the same values would still pass if one response
    // carried an extra field the other did not.
    recorder.setRuntimeConfig(switchedOff)
    const flagOff = await resetRoute(event).catch((error) => error)

    recorder.setRuntimeConfig({ onboardingResetEnabled: 'true' })
    recorder.setSession({ ...ADMIN_SESSION, role: 'user' })
    const notAdmin = await resetRoute(event).catch((error) => error)

    expect({
      message: flagOff.message,
      statusCode: flagOff.statusCode,
      statusMessage: flagOff.statusMessage
    }).toEqual({
      message: notAdmin.message,
      statusCode: notAdmin.statusCode,
      statusMessage: notAdmin.statusMessage
    })
  })

  it('leaves onboarded_at, the settings row and the quota rows exactly as they were', async () => {
    // Read back with raw SQL rather than concluding from the throw. A handler that refused after
    // clearing the flag would satisfy the status assertions above and still have destroyed something.
    const before = await readUserRow(client, OWNER_ID)

    recorder.setRuntimeConfig(switchedOff)
    await expect(resetRoute(event)).rejects.toThrow()

    expect(await readUserRow(client, OWNER_ID)).toEqual(before)
    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).not.toBeNull()
    expect(await readSettingsRows(client, OWNER_ID)).toHaveLength(1)
    expect(await readCategoryQuotaRows(client, OWNER_ID)).toHaveLength(3)
  })

  it('issues no statement at all and writes no session', async () => {
    // The check is the first thing in the handler, before requireUserSession and before any read or
    // write, so an off switch costs a refused caller nothing and touches no connection.
    recorder.setRuntimeConfig(switchedOff)

    await expect(resetRoute(event)).rejects.toThrow()

    expect(recorder.order).toEqual([])
    expect(recorder.sessions).toHaveLength(0)
    expect(recorder.cookies).toHaveLength(0)
  })

  it('succeeds again once the switch is turned back on', async () => {
    // Proving the stub flips in BOTH directions within one test. A setter that silently ignored the
    // value would make every off-case above pass while exercising the on path, which is the exact
    // shape of an instrument that reports a confident false negative.
    recorder.setRuntimeConfig(switchedOff)
    await expect(resetRoute(event)).rejects.toMatchObject({ statusCode: 403 })

    recorder.setRuntimeConfig({ onboardingResetEnabled: 'true' })
    await expect(resetRoute(event)).resolves.toEqual({ success: true })

    expect((await readUserRow(client, OWNER_ID))?.onboarded_at).toBeNull()
  })

  it.each([
    ['an unparseable value', 'yes'],
    ['an empty string', ''],
    ['a stray typo', 'ture']
  ])('treats %s as unset and refuses, because a test run is not dev', async (_label, value) => {
    // isOnboardingResetEnabled falls back to import.meta.dev for anything that is not exactly 'true'
    // or 'false'. Under vitest that is not a Nuxt dev server, so the fallback is falsy and the feature
    // is closed. That is the fail-closed half of the switch: a production build can never silently
    // leave a destructive action open because somebody mistyped an environment variable.
    recorder.setRuntimeConfig({ onboardingResetEnabled: value })

    await expect(resetRoute(event)).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'forbidden'
    })
  })
})
