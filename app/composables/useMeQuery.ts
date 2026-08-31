import { useQuery } from '@tanstack/vue-query'

import { queryKeys } from '~/queries/keys'

// The current user's display shape, read fresh from the database by GET /api/me. It mirrors the
// columns that handler selects and is the client-side contract for this query.
export interface MeUser {
  avatarUrl: string | null
  // Whether the admin onboarding reset is offered to this caller. Derived server-side as the role
  // being exactly admin AND the private onboardingResetEnabled switch being on, so it arrives as one
  // finished answer and no client recombines those two facts. Optional because the session-seeded
  // initialData below genuinely cannot carry it, and an absent value reads as false.
  canResetOnboarding?: boolean
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
//
// The seed deliberately omits canResetOnboarding, because the sealed session cookie does not hold it
// and inventing a value here would be guessing at a server decision. It therefore reads as undefined
// until the authoritative fetch lands, which is what lets a consumer treat "not yet known" as "do not
// show" rather than showing something optimistically and taking it away. Putting the field on the
// session instead would have made a flipped switch wait for a sign-out, which is the same staleness
// this query exists to work around.
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
