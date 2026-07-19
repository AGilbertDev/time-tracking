export default defineNuxtRouteMiddleware(() => {
  const { user } = useUserSession()
  const localePath = useLocalePath()

  // Client-side affordance only. The server admin wrapper (defineAdminEventHandler) is the
  // real gate on every admin API route; this just keeps a non-admin from landing on a page
  // they cannot use. isAdmin is the same strict === 'admin' check the header menu uses, so a
  // missing role (a session minted before the role field shipped) fails closed and is sent
  // to the dashboard. The global auth middleware already handles the unauthenticated case.
  if (!isAdmin(user.value?.role)) return navigateTo(localePath('index'))
})
