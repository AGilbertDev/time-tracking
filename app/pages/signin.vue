<script setup lang="ts">
definePageMeta({
  layout: 'auth'
})

const { t } = useI18n()
const localePath = useLocalePath()
const { fetch: refreshSession } = useUserSession()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  loading.value = true
  error.value = ''

  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value }
    })

    // Refresh the client session so the middleware sees the authenticated user before we navigate.
    await refreshSession()
    await navigateTo(localePath('index'))
  } catch (e) {
    // The server returns stable codes the client maps to localized messages.
    const code = (e as { data?: { statusMessage?: string } })?.data?.statusMessage
    error.value = code === 'account_deactivated' ? t('signin.deactivated') : t('signin.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="relative flex min-h-screen items-center justify-center bg-muted bg-[radial-gradient(circle_at_center,rgba(17,24,39,0.035)_1px,transparent_1px)] bg-size-[22px_22px] p-6"
  >
    <UCard class="w-full max-w-90" :ui="{ body: 'px-9 pt-20 pb-20' }">
      <div class="flex flex-col items-center text-center">
        <AppLogo class="mb-4 h-14" />

        <p class="mb-7 text-[13px] font-medium text-muted">{{ t('app.name') }}</p>

        <h1 class="mb-10 text-[26px] font-bold tracking-tight text-highlighted">
          {{ t('signin.subtitle') }}
        </h1>

        <form class="flex w-full flex-col gap-4" @submit.prevent="submit">
          <UInput
            v-model="email"
            autocomplete="email"
            class="w-full"
            icon="i-carbon-email"
            :placeholder="t('signin.email')"
            required
            size="lg"
            type="email"
          />

          <UInput
            v-model="password"
            autocomplete="current-password"
            class="w-full"
            icon="i-carbon-locked"
            :placeholder="t('signin.password')"
            required
            size="lg"
            type="password"
          />

          <p v-if="error" class="text-left text-sm text-error">{{ error }}</p>

          <UButton block :loading="loading" size="lg" type="submit">
            {{ t('signin.submit') }}
          </UButton>
        </form>

        <ULink class="mt-6 text-sm text-muted hover:text-default" :to="localePath('signup')">
          {{ t('signin.noAccount') }}
        </ULink>
      </div>
    </UCard>
  </div>
</template>
