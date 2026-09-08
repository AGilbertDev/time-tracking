import { DAY_IN_SECONDS, MINUTE_IN_MILLISECONDS } from '~~/app/constants/time'
import * as serverTime from '~~/server/utils/constants/time'
import { describe, expect, it } from 'vitest'

// The two duration constants in app/constants/time.ts.
//
// These are pure data, so importing them is most of the coverage. That is not the point of this
// file. Both are magic numbers standing in for a physical fact, and the only assertion worth making
// about a magic number is one made against the source of truth it mirrors rather than against the
// literal it happens to hold. Restating `60 * 60 * 24` here would be a second copy of the same
// arithmetic that could go wrong in exactly the same way, and it would agree with any typo made in
// both places at once.
//
// So the source of truth used below is the JavaScript date epoch. It is measured in milliseconds
// since 1970 UTC, it is defined to ignore leap seconds, and a UTC day in it is exactly 86 400 000
// milliseconds by definition, so the difference between two UTC instants is an independent
// statement of how long a minute and a day are. Nothing here reads a local timezone, so no case
// depends on where the suite runs or on whether daylight saving moved that week.
//
// The unit each constant carries is the other thing worth pinning. The names say milliseconds and
// seconds, and every caller multiplies by them without converting: the magic-link expiry computes
// `Date.now() + 15 * MINUTE_IN_MILLISECONDS` against a milliseconds clock, and the locale cookie
// computes `365 * DAY_IN_SECONDS` for a maxAge attribute that is defined in seconds. A constant that
// silently changed unit would keep every one of those lines compiling while making a fifteen-minute
// token last a quarter of a second or a one-year cookie last six hours.

// Two consecutive UTC midnights, and two UTC instants one minute apart, both stated as calendar
// fields so the arithmetic is the engine's rather than this file's.
const MIDNIGHT = Date.UTC(2026, 8, 7, 0, 0, 0, 0)
const NEXT_MIDNIGHT = Date.UTC(2026, 8, 8, 0, 0, 0, 0)
const ONE_MINUTE_LATER = Date.UTC(2026, 8, 7, 0, 1, 0, 0)

describe('MINUTE_IN_MILLISECONDS', () => {
  it('is the number of milliseconds the epoch advances over one minute', () => {
    expect(MINUTE_IN_MILLISECONDS).toBe(ONE_MINUTE_LATER - MIDNIGHT)
  })

  it('is a positive whole number of milliseconds', () => {
    expect(Number.isInteger(MINUTE_IN_MILLISECONDS)).toBe(true)
    expect(MINUTE_IN_MILLISECONDS).toBeGreaterThan(0)
  })

  // The unit check, stated as the round trip a caller performs. Adding the constant to a
  // milliseconds clock has to move the wall clock by exactly one minute, which is what the
  // magic-link expiry relies on.
  it('advances a Date by one minute when added to its milliseconds value', () => {
    const before = new Date(MIDNIGHT)
    const after = new Date(before.getTime() + MINUTE_IN_MILLISECONDS)

    expect(after.getUTCMinutes()).toBe(before.getUTCMinutes() + 1)
    expect(after.getUTCSeconds()).toBe(before.getUTCSeconds())
  })
})

describe('DAY_IN_SECONDS', () => {
  it('is the number of seconds the epoch advances between two consecutive UTC midnights', () => {
    expect(DAY_IN_SECONDS).toBe((NEXT_MIDNIGHT - MIDNIGHT) / 1000)
  })

  it('is a positive whole number of seconds', () => {
    expect(Number.isInteger(DAY_IN_SECONDS)).toBe(true)
    expect(DAY_IN_SECONDS).toBeGreaterThan(0)
  })

  // The unit check that ties the two constants together, again through the calendar rather than
  // through their literals: a day is 1440 minutes, so a day in seconds and a minute in milliseconds
  // have to agree once the thousand is accounted for. Either constant changing unit breaks this.
  it('agrees with MINUTE_IN_MILLISECONDS about how many minutes a day holds', () => {
    const minutesInADay = (NEXT_MIDNIGHT - MIDNIGHT) / (ONE_MINUTE_LATER - MIDNIGHT)

    expect(DAY_IN_SECONDS * 1000).toBe(minutesInADay * MINUTE_IN_MILLISECONDS)
  })
})

// The same two names exist a second time in server/utils/constants/time.ts, because the client
// bundle and the Nitro bundle cannot import across each other's alias boundaries here. Two copies of
// a physical constant is two chances for one to be edited alone, and nothing else in the suite would
// notice: each side's own callers would keep computing plausible-looking durations from a different
// idea of how long a minute is. This is the drift guard, and it only checks the two constants that
// are genuinely the same fact. SESSION_MAX_AGE exists in both files with deliberately different
// values and is not compared here.
describe('the server copy of the same constants', () => {
  it('agrees with the app copy about a minute', () => {
    expect(serverTime.MINUTE_IN_MILLISECONDS).toBe(MINUTE_IN_MILLISECONDS)
  })

  it('agrees with the app copy about a day', () => {
    expect(serverTime.DAY_IN_SECONDS).toBe(DAY_IN_SECONDS)
  })
})
