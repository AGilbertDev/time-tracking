<script setup lang="ts">
definePageMeta({
  layout: 'auth'
})

const { t, locale } = useI18n()
const localePath = useLocalePath()

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
    error.value = t('signup.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="relative flex min-h-screen items-center justify-center bg-gray-100 bg-[radial-gradient(circle_at_center,rgba(17,24,39,0.035)_1px,transparent_1px)] bg-size-[22px_22px] p-6"
  >
    <UCard class="w-full max-w-90" :ui="{ body: 'px-9 pt-20 pb-20' }">
      <div class="flex flex-col items-center text-center">
        <AppLogo class="mb-4 h-14" />

        <p class="mb-7 text-[13px] font-medium text-gray-500">{{ t('app.name') }}</p>

        <h1 class="mb-7 text-[26px] font-bold tracking-tight text-gray-900">
          {{ t('signup.subtitle') }}
        </h1>

        <p class="mb-14 max-w-[30ch] text-sm leading-relaxed text-gray-500">
          {{ t('signup.invitation') }}
        </p>

        <form class="w-full" @submit.prevent="submit">
          <UInput
            v-model="email"
            autocomplete="email"
            class="w-full"
            :disabled="sent"
            icon="i-carbon-email"
            :placeholder="t('signup.email')"
            required
            size="lg"
            type="email"
          />

          <p v-if="error" class="mt-2 text-left text-sm text-red-500">{{ error }}</p>

          <p v-if="sent" class="mt-4 text-center text-sm text-green-600">
            {{ t('signup.sent') }}
          </p>
          <UButton v-else block class="mt-4" :loading="loading" size="lg" type="submit">
            {{ t('signup.submit') }}
          </UButton>
        </form>

        <ULink class="mt-6 text-sm text-muted hover:text-default" :to="localePath('signin')">
          {{ t('signup.hasAccount') }}
        </ULink>
      </div>
    </UCard>
  </div>
</template>
