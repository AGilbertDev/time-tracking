import { SESSION_MAX_AGE } from '~~/app/constants/auth'
import { DAY_IN_SECONDS } from '~~/app/constants/time'
import { describe, expect, it } from 'vitest'

import { code } from '../../helpers/sourceScan'

// SESSION_MAX_AGE, the signed-in session lifetime.
//
// It is one line of pure data, and importing it is most of the coverage. The assertions that earn
// their place are the ones about the two things a bare number cannot tell you: its unit, and where
// it is actually consumed.
//
// The unit is load-bearing and unstated in the name. `nuxt.config.ts` passes this value to
// nuxt-auth-utils as `auth.maxAge`, which that module defines in SECONDS, and it is the same unit
// the Set-Cookie `Max-Age` attribute takes. The neighbouring constants file carries a
// MINUTE_IN_MILLISECONDS in milliseconds, so the two units live side by side and a value written in
// the wrong one still compiles. A millisecond figure handed to a seconds field would make every
// session outlive the app; a seconds figure handed to a milliseconds field would expire every
// session within the minute. Neither failure has a test anywhere else.
//
// The expected value is derived rather than restated. Seven days is asserted through the date epoch
// and through DAY_IN_SECONDS, so a literal 604800 typed into either place would not satisfy both,
// and the constant is held to being built from the day rather than hand-multiplied.

// Two UTC instants exactly seven calendar days apart, stated as calendar fields so the arithmetic is
// the engine's rather than this file's. The epoch ignores leap seconds, so this is an exact figure.
const START = Date.UTC(2026, 8, 7, 0, 0, 0, 0)
const SEVEN_DAYS_LATER = Date.UTC(2026, 8, 14, 0, 0, 0, 0)

describe('SESSION_MAX_AGE', () => {
  it('is a positive whole number of seconds', () => {
    // A zero or negative lifetime would expire every session at the instant it was minted and lock
    // every user out of an owner-managed app with no self-service recovery.
    expect(Number.isInteger(SESSION_MAX_AGE)).toBe(true)
    expect(SESSION_MAX_AGE).toBeGreaterThan(0)
  })

  it('is the number of seconds the epoch advances over seven days', () => {
    expect(SESSION_MAX_AGE).toBe((SEVEN_DAYS_LATER - START) / 1000)
  })

  // Held to being expressed in seconds rather than milliseconds, through the same independent
  // measurement. If the constant were ever written in milliseconds this figure would be a thousand
  // times the seven-day span and this case would fail before any session behaviour changed.
  it('is expressed in seconds rather than milliseconds', () => {
    expect(SESSION_MAX_AGE).toBeLessThan(SEVEN_DAYS_LATER - START)
  })

  // Built from DAY_IN_SECONDS rather than hand-multiplied, which is what keeps one edit to the day
  // constant from leaving a stale literal behind here.
  it('is a whole number of days, derived from DAY_IN_SECONDS', () => {
    expect(SESSION_MAX_AGE % DAY_IN_SECONDS).toBe(0)
    expect(SESSION_MAX_AGE / DAY_IN_SECONDS).toBe(7)
  })
})

// Where the constant is consumed. The value only means anything because nuxt.config.ts hands it to
// nuxt-auth-utils, and a config that quietly grew its own literal would leave every assertion above
// passing over a number nothing reads. The config cannot be imported here (it calls Nuxt's own
// defineNuxtConfig, which does not exist outside a Nuxt runtime), so this is read as source with
// comments stripped, the same way the other guard suites in this repository read theirs.
describe('the session lifetime nuxt.config.ts actually applies', () => {
  const config = code('nuxt.config.ts')

  it('reads its auth maxAge from this constant rather than from a literal', () => {
    expect(config).toContain('maxAge: SESSION_MAX_AGE')
  })

  it('imports the constant from app/constants/auth', () => {
    // The positive control for the assertion above: a config that referenced the name without
    // importing it would not compile, and a search that matched a comment would report the same
    // clean result as one that matched real code, which is why the source is stripped first.
    expect(config).toMatch(/import\s*\{\s*SESSION_MAX_AGE\s*\}\s*from\s*'\.\/app\/constants\/auth'/)
  })
})
