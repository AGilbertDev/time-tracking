<script setup lang="ts">
import type { CapacityState, DayCapacity } from '#shared/planning'

// The capacity meter bar (PLAN-05): a track with the fill in the state colour and a hatched buffer
// band. It sits in the middle zone of a work-day header, beside the PlanningCapacityReading that
// carries the same numbers as text. The bar is decorative and aria-hidden, so a screen reader gets
// capacity from the reading rather than the colour or the bar. It holds no capacity logic beyond
// mapping the precomputed state to a fill colour. The track tone (bg-muted / dark:bg-elevated) plus
// the inset ring keep the empty extent visible on the tinted header band in either theme.
const { capacity } = defineProps<{ capacity: DayCapacity }>()

// The meter fill uses the reserved status hues softened with alpha, so the bar signals the capacity
// state calmly and still reads the same in every theme rather than being recoloured by the active
// atmosphere. Shade utilities (not the var()) are used so the /80 alpha composes.
const fillClass: Record<CapacityState, string> = {
  good: 'bg-success-500/80 dark:bg-success-400/80',
  warn: 'bg-warning-500/80 dark:bg-warning-400/80',
  bad: 'bg-error-500/80 dark:bg-error-400/80'
}
</script>

<template>
  <div
    aria-hidden="true"
    class="relative h-2.5 min-w-0 overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-accented dark:bg-elevated"
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
</template>
