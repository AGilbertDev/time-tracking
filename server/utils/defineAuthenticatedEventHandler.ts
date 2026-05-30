import type { H3Event } from 'h3'

// Ensures every protected route has a valid session before running, throwing 401 automatically.
export function defineAuthenticatedEventHandler<T>(handler: (event: H3Event) => T) {
  return defineEventHandler(async (event) => {
    await requireUserSession(event)
    return handler(event)
  })
}
