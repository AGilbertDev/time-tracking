import { beforeEach, describe, expect, it, vi } from 'vitest'

// The purge-deactivated cron permanently deletes accounts deactivated for at least a year. This suite
// covers two things about it.
//
// First, the avatar-erasure behaviour the avatar-upload feature added
// (docs/specs/settings/avatar-upload.md "Retention purge", criterion 11): each purged user's stored
// avatar object is deleted through avatarStorage.del (no direct @vercel/blob call), and a missing
// object or delete failure is swallowed so the row deletion (the primary purge) always completes.
//
// Second, the bearer guard that decides whether any of that runs at all, per the purge endpoint
// bullet in docs/specs/admin/manage-users.md: the route is not an admin-session route, it is
// authenticated by a shared secret, it verifies an `Authorization: Bearer <secret>` header against
// `runtimeConfig.cronSecret`, and it rejects anything else with 401, failing closed. That guard is
// the only thing standing between an unauthenticated GET and the permanent deletion of every
// long-deactivated account, and nothing exercised it until the cases at the bottom of this file, so
// the whole of it could have been deleted with this suite still green. A check that cannot fail is
// the defect this project's build trail keeps recording in new disguises.
//
// The storage util and the DB are mocked at their seams; the pure isPurgeable retention math is left
// real so the cutoff is exercised, not stubbed. Expected behaviour comes from the spec, not the code.

const { delMock, deleteMock, selectMock, dbState } = vi.hoisted(() => {
  const dbState = {
    deactivated: [] as { id: string; email: string; deactivatedAt: Date | null }[]
  }
  return {
    delMock: vi.fn(),
    deleteMock: vi.fn(() => ({ where: () => Promise.resolve() })),
    selectMock: vi.fn(() => ({ from: () => ({ where: () => dbState.deactivated }) })),
    dbState
  }
})

vi.mock('~~/server/utils/avatarStorage', () => ({
  avatarStorage: { del: delMock, put: vi.fn(), get: vi.fn() }
}))

vi.mock('~~/server/db/index', () => ({
  useDb: () => ({ select: selectMock, delete: deleteMock })
}))

// defineEventHandler wraps the handler at module-import time, so it must be stubbed before the import.
// The stub unwraps it to the raw async function so the test can invoke it directly with a fake event.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)

const purgeDeactivated = (await import('~~/server/api/cron/purge-deactivated.get')).default as (
  event: unknown
) => Promise<{ purged: number }>

const SECRET = 'cron-secret'

// A deactivation instant well over a year before now, so isPurgeable (kept real) returns true.
const LONG_AGO = new Date('2000-01-01T00:00:00Z')

const getHeaderMock = vi.fn()

const event = { __event: true }

beforeEach(() => {
  vi.clearAllMocks()
  dbState.deactivated = []

  vi.stubGlobal('getHeader', getHeaderMock)
  vi.stubGlobal('useRuntimeConfig', () => ({ cronSecret: SECRET }))
  vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(opts.statusMessage), opts)
  )

  // An authorized machine invocation by default, so the erasure cases below reach the work. The
  // authorization describe overrides this per case.
  getHeaderMock.mockReturnValue(`Bearer ${SECRET}`)
  delMock.mockResolvedValue(undefined)
})

describe('purge-deactivated avatar erasure', () => {
  it('deletes each purged user avatar through avatarStorage.del, keyed by user id', async () => {
    dbState.deactivated = [
      { id: 'u1', email: 'a@example.com', deactivatedAt: LONG_AGO },
      { id: 'u2', email: 'b@example.com', deactivatedAt: LONG_AGO }
    ]

    const result = await purgeDeactivated(event)

    expect(result).toEqual({ purged: 2 })
    expect(delMock).toHaveBeenCalledTimes(2)
    expect(delMock).toHaveBeenCalledWith('u1')
    expect(delMock).toHaveBeenCalledWith('u2')
  })

  it('swallows a delete failure so the row purge still completes', async () => {
    dbState.deactivated = [
      { id: 'u1', email: 'a@example.com', deactivatedAt: LONG_AGO },
      { id: 'u2', email: 'b@example.com', deactivatedAt: LONG_AGO }
    ]
    delMock.mockRejectedValueOnce(new Error('blob delete failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await purgeDeactivated(event)

    // The primary purge (row deletion) still ran and the count is unaffected by the storage failure.
    expect(result).toEqual({ purged: 2 })
    expect(deleteMock).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('makes no storage call when nothing is purgeable', async () => {
    // Deactivated but well under a year old: isPurgeable (real) returns false, so no purge, no del.
    dbState.deactivated = [{ id: 'u1', email: 'a@example.com', deactivatedAt: new Date() }]

    const result = await purgeDeactivated(event)

    expect(result).toEqual({ purged: 0 })
    expect(delMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

// Every refusal the guard owes, and the reason each one is a distinct case rather than a repetition.
//
// The last two are the fail-closed half. With no configured secret, the expected value the header is
// compared against is `Bearer undefined` or `Bearer `, and a header carrying exactly that string
// would match a comparison that had lost its `!secret` operand. So an unset secret has to be refused
// even when the caller guesses the shape of the hole, which is what these two send.
//
// The middle pair separate the two ways the constant-time comparison can say no. A value of the same
// byte length as the secret reaches timingSafeEqual and is refused on content, and a value one byte
// longer is refused by the length check that has to run first, because timingSafeEqual throws on
// unequal-length buffers. An early return on length is the part of a constant-time comparison most
// likely to be rewritten carelessly, and nothing reached it before.
const REFUSALS = [
  { given: 'no Authorization header at all', header: undefined, secret: SECRET },
  { given: 'an empty Authorization header', header: '', secret: SECRET },
  { given: 'the bare secret with no Bearer scheme', header: SECRET, secret: SECRET },
  { given: 'another scheme carrying the secret', header: `Basic ${SECRET}`, secret: SECRET },
  {
    given: 'a bearer value of the right length but the wrong bytes',
    header: `Bearer ${'x'.repeat(SECRET.length)}`,
    secret: SECRET
  },
  {
    given: 'a bearer value one byte longer than the secret',
    header: `Bearer ${SECRET}x`,
    secret: SECRET
  },
  { given: 'a configured secret that is the empty string', header: 'Bearer ', secret: '' },
  { given: 'no configured secret at all', header: 'Bearer undefined', secret: undefined }
] as const

describe('purge-deactivated bearer authorization', () => {
  // Every case in here starts from an account that is genuinely past the retention cutoff, so a
  // refusal has something real to refuse. Without that fixture, "no row was deleted" would hold
  // because there was nothing to delete, and the guard could be removed with every assertion still
  // green.
  beforeEach(() => {
    dbState.deactivated = [{ id: 'u1', email: 'a@example.com', deactivatedAt: LONG_AGO }]
  })

  it('purges when the bearer value matches the configured secret', async () => {
    // The positive control every refusal below is read against. A handler that rejected every
    // request, or that was broken for some reason unrelated to authorization, would satisfy the
    // refusal cases for the wrong reason.
    const result = await purgeDeactivated(event)

    expect(result).toEqual({ purged: 1 })
    expect(selectMock).toHaveBeenCalled()
    expect(deleteMock).toHaveBeenCalled()
    expect(delMock).toHaveBeenCalledWith('u1')
  })

  it('reads the bearer value from the Authorization header of the request event', async () => {
    await purgeDeactivated(event)

    expect(getHeaderMock).toHaveBeenCalledWith(event, 'authorization')
  })

  it.each(REFUSALS)('refuses with 401 unauthorized given $given', async ({ header, secret }) => {
    expect.assertions(1)
    vi.stubGlobal('useRuntimeConfig', () => ({ cronSecret: secret }))
    getHeaderMock.mockReturnValue(header)

    // The exact status and the exact message, not merely a rejection. A TypeError thrown out of the
    // comparison would also reject, would surface as a 500, and would prove nothing about the guard.
    await expect(purgeDeactivated(event)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'unauthorized'
    })
  })

  it.each(REFUSALS)(
    'reads nothing and deletes nothing given $given, so the refusal is fail-closed',
    async ({ header, secret }) => {
      expect.assertions(4)
      vi.stubGlobal('useRuntimeConfig', () => ({ cronSecret: secret }))
      getHeaderMock.mockReturnValue(header)

      await expect(purgeDeactivated(event)).rejects.toThrow()

      // No deletion and no data leak: the guard runs before useDb, so a refused request never even
      // learns which accounts are deactivated.
      expect(selectMock).not.toHaveBeenCalled()
      expect(deleteMock).not.toHaveBeenCalled()
      expect(delMock).not.toHaveBeenCalled()
    }
  )
})
