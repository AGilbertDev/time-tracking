import { SESSION_MAX_AGE } from '~~/app/constants/auth'
import { describe, expect, it } from 'vitest'

import { code } from '../../helpers/sourceScan'

describe('SESSION_MAX_AGE', () => {
  it('is 604 800 seconds, seven days', () => {
    expect(SESSION_MAX_AGE).toBe(604_800)
  })
})

// nuxt-auth-utils defines auth.maxAge in seconds, the same unit the Set-Cookie Max-Age attribute
// takes. A millisecond figure here would make every session outlive the app; a seconds figure
// misread as milliseconds would expire every session within the minute. nuxt.config.ts cannot be
// imported (it calls Nuxt's own defineNuxtConfig, which does not exist outside a Nuxt runtime), so
// this reads it as source with comments stripped.
describe('the session lifetime nuxt.config.ts actually applies', () => {
  const config = code('nuxt.config.ts')

  it('reads its auth maxAge from this constant rather than from a literal', () => {
    expect(config).toContain('maxAge: SESSION_MAX_AGE')
  })

  it('imports the constant from app/constants/auth', () => {
    expect(config).toMatch(/import\s*\{\s*SESSION_MAX_AGE\s*\}\s*from\s*'\.\/app\/constants\/auth'/)
  })
})
