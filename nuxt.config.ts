// https://nuxt.com/docs/api/configuration/nuxt-config
import { SESSION_MAX_AGE } from './app/constants/auth'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['@nuxt/ui', '@nuxt/eslint', '@nuxt/fonts', 'nuxt-auth-utils', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  // Persist the color mode in a cookie (not localStorage) so the server reads it
  // on every request and renders the correct light/dark atmosphere before paint,
  // eliminating the flash-of-wrong-theme. We keep our own data-theme attribute for
  // the atmosphere id, so color-mode only manages the .dark class here.
  colorMode: {
    preference: 'system',
    fallback: 'light',
    storage: 'cookie',
    storageKey: 'nuxt-color-mode',
    cookieAttrs: {
      'max-age': '31536000',
      path: '/',
      SameSite: 'Lax'
    }
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
      }
    }
  },
  vite: {
    optimizeDeps: {
      include: ['@vue/devtools-core', '@vue/devtools-kit']
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
    siteUrl: ''
  }
})
