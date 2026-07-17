import type { Locale, ThemeId } from '#shared/theme'

// The write side for the account preferences shared by the theme picker and the
// language toggle. It keeps useTheme free of an HTTP dependency and gives the
// header toggle the same path. The database is the source of truth for a signed-in
// user, so a signed-out pick stays cookie-only and is never sent.
export function usePreferences() {
  // Alias fetch so it does not shadow the global, and use it to refresh the session
  // after a write since the server rewrites the session payload on a successful PATCH.
  const { loggedIn, fetch: refreshSession } = useUserSession()
  const toast = useToast()
  const { t } = useI18n()

  // Persist only the fields that changed. On a failure the in-memory pick stays so
  // the interface remains responsive, and a warning toast tells the user the choice
  // will not follow them to another device. The error is swallowed, never rethrown.
  async function savePreferences(
    patch: Partial<{ darkTheme: ThemeId; lightTheme: ThemeId; locale: Locale }>
  ) {
    if (!loggedIn.value) return

    try {
      await $fetch('/api/me/preferences', { method: 'PATCH', body: patch })
      // The PATCH refreshed the server session, so re-read it to keep the client cache
      // in step with the persisted values. Only on success, never after a failure.
      await refreshSession()
    } catch {
      toast.add({
        title: t('preferences.saveError'),
        color: 'warning',
        icon: 'i-ph-warning'
      })
    }
  }

  return { savePreferences }
}
