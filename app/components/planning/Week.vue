<script setup lang="ts">
import type { DayCapacity, PlanningTask } from '#shared/planning'
import type { OpenEditorTarget } from '~/utils/taskEditor'

// The seven-day week stack (PLAN-07), Sunday through Saturday. It is a thin renderer: the page owns
// the data and computes each day view, and this component stacks the day cards. The continuation set
// is threaded down so a split slice carried from an earlier day shows its tag. Each work day carries
// its precomputed capacity (PLAN-05); an off day carries null and renders no meter.
//
// The one open editor is threaded down and every editor event is re-emitted straight back up, because
// exclusivity is a week-wide fact and only the page can hold it. Nothing about it is decided here.
export type PlanningDayView = {
  capacity: DayCapacity | null
  date: string
  dayLabel: string
  isToday: boolean
  isWorkDay: boolean
  offLabel: string | null
  tasks: PlanningTask[]
}

defineProps<{
  continuationIds: Set<string>
  days: PlanningDayView[]
  editorFocusRequest: number
  openEditor: null | OpenEditorTarget
}>()

const emit = defineEmits<{
  closeEditor: [after?: () => void]
  openEditor: [target: OpenEditorTarget]
  saved: [payload: { mode: 'create' | 'update'; taskId: string }]
  'update:editorDirty': [dirty: boolean]
}>()
</script>

<template>
  <div class="space-y-[clamp(1rem,2vh,1.25rem)]">
    <PlanningDayCard
      v-for="day in days"
      :key="day.date"
      :capacity="day.capacity"
      :continuation-ids="continuationIds"
      :date="day.date"
      :day-label="day.dayLabel"
      :editor-focus-request="editorFocusRequest"
      :is-today="day.isToday"
      :is-work-day="day.isWorkDay"
      :off-label="day.offLabel"
      :open-editor="openEditor"
      :tasks="day.tasks"
      @close-editor="emit('closeEditor', $event)"
      @open-editor="emit('openEditor', $event)"
      @saved="emit('saved', $event)"
      @update:editor-dirty="emit('update:editorDirty', $event)"
    />
  </div>
</template>
