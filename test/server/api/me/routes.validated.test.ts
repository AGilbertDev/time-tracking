import type { Mock } from 'vitest'
import type { z } from 'zod'

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
  resetRouteHarness
} from '../../../fixtures/thinRouteHarness'

// The five thin route files under server/api/me/ that validate a body before delegating: the four
// settings patches and the password change. Covered as a set because they are one shape with two
// decisions in it, the wrapper and the branch between sendZodError and the handler, and because both
// decisions are worth reading once across the set rather than five times.
//
// Each one is the write half of a pair whose read half lives in routes.passthrough.test.ts, and each
// acts on the session user alone: no route here reads an id, so the body it validates can only ever
// be applied to the caller's own row. What each handler then writes is settled in its own suite
// under handlers/.
//
// What is real and what is replaced is described in test/fixtures/thinRouteHarness.ts. The schemas
// and sendZodError are the shipped ones, so every field key and message asserted below is the one
// production emits.

const handlers = vi.hoisted(() => ({
  changePassword: vi.fn(async () => ({ __defaultHandlerAnswer: 'password' }) as unknown),
  saveCategoryQuotas: vi.fn(async () => ({ __defaultHandlerAnswer: 'category-quotas' }) as unknown),
  savePreferences: vi.fn(async () => ({ __defaultHandlerAnswer: 'preferences' }) as unknown),
  saveWorkSettings: vi.fn(async () => ({ __defaultHandlerAnswer: 'work-settings' }) as unknown),
  updateProfile: vi.fn(async () => ({ __defaultHandlerAnswer: 'profile' }) as unknown)
}))

vi.mock('~~/server/api/me/handlers/changePassword', () => ({
  changePassword: handlers.changePassword
}))
vi.mock('~~/server/api/me/handlers/saveCategoryQuotas', () => ({
  saveCategoryQuotas: handlers.saveCategoryQuotas
}))
vi.mock('~~/server/api/me/handlers/savePreferences', () => ({
  savePreferences: handlers.savePreferences
}))
vi.mock('~~/server/api/me/handlers/saveWorkSettings', () => ({
  saveWorkSettings: handlers.saveWorkSettings
}))
vi.mock('~~/server/api/me/handlers/updateProfile', () => ({
  updateProfile: handlers.updateProfile
}))

vi.mock('~~/server/db/index', () => ({
  useDb: () => {
    throw new Error('a me patch route must not reach the database')
  }
}))

const { CategoryQuotasPatchSchema } = await import('~~/server/models/category-quotas')
const { PasswordChangeSchema } = await import('~~/server/models/password')
const { PreferencesPatchSchema } = await import('~~/server/models/preferences')
const { ProfilePatchSchema } = await import('~~/server/models/profile')
const { WorkSettingsPatchSchema } = await import('~~/server/models/work-settings')
const { FORM_LEVEL_KEY } = await import('~~/server/utils/sendZodError')
const { THEME_IDS } = await import('#shared/theme')

const categoryQuotasRoute = await import('~~/server/api/me/category-quotas.patch')
const passwordRoute = await import('~~/server/api/me/password.patch')
const preferencesRoute = await import('~~/server/api/me/preferences.patch')
const profileRoute = await import('~~/server/api/me/profile.patch')
const workSettingsRoute = await import('~~/server/api/me/work-settings.patch')

type RouteFn = (event: unknown) => Promise<unknown>

const event = { __event: 'me-validated' } as never

const OWNER = { email: 'owner@example.com', id: 'owner-id', role: 'user' }

type RouteCase = {
  handler: Mock
  // A raw body the shipped schema refuses, and the field key its 422 must be filed under.
  invalid: [body: unknown, field: string]
  label: string
  route: RouteFn
  schema: z.ZodType
  valid: unknown
}

const cases: RouteCase[] = [
  {
    handler: handlers.saveCategoryQuotas,
    invalid: [{ quotas: [] }, 'quotas'],
    label: 'PATCH /api/me/category-quotas',
    route: categoryQuotasRoute.default as RouteFn,
    schema: CategoryQuotasPatchSchema,
    valid: { quotas: [{ categoryId: 'translation', quotaWph: 240 }] }
  },
  {
    handler: handlers.changePassword,
    invalid: [
      { confirmNewPassword: 'short', currentPassword: 'old-secret', newPassword: 'short' },
      'newPassword'
    ],
    label: 'PATCH /api/me/password',
    route: passwordRoute.default as RouteFn,
    schema: PasswordChangeSchema,
    valid: {
      confirmNewPassword: 'brand-new-secret',
      currentPassword: 'old-secret',
      newPassword: 'brand-new-secret'
    }
  },
  {
    handler: handlers.savePreferences,
    invalid: [{ locale: 'de' }, 'locale'],
    label: 'PATCH /api/me/preferences',
    route: preferencesRoute.default as RouteFn,
    schema: PreferencesPatchSchema,
    valid: { locale: 'en' }
  },
  {
    handler: handlers.updateProfile,
    invalid: [{ firstName: '' }, 'firstName'],
    label: 'PATCH /api/me/profile',
    route: profileRoute.default as RouteFn,
    schema: ProfilePatchSchema,
    valid: { firstName: 'Ada' }
  },
  {
    handler: handlers.saveWorkSettings,
    invalid: [{ timezone: 'Not/AZone' }, 'timezone'],
    label: 'PATCH /api/me/work-settings',
    route: workSettingsRoute.default as RouteFn,
    schema: WorkSettingsPatchSchema,
    valid: { timezone: 'Europe/Paris' }
  }
]

let recorder: NitroRecorder

function call(route: RouteFn, body: unknown) {
  requestInput.body = body
  return route(event)
}

beforeEach(() => {
  recorder = resetRouteHarness()
  recorder.setSession({ ...OWNER })
  for (const handler of Object.values(handlers)) handler.mockReset()
})

describe('the me routes that validate a body', () => {
  describe('registration: the session is enforced by the authenticated wrapper', () => {
    it.each(cases.map((entry) => [entry.label, entry.route] as const))(
      'registers %s through defineAuthenticatedEventHandler',
      (_label, route) => {
        expect(registeringWrapper(route)).toBe('authenticated')
      }
    )

    it('registers no route here through the admin wrapper', () => {
      expect(defineAdminEventHandlerMock).not.toHaveBeenCalled()
    })

    it('registers exactly the five patch routes through the authenticated wrapper', () => {
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledTimes(5)
      expect(defineAuthenticatedEventHandlerMock).toHaveBeenCalledWith(expect.any(Function))
    })

    it('registers with Nitro once per route, through the wrapper rather than directly', () => {
      expect(defineEventHandlerMock).toHaveBeenCalledTimes(5)
      for (const [handler] of defineAuthenticatedEventHandlerMock.mock.calls) {
        expect(defineEventHandlerMock.mock.calls.map(([given]) => given)).not.toContain(handler)
      }
    })

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'rejects a request to %s carrying no session with 401',
      async (_label, entry) => {
        expect.assertions(1)
        recorder.setSession(null)

        await expect(call(entry.route, entry.valid)).rejects.toMatchObject({ statusCode: 401 })
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'validates nothing and writes nothing on %s for a request carrying no session',
      async (_label, entry) => {
        expect.assertions(3)
        recorder.setSession(null)

        await expect(call(entry.route, entry.valid)).rejects.toMatchObject({ statusCode: 401 })
        expect(readValidatedBodyMock).not.toHaveBeenCalled()
        expect(entry.handler).not.toHaveBeenCalled()
      }
    )
  })

  describe('validation: each route checks the body against its own schema', () => {
    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'validates %s through the schema the route declares and not another validator',
      async (_label, entry) => {
        await call(entry.route, entry.valid)

        expect(readValidatedBodyMock).toHaveBeenCalledTimes(1)
        expect(readValidatedBodyMock.mock.calls[0]?.[1]).toBe(entry.schema.safeParse)
        expect(readValidatedBodyMock.mock.calls[0]?.[0]).toBe(event)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'reads the body alone on %s, never the query string or a route parameter',
      async (_label, entry) => {
        requestInput.params = { id: 'someone-else' }
        requestInput.query = { userId: 'someone-else' }

        await call(entry.route, entry.valid)

        expect(getValidatedQueryMock).not.toHaveBeenCalled()
        expect(getValidatedRouterParamsMock).not.toHaveBeenCalled()
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'answers 422 on the field the shipped schema names for a malformed body on %s',
      async (_label, entry) => {
        expect.assertions(2)
        const [body, field] = entry.invalid

        const rejection = await rejectionOf(call(entry.route, body))

        expect(rejection?.statusCode).toBe(422)
        expect(rejection?.data).toStrictEqual({
          [field]: issueMessage(entry.schema, body, field)
        })
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'never calls the handler behind %s when the body is malformed',
      async (_label, entry) => {
        expect.assertions(2)

        await expect(call(entry.route, entry.invalid[0])).rejects.toMatchObject({
          statusCode: 422
        })
        // The half that matters. A route that reported the failure and then called the handler
        // anyway would still answer 422 to the client while having already run the write.
        expect(entry.handler).not.toHaveBeenCalled()
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'answers 422 on %s for a body that is not an object at all',
      async (_label, entry) => {
        expect.assertions(2)

        const rejection = await rejectionOf(call(entry.route, undefined))

        expect(rejection?.statusCode).toBe(422)
        expect(entry.handler).not.toHaveBeenCalled()
      }
    )
  })

  describe('a valid body reaches the handler and its answer comes back unchanged', () => {
    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'calls the handler behind %s once with the event and the parsed body',
      async (_label, entry) => {
        await call(entry.route, entry.valid)

        expect(entry.handler).toHaveBeenCalledTimes(1)
        expect(entry.handler).toHaveBeenCalledWith(event, entry.valid)
        expect(entry.handler.mock.calls[0]).toHaveLength(2)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'hands the handler behind %s the schema product rather than the raw body object',
      async (_label, entry) => {
        const raw = { ...(entry.valid as object) }

        await call(entry.route, raw)

        // Identity, not shape. Every schema here rebuilds its output, so a route forwarding the raw
        // body would hand the handler the very object the request arrived as, unfiltered by the
        // schema even where the two happen to look alike.
        expect(entry.handler.mock.calls[0]?.[1]).not.toBe(raw)
        expect(entry.handler.mock.calls[0]?.[1]).toStrictEqual(entry.valid)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'returns the answer of the handler behind %s unchanged',
      async (label, entry) => {
        const answer = { __thisExactAnswer: label }
        entry.handler.mockResolvedValue(answer)

        await expect(call(entry.route, entry.valid)).resolves.toBe(answer)
      }
    )

    it.each(cases.map((entry) => [entry.label, entry] as const))(
      'lets a failure from the handler behind %s through rather than converting it',
      async (_label, entry) => {
        expect.assertions(2)
        const failure = Object.assign(new Error('Conflict'), { statusCode: 409 })
        entry.handler.mockRejectedValue(failure)

        const rejection = await rejectionOf(call(entry.route, entry.valid))

        // The exact code, not merely a rejection: a handler refusal and a crash in the route both
        // reject, and only the code tells them apart.
        expect(rejection?.statusCode).toBe(409)
        expect(rejection).toBe(failure)
      }
    )
  })

  describe('PATCH /api/me/profile', () => {
    it('hands the handler the trimmed name rather than the raw body', async () => {
      await call(profileRoute.default as RouteFn, { firstName: '  Ada  ', lastName: ' Lovelace ' })

      // nameFieldSchema trims before bounding, so surrounding whitespace never reaches a column and
      // the 100-character cap is measured on what will actually be stored.
      expect(handlers.updateProfile).toHaveBeenCalledWith(event, {
        firstName: 'Ada',
        lastName: 'Lovelace'
      })
    })

    it('drops a key the schema does not declare instead of forwarding it', async () => {
      await call(profileRoute.default as RouteFn, { email: 'new@example.com', firstName: 'Ada' })

      // ProfilePatchSchema declares two fields, so an attempt to move the account's email through
      // the profile patch reaches the handler as nothing at all.
      expect(Object.keys(handlers.updateProfile.mock.calls[0]?.[1] as object)).toStrictEqual([
        'firstName'
      ])
    })

    it('answers 422 under the form-level key for an empty patch', async () => {
      expect.assertions(3)

      const rejection = await rejectionOf(call(profileRoute.default as RouteFn, {}))

      // The refine reports against the body rather than a field, so its path is empty and
      // sendZodError files it under the form-level key. Without that the client would get a 422
      // with nothing in `data` to attach to an input.
      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        [FORM_LEVEL_KEY]: issueMessage(ProfilePatchSchema, {})
      })
      expect(handlers.updateProfile).not.toHaveBeenCalled()
    })

    it.each([
      ['an empty first name', { firstName: '' }, 'firstName'],
      ['a first name of nothing but whitespace', { firstName: '   ' }, 'firstName'],
      ['a first name past its cap', { firstName: 'a'.repeat(101) }, 'firstName'],
      ['a non-string last name', { lastName: 42 }, 'lastName'],
      ['a null last name', { lastName: null }, 'lastName']
    ])('answers 422 keyed on %s', async (_label, body, field) => {
      expect.assertions(2)

      const rejection = await rejectionOf(call(profileRoute.default as RouteFn, body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
    })
  })

  describe('PATCH /api/me/preferences', () => {
    it('answers 422 under the form-level key for an empty patch', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(call(preferencesRoute.default as RouteFn, {}))

      expect(rejection?.data).toStrictEqual({
        [FORM_LEVEL_KEY]: issueMessage(PreferencesPatchSchema, {})
      })
      expect(handlers.savePreferences).not.toHaveBeenCalled()
    })

    it.each([...THEME_IDS])('accepts %s as a light theme', async (lightTheme) => {
      await call(preferencesRoute.default as RouteFn, { lightTheme })

      expect(handlers.savePreferences).toHaveBeenCalledWith(event, { lightTheme })
    })

    it.each([
      ['a theme outside the shared contract', { lightTheme: 'neon' }, 'lightTheme'],
      ['a dark theme outside the shared contract', { darkTheme: 'neon' }, 'darkTheme'],
      ['a locale outside the shared contract', { locale: 'de' }, 'locale']
    ])('answers 422 keyed on %s', async (_label, body, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(call(preferencesRoute.default as RouteFn, body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(handlers.savePreferences).not.toHaveBeenCalled()
    })

    it('drops a key the schema does not declare instead of forwarding it', async () => {
      await call(preferencesRoute.default as RouteFn, { locale: 'en', theme: 'neon' })

      expect(Object.keys(handlers.savePreferences.mock.calls[0]?.[1] as object)).toStrictEqual([
        'locale'
      ])
    })
  })

  describe('PATCH /api/me/work-settings', () => {
    it('answers 422 under the form-level key for an empty patch', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(call(workSettingsRoute.default as RouteFn, {}))

      expect(rejection?.data).toStrictEqual({
        [FORM_LEVEL_KEY]: issueMessage(WorkSettingsPatchSchema, {})
      })
      expect(handlers.saveWorkSettings).not.toHaveBeenCalled()
    })

    it.each([
      ['a zone that is not IANA', { timezone: 'Not/AZone' }, 'timezone'],
      ['an empty zone', { timezone: '' }, 'timezone'],
      ['a daily minute count of zero', { dailyWorkMinutes: 0 }, 'dailyWorkMinutes'],
      ['a daily minute count past a day', { dailyWorkMinutes: 1441 }, 'dailyWorkMinutes'],
      ['a fractional daily minute count', { dailyWorkMinutes: 90.5 }, 'dailyWorkMinutes'],
      ['a daily minute count sent as a string', { dailyWorkMinutes: '480' }, 'dailyWorkMinutes'],
      ['a work day outside the week', { workDays: [7] }, 'workDays.0'],
      ['a repeated work day', { workDays: [1, 1] }, 'workDays'],
      ['more work days than a week has', { workDays: [0, 1, 2, 3, 4, 5, 6, 0] }, 'workDays']
    ])('answers 422 keyed on %s', async (_label, body, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(call(workSettingsRoute.default as RouteFn, body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(handlers.saveWorkSettings).not.toHaveBeenCalled()
    })

    it('hands the handler a full patch unchanged in value and rebuilt in identity', async () => {
      const raw = { dailyWorkMinutes: 480, timezone: 'Europe/Paris', workDays: [1, 2, 3, 4, 5] }

      await call(workSettingsRoute.default as RouteFn, raw)
      const handed = handlers.saveWorkSettings.mock.calls[0]?.[1] as Record<string, unknown>

      expect(handed).toStrictEqual(raw)
      expect(handed).not.toBe(raw)
      expect(handed.workDays).not.toBe(raw.workDays)
    })
  })

  describe('PATCH /api/me/password', () => {
    it('drops a key the schema does not declare instead of forwarding it', async () => {
      await call(passwordRoute.default as RouteFn, {
        confirmNewPassword: 'brand-new-secret',
        currentPassword: 'old-secret',
        email: 'attacker@example.com',
        newPassword: 'brand-new-secret'
      })

      expect(
        Object.keys(handlers.changePassword.mock.calls[0]?.[1] as object).sort()
      ).toStrictEqual(['confirmNewPassword', 'currentPassword', 'newPassword'])
    })

    it('hands the handler the passwords untouched, whitespace and all', async () => {
      await call(passwordRoute.default as RouteFn, {
        confirmNewPassword: '  spaced secret  ',
        currentPassword: '  old secret  ',
        newPassword: '  spaced secret  '
      })

      // No trimming anywhere in PasswordChangeSchema, because a leading or trailing space is a
      // character of the secret. Trimming here would change the password the user typed.
      expect(handlers.changePassword).toHaveBeenCalledWith(event, {
        confirmNewPassword: '  spaced secret  ',
        currentPassword: '  old secret  ',
        newPassword: '  spaced secret  '
      })
    })

    it('answers 422 keyed on confirmNewPassword when the confirmation does not match', async () => {
      expect.assertions(3)
      const body = {
        confirmNewPassword: 'brand-new-secrez',
        currentPassword: 'old-secret',
        newPassword: 'brand-new-secret'
      }

      const rejection = await rejectionOf(call(passwordRoute.default as RouteFn, body))

      expect(rejection?.statusCode).toBe(422)
      expect(rejection?.data).toStrictEqual({
        confirmNewPassword: issueMessage(PasswordChangeSchema, body, 'confirmNewPassword')
      })
      // The mismatch is caught at the boundary, so nothing reaches the handler that would verify the
      // current password and start a change the user did not confirm.
      expect(handlers.changePassword).not.toHaveBeenCalled()
    })

    it.each([
      [
        'a new password below the minimum',
        { confirmNewPassword: 'short', currentPassword: 'old-secret', newPassword: 'short' },
        'newPassword'
      ],
      [
        'a new password past the maximum',
        {
          confirmNewPassword: 'a'.repeat(201),
          currentPassword: 'old-secret',
          newPassword: 'a'.repeat(201)
        },
        'newPassword'
      ],
      [
        'an empty current password',
        {
          confirmNewPassword: 'brand-new-secret',
          currentPassword: '',
          newPassword: 'brand-new-secret'
        },
        'currentPassword'
      ],
      [
        'an absent current password',
        { confirmNewPassword: 'brand-new-secret', newPassword: 'brand-new-secret' },
        'currentPassword'
      ],
      [
        'an empty confirmation',
        {
          confirmNewPassword: '',
          currentPassword: 'old-secret',
          newPassword: 'brand-new-secret'
        },
        'confirmNewPassword'
      ]
    ])('answers 422 keyed on %s', async (_label, body, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(call(passwordRoute.default as RouteFn, body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(handlers.changePassword).not.toHaveBeenCalled()
    })

    it('reports every malformed field in one answer', async () => {
      expect.assertions(1)

      const rejection = await rejectionOf(call(passwordRoute.default as RouteFn, {}))

      expect(Object.keys(rejection?.data ?? {}).sort()).toStrictEqual([
        'confirmNewPassword',
        'currentPassword',
        'newPassword'
      ])
    })
  })

  describe('PATCH /api/me/category-quotas', () => {
    it('hands the handler the parsed quota list, rebuilt entry by entry', async () => {
      const raw = {
        quotas: [
          { categoryId: 'translation', quotaWph: 240 },
          { categoryId: 'proofreading', quotaWph: 2000 }
        ]
      }

      await call(categoryQuotasRoute.default as RouteFn, raw)
      const handed = handlers.saveCategoryQuotas.mock.calls[0]?.[1] as {
        quotas: { categoryId: string }[]
      }

      expect(handed).toStrictEqual(raw)
      expect(handed).not.toBe(raw)
      expect(handed.quotas).not.toBe(raw.quotas)
      expect(handed.quotas[0]).not.toBe(raw.quotas[0])
    })

    it('answers 422 keyed on the entry for a category that is not trackable', async () => {
      expect.assertions(3)
      const body = { quotas: [{ categoryId: 'breaks', quotaWph: 240 }] }

      const rejection = await rejectionOf(call(categoryQuotasRoute.default as RouteFn, body))

      // A quota on a category that produces no billable words is meaningless, and the key names the
      // offending entry by index so the client can point at the row rather than the whole form.
      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['quotas.0.categoryId'])
      expect(handlers.saveCategoryQuotas).not.toHaveBeenCalled()
    })

    it.each([
      ['an absent quota list', {}, 'quotas'],
      ['an empty quota list', { quotas: [] }, 'quotas'],
      [
        'the same category twice',
        {
          quotas: [
            { categoryId: 'translation', quotaWph: 240 },
            { categoryId: 'translation', quotaWph: 300 }
          ]
        },
        'quotas'
      ],
      [
        'a category outside the contract',
        { quotas: [{ categoryId: 'invented', quotaWph: 240 }] },
        'quotas.0.categoryId'
      ],
      [
        'a quota of zero',
        { quotas: [{ categoryId: 'translation', quotaWph: 0 }] },
        'quotas.0.quotaWph'
      ],
      [
        'a quota past the cap',
        { quotas: [{ categoryId: 'translation', quotaWph: 10001 }] },
        'quotas.0.quotaWph'
      ],
      [
        'a quota sent as a string',
        { quotas: [{ categoryId: 'translation', quotaWph: '240' }] },
        'quotas.0.quotaWph'
      ],
      ['a quota list that is not a list', { quotas: 240 }, 'quotas']
    ])('answers 422 keyed on %s', async (_label, body, field) => {
      expect.assertions(3)

      const rejection = await rejectionOf(call(categoryQuotasRoute.default as RouteFn, body))

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual([field])
      expect(handlers.saveCategoryQuotas).not.toHaveBeenCalled()
    })

    it('names an unknown top-level key in the answer rather than dropping it', async () => {
      expect.assertions(3)

      const rejection = await rejectionOf(
        call(categoryQuotasRoute.default as RouteFn, {
          quotas: [{ categoryId: 'translation', quotaWph: 240 }],
          userId: 'someone-else'
        })
      )

      // The schema is strict, and sendZodError's unrecognized_keys branch files the rejected key
      // under its own name. A client that sent userId and got a 201 would have been told its write
      // succeeded as sent, which is false.
      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['userId'])
      expect(handlers.saveCategoryQuotas).not.toHaveBeenCalled()
    })

    it('names an unknown key inside an entry in the answer rather than dropping it', async () => {
      expect.assertions(2)

      const rejection = await rejectionOf(
        call(categoryQuotasRoute.default as RouteFn, {
          quotas: [{ categoryId: 'translation', quotaWph: 240, userId: 'someone-else' }]
        })
      )

      expect(rejection?.statusCode).toBe(422)
      expect(Object.keys(rejection?.data ?? {})).toStrictEqual(['userId'])
    })
  })
})
