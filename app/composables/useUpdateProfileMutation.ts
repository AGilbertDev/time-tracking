import { useMutation, useQueryClient } from '@tanstack/vue-query'

import { queryKeys } from '~/queries/keys'

// The payload for the identity name write. It mirrors the two fields the server's ProfilePatchSchema
// validates and is the client-side contract for this mutation.
export interface UpdateProfilePayload {
  firstName: string
  lastName: string
}

// Mutation for the Profile page's name write. It PATCHes /api/me/profile, then refreshes the session
// (the source of truth for the user, read by the header and this page) and invalidates the
// current-user key so any query reader re-reads. Matches useCompleteOnboarding's shape so every write
// goes through the same mutation + invalidate idiom rather than a bare $fetch.
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient()
  const { fetch: refreshSession } = useUserSession()

  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) =>
      $fetch('/api/me/profile', { method: 'PATCH', body: payload }),
    onSuccess: async () => {
      await refreshSession()
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() })
    }
  })
}
