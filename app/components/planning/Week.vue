<script setup lang="ts">
import type { DayCapacity, PlanningTask } from '#shared/planning'

// The seven-day week stack (PLAN-07), Sunday through Saturday. It is a thin renderer: the page owns
// the data and computes each day view, and this component stacks the day cards. The continuation set
// is threaded down so a split slice carried from an earlier day shows its tag. Each work day carries
// its precomputed capacity (PLAN-05); an off day carries null and renders no meter.
export type PlanningDayView = {
  date: string
  dayLabel: string
  isToday: boolean
  isWorkDay: boolean
  offLabel: string | null
  tasks: PlanningTask[]
  capacity: DayCapacity | null
}

defineProps<{
  days: PlanningDayView[]
  continuationIds: Set<string>
}>()
</script>

<template>
  <div class="space-y-3.5">
    <PlanningDayCard
      v-for="day in days"
      :key="day.date"
      :capacity="day.capacity"
      :continuation-ids="continuationIds"
      :date="day.date"
      :day-label="day.dayLabel"
      :is-today="day.isToday"
      :is-work-day="day.isWorkDay"
      :off-label="day.offLabel"
      :tasks="day.tasks"
    />
  </div>
</template>
