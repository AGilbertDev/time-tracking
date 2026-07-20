<script setup lang="ts">
import { type CapacityState, type DayCapacity, formatDuration } from '#shared/planning'

// The day capacity header (PLAN-05) mounted in the reserved `.cap` slot of a work-day card: a meter
// with the fill in the state colour and a hatched buffer band, and the booked/remaining reading. It
// holds no capacity logic; everything comes precomputed in the DayCapacity from the shared
// computeCapacity, so this component only maps state to a fill colour and formats durations. Off-day
// cards never render it (the page passes capacity only for work days), honouring the do-not-police
// rule. The role map follows the spec: good -> success, warn -> warning, bad -> error. The numeric
// reading is the sole textual carrier of capacity, which reads fine non-visually.
const { capacity } = defineProps<{ capacity: DayCapacity }>()

const { locale } = useI18n()

// Overbooked is exactly the 'bad' band (booked strictly exceeds workMinutes, so remaining < 0). Only
// then is the excess shown in the danger role and the remaining figure suppressed.
const overbooked = computed(() => capacity.state === 'bad')

// The meter fill uses the reserved semantic status tokens directly (matching StatusDot), so the bar
// colour reads the same in every theme rather than being recoloured by the active atmosphere.
const fillClass: Record<CapacityState, string> = {
  good: 'bg-[var(--ui-success)]',
  warn: 'bg-[var(--ui-warning)]',
  bad: 'bg-[var(--ui-error)]'
}

const bookedLabel = computed(() => formatDuration(capacity.booked, locale.value))
const remainingLabel = computed(() => formatDuration(capacity.remaining, locale.value))
const excessLabel = computed(() => formatDuration(capacity.excess, locale.value))
</script>

<template>
  <div class="flex items-center gap-3.5">
    <!-- The bar is decorative: the reading beside it carries the same numbers in words, so a screen
         reader gets capacity from the text rather than the colour or the bar alone. -->
    <div
      aria-hidden="true"
      class="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-accented"
    >
      <div
        class="absolute inset-y-0 left-0 rounded-full"
        :class="fillClass[capacity.state]"
        :style="{ width: `${capacity.fillPct}%` }"
      />
      <div
        class="planning-buffer absolute inset-y-0 right-0"
        :style="{ width: `${capacity.bufferPct}%` }"
      />
    </div>

    <div class="whitespace-nowrap text-sm tabular-nums text-muted">
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
  </div>
</template>
