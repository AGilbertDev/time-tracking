import { useQuery } from '@tanstack/vue-query'

import { queryKeys } from '~/queries/keys'

// The current user's display shape, read fresh from the database by GET /api/me. It mirrors the
// columns that handler selects and is the client-side contract for this query.
export interface MeUser {
  avatarUrl: string | null
  email: string
  firstName: string | null
  id: string
  lastName: string | null
  role: string
}

// Read-side companion to the four mutations that invalidate queryKeys.me(). The avatar, name, and
// email display everywhere reads through this query rather than useUserSession().user, whose sealed
// cookie serves a stale avatarUrl after an avatar mutation. Because the mutations invalidate
// queryKeys.me() in onSuccess, every active useMeQuery refetches /api/me and the fresh database
// values render, which is what fixes the stale/broken avatar.
//
// initialData is seeded from the session user, which already carries the same fields, so the first
// paint and SSR use the session value with no fetch and no loading flash. staleTime 0 keeps the data
// immediately stale so an invalidation (or a mount) refetches the authoritative row.
export function useMeQuery() {
  const { user } = useUserSession()

  return useQuery<MeUser>({
    queryKey: queryKeys.me(),
    queryFn: () => $fetch('/api/me'),
    initialData: () => {
      const current = user.value
      if (!current) return undefined
      return {
        avatarUrl: current.avatarUrl,
        email: current.email,
        firstName: current.firstName,
        id: current.id,
        lastName: current.lastName,
        role: current.role
      }
    },
    staleTime: 0
  })
}
