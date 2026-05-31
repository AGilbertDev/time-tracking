export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()
  const localePath = useLocalePath()
  const onboardingPath = localePath('onboarding')
  const signinPath = localePath('signin')
  const signupPath = localePath('signup')

  // Send unauthenticated visitors to the sign-in page. The sign-in and sign-up
  // pages stay reachable so they can authenticate or request an invite link.
  if (!loggedIn.value && to.path !== signinPath && to.path !== signupPath)
    return navigateTo(signinPath)

  // Force authenticated users who have not finished onboarding onto the onboarding page.
  // The path check exempts the onboarding page itself so the redirect cannot loop.
  if (loggedIn.value && !user.value?.onboarded && to.path !== onboardingPath)
    return navigateTo(onboardingPath)
})
