// Tearing down the auth session must also drop the cached preference cookies. Otherwise the next
// person to use this browser (a different user signing in, or the same one after a session expires)
// inherits the previous locale and colour mode until a hard refresh. The sessionHooks 'clear' hook
// runs for every session teardown: the logout endpoint and the clearUserSession call in
// validate-session (expiry or deactivation), so clearing here covers both in one audited place.
// Login rebuilds the locale cookie from the new user's settings through applyPreferenceCookies, and
// the theme is reseeded from the session on the fresh render, so nothing needs restoring here.
export default defineNitroPlugin(() => {
  sessionHooks.hook('clear', (_session, event) => {
    // Match the path the cookies were written with so the deletion actually takes effect.
    deleteCookie(event, 'i18n_redirected', { path: '/' })
    deleteCookie(event, 'nuxt-color-mode', { path: '/' })
  })
})
