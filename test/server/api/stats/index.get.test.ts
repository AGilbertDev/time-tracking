import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../helpers/nitroGlobals'

import { installNitroGlobals } from '../../../helpers/nitroGlobals'

// The route file server/api/stats/index.get.ts, the four executable lines behind GET /api/stats.
//
// WHY THIS ROUTE HAS A TEST WHEN THE OTHER TWENTY DO NOT, since this is the first one in the
// repository and the question is fair. Every route file here sits at zero coverage and none of them
// is listed in .github/test-exclusions.json, because the coverage gate only weighs the files a pull
// request changed, so an untouched route is never asked for a number. The exclusions file is where
// wiring with no logic of its own goes, and its own $comment draws the line: "Anything that makes a
// decision does not." This file makes exactly one decision, the branch between sendZodError and the
// handler, and it carries the one security property of the endpoint in the wrapper it registers
// through. Both are worth a test, so it earns one instead of an exemption. A route that only forwards
// to a handler and decides nothing still belongs in the exclusions file.
//
// What is real here and what is replaced, since a route test is one assertion away from being a test
// of its own mocks.
//
//   StatsQuerySchema and sendZodError are the shipped ones. Every code, field key and message
//   asserted below is the one production emits, so a test agreeing with the route about a message it
//   both wrote and read would be worth nothing.
//
//   defineAuthenticatedEventHandler is the shipped implementation from server/utils, wrapped in a spy
//   and put on the global that Nuxt's auto-import transform would otherwise provide. So the session
//   check that runs before the route body is the real one, and the spy still records that this route
//   registered through it.
//
//   defineEventHandler and getValidatedQuery are stand-ins, being Nitro's own. The getValidatedQuery
//   stand-in does what Nitro documents, handing the query to the validator it was given and returning
//   that validator's result, which is what lets the route be fed a raw query and observed deciding on
//   the real schema's verdict.
//
//   ./handlers/getStats is mocked, so the route is observed in isolation and no database is reached.
//   What getStats itself computes is settled in test/server/api/stats/handlers/getStats.test.ts
//   against a live in-memory database; nothing about the figures is decided here.
//
// server/db/index is mocked to a useDb that throws rather than left alone, so "the route touches no
// database" is enforced by the seam instead of assumed from the handler being mocked.

const { getStatsMock } = vi.hoisted(() => ({
  // The default implementation, restored by mockReset in beforeEach. Named so an assertion reading
  // this value back cannot be mistaken for one reading a value some earlier test left behind.
  getStatsMock: vi.fn(async () => ({ __defaultHandlerAnswer: true }) as unknown)
}))

vi.mock('~~/server/api/stats/handlers/getStats', () => ({ getStats: getStatsMock }))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('the stats route must not reach the database')
  }
}))

// The raw query the getValidatedQuery stand-in hands to the validator, standing in for the query
// string of the request under test.
const queryRef = { current: {} as unknown }

const getValidatedQueryMock = vi.fn(
  async (_event: unknown, validate: (query: unknown) => unknown) => validate(queryRef.current)
)

// Nitro's registration helper, replaced with the identity so the exported handler is the very
// function the shipped wrapper built and calling it runs that wrapper for real. It is spied rather
// than ignored because the count separates "registered through the authenticated wrapper" from
// "registered bare", the two producing the same exported shape.
const defineEventHandlerMock = vi.fn((handler: (event: unknown) => unknown) => handler)

const { defineAuthenticatedEventHandler } =
  await import('~~/server/utils/defineAuthenticatedEventHandler')
const { FORM_LEVEL_KEY } = await import('~~/server/utils/sendZodError')
const { StatsQuerySchema } = await import('~~/server/models/stats')

const defineAuthenticatedEventHandlerMock = vi.fn(defineAuthenticatedEventHandler)

// Both registration helpers have to be on the global before the route module is evaluated, because a
// route file calls its wrapper at module scope. installRouteGlobals is called again in beforeEach so
// nothing a later suite or a config change unstubs can leave the call-time helpers missing, and it
// only ever stubs the same instances, so the registration calls recorded at import time survive.
function installRouteGlobals() {
  vi.stubGlobal('defineEventHandler', defineEventHandlerMock)
  vi.stubGlobal('defineAuthenticatedEventHandler', defineAuthenticatedEventHandlerMock)
  vi.stubGlobal('getValidatedQuery', getValidatedQueryMock)
}

installRouteGlobals()

const route = await import('~~/server/api/stats/index.get')

// The message calendarDaySchema declares for a value that is not a real calendar day, and the one
// every string this endpoint refuses comes back with. Read from the shipped schema rather than
// copied, so a reworded message moves both sides at once and the assertions keep meaning "the route
// validated through this schema" instead of "the route produced this sentence".
const CALENDAR_DAY_MESSAGE = (() => {
  const result = StatsQuerySchema.safeParse({ date: 'not-a-day' })
  if (result.success) throw new Error('expected the shipped schema to refuse a non-date')
  return result.error.issues[0]?.message
})()

const event = { __event: true } as never

const OWNER = { email: 'owner@example.com', id: 'owner-id' }

let recorder: NitroRecorder

// The handler under test is the module's default export, invoked the way Nitro invokes it.
function callRoute(query: unknown) {
  queryRef.current = query
  return (route.default as (event: unknown) => Promise<unknown>)(event)
}

beforeEach(() => {
  recorder = installNitroGlobals()
  installRouteGlobals()
  recorder.setSession(OWNER)
  // mockReset restores the implementation each was created with and clears the recorded calls. The
  // two registration spies are deliberately left alone: their only calls happened when the route
  // module was evaluated, and clearing them would erase the evidence the registration criterion reads.
  getStatsMock.mockReset()
  getValidatedQueryMock.mockReset()
  queryRef.current = {}
})

describe('GET /api/stats route', () => {
  describe('registration: the session is enforced by the authenticated wrapper', () => {
    it('registers the route through defineAuthenticatedEventHandler', () => {
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledTimes(1)
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledWith(expect.any(Function))
    })

    it('exports the handler the authenticated wrapper produced', () => {
      expect(route.default).toBe(defineAuthenticatedEventHandlerMock.mock.results[0]?.value)
    })

    it('registers with Nitro once, through the wrapper rather than directly', () => {
      // The shipped wrapper calls defineEventHandler itself, so exactly one registration is expected
      // and it is the wrapper's. A route swapped to a bare defineEventHandler leaves this count at
      // one as well, which is why the spy above is the criterion and this is the corroboration.
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(1)
      expect(defineAuthenticatedEventHandlerMock.mock.calls[0]?.[0]).not.toBe(
        defineEventHandlerMock.mock.calls[0]?.[0]
      )
    })

    it('rejects a request carrying no session with 401', async () => {
      expect.assertions(1)
      recorder.setSession(null)

      await expect(callRoute({ date: '2026-09-09' })).rejects.toMatchObject({ statusCode: 401 })
    })

    it('validates nothing and calls no handler for a request carrying no session', async () => {
      expect.assertions(3)
      recorder.setSession(null)

      await expect(callRoute({ date: '2026-09-09' })).rejects.toThrow()
      expect(getValidatedQueryMock).not.toHaveBeenCalled()
      expect(getStatsMock).not.toHaveBeenCalled()
    })
  })

  describe('validation: the query is checked against StatsQuerySchema', () => {
    it('validates through StatsQuerySchema.safeParse and not another validator', async () => {
      await callRoute({ date: '2026-09-09' })

      expect(getValidatedQueryMock).toHaveBeenCalledTimes(1)
      expect(getValidatedQueryMock.mock.calls[0]?.[1]).toBe(StatsQuerySchema.safeParse)
    })

    it('hands getValidatedQuery the event it was invoked with', async () => {
      await callRoute({ date: '2026-09-09' })

      expect(getValidatedQueryMock.mock.calls[0]?.[0]).toBe(event)
    })

    it.each([
      ['a real day', { date: '2026-09-09' }],
      ['an absent date', {}],
      ['a day that passes the shape and is not real', { date: '2026-02-30' }],
      ['a non-string date', { date: 42 }],
      ['a repeated date parameter', { date: ['2026-09-09', '2026-09-10'] }],
      ['an unknown parameter', { date: '2026-09-09', page: '2' }]
    ])('agrees with the shipped schema about %s', async (_label, query) => {
      // The identity check above is the criterion; this is the behavioural half, in case the route
      // ever wraps the schema in something of its own. The validator probed is the one recorded from
      // the route's own call, never read out of the model module, and the malformed rows here reject,
      // which is not what is under test in this block.
      await callRoute(query).catch(() => undefined)
      const passed = getValidatedQueryMock.mock.calls[0]?.[1] as (query: unknown) => unknown

      expect(passed).toBeTypeOf('function')
      expect(passed(query)).toStrictEqual(StatsQuerySchema.safeParse(query))
    })
  })

  describe('a valid query reaches the handler', () => {
    it('calls getStats once with the event and the parsed query', async () => {
      await callRoute({ date: '2026-09-09' })

      expect(getStatsMock).toHaveBeenCalledTimes(1)
      expect(getStatsMock).toHaveBeenCalledWith(event, { date: '2026-09-09' })
    })

    it('hands the handler the parsed data rather than the raw query object', async () => {
      const raw = { date: '2026-09-09', page: '2' }

      await callRoute(raw)
      const handed = getStatsMock.mock.calls[0]?.[1] as Record<string, unknown>

      // StatsQuerySchema declares one field and is not strict, so the schema's product drops page.
      // Forwarding the raw query would carry it through, and the identity check is what separates
      // "the parsed value" from "a value that merely looks like it".
      expect(Object.keys(handed)).toStrictEqual(['date'])
      expect(handed).not.toBe(raw)
    })

    it('treats an absent date as valid and lets the handler resolve the anchor', async () => {
      await callRoute({})

      expect(getStatsMock).toHaveBeenCalledTimes(1)
      expect(getStatsMock).toHaveBeenCalledWith(event, {})
    })

    it('returns the handler answer unchanged', async () => {
      const answer = { day: { words: 1200 }, month: {}, week: {}, year: {} }
      getStatsMock.mockResolvedValue(answer)

      await expect(callRoute({ date: '2026-09-09' })).resolves.toBe(answer)
    })

    it('lets a handler failure through rather than converting it', async () => {
      expect.assertions(1)
      const failure = Object.assign(new Error('Not Found'), { statusCode: 404 })
      getStatsMock.mockRejectedValue(failure)

      await expect(callRoute({ date: '2026-09-09' })).rejects.toBe(failure)
    })
  })

  describe('a malformed query returns through sendZodError', () => {
    it.each([
      ['a shape that is not YYYY-MM-DD', '09-09-2026'],
      ['a day that does not exist in the month', '2026-02-30'],
      ['a month past twelve', '2026-13-01'],
      ['an empty string', ''],
      ['a datetime rather than a day', '2026-09-09T00:00:00Z']
    ])('answers 422 keyed on date for %s', async (_label, date) => {
      expect.assertions(1)

      await expect(callRoute({ date })).rejects.toMatchObject({
        data: { date: CALENDAR_DAY_MESSAGE },
        statusCode: 422
      })
    })

    it.each([
      ['a number', 42],
      ['null', null],
      ['a repeated parameter arriving as an array', ['2026-09-09', '2026-09-10']]
    ])('answers 422 keyed on date for %s', async (_label, date) => {
      expect.assertions(2)

      const rejection = (await callRoute({ date }).then(
        () => null,
        (error: unknown) => error
      )) as { data: Record<string, string>; statusCode: number } | null

      expect(rejection?.statusCode).toBe(422)
      // The message for a non-string is Zod's own rather than the refine's, so the field key is what
      // is pinned. A form-level key here would mean the client had no input to attach it to.
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['date'])
    })

    it('never calls the handler when the query is malformed', async () => {
      expect.assertions(2)

      await expect(callRoute({ date: '2026-02-30' })).rejects.toMatchObject({ statusCode: 422 })
      // The half that matters. A route that reported the failure and then called the handler anyway
      // would still answer 422 to the client while having already run the read.
      expect(getStatsMock).not.toHaveBeenCalled()
    })

    it('reports every malformed field in one answer', async () => {
      expect.assertions(1)

      await expect(callRoute({ date: 'yesterday' })).rejects.toMatchObject({
        statusMessage: CALENDAR_DAY_MESSAGE
      })
    })

    it('files no failure under the form-level key, every issue here naming a field', async () => {
      expect.assertions(1)

      const rejection = (await callRoute({ date: 'yesterday' }).then(
        () => null,
        (error: unknown) => error
      )) as { data: Record<string, string> } | null

      expect(rejection?.data).not.toHaveProperty(FORM_LEVEL_KEY)
    })
  })
})
