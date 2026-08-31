import { beforeEach, describe, expect, it, vi } from 'vitest'

import { code } from '../../helpers/sourceScan'

// AC15 of docs/specs/admin/onboarding-reset.md.
//
//   "app/middleware/auth.global.ts is unchanged and still routes on the session flag. Given a
//   logged-in session with onboarded: false and a target that is not the onboarding path, it returns
//   a redirect to the onboarding path. Given onboarded: true and the onboarding path, it returns a
//   redirect to the dashboard. Given onboarded: false and the onboarding path, it returns nothing."
//
// This file needs no change of its own, and that is exactly why it is worth a test. Where the flag
// comes from moved, and this middleware runs on every authenticated route in the application, which
// the owner named as the risky part of the feature. It is covered rather than trusted.
//
// It is a plain TypeScript module rather than a component, so it runs here directly. Nuxt's
// auto-imports resolve to globalThis without the transform, so useUserSession, useLocalePath and
// navigateTo are stubbed there and the middleware's own decision is what is observed. navigateTo
// returns a marker rather than navigating, because what the criterion asks about is what the
// middleware returns.

const localePaths: Record<string, string> = {
  index: '/',
  onboarding: '/onboarding',
  signin: '/connexion',
  signup: '/inscription'
}

const ONBOARDING_PATH = localePaths.onboarding as string
const DASHBOARD_PATH = localePaths.index as string
const SIGNIN_PATH = localePaths.signin as string

vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
vi.stubGlobal('useLocalePath', () => (name: string) => localePaths[name] ?? name)
vi.stubGlobal('navigateTo', (path: string) => ({ __navigateTo: path }))

const session = { loggedIn: { value: false }, user: { value: null as unknown } }
vi.stubGlobal('useUserSession', () => session)

const authGlobal = (await import('~~/app/middleware/auth.global')).default as (to: {
  path: string
}) => unknown

function signedInAs(onboarded: boolean) {
  session.loggedIn.value = true
  session.user.value = { id: 'user-owner', onboarded, role: 'admin' }
}

beforeEach(() => {
  session.loggedIn.value = false
  session.user.value = null
})

describe('the instrument, before anything is concluded from a middleware returning nothing', () => {
  // Two criteria below conclude from the middleware returning undefined. A middleware that returned
  // undefined for everything would satisfy both, so it is shown redirecting first.
  it('redirects at all, given a signed-out visitor on a protected route', () => {
    expect(authGlobal({ path: '/planification' })).toEqual({ __navigateTo: SIGNIN_PATH })
  })

  it('lets a signed-out visitor reach sign-in, so it is not redirecting everything', () => {
    expect(authGlobal({ path: SIGNIN_PATH })).toBeUndefined()
  })
})

describe('AC15: routing on the session flag', () => {
  it('sends a logged-in user with onboarded false to the onboarding path', () => {
    // The redirect a reset admin gets on their next navigation, and the reason the client never names
    // the onboarding route itself. The rule about where an un-onboarded user belongs stays in this one
    // place.
    signedInAs(false)

    expect(authGlobal({ path: '/planification' })).toEqual({ __navigateTo: ONBOARDING_PATH })
  })

  it.each(['/', '/planification', '/parametres', '/admin/utilisateurs'])(
    'sends them there from %s, whatever the target was',
    (path) => {
      signedInAs(false)

      expect(authGlobal({ path })).toEqual({ __navigateTo: ONBOARDING_PATH })
    }
  )

  it('sends a logged-in user with onboarded true away from the onboarding path', () => {
    signedInAs(true)

    expect(authGlobal({ path: ONBOARDING_PATH })).toEqual({ __navigateTo: DASHBOARD_PATH })
  })

  it('returns nothing for a logged-in user with onboarded false on the onboarding path', () => {
    // The exemption that stops the redirect looping. Without it a reset admin would be bounced between
    // the wizard and itself forever.
    signedInAs(false)

    expect(authGlobal({ path: ONBOARDING_PATH })).toBeUndefined()
  })

  it('returns nothing for a logged-in onboarded user anywhere else', () => {
    signedInAs(true)

    expect(authGlobal({ path: '/planification' })).toBeUndefined()
  })

  it('treats a missing onboarded field as not onboarded, failing closed', () => {
    // A session minted before the flag existed carries no onboarded key. Sending that user to the
    // wizard is the safe answer; letting them past would put them on a dashboard with no settings.
    session.loggedIn.value = true
    session.user.value = { id: 'user-owner' }

    expect(authGlobal({ path: '/planification' })).toEqual({ __navigateTo: ONBOARDING_PATH })
  })
})

describe('AC15: the middleware reads the session flag and nothing else', () => {
  // The behavioural cases above are the criterion. This is the guard beside them, because "unchanged"
  // is a property of the file rather than of any one decision, and the tempting change here is
  // exactly the one the spec rules out of scope: re-deriving the flag from the column instead of
  // reading the session. That is recorded in docs/TODO.md as its own pull request, and it would make
  // this middleware read a database on every authenticated request in the application.
  const source = code('app/middleware/auth.global.ts')

  it.each(['onboardedAt', 'onboarded_at', 'passwordHash', 'password_hash', '$fetch', 'useFetch'])(
    'never names %s',
    (symbol) => {
      expect(source).not.toContain(symbol)
    }
  )

  it('reads the flag off the session user', () => {
    expect(source).toContain('user.value?.onboarded')
  })

  it('has the instrument to find such a symbol, proved where one is present', () => {
    // The positive control for the absences above. A scan that read nothing would report the same
    // clean result, so it is shown finding onboardedAt in a file that legitimately has it.
    expect(code('server/api/auth/handlers/login.ts')).toContain('onboardedAt')
  })
})
