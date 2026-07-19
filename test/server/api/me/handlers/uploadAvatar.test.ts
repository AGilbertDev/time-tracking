import { users } from '~~/server/db/schema'
import {
  AVATAR_MAX_INPUT_PIXELS,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_OUTPUT_SIZE
} from '~~/server/models/profile'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// uploadAvatar is the handler behind PUT /api/me/avatar. This suite locks the behaviour and the
// no-invalid-states ORDERING that docs/specs/settings/avatar-upload.md fixes: the handler step list
// under "PUT /api/me/avatar", the "Ordering and compensation" section, and acceptance criteria
// 2, 3, 5, 9, 13. The backend was reworked from a direct @vercel/blob call to a single storage util
// (server/utils/avatarStorage), so the store seam is now avatarStorage.put/del, the token guard lives
// inside that util (no handler-level pre-check), and the persisted URL is a same-origin proxy path
// (/api/me/avatar?v=<ts>) rather than a public blob URL. Every boundary is mocked at its seam (the
// storage util, the sharp pipeline, the Drizzle update, the session, and the multipart read) so the
// assertions are about the handler's control flow, never a live store, real image processing, or a
// live DB. The expected codes, order, and store arguments come from the spec, not from treating the
// implementation as correct.

// Hoisted spies so the vi.mock factories can reference them. An order log proves the store-first,
// row-second sequence the spec mandates for upload, and the store -> update -> del compensation.
const {
  putMock,
  delMock,
  sharpMock,
  metadataMock,
  rotateMock,
  resizeMock,
  webpMock,
  toBufferMock,
  updateMock,
  setMock,
  updateWhereMock,
  eqMock,
  order
} = vi.hoisted(() => {
  const order: string[] = []
  const metadataMock = vi.fn()
  const toBufferMock = vi.fn()
  const rotateMock = vi.fn()
  const resizeMock = vi.fn()
  const webpMock = vi.fn()
  // The sharp chain: sharp(buffer, opts).metadata() reads the real format; the second call
  // sharp(buffer, opts).rotate().resize(...).webp(...).toBuffer() processes. Both calls return the
  // same chainable instance; rotate/resize/webp return the instance so the chain composes.
  const sharpInstance = {
    metadata: metadataMock,
    rotate: rotateMock,
    resize: resizeMock,
    webp: webpMock,
    toBuffer: toBufferMock
  }
  rotateMock.mockReturnValue(sharpInstance)
  resizeMock.mockReturnValue(sharpInstance)
  webpMock.mockReturnValue(sharpInstance)
  const updateWhereMock = vi.fn()
  const setMock = vi.fn(() => ({ where: updateWhereMock }))
  const updateMock = vi.fn(() => ({ set: setMock }))
  return {
    putMock: vi.fn(),
    delMock: vi.fn(),
    sharpMock: vi.fn(() => sharpInstance),
    metadataMock,
    rotateMock,
    resizeMock,
    webpMock,
    toBufferMock,
    updateMock,
    setMock,
    updateWhereMock,
    // eq is recorded as a marker so a where() argument can be inspected for its scoping value.
    eqMock: vi.fn((col: unknown, val: unknown) => ({ __col: col, __val: val })),
    order
  }
})

// The single storage seam. The handler no longer imports @vercel/blob or selects a driver; every
// byte operation goes through avatarStorage, and the token fail-closed guard lives inside put/del.
vi.mock('~~/server/utils/avatarStorage', () => ({
  avatarStorage: { put: putMock, del: delMock, get: vi.fn() }
}))
vi.mock('sharp', () => ({ default: sharpMock }))

vi.mock('~~/server/db/index', () => {
  const db = { update: updateMock }
  return { useDb: () => db }
})

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return { ...actual, eq: eqMock }
})

const { uploadAvatar } = await import('~~/server/api/me/handlers/uploadAvatar')

const PROCESSED = Buffer.from('processed-webp-bytes')

const SESSION_USER = {
  id: 'user-123',
  firstName: 'Alexandre',
  email: 'a@example.com',
  avatarUrl: null as string | null
}

// The persisted value is a same-origin proxy path with a cache-busting version, not a store URL.
const PROXY_PATH_RE = /^\/api\/me\/avatar\?v=\d+$/

// Auto-imported Nitro / nuxt-auth-utils helpers the handler calls as free identifiers. In the raw
// source (no Nuxt transform) they resolve to globalThis, so we stub them there. Reset per test.
const requireUserSessionMock = vi.fn()
const setUserSessionMock = vi.fn()
const readMultipartFormDataMock = vi.fn()

const event = { __event: true } as never

function stubGlobals() {
  vi.stubGlobal('requireUserSession', requireUserSessionMock)
  vi.stubGlobal('setUserSession', setUserSessionMock)
  vi.stubGlobal('readMultipartFormData', readMultipartFormDataMock)
  // A minimal createError that carries statusCode, statusMessage, and data so branches (including
  // the typed 422 data.file reason) can be asserted.
  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string; data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
}

// Builds a multipart file part. A real file part carries a filename; the handler filters on
// name === 'file' && filename !== undefined.
function filePart(
  data: Buffer | undefined,
  {
    name = 'file',
    filename = 'photo.png' as string | undefined,
    type = 'image/png'
  }: { name?: string; filename?: string; type?: string } = {}
) {
  return { name, filename, type, data }
}

const VALID_BUFFER = Buffer.alloc(2048, 1)

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  stubGlobals()

  requireUserSessionMock.mockResolvedValue({ user: { ...SESSION_USER } })
  readMultipartFormDataMock.mockResolvedValue([filePart(VALID_BUFFER)])

  // Happy-path sharp: decodes as jpeg and yields the processed buffer.
  metadataMock.mockResolvedValue({ format: 'jpeg' })
  rotateMock.mockReturnValue({
    resize: resizeMock,
    webp: webpMock,
    toBuffer: toBufferMock,
    metadata: metadataMock,
    rotate: rotateMock
  })
  resizeMock.mockReturnValue({ webp: webpMock, toBuffer: toBufferMock })
  webpMock.mockReturnValue({ toBuffer: toBufferMock })
  toBufferMock.mockResolvedValue(PROCESSED)

  putMock.mockImplementation(async () => {
    order.push('put')
  })
  delMock.mockImplementation(async () => {
    order.push('del')
  })
  updateWhereMock.mockImplementation(async () => {
    order.push('update')
  })
  setUserSessionMock.mockImplementation(async () => {
    order.push('session')
  })
})

describe('uploadAvatar', () => {
  describe('malformed multipart body (wrong-type, spec step 3)', () => {
    it('rejects 422 wrong-type when there is no body at all', async () => {
      readMultipartFormDataMock.mockResolvedValue(null)

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        statusMessage: 'wrong-type',
        data: { file: 'wrong-type' }
      })
      expect(putMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('rejects 422 wrong-type when no part is named file with a filename', async () => {
      readMultipartFormDataMock.mockResolvedValue([
        { name: 'other', filename: 'x.png', type: 'image/png', data: VALID_BUFFER },
        // A field without a filename is not a file part.
        { name: 'file', filename: undefined, type: 'text/plain', data: Buffer.from('hi') }
      ])

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        data: { file: 'wrong-type' }
      })
      expect(putMock).not.toHaveBeenCalled()
    })

    it('rejects 422 wrong-type when more than one file part is sent', async () => {
      readMultipartFormDataMock.mockResolvedValue([
        filePart(VALID_BUFFER),
        filePart(VALID_BUFFER, { filename: 'second.png' })
      ])

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        data: { file: 'wrong-type' }
      })
      expect(putMock).not.toHaveBeenCalled()
    })

    it('rejects 422 wrong-type when the single file part is empty', async () => {
      readMultipartFormDataMock.mockResolvedValue([filePart(Buffer.alloc(0))])

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        data: { file: 'wrong-type' }
      })
      expect(putMock).not.toHaveBeenCalled()
    })
  })

  describe('oversized upload (too-large, spec step 4, criterion 9)', () => {
    it('rejects 422 too-large against the received buffer length, before any processing or store', async () => {
      // One byte over the ceiling, checked against the actual buffer, not a client header.
      readMultipartFormDataMock.mockResolvedValue([
        filePart(Buffer.alloc(AVATAR_MAX_UPLOAD_BYTES + 1))
      ])

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        statusMessage: 'too-large',
        data: { file: 'too-large' }
      })

      // No decode, no store, no write.
      expect(sharpMock).not.toHaveBeenCalled()
      expect(putMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('content verification, not trust (spec step 5, criterion 9)', () => {
    it('rejects 422 wrong-type when the real decoded format is disallowed even if the mime is spoofed', async () => {
      // Client declares image/png, but the bytes actually decode as gif.
      readMultipartFormDataMock.mockResolvedValue([filePart(VALID_BUFFER, { type: 'image/png' })])
      metadataMock.mockResolvedValue({ format: 'gif' })

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        data: { file: 'wrong-type' }
      })
      expect(putMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('rejects 422 wrong-type for SVG, which is decodable but not an allowed raster format', async () => {
      metadataMock.mockResolvedValue({ format: 'svg' })

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        data: { file: 'wrong-type' }
      })
      expect(putMock).not.toHaveBeenCalled()
    })

    it('applies the decompression-bomb guard (limitInputPixels) when decoding', async () => {
      await uploadAvatar(event)

      expect(sharpMock).toHaveBeenCalledWith(VALID_BUFFER, {
        limitInputPixels: AVATAR_MAX_INPUT_PIXELS
      })
    })
  })

  describe('undecodable / corrupt image (undecodable, spec step 5-6, criterion 9)', () => {
    it('rejects 422 undecodable when sharp throws reading metadata', async () => {
      metadataMock.mockRejectedValue(new Error('unsupported image format'))

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        statusMessage: 'undecodable',
        data: { file: 'undecodable' }
      })
      expect(putMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('rejects 422 undecodable when the processing pipeline throws after a good metadata read', async () => {
      // metadata reports an allowed format but the encode step fails on a truncated/corrupt file.
      metadataMock.mockResolvedValue({ format: 'png' })
      toBufferMock.mockRejectedValue(new Error('vips decode error'))

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        statusMessage: 'undecodable',
        data: { file: 'undecodable' }
      })
      expect(putMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })

    it('rejects 422 when metadata returns no format, and stores nothing', async () => {
      // Spec: a file sharp cannot resolve to a known format is a 422 and nothing is stored. The
      // handler maps the no-format branch to wrong-type; the hard guarantee asserted here is the 422
      // and that nothing is stored or written.
      metadataMock.mockResolvedValue({ format: undefined })

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 422,
        data: { file: 'wrong-type' }
      })
      expect(putMock).not.toHaveBeenCalled()
      expect(updateMock).not.toHaveBeenCalled()
    })
  })

  describe('happy path (criteria 2, 3)', () => {
    it.each(['jpeg', 'png', 'webp'])(
      'accepts a valid %s and persists a same-origin proxy path',
      async (format) => {
        metadataMock.mockResolvedValue({ format })

        const result = await uploadAvatar(event)

        expect(result.avatarUrl).toMatch(PROXY_PATH_RE)
        expect(putMock).toHaveBeenCalledTimes(1)
      }
    )

    it('runs the sharp pipeline as a 256x256 cover-crop WebP encode', async () => {
      await uploadAvatar(event)

      expect(rotateMock).toHaveBeenCalledTimes(1)
      expect(resizeMock).toHaveBeenCalledWith(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, {
        fit: 'cover',
        position: 'centre'
      })
      expect(webpMock).toHaveBeenCalledTimes(1)
    })

    it('stores the processed buffer through avatarStorage keyed by the session user id, as webp', async () => {
      await uploadAvatar(event)

      // Store call is avatarStorage.put(user.id, PROCESSED, 'image/webp'). The key is derived from
      // the session user id inside the util; no path, URL, or client id is passed by the handler.
      expect(putMock).toHaveBeenCalledTimes(1)
      expect(putMock).toHaveBeenCalledWith(SESSION_USER.id, PROCESSED, 'image/webp')
    })

    it('persists the proxy path to users.avatar_url scoped to the session user, and returns it', async () => {
      const result = await uploadAvatar(event)

      expect(updateMock).toHaveBeenCalledTimes(1)
      expect(updateMock).toHaveBeenCalledWith(users)

      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>
      expect(setArg.avatarUrl).toBe(result.avatarUrl)
      expect(setArg.avatarUrl).toMatch(PROXY_PATH_RE)
      expect(setArg.updatedAt).toBeInstanceOf(Date)

      // Scoped to the session user.id via eq(users.id, user.id), never a body id.
      const whereArg = updateWhereMock.mock.calls[0]?.[0] as { __col: unknown; __val: unknown }
      expect(whereArg.__col).toBe(users.id)
      expect(whereArg.__val).toBe(SESSION_USER.id)
    })

    it('refreshes the session carrying the new avatarUrl and returns { avatarUrl }', async () => {
      const result = await uploadAvatar(event)

      expect(setUserSessionMock).toHaveBeenCalledTimes(1)
      const sessionArg = setUserSessionMock.mock.calls[0]?.[1] as { user: { avatarUrl: string } }
      expect(sessionArg.user.avatarUrl).toBe(result.avatarUrl)
      expect(result).toEqual({ avatarUrl: result.avatarUrl })
    })
  })

  describe('no invalid states: ordering and compensation (criterion 13)', () => {
    it('stores the object BEFORE updating the row, then refreshes the session', async () => {
      await uploadAvatar(event)

      // Store first, row second, session last. No compensating del on a successful upload.
      expect(order).toEqual(['put', 'update', 'session'])
      expect(delMock).not.toHaveBeenCalled()
    })

    it('surfaces a store failure as an error and persists nothing (store-failure branch)', async () => {
      putMock.mockRejectedValue(new Error('storage network down'))

      await expect(uploadAvatar(event)).rejects.toThrow('storage network down')

      // Nothing written to the row, session untouched: no dangling reference.
      expect(updateMock).not.toHaveBeenCalled()
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })

    it('compensates with del(user.id) and returns 500 when the row update fails after a successful store', async () => {
      updateWhereMock.mockImplementation(async () => {
        order.push('update')
        throw new Error('db write failed')
      })

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 500,
        statusMessage: 'avatar_persist_failed'
      })

      // The just-written object is deleted to avoid an orphan; del is keyed off the session user id.
      expect(delMock).toHaveBeenCalledWith(SESSION_USER.id)
      // Store happened, update was attempted and failed, then the compensating delete ran.
      expect(order).toEqual(['put', 'update', 'del'])
      // The session is never refreshed on a failed persist.
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })

    it('still returns 500 when the compensating del() also fails (orphan self-heals on next upload)', async () => {
      updateWhereMock.mockImplementation(async () => {
        throw new Error('db write failed')
      })
      delMock.mockRejectedValue(new Error('del failed too'))

      await expect(uploadAvatar(event)).rejects.toMatchObject({
        statusCode: 500,
        statusMessage: 'avatar_persist_failed'
      })
      expect(setUserSessionMock).not.toHaveBeenCalled()
    })
  })
})
