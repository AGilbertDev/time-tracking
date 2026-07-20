<script setup lang="ts">
import type { PlanningTask } from '#shared/planning'

// One day card in the week stack (PLAN-07). A working day is a solid card with a ring; today adds a
// primary ring and the `aujourd'hui` pill; a non-work day is a dashed transparent hint with an italic
// label, and today on a non-work day composes both. The header reserves a `capacity` slot where
// Bout 2 (PLAN-03 + PLAN-05) mounts the meter, reading, and state pill; it renders nothing here and
// leaves no dead gap. A no-task working day body stays visually empty by design.
const props = defineProps<{
  date: string
  dayLabel: string
  isToday: boolean
  isWorkDay: boolean
  offLabel: string | null
  tasks: PlanningTask[]
  continuationIds: Set<string>
}>()

const { t } = useI18n()
const slots = useSlots()

const cardClass = computed(() => {
  const classes = ['overflow-hidden rounded-2xl']
  classes.push(
    props.isWorkDay
      ? 'bg-default ring ring-default shadow-sm'
      : 'border border-dashed border-default'
  )
  if (props.isToday) classes.push('ring-2 ring-primary')
  return classes
})
</script>

<template>
  <section :aria-labelledby="`planning-day-${date}`" :class="cardClass">
    <!-- The header carries a bottom border whenever rows follow it, so a work day and an off day
         that still holds weekend work both separate the header from the rows. A bare off-day hint
         with no rows keeps the borderless dashed look from the mockup. -->
    <div
      class="flex flex-wrap items-center gap-x-5 gap-y-3 px-[18px] py-[15px]"
      :class="{ 'border-b border-default': isWorkDay || tasks.length }"
    >
      <div class="flex min-w-0 items-baseline gap-2.5">
        <!-- The stored label is lowercase (`lundi 20 juill.`); only the first letter is lifted so the
             month stays lowercase, which is correct French rather than title-casing every word. -->
        <h2
          :id="`planning-day-${date}`"
          class="text-[17px] font-bold tracking-tight text-highlighted first-letter:uppercase"
        >
          {{ dayLabel }}
        </h2>
        <span
          v-if="isToday"
          class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-400"
        >
          {{ t('planning.today') }}
        </span>
      </div>

      <span v-if="offLabel" class="text-sm italic text-muted">{{ offLabel }}</span>

      <!-- Reserved capacity slot for Bout 2. Rendered only when a later bout fills it, so Bout 1
           leaves no empty gap in the header. -->
      <div v-if="slots.capacity" class="ml-auto flex min-w-60 flex-1 items-center">
        <slot name="capacity" />
      </div>
    </div>

    <ul v-if="tasks.length" class="divide-y divide-default" role="list">
      <li v-for="task in tasks" :key="task.id">
        <PlanningTaskRow :is-split-continuation="continuationIds.has(task.id)" :task="task" />
      </li>
    </ul>
  </section>
</template>
