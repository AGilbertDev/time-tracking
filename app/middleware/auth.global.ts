export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()
  const localePath = useLocalePath()
  const onboardingPath = localePath('onboarding')

  const loginPath = localePath('login')

  // Send unauthenticated visitors to the login page unless they are already there.
  if (!loggedIn.value && to.path !== loginPath) return navigateTo(loginPath)

  // Force authenticated users who have not finished onboarding onto the onboarding page.
  // The path check exempts the onboarding page itself so the redirect cannot loop.
  if (loggedIn.value && !user.value?.onboarded && to.path !== onboardingPath)
    return navigateTo(onboardingPath)
})
