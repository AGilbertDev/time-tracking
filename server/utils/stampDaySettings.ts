import { and, eq, gte } from 'drizzle-orm'

import { todayInZone } from '#shared/planning'

import { useDb } from '../db/index'
import { daySettings } from '../db/schema'
import { loadWorkSettings } from './loadWorkSettings'

// The two writes behind the day settings snapshot, kept together because they are two halves of one
// rule. A day records the settings in force on it, and that record is frozen once the day is past.
//
// The buffer has no setting to read yet, so both writes stamp the documented default. Stamping it now
// rather than leaving the column to its own default means the day the real setting arrives, it flows
// through here with no migration and no second pass over existing rows.
const DEFAULT_BUFFER_MINUTES = 60

// loadWorkSettings is imported by path rather than left to Nitro's auto-import, deliberately. This
// module is reached from the task write handlers, which are unit-tested against a real database
// through a mocked useDb and without the Nuxt transform, so a free identifier here would resolve to
// globalThis and throw. Reading it by path is also what loadWorkSchedule already does with useDb.

// Records the settings in force on `date` for `userId`, unless that date already has a row.
//
// The first write wins, which is what "the settings in force when the day was first worked" means,
// and a later task on the same day does not restamp it. The unique index on (user_id, date) is what
// makes that a database guarantee rather than a read-then-write race, so two tasks created on the
// same fresh day in the same instant still leave one row.
//
// The date stamped is the task's own date and never today, so a task created for a future day carries
// that day's settings and is kept current by refreshDaySettings until the day passes.
//
// This never throws, and that is a deliberate departure from the backend convention that says never
// swallow an exception. The convention is right for a request the user is waiting on an answer from,
// where a swallowed failure returns a lie. It is wrong here, because refusing to record real work
// over a failed bookkeeping row would police the user, which spec.md §2 forbids outright. So the
// caller writes the task first and this logs and continues.
//
// The failure is not silent and it is not lossy. It reaches stderr, the day is simply unstamped, the
// resolver falls back to the effective-dated schedule for it, and the next task on that day stamps
// it. There is no half-written state to recover from, which is what makes swallowing safe rather
// than merely convenient.
export async function stampDaySettings(userId: string, date: string): Promise<void> {
  try {
    const settings = await loadWorkSettings(userId)
    const db = useDb()

    await db
      .insert(daySettings)
      .values({
        bufferMinutes: DEFAULT_BUFFER_MINUTES,
        date,
        userId,
        workDays: JSON.stringify(settings.workDays),
        workMinutes: settings.dailyWorkMinutes
      })
      .onConflictDoNothing()
      .run()
  } catch (error) {
    console.error(`Could not stamp day settings for ${date}.`, error)
  }
}

// Brings every row dated today or later into line with the settings just saved, and touches no row
// dated earlier.
//
// That asymmetry is the whole protection. A day still in progress or still ahead has not been
// measured yet, so it should carry what the user has just decided. A day already past has been
// reported against, so a change now must not restate it.
//
// Today is today in the user's own timezone rather than in UTC, matching every other place in the app
// that decides which calendar day it is, because a save made late in the evening in Toronto must not
// refresh tomorrow's row instead of today's.
//
// This never throws either, for the reason given above and one more. The settings save has already
// committed and the response is the user's answer, so throwing here would report a failure for a save
// that actually worked. A failure leaves the affected days holding their previous values, which is
// stale rather than wrong, and the next save reconciles them.
export async function refreshDaySettings(userId: string): Promise<void> {
  try {
    const settings = await loadWorkSettings(userId)
    const db = useDb()
    const today = todayInZone(new Date(), settings.timezone)

    await db
      .update(daySettings)
      .set({
        bufferMinutes: DEFAULT_BUFFER_MINUTES,
        updatedAt: new Date(),
        workDays: JSON.stringify(settings.workDays),
        workMinutes: settings.dailyWorkMinutes
      })
      .where(and(eq(daySettings.userId, userId), gte(daySettings.date, today)))
      .run()
  } catch (error) {
    console.error('Could not refresh the day settings snapshot.', error)
  }
}
