export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  const localePath = useLocalePath()

  if (!loggedIn.value && to.path !== localePath('/login')) {
    return navigateTo(localePath('/login'))
  }
})
