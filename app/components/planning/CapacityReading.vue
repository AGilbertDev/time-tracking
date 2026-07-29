<script setup lang="ts">
import { type DayCapacity, formatDuration } from '#shared/planning'

// The capacity reading (PLAN-05): the booked/remaining figures in words, in the right zone of a
// work-day header beside the PlanningCapacityBar. This is the sole textual carrier of capacity, so it
// reads fine non-visually. It holds no capacity logic beyond formatting the precomputed durations and
// choosing the remaining/excess phrasing. Everything comes precomputed in the DayCapacity from the
// shared computeCapacity.
const { capacity } = defineProps<{ capacity: DayCapacity }>()

const { locale } = useI18n()

// Overbooked is exactly the 'bad' band (booked strictly exceeds workMinutes, so remaining < 0). Only
// then is the excess shown in the danger role and the remaining figure suppressed.
const overbooked = computed(() => capacity.state === 'bad')

const bookedLabel = computed(() => formatDuration(capacity.booked, locale.value))
const remainingLabel = computed(() => formatDuration(capacity.remaining, locale.value))
const excessLabel = computed(() => formatDuration(capacity.excess, locale.value))
</script>

<template>
  <div class="whitespace-nowrap text-sm tabular-nums text-toned">
    <i18n-t keypath="planning.capacity.planned" tag="span">
      <template #value>
        <b class="font-bold text-highlighted">{{ bookedLabel }}</b>
      </template>
    </i18n-t>
    <span aria-hidden="true"> · </span>
    <i18n-t v-if="!overbooked" keypath="planning.capacity.remaining" tag="span">
      <template #value>{{ remainingLabel }}</template>
    </i18n-t>
    <i18n-t
      v-else
      class="text-error-700 dark:text-error-400"
      keypath="planning.capacity.excess"
      tag="span"
    >
      <template #value>{{ excessLabel }}</template>
    </i18n-t>
  </div>
</template>
