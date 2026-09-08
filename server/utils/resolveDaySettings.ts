import type { ResolvedSchedule, WorkScheduleRecord } from '#shared/planning'

import { coerceWorkDays, hasScheduleOnOrBefore, resolveSchedule } from '#shared/planning'

// The work settings in force on one date, resolved in one place (the day settings snapshot).
//
// Four tiers, in this order and for this reason.
//
// The day's own row wins, because it is a fact recorded on the day itself. That is what stops a
// settings change made next month from rewriting a figure already reported for a past day, and it is
// the same snapshot reasoning resolveCategoryQuota's header describes for a task's stored quota.
//
// Then the effective-dated work_schedule through the shipped resolveSchedule. A day nobody worked has
// no row here, because nothing was ever logged on it to trigger a stamp, so there is no recorded fact
// to read and the dated lookup is the honest answer instead. resolveSchedule is called rather than
// reimplemented, so the effective-dating rule stays in the one place that already owns it.
//
// Then the user's current settings row, which is the tier code review added on 2026-09-07. Without it
// an unstamped day answered with the shipped 7 h 30 rather than with the hours the user had actually
// set, because nothing in the app writes work_schedule, so a user on a six-hour day had every leftover
// overstated and the same day reported 7 h 30 before its first task and the real figure after it.
// Reaching for the live row does mean a change of hours moves the leftover on past days that were
// never logged, and that is accepted rather than overlooked: such a day holds no recorded work, so the
// figure moving is noise, where the shipped default was simply the wrong number.
//
// Then DEFAULT_SCHEDULE, for a user with no settings row at all.
//
// The second tier is asked for only when it has something to say, which is what hasScheduleOnOrBefore
// answers. resolveSchedule returns DEFAULT_SCHEDULE for an empty history, so calling it
// unconditionally would swallow the third tier entirely and look correct while doing it.
//
// Nothing here reads a database, so the whole resolution order is testable against fixtures.

// One day_settings row as the column values arrive. workDays is the raw stored JSON text rather than
// a parsed array, deliberately: the coercion belongs to the read of the row, and a caller handing
// over an array would already have had to decide what a corrupt value means.
export interface DaySettingsRecord {
  bufferMinutes: number
  workDays: string
  workMinutes: number
}

// The settings in force on `date`. `row` is that date's own stamp, or null when it has none.
//
// The row's work_days is coerced rather than trusted, so a corrupt value falls back to the default
// set. It falls back there and never to the next tier, because a row that exists is not a missing
// row: the rest of that stamp is still the recorded truth for the day, and dropping to the schedule
// history would answer with values from a different source because one field was malformed. A
// legitimately empty array survives as an empty set, meaning a week with no work days, which is a
// real setting rather than a corrupt one.
// `current` is the user's live work settings, or null when they have no settings row. It carries a
// buffer because the type does, and the caller supplies the documented 60 until a real buffer setting
// exists, which is the same rule the stamp follows.
export function resolveDaySettings(
  date: string,
  row: DaySettingsRecord | null | undefined,
  records: readonly WorkScheduleRecord[],
  current?: ResolvedSchedule | null
): ResolvedSchedule {
  if (row) {
    return {
      bufferMinutes: row.bufferMinutes,
      workDays: coerceWorkDays(row.workDays),
      workMinutes: row.workMinutes
    }
  }

  if (hasScheduleOnOrBefore(records, date)) return resolveSchedule(records, date)

  // A fresh copy rather than the argument, so a caller holding the settings object cannot have it
  // mutated underneath them by whoever reads the answer. resolveSchedule already does this with
  // DEFAULT_SCHEDULE for the same reason.
  if (current) {
    return {
      bufferMinutes: current.bufferMinutes,
      workDays: [...current.workDays],
      workMinutes: current.workMinutes
    }
  }

  // resolveSchedule supplies DEFAULT_SCHEDULE here, and it returns a fresh copy, so the constant
  // cannot be mutated through this return either.
  return resolveSchedule(records, date)
}
