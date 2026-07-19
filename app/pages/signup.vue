<script setup lang="ts">
definePageMeta({
  layout: 'auth'
})

const { t, locale } = useI18n()
const localePath = useLocalePath()
const route = useRoute()

// A magic link that has expired, been used, or is unknown redirects here with ?expired, so the
// page can invite the user to request a fresh one instead of leaving them on a dead error page.
const linkExpired = computed(() => 'expired' in route.query)

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
  <div class="page-radial relative flex min-h-dvh items-center justify-center bg-muted p-4 sm:p-6">
    <UCard class="w-full max-w-sm" :ui="{ body: 'px-6 pt-12 pb-12 sm:px-9 sm:pt-20 sm:pb-20' }">
      <div class="flex flex-col items-center text-center">
        <AppLogo class="mb-4 h-10 sm:h-12" />

        <p class="mb-5 text-sm font-medium text-muted sm:mb-7">{{ t('app.name') }}</p>

        <h1 class="mb-5 text-2xl font-bold tracking-tight text-highlighted sm:mb-7">
          {{ t('signup.subtitle') }}
        </h1>

        <p class="mb-8 text-center text-sm leading-relaxed text-balance text-muted sm:mb-10">
          {{ t('signup.invitation') }}
        </p>

        <p
          v-if="linkExpired && !sent"
          class="mb-6 text-center text-sm text-balance text-warning"
          role="status"
        >
          {{ t('signup.expired') }}
        </p>

        <form class="w-full" @submit.prevent="submit">
          <UInput
            v-model="email"
            autocomplete="email"
            class="w-full"
            :disabled="sent"
            icon="i-ph-envelope-simple"
            :placeholder="t('signup.email')"
            required
            size="lg"
            type="email"
          />

          <p v-if="error" class="mt-2 text-left text-sm text-error">{{ error }}</p>

          <p v-if="sent" class="mt-8 text-center text-sm text-balance text-success sm:mt-10">
            {{ t('signup.sent') }}
          </p>
          <UButton
            v-else
            block
            class="btn-glow mt-8 sm:mt-10"
            :loading="loading"
            size="lg"
            trailing-icon="i-ph-arrow-right-bold"
            type="submit"
          >
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
