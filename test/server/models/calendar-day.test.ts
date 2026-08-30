import { isValidCalendarDay } from '~~/server/models/calendar-day'
import { describe, expect, it } from 'vitest'

// The calendar-day validator behind every server boundary that takes a 'YYYY-MM-DD'. These cases came
// with the function when it moved out of models/tasks.ts, where the task write boundary was its only
// caller until the per-category quota write reused it, so the rules asserted here are still the ones
// docs/specs/planning/task-write-api.md fixes: the shape is exactly four digits, two, and two, and a
// value that passes the shape but is not a real day is rejected rather than rolled forward.

describe('isValidCalendarDay', () => {
  it('accepts a real calendar day', () => {
    expect(isValidCalendarDay('2026-07-20')).toBe(true)
  })

  it('accepts February 29 in a leap year', () => {
    expect(isValidCalendarDay('2024-02-29')).toBe(true)
  })

  // The round-trip check is the point: 2026-02-31 passes the shape and is not a real day, and
  // JavaScript would otherwise roll it forward into March.
  it('rejects a shape-valid day that is not a real date', () => {
    expect(isValidCalendarDay('2026-02-31')).toBe(false)
  })

  it('rejects February 29 in a non-leap year', () => {
    expect(isValidCalendarDay('2026-02-29')).toBe(false)
  })

  it.each(['2026-13-01', '2026-00-10', '2026-07-32', '20260720', '2026-7-20', '26-07-20', ''])(
    'rejects the malformed day %s',
    (value) => {
      expect(isValidCalendarDay(value)).toBe(false)
    }
  )
})
