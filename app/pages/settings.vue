<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

// The configuration page: two independent sections on one page, Work and Security. Route name
// settings, localized to /parametres (fr) and /settings (en) by nuxt.config. The global auth
// middleware forces sign-in and onboarding, so any onboarded user reaches their own settings. Every
// write is scoped to the session user server-side. The two forms save independently: saving one
// never touches the other's data.
const { t } = useI18n()
const toast = useToast()

// Authenticated account surface, kept out of the index. The whole app is auth-gated, but the intent
// is stated for the SEO stage.
useSeoMeta({
  title: () => t('settings.title'),
  robots: 'noindex, nofollow'
})

// --- Work settings -------------------------------------------------------------------------
interface WorkSettings {
  dailyWorkMinutes: number
  quotaWph: number
  timezone: string
  workDays: number[]
}

// Forward the session cookie on SSR. A browser request attaches it automatically, but Nuxt's
// server-side $fetch to an internal route does not, so on a hard reload the work-settings API would
// see no session and the section would render empty until a client navigation.
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const {
  data: workData,
  status: workStatus,
  refresh: refreshWork
} = await useAsyncData<WorkSettings>('me-work-settings', () =>
  $fetch('/api/me/work-settings', { headers: requestHeaders })
)

// The editable copy the form binds to, seeded from the loaded settings and re-seeded whenever the
// key is refreshed (the reconcile step after a save). The defaults match the server's coded ones so
// the shape is always valid before the load resolves.
const workState = reactive<WorkSettings>({
  dailyWorkMinutes: 450,
  workDays: [1, 2, 3, 4, 5],
  quotaWph: 450,
  timezone: 'America/Toronto'
})

watchEffect(() => {
  if (!workData.value) return
  workState.dailyWorkMinutes = workData.value.dailyWorkMinutes
  workState.workDays = [...workData.value.workDays]
  workState.quotaWph = workData.value.quotaWph
  workState.timezone = workData.value.timezone
})

const savingWork = ref(false)

async function onSaveWork() {
  savingWork.value = true
  try {
    // The full set is sent; an empty work-day selection is valid and persists as [], so it is never
    // blocked. The server reconciles and returns the full state, which the refresh re-reads.
    await $fetch('/api/me/work-settings', {
      method: 'PATCH',
      body: {
        dailyWorkMinutes: workState.dailyWorkMinutes,
        workDays: [...workState.workDays],
        quotaWph: workState.quotaWph,
        timezone: workState.timezone
      }
    })
    await refreshWork()
    toast.add({ title: t('settings.work.success'), color: 'success', icon: 'i-ph-check-circle' })
  } catch {
    toast.add({
      title: t('settings.work.errors.generic'),
      color: 'error',
      icon: 'i-ph-warning-circle'
    })
  } finally {
    savingWork.value = false
  }
}

// --- Security (change password) ------------------------------------------------------------
interface PasswordState {
  confirmNewPassword: string
  currentPassword: string
  newPassword: string
}

const pwState = reactive<PasswordState>({
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: ''
})

const pwForm = useTemplateRef('pwForm')
const savingPw = ref(false)

// Client validation mirrors the server contract: all three present, the new password at least 8
// characters, and the confirmation equal to the new one. The server re-checks every rule, so this
// is a fast-fail convenience, not the authority.
function validatePassword(state: PasswordState): FormError[] {
  const errors: FormError[] = []
  if (!state.currentPassword)
    errors.push({
      name: 'currentPassword',
      message: t('settings.security.validation.currentRequired')
    })
  if (!state.newPassword)
    errors.push({ name: 'newPassword', message: t('settings.security.validation.newRequired') })
  else if (state.newPassword.length < 8)
    errors.push({ name: 'newPassword', message: t('settings.security.validation.newTooShort') })
  if (!state.confirmNewPassword)
    errors.push({
      name: 'confirmNewPassword',
      message: t('settings.security.validation.confirmRequired')
    })
  else if (state.confirmNewPassword !== state.newPassword)
    errors.push({ name: 'confirmNewPassword', message: t('settings.security.validation.mismatch') })
  return errors
}

async function onSavePassword(event: FormSubmitEvent<PasswordState>) {
  savingPw.value = true
  try {
    await $fetch('/api/me/password', {
      method: 'PATCH',
      body: {
        currentPassword: event.data.currentPassword,
        newPassword: event.data.newPassword,
        confirmNewPassword: event.data.confirmNewPassword
      }
    })
    // The current device stays signed in, so there is no session refresh. Clear the fields so the
    // form is not left holding the old and new secrets.
    pwState.currentPassword = ''
    pwState.newPassword = ''
    pwState.confirmNewPassword = ''
    toast.add({
      title: t('settings.security.success'),
      color: 'success',
      icon: 'i-ph-check-circle'
    })
  } catch (error) {
    // The server returns a stable statusMessage code the client maps to a localized inline field
    // error. A schema 422 (unlikely, since the client already validates) falls back to a generic
    // toast.
    const code = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    if (code === 'current_password_incorrect') {
      pwForm.value?.setErrors([
        { name: 'currentPassword', message: t('settings.security.errors.currentIncorrect') }
      ])
    } else if (code === 'password_breached') {
      pwForm.value?.setErrors([
        { name: 'newPassword', message: t('settings.security.errors.breached') }
      ])
    } else if (code === 'password_unchanged') {
      pwForm.value?.setErrors([
        { name: 'newPassword', message: t('settings.security.errors.unchanged') }
      ])
    } else {
      toast.add({
        title: t('settings.security.errors.generic'),
        color: 'error',
        icon: 'i-ph-warning-circle'
      })
    }
  } finally {
    savingPw.value = false
  }
}
</script>

<template>
  <div
    class="mx-auto w-full max-w-xl px-6 py-[clamp(2rem,6vh,4rem)] sm:px-6 lg:px-8 space-y-[clamp(2rem,5vh,3rem)]"
  >
    <!-- Page header, directly on the canvas. -->
    <div>
      <h1
        class="text-[clamp(1.5rem,1.6vw+0.5rem,2.25rem)] font-bold tracking-tight text-highlighted"
      >
        {{ t('settings.title') }}
      </h1>
      <p class="mt-2 text-sm text-balance text-muted">{{ t('settings.intro') }}</p>
    </div>

    <!-- Work section. -->
    <section aria-labelledby="settings-work-heading" class="space-y-4">
      <div>
        <h2
          id="settings-work-heading"
          class="flex items-center gap-2 text-lg font-semibold text-highlighted"
        >
          <UIcon class="size-5 text-primary" name="i-ph-briefcase-bold" />
          {{ t('settings.work.heading') }}
        </h2>
        <p class="mt-1 text-sm text-muted">{{ t('settings.work.subtitle') }}</p>
      </div>

      <UCard class="rounded-2xl bg-default ring ring-default">
        <!-- Never blank: a skeleton while the settings load, an alert with retry on failure, and
             the form once the values are in hand. -->
        <div v-if="workStatus === 'error'" role="alert">
          <UAlert
            :actions="[
              {
                label: t('settings.work.retry'),
                color: 'neutral',
                variant: 'outline',
                onClick: () => refreshWork()
              }
            ]"
            color="error"
            icon="i-ph-warning-circle"
            :title="t('settings.work.loadError')"
            variant="subtle"
          />
        </div>

        <div v-else-if="workStatus === 'pending'" class="flex flex-col gap-6">
          <USkeleton class="h-10 w-48" />
          <USkeleton class="h-10 w-64" />
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-10 w-full" />
        </div>

        <UForm v-else class="space-y-6" :state="workState" @submit="onSaveWork">
          <SettingsWorkFields
            v-model:daily-work-minutes="workState.dailyWorkMinutes"
            v-model:quota-wph="workState.quotaWph"
            v-model:timezone="workState.timezone"
            v-model:work-days="workState.workDays"
          />

          <div class="flex justify-end">
            <UButton
              class="btn-glow"
              color="primary"
              icon="i-ph-check-bold"
              :label="t('settings.work.submit')"
              :loading="savingWork"
              type="submit"
            />
          </div>
        </UForm>
      </UCard>
    </section>

    <!-- Security section. -->
    <section aria-labelledby="settings-security-heading" class="space-y-4">
      <div>
        <h2
          id="settings-security-heading"
          class="flex items-center gap-2 text-lg font-semibold text-highlighted"
        >
          <UIcon class="size-5 text-primary" name="i-ph-lock-bold" />
          {{ t('settings.security.heading') }}
        </h2>
        <p class="mt-1 text-sm text-muted">{{ t('settings.security.subtitle') }}</p>
      </div>

      <UCard class="rounded-2xl bg-default ring ring-default">
        <UForm
          ref="pwForm"
          class="space-y-4"
          :state="pwState"
          :validate="validatePassword"
          @submit="onSavePassword"
        >
          <UFormField
            :label="t('settings.security.currentPassword')"
            name="currentPassword"
            required
          >
            <UInput
              v-model="pwState.currentPassword"
              aria-required="true"
              autocomplete="current-password"
              class="w-full"
              type="password"
            />
          </UFormField>

          <UFormField
            :hint="t('settings.security.newPasswordHint')"
            :label="t('settings.security.newPassword')"
            name="newPassword"
            required
          >
            <UInput
              v-model="pwState.newPassword"
              aria-required="true"
              autocomplete="new-password"
              class="w-full"
              type="password"
            />
          </UFormField>

          <UFormField
            :label="t('settings.security.confirmPassword')"
            name="confirmNewPassword"
            required
          >
            <UInput
              v-model="pwState.confirmNewPassword"
              aria-required="true"
              autocomplete="new-password"
              class="w-full"
              type="password"
            />
          </UFormField>

          <div class="flex justify-end">
            <UButton
              class="btn-glow"
              color="primary"
              icon="i-ph-check-bold"
              :label="t('settings.security.submit')"
              :loading="savingPw"
              type="submit"
            />
          </div>
        </UForm>
      </UCard>
    </section>
  </div>
</template>
