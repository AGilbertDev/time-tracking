import type { Mock } from 'vitest'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../helpers/nitroGlobals'

import {
  defineAdminEventHandlerMock,
  defineAuthenticatedEventHandlerMock,
  defineEventHandlerMock,
  getValidatedQueryMock,
  getValidatedRouterParamsMock,
  readValidatedBodyMock,
  registeringWrapper,
  requestInput,
  resetRouteHarness
} from '../../../fixtures/thinRouteHarness'

// The eight thin route files under server/api/me/ that read nothing from the request: three avatar
// verbs and five reads. Covered as a set because they are one shape with one decision in it, and
// because the property that matters is shared and negative.
//
// Every one of these endpoints acts on the session user and on nobody else. There is no id, path, or
// key anywhere in the request, and each route file says so in its own comment. That is only true as
// long as the route body is a single call forwarding the event, so the criterion is asserted as an
// absence: no route here may call any of Nitro's three validated readers, because reading a request
// part at all is the first step of taking a target from the caller. A route that grew a `?userId=`
// would keep every positive assertion below passing.
//
// The complement is the wrapper. These routes carry no validation and no logic, so the wrapper is
// the entire security surface of the file: swap defineAuthenticatedEventHandler for a bare
// defineEventHandler and one user's avatar bytes, email address and settings are served to anybody
// who asks. What each handler then reads is settled in its own suite under handlers/.
//
// What is real and what is replaced is described in test/fixtures/thinRouteHarness.ts.

const handlers = vi.hoisted(() => ({
  getCategoryQuotas: vi.fn(async () => ({ __defaultHandlerAnswer: 'category-quotas' }) as unknown),
  getMe: vi.fn(async () => ({ __defaultHandlerAnswer: 'me' }) as unknown),
  getPreferences: vi.fn(async () => ({ __defaultHandlerAnswer: 'preferences' }) as unknown),
  getWorkSchedule: vi.fn(async () => ({ __defaultHandlerAnswer: 'work-schedule' }) as unknown),
  getWorkSettings: vi.fn(async () => ({ __defaultHandlerAnswer: 'work-settings' }) as unknown),
  removeAvatar: vi.fn(async () => ({ __defaultHandlerAnswer: 'avatar-delete' }) as unknown),
  serveAvatar: vi.fn(async () => ({ __defaultHandlerAnswer: 'avatar-get' }) as unknown),
  uploadAvatar: vi.fn(async () => ({ __defaultHandlerAnswer: 'avatar-put' }) as unknown)
}))

vi.mock('~~/server/api/me/handlers/getCategoryQuotas', () => ({
  getCategoryQuotas: handlers.getCategoryQuotas
}))
vi.mock('~~/server/api/me/handlers/getMe', () => ({ getMe: handlers.getMe }))
vi.mock('~~/server/api/me/handlers/getPreferences', () => ({
  getPreferences: handlers.getPreferences
}))
vi.mock('~~/server/api/me/handlers/getWorkSchedule', () => ({
  getWorkSchedule: handlers.getWorkSchedule
}))
vi.mock('~~/server/api/me/handlers/getWorkSettings', () => ({
  getWorkSettings: handlers.getWorkSettings
}))
vi.mock('~~/server/api/me/handlers/removeAvatar', () => ({ removeAvatar: handlers.removeAvatar }))
vi.mock('~~/server/api/me/handlers/serveAvatar', () => ({ serveAvatar: handlers.serveAvatar }))
vi.mock('~~/server/api/me/handlers/uploadAvatar', () => ({ uploadAvatar: handlers.uploadAvatar }))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('a me pass-through route must not reach the database')
  }
}))

const avatarDeleteRoute = await import('~~/server/api/me/avatar.delete')
const avatarGetRoute = await import('~~/server/api/me/avatar.get')
const avatarPutRoute = await import('~~/server/api/me/avatar.put')
const categoryQuotasGetRoute = await import('~~/server/api/me/category-quotas.get')
const indexGetRoute = await import('~~/server/api/me/index.get')
const preferencesGetRoute = await import('~~/server/api/me/preferences.get')
const workScheduleGetRoute = await import('~~/server/api/me/work-schedule.get')
const workSettingsGetRoute = await import('~~/server/api/me/work-settings.get')

type RouteFn = (event: unknown) => Promise<unknown>

const event = { __event: 'me-passthrough' } as never

const OWNER = { email: 'owner@example.com', id: 'owner-id', role: 'user' }

const cases: [label: string, route: RouteFn, handler: Mock][] = [
  ['DELETE /api/me/avatar', avatarDeleteRoute.default as RouteFn, handlers.removeAvatar],
  ['GET /api/me/avatar', avatarGetRoute.default as RouteFn, handlers.serveAvatar],
  ['PUT /api/me/avatar', avatarPutRoute.default as RouteFn, handlers.uploadAvatar],
  [
    'GET /api/me/category-quotas',
    categoryQuotasGetRoute.default as RouteFn,
    handlers.getCategoryQuotas
  ],
  ['GET /api/me', indexGetRoute.default as RouteFn, handlers.getMe],
  ['GET /api/me/preferences', preferencesGetRoute.default as RouteFn, handlers.getPreferences],
  ['GET /api/me/work-schedule', workScheduleGetRoute.default as RouteFn, handlers.getWorkSchedule],
  ['GET /api/me/work-settings', workSettingsGetRoute.default as RouteFn, handlers.getWorkSettings]
]

let recorder: NitroRecorder

beforeEach(() => {
  recorder = resetRouteHarness()
  recorder.setSession({ ...OWNER })
  for (const handler of Object.values(handlers)) handler.mockReset()
})

describe('the me routes that read nothing from the request', () => {
  describe('registration: the session is enforced by the authenticated wrapper', () => {
    it.each(cases)('registers %s through defineAuthenticatedEventHandler', (_label, route) => {
      expect(registeringWrapper(route)).toBe('authenticated')
    })

    it('registers no route here through the admin wrapper', () => {
      // These are every user's own endpoints, so the admin gate would be wrong in the other
      // direction: it would lock the owner out of their own profile.
      expect(defineAdminEventHandlerMock).not.toHaveBeenCalled()
    })

    it('registers exactly the eight pass-through routes through the authenticated wrapper', () => {
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledTimes(8)
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledWith(expect.any(Function))
    })

    it('registers with Nitro once per route, through the wrapper rather than directly', () => {
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(8)
      for (const [handler] of defineAuthenticatedEventHandlerMock.mock.calls) {
        expect(defineEventHandlerMock.mock.calls.map(([given]) => given)).not.toContain(handler)
      }
    })

    it.each(cases)('exports the handler the wrapper produced for %s', (_label, route) => {
      expect(
        defineAuthenticatedEventHandlerMock.mock.results.map((result) => result.value)
      ).toContain(route)
    })

    it.each(cases)(
      'rejects a request to %s carrying no session with 401',
      async (_label, route) => {
        expect.assertions(1)
        recorder.setSession(null)

        await expect(route(event)).rejects.toMatchObject({ statusCode: 401 })
      }
    )

    it.each(cases)(
      'calls no handler behind %s for a request carrying no session',
      async (_label, route, handler) => {
        expect.assertions(2)
        recorder.setSession(null)

        await expect(route(event)).rejects.toMatchObject({ statusCode: 401 })
        expect(handler).not.toHaveBeenCalled()
      }
    )
  })

  describe('the request carries no target, so none is read from it', () => {
    it.each(cases)(
      'reads no body, no query and no route parameter on %s',
      async (_label, route) => {
        // Set every request part to something a route could act on, so an assertion that none was read
        // is not passing merely because there was nothing there.
        requestInput.body = { userId: 'someone-else' }
        requestInput.params = { id: 'someone-else' }
        requestInput.query = { userId: 'someone-else', v: '2' }

        await route(event)

        expect(readValidatedBodyMock).not.toHaveBeenCalled()
        expect(getValidatedQueryMock).not.toHaveBeenCalled()
        expect(getValidatedRouterParamsMock).not.toHaveBeenCalled()
      }
    )

    it.each(cases)(
      'calls the handler behind %s with the event alone',
      async (_label, route, handler) => {
        await route(event)

        // One argument, not two. A second argument would be a value the route decided, and the target
        // of every one of these endpoints is settled by the session inside the handler instead.
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith(event)
        expect(handler.mock.calls[0]).toHaveLength(1)
      }
    )

    it.each(cases)(
      'hands the handler behind %s the event it was invoked with',
      async (_label, route, handler) => {
        await route(event)

        expect(handler.mock.calls[0]?.[0]).toBe(event)
      }
    )
  })

  describe('the handler answer comes back unchanged', () => {
    it.each(cases)(
      'returns the answer of the handler behind %s unchanged',
      async (label, route, handler) => {
        const answer = { __thisExactAnswer: label }
        handler.mockResolvedValue(answer)

        await expect(route(event)).resolves.toBe(answer)
      }
    )

    it.each(cases)(
      'returns a falsy answer from %s as it is rather than substituting one',
      async (_label, route, handler) => {
        // GET /api/me/avatar answers with the stored bytes or with nothing at all, so null is a real
        // answer here and a route coalescing it would invent a body the handler never produced.
        handler.mockResolvedValue(null)

        await expect(route(event)).resolves.toBeNull()
      }
    )

    it.each(cases)(
      'lets a failure from the handler behind %s through rather than converting it',
      async (_label, route, handler) => {
        expect.assertions(1)
        const failure = Object.assign(new Error('Not Found'), { statusCode: 404 })
        handler.mockRejectedValue(failure)

        await expect(route(event)).rejects.toBe(failure)
      }
    )

    it.each(cases)(
      'preserves the exact status of a 413 from the handler behind %s',
      async (_label, route, handler) => {
        expect.assertions(2)
        const failure = Object.assign(new Error('too-large'), { statusCode: 413 })
        handler.mockRejectedValue(failure)

        const rejection = await route(event).then(
          () => null,
          (error: unknown) => error as { statusCode: number }
        )

        expect(rejection?.statusCode).toBe(413)
        expect(rejection).toBe(failure)
      }
    )
  })
})
