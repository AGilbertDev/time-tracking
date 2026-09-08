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

// The two thin route files under server/api/magic-link/, covered in one suite because they are the
// two halves of one flow and both are deliberately unauthenticated: a signup link is how a session
// first comes into existence, so a session wrapper on either would make the flow unreachable for the
// only requests it serves.
//
// The neutral no-send answer, the token lifetime, the single use, and the session the link mints are
// all the handlers', settled in test/server/api/magic-link/handlers/verify.test.ts. Nothing about
// them is decided here.
//
// What is real and what is replaced is described in test/fixtures/thinRouteHarness.ts.

const handlers = vi.hoisted(() => ({
  requestMagicLink: vi.fn(async () => ({ __defaultHandlerAnswer: 'request' }) as unknown),
  verifyMagicLink: vi.fn(async () => ({ __defaultHandlerAnswer: 'verify' }) as unknown)
}))

vi.mock('~~/server/api/magic-link/handlers/request', () => ({
  requestMagicLink: handlers.requestMagicLink
}))
vi.mock('~~/server/api/magic-link/handlers/verify', () => ({
  verifyMagicLink: handlers.verifyMagicLink
}))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('a magic-link route must not reach the database')
  }
}))

const { RequestSchema, VerifySchema } = await import('~~/server/models/magic-link')
const { FORM_LEVEL_KEY } = await import('~~/server/utils/sendZodError')
const { DEFAULT_LOCALE, LOCALES } = await import('#shared/theme')

const requestRoute = await import('~~/server/api/magic-link/request.post')
const verifyRoute = await import('~~/server/api/magic-link/verify.get')

const event = { __event: 'magic-link' } as never

const TOKEN = '3f2a6c4e-9b1d-4f8a-8c7e-2d5b1a9e4c30'

let recorder: NitroRecorder

function callRequest(body: unknown) {
  requestInput.body = body
  return (requestRoute.default as (event: unknown) => Promise<unknown>)(event)
}

function callVerify(query: unknown) {
  requestInput.query = query
  return (verifyRoute.default as (event: unknown) => Promise<unknown>)(event)
}

beforeEach(() => {
  recorder = resetRouteHarness()
  for (const handler of Object.values(handlers)) handler.mockReset()
})

describe('the magic-link routes', () => {
  describe('registration: both halves are deliberately unauthenticated', () => {
    it.each([
      ['POST /api/magic-link/request', () => requestRoute.default],
      ['GET /api/magic-link/verify', () => verifyRoute.default]
    ])('registers %s through a bare defineEventHandler', (_label, read) => {
      expect(registeringWrapper(read())).toBe('bare')
    })

    it('registers neither route through a project wrapper', () => {
      expect(defineAuthenticatedEventHandlerMock).not.toHaveBeenCalled()
      expect(defineAdminEventHandlerMock).not.toHaveBeenCalled()
    })

    it('registers exactly the two routes in the directory', () => {
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(2)
    })

    it('serves a signup request carrying no session', async () => {
      recorder.setSession(null)

      await callRequest({ email: 'invitee@example.com' })

      expect(handlers.requestMagicLink).toHaveBeenCalledTimes(1)
    })

    it('serves a verification carrying no session, which is every real click', async () => {
      recorder.setSession(null)

      await callVerify({ token: TOKEN })

      expect(handlers.verifyMagicLink).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /api/magic-link/request', () => {
    it('validates the body through RequestSchema.safeParse and not another validator', async () => {
      await callRequest({ email: 'invitee@example.com' })

      expect(readValidatedBodyMock).toHaveBeenCalledTimes(1)
      expect(readValidatedBodyMock.mock.calls[0]?.[1]).toBe(RequestSchema.safeParse)
      expect(readValidatedBodyMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('reads the body and never the query string', async () => {
      await callRequest({ email: 'invitee@example.com' })

      expect(getValidatedQueryMock).not.toHaveBeenCalled()
    })

    it('hands the handler the default locale when the body names none', async () => {
      const raw = { email: 'invitee@example.com' }

      await callRequest(raw)

      // The locale decides which language the email arrives in, and the schema resolves the fallback
      // rather than the handler. Forwarding the raw body would leave the field absent and the email
      // would be composed from undefined.
      expect(handlers.requestMagicLink).toHaveBeenCalledWith({
        email: 'invitee@example.com',
        locale: DEFAULT_LOCALE
      })
      expect(handlers.requestMagicLink.mock.calls[0]?.[0]).not.toBe(raw)
    })

    it.each([...LOCALES])('keeps an explicit %s locale', async (locale) => {
      await callRequest({ email: 'invitee@example.com', locale })

      expect(handlers.requestMagicLink.mock.calls[0]?.[0]).toStrictEqual({
        email: 'invitee@example.com',
        locale
      })
    })

    it('hands the handler the normalized email rather than the raw body', async () => {
      await callRequest({ email: '  INVITEE@Example.COM  ' })

      // The allowlist key the admin invite wrote is lowercased, and this lookup reads the same key.
      // A padded, mixed-case address would miss it and the invitee would silently never be sent a
      // link, which is indistinguishable from the neutral refusal.
      expect(handlers.requestMagicLink.mock.calls[0]?.[0]).toStrictEqual({
        email: 'invitee@example.com',
        locale: DEFAULT_LOCALE
      })
    })

    it('is called with the parsed body alone, the handler taking no event', async () => {
      await callRequest({ email: 'invitee@example.com' })

      expect(handlers.requestMagicLink.mock.calls[0]).toHaveLength(1)
    })

    it('drops a key the schema does not declare instead of forwarding it', async () => {
      await callRequest({ email: 'invitee@example.com', role: 'admin' })

      expect(
        Object.keys(handlers.requestMagicLink.mock.calls[0]?.[0] as object).sort()
      ).toStrictEqual(['email', 'locale'])
    })

    it('returns the handler answer unchanged', async () => {
      const answer = { result: 'sent' }
      handlers.requestMagicLink.mockResolvedValue(answer)

      await expect(callRequest({ email: 'invitee@example.com' })).resolves.toBe(answer)
    })

    it('lets a handler failure through rather than converting it', async () => {
      expect.assertions(1)
      const failure = Object.assign(new Error('Too Many Requests'), { statusCode: 429 })
      handlers.requestMagicLink.mockRejectedValue(failure)

      await expect(callRequest({ email: 'invitee@example.com' })).rejects.toBe(failure)
    })

    it.each([
      ['a string that is not an address', { email: 'not-an-email' }, 'email'],
      ['an empty email', { email: '' }, 'email'],
      ['an absent email', {}, 'email'],
      ['a non-string email', { email: 42 }, 'email'],
      ['a locale outside the shared contract', { email: 'a@example.com', locale: 'de' }, 'locale'],
      ['a null locale', { email: 'a@example.com', locale: null }, 'locale']
    ])('answers 422 keyed on %s', async (_label, body, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callRequest(body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(rejection?.data).not.toHaveProperty(FORM_LEVEL_KEY)
    })

    it('carries the message the shipped schema declares for a bad address', async () => {
      expect.assertions(1)
      const body = { email: 'not-an-email' }

      const rejection = await rejectionOf(callRequest(body))

      expect(rejection?.data.email).toBe(issueMessage(RequestSchema, body, 'email'))
    })

    it('never calls the handler when the body is malformed', async () => {
      expect.assertions(2)

      await expect(callRequest({ email: 'not-an-email' })).rejects.toMatchObject({
        statusCode: 422
      })
      // The half that matters. A route that reported the failure and then called the handler anyway
      // would still answer 422 while having already minted a token for an unvalidated address.
      expect(handlers.requestMagicLink).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/magic-link/verify', () => {
    it('validates the query through VerifySchema.safeParse and not another validator', async () => {
      await callVerify({ token: TOKEN })

      expect(getValidatedQueryMock).toHaveBeenCalledTimes(1)
      expect(getValidatedQueryMock.mock.calls[0]?.[1]).toBe(VerifySchema.safeParse)
      expect(getValidatedQueryMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('reads the query string and never the body', async () => {
      await callVerify({ token: TOKEN })

      expect(readValidatedBodyMock).not.toHaveBeenCalled()
    })

    it('calls the handler once with the event and the parsed query', async () => {
      await callVerify({ token: TOKEN })

      expect(handlers.verifyMagicLink).toHaveBeenCalledTimes(1)
      expect(handlers.verifyMagicLink).toHaveBeenCalledWith(event, { token: TOKEN })
    })

    it('hands the handler the parsed query rather than the raw one', async () => {
      const raw = { next: '/admin/users', token: TOKEN }

      await callVerify(raw)
      const handed = handlers.verifyMagicLink.mock.calls[0]?.[1] as Record<string, unknown>

      // VerifySchema declares one field, so the schema's product carries the token alone. Forwarding
      // the raw query would hand the handler a caller-chosen redirect target alongside the token.
      expect(Object.keys(handed)).toStrictEqual(['token'])
      expect(handed).not.toBe(raw)
    })

    it('returns the handler answer unchanged', async () => {
      const answer = { __redirect: '/onboarding' }
      handlers.verifyMagicLink.mockResolvedValue(answer)

      await expect(callVerify({ token: TOKEN })).resolves.toBe(answer)
    })

    it('lets the handler refusal of a spent or expired token through unchanged', async () => {
      expect.assertions(1)
      const failure = Object.assign(new Error('invalid_token'), { statusCode: 400 })
      handlers.verifyMagicLink.mockRejectedValue(failure)

      await expect(callVerify({ token: TOKEN })).rejects.toBe(failure)
    })

    it.each([
      ['a token that is not a uuid', 'not-a-uuid'],
      ['an empty token', ''],
      ['a uuid missing a group', '3f2a6c4e-9b1d-4f8a-2d5b1a9e4c30'],
      ['a uuid with a bad character', '3f2a6c4e-9b1d-4f8a-8c7e-2d5b1a9e4c3g']
    ])('answers 422 keyed on token for %s', async (_label, token) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callVerify({ token }))

      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        token: issueMessage(VerifySchema, { token }, 'token')
      })
      expect(handlers.verifyMagicLink).not.toHaveBeenCalled()
    })

    it.each([
      ['an absent token', {}],
      ['a non-string token', { token: 42 }],
      ['a repeated token arriving as an array', { token: [TOKEN, TOKEN] }]
    ])('answers 422 keyed on token for %s', async (_label, query) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callVerify(query))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['token'])
      expect(rejection?.data).not.toHaveProperty(FORM_LEVEL_KEY)
    })

    it('never calls the handler when the token is malformed', async () => {
      expect.assertions(2)

      await expect(callVerify({ token: 'not-a-uuid' })).rejects.toMatchObject({ statusCode: 422 })
      // The half that matters. A route that reported the failure and then called the handler anyway
      // would still answer 422 while having already run a token lookup and, on a hit, minted a
      // session from a value that never passed the boundary.
      expect(handlers.verifyMagicLink).not.toHaveBeenCalled()
    })
  })
})
