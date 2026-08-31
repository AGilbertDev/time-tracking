import { useMutation, useQueryClient } from '@tanstack/vue-query'

import { queryKeys } from '~/queries/keys'

// Mutation for the admin onboarding reset. It POSTs /api/admin/onboarding/reset, which takes no body
// and no target because the endpoint always acts on the session user, then refreshes the session (the
// source of truth for the user, and the thing that carries the cleared `onboarded` flag) and
// invalidates the current-user key so any query reader re-reads.
//
// The server decides what a reset means. Nothing here names a table, a column or a default, so the
// client cannot drift from the handler's enumeration and there is no second copy of the rule.
//
// The endpoint is idempotent, so calling it again is the documented recovery from a partial failure
// and this mutation needs no special-casing for an account that is already reset. The caller
// re-applies the theme and the locale after this resolves, because those live outside the query cache
// and outside the session refresh (see the frontend conventions), the same way the onboarding wizard
// does after its own write.
export function useResetOnboardingMutation() {
  const queryClient = useQueryClient()
  const { fetch: refreshSession } = useUserSession()

  return useMutation({
    mutationFn: () => $fetch('/api/admin/onboarding/reset', { method: 'POST' }),
    onSuccess: async () => {
      await refreshSession()
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() })
    }
  })
}
