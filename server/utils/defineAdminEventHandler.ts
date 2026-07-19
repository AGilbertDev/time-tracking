import type { H3Event } from 'h3'

// Wraps a handler so it runs only for an authenticated admin. It mirrors
// defineAuthenticatedEventHandler but adds a strict role check on top:
// requireUserSession throws 401 when there is no session, then any role that is not
// exactly 'admin' is rejected with 403. It fails closed, so a missing, unexpected, or
// non-'admin' role (including a session minted before the role field shipped) is denied
// rather than allowed. Every admin API route is defined through this wrapper, so the
// server is the real authorization boundary and hiding the UI menu item is only an
// affordance. The exact-match check matches isAdmin in app/utils/account.ts so the client
// and server gates agree.
export function defineAdminEventHandler<T>(handler: (event: H3Event) => T) {
  return defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    if (user.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'forbidden' })
    }
    return handler(event)
  })
}
