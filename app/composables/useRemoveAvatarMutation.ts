import { useMutation, useQueryClient } from '@tanstack/vue-query'

import { queryKeys } from '~/queries/keys'

// Mutation for removing the stored avatar. It DELETEs /api/me/avatar (idempotent server-side), then
// refreshes the session so avatarUrl re-reads as null and the initials circle returns on the header
// and this page, and invalidates the current-user key so any query reader re-reads. This is the write
// whose missing invalidation left a stale image; both refresh and invalidate now run in onSuccess.
export function useRemoveAvatarMutation() {
  const queryClient = useQueryClient()
  const { fetch: refreshSession } = useUserSession()

  return useMutation({
    mutationFn: () => $fetch('/api/me/avatar', { method: 'DELETE' }),
    onSuccess: async () => {
      await refreshSession()
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() })
    }
  })
}
