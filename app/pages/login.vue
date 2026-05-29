<script setup lang="ts">
definePageMeta({
  layout: false,
  nuxtI18n: {
    paths: {
      fr: '/connexion',
      en: '/login'
    }
  }
})

const { t } = useI18n()

const goToGoogle = () => {
  window.location.href = '/auth/google'
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100">
    <UCard class="w-full max-w-sm">
      <div class="flex flex-col items-center gap-6 py-4 text-center">
        <UIcon class="w-10 h-10 text-primary" name="i-heroicons-calendar-days" />
        <div class="flex flex-col gap-1">
          <h1 class="text-xl font-bold">{{ t('login.title') }}</h1>
          <p class="text-sm text-gray-500">{{ t('login.description') }}</p>
        </div>
        <button
          class="flex items-center gap-3 w-full px-4 py-2.5 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors cursor-pointer"
          @click="goToGoogle"
        >
          <svg class="w-5 h-5 shrink-0" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              fill="#EA4335"
            />
            <path
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              fill="#4285F4"
            />
            <path
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              fill="#FBBC05"
            />
            <path
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              fill="#34A853"
            />
          </svg>
          <span class="text-sm font-medium text-gray-700 flex-1 text-center">{{
            t('login.google')
          }}</span>
        </button>
      </div>
    </UCard>
  </div>
</template>
