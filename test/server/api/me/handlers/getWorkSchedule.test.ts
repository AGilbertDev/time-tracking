import type { Client } from '@libsql/client'

import { loadWorkSchedule } from '~~/server/utils/loadWorkSchedule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import { createTaskTestDb, OTHER_USER_ID, OWNER_ID } from '../../../../helpers/taskTestDb'

// getWorkSchedule, the handler behind GET /api/me/work-schedule.
//
// Derived from docs/specs/planning/read-only-week-capacity-and-nav.md:
//
//   AC5. "GET /api/me/work-schedule returns 401 without a session, and with a session returns only
//   that user's schedule records with work_days coerced to a clean number array, ordered by
//   effective_from ascending. An empty history returns []."
//
//   "Handler server/api/me/handlers/getWorkSchedule.ts reads the session user through
//   requireUserSession, so the scope is always the session user and never an id from the request,
//   and it delegates to loadWorkSchedule."
//
//   "Corrupt or legacy work_days JSON in a schedule row. The server read path coerces it [...] so a
//   broken stored shape never reaches the resolver or the client raw."
//
// THIS HANDLER IS TWO LINES AND BOTH OF THEM ARE AN AUTHORISATION DECISION. "only that user's
// schedule records" is the whole criterion, so every case runs against a second seeded account whose
// records share no figure with the session user's.
//
// The seam is useDb. loadWorkSchedule is Nuxt-auto-imported by the handler, so it is put on the
// global as the REAL implementation reading through the mocked useDb, which is what makes the
// ordering and the coercion observations rather than assumptions about a stub.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { getWorkSchedule } = await import('~~/server/api/me/handlers/getWorkSchedule')

const event = { __event: true } as never

const SMUGGLED = {
  context: { params: { id: OTHER_USER_ID, userId: OTHER_USER_ID } },
  node: { req: { url: `/api/me/work-schedule?userId=${OTHER_USER_ID}` } },
  path: `/api/me/work-schedule?userId=${OTHER_USER_ID}`
} as never

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

// One work_schedule row, inserted with raw SQL. The shared harness's seedWorkSchedule derives its
// primary key from the user id alone, so it can only ever seed one record per account, and an
// effective-dated history needs several. work_days is passed as the raw stored text so a corrupt
// legacy value can be seeded, which no serializer would ever produce.
async function seedScheduleRecord(
  userId: string,
  row: { bufferMinutes?: number; effectiveFrom: string; workDays?: string; workMinutes: number }
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO work_schedule
            (id, user_id, work_minutes, work_days, buffer_minutes, effective_from)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      `schedule-${userId}-${row.effectiveFrom}`,
      userId,
      row.workMinutes,
      row.workDays ?? '[1,2,3,4,5]',
      row.bufferMinutes ?? 60,
      row.effectiveFrom
    ]
  })
}

// Two accounts whose histories have no figure in common, so a read scoped to the wrong id answers
// visibly differently rather than identically.
const OWNER_EARLIER = {
  bufferMinutes: 60,
  effectiveFrom: '2026-01-01',
  workDays: [1, 2, 3, 4, 5],
  workMinutes: 420
}
const OWNER_LATER = {
  bufferMinutes: 45,
  effectiveFrom: '2026-07-01',
  workDays: [1, 2, 3],
  workMinutes: 480
}
const OTHER_RECORD = {
  bufferMinutes: 15,
  effectiveFrom: '2026-03-01',
  workDays: [0, 6],
  workMinutes: 111
}

async function seedOwnerHistory() {
  // Inserted latest-first, so an endpoint that returned insertion order rather than effective_from
  // order would come back reversed.
  await seedScheduleRecord(OWNER_ID, {
    bufferMinutes: OWNER_LATER.bufferMinutes,
    effectiveFrom: OWNER_LATER.effectiveFrom,
    workDays: JSON.stringify(OWNER_LATER.workDays),
    workMinutes: OWNER_LATER.workMinutes
  })
  await seedScheduleRecord(OWNER_ID, {
    bufferMinutes: OWNER_EARLIER.bufferMinutes,
    effectiveFrom: OWNER_EARLIER.effectiveFrom,
    workDays: JSON.stringify(OWNER_EARLIER.workDays),
    workMinutes: OWNER_EARLIER.workMinutes
  })
}

async function seedOtherHistory() {
  await seedScheduleRecord(OTHER_USER_ID, {
    bufferMinutes: OTHER_RECORD.bufferMinutes,
    effectiveFrom: OTHER_RECORD.effectiveFrom,
    workDays: JSON.stringify(OTHER_RECORD.workDays),
    workMinutes: OTHER_RECORD.workMinutes
  })
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })

  vi.stubGlobal('loadWorkSchedule', loadWorkSchedule)
})

describe('getWorkSchedule', () => {
  describe('AC5: it returns the session user own effective-dated history', () => {
    it('returns every record the account holds', async () => {
      await seedOwnerHistory()

      await expect(getWorkSchedule(event)).resolves.toHaveLength(2)
    })

    // "ordered by effective_from ascending". The fixtures are inserted latest-first above, so this
    // fails on any endpoint that hands back insertion order.
    it('orders the records by effectiveFrom ascending', async () => {
      await seedOwnerHistory()

      const records = await getWorkSchedule(event)

      expect(records.map((record) => record.effectiveFrom)).toEqual([
        OWNER_EARLIER.effectiveFrom,
        OWNER_LATER.effectiveFrom
      ])
    })

    it('carries the work minutes, work days and buffer of each record', async () => {
      await seedOwnerHistory()

      await expect(getWorkSchedule(event)).resolves.toEqual([OWNER_EARLIER, OWNER_LATER])
    })

    // AC5's last sentence. The resolver supplies the documented defaults for any date, so the
    // caller never special-cases "no schedule" and an empty history is a normal answer.
    it('returns an empty array for an account with no history', async () => {
      await expect(getWorkSchedule(event)).resolves.toEqual([])
    })

    // "a broken stored shape never reaches the resolver or the client raw". The column is JSON text,
    // so a legacy or corrupt value can be sitting in it.
    it('coerces a corrupt stored work_days value to a clean number array', async () => {
      await seedScheduleRecord(OWNER_ID, {
        effectiveFrom: '2026-01-01',
        workDays: 'not json at all',
        workMinutes: 420
      })

      const records = await getWorkSchedule(event)

      expect(records).toHaveLength(1)
      expect(records[0]?.workDays).toEqual([1, 2, 3, 4, 5])
    })

    it('drops out-of-range and duplicate day numbers rather than passing them through', async () => {
      await seedScheduleRecord(OWNER_ID, {
        effectiveFrom: '2026-01-01',
        workDays: '[1,1,2,9,-3,"x"]',
        workMinutes: 420
      })

      const records = await getWorkSchedule(event)

      expect(records[0]?.workDays).toEqual([1, 2])
    })
  })

  describe('AC5: the read returns only that user records', () => {
    it('returns the session user history while another account holds a different one', async () => {
      await seedOwnerHistory()
      await seedOtherHistory()

      // Both halves in one case. The absence alone would be satisfied by a handler that returned an
      // empty array and read nothing.
      const records = await getWorkSchedule(event)

      expect(records).toEqual([OWNER_EARLIER, OWNER_LATER])
      expect(records).not.toContainEqual(OTHER_RECORD)
    })

    it('returns an empty history when only another account has records', async () => {
      await seedOtherHistory()

      await expect(getWorkSchedule(event)).resolves.toEqual([])
    })

    // "never an id from the request".
    it('ignores another account id smuggled into the request', async () => {
      await seedOwnerHistory()
      await seedOtherHistory()

      await expect(getWorkSchedule(SMUGGLED)).resolves.toEqual([OWNER_EARLIER, OWNER_LATER])
    })

    it('answers as whichever account the session names', async () => {
      await seedOwnerHistory()
      await seedOtherHistory()

      const asOwner = await getWorkSchedule(event)
      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })
      const asOther = await getWorkSchedule(event)

      expect([asOwner, asOther]).toEqual([[OWNER_EARLIER, OWNER_LATER], [OTHER_RECORD]])
    })
  })

  describe('AC5: no session', () => {
    // "returns 401 without a session". The exact code, because a crash also rejects.
    it('is refused with exactly a 401 while the same call answers under a session', async () => {
      expect.assertions(2)

      await seedOwnerHistory()
      recorder.setSession(null)

      await expect(getWorkSchedule(event)).rejects.toMatchObject({ statusCode: 401 })

      recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })
      await expect(getWorkSchedule(event)).resolves.toEqual([OWNER_EARLIER, OWNER_LATER])
    })
  })
})
