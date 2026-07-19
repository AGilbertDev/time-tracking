<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

// The identity page: avatar, editable first and last name, and a read-only email. Route name
// profile, localized to /profil (fr) and /profile (en) by nuxt.config. The global auth middleware
// forces sign-in and onboarding, so any onboarded user reaches their own profile. The write is
// scoped to the session user server-side; nothing here can touch another account.
const { t } = useI18n()
const toast = useToast()
const { user, fetch: refreshSession } = useUserSession()

// Authenticated account surface, kept out of the index. The whole app is auth-gated, but the intent
// is stated for the SEO stage.
useSeoMeta({
  title: () => t('profile.title'),
  robots: 'noindex, nofollow'
})

// The name and email are already on the session, which is this page's read path, exactly as the
// header popover reads them. There is no GET; the fields pre-fill from the session with no fetch.
interface NameState {
  firstName: string
  lastName: string
}

const state = reactive<NameState>({
  firstName: user.value?.firstName ?? '',
  lastName: user.value?.lastName ?? ''
})

// The avatar and the live name preview track what is currently typed, so the header idiom is
// mirrored and the change is visible before it is even saved.
const initials = computed(() => accountInitials(state.firstName, state.lastName))
const previewName = computed(() => accountName(state.firstName, state.lastName))

// Client validation mirrors the shared 1-100 trim bound the server enforces, so a bad value is
// caught before the request. The server remains the source of truth and its 422 is mapped back onto
// the fields below.
function validate(candidate: NameState): FormError[] {
  const errors: FormError[] = []
  const first = candidate.firstName?.trim() ?? ''
  const last = candidate.lastName?.trim() ?? ''
  if (!first) errors.push({ name: 'firstName', message: t('profile.validation.firstNameRequired') })
  else if (first.length > 100)
    errors.push({ name: 'firstName', message: t('profile.validation.firstNameTooLong') })
  if (!last) errors.push({ name: 'lastName', message: t('profile.validation.lastNameRequired') })
  else if (last.length > 100)
    errors.push({ name: 'lastName', message: t('profile.validation.lastNameTooLong') })
  return errors
}

const form = useTemplateRef('form')
const saving = ref(false)

async function onSubmit(event: FormSubmitEvent<NameState>) {
  saving.value = true
  try {
    await $fetch('/api/me/profile', {
      method: 'PATCH',
      body: {
        firstName: event.data.firstName.trim(),
        lastName: event.data.lastName.trim()
      }
    })
    // Refresh the session so the header popover and this page re-read the new name without a reload.
    await refreshSession()
    toast.add({ title: t('profile.success'), color: 'success', icon: 'i-ph-check-circle' })
  } catch (error) {
    // A 422 carries a per-field data map from sendZodError; surface it inline on the offending
    // field. Anything else is an unexpected failure and gets a generic toast.
    const fields = (error as { data?: { data?: Record<string, string> } })?.data?.data
    if (fields && (fields.firstName || fields.lastName)) {
      const inline: FormError[] = []
      if (fields.firstName)
        inline.push({ name: 'firstName', message: t('profile.validation.invalid') })
      if (fields.lastName)
        inline.push({ name: 'lastName', message: t('profile.validation.invalid') })
      form.value?.setErrors(inline)
    } else {
      toast.add({ title: t('profile.error'), color: 'error', icon: 'i-ph-warning-circle' })
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    class="mx-auto w-full max-w-2xl px-6 py-[clamp(2rem,6vh,4rem)] sm:px-6 lg:px-8 space-y-[clamp(1.5rem,4vh,2.5rem)]"
  >
    <!-- Page header, directly on the canvas. -->
    <div>
      <h1
        class="text-[clamp(1.5rem,1.6vw+0.5rem,2.25rem)] font-bold tracking-tight text-highlighted"
      >
        {{ t('profile.title') }}
      </h1>
      <p class="mt-2 text-sm text-balance text-muted">{{ t('profile.intro') }}</p>
    </div>

    <UCard class="rounded-2xl bg-default ring ring-default">
      <!-- Identity summary: the avatar, the live name preview, and the read-only email. -->
      <div class="flex flex-col items-center gap-2 text-center">
        <AppAccountAvatar class="size-16 text-2xl" :initials="initials" />
        <div class="flex w-full min-w-0 flex-col items-center">
          <span v-if="previewName" class="w-full truncate text-base font-medium text-highlighted">
            {{ previewName }}
          </span>
          <span class="w-full truncate text-sm text-muted">{{ user?.email }}</span>
        </div>
      </div>

      <USeparator class="my-6" />

      <UForm
        ref="form"
        class="flex flex-col gap-4"
        :state="state"
        :validate="validate"
        @submit="onSubmit"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('profile.firstName')" name="firstName" required>
            <UInput
              v-model="state.firstName"
              aria-required="true"
              autocomplete="given-name"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="t('profile.lastName')" name="lastName" required>
            <UInput
              v-model="state.lastName"
              aria-required="true"
              autocomplete="family-name"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField :hint="t('profile.emailHint')" :label="t('profile.email')" name="email">
          <UInput
            :aria-label="t('profile.email')"
            class="w-full"
            icon="i-ph-envelope-simple"
            :model-value="user?.email ?? ''"
            readonly
            type="email"
          />
        </UFormField>

        <div class="flex justify-end">
          <UButton
            class="btn-glow"
            color="primary"
            icon="i-ph-check-bold"
            :label="t('profile.submit')"
            :loading="saving"
            type="submit"
          />
        </div>
      </UForm>
    </UCard>
  </div>
</template>
