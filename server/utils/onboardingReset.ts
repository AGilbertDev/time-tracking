// Single-sourced availability of the admin onboarding reset.
//
// The feature exists so the owner can walk the first-run wizard again and compare it against the
// settings page during manual testing, and the owner has said its life is finite. So it ships with a
// switch that is not a code change, because an off switch that means deleting an endpoint, a page
// section and several test files is a pull request, and a pull request nobody opens leaves a
// destructive action live in a finished product.
//
// The decision is resolved here and only here rather than at each call site, which is the same
// arrangement server/utils/avatarStorage.ts uses for its driver. Two callers read it, the handler
// that performs the reset and GET /api/me, and they have to agree, because a control the client
// renders over an endpoint that refuses is a broken button.
//
// An explicit NUXT_ONBOARDING_RESET_ENABLED of 'true' or 'false' wins, so the endpoint can be
// exercised on a preview deploy or closed locally without editing anything. Anything else, including
// unset and including a typo, is treated as unset and the environment decides. import.meta.dev is
// true only under `nuxt dev`, so a production build can never silently leave the reset open, which is
// the same fail-closed reasoning that keeps the avatar driver off the filesystem in production.
//
// The parse is explicit rather than leaning on Nuxt coercing the environment string by the type of
// the default in nuxt.config.ts. Both would work, and this one is written down where it can be read
// and tested instead of depending on a coercion rule holding.
//
// This is one switch on one endpoint. It is deliberately not a feature-flag framework, there is no
// table behind it, no per-user targeting, and nothing else in the application is gated on it.
export function isOnboardingResetEnabled(): boolean {
  const configured = (useRuntimeConfig().onboardingResetEnabled as string | undefined)
    ?.trim()
    .toLowerCase()
  if (configured === 'true') return true
  if (configured === 'false') return false
  return import.meta.dev
}
