import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../helpers/nitroGlobals'

import {
  defineAdminEventHandlerMock,
  defineAuthenticatedEventHandlerMock,
  defineEventHandlerMock,
  getValidatedQueryMock,
  issueMessage,
  readValidatedBodyMock,
  registeringWrapper,
  rejectionOf,
  requestInput,
  resetRouteHarness
} from '../../../fixtures/thinRouteHarness'

// The route file server/api/auth/login.post.ts, the four executable lines behind POST /api/auth/login.
//
// This is the one route in the repository whose correct wrapper is no wrapper. Sign-in is how a
// session comes into existence, so requiring one would make the endpoint unreachable for exactly the
// requests it exists to serve, and the registration criterion below therefore reads the opposite way
// from every other route: it must be bare, and it must still work with no session. Everything the
// endpoint does about identity is loginWithPassword's, settled in
// test/server/api/auth/handlers/login.test.ts against a live in-memory database.
//
// What is real and what is replaced is described in test/fixtures/thinRouteHarness.ts.

const { loginWithPasswordMock } = vi.hoisted(() => ({
  loginWithPasswordMock: vi.fn(async () => ({ __defaultHandlerAnswer: 'login' }) as unknown)
}))

vi.mock('~~/server/api/auth/handlers/login', () => ({
  loginWithPassword: loginWithPasswordMock
}))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('the login route must not reach the database')
  }
}))

const { LoginSchema } = await import('~~/server/models/auth')
const { FORM_LEVEL_KEY } = await import('~~/server/utils/sendZodError')

const route = await import('~~/server/api/auth/login.post')

const event = { __event: 'auth-login' } as never

const VALID = { email: 'user@example.com', password: 'correct-horse' }

let recorder: NitroRecorder

function callRoute(body: unknown) {
  requestInput.body = body
  return (route.default as (event: unknown) => Promise<unknown>)(event)
}

beforeEach(() => {
  recorder = resetRouteHarness()
  loginWithPasswordMock.mockReset()
})

describe('POST /api/auth/login route', () => {
  describe('registration: deliberately unauthenticated', () => {
    it('registers through a bare defineEventHandler', () => {
      expect(registeringWrapper(route.default)).toBe('bare')
    })

    it('registers through neither of the project wrappers', () => {
      // Stated as an absence as well as by the answer above, because this is the security decision:
      // a session wrapper here would lock every user out of the only endpoint that can give them a
      // session, and an admin wrapper would lock out everybody who is not already an admin.
      expect(defineAuthenticatedEventHandlerMock).not.toHaveBeenCalled()
      expect(defineAdminEventHandlerMock).not.toHaveBeenCalled()
    })

    it('registers with Nitro exactly once', () => {
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(1)
      expect(route.default).toBe(defineEventHandlerMock.mock.calls[0]?.[0])
    })

    it('serves a request carrying no session, which is every real sign-in', async () => {
      recorder.setSession(null)

      await callRoute(VALID)

      expect(loginWithPasswordMock).toHaveBeenCalledTimes(1)
    })

    it('answers 422 rather than 401 for a malformed body with no session', async () => {
      expect.assertions(1)
      recorder.setSession(null)

      // The distinction a bare route has to get right. A wrapped route would refuse this with 401
      // before it ever looked at the body, and the client would be told to sign in to sign in.
      await expect(callRoute({ email: 'not-an-email', password: 'x' })).rejects.toMatchObject({
        statusCode: 422
      })
    })
  })

  describe('validation: the body is checked against LoginSchema', () => {
    it('validates through LoginSchema.safeParse and not another validator', async () => {
      await callRoute(VALID)

      expect(readValidatedBodyMock).toHaveBeenCalledTimes(1)
      expect(readValidatedBodyMock.mock.calls[0]?.[1]).toBe(LoginSchema.safeParse)
    })

    it('hands readValidatedBody the event it was invoked with', async () => {
      await callRoute(VALID)

      expect(readValidatedBodyMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('reads the body and never the query string', async () => {
      await callRoute(VALID)

      expect(getValidatedQueryMock).not.toHaveBeenCalled()
    })
  })

  describe('a valid body reaches the handler', () => {
    it('calls loginWithPassword once with the event and the parsed body', async () => {
      await callRoute(VALID)

      expect(loginWithPasswordMock).toHaveBeenCalledTimes(1)
      expect(loginWithPasswordMock).toHaveBeenCalledWith(event, VALID)
    })

    it('hands the handler the normalized email and the password untouched', async () => {
      const raw = { email: '  USER@Example.COM  ', password: '  correct horse  ' }

      await callRoute(raw)
      const handed = loginWithPasswordMock.mock.calls[0]?.[1] as Record<string, unknown>

      // The email is trimmed and lowercased so a mixed-case sign-in still matches the lowercased
      // stored address, and the password is deliberately not trimmed, because a leading or trailing
      // space is a character of the secret. Getting either half backwards locks a real user out.
      expect(handed).toStrictEqual({ email: 'user@example.com', password: '  correct horse  ' })
      expect(handed).not.toBe(raw)
    })

    it('drops a key the schema does not declare instead of forwarding it', async () => {
      await callRoute({ ...VALID, role: 'admin' })

      expect(Object.keys(loginWithPasswordMock.mock.calls[0]?.[1] as object).sort()).toStrictEqual([
        'email',
        'password'
      ])
    })

    it('returns the handler answer unchanged', async () => {
      const answer = { user: { email: 'user@example.com' } }
      loginWithPasswordMock.mockResolvedValue(answer)

      await expect(callRoute(VALID)).resolves.toBe(answer)
    })

    it('lets the generic 401 from the handler through rather than converting it', async () => {
      expect.assertions(2)
      const failure = Object.assign(new Error('invalid_credentials'), { statusCode: 401 })
      loginWithPasswordMock.mockRejectedValue(failure)

      // The handler answers one indistinguishable 401 for an unknown address, a passwordless
      // account and a wrong password, so nothing here may rewrite its status or its message.
      await expect(callRoute(VALID)).rejects.toBe(failure)
      expect(failure.statusCode).toBe(401)
    })
  })

  describe('a malformed body returns through sendZodError', () => {
    it.each([
      [
        'a string that is not an address',
        { email: 'not-an-email', password: 'secret123' },
        'email'
      ],
      ['an empty email', { email: '', password: 'secret123' }, 'email'],
      ['an absent email', { password: 'secret123' }, 'email'],
      ['a non-string email', { email: 42, password: 'secret123' }, 'email'],
      ['an empty password', { email: 'user@example.com', password: '' }, 'password'],
      ['an absent password', { email: 'user@example.com' }, 'password'],
      ['a non-string password', { email: 'user@example.com', password: 12345 }, 'password'],
      ['a null password', { email: 'user@example.com', password: null }, 'password']
    ])('answers 422 keyed on %s', async (_label, body, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callRoute(body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(rejection?.data).not.toHaveProperty(FORM_LEVEL_KEY)
    })

    it('carries the message the shipped schema declares', async () => {
      expect.assertions(1)
      const body = { email: 'not-an-email', password: 'secret123' }

      const rejection = await rejectionOf(callRoute(body))

      expect(rejection?.data.email).toBe(issueMessage(LoginSchema, body, 'email'))
    })

    it('reports both malformed fields in one answer', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(callRoute({ email: 'nope', password: '' }))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {}).sort()).toStrictEqual(['email', 'password'])
    })

    it('never calls the handler when the body is malformed', async () => {
      expect.assertions(2)

      await expect(callRoute({ email: 'nope', password: '' })).rejects.toMatchObject({
        statusCode: 422
      })
      // The half that matters. A route that reported the failure and then called the handler anyway
      // would still answer 422 while having already run a credential lookup on an unvalidated value.
      expect(loginWithPasswordMock).not.toHaveBeenCalled()
    })

    it('answers 422 for a body that is not an object at all', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(callRoute(undefined))

      expect(rejection?.statusCode).toBe(422)
      expect(loginWithPasswordMock).not.toHaveBeenCalled()
    })
  })
})
