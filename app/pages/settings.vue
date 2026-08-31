<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

import { categoryHue } from '#shared/categories'
import { DEFAULT_LOCALE, DEFAULT_THEME_ID } from '#shared/theme'

// The configuration page: four independent sections on one page, Work, Quotas, Security and Reset,
// the last of which is offered only to an admin and only while the server says the feature is on.
// Route name settings, localized to /parametres (fr)
// and /settings (en) by nuxt.config. The global auth middleware forces sign-in and onboarding, so any
// onboarded user reaches their own settings. Every write is scoped to the session user server-side.
// The sections load and save independently, so saving one never touches another's data and a failure
// in one leaves the others working.
const { t, setLocale } = useI18n()
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
// Every field arrives finished. quotaWph is the category's current figure and source says whether
// it came from the user or from the shipped default. No date arrives, because a quota is a current
// setting rather than a dated history and each task carries the figure it was created against. So
// nothing in this page resolves a quota, decides whether a category has one, or filters the list,
// because the server already did all three.
interface CategoryQuota {
  categoryId: string
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

// The provenance line for one row. The response says which of the two states the row is in, so this
// picks a string and does nothing else. Neither state is an absence, because an absence could not
// tell a figure the user set apart from a row this section has nothing to say about.
function quotaProvenance(entry: CategoryQuota): string {
  return entry.source === 'user'
    ? t('settings.quotas.userValue')
    : t('settings.quotas.defaultBadge')
}

const savingQuotas = ref(false)

// The rows whose figure differs from the loaded one, in the order the response carried them. Only
// these are written, and that matters for two reasons rather than for tidiness. Writing an
// untouched row stores a row and flips its source to the user, so the default marker disappears
// from a category nobody edited. And it pins the user to today's shipped figure for good, so
// improving a default could never reach them again.
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
    // dead button, and the submit stays enabled for the same reason.
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

// --- Reset onboarding (admin) --------------------------------------------------------------
// A self-action on the acting account's own configuration, which is why it lives here rather than on
// the admin users page. The endpoint takes no body and no target, so there is nothing for this page
// to parameterize and nothing it can aim wrongly.
const { data: me } = useMeQuery()
const localePath = useLocalePath()
const { lightTheme, darkTheme } = useTheme()
const { mutateAsync: resetOnboarding } = useResetOnboardingMutation()

// Whether to offer the control at all, as one finished boolean off /api/me. The server computes it
// as the caller's role being exactly admin AND the runtime switch being on, so this page renders on a
// single condition and works out nothing for itself. Deliberately no isAdmin call and no reading of
// the switch: the switch is a private config key that never reaches the client bundle, and combining
// two facts here would be a second copy of a rule the server already applied.
//
// The explicit === true is the anti-flash, and the absent case is the one that matters. useMeQuery
// seeds its initialData from the sealed session cookie, which does not carry this field, so it reads
// undefined on the first paint and only resolves once /api/me answers. Absent therefore reads as
// false, so the section can only ever go from absent to present. A control that must not appear while
// the switch is off belongs hidden when the answer is unknown rather than shown and then withdrawn.
const showReset = computed(() => me.value?.canResetOnboarding === true)

const confirmOpen = ref(false)
const resetting = ref(false)
const cancelButton = useTemplateRef('cancelButton')

// Left alone, reka-ui autofocuses the first focusable element in the dialog, which in UModal is the
// header's close button. On a destructive dialog the arrival point should be the action that does
// nothing, so DialogContent's own open-autofocus event is intercepted and focus is placed on Cancel.
// Enter or Space on arrival then dismisses rather than confirming.
//
// The fallback is not defensive padding. preventDefault above cancels reka-ui's own focusFirst, so
// once this handler runs nothing else will place focus, and FocusScope's internal fallback cannot
// cover for it either because its lastFocusedElement ref is still null at mount. If the Cancel
// lookup resolves to nothing, focus stays on the Reset button, which is outside the dialog and
// inside a subtree UModal has just marked aria-hidden, so a screen reader user is parked on a
// control their reader cannot describe and outside a trap that never armed.
//
// currentTarget is the FocusScope container, which carries tabindex="-1" and is therefore
// focusable, and it is read here rather than inside the callback because currentTarget is only set
// while the event is being dispatched and reads back as null afterwards.
function focusCancel(event: Event) {
  event.preventDefault()
  const container = event.currentTarget

  nextTick(() => {
    const cancel = cancelButton.value?.$el
    if (cancel instanceof HTMLElement) {
      cancel.focus()
      return
    }
    if (container instanceof HTMLElement) container.focus()
  })
}

async function onConfirmReset() {
  resetting.value = true
  try {
    // The server decides what a reset means and returns the refreshed session, which the mutation
    // re-reads in its onSuccess. Nothing here knows which rows were cleared or what they fall back
    // to, so there is no second copy of that enumeration on the client.
    await resetOnboarding()

    // The deleted settings row carried the theme and the interface language, so both are back to
    // their coded defaults server-side. Refreshing the session alone leaves the old theme painted
    // and the old language in place, because useTheme's ids are useState seeded once from the
    // session and the active locale is not read off it at all. Same re-apply the wizard does after
    // its own write, with the shared defaults rather than a pick.
    lightTheme.value = DEFAULT_THEME_ID
    darkTheme.value = DEFAULT_THEME_ID
    await setLocale(DEFAULT_LOCALE)

    confirmOpen.value = false

    // The dashboard, never the onboarding path. auth.global.ts sees onboarded: false and redirects,
    // so the rule about where a user who has not finished setup belongs stays in the one place that
    // already owns it.
    await navigateTo(localePath('index'))

    // Last on purpose, and both halves of that position are load-bearing. Do not move it back up.
    //
    // After the locale switch, so the message reads in the language the interface has just become
    // rather than sitting in English on a French page. That was always the reason it sat late.
    //
    // After the navigation for a second reason. UModal calls reka-ui's useHideOthers, which sets
    // aria-hidden="true" on every sibling of the dialog's ancestor chain and makes no exception for
    // an [aria-live] element. The toast viewport is a direct child of body, so a toast added while
    // the dialog is still mounted, which includes the whole of its exit animation, is appended
    // inside an aria-hidden subtree and is never announced at all. Awaiting the navigation first
    // unmounts this page with its modal, so the live region is uncovered by the time this runs.
    toast.add({ title: t('settings.reset.success'), color: 'success', icon: 'i-ph-check-circle' })
  } catch {
    // Nothing else changes and pressing Reset again is the documented recovery, so the failure needs
    // no inline region in the card, only the same toast the other three sections use.
    confirmOpen.value = false
    toast.add({
      title: t('settings.reset.errors.generic'),
      color: 'error',
      icon: 'i-ph-warning-circle'
    })
  } finally {
    resetting.value = false
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
                   the list, and a value the user set stays quiet and says only that it is theirs. -->
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

    <!-- Reset section, admin only and appended last. A destructive action belongs at the end of a
         page rather than between two things the user came to edit, and last is also the only
         position that leaves the three sections above it untouched, since adding or removing a last
         child under a space-y wrapper changes nothing about its siblings. The condition is an
         affordance, not the gate: the server's admin wrapper is the real boundary and refuses a
         non-admin, or an admin calling while the switch is off, with the same indistinguishable
         403. -->
    <section v-if="showReset" aria-labelledby="settings-reset-heading" class="space-y-4">
      <div>
        <h2
          id="settings-reset-heading"
          class="flex items-center gap-2 text-lg font-semibold text-highlighted"
        >
          <UIcon class="size-5 text-primary" name="i-ph-arrow-counter-clockwise-bold" />
          {{ t('settings.reset.heading') }}
        </h2>
        <p class="mt-1 text-sm text-muted">{{ t('settings.reset.subtitle') }}</p>
      </div>

      <!-- No skeleton and no load-failure alert, because this section reads nothing. The card is the
           shipped one with no error tint and no coloured ring: a permanent red block on a page used
           routinely becomes furniture, and the heading is not where the decision happens. -->
      <UCard class="rounded-2xl bg-default ring ring-default">
        <div class="flex justify-end">
          <!-- error + subtle is the whole of the at-rest signal, and its job is to say this is not a
               fourth Save rather than to carry the warning, which the modal states in words. The
               icon changes from a check to a counter-clockwise arrow so the difference survives with
               all colour removed. No :loading and no type="submit": pressing this sends nothing, so
               a loading state here would be a lie and it lives on the modal's confirm instead.
               Solid error is held back for that confirm so the two steps read as an escalation. -->
          <UButton
            color="error"
            icon="i-ph-arrow-counter-clockwise-bold"
            :label="t('settings.reset.submit')"
            variant="subtle"
            @click="confirmOpen = true"
          />
        </div>
      </UCard>

      <!-- The confirmation, declared INSIDE the guarded section on purpose. Do not lift it back
           out to be a sibling. UModal portals its content out of the document flow, so its position
           in the template affects no layout and no stacking, which is what makes nesting it here
           free and is the same fact that used to be given as the reason for placing it outside.
           As a sibling the component was instantiated whatever the switch said, and the
           confirmation stayed unreachable only because the single writer of confirmOpen = true
           happened to sit inside the unrendered section. That is a property of where one assignment
           lives rather than of the template, and any later deep link or keyboard shortcut that
           opened the dialog would undo it silently. As a child it is not built at all while
           showReset is false, so AC26.3 holds by construction rather than by argument.
           scrollable moves the overflow onto the overlay, which matters because every one of its
           sentences is in the header and the header does not scroll, so a short viewport would
           otherwise clip a warning about an irreversible action off the bottom of the screen. -->
      <UModal
        v-model:open="confirmOpen"
        :content="{ onOpenAutoFocus: focusCancel }"
        scrollable
        :title="t('settings.reset.confirm.title')"
        :ui="{ description: 'mt-2 space-y-3 text-sm text-muted', footer: 'justify-end' }"
      >
        <!-- All four sentences live in #description rather than #body, and that is the one thing here
             that is silently wrong if it moves. UModal builds the dialog's accessible description from
             this slot, and a modal whose prose sits in #body renders correctly, looks right, and
             announces a title followed by an empty description. DialogDescription renders as a <p>, so
             each sentence is a span rather than a div, a p or a li: anything else closes the paragraph
             early and produces a real hydration mismatch. Weight, not colour, carries the emphasis. -->
        <template #description>
          <span class="block text-default">{{ t('settings.reset.confirm.cleared') }}</span>
          <span class="block">{{ t('settings.reset.confirm.kept') }}</span>
          <span class="block">{{ t('settings.reset.confirm.password') }}</span>
          <span class="block font-medium text-highlighted">
            {{ t('settings.reset.confirm.irreversible') }}
          </span>
        </template>

        <!-- Cancel is the safe option and holds initial focus, so Enter and Space on arrival do
             nothing and Escape does the same thing as Cancel. Both stay enabled while the request is
             in flight: disabling them would guard against leaving mid-write, and it would also trap
             the user if the request hung, where leaving is already a documented-safe state. -->
        <template #footer="{ close }">
          <UButton
            ref="cancelButton"
            color="neutral"
            :label="t('settings.reset.confirm.cancel')"
            variant="ghost"
            @click="close"
          />
          <UButton
            color="error"
            :label="t('settings.reset.confirm.submit')"
            :loading="resetting"
            @click="onConfirmReset"
          />
        </template>
      </UModal>
    </section>
  </div>
</template>
