<script setup lang="ts">
// The three work controls the dashboard surfaces at review time: the daily target as an hours and
// minutes pair, the Monday-first work-day toggle, and the timezone. It is purely presentational and
// drives its parent through a model per field, so both the settings page and (later) the onboarding
// work step can reuse the same idiom. Nothing here blocks or forces a value, in line with the
// product rule that the app records reality rather than policing a schedule.
//
// The words-per-hour quota used to be the fourth control here. It is now a per-category setting with
// its own section on the settings page, so this component no longer carries it and onboarding no
// longer asks for it.
//
// The hours/minutes split and the timezone enumeration are lifted verbatim from the onboarding work
// step so the two stay identical until onboarding is migrated onto this component.
const { t } = useI18n()

const dailyWorkMinutes = defineModel<number>('dailyWorkMinutes', { required: true })
const workDays = defineModel<number[]>('workDays', { required: true })
const timezone = defineModel<string>('timezone', { required: true })

// The stored value is total minutes, but it reads more naturally split into hours and minutes.
// Each half keeps the other's contribution when it changes so the two inputs stay consistent. The
// stored total is clamped into the range the server accepts (1 to 1440 minutes) so no combination
// the inputs allow can produce a value that fails validation.
function clampMinutes(total: number): number {
  return Math.min(1440, Math.max(1, total))
}

const hours = computed({
  get: () => Math.floor(dailyWorkMinutes.value / 60),
  set: (value) => {
    dailyWorkMinutes.value = clampMinutes(value * 60 + (dailyWorkMinutes.value % 60))
  }
})

const minutes = computed({
  get: () => dailyWorkMinutes.value % 60,
  set: (value) => {
    dailyWorkMinutes.value = clampMinutes(Math.floor(dailyWorkMinutes.value / 60) * 60 + value)
  }
})

// The week is shown Monday first to match how the user reads a work week, while the stored day
// numbers follow JavaScript's getDay where Sunday is 0. Toggling a day adds or removes it and keeps
// the array sorted so the stored order is stable. An empty selection is allowed.
const weekOrder = [1, 2, 3, 4, 5, 6, 0]

function isWorkDay(day: number): boolean {
  return workDays.value.includes(day)
}

function toggleWorkDay(day: number) {
  workDays.value = isWorkDay(day)
    ? workDays.value.filter((value) => value !== day)
    : [...workDays.value, day].sort((a, b) => a - b)
}

// The timezone list comes from the runtime's own IANA list when it is available, which is the same
// source the server validates against. A runtime that cannot enumerate zones falls back to the
// current value so the control still renders a valid option.
const timezones = computed(() => {
  const supportedValues = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf
  return typeof supportedValues === 'function' ? supportedValues('timeZone') : [timezone.value]
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <UFormField :label="t('onboarding.work.dailyHours')">
      <div class="flex items-end gap-3">
        <div class="flex items-center gap-1.5">
          <UInputNumber
            v-model="hours"
            :aria-label="t('onboarding.work.hoursLabel')"
            class="w-24"
            :max="23"
            :min="0"
          />
          <span class="text-sm text-muted">{{ t('onboarding.work.unitHours') }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <UInputNumber
            v-model="minutes"
            :aria-label="t('onboarding.work.minutesLabel')"
            class="w-24"
            :max="59"
            :min="0"
            :step="5"
          />
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

    <UFormField :label="t('onboarding.work.timezone')">
      <USelectMenu
        v-model="timezone"
        class="w-full"
        icon="i-ph-globe"
        :items="timezones"
        :search-input="{ placeholder: t('onboarding.work.timezoneSearch') }"
      />
    </UFormField>
  </div>
</template>
