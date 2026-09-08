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

// The route file server/api/onboarding/complete.post.ts, the four executable lines behind
// POST /api/onboarding/complete.
//
// The wrapper here is bare, and unlike the login and magic-link routes that is not because the
// endpoint is public. completeOnboarding calls requireUserSession itself as its first statement and
// then reads users.onboarded_at for the account it found, so the session check exists and lives one
// module down. The registration criterion below therefore asserts the bare wrapper as the shipped
// arrangement rather than as an absence of protection, and the 401 for a sessionless request is
// covered where it is decided, in test/server/api/onboarding/handlers/complete.test.ts, along with
// the 409 second submit and the breached-password refusal.
//
// The one decision this file makes is the branch between sendZodError and the handler, over the
// widest request schema in the app: nine fields covering identity, appearance and work settings,
// persisted atomically on the single Finish submit. A field that slipped past the boundary here
// would be written into the user's first ever profile.
//
// What is real and what is replaced is described in test/fixtures/thinRouteHarness.ts.

const { completeOnboardingMock } = vi.hoisted(() => ({
  completeOnboardingMock: vi.fn(async () => ({ __defaultHandlerAnswer: 'complete' }) as unknown)
}))

vi.mock('~~/server/api/onboarding/handlers/complete', () => ({
  completeOnboarding: completeOnboardingMock
}))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('the onboarding completion route must not reach the database')
  }
}))

const { CompleteOnboardingSchema } = await import('~~/server/models/onboarding')
const { FORM_LEVEL_KEY } = await import('~~/server/utils/sendZodError')
const { LOCALES, THEME_IDS } = await import('#shared/theme')

const route = await import('~~/server/api/onboarding/complete.post')

const event = { __event: 'onboarding-complete' } as never

const OWNER = { email: 'owner@example.com', id: 'owner-id', role: 'user' }

const VALID = {
  dailyWorkMinutes: 480,
  darkTheme: 'encre',
  firstName: 'Ada',
  lastName: 'Lovelace',
  lightTheme: 'pastel',
  locale: 'fr',
  password: 'brand-new-secret',
  timezone: 'Europe/Paris',
  workDays: [1, 2, 3, 4, 5]
}

let recorder: NitroRecorder

function callRoute(body: unknown) {
  requestInput.body = body
  return (route.default as (event: unknown) => Promise<unknown>)(event)
}

beforeEach(() => {
  recorder = resetRouteHarness()
  recorder.setSession({ ...OWNER })
  completeOnboardingMock.mockReset()
})

describe('POST /api/onboarding/complete route', () => {
  describe('registration', () => {
    it('registers through a bare defineEventHandler', () => {
      expect(registeringWrapper(route.default)).toBe('bare')
    })

    it('registers through neither of the project wrappers', () => {
      expect(defineAuthenticatedEventHandlerMock).not.toHaveBeenCalled()
      expect(defineAdminEventHandlerMock).not.toHaveBeenCalled()
    })

    it('registers with Nitro exactly once', () => {
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(1)
      expect(route.default).toBe(defineEventHandlerMock.mock.calls[0]?.[0])
    })

    it('leaves the session check to the handler rather than answering 401 in the route', async () => {
      recorder.setSession(null)

      await callRoute(VALID)

      // The shipped arrangement: no wrapper here, and completeOnboarding calls requireUserSession
      // as its first statement. The route reaching the handler with no session is what makes that
      // check the one that runs, and the mock standing in for it is why nothing is refused here.
      expect(completeOnboardingMock).toHaveBeenCalledTimes(1)
    })

    it('still validates the body before the handler for a sessionless request', async () => {
      expect.assertions(2)
      recorder.setSession(null)

      await expect(callRoute({ ...VALID, password: 'short' })).rejects.toMatchObject({
        statusCode: 422
      })
      expect(completeOnboardingMock).not.toHaveBeenCalled()
    })
  })

  describe('validation: the body is checked against CompleteOnboardingSchema', () => {
    it('validates through CompleteOnboardingSchema.safeParse and not another validator', async () => {
      await callRoute(VALID)

      expect(readValidatedBodyMock).toHaveBeenCalledTimes(1)
      expect(readValidatedBodyMock.mock.calls[0]?.[1]).toBe(CompleteOnboardingSchema.safeParse)
      expect(readValidatedBodyMock.mock.calls[0]?.[0]).toBe(event)
    })

    it('reads the body and never the query string', async () => {
      await callRoute(VALID)

      expect(getValidatedQueryMock).not.toHaveBeenCalled()
    })
  })

  describe('a valid body reaches the handler', () => {
    it('calls completeOnboarding once with the event and the parsed body', async () => {
      await callRoute(VALID)

      expect(completeOnboardingMock).toHaveBeenCalledTimes(1)
      expect(completeOnboardingMock).toHaveBeenCalledWith(event, VALID)
      expect(completeOnboardingMock.mock.calls[0]).toHaveLength(2)
    })

    it('hands the handler the trimmed names rather than the raw body', async () => {
      const raw = { ...VALID, firstName: '  Ada  ', lastName: '  Lovelace  ' }

      await callRoute(raw)
      const handed = completeOnboardingMock.mock.calls[0]?.[1] as Record<string, unknown>

      // nameFieldSchema trims, so the profile the wizard creates never holds a padded name. The
      // identity check is what separates the parsed value from one that merely looks like it.
      expect(handed.firstName).toBe('Ada')
      expect(handed.lastName).toBe('Lovelace')
      expect(handed).not.toBe(raw)
    })

    it('hands the handler the password untouched, whitespace and all', async () => {
      await callRoute({ ...VALID, password: '  spaced secret  ' })

      // PasswordSchema bounds the length and trims nothing, because a leading or trailing space is
      // a character of the secret the user just chose and will type again to sign in.
      expect(completeOnboardingMock.mock.calls[0]?.[1]).toMatchObject({
        password: '  spaced secret  '
      })
    })

    it('drops a key the schema does not declare instead of forwarding it', async () => {
      await callRoute({ ...VALID, onboardedAt: '2020-01-01', role: 'admin' })

      // The wizard's Finish submit writes the account's very first profile, so a role or a
      // completion timestamp arriving in the body must reach the handler as nothing at all.
      expect(Object.keys(completeOnboardingMock.mock.calls[0]?.[1] as object).sort()).toStrictEqual(
        Object.keys(VALID).sort()
      )
    })

    it('returns the handler answer unchanged', async () => {
      const answer = { result: 'onboarded' }
      completeOnboardingMock.mockResolvedValue(answer)

      await expect(callRoute(VALID)).resolves.toBe(answer)
    })

    it('lets the 409 second-submit refusal through rather than converting it', async () => {
      expect.assertions(2)
      const failure = Object.assign(new Error('already_onboarded'), { statusCode: 409 })
      completeOnboardingMock.mockRejectedValue(failure)

      const rejection = await rejectionOf(callRoute(VALID))

      expect(rejection?.statusCode).toBe(409)
      expect(rejection).toBe(failure)
    })

    it.each([...LOCALES])('accepts %s as the chosen locale', async (locale) => {
      await callRoute({ ...VALID, locale })

      expect(completeOnboardingMock.mock.calls[0]?.[1]).toMatchObject({ locale })
    })

    it.each([...THEME_IDS])('accepts %s as the chosen light theme', async (lightTheme) => {
      await callRoute({ ...VALID, lightTheme })

      expect(completeOnboardingMock.mock.calls[0]?.[1]).toMatchObject({ lightTheme })
    })

    it('accepts an empty work-day list, since a schedule of no days is a real answer', async () => {
      await callRoute({ ...VALID, workDays: [] })

      expect(completeOnboardingMock.mock.calls[0]?.[1]).toMatchObject({ workDays: [] })
    })
  })

  describe('a malformed body returns through sendZodError', () => {
    it.each([
      ['an empty first name', { firstName: '' }, 'firstName'],
      ['a first name of nothing but whitespace', { firstName: '   ' }, 'firstName'],
      ['a first name past its cap', { firstName: 'a'.repeat(101) }, 'firstName'],
      ['an empty last name', { lastName: '' }, 'lastName'],
      ['a password below the minimum', { password: 'short' }, 'password'],
      ['a password past the maximum', { password: 'a'.repeat(201) }, 'password'],
      ['a light theme outside the contract', { lightTheme: 'neon' }, 'lightTheme'],
      ['a dark theme outside the contract', { darkTheme: 'neon' }, 'darkTheme'],
      ['a locale outside the contract', { locale: 'de' }, 'locale'],
      ['a daily minute count of zero', { dailyWorkMinutes: 0 }, 'dailyWorkMinutes'],
      ['a daily minute count past a day', { dailyWorkMinutes: 1441 }, 'dailyWorkMinutes'],
      ['a daily minute count sent as a string', { dailyWorkMinutes: '480' }, 'dailyWorkMinutes'],
      ['a repeated work day', { workDays: [1, 1] }, 'workDays'],
      ['a work day outside the week', { workDays: [7] }, 'workDays.0'],
      ['a zone that is not IANA', { timezone: 'Not/AZone' }, 'timezone']
    ])('answers 422 keyed on %s', async (_label, patch, field) => {
      expect.assertions(4)
      const body = { ...VALID, ...patch }

      const rejection = await rejectionOf(callRoute(body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(rejection?.data[field]).toBe(issueMessage(CompleteOnboardingSchema, body, field))
      // The half that matters. A route that reported the failure and then called the handler anyway
      // would still answer 422 while having already written the first profile from a refused body.
      expect(completeOnboardingMock).not.toHaveBeenCalled()
    })

    it('reports every missing field of an empty body in one answer', async () => {
      expect.assertions(3)

      const rejection = await rejectionOf(callRoute({}))

      expect(rejection?.statusCode).toBe(422)
      // Nine fields, nine keys. The wizard shows all its steps at once on Finish, so a 422 naming
      // only the first missing field would send the user hunting.
      expect(Object.keys(rejection?.data ?? {}).sort()).toStrictEqual(Object.keys(VALID).sort())
      expect(rejection?.data).not.toHaveProperty(FORM_LEVEL_KEY)
    })

    it('answers 422 for a body that is not an object at all', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(callRoute(undefined))

      expect(rejection?.statusCode).toBe(422)
      expect(completeOnboardingMock).not.toHaveBeenCalled()
    })
  })
})
