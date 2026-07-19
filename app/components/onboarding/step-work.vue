<script setup lang="ts">
// The work step captures the numbers the dashboard surfaces at review time. Every field is
// pre-filled with its default from the shared form, so the user can finish immediately. Nothing
// here blocks the wizard, in line with the product rule that the app records reality rather than
// policing a schedule.
const { t } = useI18n()
const form = useOnboardingForm()

// The stored value is total minutes, but it reads more naturally split into hours and minutes.
// Each half keeps the other's contribution when it changes so the two inputs stay consistent.
// The stored total is clamped into the range the server accepts (1 to 1440 minutes) so no
// combination the inputs allow can produce a value that fails validation and blocks the wizard.
function clampMinutes(total: number): number {
  return Math.min(1440, Math.max(1, total))
}

const hours = computed({
  get: () => Math.floor(form.dailyWorkMinutes / 60),
  set: (value) => {
    form.dailyWorkMinutes = clampMinutes(value * 60 + (form.dailyWorkMinutes % 60))
  }
})

const minutes = computed({
  get: () => form.dailyWorkMinutes % 60,
  set: (value) => {
    form.dailyWorkMinutes = clampMinutes(Math.floor(form.dailyWorkMinutes / 60) * 60 + value)
  }
})

// The week is shown Monday first to match how the user reads a work week, while the stored day
// numbers follow JavaScript's getDay where Sunday is 0. Toggling a day adds or removes it and
// keeps the array sorted so the stored order is stable. An empty selection is allowed.
const weekOrder = [1, 2, 3, 4, 5, 6, 0]

function isWorkDay(day: number): boolean {
  return form.workDays.includes(day)
}

function toggleWorkDay(day: number) {
  form.workDays = isWorkDay(day)
    ? form.workDays.filter((value) => value !== day)
    : [...form.workDays, day].sort((a, b) => a - b)
}

// The timezone list comes from the runtime's own IANA list when it is available, which is the
// same source the server validates against. A runtime that cannot enumerate zones falls back to
// the current value so the control still renders a valid option.
const timezones = computed(() => {
  const supportedValues = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf
  return typeof supportedValues === 'function' ? supportedValues('timeZone') : [form.timezone]
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <UFormField :label="t('onboarding.work.dailyHours')">
      <div class="flex items-end gap-3">
        <div class="flex items-center gap-1.5">
          <UInputNumber v-model="hours" class="w-24" :max="23" :min="0" />
          <span class="text-sm text-muted">{{ t('onboarding.work.unitHours') }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <UInputNumber v-model="minutes" class="w-24" :max="59" :min="0" :step="5" />
          <span class="text-sm text-muted">{{ t('onboarding.work.unitMinutes') }}</span>
        </div>
      </div>
    </UFormField>

    <UFormField :label="t('onboarding.work.workDays')">
      <div :aria-label="t('onboarding.work.workDays')" class="flex flex-wrap gap-1.5" role="group">
        <UButton
          v-for="day in weekOrder"
          :key="day"
          :aria-label="t(`onboarding.work.dayNames.${day}`)"
          :aria-pressed="isWorkDay(day)"
          class="w-10 justify-center"
          :color="isWorkDay(day) ? 'primary' : 'neutral'"
          size="sm"
          :variant="isWorkDay(day) ? 'solid' : 'outline'"
          @click="toggleWorkDay(day)"
        >
          {{ t(`onboarding.work.dayShort.${day}`) }}
        </UButton>
      </div>
    </UFormField>

    <UFormField :hint="t('onboarding.work.unitWph')" :label="t('onboarding.work.quota')">
      <UInputNumber v-model="form.quotaWph" class="w-full" :max="10000" :min="1" />
    </UFormField>

    <UFormField :label="t('onboarding.work.timezone')">
      <USelectMenu
        v-model="form.timezone"
        class="w-full"
        icon="i-ph-globe"
        :items="timezones"
        :search-input="{ placeholder: t('onboarding.work.timezoneSearch') }"
      />
    </UFormField>
  </div>
</template>
