import { beforeEach, describe, expect, it, vi } from 'vitest'

// The purge-deactivated cron permanently deletes accounts deactivated for at least a year. This suite
// covers only the avatar-erasure behaviour the avatar-upload feature added
// (docs/specs/settings/avatar-upload.md "Retention purge", criterion 11): each purged user's stored
// avatar object is deleted through avatarStorage.del (no direct @vercel/blob call), and a missing
// object or delete failure is swallowed so the row deletion (the primary purge) always completes. The
// storage util and the DB are mocked at their seams; the pure isPurgeable retention math is left real
// so the cutoff is exercised, not stubbed. Expected behaviour comes from the spec, not the code.

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

  // Authorized machine invocation by default; the auth branch itself is out of scope for this suite.
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
