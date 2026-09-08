import type { Client } from '@libsql/client'

import { loadWorkSettings } from '~~/server/utils/loadWorkSettings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedSettings
} from '../../../../helpers/taskTestDb'

// getWorkSettings, the handler behind GET /api/me/work-settings.
//
// Derived from docs/specs/settings/settings-page.md:
//
//   "GET /api/me/work-settings returns the current user's dailyWorkMinutes, workDays, [...] and
//   timezone from the settings row, or the column defaults when no row exists."
//
//   "Every API route below is defined through the existing defineAuthenticatedEventHandler wrapper,
//   so an unauthenticated request is rejected with 401 before the handler runs. Every write is
//   scoped to the session user.id, never an id from the request body, so a user can only ever read
//   or change their own settings."
//
//   "No settings row yet. The GET returns coded defaults" and "A user with no settings row sees the
//   coded defaults (7 h 30 min, Mon–Fri, [...] America/Toronto)."
//
// THIS HANDLER IS TWO LINES AND BOTH OF THEM ARE AN AUTHORISATION DECISION, so the cases below run
// against two seeded accounts whose work settings share no value. A read scoped to the wrong account
// then produces visibly different figures rather than the same ones.
//
// The seam is useDb. loadWorkSettings is Nuxt-auto-imported by the handler and is put on the global
// as the REAL implementation reading through the mocked useDb, the same way
// saveWorkSettings.test.ts does it, so the fallback and the work_days coercion run for real. A
// stubbed loader would decide the answer these cases are asking for.
//
// The quota is deliberately absent from the response. The single global quota_wph column the spec
// text above still mentions retired in migration 0011, and the per-category figures are a different
// endpoint, which is why nothing here asserts one.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { getWorkSettings } = await import('~~/server/api/me/handlers/getWorkSettings')

const event = { __event: true } as never

// The other account's id in every place a handler could reach for one. The spec says the read is
// scoped to the session user "never an id from the request", so this event must answer identically
// to the bare one.
const SMUGGLED = {
  context: { params: { id: OTHER_USER_ID, userId: OTHER_USER_ID } },
  node: { req: { url: `/api/me/work-settings?userId=${OTHER_USER_ID}` } },
  path: `/api/me/work-settings?userId=${OTHER_USER_ID}`
} as never

// The coded defaults the spec names for an account with no settings row: 7 h 30 min is 450 minutes,
// Mon–Fri is [1,2,3,4,5], and the owner's zone is America/Toronto.
const CODED_DEFAULTS = {
  dailyWorkMinutes: 450,
  timezone: 'America/Toronto',
  workDays: [1, 2, 3, 4, 5]
}

// Neither account shares a figure with the other, so no assertion can pass by reading the wrong row.
const OWNER_SETTINGS = {
  dailyWorkMinutes: 500,
  timezone: 'Europe/Paris',
  workDays: [1, 2, 3]
}
const OTHER_SETTINGS = {
  dailyWorkMinutes: 300,
  timezone: 'Asia/Tokyo',
  workDays: [0, 6]
}

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })

  vi.stubGlobal('loadWorkSettings', loadWorkSettings)
})

describe('getWorkSettings', () => {
  describe('it returns the session user own persisted work settings', () => {
    it('returns the stored daily target, work days and timezone', async () => {
      await seedSettings(client, OWNER_ID, OWNER_SETTINGS.timezone, {
        dailyWorkMinutes: OWNER_SETTINGS.dailyWorkMinutes,
        workDays: OWNER_SETTINGS.workDays
      })

      await expect(getWorkSettings(event)).resolves.toEqual(OWNER_SETTINGS)
    })

    // The spec's "No settings row yet": every account starts in this state, so it is the first read
    // rather than an exotic one.
    it('returns the coded defaults when the account has no settings row yet', async () => {
      await expect(getWorkSettings(event)).resolves.toEqual(CODED_DEFAULTS)
    })

    // The spec requires work_days to reach the client as a clean number array, never as the stored
    // JSON text, so the caller is handed a resolved value rather than a column.
    it('hands back work days as a number array rather than the stored JSON text', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', { workDays: [2, 4] })

      const settings = await getWorkSettings(event)

      expect(Array.isArray(settings.workDays)).toBe(true)
      expect(settings.workDays).toEqual([2, 4])
    })
  })

  describe('the read is scoped to the session user and to no other account', () => {
    it('returns the session user settings while another account holds different ones', async () => {
      await seedSettings(client, OWNER_ID, OWNER_SETTINGS.timezone, {
        dailyWorkMinutes: OWNER_SETTINGS.dailyWorkMinutes,
        workDays: OWNER_SETTINGS.workDays
      })
      await seedSettings(client, OTHER_USER_ID, OTHER_SETTINGS.timezone, {
        dailyWorkMinutes: OTHER_SETTINGS.dailyWorkMinutes,
        workDays: OTHER_SETTINGS.workDays
      })

      // Both halves in one case: the absence alone would be satisfied by a handler that answered
      // with the coded defaults and read nothing at all.
      await expect(getWorkSettings(event)).resolves.toEqual(OWNER_SETTINGS)
      await expect(getWorkSettings(event)).resolves.not.toMatchObject(OTHER_SETTINGS)
    })

    it('does not fall through to another account row when the session user has none', async () => {
      await seedSettings(client, OTHER_USER_ID, OTHER_SETTINGS.timezone, {
        dailyWorkMinutes: OTHER_SETTINGS.dailyWorkMinutes,
        workDays: OTHER_SETTINGS.workDays
      })

      await expect(getWorkSettings(event)).resolves.toEqual(CODED_DEFAULTS)
    })

    it('ignores another account id smuggled into the request', async () => {
      await seedSettings(client, OWNER_ID, OWNER_SETTINGS.timezone, {
        dailyWorkMinutes: OWNER_SETTINGS.dailyWorkMinutes,
        workDays: OWNER_SETTINGS.workDays
      })
      await seedSettings(client, OTHER_USER_ID, OTHER_SETTINGS.timezone, {
        dailyWorkMinutes: OTHER_SETTINGS.dailyWorkMinutes,
        workDays: OTHER_SETTINGS.workDays
      })

      await expect(getWorkSettings(SMUGGLED)).resolves.toEqual(OWNER_SETTINGS)
    })

    it('answers as whichever account the session names', async () => {
      await seedSettings(client, OWNER_ID, OWNER_SETTINGS.timezone, {
        dailyWorkMinutes: OWNER_SETTINGS.dailyWorkMinutes,
        workDays: OWNER_SETTINGS.workDays
      })
      await seedSettings(client, OTHER_USER_ID, OTHER_SETTINGS.timezone, {
        dailyWorkMinutes: OTHER_SETTINGS.dailyWorkMinutes,
        workDays: OTHER_SETTINGS.workDays
      })

      const asOwner = await getWorkSettings(event)
      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })
      const asOther = await getWorkSettings(event)

      expect([asOwner, asOther]).toEqual([OWNER_SETTINGS, OTHER_SETTINGS])
    })
  })

  describe('an unauthenticated request', () => {
    // The exact code, not the mere rejection: a handler that crashed would reject too, and only the
    // status tells a refusal apart from a fault.
    it('is refused with exactly a 401 while the same call answers under a session', async () => {
      expect.assertions(2)

      await seedSettings(client, OWNER_ID, OWNER_SETTINGS.timezone, {
        dailyWorkMinutes: OWNER_SETTINGS.dailyWorkMinutes,
        workDays: OWNER_SETTINGS.workDays
      })
      recorder.setSession(null)

      await expect(getWorkSettings(event)).rejects.toMatchObject({ statusCode: 401 })

      recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })
      await expect(getWorkSettings(event)).resolves.toEqual(OWNER_SETTINGS)
    })
  })
})
