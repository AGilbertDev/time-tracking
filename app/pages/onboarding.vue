<script setup lang="ts">
definePageMeta({
  layout: 'auth'
})

const { t } = useI18n()
const localePath = useLocalePath()
const { fetch: refreshSession } = useUserSession()

const firstName = ref('')
const lastName = ref('')
const password = ref('')
const passwordConfirm = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  // Catch typos before hitting the server. The password is never echoed back so a mismatch is unrecoverable otherwise.
  if (password.value !== passwordConfirm.value) {
    error.value = t('onboarding.passwordMismatch')
    return
  }

  loading.value = true
  error.value = ''

  try {
    await $fetch('/api/onboarding/complete', {
      method: 'POST',
      body: { firstName: firstName.value, lastName: lastName.value, password: password.value }
    })

    // Refresh the client session so the middleware sees onboarded = true before we navigate.
    await refreshSession()
    await navigateTo(localePath('index'))
  } catch (e) {
    // The server returns the stable code "password_breached" so we can show a localized message.
    const code = (e as { data?: { statusMessage?: string } })?.data?.statusMessage
    error.value =
      code === 'password_breached' ? t('onboarding.passwordBreached') : t('onboarding.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="flex min-h-dvh items-center justify-center bg-muted bg-[radial-gradient(circle_at_center,rgba(17,24,39,0.035)_1px,transparent_1px)] bg-size-[22px_22px] p-4 sm:p-6"
  >
    <UCard class="w-full max-w-sm" :ui="{ body: 'px-6 py-10 sm:px-9 sm:py-14' }">
      <div class="flex flex-col items-center text-center">
        <AppLogo class="mb-4 h-10 sm:h-12" />

        <p class="mb-2 text-sm font-medium text-muted">{{ t('app.name') }}</p>

        <h1 class="mb-3 text-2xl font-bold tracking-tight text-highlighted">
          {{ t('onboarding.title') }}
        </h1>

        <p class="mb-7 max-w-[30ch] text-sm leading-relaxed text-muted sm:mb-10">
          {{ t('onboarding.subtitle') }}
        </p>

        <form class="flex w-full flex-col gap-4" @submit.prevent="submit">
          <UFormField :label="t('onboarding.firstName')">
            <UInput
              v-model="firstName"
              autocomplete="given-name"
              class="w-full"
              required
              size="lg"
            />
          </UFormField>

          <UFormField :label="t('onboarding.lastName')">
            <UInput
              v-model="lastName"
              autocomplete="family-name"
              class="w-full"
              required
              size="lg"
            />
          </UFormField>

          <UFormField :hint="t('onboarding.passwordHint')" :label="t('onboarding.password')">
            <UInput
              v-model="password"
              autocomplete="new-password"
              class="w-full"
              required
              size="lg"
              type="password"
            />
          </UFormField>

          <UFormField :label="t('onboarding.passwordConfirm')">
            <UInput
              v-model="passwordConfirm"
              autocomplete="new-password"
              class="w-full"
              required
              size="lg"
              type="password"
            />
          </UFormField>

          <p v-if="error" class="text-sm text-error">{{ error }}</p>

          <UButton block class="mt-2" :loading="loading" size="lg" type="submit">
            {{ t('onboarding.submit') }}
          </UButton>
        </form>
      </div>
    </UCard>
  </div>
</template>
