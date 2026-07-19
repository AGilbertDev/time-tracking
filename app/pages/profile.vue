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

// Avatar upload. The picker feeds a single File; a local object URL previews it in the avatar circle
// before anything is sent, and the stored URL (already cache-busted server-side) renders once the
// session refreshes. The client guard gives fast feedback on type and size, but the server 422 is the
// authority and maps onto the same inline messages. Copy lives in i18n; the visible error and the
// live-region status carry keys so both stay locale-reactive.
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const selectedFile = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const uploading = ref(false)
const removing = ref(false)
const avatarErrorKey = ref<string | null>(null)
const statusKey = ref<string | null>(null)

// The circle shows the local preview first, then the stored avatar, then the initials fallback.
const displaySrc = computed(() => previewUrl.value ?? user.value?.avatarUrl ?? null)
const hasAvatar = computed(() => Boolean(user.value?.avatarUrl))
// Remove is offered only for a stored avatar and only while nothing is staged, so the action set is
// never ambiguous: either Save and Cancel for a staged file, or Remove for the current avatar.
const showRemove = computed(() => hasAvatar.value && !selectedFile.value)
const avatarErrorMessage = computed(() => (avatarErrorKey.value ? t(avatarErrorKey.value) : ''))
const statusMessage = computed(() => (statusKey.value ? t(statusKey.value) : ''))

// The Save, Cancel, and Remove buttons mount and unmount as the staged/stored state changes,
// so the control that held focus can vanish on success. The picker trigger is the one control
// that is always present, so focus lands back on it rather than being dropped to the page top.
const pickerButton = useTemplateRef('pickerButton')
async function focusPicker() {
  await nextTick()
  pickerButton.value?.$el?.focus()
}

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
}

function resetStaged() {
  revokePreview()
  selectedFile.value = null
  avatarErrorKey.value = null
}

// When a file is chosen, always preview it (even an invalid one, so the user sees what they picked),
// then run the client guard. A guard failure sets the inline error, which disables Save; picking a
// different file clears it. The object URL is revoked before each new one so nothing leaks.
watch(selectedFile, (file) => {
  revokePreview()
  avatarErrorKey.value = null
  statusKey.value = null
  if (!file) return
  previewUrl.value = URL.createObjectURL(file)
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    avatarErrorKey.value = 'profile.avatar.error.type'
  } else if (file.size > MAX_AVATAR_BYTES) {
    avatarErrorKey.value = 'profile.avatar.error.tooLarge'
  }
  // Mirror a client-guard failure into the live region. The inline UAlert has no live
  // semantics of its own, so without this a screen-reader user picking an invalid file
  // gets no announcement that the choice was rejected.
  if (avatarErrorKey.value) statusKey.value = avatarErrorKey.value
})

// Any still-open object URL is revoked on unmount so navigating away never leaks a preview.
onBeforeUnmount(revokePreview)

// Map the server's typed 422 reasons onto the same inline messages the client guard uses.
const AVATAR_ERROR_KEYS: Record<string, string> = {
  'too-large': 'profile.avatar.error.tooLarge',
  'wrong-type': 'profile.avatar.error.type',
  undecodable: 'profile.avatar.error.corrupt'
}

async function onUploadAvatar() {
  if (!selectedFile.value || avatarErrorKey.value) return
  uploading.value = true
  statusKey.value = 'profile.avatar.uploading'
  try {
    const body = new FormData()
    body.append('file', selectedFile.value)
    await $fetch('/api/me/avatar', { method: 'PUT', body })
    // Refresh the session so the header and this page re-read the new avatarUrl without a reload.
    await refreshSession()
    resetStaged()
    statusKey.value = 'profile.avatar.uploadSuccess'
    await focusPicker()
    toast.add({
      title: t('profile.avatar.uploadSuccess'),
      color: 'success',
      icon: 'i-ph-check-circle'
    })
  } catch (error) {
    // A typed 422 maps to the inline message and keeps the preview so the user can pick another file.
    // Anything else is an unexpected failure and gets a generic retry toast.
    const reason = (error as { data?: { data?: { file?: string } } })?.data?.data?.file
    const key = reason ? AVATAR_ERROR_KEYS[reason] : undefined
    if (key) {
      avatarErrorKey.value = key
      statusKey.value = key
    } else {
      statusKey.value = 'profile.avatar.error.generic'
      toast.add({
        title: t('profile.avatar.error.generic'),
        color: 'error',
        icon: 'i-ph-warning-circle'
      })
    }
  } finally {
    uploading.value = false
  }
}

function onCancelAvatar() {
  resetStaged()
  // Cancel removes itself from the DOM, so move focus back to the picker rather than lose it.
  void focusPicker()
}

async function onRemoveAvatar() {
  removing.value = true
  statusKey.value = 'profile.avatar.removing'
  try {
    await $fetch('/api/me/avatar', { method: 'DELETE' })
    await refreshSession()
    statusKey.value = 'profile.avatar.removeSuccess'
    await focusPicker()
    toast.add({
      title: t('profile.avatar.removeSuccess'),
      color: 'success',
      icon: 'i-ph-check-circle'
    })
  } catch {
    statusKey.value = 'profile.avatar.error.generic'
    toast.add({
      title: t('profile.avatar.error.generic'),
      color: 'error',
      icon: 'i-ph-warning-circle'
    })
  } finally {
    removing.value = false
  }
}

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
    class="mx-auto w-full max-w-xl px-6 py-[clamp(2rem,6vh,4rem)] sm:px-6 lg:px-8 space-y-[clamp(1.5rem,4vh,2.5rem)]"
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
      <!-- Identity summary: the avatar with its upload controls, the live name preview, and the
           read-only email. The avatar circle doubles as the live preview surface, so the file
           picker's own file list is suppressed and the chosen image shows here instead. -->
      <div class="flex flex-col items-center gap-2 text-center">
        <AppAccountAvatar
          class="size-[clamp(4.5rem,12vw,6rem)] text-[clamp(1.5rem,4vw,2rem)]"
          :initials="initials"
          :src="displaySrc"
        />
        <div class="flex w-full min-w-0 flex-col items-center">
          <span v-if="previewName" class="w-full truncate text-base font-medium text-highlighted">
            {{ previewName }}
          </span>
          <span class="w-full truncate text-sm text-muted">{{ user?.email }}</span>
        </div>

        <!-- Avatar controls. The picker uses the button variant with a custom trigger so the only
             visible file affordance is one labelled button; the preview happens in the circle above.
             The action row shows either Save and Cancel for a staged file, or Remove for the current
             avatar, never both. -->
        <div class="mt-2 flex w-full flex-col items-center gap-3">
          <p class="text-sm font-medium text-highlighted">{{ t('profile.avatar.label') }}</p>

          <UFileUpload
            v-model="selectedFile"
            accept="image/png,image/jpeg,image/webp"
            :aria-label="hasAvatar ? t('profile.avatar.replace') : t('profile.avatar.choose')"
            variant="button"
          >
            <template #default="{ open }">
              <UButton
                ref="pickerButton"
                color="neutral"
                icon="i-ph-image"
                :label="hasAvatar ? t('profile.avatar.replace') : t('profile.avatar.choose')"
                variant="outline"
                @click="open"
              />
            </template>
          </UFileUpload>

          <p class="text-xs text-muted">{{ t('profile.avatar.hint') }}</p>

          <UAlert
            v-if="avatarErrorMessage"
            class="text-left"
            color="error"
            icon="i-ph-warning-circle"
            :title="avatarErrorMessage"
            variant="subtle"
          />

          <div
            v-if="selectedFile || showRemove"
            class="flex flex-wrap items-center justify-center gap-2"
          >
            <template v-if="selectedFile">
              <UButton
                class="btn-glow"
                color="primary"
                :disabled="Boolean(avatarErrorKey)"
                icon="i-ph-check-bold"
                :label="t('profile.avatar.save')"
                :loading="uploading"
                @click="onUploadAvatar"
              />
              <UButton
                color="neutral"
                :disabled="uploading"
                icon="i-ph-x"
                :label="t('profile.avatar.cancel')"
                variant="ghost"
                @click="onCancelAvatar"
              />
            </template>

            <UButton
              v-if="showRemove"
              color="error"
              icon="i-ph-trash"
              :label="t('profile.avatar.remove')"
              :loading="removing"
              variant="ghost"
              @click="onRemoveAvatar"
            />
          </div>

          <!-- Visually hidden live region announcing pending, success, and error status. -->
          <p aria-atomic="true" aria-live="polite" class="sr-only">{{ statusMessage }}</p>
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
