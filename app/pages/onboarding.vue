<script setup lang="ts">
import { coerceThemeId, DEFAULT_LOCALE } from '#shared/theme'
import StepAppearance from '~/components/onboarding/step-appearance.vue'
import StepIdentity from '~/components/onboarding/step-identity.vue'
import StepWork from '~/components/onboarding/step-work.vue'

definePageMeta({
  layout: 'auth'
})

const { t, setLocale } = useI18n()
const localePath = useLocalePath()
const { user } = useUserSession()
const { lightTheme, darkTheme } = useTheme()
const { mutateAsync: completeOnboarding, isPending } = useCompleteOnboarding()

useSeoMeta({
  title: () => t('onboarding.title'),
  description: () => t('onboarding.subtitle')
})

// The whole wizard shares one reactive form owned here and provided to every step. Appearance is
// seeded from the current session preferences so advancing without touching it persists those,
// and the work fields carry their schema defaults so the user can finish immediately.
const form = reactive<OnboardingForm>({
  firstName: '',
  lastName: '',
  password: '',
  confirm: '',
  lightTheme: coerceThemeId(user.value?.lightTheme),
  darkTheme: coerceThemeId(user.value?.darkTheme),
  locale: user.value?.locale ?? DEFAULT_LOCALE,
  dailyWorkMinutes: 450,
  workDays: [1, 2, 3, 4, 5],
  quotaWph: 450,
  timezone: 'America/Toronto'
})
provide(ONBOARDING_FORM_KEY, form)

// The steps are declared once as data. The progress indicator, the heading, the swapped body,
// and the navigation all read from this array, so adding a step later is one more entry plus its
// component and its fields on the shared form, with no change to the chrome around it.
const steps = [
  {
    key: 'identity',
    title: 'onboarding.steps.identity.title',
    subtitle: 'onboarding.steps.identity.subtitle',
    icon: 'i-ph-user',
    component: StepIdentity
  },
  {
    key: 'appearance',
    title: 'onboarding.steps.appearance.title',
    subtitle: 'onboarding.steps.appearance.subtitle',
    icon: 'i-ph-palette',
    component: StepAppearance
  },
  {
    key: 'work',
    title: 'onboarding.steps.work.title',
    subtitle: 'onboarding.steps.work.subtitle',
    icon: 'i-ph-briefcase',
    component: StepWork
  }
]

const stepIndex = ref(0)
const step = computed(() => steps[stepIndex.value]!)
const isLastStep = computed(() => stepIndex.value === steps.length - 1)
const stepperItems = computed(() =>
  steps.map((entry) => ({ title: t(entry.title), icon: entry.icon }))
)

const error = ref('')

// The step heading is moved into focus whenever the active step changes, so a keyboard or screen
// reader user is carried to the new step rather than left on a control that no longer exists. This
// also covers the breach-return path, where the wizard jumps back to step one and the now-hidden
// Finish button would otherwise leave focus stranded on the document body. The heading carries a
// visually hidden step count so the change is announced when it receives focus.
const stepHeading = ref<HTMLElement | null>(null)
watch(stepIndex, async () => {
  await nextTick()
  stepHeading.value?.focus()
})

// Only the identity step gates progress. It needs all four fields present, and the password and
// its confirmation must match, since the password is never echoed back to catch a typo later.
const identityComplete = computed(() =>
  Boolean(form.firstName.trim() && form.lastName.trim() && form.password && form.confirm)
)
const passwordMismatch = computed(() => form.password !== form.confirm)
const nextDisabled = computed(() => stepIndex.value === 0 && !identityComplete.value)

function goBack() {
  error.value = ''
  if (stepIndex.value > 0) {
    stepIndex.value -= 1
  }
}

function goNext() {
  error.value = ''
  // The identity step is the only one that can refuse to advance. Steps 2 and 3 never block.
  if (stepIndex.value === 0) {
    if (!identityComplete.value) {
      return
    }
    if (passwordMismatch.value) {
      error.value = t('onboarding.passwordMismatch')
      return
    }
  }
  if (stepIndex.value < steps.length - 1) {
    stepIndex.value += 1
  }
}

async function finish() {
  // Guard the identity fields even when the last step submitted directly, so a typo cannot slip
  // through. A mismatch sends the user back to step 1 where the password is editable again.
  if (!identityComplete.value || passwordMismatch.value) {
    stepIndex.value = 0
    error.value = t('onboarding.passwordMismatch')
    return
  }

  error.value = ''

  try {
    // One write for the whole wizard through the mutation composable, which refreshes the session
    // and invalidates the current-user key in its onSuccess. The confirmation is a client-only check
    // and is not sent.
    await completeOnboarding({
      firstName: form.firstName,
      lastName: form.lastName,
      password: form.password,
      lightTheme: form.lightTheme,
      darkTheme: form.darkTheme,
      locale: form.locale,
      dailyWorkMinutes: form.dailyWorkMinutes,
      workDays: form.workDays,
      quotaWph: form.quotaWph,
      timezone: form.timezone
    })

    // Apply the chosen appearance and language to the live client so the dashboard reflects the
    // wizard choices without a reload. useTheme's state drives the html data-theme through app.vue,
    // and setLocale switches the interface language. Writing only the shared form (which the steps
    // do) never touches this live state, which is why the picks looked reverted before.
    lightTheme.value = form.lightTheme
    darkTheme.value = form.darkTheme
    await setLocale(form.locale)

    await navigateTo(localePath('index'))
  } catch (e) {
    // The server returns the stable code "password_breached" so we can show a localized message
    // and return the user to step 1, where the password field can be changed.
    const code = (e as { data?: { statusMessage?: string } })?.data?.statusMessage
    if (code === 'password_breached') {
      error.value = t('onboarding.passwordBreached')
      stepIndex.value = 0
    } else {
      error.value = t('onboarding.error')
    }
  }
}

// Enter and the Finish button share one submit path. Before the last step it advances like Next,
// so a stray Enter never fires the network write early.
function onSubmit() {
  if (isLastStep.value) {
    finish()
  } else {
    goNext()
  }
}

// Warn before a hard refresh or tab close while onboarding is incomplete and identity fields hold
// typed values, since that entry is client-only and is lost on reload. The browser owns the exact
// wording of the prompt, so this only decides when it appears, not what it says. In-app navigation
// is unaffected, and a successful finish navigates away before this can fire.
const hasUnsavedEntries = computed(
  () =>
    !isPending.value && Boolean(form.firstName || form.lastName || form.password || form.confirm)
)

function warnOnUnload(occurrence: BeforeUnloadEvent) {
  if (!hasUnsavedEntries.value) return
  occurrence.preventDefault()
  occurrence.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', warnOnUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnOnUnload))
</script>

<template>
  <div
    class="page-radial flex min-h-dvh flex-col items-center bg-muted px-4 pb-12 pt-20 sm:px-6 sm:pb-16 sm:pt-28"
  >
    <UCard class="w-full max-w-lg" :ui="{ body: 'px-6 py-8 sm:px-9 sm:py-12' }">
      <form class="flex flex-col" @submit.prevent="onSubmit">
        <!-- The brand header stays constant across every step. -->
        <div class="flex flex-col items-center text-center">
          <AppLogo class="mb-4 h-10 sm:h-12" />

          <p class="mb-1 text-sm font-medium text-muted">{{ t('app.name') }}</p>

          <h1 class="text-2xl font-bold tracking-tight text-highlighted">
            {{ t('onboarding.title') }}
          </h1>
        </div>

        <!-- The progress indicator reads from the steps array and tracks the active position. -->
        <UStepper
          v-model="stepIndex"
          class="pointer-events-none my-6"
          color="primary"
          :items="stepperItems"
          size="sm"
        />

        <!-- The step heading is data-driven from the active entry. It takes focus on every step
             change and carries a visually hidden step count so the move is announced to assistive
             technology, since the stepper alone does not announce the current position. -->
        <div ref="stepHeading" class="mb-4 text-center focus:outline-none" tabindex="-1">
          <p class="sr-only">
            {{ t('onboarding.stepProgress', { current: stepIndex + 1, total: steps.length }) }}
          </p>
          <h2 class="text-lg font-semibold text-highlighted">{{ t(step.title) }}</h2>
          <p class="text-sm text-muted">{{ t(step.subtitle) }}</p>
        </div>

        <!-- Only this region swaps. The fixed minimum height keeps the card from jumping as the
             steps change, and the fade plus small slide is gated behind reduced-motion. -->
        <div class="min-h-[clamp(16rem,42vh,22rem)]">
          <Transition
            enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
            enter-from-class="opacity-0 translate-y-1"
            leave-active-class="transition duration-200 ease-in motion-reduce:transition-none"
            leave-to-class="opacity-0 -translate-y-1"
            mode="out-in"
          >
            <component :is="step.component" :key="step.key" />
          </Transition>

          <p v-if="error" class="mt-2 text-sm text-error" role="alert">{{ error }}</p>
        </div>

        <!-- The navigation is declared once and its state comes from the step index. -->
        <div class="mt-6 flex items-center justify-between gap-3">
          <UButton
            v-if="stepIndex > 0"
            class="btn-glow"
            color="neutral"
            icon="i-ph-arrow-left"
            :label="t('onboarding.nav.back')"
            type="button"
            variant="ghost"
            @click="goBack"
          />

          <UButton
            v-if="!isLastStep"
            class="btn-glow ml-auto"
            color="primary"
            :disabled="nextDisabled"
            :label="t('onboarding.nav.next')"
            trailing-icon="i-ph-arrow-right-bold"
            type="button"
            @click="goNext"
          />
          <UButton
            v-else
            class="btn-glow ml-auto"
            color="primary"
            :label="t('onboarding.submit')"
            :loading="isPending"
            trailing-icon="i-ph-check-bold"
            type="submit"
          />
        </div>
      </form>
    </UCard>
  </div>
</template>
