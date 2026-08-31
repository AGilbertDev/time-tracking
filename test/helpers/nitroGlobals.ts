import { applyPreferenceCookies } from '~~/server/utils/applyPreferenceCookies'
import { loadUserPreferences } from '~~/server/utils/loadUserPreferences'
import { vi } from 'vitest'

// The Nitro and nuxt-auth-utils helpers the server handlers call as free identifiers, stubbed once
// for every suite that runs a session-creation site.
//
// Four handlers need exactly this same set: the admin onboarding reset, password sign-in, magic-link
// verification, and onboarding completion. Without Nuxt's auto-import transform those identifiers
// resolve to globalThis, so each suite has to put them there, and four copies of the same seven stubs
// is four chances for one of them to drift into recording something the others do not.
//
// Two of them are deliberately the real implementation rather than a stand-in.
//
//   loadUserPreferences is the single read path the handlers read a user's persisted preferences
//   through, and it returns the coded defaults when no settings row exists. A stub returning a fixed
//   object would decide the answer the tests are asking for. Reading it for real, through whatever
//   useDb the suite has mocked, is what makes "the cookies carry the coded defaults because
//   loadUserPreferences now finds no row" an observation rather than an assumption.
//
//   applyPreferenceCookies is the thing that writes the locale cookie. Only setCookie beneath it is
//   replaced, so what lands in the recorder is what the shipped function chose to write.
//
// useRuntimeConfig is a plain stand-in returning whatever setRuntimeConfig was last given, because
// there is no Nuxt runtime here to read nuxt.config.ts. It defaults to the admin onboarding reset
// being switched on, which is the state every criterion written before the switch existed assumes, so
// a suite that never mentions the flag behaves as it did before there was one. A suite asserting the
// switched-off half calls setRuntimeConfig to close it.
//
// hashPassword and verifyPassword are replaced, because the real pair is a deliberately slow key
// derivation and nothing here is testing scrypt. The replacement is a matched pair, so a hash made by
// one verifies under the other and a mismatched password fails, which is all any of these suites
// needs from it. Nothing asserts anything about the hash's contents; the criterion that cares about
// the stored hash compares it against itself across a reset, which no hashing scheme can influence.

export type CookieWrite = { name: string; value: string }
export type HeaderWrite = { name: string; value: string }
export type RedirectWrite = { status?: number; url: string }
export type SessionWrite = Record<string, unknown>

export type NitroRecorder = {
  // Every cookie written, in order, as the shipped applyPreferenceCookies chose to write it.
  cookies: CookieWrite[]
  // Every response header written. GET /api/me sets Cache-Control: no-store because it serves
  // personal data that must never come back from a cache, and that is a property of the handler
  // worth reading back rather than assuming.
  headers: HeaderWrite[]
  // A single ordered log of the side effects a handler performs. The suites that care about write
  // ordering push their database operations into this same array, so one list shows the whole
  // sequence rather than two lists that have to be interleaved by hand.
  order: string[]
  redirects: RedirectWrite[]
  // Every session written, newest last. `at(-1)` is the session the handler left behind.
  sessions: SessionWrite[]
  // Replaces the runtime configuration useRuntimeConfig hands back. The default has the admin
  // onboarding reset switched on, so a suite that says nothing about the switch runs against an
  // available feature. Pass onboardingResetEnabled: 'false' to assert the switched-off refusal.
  setRuntimeConfig: (config: Record<string, unknown>) => void
  // Replaces the session requireUserSession will hand back. Null makes it throw 401, which is what an
  // unauthenticated request looks like from inside a handler.
  setSession: (user: Record<string, unknown> | null) => void
}

// The fake hashing scheme's forward direction, exported so a fixture can seed a stored hash that the
// stubbed verifyPassword will accept. A test that seeds a password has to be able to make a hash the
// sign-in path agrees with, and inventing a literal string in each suite would silently stop matching
// the moment this pair changed.
export function fakeHash(password: string): string {
  return `fake-scrypt$${password}`
}

export function installNitroGlobals(): NitroRecorder {
  const recorder: NitroRecorder = {
    cookies: [],
    headers: [],
    order: [],
    redirects: [],
    sessions: [],
    setRuntimeConfig: (config) => {
      runtimeConfig = { ...config }
    },
    setSession: (user) => {
      current = user
    }
  }

  let current: Record<string, unknown> | null = null

  // The string form the shipped isOnboardingResetEnabled parses, rather than a boolean, so the stub
  // exercises the real parse instead of handing the helper an answer it never has to read.
  let runtimeConfig: Record<string, unknown> = { onboardingResetEnabled: 'true' }

  // An h3 error carrying its own statusCode and statusMessage, matching how the shipped createError
  // is read by every caller in this repository.
  const createError = (options: { statusCode: number; statusMessage: string; data?: unknown }) =>
    Object.assign(new Error(options.statusMessage), options)

  vi.stubGlobal('createError', createError)

  vi.stubGlobal('requireUserSession', async () => {
    if (!current) {
      // What nuxt-auth-utils throws for a request carrying no session, and what the validate-session
      // middleware has already produced for an account that is gone or deactivated.
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    return { user: current }
  })

  vi.stubGlobal('setUserSession', async (_event: unknown, session: { user: SessionWrite }) => {
    recorder.order.push('setUserSession')
    recorder.sessions.push(session.user)
    // The session a handler writes is the session a later requireUserSession in the same test should
    // see, which is what makes a two-call sequence like reset-then-reset behave the way it does in a
    // browser rather than replaying a stale session.
    current = { ...session.user }
    return session
  })

  vi.stubGlobal('setCookie', (_event: unknown, name: string, value: string) => {
    recorder.order.push(`setCookie:${name}`)
    recorder.cookies.push({ name, value })
  })

  vi.stubGlobal('getCookie', () => undefined)

  vi.stubGlobal('setResponseHeader', (_event: unknown, name: string, value: string) => {
    recorder.headers.push({ name, value })
  })

  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)

  vi.stubGlobal('sendRedirect', (_event: unknown, url: string, status?: number) => {
    recorder.order.push(`sendRedirect:${url}`)
    recorder.redirects.push({ status, url })
    return { __redirect: url }
  })

  vi.stubGlobal('loadUserPreferences', loadUserPreferences)
  vi.stubGlobal('applyPreferenceCookies', applyPreferenceCookies)

  vi.stubGlobal('hashPassword', async (password: string) => fakeHash(password))
  vi.stubGlobal(
    'verifyPassword',
    async (hash: string, password: string) => hash === fakeHash(password)
  )

  return recorder
}
