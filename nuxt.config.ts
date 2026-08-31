// https://nuxt.com/docs/api/configuration/nuxt-config
import { SESSION_MAX_AGE } from './app/constants/auth'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  // Pin the dev server to 8080 as the source of truth. The dev script passes
  // the same port, so any nuxt dev invocation lands here.
  devServer: { host: 'localhost', port: 8080 },
  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxt/fonts', 'nuxt-auth-utils', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  // Persist the color mode in a cookie (not localStorage) so the server reads it
  // on every request and renders the correct light/dark atmosphere before paint,
  // eliminating the flash-of-wrong-theme. We keep our own data-theme attribute for
  // the atmosphere id, so color-mode only manages the .dark class here.
  colorMode: {
    fallback: 'light',
    storage: 'cookie',
    storageKey: 'nuxt-color-mode'
  },
  i18n: {
    defaultLocale: 'fr',
    customRoutes: 'config',
    locales: [
      { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' }
    ],
    pages: {
      signin: {
        fr: '/connexion',
        en: '/signin'
      },
      signup: {
        fr: '/inscription',
        en: '/signup'
      },
      onboarding: {
        fr: '/accueil',
        en: '/onboarding'
      },
      // profile and settings pages do not exist yet, so these entries stay inert until the page
      // files land. The header popover links ahead to them today, computing the localized paths
      // directly since customRoutes only localizes a key once a matching page file exists.
      profile: {
        fr: '/profil',
        en: '/profile'
      },
      settings: {
        fr: '/parametres',
        en: '/settings'
      },
      // The admin users page exists at app/pages/admin/users.vue. i18n keys pages by file path,
      // so this must be 'admin/users', not the 'admin-users' route name. The route-name form left
      // the localized paths ungenerated, so /utilisateurs resolved to a 404.
      'admin/users': {
        fr: '/utilisateurs',
        en: '/users'
      }
    }
  },
  vite: {
    optimizeDeps: {
      include: ['@tanstack/vue-query', '@vue/devtools-core', '@vue/devtools-kit', 'zod']
    }
  },
  auth: {
    maxAge: SESSION_MAX_AGE
  },
  runtimeConfig: {
    tursoUrl: '',
    tursoAuthToken: '',
    resendApiKey: '',
    resendFromEmail: '',
    ownerEmail: '',
    // Contact address shown in the account-deactivation email so a deactivated user knows
    // who to reach. Distinct from ownerEmail on purpose: it is the public support address,
    // not the account's own login email. Override with NUXT_ADMIN_CONTACT_EMAIL in the
    // environment. Defaults to the owner-specified support address.
    adminContactEmail: 'alexandre.gilbert.dev@gmail.com',
    // Shared secret guarding the retention cron endpoint. Vercel Cron sends it as a bearer
    // token so the purge cannot be triggered by anyone else. Set via NUXT_CRON_SECRET in the
    // environment. Empty by default, which the endpoint treats as "reject everything".
    cronSecret: '',
    // Vercel Blob read/write token for avatar storage. Server-only (not under `public`), so it
    // never reaches the client. Defaults to the token Vercel injects when a Blob store is linked
    // (`BLOB_READ_WRITE_TOKEN`), read at build time, so no renamed copy is needed. Falls back to
    // empty, which makes the avatar endpoints fail closed with a 500 and store nothing. A
    // NUXT_BLOB_READ_WRITE_TOKEN in the environment still overrides at runtime if ever set.
    blobReadWriteToken: process.env.BLOB_READ_WRITE_TOKEN || '',
    // Avatar storage driver selection, single-sourced in server/utils/avatarStorage.ts. Empty means
    // "decide by environment": the filesystem driver under `nuxt dev`, the private Vercel Blob driver
    // everywhere else, so production never silently falls back to the filesystem. Override with
    // NUXT_AVATAR_STORAGE_DRIVER=fs|blob to force one (for example to exercise the blob driver locally
    // against a scratch store, or to force fs in a non-prod deploy).
    avatarStorageDriver: '',
    // Whether the admin onboarding reset is available at all, single-sourced in
    // server/utils/onboardingReset.ts. The feature exists so the owner can walk the first-run wizard
    // again and compare it against the settings page during manual testing, and it is meant to stop
    // existing once that surface is settled, so it ships with a switch that is not a code change.
    // Read by the reset handler, which refuses with the same 403 it gives a non-admin when this is
    // off, and by GET /api/me, which folds it together with the caller's role into the derived
    // canResetOnboarding the settings page renders on.
    //
    // Empty means "decide by environment", enabled under `nuxt dev` and disabled everywhere else, so
    // a production deploy never silently carries a destructive action the owner is finished with.
    // Override with NUXT_ONBOARDING_RESET_ENABLED=true|false to force one, true to exercise it on a
    // preview deploy and false to close it locally while `nuxt dev` runs. Both directions are
    // configuration rather than a deploy of different code.
    //
    // A string default with an explicit parse in the helper, rather than a boolean default relying on
    // Nuxt coercing the environment value by the default's type. That is the avatarStorageDriver
    // precedent three lines up, and it is the more robust of the two, because the parse is written
    // down where it can be read and tested instead of depending on a coercion rule holding. The
    // helper accepts only 'true' and 'false' and treats anything else as unset, so a typo falls back
    // to the environment default rather than resolving to whatever a truthy string would have meant.
    //
    // This is one switch on one endpoint rather than the beginning of a flag framework, and there is
    // deliberately nothing here for a second flag to reuse.
    onboardingResetEnabled: '',
    siteUrl: ''
  },
  // sharp ships a platform-specific native binary. Keep it external to the Nitro server bundle so
  // Rollup does not try to bundle the native module; nitro's node-file-trace then copies the real
  // installed binary for the Vercel Node serverless build target instead of shipping a wrong or
  // broken one. This is the documented mitigation for the sharp-on-Vercel caveat noted in the
  // avatar-upload spec. Verify the deployed upload works on Vercel, not only in the devcontainer.
  nitro: {
    externals: {
      external: ['sharp']
    },
    // Filesystem mount for the development avatar storage driver (server/utils/avatarStorage.ts).
    // The base is the gitignored ./.data folder and the item key is avatarBlobPath(userId) =
    // avatars/{id}.webp, so files land in .data/avatars/{id}.webp. No token is needed locally, and
    // in production the private Vercel Blob driver is selected instead so this mount is never touched.
    storage: {
      avatarStore: { driver: 'fs', base: './.data' }
    }
  }
})
