<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

import { categoryHue } from '#shared/categories'

// The configuration page: three independent sections on one page, Work, Quotas and Security. Route
// name settings, localized to /parametres (fr) and /settings (en) by nuxt.config. The global auth
// middleware forces sign-in and onboarding, so any onboarded user reaches their own settings. Every
// write is scoped to the session user server-side. The three forms load and save independently, so
// saving one never touches another's data and a failure in one leaves the others working.
const { t, locale } = useI18n()
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
  timezone: 'America/Toronto'
})

watchEffect(() => {
  if (!workData.value) return
  workState.dailyWorkMinutes = workData.value.dailyWorkMinutes
  workState.workDays = [...workData.value.workDays]
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

// --- Per-category quotas -------------------------------------------------------------------
// One resolved entry per trackable category, typed locally exactly as the work settings above are.
// Every field arrives finished. quotaWph is the figure in force today, source says whether it came
// from the user or from the shipped default, and effectiveFrom is the date of the winning row or null
// for a default. So nothing in this page resolves a quota, decides whether a category has one, or
// filters the list, because the server already did all three.
interface CategoryQuota {
  categoryId: string
  effectiveFrom: string | null
  quotaWph: number
  source: 'default' | 'user'
}

const {
  data: quotaData,
  status: quotaStatus,
  refresh: refreshQuotas
} = await useAsyncData<CategoryQuota[]>('me-category-quotas', () =>
  $fetch('/api/me/category-quotas', { headers: requestHeaders })
)

// The editable copy, keyed by category id rather than by position, so a row is edited by name and no
// part of this page assumes how many rows there are. It is re-seeded from the response on load and on
// the reconcile after a save, which is what makes a partially persisted write show what actually
// landed rather than what was typed, and it is also what makes quotaData the baseline the submit
// compares against. The submit reads the response's own entries, so a key left over from an earlier
// response is never sent.
//
// A value is number or undefined because reka-ui writes undefined into the model when the input is
// cleared, in NumberFieldRoot. The runtime behaviour is right and the narrower type was not, so the
// type says what actually happens and every reader below handles the cleared case.
const quotaState = reactive<Record<string, number | undefined>>({})

watchEffect(() => {
  if (!quotaData.value) return
  for (const entry of quotaData.value) {
    quotaState[entry.categoryId] = entry.quotaWph
  }
})

// The active locale drives the date format, matching the admin table. The timezone is pinned to UTC
// on purpose. effectiveFrom is a plain calendar day, and new Date('2026-08-23') parses as UTC
// midnight, which any negative offset such as America/Toronto would render as the previous day.
const quotaDateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeZone: 'UTC' })
)

// The provenance line for one row. The response says which of the two states the row is in, so this
// picks a string and formats a date the server already chose. Formatting for display is presentation
// and stays here. Nothing about which date to show is decided in this page.
function quotaProvenance(entry: CategoryQuota): string {
  if (entry.source === 'user' && entry.effectiveFrom) {
    return t('settings.quotas.userSince', {
      date: quotaDateFormatter.value.format(new Date(entry.effectiveFrom))
    })
  }
  return t('settings.quotas.defaultBadge')
}

const savingQuotas = ref(false)

// The rows whose figure differs from the loaded one, in the order the response carried them. Only
// these are written, and that matters for three reasons rather than for tidiness. Writing an
// untouched row dates a stored row today and flips its source to the user, so the default marker
// disappears from a category nobody edited. It fills the effective-dated history with edits that
// were not edits. And it pins the user to today's shipped figure for good, so improving a default
// could never reach them again.
//
// A cleared input reads as undefined and falls back to the loaded figure, which therefore counts as
// unchanged and is not sent.
function changedQuotas(): { categoryId: string; quotaWph: number }[] {
  return (quotaData.value ?? []).flatMap((entry) => {
    const edited = quotaState[entry.categoryId] ?? entry.quotaWph
    return edited === entry.quotaWph ? [] : [{ categoryId: entry.categoryId, quotaWph: edited }]
  })
}

async function onSaveQuotas() {
  savingQuotas.value = true
  try {
    const changed = changedQuotas()

    // Nothing differs from what is stored, so there is nothing to write and no request goes out. The
    // success toast still fires, because a save that reports nothing back is indistinguishable from a
    // dead button, and the submit stays enabled for the same reason. No date goes with the write
    // either, since it is effective today and the server dates it from the user's own stored
    // timezone.
    if (changed.length > 0) {
      await $fetch('/api/me/category-quotas', {
        method: 'PATCH',
        body: { quotas: changed }
      })
      await refreshQuotas()
    }

    toast.add({ title: t('settings.quotas.success'), color: 'success', icon: 'i-ph-check-circle' })
  } catch {
    toast.add({
      title: t('settings.quotas.errors.generic'),
      color: 'error',
      icon: 'i-ph-warning-circle'
    })
  } finally {
    savingQuotas.value = false
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

    <!-- Quotas section. One numeric field per entry the API returned, in the order it returned
         them. Nothing here sorts, filters, groups or counts the rows, so the same markup serves one
         category or twenty. -->
    <section aria-labelledby="settings-quotas-heading" class="space-y-4">
      <div>
        <h2
          id="settings-quotas-heading"
          class="flex items-center gap-2 text-lg font-semibold text-highlighted"
        >
          <UIcon class="size-5 text-primary" name="i-ph-target-bold" />
          {{ t('settings.quotas.heading') }}
        </h2>
        <p class="mt-1 text-sm text-muted">{{ t('settings.quotas.subtitle') }}</p>
      </div>

      <UCard class="rounded-2xl bg-default ring ring-default">
        <!-- Never blank, and independent of the other two sections: a skeleton while the figures
             load, an alert with retry on failure, and the form once they are in hand. -->
        <div v-if="quotaStatus === 'error'" role="alert">
          <UAlert
            :actions="[
              {
                label: t('settings.quotas.retry'),
                color: 'neutral',
                variant: 'outline',
                onClick: () => refreshQuotas()
              }
            ]"
            color="error"
            icon="i-ph-warning-circle"
            :title="t('settings.quotas.loadError')"
            variant="subtle"
          />
        </div>

        <!-- The pending state stands on the loaded grid so the card does not resize when the data
             lands. Four placeholder cells is a guess at today's count rather than a count anything
             here depends on, since reading the contract for the real number is the inference the API
             removed. -->
        <div
          v-else-if="quotaStatus === 'pending'"
          class="grid grid-cols-1 gap-x-6 gap-y-[clamp(1rem,2.5vh,1.5rem)] sm:grid-cols-2"
        >
          <div v-for="placeholder in 4" :key="placeholder" class="space-y-2">
            <USkeleton class="h-4 w-32" />
            <USkeleton class="h-9 w-full" />
          </div>
        </div>

        <!-- No entry carries a quota. Unreachable against today's contract and rendered rather than
             left blank, and with no submit, since there is no field to send. -->
        <p v-else-if="!quotaData?.length" class="text-sm text-muted">
          {{ t('settings.quotas.empty') }}
        </p>

        <UForm v-else class="space-y-6" :state="quotaState" @submit="onSaveQuotas">
          <div class="grid grid-cols-1 gap-x-6 gap-y-[clamp(1rem,2.5vh,1.5rem)] sm:grid-cols-2">
            <!-- The unit takes the hint prop and the provenance takes the help prop, both as plain
                 strings. UFormField builds its aria-describedby from its props and not from its
                 slots, so a slot on its own would render text no screen reader ever reaches. The
                 label takes a slot because it carries the category colour, and reka-ui's Label keeps
                 its :for either way. -->
            <UFormField
              v-for="entry in quotaData"
              :key="entry.categoryId"
              :help="quotaProvenance(entry)"
              :hint="t('onboarding.work.unitWph')"
              :name="entry.categoryId"
              :ui="{ hint: 'shrink-0', label: 'min-w-0 break-words' }"
            >
              <template #label>
                <!-- The category colour through the mechanism PLAN-32c shipped. Lightness and chroma
                     are fixed per mode in main.css and only the hue arrives here, read from the
                     shared contract, so there is no colour mapping in this page. -->
                <span
                  class="planning-cat-name"
                  :style="{ '--planning-cat-hue': categoryHue(entry.categoryId) }"
                >
                  {{ t(`categories.${entry.categoryId}`) }}
                </span>
              </template>

              <UInputNumber
                v-model="quotaState[entry.categoryId]"
                class="w-full"
                :max="10000"
                :min="1"
                :ui="{ base: 'tabular-nums' }"
              />

              <!-- The slot renders the same string the help prop carries, and only changes how the
                   default case is printed. An untouched default is the state worth spotting across
                   the list, and a value the user set stays quiet and says when it took effect. -->
              <template #help="{ help }">
                <UBadge
                  v-if="entry.source === 'default'"
                  color="neutral"
                  :label="help"
                  size="sm"
                  variant="subtle"
                />
                <template v-else>{{ help }}</template>
              </template>
            </UFormField>
          </div>

          <div class="flex justify-end">
            <UButton
              class="btn-glow"
              color="primary"
              icon="i-ph-check-bold"
              :label="t('settings.quotas.submit')"
              :loading="savingQuotas"
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
