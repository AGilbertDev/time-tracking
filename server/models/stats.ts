import { z } from 'zod'

import { calendarDaySchema } from './calendar-day'

// The request contract for GET /api/stats (the quota engine).
//
// One optional anchor date, from which the handler derives all four periods. It is optional because
// the common case is the client asking about now and having no reason to know what day it is in the
// user's timezone, which the server resolves instead. A malformed value is refused here rather than
// coerced, so no period is ever computed from a date the user did not mean.
//
// calendarDaySchema is shared rather than restated, so this endpoint refuses exactly what the task
// write boundary and the quota write refuse. That includes a value that passes the shape and is not a
// real day, such as 2026-02-30, which a plain pattern would let through.
//
// There is no from and to pair here, unlike TaskListQuerySchema, and that is deliberate. A caller
// does not choose the ranges: the four periods are the day, the week, the month and the year that
// contain the anchor, so an arbitrary range is not expressible on purpose and there is no span to
// bound. A screen that wants a range of its own is the performance history view, PLAN-24, and it gets
// its own contract rather than widening this one.
export const StatsQuerySchema = z.object({
  date: calendarDaySchema.optional()
})

export type StatsQuery = z.infer<typeof StatsQuerySchema>
