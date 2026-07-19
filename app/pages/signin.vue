<script setup lang="ts">
definePageMeta({
  layout: 'auth'
})

const { t } = useI18n()
const localePath = useLocalePath()

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

    // Hard-reload into the app rather than an SPA navigation so the server rebuilds the theme,
    // locale, and colour mode from the freshly signed-in user's settings. A client navigation would
    // keep the previous visitor's cached theme state until a manual refresh.
    window.location.href = localePath('index')
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
  <div class="page-radial relative flex min-h-dvh items-center justify-center bg-muted p-4 sm:p-6">
    <UCard class="w-full max-w-sm" :ui="{ body: 'px-6 pt-12 pb-12 sm:px-9 sm:pt-20 sm:pb-20' }">
      <div class="flex flex-col items-center text-center">
        <AppLogo class="mb-4 h-10 sm:h-12" />

        <p class="mb-5 text-sm font-medium text-muted sm:mb-7">{{ t('app.name') }}</p>

        <h1 class="mb-8 text-2xl font-bold tracking-tight text-highlighted sm:mb-10">
          {{ t('signin.subtitle') }}
        </h1>

        <form class="flex w-full flex-col gap-4" @submit.prevent="submit">
          <UInput
            v-model="email"
            autocomplete="email"
            class="w-full"
            icon="i-ph-envelope-simple"
            :placeholder="t('signin.email')"
            required
            size="lg"
            type="email"
          />

          <UInput
            v-model="password"
            autocomplete="current-password"
            class="w-full"
            icon="i-ph-lock"
            :placeholder="t('signin.password')"
            required
            size="lg"
            type="password"
          />

          <p v-if="error" class="text-left text-sm text-error">{{ error }}</p>

          <UButton
            block
            class="btn-glow"
            :loading="loading"
            size="lg"
            trailing-icon="i-ph-arrow-right-bold"
            type="submit"
          >
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
