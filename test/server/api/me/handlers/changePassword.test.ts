import { users } from '~~/server/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// changePassword is the handler behind PATCH /api/me/password. This suite locks the decision ORDER
// and the fail-closed branches exactly as docs/specs/settings/settings-page.md fixes them (the
// handler step list in "PATCH /api/me/password" and acceptance criteria 9-16). Every boundary is
// mocked at its seam so the assertions are about the handler's control flow, never a live DB, hash,
// or HIBP call:
//   - no passwordHash on the row  -> generic 401 current_password_incorrect, no write
//   - verifyPassword false        -> same generic 401, no write
//   - new equals current          -> 422 password_unchanged, no write, no hashing
//   - isPasswordBreached true     -> 422 password_breached, no write, no hashing
//   - HIBP fails open (false)     -> the change proceeds
//   - success                     -> hashPassword called, exactly one atomic db.update scoped to
//                                    the session user.id, setUserSession refreshed, { success: true }
//   - no password or hash reaches any logger
// The expected order and codes come from the spec, not from reading the implementation as correct.

// Hoisted spies so the vi.mock factories can reference them. A call-order log proves the sequence.
const { selectGetMock, updateMock, setMock, updateWhereMock, isBreachedMock, eqMock, order } =
  vi.hoisted(() => {
    const order: string[] = []
    const updateWhereMock = vi.fn(() => {
      order.push('update')
      return undefined
    })
    const setMock = vi.fn(() => ({ where: updateWhereMock }))
    const updateMock = vi.fn(() => ({ set: setMock }))
    return {
      selectGetMock: vi.fn(),
      updateMock,
      setMock,
      updateWhereMock,
      isBreachedMock: vi.fn(),
      // eq is recorded as a marker so a where() argument can be inspected for its scoping value.
      eqMock: vi.fn((col: unknown, val: unknown) => ({ __col: col, __val: val })),
      order
    }
  })

vi.mock('~~/server/db/index', () => {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ get: selectGetMock }) }) }),
    update: updateMock
  }
  return { useDb: () => db }
})

vi.mock('~~/server/utils/checkPasswordBreached', () => ({
  isPasswordBreached: isBreachedMock
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return { ...actual, eq: eqMock }
})

const { changePassword } = await import('~~/server/api/me/handlers/changePassword')

const SESSION_USER = { id: 'user-123', firstName: 'Alexandre', email: 'a@example.com' }
const STORED_HASH = 'stored-hash'

// Auto-imported Nitro/nuxt-auth-utils helpers the handler calls as free identifiers. In the raw
// source (no Nuxt transform) they resolve to globalThis, so we stub them there. Reset per test.
const verifyPasswordMock = vi.fn()
const hashPasswordMock = vi.fn()
const setUserSessionMock = vi.fn()
const requireUserSessionMock = vi.fn()

const event = { __event: true } as never

function stubGlobals() {
  vi.stubGlobal('requireUserSession', requireUserSessionMock)
  vi.stubGlobal('verifyPassword', verifyPasswordMock)
  vi.stubGlobal('hashPassword', hashPasswordMock)
  vi.stubGlobal('setUserSession', setUserSessionMock)
  // A minimal createError that carries statusCode and statusMessage so branches can be asserted.
  vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(opts.statusMessage), opts)
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  stubGlobals()

  requireUserSessionMock.mockResolvedValue({ user: SESSION_USER })
  // Default happy-path stubbing; individual tests override the field they exercise.
  selectGetMock.mockResolvedValue({ passwordHash: STORED_HASH })
  verifyPasswordMock.mockImplementation(async () => {
    order.push('verify')
    return true
  })
  isBreachedMock.mockImplementation(async () => {
    order.push('breach')
    return false
  })
  hashPasswordMock.mockImplementation(async () => {
    order.push('hash')
    return 'new-hash'
  })
  setUserSessionMock.mockImplementation(async () => {
    order.push('session')
  })
})

const validBody = {
  currentPassword: 'current-pw',
  newPassword: 'brand-new-password',
  confirmNewPassword: 'brand-new-password'
}

describe('changePassword', () => {
  describe('no passwordHash on the row (defensive edge)', () => {
    it('throws the generic 401 current_password_incorrect and writes nothing', async () => {
      selectGetMock.mockResolvedValue({ passwordHash: null })

      await expect(changePassword(event, validBody)).rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'current_password_incorrect'
      })

      // Fails closed before any verification, breach check, hashing, or write.
      expect(verifyPasswordMock).not.toHaveBeenCalled()
      expect(isBreachedMock).not.toHaveBeenCalled()
      expect(hashPasswordMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })

    it('throws the same generic 401 when no row exists at all', async () => {
      selectGetMock.mockResolvedValue(undefined)

      await expect(changePassword(event, validBody)).rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'current_password_incorrect'
      })
      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('wrong current password', () => {
    it('throws the generic 401 current_password_incorrect and writes nothing', async () => {
      verifyPasswordMock.mockResolvedValue(false)

      await expect(changePassword(event, validBody)).rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'current_password_incorrect'
      })

      // Verify ran (against the stored hash and the supplied current password), later steps did not.
      expect(verifyPasswordMock).toHaveBeenCalledWith(STORED_HASH, validBody.currentPassword)
      expect(isBreachedMock).not.toHaveBeenCalled()
      expect(hashPasswordMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })
  })

  describe('unchanged password', () => {
    // Verified current password, but the new one equals it: rejected as password_unchanged before
    // the breach check and before any hashing or write.
    it('throws 422 password_unchanged and writes nothing', async () => {
      const body = {
        currentPassword: 'same-password',
        newPassword: 'same-password',
        confirmNewPassword: 'same-password'
      }
      verifyPasswordMock.mockResolvedValue(true)

      await expect(changePassword(event, body)).rejects.toMatchObject({
        statusCode: 422,
        statusMessage: 'password_unchanged'
      })

      expect(isBreachedMock).not.toHaveBeenCalled()
      expect(hashPasswordMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })
  })

  describe('breached new password', () => {
    it('throws 422 password_breached and writes nothing', async () => {
      isBreachedMock.mockResolvedValue(true)

      await expect(changePassword(event, validBody)).rejects.toMatchObject({
        statusCode: 422,
        statusMessage: 'password_breached'
      })

      // The breach check ran on the new password; hashing and the write never happened.
      expect(isBreachedMock).toHaveBeenCalledWith(validBody.newPassword)
      expect(hashPasswordMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })
  })

  describe('HIBP outage (breach check fails open)', () => {
    // isPasswordBreached returns false on an outage, so a legitimate change must proceed to commit.
    it('proceeds with the change when the breach check returns false', async () => {
      isBreachedMock.mockResolvedValue(false)

      await expect(changePassword(event, validBody)).resolves.toEqual({ success: true })

      expect(hashPasswordMock).toHaveBeenCalledWith(validBody.newPassword)
      expect(updateMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('success', () => {
    it('hashes the new password, writes one atomic update scoped to the session user, and refreshes the session', async () => {
      const result = await changePassword(event, validBody)

      expect(result).toEqual({ success: true })

      // Exactly one atomic mutation on the users table.
      expect(hashPasswordMock).toHaveBeenCalledWith(validBody.newPassword)
      expect(updateMock).toHaveBeenCalledTimes(1)
      expect(updateMock).toHaveBeenCalledWith(users)

      // The set payload carries the new hash and an updatedAt timestamp, and no plaintext.
      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(setArg.passwordHash).toBe('new-hash')
      expect(setArg.updatedAt).toBeInstanceOf(Date)
      expect(JSON.stringify(setArg)).not.toContain(validBody.newPassword)

      // The write is scoped to the session user.id (via eq(users.id, user.id)), never a body id.
      expect(updateWhereMock).toHaveBeenCalledTimes(1)
      const whereArg = updateWhereMock.mock.calls[0]?.[0] as { __col: unknown; __val: unknown }
      expect(whereArg.__col).toBe(users.id)
      expect(whereArg.__val).toBe(SESSION_USER.id)

      // The current session is refreshed carrying the existing user unchanged.
      expect(setUserSessionMock).toHaveBeenCalledTimes(1)
      expect(setUserSessionMock).toHaveBeenCalledWith(event, { user: SESSION_USER })
    })

    it('runs the steps in the spec order: verify, breach, hash, update, session', async () => {
      await changePassword(event, validBody)

      expect(order).toEqual(['verify', 'breach', 'hash', 'update', 'session'])
    })

    it('never passes any password or hash to a logger', async () => {
      const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
      const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))

      await changePassword(event, validBody)

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
      }
    })
  })
})
