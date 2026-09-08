import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../helpers/nitroGlobals'

import {
  defineAdminEventHandlerMock,
  defineAuthenticatedEventHandlerMock,
  defineEventHandlerMock,
  getValidatedQueryMock,
  getValidatedRouterParamsMock,
  issueMessage,
  readValidatedBodyMock,
  registeringWrapper,
  rejectionOf,
  requestInput,
  resetRouteHarness,
  setResponseStatusMock
} from '../../../fixtures/thinRouteHarness'

// The four thin route files under server/api/tasks/, covered in one suite because they are the CRUD
// surface of one resource and the decisions only make sense read together: which of the body, the
// query and the route parameter each verb reads, and in what order the two-input verb reads them.
//
// Three properties here are worth more than the rest.
//
//   The id on [id].patch and [id].delete travels in the path and nowhere else. The route validates
//   it as untrusted input and passes the parsed string down, so a malformed id fails at the boundary
//   instead of reaching the database, and the body has no id field for a client to disagree with.
//
//   [id].patch validates the path parameter before the body. A bad id must not cost a body parse,
//   and the observable half of that is readValidatedBody never being called at all.
//
//   index.post sets 201 after the handler returns and never before. A failed create has to report
//   its own status rather than a 201 the write never earned.
//
// What each handler writes, and every rule about ownership, splitting and the derived status, is
// settled in the suites under handlers/. What is real and what is replaced here is described in
// test/fixtures/thinRouteHarness.ts.

const handlers = vi.hoisted(() => ({
  createTask: vi.fn(async () => ({ __defaultHandlerAnswer: 'create' }) as unknown),
  listTasks: vi.fn(async () => ({ __defaultHandlerAnswer: 'list' }) as unknown),
  removeTask: vi.fn(async () => ({ __defaultHandlerAnswer: 'remove' }) as unknown),
  updateTask: vi.fn(async () => ({ __defaultHandlerAnswer: 'update' }) as unknown)
}))

vi.mock('~~/server/api/tasks/handlers/create', () => ({ createTask: handlers.createTask }))
vi.mock('~~/server/api/tasks/handlers/list', () => ({ listTasks: handlers.listTasks }))
vi.mock('~~/server/api/tasks/handlers/remove', () => ({ removeTask: handlers.removeTask }))
vi.mock('~~/server/api/tasks/handlers/update', () => ({ updateTask: handlers.updateTask }))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('a tasks route must not reach the database')
  }
}))

const {
  MAX_RANGE_DAYS,
  TaskCreateSchema,
  TaskIdParamSchema,
  TaskListQuerySchema,
  TaskUpdateSchema
} = await import('~~/server/models/tasks')
const { FORM_LEVEL_KEY } = await import('~~/server/utils/sendZodError')
const { DEFAULT_CATEGORY_ID } = await import('#shared/categories')
const { TASK_STATUSES } = await import('#shared/planning')

const deleteRoute = await import('~~/server/api/tasks/[id].delete')
const patchRoute = await import('~~/server/api/tasks/[id].patch')
const listRoute = await import('~~/server/api/tasks/index.get')
const createRoute = await import('~~/server/api/tasks/index.post')

type RouteFn = (event: unknown) => Promise<unknown>

const event = { __event: 'tasks' } as never

const OWNER = { email: 'owner@example.com', id: 'owner-id', role: 'user' }

const TASK_ID = 'a5a19d5c-1f0e-4a3d-9d4a-9e0b8f1c2d3e'

const routes: [label: string, route: RouteFn][] = [
  ['DELETE /api/tasks/[id]', deleteRoute.default as RouteFn],
  ['PATCH /api/tasks/[id]', patchRoute.default as RouteFn],
  ['GET /api/tasks', listRoute.default as RouteFn],
  ['POST /api/tasks', createRoute.default as RouteFn]
]

// A well-formed request for each route, so the wrapper criteria can be asserted over all four
// without each one needing its own call site.
const requests: [label: string, route: RouteFn, prepare: () => void, handler: () => unknown][] = [
  [
    'DELETE /api/tasks/[id]',
    deleteRoute.default as RouteFn,
    () => {
      requestInput.params = { id: TASK_ID }
    },
    () => handlers.removeTask
  ],
  [
    'PATCH /api/tasks/[id]',
    patchRoute.default as RouteFn,
    () => {
      requestInput.body = { status: TASK_STATUSES[0] }
      requestInput.params = { id: TASK_ID }
    },
    () => handlers.updateTask
  ],
  [
    'GET /api/tasks',
    listRoute.default as RouteFn,
    () => {
      requestInput.query = { from: '2026-09-01', to: '2026-09-07' }
    },
    () => handlers.listTasks
  ],
  [
    'POST /api/tasks',
    createRoute.default as RouteFn,
    () => {
      requestInput.body = { date: '2026-09-09' }
    },
    () => handlers.createTask
  ]
]

let recorder: NitroRecorder

function callList(query: unknown) {
  requestInput.query = query
  return (listRoute.default as RouteFn)(event)
}

function callCreate(body: unknown) {
  requestInput.body = body
  return (createRoute.default as RouteFn)(event)
}

function callPatch(params: unknown, body: unknown) {
  requestInput.body = body
  requestInput.params = params
  return (patchRoute.default as RouteFn)(event)
}

function callDelete(params: unknown) {
  requestInput.params = params
  return (deleteRoute.default as RouteFn)(event)
}

beforeEach(() => {
  recorder = resetRouteHarness()
  recorder.setSession({ ...OWNER })
  for (const handler of Object.values(handlers)) handler.mockReset()
})

describe('the tasks routes', () => {
  describe('registration: the session is enforced by the authenticated wrapper', () => {
    it.each(routes)('registers %s through defineAuthenticatedEventHandler', (_label, route) => {
      expect(registeringWrapper(route)).toBe('authenticated')
    })

    it('registers no task route through the admin wrapper', () => {
      // A task belongs to the user who wrote it, not to an administrator, so the admin gate here
      // would lock every user out of their own planning.
      expect(defineAdminEventHandlerMock).not.toHaveBeenCalled()
    })

    it('registers exactly the four routes in the directory through the wrapper', () => {
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledTimes(4)
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledWith(expect.any(Function))
    })

    it('registers with Nitro once per route, through the wrapper rather than directly', () => {
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(4)
      for (const [handler] of defineAuthenticatedEventHandlerMock.mock.calls) {
        expect(defineEventHandlerMock.mock.calls.map(([given]) => given)).not.toContain(handler)
      }
    })

    it.each(routes)('exports the handler the wrapper produced for %s', (_label, route) => {
      expect(
        defineAuthenticatedEventHandlerMock.mock.results.map((result) => result.value)
      ).toContain(route)
    })

    it.each(requests)(
      'rejects a request to %s carrying no session with 401',
      async (_label, route, prepare) => {
        expect.assertions(1)
        recorder.setSession(null)
        prepare()

        await expect(route(event)).rejects.toMatchObject({ statusCode: 401 })
      }
    )

    it.each(requests)(
      'validates nothing and calls no handler on %s for a request carrying no session',
      async (_label, route, prepare, handler) => {
        expect.assertions(5)
        recorder.setSession(null)
        prepare()

        await expect(route(event)).rejects.toMatchObject({ statusCode: 401 })
        expect(readValidatedBodyMock).not.toHaveBeenCalled()
        expect(getValidatedQueryMock).not.toHaveBeenCalled()
        expect(getValidatedRouterParamsMock).not.toHaveBeenCalled()
        expect(handler()).not.toHaveBeenCalled()
      }
    )
  })

  describe('GET /api/tasks', () => {
    it('validates the query through TaskListQuerySchema.safeParse and not another validator', async () => {
      await callList({ from: '2026-09-01', to: '2026-09-07' })

      expect(getValidatedQueryMock).toHaveBeenCalledTimes(1)
      expect(getValidatedQueryMock.mock.calls[0]?.[1]).toBe(TaskListQuerySchema.safeParse)
      expect(getValidatedQueryMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('reads the query string alone, never the body or a route parameter', async () => {
      requestInput.body = { from: '2000-01-01', to: '2000-01-02' }
      requestInput.params = { id: TASK_ID }

      await callList({ from: '2026-09-01', to: '2026-09-07' })

      expect(readValidatedBodyMock).not.toHaveBeenCalled()
      expect(getValidatedRouterParamsMock).not.toHaveBeenCalled()
    })

    it('calls listTasks once with the event and the parsed range', async () => {
      await callList({ from: '2026-09-01', to: '2026-09-07' })

      expect(handlers.listTasks).toHaveBeenCalledTimes(1)
      expect(handlers.listTasks).toHaveBeenCalledWith(event, {
        from: '2026-09-01',
        to: '2026-09-07'
      })
      expect(handlers.listTasks.mock.calls[0]).toHaveLength(2)
    })

    it('hands the handler the parsed range rather than the raw query object', async () => {
      const raw = { from: '2026-09-01', page: '2', to: '2026-09-07' }

      await callList(raw)
      const handed = handlers.listTasks.mock.calls[0]?.[1] as Record<string, unknown>

      // TaskListQuerySchema declares two fields and is not strict, so the schema's product drops
      // page. Forwarding the raw query would carry it through, and the identity check is what
      // separates the parsed value from one that merely looks like it.
      expect(Object.keys(handed).sort()).toStrictEqual(['from', 'to'])
      expect(handed).not.toBe(raw)
    })

    it('accepts a single-day range where both ends are equal', async () => {
      await callList({ from: '2026-09-09', to: '2026-09-09' })

      expect(handlers.listTasks).toHaveBeenCalledWith(event, {
        from: '2026-09-09',
        to: '2026-09-09'
      })
    })

    it(`accepts a range of exactly ${MAX_RANGE_DAYS} days`, async () => {
      // 2026-01-01 to 2027-01-01 inclusive is 366 days, the cap itself, which must be admitted.
      await callList({ from: '2026-01-01', to: '2027-01-01' })

      expect(handlers.listTasks).toHaveBeenCalledTimes(1)
    })

    it(`answers 422 keyed on to for a range one day past ${MAX_RANGE_DAYS}`, async () => {
      expect.assertions(3)
      const query = { from: '2026-01-01', to: '2027-01-02' }

      const rejection = await rejectionOf(callList(query))

      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        to: issueMessage(TaskListQuerySchema, query, 'to')
      })
      expect(handlers.listTasks).not.toHaveBeenCalled()
    })

    it('answers 422 keyed on to for an inverted range', async () => {
      expect.assertions(3)
      const query = { from: '2026-09-07', to: '2026-09-01' }

      const rejection = await rejectionOf(callList(query))

      // The message is attached to `to` rather than to the body, so the client can point at the end
      // of the range the user just moved.
      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        to: issueMessage(TaskListQuerySchema, query, 'to')
      })
      expect(handlers.listTasks).not.toHaveBeenCalled()
    })

    it.each([
      ['a day that does not exist in the month', { from: '2026-02-30', to: '2026-03-01' }, 'from'],
      ['a shape that is not YYYY-MM-DD', { from: '01-09-2026', to: '2026-09-07' }, 'from'],
      ['a month past twelve', { from: '2026-13-01', to: '2026-09-07' }, 'from'],
      ['an empty from', { from: '', to: '2026-09-07' }, 'from'],
      ['a datetime rather than a day', { from: '2026-09-01T00:00:00Z', to: '2026-09-07' }, 'from']
    ])('answers 422 naming the malformed end for %s', async (_label, query, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callList(query))

      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toHaveProperty(field, issueMessage(TaskListQuerySchema, query, field))
      expect(handlers.listTasks).not.toHaveBeenCalled()
    })

    it('answers 422 keyed on to for a malformed end of the range', async () => {
      expect.assertions(3)

      const rejection = await rejectionOf(callList({ from: '2026-09-01', to: 'tomorrow' }))

      // Only the key is pinned, not the message. `data` has one slot per key and keeps the last
      // message, and the bogus span issue described below arrives after the calendar-day one, so the
      // client is currently told a range it never asked for is too wide. The route's own duty, a 422
      // naming `to` and no read, is what is asserted here.
      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['to'])
      expect(handlers.listTasks).not.toHaveBeenCalled()
    })

    // The whole key set is pinned only for the malformed shapes where the shipped schema reports one
    // issue per malformed field and nothing else. It is deliberately not pinned for a malformed
    // calendar day, because the shipped behaviour there does not match what the model claims: the
    // header of TaskListQuerySchema says "the object-level refinements run only after both fields
    // are valid calendar days", and they do not. A `from` of '01-09-2026' fails calendarDaySchema
    // and both range refinements still run, so the span check divides on a NaN and files a second
    // message under `to` about a range the user never asked for. The status is still 422 and the
    // read still never happens, which is what the routes above are held to, so this is a message
    // quality problem in the model rather than a route failure. Asserting the extra `to` key here
    // would lock in behaviour the model documents as impossible; the fix and its test belong with
    // the schema in test/server/models/tasks.test.ts.
    it.each([
      ['an absent to', { from: '2026-09-01' }, ['to']],
      ['a non-string to', { from: '2026-09-01', to: 42 }, ['to']],
      ['both ends absent', {}, ['from', 'to']]
    ])('answers 422 on exactly the malformed fields for %s', async (_label, query, fields) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callList(query))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {}).sort()).toStrictEqual(fields)
      expect(handlers.listTasks).not.toHaveBeenCalled()
    })

    it('returns the handler answer unchanged', async () => {
      const answer = [{ id: TASK_ID }]
      handlers.listTasks.mockResolvedValue(answer)

      await expect(callList({ from: '2026-09-01', to: '2026-09-07' })).resolves.toBe(answer)
    })

    it('lets a handler failure through rather than converting it', async () => {
      expect.assertions(2)
      const failure = Object.assign(new Error('Service Unavailable'), { statusCode: 503 })
      handlers.listTasks.mockRejectedValue(failure)

      const rejection = await rejectionOf(callList({ from: '2026-09-01', to: '2026-09-07' }))

      expect(rejection?.statusCode).toBe(503)
      expect(rejection).toBe(failure)
    })
  })

  describe('POST /api/tasks', () => {
    it('validates the body through TaskCreateSchema.safeParse and not another validator', async () => {
      await callCreate({ date: '2026-09-09' })

      expect(readValidatedBodyMock).toHaveBeenCalledTimes(1)
      expect(readValidatedBodyMock.mock.calls[0]?.[1]).toBe(TaskCreateSchema.safeParse)
      expect(readValidatedBodyMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('reads the body alone, never the query string or a route parameter', async () => {
      requestInput.params = { id: TASK_ID }
      requestInput.query = { date: '2000-01-01' }

      await callCreate({ date: '2026-09-09' })

      expect(getValidatedQueryMock).not.toHaveBeenCalled()
      expect(getValidatedRouterParamsMock).not.toHaveBeenCalled()
    })

    it('hands the handler the default category the schema supplies', async () => {
      const raw = { date: '2026-09-09' }

      await callCreate(raw)
      const handed = handlers.createTask.mock.calls[0]?.[1] as Record<string, unknown>

      // The fallback category is declared on the schema and read from the shared contract, so the
      // route forwards a resolved category rather than an absent one. Forwarding the raw body would
      // move the decision into the write path or into a NOT NULL violation.
      expect(handed).toStrictEqual({ category: DEFAULT_CATEGORY_ID, date: '2026-09-09' })
      expect(handed).not.toBe(raw)
    })

    it('hands the handler the normalized free text rather than the raw body', async () => {
      await callCreate({
        client: '  Acme  ',
        date: '2026-09-09',
        notes: '   ',
        project: '  PRJ-1  '
      })

      // Trimmed, and an emptied value becomes null, so the column never holds a stored blank next
      // to a NULL meaning the same thing.
      expect(handlers.createTask.mock.calls[0]?.[1]).toStrictEqual({
        category: DEFAULT_CATEGORY_ID,
        client: 'Acme',
        date: '2026-09-09',
        notes: null,
        project: 'PRJ-1'
      })
    })

    it('sets the 201 after the handler has returned, never before', async () => {
      const order: string[] = []
      handlers.createTask.mockImplementation(async () => {
        order.push('createTask')
        return { id: TASK_ID }
      })
      setResponseStatusMock.mockImplementation(() => {
        order.push('setResponseStatus')
      })

      await callCreate({ date: '2026-09-09' })

      expect(order).toStrictEqual(['createTask', 'setResponseStatus'])
      expect(setResponseStatusMock).toHaveBeenCalledTimes(1)
      expect(setResponseStatusMock).toHaveBeenCalledWith(event, 201)
    })

    it('sets no status when the handler refuses the write', async () => {
      expect.assertions(3)
      const failure = Object.assign(new Error('Conflict'), { statusCode: 409 })
      handlers.createTask.mockRejectedValue(failure)

      const rejection = await rejectionOf(callCreate({ date: '2026-09-09' }))

      // A failed create must report its own code rather than a 201 the write never earned, and the
      // only reason that holds is the status being set after the await rather than before it.
      expect(rejection?.statusCode).toBe(409)
      expect(rejection).toBe(failure)
      expect(setResponseStatusMock).not.toHaveBeenCalled()
    })

    it('sets no status and writes nothing when the body is malformed', async () => {
      expect.assertions(3)

      await expect(callCreate({})).rejects.toMatchObject({ statusCode: 422 })
      expect(handlers.createTask).not.toHaveBeenCalled()
      expect(setResponseStatusMock).not.toHaveBeenCalled()
    })

    it('returns the created row unchanged', async () => {
      const created = { category: DEFAULT_CATEGORY_ID, id: TASK_ID }
      handlers.createTask.mockResolvedValue(created)

      await expect(callCreate({ date: '2026-09-09' })).resolves.toBe(created)
    })

    it.each([
      ['an absent date', {}, ['date']],
      ['a day that does not exist in the month', { date: '2026-02-30' }, ['date']],
      ['an explicitly null category', { category: null, date: '2026-09-09' }, ['category']],
      [
        'a category outside the contract',
        { category: 'invented', date: '2026-09-09' },
        ['category']
      ],
      ['a status outside the vocabulary', { date: '2026-09-09', status: 'N/A' }, ['status']],
      ['a clock time of 24:00', { date: '2026-09-09', deliveryTime: '24:00' }, ['deliveryTime']],
      ['a minute past 59', { date: '2026-09-09', deliveryTime: '12:60' }, ['deliveryTime']],
      [
        'a word count below zero',
        { date: '2026-09-09', projectWordCount: -1 },
        ['projectWordCount']
      ],
      [
        'a quota override of zero',
        { date: '2026-09-09', quotaWphOverride: 0 },
        ['quotaWphOverride']
      ],
      [
        'a number sent as a string',
        { date: '2026-09-09', projectWordCount: '12000' },
        ['projectWordCount']
      ],
      [
        'a boolean sent as a string',
        { date: '2026-09-09', excludeFromStats: 'true' },
        ['excludeFromStats']
      ],
      ['a client name past its cap', { client: 'a'.repeat(201), date: '2026-09-09' }, ['client']],
      ['a note past its cap', { date: '2026-09-09', notes: 'a'.repeat(2001) }, ['notes']]
    ])('answers 422 for %s', async (_label, body, fields) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callCreate(body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {}).sort()).toStrictEqual(fields)
      expect(handlers.createTask).not.toHaveBeenCalled()
    })

    it.each([
      ['a server-owned id', 'id'],
      ['an owning user', 'userId'],
      ['a sort position', 'sortOrder'],
      ['a split group', 'splitGroupId'],
      ['the dropped words-done column', 'wordsDone']
    ])('names %s in the answer rather than dropping it', async (_label, key) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callCreate({ [key]: 'anything', date: '2026-09-09' }))

      // TaskCreateSchema is strict, and sendZodError's unrecognized_keys branch files each rejected
      // key under its own name. A client that sent userId and got a 201 would have been told its
      // write succeeded as sent, which is false.
      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([key])
      expect(handlers.createTask).not.toHaveBeenCalled()
    })

    it('answers 422 for a body that is not an object at all', async () => {
      expect.assertions(3)

      const rejection = await rejectionOf(callCreate(undefined))

      expect(rejection?.statusCode).toBe(422)
      expect(handlers.createTask).not.toHaveBeenCalled()
      expect(setResponseStatusMock).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/tasks/[id]', () => {
    it('validates the route parameter through TaskIdParamSchema.safeParse', async () => {
      await callDelete({ id: TASK_ID })

      expect(getValidatedRouterParamsMock).toHaveBeenCalledTimes(1)
      expect(getValidatedRouterParamsMock.mock.calls[0]?.[1]).toBe(TaskIdParamSchema.safeParse)
      expect(getValidatedRouterParamsMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('reads the route parameter alone, never a body or the query string', async () => {
      requestInput.body = { id: 'someone-elses-task' }
      requestInput.query = { id: 'someone-elses-task' }

      await callDelete({ id: TASK_ID })

      // There is no body on this verb: the id in the path is the entire request.
      expect(readValidatedBodyMock).not.toHaveBeenCalled()
      expect(getValidatedQueryMock).not.toHaveBeenCalled()
    })

    it('passes the id from the path through to the handler as a string', async () => {
      await callDelete({ id: TASK_ID })

      // The parsed id, not the parameter object. A handler handed { id } would look up a task whose
      // primary key is an object and find nothing, every time.
      expect(handlers.removeTask).toHaveBeenCalledTimes(1)
      expect(handlers.removeTask).toHaveBeenCalledWith(event, TASK_ID)
      expect(handlers.removeTask.mock.calls[0]?.[1]).toBe(TASK_ID)
    })

    it('drops a parameter the schema does not declare', async () => {
      await callDelete({ id: TASK_ID, userId: 'someone-else' })

      expect(handlers.removeTask).toHaveBeenCalledWith(event, TASK_ID)
      expect(handlers.removeTask.mock.calls[0]).toHaveLength(2)
    })

    it('returns the handler answer unchanged', async () => {
      const answer = { result: 'deleted' }
      handlers.removeTask.mockResolvedValue(answer)

      await expect(callDelete({ id: TASK_ID })).resolves.toBe(answer)
    })

    it('lets the 404 for a task that is not the caller through unchanged', async () => {
      expect.assertions(2)
      const failure = Object.assign(new Error('Not Found'), { statusCode: 404 })
      handlers.removeTask.mockRejectedValue(failure)

      const rejection = await rejectionOf(callDelete({ id: TASK_ID }))

      expect(rejection?.statusCode).toBe(404)
      expect(rejection).toBe(failure)
    })

    it('answers 422 keyed on id for an empty id', async () => {
      expect.assertions(3)

      const rejection = await rejectionOf(callDelete({ id: '' }))

      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        id: issueMessage(TaskIdParamSchema, { id: '' }, 'id')
      })
      // The half that matters. A route that reported the failure and then called the handler anyway
      // would still answer 422 while having already attempted a delete on an unvalidated id.
      expect(handlers.removeTask).not.toHaveBeenCalled()
    })

    it.each([
      ['an absent id', {}],
      ['a non-string id', { id: 42 }],
      ['a null id', { id: null }]
    ])('answers 422 keyed on id for %s', async (_label, params) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callDelete(params))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['id'])
      expect(handlers.removeTask).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /api/tasks/[id]', () => {
    const PATCH = { status: TASK_STATUSES[0] }

    it('validates the route parameter and then the body, each against its own schema', async () => {
      await callPatch({ id: TASK_ID }, PATCH)

      expect(getValidatedRouterParamsMock).toHaveBeenCalledTimes(1)
      expect(getValidatedRouterParamsMock.mock.calls[0]?.[1]).toBe(TaskIdParamSchema.safeParse)
      expect(readValidatedBodyMock).toHaveBeenCalledTimes(1)
      expect(readValidatedBodyMock.mock.calls[0]?.[1]).toBe(TaskUpdateSchema.safeParse)
    })

    it('hands both readers the event it was invoked with', async () => {
      await callPatch({ id: TASK_ID }, PATCH)

      expect(getValidatedRouterParamsMock.mock.calls[0]?.[0]).toBe(event)
      expect(readValidatedBodyMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('never reads the query string', async () => {
      requestInput.query = { id: 'someone-elses-task' }

      await callPatch({ id: TASK_ID }, PATCH)

      expect(getValidatedQueryMock).not.toHaveBeenCalled()
    })

    it('calls updateTask once with the event, the path id and the parsed patch', async () => {
      await callPatch({ id: TASK_ID }, PATCH)

      expect(handlers.updateTask).toHaveBeenCalledTimes(1)
      expect(handlers.updateTask).toHaveBeenCalledWith(event, TASK_ID, PATCH)
      expect(handlers.updateTask.mock.calls[0]).toHaveLength(3)
    })

    it('passes the id from the path as a string, never the parameter object', async () => {
      await callPatch({ id: TASK_ID }, PATCH)

      expect(handlers.updateTask.mock.calls[0]?.[1]).toBe(TASK_ID)
    })

    it('hands the handler the normalized patch rather than the raw body', async () => {
      const raw = { client: '  Acme  ', notes: '   ' }

      await callPatch({ id: TASK_ID }, raw)
      const handed = handlers.updateTask.mock.calls[0]?.[2] as Record<string, unknown>

      // Trimmed, and an emptied value becomes null, which is the only way back from a wrong client
      // name to no client name at all.
      expect(handed).toStrictEqual({ client: 'Acme', notes: null })
      expect(handed).not.toBe(raw)
    })

    it('keeps an explicit null, which is the instruction to clear a column', async () => {
      await callPatch({ id: TASK_ID }, { actualMinutes: null })

      // An absent field leaves its column alone and an explicit null clears it, so a route that
      // stripped nulls would make a wrong measured duration permanent.
      expect(handlers.updateTask.mock.calls[0]?.[2]).toStrictEqual({ actualMinutes: null })
    })

    it('reads no body when the path id is malformed', async () => {
      expect.assertions(4)

      const rejection = await rejectionOf(callPatch({ id: '' }, PATCH))

      // The id is validated first because a path parameter is untrusted input like any other, and
      // the observable half of "first" is the body reader never running at all.
      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        id: issueMessage(TaskIdParamSchema, { id: '' }, 'id')
      })
      expect(readValidatedBodyMock).not.toHaveBeenCalled()
      expect(handlers.updateTask).not.toHaveBeenCalled()
    })

    it.each([
      ['an absent id', {}],
      ['a non-string id', { id: 42 }]
    ])('answers 422 keyed on id and reads no body for %s', async (_label, params) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callPatch(params, PATCH))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['id'])
      expect(readValidatedBodyMock).not.toHaveBeenCalled()
    })

    it('answers 422 under the form-level key for an empty patch', async () => {
      expect.assertions(4)

      const rejection = await rejectionOf(callPatch({ id: TASK_ID }, {}))

      // The refine reports against the body rather than a field, so sendZodError files it under the
      // form-level key. An empty patch used to answer 422 with an empty `data`, which is the
      // unactionable response that branch exists to prevent.
      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        [FORM_LEVEL_KEY]: issueMessage(TaskUpdateSchema, {})
      })
      expect(getValidatedRouterParamsMock).toHaveBeenCalledTimes(1)
      expect(handlers.updateTask).not.toHaveBeenCalled()
    })

    it('answers 422 for a patch whose only key is present but undefined', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(callPatch({ id: TASK_ID }, { client: undefined }))

      // Zod keeps a present-but-undefined optional key, so a key count would admit this body and
      // the write would degrade to a bare updatedAt bump. The refine reads the values instead.
      expect(rejection?.data).toStrictEqual({
        [FORM_LEVEL_KEY]: issueMessage(TaskUpdateSchema, { client: undefined })
      })
      expect(handlers.updateTask).not.toHaveBeenCalled()
    })

    it.each([
      ['a status outside the vocabulary', { status: 'N/A' }, ['status']],
      ['a day that does not exist in the month', { date: '2026-02-30' }, ['date']],
      ['a clock time of 24:00', { deliveryTime: '24:00' }, ['deliveryTime']],
      ['a quota override of zero', { quotaWphOverride: 0 }, ['quotaWphOverride']],
      ['a duration below zero', { actualMinutes: -1 }, ['actualMinutes']],
      ['a number sent as a string', { estimatedMinutes: '90' }, ['estimatedMinutes']],
      ['a null date against a NOT NULL column', { date: null }, ['date']],
      ['a null category against a NOT NULL column', { category: null }, ['category']]
    ])('answers 422 for %s', async (_label, body, fields) => {
      expect.assertions(3)

      const rejection = await rejectionOf(callPatch({ id: TASK_ID }, body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {}).sort()).toStrictEqual(fields)
      expect(handlers.updateTask).not.toHaveBeenCalled()
    })

    it('names an id in the body in the answer rather than dropping it', async () => {
      expect.assertions(3)

      const rejection = await rejectionOf(
        callPatch({ id: TASK_ID }, { id: 'someone-elses-task', status: TASK_STATUSES[0] })
      )

      // The id travels in the path and never in the body, so there is no second place it can appear
      // and no way for the two to disagree. The strict schema is what enforces that.
      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['id'])
      expect(handlers.updateTask).not.toHaveBeenCalled()
    })

    it.each([...TASK_STATUSES])('accepts %s as a stored status', async (status) => {
      await callPatch({ id: TASK_ID }, { status })

      expect(handlers.updateTask).toHaveBeenCalledWith(event, TASK_ID, { status })
    })

    it('returns the handler answer unchanged', async () => {
      const answer = { id: TASK_ID, status: TASK_STATUSES[2] }
      handlers.updateTask.mockResolvedValue(answer)

      await expect(callPatch({ id: TASK_ID }, PATCH)).resolves.toBe(answer)
    })

    it('lets the 404 for a task that is not the caller through unchanged', async () => {
      expect.assertions(2)
      const failure = Object.assign(new Error('Not Found'), { statusCode: 404 })
      handlers.updateTask.mockRejectedValue(failure)

      const rejection = await rejectionOf(callPatch({ id: TASK_ID }, PATCH))

      expect(rejection?.statusCode).toBe(404)
      expect(rejection).toBe(failure)
    })
  })
})
