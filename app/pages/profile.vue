<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

// The identity page: avatar, editable first and last name, and a read-only email. Route name
// profile, localized to /profil (fr) and /profile (en) by nuxt.config. The global auth middleware
// forces sign-in and onboarding, so any onboarded user reaches their own profile. The write is
// scoped to the session user server-side; nothing here can touch another account.
//
// Every write goes through a TanStack Query mutation composable (useUpdateProfileMutation,
// useUploadAvatarMutation, useRemoveAvatarMutation), each of which refreshes the session and
// invalidates queryKeys.me() in onSuccess. The page holds no bare $fetch.
const { t } = useI18n()
const toast = useToast()
// Stored user display data (name, email, avatarUrl) reads from the me-query, not the session. Its
// initialData is seeded from the session so the fields pre-fill on first paint with no fetch and no
// flash, and each mutation below invalidates queryKeys.me() so the query refetches the fresh
// database row. This is the read path that fixes the stale avatar after an upload or removal.
const { data: me } = useMeQuery()

const updateProfile = useUpdateProfileMutation()
const uploadAvatar = useUploadAvatarMutation()
const removeAvatar = useRemoveAvatarMutation()

// Authenticated account surface, kept out of the index. The whole app is auth-gated, but the intent
// is stated for the SEO stage.
useSeoMeta({
  title: () => t('profile.title'),
  robots: 'noindex, nofollow'
})

// The name inputs bind to this local reactive, seeded from the me-query data (which the header reads
// too). The stored value comes from the query, not the session, so an invalidation after a save
// refreshes what the fields are compared against.
interface NameState {
  firstName: string
  lastName: string
}

const state = reactive<NameState>({
  firstName: me.value?.firstName ?? '',
  lastName: me.value?.lastName ?? ''
})

// The avatar initials track what is currently typed, so the change is visible before it is saved.
const initials = computed(() => accountInitials(state.firstName, state.lastName))

// One unified Save commits the name and the avatar together, so the avatar edit is staged locally and
// only sent when the bottom Save is pressed. A staged change is either a picked File (a replacement)
// or a pending removal; the two are mutually exclusive. Nothing touches the server until Save.
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

const selectedFile = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const pendingRemoval = ref(false)
const avatarErrorKey = ref<string | null>(null)
const statusKey = ref<string | null>(null)

// The circle previews the staged state: a picked file first, then a staged removal (initials), then
// the stored avatar, then the initials fallback. So the user always sees what Save will apply.
const displaySrc = computed(() => {
  if (previewUrl.value) return previewUrl.value
  if (pendingRemoval.value) return null
  return me.value?.avatarUrl ?? null
})
const hasStoredAvatar = computed(() => Boolean(me.value?.avatarUrl))
const hasStagedAvatarChange = computed(() => Boolean(selectedFile.value) || pendingRemoval.value)
const previewHasImage = computed(() => Boolean(displaySrc.value))
// Remove is offered only for a stored avatar and only while nothing is staged, so the action set is
// never ambiguous: either a single Cancel for a staged change, or Remove for the current avatar.
const showRemove = computed(() => hasStoredAvatar.value && !hasStagedAvatarChange.value)
const avatarErrorMessage = computed(() => (avatarErrorKey.value ? t(avatarErrorKey.value) : ''))
const statusMessage = computed(() => (statusKey.value ? t(statusKey.value) : ''))

// A name change is any difference from the stored (query) values, compared trimmed to mirror the
// server. After a save the query refetches, so state matching the fresh values clears the flag.
const hasNameChange = computed(() => {
  const first = state.firstName.trim()
  const last = state.lastName.trim()
  return first !== (me.value?.firstName ?? '') || last !== (me.value?.lastName ?? '')
})

// In-flight state for the single Save: any of the three mutations running. A staged file that failed
// the client guard disables Save, as does having nothing to save.
const isSaving = computed(
  () =>
    updateProfile.isPending.value || uploadAvatar.isPending.value || removeAvatar.isPending.value
)
const saveDisabled = computed(
  () =>
    isSaving.value ||
    Boolean(avatarErrorKey.value) ||
    !(hasNameChange.value || hasStagedAvatarChange.value)
)

// The Cancel and Remove controls mount and unmount as the staged state changes, so the control that
// held focus can vanish on success. The picker trigger is the one control always present, so focus
// lands back on it rather than being dropped to the page top.
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
// then run the client guard. Picking a file supersedes any staged removal. A guard failure sets the
// inline error, which disables Save; picking a different file clears it. The object URL is revoked
// before each new one so nothing leaks.
watch(selectedFile, (file) => {
  revokePreview()
  avatarErrorKey.value = null
  statusKey.value = null
  if (!file) return
  pendingRemoval.value = false
  previewUrl.value = URL.createObjectURL(file)
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    avatarErrorKey.value = 'profile.avatar.error.type'
  } else if (file.size > MAX_AVATAR_BYTES) {
    avatarErrorKey.value = 'profile.avatar.error.tooLarge'
  }
  // Mirror the staged state (or a client-guard failure) into the live region. The inline UAlert has
  // no live semantics of its own, so without this a screen-reader user gets no announcement that a
  // choice was staged or rejected.
  statusKey.value = avatarErrorKey.value ?? 'profile.avatar.staged'
})

// Any still-open object URL is revoked on unmount so navigating away never leaks a preview.
onBeforeUnmount(revokePreview)

// Stage a removal as a pending change, previewed as the initials circle and committed on Save. Remove
// is only offered when nothing is staged, so there is no picked file to clear here beyond a reset.
function stageRemoval() {
  resetStaged()
  pendingRemoval.value = true
  statusKey.value = 'profile.avatar.removalStaged'
}

// Discard any staged avatar change (a picked file or a pending removal) and return to the stored
// state. Cancel removes itself from the DOM, so move focus back to the picker rather than lose it.
function discardAvatarChange() {
  resetStaged()
  pendingRemoval.value = false
  statusKey.value = null
  void focusPicker()
}

// Map the server's typed 422 reasons onto the same inline messages the client guard uses.
const AVATAR_ERROR_KEYS: Record<string, string> = {
  'too-large': 'profile.avatar.error.tooLarge',
  'wrong-type': 'profile.avatar.error.type',
  undecodable: 'profile.avatar.error.corrupt'
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

// Commit the name change. A 422 carries a per-field data map from sendZodError; surface it inline on
// the offending field. Anything else is an unexpected failure and gets a generic toast. Returns
// whether the write succeeded so the caller can keep a succeeded part applied on a partial failure.
async function commitName(data: NameState): Promise<boolean> {
  try {
    await updateProfile.mutateAsync({
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim()
    })
    return true
  } catch (error) {
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
    return false
  }
}

// Commit the staged upload. On success clear the staging and announce it after the picker regains
// focus, so the selectedFile watcher (which fires on the reset and blanks the live region) cannot
// clobber the success message. A typed 422 maps to the inline message and keeps the preview so the
// user can pick another file; anything else is a generic retry toast.
async function commitUpload(): Promise<boolean> {
  statusKey.value = 'profile.avatar.uploading'
  try {
    await uploadAvatar.mutateAsync(selectedFile.value!)
    resetStaged()
    await focusPicker()
    statusKey.value = 'profile.avatar.uploadSuccess'
    return true
  } catch (error) {
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
    return false
  }
}

// Commit the staged removal. The server DELETE is idempotent; on success clear the pending flag and
// announce after focus returns. A failure keeps the removal staged so the user can retry from Save.
async function commitRemoval(): Promise<boolean> {
  statusKey.value = 'profile.avatar.removing'
  try {
    await removeAvatar.mutateAsync()
    pendingRemoval.value = false
    await focusPicker()
    statusKey.value = 'profile.avatar.removeSuccess'
    return true
  } catch {
    statusKey.value = 'profile.avatar.error.generic'
    toast.add({
      title: t('profile.avatar.error.generic'),
      color: 'error',
      icon: 'i-ph-warning-circle'
    })
    return false
  }
}

// The single Save commits both the name (if it changed) and the staged avatar change (if any) in one
// action, each through its own mutation. They run concurrently so one slow write does not gate the
// other, and each failure is contained: a succeeded part stays applied (its mutation already
// refreshed the session and invalidated the cache) while the failed part surfaces its own error for
// retry. No partial run leaves an invalid state; the deterministic server writes reconverge on retry.
async function onSubmit(event: FormSubmitEvent<NameState>) {
  const runName = hasNameChange.value
  const runUpload = Boolean(selectedFile.value) && !avatarErrorKey.value
  const runRemoval = pendingRemoval.value
  if (!runName && !runUpload && !runRemoval) return

  const avatarJob = runUpload
    ? commitUpload()
    : runRemoval
      ? commitRemoval()
      : Promise.resolve(true)

  const [nameOk, avatarOk] = await Promise.all([
    runName ? commitName(event.data) : Promise.resolve(true),
    avatarJob
  ])

  if (nameOk && avatarOk) {
    toast.add({ title: t('profile.success'), color: 'success', icon: 'i-ph-check-circle' })
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
      <UForm
        ref="form"
        class="flex flex-col gap-[clamp(1.25rem,3vh,1.75rem)]"
        :state="state"
        :validate="validate"
        @submit="onSubmit"
      >
        <!-- Identity summary: the avatar with its staging controls. The avatar circle doubles as the
             live preview surface, so the file picker's own file list is suppressed and the staged
             image (or the initials, for a staged removal) shows here instead. Nothing uploads on a
             pick; the single Save at the bottom commits the staged change. -->
        <div class="flex flex-col items-center gap-2 text-center">
          <AppAccountAvatar
            class="size-[clamp(4.5rem,12vw,6rem)] text-[clamp(1.5rem,4vw,2rem)]"
            :initials="initials"
            :src="displaySrc"
          />

          <!-- Avatar controls. The picker uses the button variant with a custom trigger so the only
               visible file affordance is one labelled button; the preview happens in the circle
               above. Beside it sits either a single Cancel for a staged change, or Remove for the
               current avatar, never both. -->
          <div class="mt-2 flex w-full flex-col items-center gap-3">
            <div class="flex flex-wrap items-center justify-center gap-2">
              <UFileUpload
                v-model="selectedFile"
                accept="image/png,image/jpeg,image/webp"
                :aria-label="
                  previewHasImage ? t('profile.avatar.replace') : t('profile.avatar.choose')
                "
                variant="button"
              >
                <template #default="{ open }">
                  <UButton
                    ref="pickerButton"
                    color="neutral"
                    :disabled="isSaving"
                    icon="i-ph-image"
                    :label="
                      previewHasImage ? t('profile.avatar.replace') : t('profile.avatar.choose')
                    "
                    variant="outline"
                    @click="open"
                  />
                </template>
              </UFileUpload>

              <UButton
                v-if="hasStagedAvatarChange"
                color="neutral"
                :disabled="isSaving"
                icon="i-ph-x"
                :label="t('profile.avatar.cancel')"
                variant="ghost"
                @click="discardAvatarChange"
              />

              <UButton
                v-if="showRemove"
                color="error"
                :disabled="isSaving"
                icon="i-ph-trash"
                :label="t('profile.avatar.remove')"
                variant="ghost"
                @click="stageRemoval"
              />
            </div>

            <p class="text-xs text-muted">{{ t('profile.avatar.hint') }}</p>

            <UAlert
              v-if="avatarErrorMessage"
              class="text-left"
              color="error"
              icon="i-ph-warning-circle"
              :title="avatarErrorMessage"
              variant="subtle"
            />

            <!-- Visually hidden live region announcing staged, pending, success, and error status. -->
            <p aria-atomic="true" aria-live="polite" class="sr-only">{{ statusMessage }}</p>
          </div>
        </div>

        <USeparator />

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
            :model-value="me?.email ?? ''"
            readonly
            type="email"
          />
        </UFormField>

        <div class="flex justify-end">
          <UButton
            color="primary"
            :disabled="saveDisabled"
            icon="i-ph-check-bold"
            :label="t('profile.submit')"
            :loading="isSaving"
            type="submit"
          />
        </div>
      </UForm>
    </UCard>
  </div>
</template>
