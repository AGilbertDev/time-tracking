import { useMutation, useQueryClient } from '@tanstack/vue-query'

import { queryKeys } from '~/queries/keys'

// The payload for the onboarding write. It mirrors the fields the server's CompleteOnboarding schema
// validates and is the client-side contract for this mutation.
export interface CompleteOnboardingPayload {
  dailyWorkMinutes: number
  darkTheme: string
  firstName: string
  lastName: string
  lightTheme: string
  locale: string
  password: string
  timezone: string
  workDays: number[]
}

// Mutation for the onboarding wizard's single submit. It writes the profile and settings in one
// request, then refreshes the session (the source of truth for the user) and invalidates the
// current-user key so any reader re-reads. The page applies the session-derived theme and locale
// after this resolves, since those live outside the query cache (see the frontend conventions).
export function useCompleteOnboarding() {
  const queryClient = useQueryClient()
  const { fetch: refreshSession } = useUserSession()

  return useMutation({
    mutationFn: (payload: CompleteOnboardingPayload) =>
      $fetch('/api/onboarding/complete', { method: 'POST', body: payload }),
    onSuccess: async () => {
      await refreshSession()
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() })
    }
  })
}
