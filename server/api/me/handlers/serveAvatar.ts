import type { H3Event } from 'h3'

import { avatarStorage } from '../../../utils/avatarStorage'

// GET /api/me/avatar. Serves the session user's own stored avatar bytes, private and authenticated.
// The session is enforced IN THE HANDLER (not middleware-only) so private-store authorization is
// checked in the request path: an unauthenticated request is 401 before any storage read. The storage
// key is derived strictly from the session user.id; no id, path, or key is read from the request and
// the ?v= query is a cache-buster only, so no request can address another user's avatar (no IDOR).
export async function serveAvatar(event: H3Event) {
  const { user } = await requireUserSession(event)

  const bytes = await avatarStorage.get(user.id)
  if (!bytes) {
    // No object stored (column set but object missing, or a direct hit with no avatar): a clean 404,
    // never a 500 or an empty 200. The frontend falls back to the initials circle.
    setResponseStatus(event, 404)
    return null
  }

  // Content-type hardening and private caching for personal data: nosniff blocks MIME-sniffing, and
  // private, no-cache keeps the image out of shared caches and forces revalidation.
  setResponseHeader(event, 'Content-Type', 'image/webp')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Cache-Control', 'private, no-cache')

  return bytes
}
