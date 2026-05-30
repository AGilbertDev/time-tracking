export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  const localePath = useLocalePath()

  const loginPath = localePath('login')

  if (!loggedIn.value && to.path !== loginPath) {
    return navigateTo(loginPath)
  }
})
