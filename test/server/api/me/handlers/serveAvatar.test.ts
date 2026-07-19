import { beforeEach, describe, expect, it, vi } from 'vitest'

// serveAvatar is the handler behind GET /api/me/avatar. This suite locks the behaviour fixed by
// docs/specs/settings/avatar-upload.md ("GET /api/me/avatar" step list, acceptance criteria 4 and 5):
//   - The session is enforced IN THE HANDLER, so an unauthenticated request is 401 before any storage
//     read (no bytes leak).
//   - When avatarStorage.get returns null the response is a clean 404, never a 500 or empty 200.
//   - On success the bytes are returned with the hardening/private-cache headers: Content-Type
//     image/webp, X-Content-Type-Options nosniff, Cache-Control private, no-cache.
//   - The storage key is derived strictly from the session user.id; no id, path, or ?v= from the
//     request is ever read (no IDOR).
// avatarStorage is mocked at its module seam so the assertions are about the handler's control flow.
// Expected codes/headers come from the spec, not from treating the implementation as correct.

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('~~/server/utils/avatarStorage', () => ({
  avatarStorage: { get: getMock, put: vi.fn(), del: vi.fn() }
}))

const { serveAvatar } = await import('~~/server/api/me/handlers/serveAvatar')

const SESSION_USER = { id: 'user-123', firstName: 'Alexandre', email: 'a@example.com' }
const BYTES = Buffer.from('processed-webp-bytes')

// Auto-imported Nitro / nuxt-auth-utils helpers the handler calls as free identifiers. In the raw
// source (no Nuxt transform) they resolve to globalThis, so we stub them there. Reset per test.
const requireUserSessionMock = vi.fn()
const setResponseStatusMock = vi.fn()
const setResponseHeaderMock = vi.fn()

const event = { __event: true } as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('requireUserSession', requireUserSessionMock)
  vi.stubGlobal('setResponseStatus', setResponseStatusMock)
  vi.stubGlobal('setResponseHeader', setResponseHeaderMock)
  vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(opts.statusMessage), opts)
  )

  requireUserSessionMock.mockResolvedValue({ user: SESSION_USER })
  getMock.mockResolvedValue(BYTES)
})

describe('serveAvatar', () => {
  describe('session enforced in the handler (criterion 4)', () => {
    it('rejects with 401 and never reads the store when there is no session', async () => {
      // requireUserSession throws for an unauthenticated request; the handler must not read bytes.
      requireUserSessionMock.mockRejectedValue(
        Object.assign(new Error('unauthenticated'), { statusCode: 401 })
      )

      await expect(serveAvatar(event)).rejects.toMatchObject({ statusCode: 401 })
      expect(getMock).not.toHaveBeenCalled()
      expect(setResponseHeaderMock).not.toHaveBeenCalled()
    })
  })

  describe('no object stored (criterion 4)', () => {
    it('responds 404 and returns null when avatarStorage.get returns null, setting no image headers', async () => {
      getMock.mockResolvedValue(null)

      const result = await serveAvatar(event)

      expect(setResponseStatusMock).toHaveBeenCalledWith(event, 404)
      expect(result).toBeNull()
      // No image content-type or cache headers on the 404 path.
      expect(setResponseHeaderMock).not.toHaveBeenCalled()
    })
  })

  describe('success (criterion 4)', () => {
    it('returns the bytes with content-type, nosniff, and private no-cache headers', async () => {
      const result = await serveAvatar(event)

      expect(result).toBe(BYTES)
      expect(setResponseHeaderMock).toHaveBeenCalledWith(event, 'Content-Type', 'image/webp')
      expect(setResponseHeaderMock).toHaveBeenCalledWith(event, 'X-Content-Type-Options', 'nosniff')
      expect(setResponseHeaderMock).toHaveBeenCalledWith(
        event,
        'Cache-Control',
        'private, no-cache'
      )
      // A success never sets a 404 status.
      expect(setResponseStatusMock).not.toHaveBeenCalled()
    })
  })

  describe('no IDOR: key derived from the session user only (criterion 5)', () => {
    it('reads the store keyed by the session user id, ignoring any request-supplied identifier', async () => {
      await serveAvatar(event)

      // The handler passes only the session user.id to the util; there is no request id/path/?v= read.
      expect(getMock).toHaveBeenCalledTimes(1)
      expect(getMock).toHaveBeenCalledWith(SESSION_USER.id)
    })
  })
})
