import { users } from '~~/server/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// removeAvatar is the handler behind DELETE /api/me/avatar. This suite locks the behaviour fixed by
// docs/specs/settings/avatar-upload.md ("DELETE /api/me/avatar" step list, "Ordering and
// compensation", acceptance criteria 10 and 13):
//   - Idempotent no-op: when the session avatarUrl is already null there is no storage call and no
//     write; it returns { avatarUrl: null }.
//   - Otherwise it nulls users.avatar_url FIRST (row, then object), then deletes the stored object
//     through avatarStorage.del(user.id), then refreshes the session with avatarUrl null.
//   - A delete failure after the column is nulled is swallowed: the end state is already correct, the
//     handler still returns { avatarUrl: null } and still refreshes the session.
//   - The write is scoped to the session user.id; no id is read from the request.
// Every boundary is mocked at its seam (the storage util, the Drizzle update, the session). Expected
// values come from the spec, not from treating the implementation as correct.

const { delMock, updateMock, setMock, updateWhereMock, eqMock, order } = vi.hoisted(() => {
  const order: string[] = []
  const updateWhereMock = vi.fn(() => {
    order.push('update')
    return undefined
  })
  const setMock = vi.fn(() => ({ where: updateWhereMock }))
  const updateMock = vi.fn(() => ({ set: setMock }))
  return {
    delMock: vi.fn(),
    updateMock,
    setMock,
    updateWhereMock,
    // eq is recorded as a marker so a where() argument can be inspected for its scoping value.
    eqMock: vi.fn((col: unknown, val: unknown) => ({ __col: col, __val: val })),
    order
  }
})

vi.mock('~~/server/utils/avatarStorage', () => ({
  avatarStorage: { del: delMock, put: vi.fn(), get: vi.fn() }
}))

vi.mock('~~/server/db/index', () => {
  const db = { update: updateMock }
  return { useDb: () => db }
})

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return { ...actual, eq: eqMock }
})

const { removeAvatar } = await import('~~/server/api/me/handlers/removeAvatar')

const SESSION_USER = {
  id: 'user-123',
  firstName: 'Alexandre',
  email: 'a@example.com',
  avatarUrl: '/api/me/avatar?v=1700000000000' as string | null
}

const requireUserSessionMock = vi.fn()
const setUserSessionMock = vi.fn()

const event = { __event: true } as never

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  vi.stubGlobal('requireUserSession', requireUserSessionMock)
  vi.stubGlobal('setUserSession', setUserSessionMock)

  requireUserSessionMock.mockResolvedValue({ user: { ...SESSION_USER } })
  delMock.mockImplementation(async () => {
    order.push('del')
  })
  setUserSessionMock.mockImplementation(async () => {
    order.push('session')
  })
})

describe('removeAvatar', () => {
  describe('idempotent no-op when no avatar is set (criterion 10)', () => {
    it('returns { avatarUrl: null } without any storage call or write when avatarUrl is already null', async () => {
      requireUserSessionMock.mockResolvedValue({ user: { ...SESSION_USER, avatarUrl: null } })

      const result = await removeAvatar(event)

      expect(result).toEqual({ avatarUrl: null })
      expect(delMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })
  })

  describe('remove when an avatar is set (criteria 10, 13)', () => {
    it('nulls the column scoped to the session user, then deletes the object, then refreshes the session', async () => {
      const result = await removeAvatar(event)

      expect(result).toEqual({ avatarUrl: null })

      // Row nulled first, object deleted second, session refreshed last (spec: row, then object).
      expect(order).toEqual(['update', 'del', 'session'])

      // The column is nulled with an updatedAt timestamp.
      expect(updateMock).toHaveBeenCalledWith(users)
      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(setArg.avatarUrl).toBeNull()
      expect(setArg.updatedAt).toBeInstanceOf(Date)

      // Scoped to the session user.id via eq(users.id, user.id), never a request id.
      const whereArg = updateWhereMock.mock.calls[0]?.[0] as { __col: unknown; __val: unknown }
      expect(whereArg.__col).toBe(users.id)
      expect(whereArg.__val).toBe(SESSION_USER.id)

      // The object delete is keyed off the session user id.
      expect(delMock).toHaveBeenCalledWith(SESSION_USER.id)

      // The refreshed session carries avatarUrl null.
      const sessionArg = setUserSessionMock.mock.calls[0]?.[1] as { user: { avatarUrl: null } }
      expect(sessionArg.user.avatarUrl).toBeNull()
    })

    it('swallows a delete failure after the column is nulled and still returns success', async () => {
      delMock.mockRejectedValue(new Error('blob delete failed'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await removeAvatar(event)

      // End state is already correct: the row is nulled, so a delete failure must not surface.
      expect(result).toEqual({ avatarUrl: null })
      expect(updateMock).toHaveBeenCalledTimes(1)
      expect(setUserSessionMock).toHaveBeenCalledTimes(1)

      errorSpy.mockRestore()
    })
  })
})
