import { useMutation, useQueryClient } from '@tanstack/vue-query'

import { queryKeys } from '~/queries/keys'

// Mutation for the avatar upload. It sends the chosen File as multipart/form-data under the `file`
// field to PUT /api/me/avatar, then refreshes the session so the new avatarUrl re-reads on the header
// and this page, and invalidates the current-user key so any query reader re-reads. The server
// re-verifies and processes the bytes; a rejected file surfaces as a typed 422 the caller maps.
export function useUploadAvatarMutation() {
  const queryClient = useQueryClient()
  const { fetch: refreshSession } = useUserSession()

  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('file', file)
      return $fetch('/api/me/avatar', { method: 'PUT', body })
    },
    onSuccess: async () => {
      await refreshSession()
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() })
    }
  })
}
