import type { Client } from '@libsql/client'

import { WorkSettingsPatchSchema } from '~~/server/models/work-settings'
import { loadWorkSettings } from '~~/server/utils/loadWorkSettings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readDaySettingsRow,
  readDaySettingsRows,
  readSettingsRows,
  seedDaySettings,
  seedSettings
} from '../../../../helpers/taskTestDb'

// The day settings refresh on PATCH /api/me/work-settings, from AC4, AC5 and AC10 of
// docs/specs/planning/day-settings-snapshot.md.
//
//   AC4. "Saving work settings updates every row dated today or later and touches no row dated
//   earlier. That is what makes a day hold the last setting saved on that day, and what makes a past
//   day untouchable."
//
//   AC5. "buffer_minutes is stamped even though settings carries no such column today."
//
//   AC10. "Every stamp path is scoped to the session user, so no write can reach another user's day."
//
// The seam is useDb, and every assertion reads the stored day_settings rows with raw SQL. The
// handler's response is the work settings and says nothing about the stamped days, so a handler that
// refreshed nothing would look identical from the outside.
//
// WHICH DAY IS TODAY IS A READING OF AC4, AND IT IS RECORDED HERE. The criterion says "dated today or
// later" without naming a timezone. Everything else in this app that resolves a calendar day for a
// user does it in the user's own stored zone through todayInZone, and the quota engine's own input
// contract says the anchor "Defaults to today in the user's own timezone", so that is what the cases
// below assert. The discriminating case is the last one in the AC4 block, where the instant is still
// the previous day in Toronto.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { saveWorkSettings } = await import('~~/server/api/me/handlers/saveWorkSettings')

const event = { __event: true } as never

const PAST = '2026-09-05'
const TODAY = '2026-09-07'
const FUTURE = '2026-09-09'

let harness: TaskTestDb
let client: Client

function patch(input: Record<string, unknown>) {
  const parsed = WorkSettingsPatchSchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture patch is not a valid request: ${parsed.error}`)
  return parsed.data
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  vi.stubGlobal('requireUserSession', async () => ({ user: { id: OWNER_ID } }))
  vi.stubGlobal(
    'createError',
    (opts: { data?: unknown; statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
  // The handler reads its own answer back through this, and Nuxt auto-imports it as a free
  // identifier, so without the Nuxt transform it has to be put on the global. It is the real
  // implementation rather than a stand-in, reading through the same mocked useDb, so what the
  // response says and what the refresh saw come from the one read path production uses.
  vi.stubGlobal('loadWorkSettings', loadWorkSettings)

  vi.useFakeTimers({ toFake: ['Date'] })
  // Midday UTC on 2026-09-07, which is the same calendar day in Toronto, so the three fixture dates
  // read as a past day, today, and a future day for every case but the timezone one at the end.
  vi.setSystemTime(new Date('2026-09-07T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  // The failure cases below silence console.error while they run, so the spy is put back rather
  // than left in place for whatever runs next.
  vi.restoreAllMocks()
})

describe('the day settings refresh on saveWorkSettings', () => {
  describe('AC4: a save updates every row dated today or later', () => {
    it('moves the row dated today', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, TODAY, { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500, workDays: [1, 2, 3] }))

      expect(await readDaySettingsRow(client, OWNER_ID, TODAY)).toMatchObject({
        work_days: '[1,2,3]',
        work_minutes: 500
      })
    })

    it('moves a row dated later than today', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, FUTURE, { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500, workDays: [1, 2, 3] }))

      expect(await readDaySettingsRow(client, OWNER_ID, FUTURE)).toMatchObject({
        work_days: '[1,2,3]',
        work_minutes: 500
      })
    })

    // The half that makes the whole feature worth having. A day that has already been reported keeps
    // the figures it was measured against.
    it('touches no row dated earlier than today', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, PAST, { workDays: '[2,4]', workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500, workDays: [1, 2, 3] }))

      expect(await readDaySettingsRow(client, OWNER_ID, PAST)).toMatchObject({
        work_days: '[2,4]',
        work_minutes: 300
      })
    })

    it('moves today and the future in one save while the past stays put', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, PAST, { workMinutes: 300 })
      await seedDaySettings(client, OWNER_ID, TODAY, { workMinutes: 300 })
      await seedDaySettings(client, OWNER_ID, FUTURE, { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect((await readDaySettingsRows(client, OWNER_ID)).map((row) => row.work_minutes)).toEqual([
        300, 500, 500
      ])
    })

    // "a day holds the last setting saved on that day". A partial save writes the settings the user
    // now holds rather than only the fields the request named, so a row cannot end up half old and
    // half new.
    it('writes the current settings for a field the request did not name', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', { dailyWorkMinutes: 400 })
      await seedDaySettings(client, OWNER_ID, TODAY, { workDays: '[2,4]', workMinutes: 300 })

      await saveWorkSettings(event, patch({ workDays: [1, 2] }))

      expect(await readDaySettingsRow(client, OWNER_ID, TODAY)).toMatchObject({
        work_days: '[1,2]',
        work_minutes: 400
      })
    })

    // AC5. The refresh keeps stamping the documented 60 until a real buffer setting exists.
    it('keeps the buffer at 60 minutes', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, TODAY, { bufferMinutes: 60, workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect((await readDaySettingsRow(client, OWNER_ID, TODAY))?.buffer_minutes).toBe(60)
    })

    // "A settings save on a day with no tasks. Nothing to update, and the day resolves through AC6."
    // The refresh updates rows and does not create them, so a user with no stamped days still has
    // none afterwards.
    it('creates no row for a day that has none', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect(await readDaySettingsRows(client, OWNER_ID)).toEqual([])
    })

    it('still returns the saved settings', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, TODAY, { workMinutes: 300 })

      const saved = await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect(saved).toMatchObject({ dailyWorkMinutes: 500 })
    })

    // The discriminating case for which day counts as today. At 02:00 UTC on the 8th it is still the
    // evening of the 7th in Toronto, so the row dated 2026-09-07 is today's row and moves. A refresh
    // reading the UTC day would call it a past day and leave it alone.
    it('resolves today in the user own timezone rather than in UTC', async () => {
      vi.setSystemTime(new Date('2026-09-08T02:00:00Z'))
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, TODAY, { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect((await readDaySettingsRow(client, OWNER_ID, TODAY))?.work_minutes).toBe(500)
    })

    it('leaves the day before that alone in the same zone', async () => {
      vi.setSystemTime(new Date('2026-09-08T02:00:00Z'))
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, '2026-09-06', { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect((await readDaySettingsRow(client, OWNER_ID, '2026-09-06'))?.work_minutes).toBe(300)
    })
  })

  describe('AC10: the refresh is scoped to the session user', () => {
    // Each case below carries the positive half as well, because an absence on the other user's side
    // proves nothing on its own: a refresh that updated no row anywhere would satisfy it.
    it('leaves another user row dated today untouched', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedSettings(client, OTHER_USER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, TODAY, { workMinutes: 300 })
      await seedDaySettings(client, OTHER_USER_ID, TODAY, { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect((await readDaySettingsRow(client, OWNER_ID, TODAY))?.work_minutes).toBe(500)
      expect((await readDaySettingsRow(client, OTHER_USER_ID, TODAY))?.work_minutes).toBe(300)
    })

    it('leaves another user row dated in the future untouched', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, FUTURE, { workMinutes: 300 })
      await seedDaySettings(client, OTHER_USER_ID, FUTURE, { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect((await readDaySettingsRow(client, OWNER_ID, FUTURE))?.work_minutes).toBe(500)
      expect((await readDaySettingsRow(client, OTHER_USER_ID, FUTURE))?.work_minutes).toBe(300)
    })

    it('moves the session user row while another user row on the same date stays', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedDaySettings(client, OWNER_ID, TODAY, { workMinutes: 300 })
      await seedDaySettings(client, OTHER_USER_ID, TODAY, { workMinutes: 300 })

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect((await readDaySettingsRow(client, OWNER_ID, TODAY))?.work_minutes).toBe(500)
      expect((await readDaySettingsRow(client, OTHER_USER_ID, TODAY))?.work_minutes).toBe(300)
    })
  })

  // AC7 of the same spec, read on the refresh side rather than on the stamp side.
  //
  //   AC7. "A failed stamp never blocks a task write. The task still lands and the failure is logged,
  //   because refusing to record real work over a bookkeeping row would police the user, which
  //   `spec.md` §2 forbids."
  //
  // The refresh is the harder half of that rule, because by the time it runs the settings write has
  // already committed. Throwing here would report a failure for a save that actually worked, so the
  // save has to keep returning its answer and the failure has to be visible in the log rather than
  // nowhere. The spec's own edge case says the same thing about the state left behind: "A failure
  // leaves the affected days holding their previous values, which is stale rather than wrong, and the
  // next save reconciles them."
  //
  // The failure is injected by dropping day_settings, the technique
  // test/server/api/tasks/handlers/dayStamp.test.ts already uses for the stamp side. It is a real
  // database refusing a real statement, so the handler's own error handling runs rather than a stub of
  // it, and nothing else about the save is faked.
  describe('AC7: a failed refresh never fails the settings save', () => {
    it('still returns the saved settings', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await client.execute('DROP TABLE day_settings')

      await expect(
        saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))
      ).resolves.toMatchObject({ dailyWorkMinutes: 500, timezone: 'America/Toronto' })
    })

    it('does not let the failure propagate to the caller', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await client.execute('DROP TABLE day_settings')

      await expect(
        saveWorkSettings(event, patch({ dailyWorkMinutes: 500, workDays: [1, 2] }))
      ).resolves.toBeTruthy()
    })

    // The settings write is the part the user asked for, and it has already committed by the time the
    // refresh runs. A swallowed failure must not also mean a lost save.
    it('leaves the settings row holding what was saved', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await client.execute('DROP TABLE day_settings')

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500, workDays: [1, 2] }))

      expect(await readSettingsRows(client, OWNER_ID)).toMatchObject([
        { daily_work_minutes: 500, work_days: '[1,2]' }
      ])
    })

    it('logs the failure rather than swallowing it silently', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await client.execute('DROP TABLE day_settings')

      await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

      expect(error.mock.calls.length + warn.mock.calls.length).toBeGreaterThan(0)
    })
  })
})

// The insert half of the write, from docs/specs/settings/settings-page.md.
//
//   "update only the provided fields on the user's `settings` row; if the row is missing, insert it
//   with the provided fields and let the column defaults fill the rest rather than failing the write"
//
//   "No `settings` row yet. The GET returns coded defaults and a PATCH inserts the row with the
//   provided fields plus defaults, so the user can save from a clean slate."
//
// A user who reaches the settings page before any settings write has no row at all, which is the
// state every account starts in, so this is the first save rather than an exotic one. Each case seeds
// no settings row and reads the stored row back with raw SQL, because the response is resolved through
// the loader's own defaults and would look identical whether a row had been written or not.
describe('saveWorkSettings with no settings row yet', () => {
  it('creates the row rather than failing the write', async () => {
    await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

    expect(await readSettingsRows(client, OWNER_ID)).toHaveLength(1)
  })

  it('stores the provided fields on the new row', async () => {
    await saveWorkSettings(
      event,
      patch({ dailyWorkMinutes: 500, timezone: 'Europe/Paris', workDays: [1, 2] })
    )

    expect(await readSettingsRows(client, OWNER_ID)).toMatchObject([
      { daily_work_minutes: 500, timezone: 'Europe/Paris', work_days: '[1,2]' }
    ])
  })

  // "let the column defaults fill the rest". A partial first save must not write nulls over the
  // columns the request said nothing about.
  it('leaves the column defaults to fill the fields the request did not name', async () => {
    await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

    expect(await readSettingsRows(client, OWNER_ID)).toMatchObject([
      {
        dark_theme: 'pastel',
        light_theme: 'pastel',
        locale: 'fr',
        timezone: 'America/Toronto',
        work_days: '[1,2,3,4,5]'
      }
    ])
  })

  it('returns the full current set read back through the loader', async () => {
    const saved = await saveWorkSettings(event, patch({ workDays: [2, 4] }))

    expect(saved).toEqual({
      dailyWorkMinutes: 450,
      timezone: 'America/Toronto',
      workDays: [2, 4]
    })
  })

  it('writes the row under the session user and under no other', async () => {
    await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

    expect(await readSettingsRows(client, OTHER_USER_ID)).toEqual([])
  })

  // The second save has a row to find, so it updates rather than inserting a second one. Without this
  // the insert branch could be reached every time and no assertion above would notice.
  it('updates that same row on the next save instead of inserting another', async () => {
    await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

    await saveWorkSettings(event, patch({ dailyWorkMinutes: 400 }))

    expect(await readSettingsRows(client, OWNER_ID)).toMatchObject([{ daily_work_minutes: 400 }])
  })

  // A first save on a day that already carries a stamp still refreshes it, so the insert branch is
  // not a path where the snapshot is quietly skipped.
  it('still refreshes a stamped day dated today', async () => {
    await seedDaySettings(client, OWNER_ID, TODAY, { workMinutes: 300 })

    await saveWorkSettings(event, patch({ dailyWorkMinutes: 500 }))

    expect((await readDaySettingsRow(client, OWNER_ID, TODAY))?.work_minutes).toBe(500)
  })
})
