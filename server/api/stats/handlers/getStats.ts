import type { H3Event } from 'h3'

import { and, between, eq } from 'drizzle-orm'

import {
  DEFAULT_SCHEDULE,
  getMonthRange,
  getWeekRange,
  getYearRange,
  todayInZone
} from '#shared/planning'

import type { StatsQuery } from '../../../models/stats'
import type { QuotaStats, StatsDayRow, StatsTask } from '../../../utils/computeQuotaStats'

import { useDb } from '../../../db/index'
import { daySettings, tasks } from '../../../db/schema'

// Returns the current user's throughput figures for the day, week, month and year containing one
// anchor date (the quota engine).
//
// Every read is scoped to the session user through its own WHERE clause, so ownership is enforced by
// the queries rather than by a check that could be forgotten. No id is ever taken from the request:
// the query schema has no user field, and even if one arrived it could not reach a clause, because
// each one below reads user.id from the session right here.
//
// The anchor defaults to today in the user's own stored timezone rather than to the server's date. A
// request made at 02:00 UTC is still the previous evening in Toronto, so resolving it in UTC would
// hand the user tomorrow's empty day. The client has no reason to know the user's zone, so the server
// answers with it.
//
// Two range reads and two whole-history reads, and no query per period. All four periods are served
// from one scan per table over the union of their ranges, which is why a week crossing a year
// boundary costs nothing extra. The arithmetic then happens once in memory, where the engine can be
// pure.
export async function getStats(event: H3Event, query: StatsQuery): Promise<QuotaStats> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const settings = await loadWorkSettings(user.id)
  const anchor = query.date ?? todayInZone(new Date(), settings.timezone)

  // The union of the four ranges. The day sits inside the month and the month inside the year, but a
  // week can straddle a year boundary in either direction, so the bounds are taken from all four
  // rather than assumed to be the year's.
  const ranges = [
    { from: anchor, to: anchor },
    getWeekRange(anchor),
    getMonthRange(anchor),
    getYearRange(anchor)
  ]
  const from = ranges.reduce((lowest, range) => (range.from < lowest ? range.from : lowest), anchor)
  const to = ranges.reduce((highest, range) => (range.to > highest ? range.to : highest), anchor)

  // 'YYYY-MM-DD' sorts chronologically as plain text, so BETWEEN on the date column is an indexed
  // range scan over (user_id, date) rather than a comparison on parsed values.
  const rows: StatsTask[] = await db
    .select({
      actualMinutes: tasks.actualMinutes,
      category: tasks.category,
      date: tasks.date,
      estimatedMinutes: tasks.estimatedMinutes,
      excludeFromStats: tasks.excludeFromStats,
      projectWordCount: tasks.projectWordCount,
      quotaWphOverride: tasks.quotaWphOverride
    })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), between(tasks.date, from, to)))
    .all()

  // The day stamps in range. workDays arrives as the stored JSON text and is coerced by the resolver
  // rather than here, so the coercion stays on the read of the row and lives in one place.
  const dayRows: StatsDayRow[] = await db
    .select({
      bufferMinutes: daySettings.bufferMinutes,
      date: daySettings.date,
      workDays: daySettings.workDays,
      workMinutes: daySettings.workMinutes
    })
    .from(daySettings)
    .where(and(eq(daySettings.userId, user.id), between(daySettings.date, from, to)))
    .all()

  // The whole schedule history rather than a slice of it, because a record effective years ago is
  // still the one in force for a date with no stamp of its own, so a range read would drop exactly
  // the record most days resolve through.
  const [quotas, schedule] = await Promise.all([
    loadCategoryQuotas(user.id),
    loadWorkSchedule(user.id)
  ])

  // The user's live settings are the third resolution tier, for a date with no stamp and no schedule
  // record in force. loadWorkSettings already answers with the coded defaults when there is no row, so
  // this is never null in practice and the resolver's null branch is there for its own contract. The
  // buffer comes from DEFAULT_SCHEDULE because the settings row has no such column yet, which is the
  // same rule the stamp follows, so adding that setting later changes one line here.
  const current = {
    bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
    workDays: settings.workDays,
    workMinutes: settings.dailyWorkMinutes
  }

  return computeQuotaStats({
    anchor,
    current,
    daySettings: dayRows,
    quotas,
    schedule,
    tasks: rows
  })
}
