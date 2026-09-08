import type { Client } from '@libsql/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedCategoryQuota,
  seedDaySettings,
  seedSettings,
  seedTask,
  seedWorkSchedule
} from '../../../../helpers/taskTestDb'

// getStats, the handler behind GET /api/stats, from AC14 of docs/specs/planning/quota-engine.md.
//
//   "The endpoint requires a session and scopes every read to the session user, never to an id from
//   the request, so one user can never read another's figures. A malformed `date` returns 400 through
//   the shipped `sendZodError`."
//
// Plus the input contract from the same document: "`date`, optional, `YYYY-MM-DD`. The anchor the four
// periods derive from. Defaults to today in the user's own timezone."
//
// The seam is useDb, which returns a genuine Drizzle instance over an in-memory libSQL database
// carrying the shipped DDL. Every scoping criterion here is a statement about a WHERE clause, and a
// faked query builder would record the statement rather than prove that another user's rows stayed
// out of the answer, which is the entire question. The other user's rows are seeded with raw SQL so
// the fixture cannot be shaped by the bug the test looks for.
//
// ONE PLACE WHERE THIS FILE HAD TO CHOOSE, RECORDED RATHER THAN SMOOTHED OVER. Every other read
// endpoint in this repository validates its query in the thin route file and hands the parsed object
// to its handler, as server/api/tasks/index.get.ts does with TaskListQuerySchema, so getStats is
// called here as getStats(event, query) with query being { date?: string }. The query schema is
// expected at server/models/stats.ts, which is where the other request schemas live.
//
// The status code is no longer a choice. An earlier draft of AC14 said 400, which was wrong about the
// helper it named in the same sentence, and the criterion now pins 422, "that being the code the
// helper throws for every validation failure in the app". So the exact code is asserted below rather
// than only its family.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { getStats } = await import('~~/server/api/stats/handlers/getStats')
const { StatsQuerySchema } = await import('~~/server/models/stats')
const { sendZodError } = await import('~~/server/utils/sendZodError')

// Everything under server/utils that this handler is likely to reach, imported so it can be put on
// the global. Nuxt auto-imports them into Nitro as free identifiers, and without that transform they
// resolve to globalThis, so a handler written the way saveWorkSettings.ts is written would throw a
// ReferenceError here. Each one is the real implementation reading through the same mocked useDb, not
// a stand-in, so nothing about what the figures are is decided by this file. A handler that imports
// them by path instead simply never reads these.
const { computeQuotaStats } = await import('~~/server/utils/computeQuotaStats')
const { loadCategoryQuotas } = await import('~~/server/utils/loadCategoryQuotas')
const { loadWorkSchedule } = await import('~~/server/utils/loadWorkSchedule')
const { loadWorkSettings } = await import('~~/server/utils/loadWorkSettings')
const { resolveDaySettings } = await import('~~/server/utils/resolveDaySettings')

const event = { __event: true } as never

// A Wednesday, so its week is 2026-09-06 through 2026-09-12 and its month is the 30 days of
// September 2026.
const ANCHOR = '2026-09-09'

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })

  vi.stubGlobal('computeQuotaStats', computeQuotaStats)
  vi.stubGlobal('loadCategoryQuotas', loadCategoryQuotas)
  vi.stubGlobal('loadWorkSchedule', loadWorkSchedule)
  vi.stubGlobal('loadWorkSettings', loadWorkSettings)
  vi.stubGlobal('resolveDaySettings', resolveDaySettings)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getStats', () => {
  describe('AC14: a session is required', () => {
    it('rejects a request carrying no session', async () => {
      expect.assertions(1)
      recorder.setSession(null)

      await expect(getStats(event, { date: ANCHOR })).rejects.toMatchObject({ statusCode: 401 })
    })

    it('reads nothing for a request carrying no session', async () => {
      expect.assertions(1)
      recorder.setSession(null)
      await seedTask(client, {
        actualMinutes: 100,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })

      await expect(getStats(event, { date: ANCHOR })).rejects.toThrow()
    })
  })

  describe('AC14: every read is scoped to the session user', () => {
    it('counts the session user tasks and not another user tasks', async () => {
      await seedTask(client, {
        actualMinutes: 100,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })
      await seedTask(client, {
        actualMinutes: 500,
        category: 'translation',
        date: ANCHOR,
        id: 'other-task',
        projectWordCount: 9999,
        userId: OTHER_USER_ID
      })

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.headline.words).toBe(600)
      expect(stats.day.headline.minutes).toBe(100)
      expect(stats.day.consumedMinutes).toBe(100)
    })

    // The quota another user set must not decide what this user is measured against. With no row of
    // their own the owner resolves the shipped 240 words per hour, so 600 words is a 150 minute target
    // over 120 actual minutes, which is 1.25. Reading the other user's 480 would give 0.625.
    it('resolves quotas from the session user rows and not another user rows', async () => {
      await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 480)
      await seedTask(client, {
        actualMinutes: 120,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.headline.attainment).toBeCloseTo(1.25, 6)
    })

    // The day settings snapshot is per user and per date, so another user's stamp on the same date
    // must not shorten this user's day. With no row of their own the owner resolves DEFAULT_SCHEDULE's
    // 450 minutes.
    it('resolves day settings from the session user rows and not another user rows', async () => {
      await seedDaySettings(client, OTHER_USER_ID, ANCHOR, { workMinutes: 100 })

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.scheduledMinutes).toBe(450)
    })

    it('resolves the work schedule from the session user history and not another user history', async () => {
      await seedWorkSchedule(client, OTHER_USER_ID, '2026-01-01', 300)

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.scheduledMinutes).toBe(450)
    })

    // "never to an id from the request". A user id smuggled into the query is already refused by the
    // schema, and this asserts it could not reach a read even if one arrived, which is the same
    // discipline the task write handlers keep.
    it('ignores a user id smuggled into the query', async () => {
      await seedTask(client, {
        actualMinutes: 100,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })
      await seedTask(client, {
        actualMinutes: 500,
        category: 'translation',
        date: ANCHOR,
        id: 'other-task',
        projectWordCount: 9999,
        userId: OTHER_USER_ID
      })

      const stats = await getStats(event, {
        date: ANCHOR,
        userId: OTHER_USER_ID
      } as never)

      expect(stats.day.headline.words).toBe(600)
    })

    it('reads each user own figures rather than a shared set', async () => {
      await seedTask(client, {
        actualMinutes: 100,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })
      await seedTask(client, {
        actualMinutes: 500,
        category: 'translation',
        date: ANCHOR,
        id: 'other-task',
        projectWordCount: 1200,
        userId: OTHER_USER_ID
      })

      const owner = await getStats(event, { date: ANCHOR })
      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })
      const other = await getStats(event, { date: ANCHOR })

      expect(owner.day.headline.words).toBe(600)
      expect(other.day.headline.words).toBe(1200)
    })
  })

  describe('AC14: a malformed date is rejected through the shipped sendZodError', () => {
    it.each([
      '2026-9-9',
      '20260909',
      'not-a-date',
      '2026-02-30',
      '2026-13-01',
      '',
      '2026-09-09T00:00',
      'today'
    ])('refuses the date %p', (date) => {
      expect(StatsQuerySchema.safeParse({ date }).success).toBe(false)
    })

    it('accepts a real calendar day', () => {
      expect(StatsQuerySchema.safeParse({ date: ANCHOR })).toMatchObject({ success: true })
    })

    // The parameter is optional, which is what lets the handler default to today.
    it('accepts a request carrying no date at all', () => {
      expect(StatsQuerySchema.safeParse({}).success).toBe(true)
    })

    // AC14's exact code, and the per-field message that makes it actionable. 422 is what the shipped
    // sendZodError throws for every validation failure in the app, so a 400 here would mean this one
    // endpoint had grown its own error contract.
    it('reports the failure as a 422 keyed on the field that was wrong', () => {
      expect.assertions(2)
      const parsed = StatsQuerySchema.safeParse({ date: 'not-a-date' })
      if (parsed.success) throw new Error('the fixture is not a malformed date')

      try {
        sendZodError(parsed.error)
      } catch (error) {
        const thrown = error as { data?: Record<string, string>; statusCode?: number }

        expect(thrown.statusCode).toBe(422)
        expect(thrown.data).toMatchObject({ date: expect.any(String) })
      }
    })

    // The same code for every malformed value the schema refuses, so no shape of bad date takes a
    // different path out of the endpoint.
    it.each(['2026-9-9', '2026-02-30', 'today', ''])('answers 422 for the date %p', (date) => {
      expect.assertions(1)
      const parsed = StatsQuerySchema.safeParse({ date })
      if (parsed.success) throw new Error(`the fixture ${date} is not a malformed date`)

      try {
        sendZodError(parsed.error)
      } catch (error) {
        expect((error as { statusCode?: number }).statusCode).toBe(422)
      }
    })
  })

  describe('the anchor defaults to today in the user own timezone', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      // 02:00 UTC, which is still the previous evening in Toronto and the same lunchtime in Sydney. A
      // zone that straddles midnight is what proves the day is resolved in the user's zone rather than
      // in the server's.
      vi.setSystemTime(new Date('2026-09-08T02:00:00Z'))
    })

    it('resolves the day period in the stored timezone', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')

      const stats = await getStats(event, {})

      expect(stats.day.from).toBe('2026-09-07')
      expect(stats.day.to).toBe('2026-09-07')
    })

    it('resolves a different day for a user in a zone ahead of UTC', async () => {
      await seedSettings(client, OWNER_ID, 'Australia/Sydney')

      const stats = await getStats(event, {})

      expect(stats.day.from).toBe('2026-09-08')
    })

    it('falls back to the coded default zone when the user has no settings row', async () => {
      const stats = await getStats(event, {})

      expect(stats.day.from).toBe('2026-09-07')
    })

    // The whole point of resolving the zone. The task belongs to the day it was logged on in the
    // user's own zone, so a UTC reading would put the anchor on the 8th and report an empty day.
    it('counts the tasks of that day rather than of the UTC day', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')
      await seedTask(client, {
        actualMinutes: 100,
        category: 'translation',
        date: '2026-09-07',
        id: 'yesterday',
        projectWordCount: 600
      })
      await seedTask(client, {
        actualMinutes: 999,
        category: 'translation',
        date: '2026-09-08',
        id: 'tomorrow',
        projectWordCount: 9999
      })

      const stats = await getStats(event, {})

      expect(stats.day.headline.words).toBe(600)
      expect(stats.day.headline.minutes).toBe(100)
    })

    it('takes an explicit date over today', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.from).toBe(ANCHOR)
    })

    it('derives the other three periods from the resolved anchor', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')

      const stats = await getStats(event, {})

      // 2026-09-07 is a Monday, so its week runs from Sunday 2026-09-06 to Saturday 2026-09-12.
      expect({ from: stats.week.from, to: stats.week.to }).toEqual({
        from: '2026-09-06',
        to: '2026-09-12'
      })
      expect({ from: stats.month.from, to: stats.month.to }).toEqual({
        from: '2026-09-01',
        to: '2026-09-30'
      })
      expect({ from: stats.year.from, to: stats.year.to }).toEqual({
        from: '2026-01-01',
        to: '2026-12-31'
      })
    })
  })

  describe('the answer it hands back', () => {
    it('returns the four periods, each with its rows, headline and leftover', async () => {
      await seedTask(client, {
        actualMinutes: 120,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })

      const stats = await getStats(event, { date: ANCHOR })

      for (const period of [stats.day, stats.week, stats.month, stats.year]) {
        expect(period).toMatchObject({
          categories: expect.any(Array),
          consumedMinutes: expect.any(Number),
          from: expect.any(String),
          scheduledMinutes: expect.any(Number),
          to: expect.any(String),
          unaccountedMinutes: expect.any(Number)
        })
      }
    })

    // The figures are the engine's, computed from the stored rows rather than from anything the
    // request said. 600 words at the shipped 240 words per hour is a 150 minute target over 120 actual
    // minutes, so the attainment is 1.25 and the achieved rate is 300 words per hour.
    it('answers with the figures the stored rows produce', async () => {
      await seedTask(client, {
        actualMinutes: 120,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })

      const stats = await getStats(event, { date: ANCHOR })
      const translation = stats.day.categories.find(
        (entry: { categoryId: string }) => entry.categoryId === 'translation'
      )

      expect(translation.words).toBe(600)
      expect(translation.achievedWph).toBeCloseTo(300, 6)
      expect(translation.attainment).toBeCloseTo(1.25, 6)
    })

    it('reads the stamped day settings for the scheduled minutes', async () => {
      await seedDaySettings(client, OWNER_ID, ANCHOR, { workMinutes: 400 })

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.scheduledMinutes).toBe(400)
      expect(stats.day.unaccountedMinutes).toBe(400)
    })

    // The user-visible half of the 2026-09-07 amendment to AC6, which put the user's current
    // settings row between the work_schedule lookup and DEFAULT_SCHEDULE. Nothing in the app writes
    // work_schedule, so before the amendment an unstamped day was measured against the shipped 450
    // minutes however short the user's day really was. A translator on a six-hour day therefore had
    // every unstamped day's leftover overstated by 90 minutes.
    //
    // 2026-09-09 is a Wednesday and the stored work days are Monday through Friday, so the day
    // contributes its whole length, and its week (2026-09-06 to 2026-09-12) contributes five of them.
    // The week figure is asserted because the overstatement was per unstamped day rather than once.
    it('reads the stored daily work minutes for a day with no stamp', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', { dailyWorkMinutes: 360 })

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.scheduledMinutes).toBe(360)
      expect(stats.day.scheduledMinutes).not.toBe(450)
      expect(stats.day.unaccountedMinutes).toBe(360)
      expect(stats.week.scheduledMinutes).toBe(1800)
    })

    // The stored work days come from the same row, so a settings row naming a shorter week shortens
    // the period rather than only the day. Monday to Wednesday is three work days at 360 minutes.
    it('reads the stored work days for a week of unstamped days', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', {
        dailyWorkMinutes: 360,
        workDays: [1, 2, 3]
      })

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.week.scheduledMinutes).toBe(1080)
    })

    // The snapshot still outranks the live row at the endpoint, so the amendment reaches only the
    // days nobody worked. A day that was stamped keeps the length it was worked at.
    it('prefers a stamped day over the stored daily work minutes', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', { dailyWorkMinutes: 360 })
      await seedDaySettings(client, OWNER_ID, ANCHOR, { workMinutes: 400 })

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.scheduledMinutes).toBe(400)
    })

    // And a work_schedule record that applies still outranks the live row, because a dated record is
    // a recorded fact. The record is seeded effective before the anchor, so it is the tier that
    // answers even though the settings row says something shorter.
    it('prefers an applicable work_schedule record over the stored daily work minutes', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto', { dailyWorkMinutes: 360 })
      await seedWorkSchedule(client, OWNER_ID, '2026-01-01', 420)

      const stats = await getStats(event, { date: ANCHOR })

      expect(stats.day.scheduledMinutes).toBe(420)
    })

    it('writes nothing, since it is one authenticated read', async () => {
      await seedTask(client, {
        actualMinutes: 120,
        category: 'translation',
        date: ANCHOR,
        id: 'owner-task',
        projectWordCount: 600
      })

      await getStats(event, { date: ANCHOR })

      const tasks = await client.execute('SELECT COUNT(*) AS n FROM tasks')
      const days = await client.execute('SELECT COUNT(*) AS n FROM day_settings')

      expect(Number(tasks.rows[0]?.n)).toBe(1)
      expect(Number(days.rows[0]?.n)).toBe(0)
    })
  })
})
