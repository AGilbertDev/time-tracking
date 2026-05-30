// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxt/eslint', 'nuxt-auth-utils', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  i18n: {
    defaultLocale: 'fr',
    locales: [
      { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' }
    ]
  },
  runtimeConfig: {
    tursoUrl: '',
    tursoAuthToken: '',
    resendApiKey: '',
    resendFromEmail: '',
    ownerEmail: ''
  }
})
