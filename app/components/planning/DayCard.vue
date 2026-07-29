<script setup lang="ts">
import type { DayCapacity, PlanningTask } from '#shared/planning'

// One day card in the week stack (PLAN-07). Every day is one section: a three-zone header row above
// its task rows. The header is a grid so the meters line up down the week — a fixed 16rem left column
// (the day name plus the `aujourd'hui` pill, and a `Congé` tag on an off day), the capacity meter bar
// in the flexible middle, and the booked/remaining reading on the right. A work day is a solid card
// with a tinted header band; an off day is a quieter dashed block with no meter and no reading (the
// do-not-police rule keeps a non-work day off the capacity read), and today adds a primary ring on
// either. Off days that still hold recorded work render their task rows below the header all the same.
const props = defineProps<{
  date: string
  dayLabel: string
  isToday: boolean
  isWorkDay: boolean
  offLabel: string | null
  tasks: PlanningTask[]
  continuationIds: Set<string>
  capacity: DayCapacity | null
}>()

const { t } = useI18n()

// A work day is a lifted white card with a ring and a soft shadow; an off day is a quieter pale block
// with a dashed edge so it stays clearly present without competing with the work days. Today layers a
// primary ring on either.
const containerClass = computed(() => {
  const classes = [
    'overflow-hidden rounded-2xl',
    props.isWorkDay
      ? 'bg-default ring ring-accented shadow-md dark:bg-elevated dark:ring-default'
      : 'border border-dashed border-accented bg-elevated dark:bg-default'
  ]
  if (props.isToday) classes.push('ring-2 ring-primary')
  return classes
})

// The header is the three-zone grid. The fixed 16rem left track holds the day identity, so every
// middle bar starts at the same x down the week; the middle flexes and the reading takes what it
// needs. Below md it collapses to stacked rows. Only a work day paints the tinted band.
const headerClass = computed(() => {
  const classes = [
    'grid grid-cols-1 gap-x-6 gap-y-3 px-[18px] py-4 md:grid-cols-[16rem_minmax(0,1fr)_auto] md:items-center'
  ]
  if (props.isWorkDay) classes.push('bg-accented dark:bg-default')
  return classes
})

// The day name stays the same size on every day; a work day is emphatic, an off day recedes.
const dayNameClass = computed(() =>
  props.isWorkDay
    ? 'text-[17px] font-semibold tracking-tight text-highlighted first-letter:uppercase'
    : 'text-[17px] font-medium text-muted first-letter:uppercase'
)
</script>

<template>
  <section :aria-labelledby="`planning-day-${date}`" :class="containerClass">
    <div :class="headerClass">
      <!-- Left zone: the day name and its tags. The stored label is lowercase (`lundi 20 juill.`);
           only the first letter is lifted so the month stays lowercase, which is correct French
           rather than title-casing every word. -->
      <div class="flex min-w-0 flex-wrap items-baseline gap-2.5">
        <h2 :id="`planning-day-${date}`" :class="dayNameClass">{{ dayLabel }}</h2>
        <span
          v-if="isToday"
          class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-400"
        >
          {{ t('planning.today') }}
        </span>
        <span
          v-if="!isWorkDay && offLabel"
          class="rounded-full bg-accented px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-toned"
        >
          {{ offLabel }}
        </span>
      </div>

      <!-- Middle zone: the capacity meter bar, work days only (an off day passes null). -->
      <PlanningCapacityBar v-if="capacity" :capacity="capacity" />

      <!-- Right zone: the booked/remaining reading, work days only. -->
      <PlanningCapacityReading v-if="capacity" :capacity="capacity" />
    </div>

    <!-- Task rows sit below the header on any day that holds recorded work, including an off day that
         still logged time (AC3). A no-task day keeps an empty body by design. -->
    <ul v-if="tasks.length" class="divide-y divide-default" role="list">
      <li v-for="task in tasks" :key="task.id">
        <PlanningTaskRow :is-split-continuation="continuationIds.has(task.id)" :task="task" />
      </li>
    </ul>
  </section>
</template>
