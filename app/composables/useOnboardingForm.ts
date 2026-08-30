import type { InjectionKey } from 'vue'

import type { Locale, ThemeId } from '#shared/theme'

// The full wizard state, held once on the onboarding page and shared with every step. The
// page owns the reactive object and provides it under ONBOARDING_FORM_KEY; each step reads it
// back through useOnboardingForm and writes its own fields. Sharing the reactive object keeps
// one source of truth across the steps without copying values back and forth on navigation.
// The confirm field is the client-only password confirmation and is never sent to the server.
export interface OnboardingForm {
  confirm: string
  dailyWorkMinutes: number
  darkTheme: ThemeId
  firstName: string
  lastName: string
  lightTheme: ThemeId
  locale: Locale
  password: string
  timezone: string
  workDays: number[]
}

// The injection key for the shared wizard form. It carries the form type so both the page that
// provides it and the steps that inject it stay in sync on the field shape.
export const ONBOARDING_FORM_KEY = Symbol('onboarding-form') as InjectionKey<OnboardingForm>

// Reads the shared wizard form provided by the onboarding page. It throws when used outside the
// wizard so a step component can never silently render against undefined state.
export function useOnboardingForm(): OnboardingForm {
  const form = inject(ONBOARDING_FORM_KEY)
  if (!form) {
    throw new Error('useOnboardingForm must be used within the onboarding wizard.')
  }
  return form
}
