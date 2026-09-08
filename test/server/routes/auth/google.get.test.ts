import { beforeEach, describe, expect, it } from 'vitest'

import type { NitroRecorder } from '../../../helpers/nitroGlobals'

import {
  defineAdminEventHandlerMock,
  defineAuthenticatedEventHandlerMock,
  defineOAuthGoogleEventHandlerMock,
  getValidatedQueryMock,
  OAUTH_GOOGLE_HANDLER,
  readValidatedBodyMock,
  resetRouteHarness
} from '../../../fixtures/thinRouteHarness'

// The route file server/routes/auth/google.get.ts, the Google OAuth callback. It is the odd one out
// among the thin routes: there is no request schema and no handler module, so the whole file is a
// configuration object plus an onSuccess of three statements, and all three of the decisions worth
// asserting live in that object.
//
//   The registering wrapper is nuxt-auth-utils' defineOAuthGoogleEventHandler and neither of this
//   project's own. That is correct rather than a dropped check: the callback is where a session
//   first comes into existence, and the wrapper does the verification itself by exchanging the code
//   Google sent for a verified profile before onSuccess ever runs.
//
//   The requested scope is exactly email, profile and openid. A scope list is the consent screen the
//   user reads and the ceiling on what the token can do, so widening it silently is a privacy
//   change the user agreed to nothing about.
//
//   onSuccess writes three fields and only three, then redirects. Whatever else Google returns in
//   the profile stays out of the session cookie, and the redirect happens after the session is
//   written rather than alongside it.
//
// The Google profile handed to onSuccess here is a stand-in for what nuxt-auth-utils resolves, and
// setUserSession and sendRedirect are the recorder's, so what lands in the recorder is what the
// route chose to write.

const recorderRef = { current: null as NitroRecorder | null }

const route = await import('~~/server/routes/auth/google.get')

type GoogleUser = Record<string, unknown>

type OAuthOptions = {
  config: { scope: string[] }
  onError?: unknown
  onSuccess: (event: unknown, payload: { user: GoogleUser }) => Promise<unknown>
}

const event = { __event: 'auth-google' } as never

// A Google profile carrying more than the route stores, so "three fields and only three" is an
// observation rather than an artefact of the fixture having nothing else to offer.
const GOOGLE_USER: GoogleUser = {
  email: 'owner@example.com',
  email_verified: true,
  family_name: 'Lovelace',
  given_name: 'Ada',
  hd: 'example.com',
  locale: 'en',
  name: 'Ada Lovelace',
  picture: 'https://lh3.googleusercontent.com/a/portrait',
  sub: '110248495921238986420'
}

function options(): OAuthOptions {
  const given = defineOAuthGoogleEventHandlerMock.mock.calls[0]?.[0]
  return given as OAuthOptions
}

function callOnSuccess(user: GoogleUser) {
  return options().onSuccess(event, { user })
}

beforeEach(() => {
  recorderRef.current = resetRouteHarness()
})

describe('GET /auth/google route', () => {
  describe('registration: the OAuth wrapper, not a project wrapper', () => {
    it('registers through defineOAuthGoogleEventHandler exactly once', () => {
      expect(defineOAuthGoogleEventHandlerMock).toHaveBeenCalledTimes(1)
      expect(defineOAuthGoogleEventHandlerMock).toHaveBeenCalledWith(expect.any(Object))
    })

    it('exports the handler the OAuth wrapper produced', () => {
      expect(route.default).toBe(OAUTH_GOOGLE_HANDLER)
    })

    it('registers through neither of the project wrappers', () => {
      // A session wrapper here would make the callback unreachable for the only request it ever
      // serves, since the visitor arriving back from Google has no session yet. The verification is
      // the OAuth wrapper's code exchange instead.
      expect(defineAuthenticatedEventHandlerMock).not.toHaveBeenCalled()
      expect(defineAdminEventHandlerMock).not.toHaveBeenCalled()
    })

    it('declares an onSuccess and no request validation of its own', () => {
      expect(options().onSuccess).toBeTypeOf('function')
      expect(readValidatedBodyMock).not.toHaveBeenCalled()
      expect(getValidatedQueryMock).not.toHaveBeenCalled()
    })
  })

  describe('the requested scope is exactly what the consent screen names', () => {
    it('requests email, profile and openid and nothing else', () => {
      expect(options().config.scope).toStrictEqual(['email', 'profile', 'openid'])
    })

    it.each([
      ['a mail scope', 'https://www.googleapis.com/auth/gmail.readonly'],
      ['a drive scope', 'https://www.googleapis.com/auth/drive'],
      ['a calendar scope', 'https://www.googleapis.com/auth/calendar']
    ])('requests no %s', (_label, scope) => {
      // Stated as an absence as well as by the exact list above, because this is the property a
      // reviewer of a widened scope would look for by name.
      expect(options().config.scope).not.toContain(scope)
    })
  })

  describe('onSuccess writes the session and then redirects', () => {
    it('writes exactly the email, the name and the picture into the session', async () => {
      await callOnSuccess(GOOGLE_USER)

      // Three fields and only three. Everything else Google returned, the subject id, the verified
      // flag, the hosted domain, stays out of the session cookie, which is carried to the client on
      // every request.
      expect(recorderRef.current?.sessions).toStrictEqual([
        {
          email: 'owner@example.com',
          name: 'Ada Lovelace',
          picture: 'https://lh3.googleusercontent.com/a/portrait'
        }
      ])
    })

    it('carries no role into the session, so the admin gate cannot be set from a Google profile', async () => {
      await callOnSuccess({ ...GOOGLE_USER, role: 'admin' })

      // defineAdminEventHandler fails closed on any role that is not exactly 'admin', and a role
      // arriving in an OAuth profile must never reach the session that gate reads.
      expect(recorderRef.current?.sessions.at(-1)).not.toHaveProperty('role')
    })

    it('carries no id into the session either', async () => {
      await callOnSuccess({ ...GOOGLE_USER, id: 'someone-elses-id' })

      expect(recorderRef.current?.sessions.at(-1)).not.toHaveProperty('id')
      expect(recorderRef.current?.sessions.at(-1)).not.toHaveProperty('sub')
    })

    it('redirects to the application root', async () => {
      await callOnSuccess(GOOGLE_USER)

      expect(recorderRef.current?.redirects).toStrictEqual([{ status: undefined, url: '/' }])
    })

    it('writes the session before the redirect, never the other way round', async () => {
      await callOnSuccess(GOOGLE_USER)

      // A redirect sent first would end the response, and the browser would follow it back to a
      // root that still has no session and bounce straight to the sign-in page.
      expect(recorderRef.current?.order).toStrictEqual(['setUserSession', 'sendRedirect:/'])
    })

    it('returns the redirect rather than a value of its own', async () => {
      await expect(callOnSuccess(GOOGLE_USER)).resolves.toStrictEqual({ __redirect: '/' })
    })

    it('writes the fields a profile is missing as undefined rather than inventing them', async () => {
      await callOnSuccess({ email: 'owner@example.com' })

      // A Google account with no picture set is a real case, and the route stores what the profile
      // said rather than substituting a placeholder the user never chose.
      expect(recorderRef.current?.sessions.at(-1)).toStrictEqual({
        email: 'owner@example.com',
        name: undefined,
        picture: undefined
      })
    })

    it('writes one session per callback rather than accumulating them', async () => {
      await callOnSuccess(GOOGLE_USER)
      await callOnSuccess({ ...GOOGLE_USER, email: 'second@example.com' })

      expect(recorderRef.current?.sessions).toHaveLength(2)
      expect(recorderRef.current?.sessions.at(-1)).toMatchObject({ email: 'second@example.com' })
    })
  })
})
