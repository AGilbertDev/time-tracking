import type { z } from 'zod'

import { defineAdminEventHandler } from '~~/server/utils/defineAdminEventHandler'
import { defineAuthenticatedEventHandler } from '~~/server/utils/defineAuthenticatedEventHandler'
import { vi } from 'vitest'

import type { NitroRecorder } from '../helpers/nitroGlobals'

import { installNitroGlobals } from '../helpers/nitroGlobals'

// The shared seam for the thin route files, the four-line modules that sit between Nitro and a
// handler. Each one makes the same three decisions and nothing else: which wrapper registers it,
// which schema validates the input, and whether the parsed value reaches the handler or a 422 comes
// back through sendZodError instead. So the stand-ins they need are the same set every time, and
// putting the set here means one definition of "what is real and what is replaced" rather than one
// per suite that can drift.
//
// This lives in test/fixtures rather than test/helpers deliberately: helpers/ is shared ground that
// several agents are editing at once, and nothing here is needed outside the route suites.
//
// WHAT IS REAL
//
//   defineAuthenticatedEventHandler and defineAdminEventHandler are the shipped implementations from
//   server/utils, each wrapped in a spy and placed on the global that Nuxt's auto-import transform
//   would otherwise provide. So the session check and the role check that run before a route body are
//   the real ones, and the spy still records which wrapper each route registered through. That
//   recording is the point: a route moved from the admin wrapper to the merely-authenticated one
//   exports the identical shape and answers the identical status codes to an admin, so the only place
//   the difference is visible is the registration call itself.
//
//   Every request schema and sendZodError are the shipped ones, never mocked. Every status code,
//   field key and message asserted in these suites is therefore the one production emits. A test
//   agreeing with the route about a message it both wrote and read would be worth nothing.
//
// WHAT IS REPLACED
//
//   defineEventHandler, readValidatedBody, getValidatedQuery, getValidatedRouterParams and
//   setResponseStatus are Nitro's own. defineEventHandler is the identity, so the exported handler is
//   the very function the shipped wrapper built and calling it runs that wrapper for real. The three
//   readers do what Nitro documents, handing the payload to the validator they were given and
//   returning that validator's verdict, which is what lets a route be fed a raw body or query and be
//   observed deciding on the real schema's answer.
//
//   Each route's handler module is mocked in the suite that covers it, so the route is observed in
//   isolation and no database is reached. What a handler itself computes is settled in that handler's
//   own suite; nothing about it is decided in a route suite. server/db/index is mocked to a useDb
//   that throws rather than left alone, so "the route touches no database" is enforced by the seam
//   instead of assumed from the handler being mocked.

// The validator a Nitro reader is handed, which in every route here is a schema's bound safeParse.
export type Validator = (input: unknown) => unknown

// The raw payloads the readers below hand to the validator, standing in for the body, the route
// parameters and the query string of the request under test. A suite sets the one its route reads
// and leaves the others undefined, so a route reading the wrong one is visible.
export const requestInput = {
  body: undefined as unknown,
  params: undefined as unknown,
  query: undefined as unknown
}

export const readValidatedBodyMock = vi.fn(async (_event: unknown, validate: Validator) =>
  validate(requestInput.body)
)

export const getValidatedQueryMock = vi.fn(async (_event: unknown, validate: Validator) =>
  validate(requestInput.query)
)

export const getValidatedRouterParamsMock = vi.fn(async (_event: unknown, validate: Validator) =>
  validate(requestInput.params)
)

export const setResponseStatusMock = vi.fn()

// What the nuxt-auth-utils defineOAuthGoogleEventHandler stand-in hands back, so a suite can assert
// the route exported the wrapper's product rather than something of its own.
export const OAUTH_GOOGLE_HANDLER = { __oauthGoogleHandler: true } as const

export const defineOAuthGoogleEventHandlerMock = vi.fn((_options: unknown) => OAUTH_GOOGLE_HANDLER)

export const defineEventHandlerMock = vi.fn((handler: unknown) => handler)

export const defineAuthenticatedEventHandlerMock = vi.fn(defineAuthenticatedEventHandler)

export const defineAdminEventHandlerMock = vi.fn(defineAdminEventHandler)

// Every registration helper has to be on the global before a route module is evaluated, because a
// route file calls its wrapper at module scope. This runs once here, so a suite's static import of
// the fixture is what guarantees the globals exist by the time the suite awaits its route imports,
// and again from resetRouteHarness so nothing a later suite unstubs can leave the call-time helpers
// missing. It only ever stubs the same instances, so the registration calls recorded at import time
// survive every reset.
export function installRouteGlobals(): void {
  vi.stubGlobal('defineEventHandler', defineEventHandlerMock)
  vi.stubGlobal('defineAuthenticatedEventHandler', defineAuthenticatedEventHandlerMock)
  vi.stubGlobal('defineAdminEventHandler', defineAdminEventHandlerMock)
  vi.stubGlobal('defineOAuthGoogleEventHandler', defineOAuthGoogleEventHandlerMock)
  vi.stubGlobal('readValidatedBody', readValidatedBodyMock)
  vi.stubGlobal('getValidatedQuery', getValidatedQueryMock)
  vi.stubGlobal('getValidatedRouterParams', getValidatedRouterParamsMock)
  vi.stubGlobal('setResponseStatus', setResponseStatusMock)
}

installNitroGlobals()
installRouteGlobals()

// Restores every stand-in to the implementation it was created with, clears the recorded calls, and
// hands back a fresh Nitro recorder. The four registration spies are deliberately left alone: their
// only calls happened when the route modules were evaluated, and clearing them would erase the
// evidence the registration criteria read.
export function resetRouteHarness(): NitroRecorder {
  const recorder = installNitroGlobals()
  installRouteGlobals()
  readValidatedBodyMock.mockReset()
  getValidatedQueryMock.mockReset()
  getValidatedRouterParamsMock.mockReset()
  setResponseStatusMock.mockReset()
  requestInput.body = undefined
  requestInput.params = undefined
  requestInput.query = undefined
  return recorder
}

// Which wrapper produced this exported handler, read from the registration spies by identity rather
// than inferred from the handler's behaviour. 'bare' means the route reached Nitro without passing
// through either of this project's wrappers, which is the correct answer for the public endpoints
// and a dropped session check anywhere else. The bare case is tested last because both wrappers call
// defineEventHandler themselves, so a wrapped route's exported handler is also a return value of
// defineEventHandler and only the wrapper checks can tell the three apart.
export function registeringWrapper(
  handler: unknown
): 'admin' | 'authenticated' | 'bare' | 'unregistered' {
  const produced = (spy: { mock: { results: readonly { value: unknown }[] } }) =>
    spy.mock.results.some((result) => result.value === handler)

  if (produced(defineAdminEventHandlerMock)) return 'admin'
  if (produced(defineAuthenticatedEventHandlerMock)) return 'authenticated'
  if (produced(defineEventHandlerMock)) return 'bare'
  return 'unregistered'
}

// The shape sendZodError throws, as every caller in this repository reads it.
export type ZodErrorResponse = {
  data: Record<string, string>
  statusCode: number
  statusMessage: string
}

// The rejection a route produced, or null when it resolved. Used where the assertion is about the
// keys of `data` rather than a subset match, since toMatchObject cannot say "and nothing else".
export async function rejectionOf(promise: Promise<unknown>): Promise<ZodErrorResponse | null> {
  return promise.then(
    () => null,
    (error: unknown) => error as ZodErrorResponse
  )
}

// The message the shipped schema declares for this input, read from the schema rather than copied
// into an assertion. A reworded message moves both sides at once, so the assertion keeps meaning
// "the route validated through this schema" instead of "the route produced this sentence". Throws
// when the schema accepts the input, so a case that stops being a failure cannot pass quietly.
export function issueMessage(schema: z.ZodType, input: unknown, field?: string): string {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('expected the shipped schema to refuse this input')

  const issue = result.error.issues.find(
    (candidate) => field === undefined || candidate.path.join('.') === field
  )
  if (!issue) throw new Error(`expected the shipped schema to report an issue on ${String(field)}`)

  return issue.message
}
