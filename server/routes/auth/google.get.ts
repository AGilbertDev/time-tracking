export default defineOAuthGoogleEventHandler({
  config: {
    scope: ['email', 'profile', 'openid']
  },
  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    })
    return sendRedirect(event, '/')
  }
})
