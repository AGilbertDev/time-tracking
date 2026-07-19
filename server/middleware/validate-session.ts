import { eq } from 'drizzle-orm'

import { useDb } from '../db/index'
import { users } from '../db/schema'

// Sessions are stateless signed cookies, so a user deleted or deactivated in the database would
// otherwise keep a valid cookie until it expires. This revalidates the session against the database
// on each request that carries one. When the account is gone or deactivated it clears the session
// and, for a page navigation, redirects to sign-in on this same request. Clearing alone only expires
// the cookie on the response, which the current server render still does not see, so without the
// redirect the user would stay on the page until a second refresh. Requests without a session skip
// the query, so only authenticated traffic pays for it.
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const userId = session?.user?.id
  if (!userId) return

  const record = await useDb()
    .select({ id: users.id, deactivatedAt: users.deactivatedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (record && !record.deactivatedAt) return

  await clearUserSession(event)

  // Only redirect a real page navigation, and never the auth pages themselves, so there is no loop
  // and API or asset requests are left untouched. The sign-in locale follows the persisted i18n
  // cookie so an English user is not dropped onto the French route.
  const accept = getRequestHeader(event, 'accept') ?? ''
  const isPageNav = event.method === 'GET' && accept.includes('text/html')
  const onAuthPage = /\/(connexion|signin|inscription|signup)(\/|\?|$)/.test(event.path ?? '')
  if (isPageNav && !onAuthPage) {
    const locale = getCookie(event, 'i18n_redirected')
    await sendRedirect(event, locale === 'en' ? '/signin' : '/connexion', 302)
  }
})
