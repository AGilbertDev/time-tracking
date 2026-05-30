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

const { t, locale } = useI18n()

const email = ref('')
const sent = ref(false)
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''

  try {
    await $fetch('/api/magic-link/request', {
      method: 'POST',
      body: { email: email.value, locale: locale.value }
    })
    sent.value = true
  } catch {
    error.value = t('login.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100">
    <UCard class="w-full max-w-sm">
      <div class="flex flex-col items-center gap-6 py-4 text-center">
        <UIcon class="h-10 w-10 text-primary" name="i-carbon-calendar" />
        <div class="flex flex-col gap-1">
          <h1 class="text-xl font-bold">{{ t('login.title') }}</h1>
          <p class="text-sm text-gray-500">{{ t('login.description') }}</p>
        </div>

        <div v-if="sent" class="text-sm text-green-600">
          {{ t('login.sent') }}
        </div>

        <form v-else class="flex w-full flex-col gap-3" @submit.prevent="submit">
          <UInput
            v-model="email"
            autocomplete="email"
            :placeholder="t('login.email')"
            required
            type="email"
          />
          <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
          <UButton block :loading="loading" type="submit">
            {{ t('login.submit') }}
          </UButton>
        </form>
      </div>
    </UCard>
  </div>
</template>
