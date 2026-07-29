<script setup lang="ts">
import type { DayCapacity, PlanningTask } from '#shared/planning'

// One day card in the week stack (PLAN-07). Every day is one section: a three-zone header band above
// a disclosure region holding the column header line and the task rows. A work day is a solid card
// with a tinted band; an off day is a quieter dashed block with no meter and no reading (the
// do-not-police rule keeps a non-work day off the capacity read), and today adds a primary ring on
// either.
//
// The card is the week's only interactive element. Every day starts collapsed except today, so the
// week reads as a short stack of headers and the user opens the day they care about. Collapsing is
// safe because the capacity meter stays in the collapsed header unchanged: a full or overbooked day
// is red before it is opened. On an off day, which carries no meter, the task count is the only
// signal that recorded weekend work is there, which is the strongest single reason the count exists.
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

// A day with no tasks grows no control. There is nothing to disclose, and a button that opens onto
// an empty body is a promise the card cannot keep. That also means the today-starts-open rule simply
// does not apply on a day today happens to be empty.
const canDisclose = computed(() => props.tasks.length > 0)

// The open state lives here and nowhere else. This is the narrow presentation exception the
// project's backend-logic rule carves out by name: whether a panel is open has no meaning off the
// screen, so it is not a setting, not persisted, not in the URL, and never sent to the server.
// Resetting on a week switch needs no code, because Week.vue keys its v-for on the day's date, so
// paging gives every card a new key, a fresh component, and the default state for free.
//
// It is tri-state rather than a plain boolean, and the null carries real weight. Paging away and
// back mounts a fresh card while the tasks fetch for the new range is still in flight, so the card
// briefly sees an empty array and a boolean initialised from it would pin today shut for the rest of
// the visit. Null means the user has not touched this card, so the default keeps applying until the
// data lands; the first toggle pins it.
const userOpen = ref<boolean | null>(null)
const open = computed(() => userOpen.value ?? (props.isToday && canDisclose.value))

function toggleOpen() {
  userOpen.value = !open.value
}

// A work day is a lifted card with a ring and a soft shadow; an off day is a quieter pale block with
// a dashed edge so it stays clearly present without competing with the work days. Today layers a
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

// The header is the three-zone grid, and both outer tracks are fixed so the meter starts at the same
// x and ends at the same x on every card in the week. The right track used to be `auto`, which sized
// itself to the reading, and the overbooked reading is longer than the comfortable one, so the
// flexible middle came out a different width card to card and the bars did not actually line up.
// Pinning it at 15rem, enough for the longest reading, repairs that. The left track is wide enough
// for the chevron, the longest day name, and either the today pill or the task count, so the count
// appearing and disappearing can never move the bar.
//
// The task row no longer draws a category edge, so the transparent 3 px left border that existed
// only to match it is gone, and the band, the column header line and the rows all start at the same
// x on `px-5` alone. The focus ring is on the band rather than on the button, because the stretched
// click target is the whole band.
// The two outer tracks are `minmax(0,…)` rather than bare lengths. At every width the card is
// actually used at they resolve to their maximum, so the bar starts and ends at the same x on every
// card exactly as fixed tracks would. Below that, a bare `20rem` would overflow the card, and the
// card clips (`overflow-hidden`), so the capacity reading would be cut off with no way to scroll to
// it. That is a WCAG 1.4.10 reflow failure. With a zero minimum every card degrades identically
// instead, and the columns still agree card to card. That fixes 200% zoom on a laptop, which is the
// realistic case. It does not fully fix 320 CSS px: the band sits outside any scroller and its grid
// items still floor at their own min-content, so the bar can be squeezed out down there. The bar is
// aria-hidden and its numbers survive as text in the reading, so nothing is lost that is only
// available visually, but this is a narrowed problem rather than a solved one. Solving it properly
// needs either a second arrangement, which AC25 forbids, or the band getting its own scroller.
const headerClass = computed(() => {
  const classes = [
    'relative grid grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,15rem)] items-center gap-x-5 px-5 py-[clamp(0.75rem,1.6vh,1rem)]',
    'has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-[-2px] has-[button:focus-visible]:outline-primary'
  ]
  if (props.isWorkDay) classes.push('bg-accented dark:bg-default')
  return classes
})

// The day name stays the same size on every day; a work day is emphatic, an off day recedes. The
// stored label is lowercase (`lundi 20 juill.`) and only its first letter is lifted, so the month
// stays lowercase, which is correct French rather than title-casing every word. The button repeats
// that rule for itself, because a button is an atomic inline box and the heading's ::first-letter
// cannot reach inside it.
const dayNameClass = computed(() =>
  props.isWorkDay
    ? 'text-[17px] font-semibold tracking-tight text-highlighted'
    : 'text-[17px] font-medium text-muted'
)
</script>

<template>
  <section :aria-labelledby="`planning-day-${date}`" :class="containerClass">
    <div :class="headerClass">
      <!-- Left zone: the disclosure control, the day name, and its tags. -->
      <div class="flex min-w-0 items-baseline gap-x-2">
        <UIcon
          v-if="canDisclose"
          aria-hidden="true"
          class="size-4 shrink-0 self-center text-muted transition-transform duration-150 motion-reduce:transition-none"
          :class="open && 'rotate-90'"
          name="i-ph-caret-right-bold"
        />

        <!-- The h2 keeps the id the section's aria-labelledby points at, so the section keeps its
             accessible name, and the button sits inside it, which is the canonical accordion shape.
             The stretched pseudo-element makes the whole band the click target without wrapping a
             heading in a button, which is not valid button content. No expand or collapse copy is
             added: aria-expanded is the correct carrier and assistive technology announces the state
             itself. A day with nothing to disclose renders no button and no chevron at all. -->
        <h2
          :id="`planning-day-${date}`"
          class="min-w-0 truncate first-letter:uppercase"
          :class="dayNameClass"
        >
          <button
            v-if="canDisclose"
            :aria-controls="`planning-day-panel-${date}`"
            :aria-describedby="open ? undefined : `planning-day-count-${date}`"
            :aria-expanded="open"
            class="scroll-mt-24 text-left first-letter:uppercase after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            type="button"
            @click="toggleOpen"
          >
            {{ dayLabel }}
          </button>
          <template v-else>{{ dayLabel }}</template>
        </h2>

        <span
          v-if="isToday"
          class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-400"
        >
          {{ t('planning.today') }}
        </span>
        <span
          v-if="!isWorkDay && offLabel"
          class="shrink-0 rounded-full bg-accented px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-toned"
        >
          {{ offLabel }}
        </span>

        <!-- The task count answers "is there work in there" without opening the card, and it goes
             away once the rows are visible and counting them again would be noise. It is the length
             of this card's own tasks array, never an endpoint field, so it can never disagree with
             the rows it labels. It lives inside the fixed left track, so appearing and disappearing
             cannot move the capacity bar.

             It is also the button's description while the day is shut, so the count is announced on
             focus and not only when reading the header line by line. A collapsed day's task count
             has to be learnable without expanding it, and `text-dimmed` on the tinted header band
             measures 1.8:1 in light, so the tone is lifted to `text-toned` (8.7:1 or better in every
             theme). -->
        <span
          v-if="canDisclose && !open"
          :id="`planning-day-count-${date}`"
          class="shrink-0 text-xs font-medium tabular-nums text-toned"
        >
          {{ t('planning.taskCount', tasks.length) }}
        </span>
      </div>

      <!-- Middle zone: the capacity meter bar, work days only (an off day passes null). -->
      <PlanningCapacityBar v-if="capacity" :capacity="capacity" />

      <!-- Right zone: the booked/remaining reading, work days only. The track is fixed, and the
           reading is shorter on a comfortable day than on an overbooked one, so it is aligned to the
           track's right edge. Left-aligned it would start at the same x but end ragged, which reads
           as a misaligned column rather than as a deliberate gutter. The alignment is the header's
           call rather than the reading's, so the component stays untouched. -->
      <PlanningCapacityReading v-if="capacity" :capacity="capacity" class="text-right" />
    </div>

    <!-- The disclosure region. Height only, 150 ms, no slide, no fade, no per-row stagger, animated
         through grid-template-rows so nothing has to be measured. The chevron rotates on the same
         duration so the two read as one gesture, and both are suppressed under prefers-reduced-motion
         so the region snaps. -->
    <div
      v-if="canDisclose"
      class="grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none"
      :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    >
      <!-- A collapsed region is clipped to zero height, which hides it from the eye and from nothing
           else: without `inert` it stays in the accessibility tree and in the tab order, so a screen
           reader would read every row of a day the button has just announced as collapsed, and the
           scroller below would be a tab stop into invisible content. `aria-hidden` is the fallback
           for a browser that does not support `inert` yet. -->
      <div
        :id="`planning-day-panel-${date}`"
        :aria-hidden="!open"
        class="overflow-hidden"
        :inert="!open"
      >
        <!-- Below the row's minimum width the card scrolls inside its own container and the page body
             never scrolls sideways. There is no second arrangement: the app has no mobile version.
             A scrollable container has to be reachable by keyboard, so it takes a tab stop and is
             named by the day heading it belongs to rather than announcing as an unlabelled group. -->
        <div
          :aria-labelledby="`planning-day-${date}`"
          class="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          role="group"
          tabindex="0"
        >
          <div class="min-w-[62rem]" role="table">
            <!-- One column header line per open card, instead of a label above every value on every
                 row. A five-row card printed ten tiny labels before and would have printed thirty
                 with the fields this feature adds; this prints six, once, and none at all while the
                 card is closed. Giving the region real table semantics makes the visible header the
                 accessible header too, so there is no second copy of the labels to drift out of
                 step. All six headers print, the category included: the coloured edge became a
                 printed word, so the colour is redundant reinforcement on a name the row states
                 outright rather than the carrier of anything, and the cell below needs no accessible
                 name of its own.

                 The leading grid item is an in-flow placeholder for the grip track. Grid
                 auto-placement fills from track 1, so a headerless leading track slides every
                 visible label one column left of the values it labels, and `sr-only` is
                 `position: absolute`, so an sr-only grid item is out of flow and takes no track
                 either. It carries `role="presentation"`, which keeps it in flow for the grid and
                 out of the accessibility tree, matching the row's own decorative grip and reserved
                 action cells, so six headers sit above six cells. The tone is `text-toned` rather
                 than the `text-dimmed` the blueprint asks for, because dimmed measures 2.0:1 to
                 2.6:1 against the card surface and these six words are the only field labels the
                 feature has left. -->
            <div
              class="grid grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem] gap-x-4 border-b border-default px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-toned"
              role="row"
            >
              <span role="presentation" />
              <span role="columnheader">{{ t('planning.columns.category') }}</span>
              <span role="columnheader">{{ t('planning.columns.task') }}</span>
              <span role="columnheader">{{ t('planning.columns.delivery') }}</span>
              <span class="text-right" role="columnheader">{{ t('planning.columns.words') }}</span>
              <span class="text-right" role="columnheader">
                {{ t('planning.columns.duration') }}
              </span>
              <span role="columnheader">{{ t('planning.columns.status') }}</span>
            </div>

            <div class="divide-y divide-default" role="rowgroup">
              <PlanningTaskRow
                v-for="task in tasks"
                :key="task.id"
                :is-split-continuation="continuationIds.has(task.id)"
                :task="task"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
