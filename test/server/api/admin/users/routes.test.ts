import type { Mock } from 'vitest'
import type { z } from 'zod'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'

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
} from '../../../../fixtures/thinRouteHarness'

// The four thin route files under server/api/admin/users/, covered in one suite because they make
// the same three decisions and one of those decisions is only meaningful across the set: all four
// must register through defineAdminEventHandler and none of them through the merely-authenticated
// wrapper. Asserting that per file leaves the reader counting four files to know the set is closed,
// so the count and the absence are asserted here once over the whole directory.
//
// What is real and what is replaced is described in test/fixtures/thinRouteHarness.ts. The short
// version: the admin wrapper, the schemas and sendZodError are the shipped ones, Nitro's own helpers
// are stand-ins, and each handler module is mocked so no database is reached.

const handlers = vi.hoisted(() => ({
  // Default implementations, restored by resetRouteHarness's mockReset in beforeEach. Each answer is
  // named so an assertion reading one back cannot be mistaken for one reading a value some earlier
  // test left behind.
  deactivateUser: vi.fn(async () => ({ __defaultHandlerAnswer: 'deactivate' }) as unknown),
  inviteUser: vi.fn(async () => ({ __defaultHandlerAnswer: 'invite' }) as unknown),
  listUsers: vi.fn(async () => ({ __defaultHandlerAnswer: 'list' }) as unknown),
  reactivateUser: vi.fn(async () => ({ __defaultHandlerAnswer: 'reactivate' }) as unknown)
}))

vi.mock('~~/server/api/admin/users/handlers/deactivate', () => ({
  deactivateUser: handlers.deactivateUser
}))
vi.mock('~~/server/api/admin/users/handlers/invite', () => ({ inviteUser: handlers.inviteUser }))
vi.mock('~~/server/api/admin/users/handlers/list', () => ({ listUsers: handlers.listUsers }))
vi.mock('~~/server/api/admin/users/handlers/reactivate', () => ({
  reactivateUser: handlers.reactivateUser
}))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('an admin users route must not reach the database')
  }
}))

const { DeactivateSchema, InviteSchema, ListQuerySchema, ReactivateSchema } =
  await import('~~/server/models/admin')
const { FORM_LEVEL_KEY } = await import('~~/server/utils/sendZodError')
const { SORT_COLUMNS, SORT_ORDERS } = await import('~~/server/utils/manage-users')

const deactivateRoute = await import('~~/server/api/admin/users/deactivate.post')
const listRoute = await import('~~/server/api/admin/users/index.get')
const inviteRoute = await import('~~/server/api/admin/users/invite.post')
const reactivateRoute = await import('~~/server/api/admin/users/reactivate.post')

type RouteFn = (event: unknown) => Promise<unknown>

const event = { __event: 'admin-users' } as never

const ADMIN = { email: 'admin@example.com', id: 'admin-id', role: 'admin' as string | undefined }

// Where each route reads its untrusted input from. The three POSTs read the body, the list endpoint
// reads the query string, and asserting the unused reader stayed idle is what pins that: a GET that
// read the body would still answer correctly to a well-formed request and be wrong.
type Reader = 'body' | 'query'

type RouteCase = {
  handler: Mock
  // A raw input the shipped schema refuses, and the field key its 422 must be filed under.
  invalid: [input: unknown, field: string]
  label: string
  reader: Reader
  route: RouteFn
  schema: z.ZodType
  // A raw input the shipped schema accepts.
  valid: unknown
}

const cases: RouteCase[] = [
  {
    handler: handlers.deactivateUser,
    invalid: [{ email: 'not-an-email' }, 'email'],
    label: 'POST /api/admin/users/deactivate',
    reader: 'body',
    route: deactivateRoute.default as RouteFn,
    schema: DeactivateSchema,
    valid: { email: 'target@example.com' }
  },
  {
    handler: handlers.inviteUser,
    invalid: [{ email: 'not-an-email' }, 'email'],
    label: 'POST /api/admin/users/invite',
    reader: 'body',
    route: inviteRoute.default as RouteFn,
    schema: InviteSchema,
    valid: { email: 'target@example.com' }
  },
  {
    handler: handlers.reactivateUser,
    invalid: [{ email: 'not-an-email' }, 'email'],
    label: 'POST /api/admin/users/reactivate',
    reader: 'body',
    route: reactivateRoute.default as RouteFn,
    schema: ReactivateSchema,
    valid: { email: 'target@example.com' }
  },
  {
    handler: handlers.listUsers,
    invalid: [{ page: '0' }, 'page'],
    label: 'GET /api/admin/users',
    reader: 'query',
    route: listRoute.default as RouteFn,
    schema: ListQuerySchema,
    valid: {}
  }
]

let recorder: NitroRecorder

function call(route: RouteFn, reader: Reader, input: unknown) {
  requestInput[reader] = input
  return route(event)
}

function readerMock(reader: Reader) {
  return reader === 'body' ? readValidatedBodyMock : getValidatedQueryMock
}

function unusedReaderMock(reader: Reader) {
  return reader === 'body' ? getValidatedQueryMock : readValidatedBodyMock
}

beforeEach(() => {
  recorder = resetRouteHarness()
  recorder.setSession({ ...ADMIN })
  // mockReset restores the implementation each handler mock was created with and clears the
  // recorded calls, so an assertion about a call count can never read one an earlier test left.
  for (const handler of Object.values(handlers)) handler.mockReset()
})

describe('the admin users routes', () => {
  describe('registration: the admin gate, not merely a session', () => {
    it.each(cases.map((entry) => [entry.label, entry.route] as const))(
      'registers %s through defineAdminEventHandler',
      (_label, route) => {
        expect(registeringWrapper(route)).toBe('admin')
      }
    )

    it('registers no admin route through the merely-authenticated wrapper', () => {
      // The criterion, and the reason these four share a suite. defineAuthenticatedEventHandler
      // enforces a session and nothing else, so a route moved onto it would still answer 200 to the
      // admin who tests it and 200 to every signed-in user as well.
      expect(defineAuthenticatedEventHandlerMock).not.toHaveBeenCalled()
    })

    it('registers exactly the four routes in the directory through the admin wrapper', () => {
      expect(defineAdminEventHandlerMock).toHaveBeenCalledTimes(4)
      expect(defineAdminEventHandlerMock).toHaveBeenCalledWith(expect.any(Function))
    })

    it('registers with Nitro once per route, through the wrapper rather than directly', () => {
      // The shipped wrapper calls defineEventHandler itself, so four registrations are expected and
      // all four are the wrapper's. The inner function each route wrote is never the one handed to
      // Nitro, which is what distinguishes a wrapped route from a bare one.
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(4)
      for (const [handler] of defineAdminEventHandlerMock.mock.calls) {
        expect(defineEventHandlerMock.mock.calls.map(([given]) => given)).not.toContain(handler)
      }
    })

    it.each(cases.map((entry) => [entry.label, entry.route] as const))(
      'exports the handler the admin wrapper produced for %s',
      (_label, route) => {
        expect(defineAdminEventHandlerMock.mock.results.map((result) => result.value)).toContain(
          route
        )
      }
    )
  })

  describe('the gate runs before any input is read', () => {
    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'rejects a request carrying no session to %s with 401',
      async (_label, entry) => {
        expect.assertions(1)
        recorder.setSession(null)

        await expect(call(entry.route, entry.reader, entry.valid)).rejects.toMatchObject({
          statusCode: 401
        })
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'rejects an authenticated non-admin on %s with 403',
      async (_label, entry) => {
        expect.assertions(1)
        recorder.setSession({ ...ADMIN, role: 'user' })

        await expect(call(entry.route, entry.reader, entry.valid)).rejects.toMatchObject({
          statusCode: 403
        })
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'rejects a session carrying no role at all on %s with 403',
      async (_label, entry) => {
        expect.assertions(1)
        recorder.setSession({ email: ADMIN.email, id: ADMIN.id })

        await expect(call(entry.route, entry.reader, entry.valid)).rejects.toMatchObject({
          statusCode: 403
        })
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'validates nothing and calls no handler on %s for a refused request',
      async (_label, entry) => {
        expect.assertions(3)
        recorder.setSession({ ...ADMIN, role: 'user' })

        await expect(call(entry.route, entry.reader, entry.valid)).rejects.toMatchObject({
          statusCode: 403
        })
        expect(readerMock(entry.reader)).not.toHaveBeenCalled()
        expect(entry.handler).not.toHaveBeenCalled()
      }
    )
  })

  describe('validation: each route checks its own input against its own schema', () => {
    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'validates %s through the schema the route declares and not another validator',
      async (_label, entry) => {
        await call(entry.route, entry.reader, entry.valid)

        expect(readerMock(entry.reader)).toHaveBeenCalledTimes(1)
        expect(readerMock(entry.reader).mock.calls[0]?.[1]).toBe(entry.schema.safeParse)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'hands the reader on %s the event it was invoked with',
      async (_label, entry) => {
        await call(entry.route, entry.reader, entry.valid)

        expect(readerMock(entry.reader).mock.calls[0]?.[0]).toBe(event)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'reads only the request part %s is documented to read',
      async (_label, entry) => {
        await call(entry.route, entry.reader, entry.valid)

        expect(unusedReaderMock(entry.reader)).not.toHaveBeenCalled()
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'answers 422 on the field the shipped schema names for a malformed request to %s',
      async (_label, entry) => {
        expect.assertions(2)
        const [input, field] = entry.invalid

        const rejection = await rejectionOf(call(entry.route, entry.reader, input))

        expect(rejection?.statusCode).toBe(422)
        expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'never calls the handler behind %s when the input is malformed',
      async (_label, entry) => {
        expect.assertions(2)

        await expect(call(entry.route, entry.reader, entry.invalid[0])).rejects.toMatchObject({
          statusCode: 422
        })
        // The half that matters. A route that reported the failure and then called the handler
        // anyway would still answer 422 to the client while having already run the write.
        expect(entry.handler).not.toHaveBeenCalled()
      }
    )
  })

  describe('a valid request reaches its handler and its answer comes back unchanged', () => {
    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'returns the answer of the handler behind %s unchanged',
      async (_label, entry) => {
        const answer = { __thisExactAnswer: entry.label }
        entry.handler.mockResolvedValue(answer)

        await expect(call(entry.route, entry.reader, entry.valid)).resolves.toBe(answer)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'lets a failure from the handler behind %s through rather than converting it',
      async (_label, entry) => {
        expect.assertions(1)
        const failure = Object.assign(new Error('Conflict'), { statusCode: 409 })
        entry.handler.mockRejectedValue(failure)

        await expect(call(entry.route, entry.reader, entry.valid)).rejects.toBe(failure)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'calls the handler behind %s exactly once',
      async (_label, entry) => {
        await call(entry.route, entry.reader, entry.valid)

        expect(entry.handler).toHaveBeenCalledTimes(1)
      }
    )
  })

  describe('POST /api/admin/users/invite', () => {
    it('hands the handler the normalized email rather than the raw body', async () => {
      const raw = { email: '  TARGET@Example.COM  ' }

      await call(inviteRoute.default as RouteFn, 'body', raw)

      // emailSchema trims and lowercases before validating, so the allowlist key written here is the
      // key the magic-link lookup reads later. Forwarding the raw body would store the padded,
      // mixed-case address and the two would never match again.
      expect(handlers.inviteUser).toHaveBeenCalledWith({ email: 'target@example.com' })
      expect(handlers.inviteUser.mock.calls[0]?.[0]).not.toBe(raw)
    })

    it('drops a key the schema does not declare instead of forwarding it', async () => {
      await call(inviteRoute.default as RouteFn, 'body', {
        email: 'target@example.com',
        role: 'admin'
      })

      // InviteSchema declares one field, so the schema's product carries one field. A route
      // forwarding the raw body would hand the handler a role the requester chose.
      expect(Object.keys(handlers.inviteUser.mock.calls[0]?.[0] as object)).toStrictEqual(['email'])
    })

    it('is called with the parsed body alone, the handler taking no event', async () => {
      await call(inviteRoute.default as RouteFn, 'body', { email: 'target@example.com' })

      expect(handlers.inviteUser.mock.calls[0]).toHaveLength(1)
    })

    it.each([
      ['a string that is not an address', 'not-an-email'],
      ['an empty string', ''],
      ['nothing but whitespace', '   '],
      ['an address with no domain', 'target@'],
      ['an address with no local part', '@example.com']
    ])('answers 422 keyed on email for %s', async (_label, email) => {
      expect.assertions(2)

      const rejection = await rejectionOf(call(inviteRoute.default as RouteFn, 'body', { email }))

      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        email: issueMessage(InviteSchema, { email }, 'email')
      })
    })

    it.each([
      ['an absent email', {}],
      ['a non-string email', { email: 42 }],
      ['a null email', { email: null }],
      ['a repeated email arriving as an array', { email: ['a@example.com', 'b@example.com'] }]
    ])('answers 422 keyed on email for %s', async (_label, body) => {
      expect.assertions(3)

      const rejection = await rejectionOf(call(inviteRoute.default as RouteFn, 'body', body))

      expect(rejection?.statusCode).toBe(422)
      // The message for a non-string is Zod's own rather than the address check's, so the field key
      // is what is pinned. A form-level key here would mean the client had no input to attach it to.
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['email'])
      expect(rejection?.data).not.toHaveProperty(FORM_LEVEL_KEY)
    })
  })

  describe('POST /api/admin/users/deactivate', () => {
    it('passes the acting admin email from the session, not from the body', async () => {
      recorder.setSession({ ...ADMIN, email: 'first.admin@example.com' })

      await call(deactivateRoute.default as RouteFn, 'body', {
        email: 'target@example.com',
        sessionEmail: 'spoofed@example.com'
      })

      // The second argument is what lets the handler refuse self-deactivation with a 409. Reading it
      // from the body would let an admin deactivate themselves by naming somebody else, which is the
      // one thing that argument exists to prevent.
      expect(handlers.deactivateUser).toHaveBeenCalledWith(
        { email: 'target@example.com' },
        'first.admin@example.com'
      )
    })

    it('tracks the session it is given rather than a fixed address', async () => {
      recorder.setSession({ ...ADMIN, email: 'second.admin@example.com' })

      await call(deactivateRoute.default as RouteFn, 'body', { email: 'target@example.com' })

      expect(handlers.deactivateUser.mock.calls[0]?.[1]).toBe('second.admin@example.com')
    })

    it('hands the handler the normalized email rather than the raw body', async () => {
      await call(deactivateRoute.default as RouteFn, 'body', { email: '  TARGET@Example.COM  ' })

      expect(handlers.deactivateUser.mock.calls[0]?.[0]).toStrictEqual({
        email: 'target@example.com'
      })
    })

    it('answers 422 and reads no session email when the address is malformed', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(
        call(deactivateRoute.default as RouteFn, 'body', { email: 'not-an-email' })
      )

      expect(rejection?.statusCode).toBe(422)
      expect(handlers.deactivateUser).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/admin/users/reactivate', () => {
    it('hands the handler the normalized email rather than the raw body', async () => {
      await call(reactivateRoute.default as RouteFn, 'body', { email: '  TARGET@Example.COM  ' })

      expect(handlers.reactivateUser).toHaveBeenCalledWith({ email: 'target@example.com' })
      expect(handlers.reactivateUser.mock.calls[0]).toHaveLength(1)
    })

    it('answers 422 keyed on email for an address the schema refuses', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(
        call(reactivateRoute.default as RouteFn, 'body', { email: 'not-an-email' })
      )

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['email'])
    })
  })

  describe('GET /api/admin/users', () => {
    it('hands the handler the schema defaults for an empty query', async () => {
      const raw = {}

      await call(listRoute.default as RouteFn, 'query', raw)

      // Every field of ListQuerySchema has a default, so the schema's product for an empty query is
      // a fully resolved page request. Forwarding the raw query would hand the handler nothing and
      // move the page-size decision into the handler, or into the database.
      expect(handlers.listUsers).toHaveBeenCalledWith({
        order: 'desc',
        page: 1,
        pageSize: 12,
        sort: 'date'
      })
      expect(handlers.listUsers.mock.calls[0]?.[0]).not.toBe(raw)
    })

    it('hands the handler coerced numbers rather than the query strings', async () => {
      await call(listRoute.default as RouteFn, 'query', { page: '3', pageSize: '25' })
      const handed = handlers.listUsers.mock.calls[0]?.[0] as { page: unknown; pageSize: unknown }

      expect(handed.page).toBe(3)
      expect(handed.pageSize).toBe(25)
      expect(typeof handed.page).toBe('number')
    })

    it('hands the handler the trimmed search term', async () => {
      await call(listRoute.default as RouteFn, 'query', { search: '  ada  ' })

      expect(handlers.listUsers.mock.calls[0]?.[0]).toMatchObject({ search: 'ada' })
    })

    it('drops a query parameter the schema does not declare', async () => {
      await call(listRoute.default as RouteFn, 'query', { cursor: 'abc', page: '2' })

      expect(Object.keys(handlers.listUsers.mock.calls[0]?.[0] as object).sort()).toStrictEqual([
        'order',
        'page',
        'pageSize',
        'sort'
      ])
    })

    it('is called with the parsed query alone, the handler taking no event', async () => {
      await call(listRoute.default as RouteFn, 'query', {})

      expect(handlers.listUsers.mock.calls[0]).toHaveLength(1)
    })

    it.each([
      ['a page below one', { page: '0' }, 'page'],
      ['a negative page', { page: '-1' }, 'page'],
      ['a non-numeric page', { page: 'abc' }, 'page'],
      ['a fractional page', { page: '1.5' }, 'page'],
      ['a page size below one', { pageSize: '0' }, 'pageSize'],
      ['a page size past the cap', { pageSize: '101' }, 'pageSize'],
      ['a sort column outside the whitelist', { sort: 'passwordHash' }, 'sort'],
      ['an order outside the whitelist', { order: 'random' }, 'order'],
      ['a search term past its cap', { search: 'a'.repeat(201) }, 'search']
    ])('answers 422 keyed on %s', async (_label, query, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(call(listRoute.default as RouteFn, 'query', query))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(handlers.listUsers).not.toHaveBeenCalled()
    })

    it.each([...SORT_COLUMNS])('accepts %s as a sort column', async (sort) => {
      await call(listRoute.default as RouteFn, 'query', { sort })

      expect(handlers.listUsers.mock.calls[0]?.[0]).toMatchObject({ sort })
    })

    it.each([...SORT_ORDERS])('accepts %s as a sort order', async (order) => {
      await call(listRoute.default as RouteFn, 'query', { order })

      expect(handlers.listUsers.mock.calls[0]?.[0]).toMatchObject({ order })
    })

    it('reports every malformed parameter in one answer', async () => {
      expect.assertions(1)

      const rejection = await rejectionOf(
        call(listRoute.default as RouteFn, 'query', { order: 'random', page: '0' })
      )

      expect(Object.keys(rejection?.data ?? {}).sort()).toStrictEqual(['order', 'page'])
    })
  })
})
