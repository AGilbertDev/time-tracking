import { avatarBlobPath } from '~~/server/models/profile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// avatarStorage is the single module that talks to a storage backend for avatar bytes (spec
// "Storage-driver design"). This suite locks the behaviour fixed by docs/specs/settings/avatar-upload.md:
//   - Driver selection is single-sourced and environment-driven: an explicit
//     runtimeConfig.avatarStorageDriver ('fs' | 'blob') wins, otherwise import.meta.dev decides, and
//     production never silently falls back to the filesystem (criteria 6, 7, acceptance "Driver
//     selection").
//   - The blob driver fails closed on a missing token: put/del throw avatar_storage_unconfigured and
//     store nothing, while get returns null (a read never leaks and never raises the guard) (spec
//     "The avatar_storage_unconfigured guard", criterion 7).
//   - The storage key is ALWAYS avatarBlobPath(userId) derived inside the util; no caller path is ever
//     used (spec "Two drivers" / IDOR-by-construction, criterion 5).
//   - get returns null when the object is absent (spec put/get/del contract, serve 404 depends on it).
// The @vercel/blob boundary and the Nitro useStorage boundary are mocked at their seams so the
// assertions are about the util's own control flow, never a live blob store or filesystem. Expected
// values come from the spec, not from treating the implementation as correct.

const { blobPutMock, blobGetMock, blobDelMock } = vi.hoisted(() => ({
  blobPutMock: vi.fn(),
  blobGetMock: vi.fn(),
  blobDelMock: vi.fn()
}))

vi.mock('@vercel/blob', () => ({
  put: blobPutMock,
  get: blobGetMock,
  del: blobDelMock
}))

const { avatarStorage } = await import('~~/server/utils/avatarStorage')

const USER_ID = 'user-123'
const KEY = avatarBlobPath(USER_ID) // 'avatars/user-123.webp'
const TOKEN = 'blob-token'

// Auto-imported Nitro helpers the util calls as free identifiers. In the raw source (no Nuxt
// transform) they resolve to globalThis, so we stub them there. Reset per test.
const useRuntimeConfigMock = vi.fn()
const useStorageMock = vi.fn()

// The Nitro fs storage handle returned by useStorage(mount). Only the methods the util calls exist.
const fsStore = {
  setItemRaw: vi.fn(),
  getItemRaw: vi.fn(),
  hasItem: vi.fn(),
  removeItem: vi.fn()
}

// Configure driver + token for a test. Leaving driver empty exercises the environment default.
function config({ driver = '', token = TOKEN }: { driver?: string; token?: string } = {}) {
  useRuntimeConfigMock.mockReturnValue({
    avatarStorageDriver: driver,
    blobReadWriteToken: token
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('useRuntimeConfig', useRuntimeConfigMock)
  vi.stubGlobal('useStorage', useStorageMock)
  vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(opts.statusMessage), opts)
  )

  useStorageMock.mockReturnValue(fsStore)
  fsStore.setItemRaw.mockResolvedValue(undefined)
  fsStore.getItemRaw.mockResolvedValue(null)
  fsStore.hasItem.mockResolvedValue(false)
  fsStore.removeItem.mockResolvedValue(undefined)
  config()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('avatarStorage driver selection', () => {
  // Explicit runtimeConfig.avatarStorageDriver wins over the environment default (spec: overridable,
  // single-sourced). 'fs' routes writes through useStorage and never touches @vercel/blob.
  it("uses the fs driver when runtimeConfig.avatarStorageDriver is 'fs'", async () => {
    config({ driver: 'fs' })

    await avatarStorage.put(USER_ID, Buffer.from('x'), 'image/webp')

    expect(useStorageMock).toHaveBeenCalled()
    expect(fsStore.setItemRaw).toHaveBeenCalledTimes(1)
    expect(blobPutMock).not.toHaveBeenCalled()
  })

  // 'blob' routes writes through @vercel/blob and never touches the filesystem.
  it("uses the blob driver when runtimeConfig.avatarStorageDriver is 'blob'", async () => {
    config({ driver: 'blob' })

    await avatarStorage.put(USER_ID, Buffer.from('x'), 'image/webp')

    expect(blobPutMock).toHaveBeenCalledTimes(1)
    expect(fsStore.setItemRaw).not.toHaveBeenCalled()
  })

  // With no explicit driver configured, this non-dev (vitest node) environment must select the blob
  // driver, never the filesystem. This is the "production never silently falls back to fs" guarantee.
  it('never falls back to the fs driver when no driver is configured outside dev', async () => {
    config({ driver: '' })

    await avatarStorage.put(USER_ID, Buffer.from('x'), 'image/webp')

    expect(blobPutMock).toHaveBeenCalledTimes(1)
    expect(fsStore.setItemRaw).not.toHaveBeenCalled()
  })
})

describe('avatarStorage.put', () => {
  it('stores the bytes on the blob driver at the deterministic per-user key with private access and the token', async () => {
    config({ driver: 'blob' })

    await avatarStorage.put(USER_ID, Buffer.from('processed'), 'image/webp')

    expect(blobPutMock).toHaveBeenCalledTimes(1)
    const [key, body, opts] = blobPutMock.mock.calls[0] as [string, Buffer, Record<string, unknown>]
    // The key is always avatarBlobPath(userId); no caller path is passed.
    expect(key).toBe(KEY)
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(opts).toMatchObject({
      access: 'private',
      contentType: 'image/webp',
      token: TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true
    })
  })

  it('stores the bytes on the fs driver at the deterministic per-user key, no token required', async () => {
    config({ driver: 'fs', token: '' })

    await avatarStorage.put(USER_ID, Buffer.from('processed'), 'image/webp')

    const [key, body] = fsStore.setItemRaw.mock.calls[0] as [string, Buffer]
    expect(key).toBe(KEY)
    expect(Buffer.isBuffer(body)).toBe(true)
    // The fs driver never raises the unconfigured guard even with no token.
    expect(blobPutMock).not.toHaveBeenCalled()
  })

  it('fails closed with 500 avatar_storage_unconfigured and stores nothing when the blob token is empty', async () => {
    config({ driver: 'blob', token: '' })

    await expect(avatarStorage.put(USER_ID, Buffer.from('x'), 'image/webp')).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'avatar_storage_unconfigured'
    })
    expect(blobPutMock).not.toHaveBeenCalled()
  })
})

describe('avatarStorage.get', () => {
  it('returns the stored bytes on the blob driver when the object exists', async () => {
    config({ driver: 'blob' })
    const bytes = Buffer.from('avatar-bytes')
    blobGetMock.mockResolvedValue({ statusCode: 200, stream: bytes })

    const result = await avatarStorage.get(USER_ID)

    expect(result).not.toBeNull()
    expect(Buffer.from(result!).equals(bytes)).toBe(true)
    // Read fresh from origin at the deterministic key (no caller path).
    const [key] = blobGetMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(key).toBe(KEY)
  })

  it('returns null on the blob driver when the object is absent (non-200)', async () => {
    config({ driver: 'blob' })
    blobGetMock.mockResolvedValue({ statusCode: 404, stream: null })

    expect(await avatarStorage.get(USER_ID)).toBeNull()
  })

  it('returns null on the blob driver when get resolves to nothing', async () => {
    config({ driver: 'blob' })
    blobGetMock.mockResolvedValue(null)

    expect(await avatarStorage.get(USER_ID)).toBeNull()
  })

  it('returns null (never throws) on the blob driver when the token is empty, and never reads the store', async () => {
    // A read never applies the fail-closed guard: a missing token yields null so no bytes leak and the
    // serve route turns that into a 404.
    config({ driver: 'blob', token: '' })

    expect(await avatarStorage.get(USER_ID)).toBeNull()
    expect(blobGetMock).not.toHaveBeenCalled()
  })

  it('returns the stored bytes on the fs driver at the deterministic key', async () => {
    config({ driver: 'fs', token: '' })
    const bytes = Buffer.from('fs-avatar-bytes')
    fsStore.getItemRaw.mockResolvedValue(bytes)

    const result = await avatarStorage.get(USER_ID)

    expect(result).toBe(bytes)
    expect(fsStore.getItemRaw).toHaveBeenCalledWith(KEY)
  })

  it('returns null on the fs driver when nothing is stored', async () => {
    config({ driver: 'fs', token: '' })
    fsStore.getItemRaw.mockResolvedValue(null)

    expect(await avatarStorage.get(USER_ID)).toBeNull()
  })

  it('returns null on the fs driver when the raw read is undefined', async () => {
    config({ driver: 'fs', token: '' })
    fsStore.getItemRaw.mockResolvedValue(undefined)

    expect(await avatarStorage.get(USER_ID)).toBeNull()
  })
})

describe('avatarStorage.del', () => {
  it('deletes the object on the blob driver at the deterministic key with the token', async () => {
    config({ driver: 'blob' })

    await avatarStorage.del(USER_ID)

    expect(blobDelMock).toHaveBeenCalledWith(KEY, { token: TOKEN })
  })

  it('fails closed with 500 avatar_storage_unconfigured when the blob token is empty', async () => {
    config({ driver: 'blob', token: '' })

    await expect(avatarStorage.del(USER_ID)).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'avatar_storage_unconfigured'
    })
    expect(blobDelMock).not.toHaveBeenCalled()
  })

  it('removes the object on the fs driver when it exists', async () => {
    config({ driver: 'fs', token: '' })
    fsStore.hasItem.mockResolvedValue(true)

    await avatarStorage.del(USER_ID)

    expect(fsStore.hasItem).toHaveBeenCalledWith(KEY)
    expect(fsStore.removeItem).toHaveBeenCalledWith(KEY)
  })

  it('is a safe no-op on the fs driver when nothing is stored', async () => {
    config({ driver: 'fs', token: '' })
    fsStore.hasItem.mockResolvedValue(false)

    await avatarStorage.del(USER_ID)

    expect(fsStore.removeItem).not.toHaveBeenCalled()
  })
})
