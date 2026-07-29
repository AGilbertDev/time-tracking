<script setup lang="ts">
import { categoryEdgeHue, coerceCategory } from '#shared/categories'
import {
  effectiveDuration,
  formatCount,
  formatDeliveryDate,
  formatDuration,
  type PlanningTask
} from '#shared/planning'

// The at-rest task row (PLAN-06), rebuilt for progressive disclosure. One line, six labelled cells
// on a seven-track grid, and the category carried by the row's own left border. It is seen only
// inside a day the user deliberately opened, and it stays strictly read-only: nothing in it is
// clickable, and the only interactive element the week adds is the day-header disclosure button.
//
// Every track except the task name is a fixed width. Each row is its own grid, so an `auto` track
// sizes itself to that row's own content and the columns drift from row to row inside one card,
// which is the lesson the shipped row already recorded. The name is the single `1fr`, so all the
// slack lands on the field that identifies the row. The seventh track is reserved and deliberately
// has no child: the copy and delete buttons (PLAN-17, PLAN-13) land as a hover overlay positioned
// against `group/row`, so the grid is never re-cut when they arrive.
//
// The row holds no derived business value. `statusKey` and `trackable` both arrive resolved from
// the list endpoint, because deciding whether a delivery is late needs the current instant in the
// user's timezone and deciding whether a category produces words is the quota contract's call. The
// row draws what it is handed.
const { task, isSplitContinuation = false } = defineProps<{
  task: PlanningTask
  isSplitContinuation?: boolean
}>()

const { t, locale, tm, rt } = useI18n()

// The abbreviated month names are locale data held in the i18n `planning` namespace, so
// formatDeliveryDate stays pure and the month copy lives in one place, exactly as the full month
// names already work for the week and day labels.
const monthsShort = computed<string[]>(() =>
  (tm('planning.monthsShort') as string[]).map((m) => rt(m))
)

// An unknown or stale stored category resolves to the non-trackable admin default before it reaches
// the UI, so the accessible category name and the edge hue are always read from a valid id. The raw
// value stays on the contract uncoerced for PLAN-11 to round-trip on save.
const category = computed(() => coerceCategory(task.category))
const categoryLabel = computed(() => t(`categories.${category.value}`))

// The category is the one field carried by colour rather than by a word, so the row also carries
// the localized category name for a screen reader (WCAG 1.4.1). It sits in the first cell, under
// the `Catégorie` column header, so the colour and its accessible name are the same column.
//
// The hue is the only thing the component knows about the colour: lightness, chroma, and the dark
// override are fixed in main.css, and which category is which hue lives once in the shared category
// contract. A null hue means neutral, and with an edge treatment neutral is drawing nothing, which
// leaves trackable work visually distinct from breaks and meetings for free.
const edgeHue = computed(() => categoryEdgeHue(category.value))

// The delivery deadline reads as one fact: the date, then a plain space, then the stored time. No
// separator glyph, because a separator would split what the eye should read as a single deadline;
// the tone contrast between the date and the time joins them instead. A delivery with no time shows
// the date alone, and no delivery date shows the em dash whatever the time holds. The deadline
// takes no colour when the task is late, because the status column already reads `En retard`.
const deliveryDate = computed(() =>
  task.deliveryDate ? formatDeliveryDate(task.deliveryDate, task.date, monthsShort.value) : null
)

// The words pair, done over the project total. A non-trackable task produces no words at all, so
// its cell is the em dash. A null `wordsDone` is also the em dash rather than `0`, so a planned task
// is never misread as a recorded zero, and a missing project total drops the slash and the second
// figure rather than printing an em dash after the slash. An excluded task shows its real figures in
// full, because the app records reality and the `hors stats` marker is what says they do not count.
const wordsDone = computed(() =>
  typeof task.wordsDone === 'number' ? formatCount(task.wordsDone, locale.value) : null
)
const projectWords = computed(() =>
  typeof task.projectWordCount === 'number'
    ? formatCount(task.projectWordCount, locale.value)
    : null
)

// The at-rest duration is the effective duration and nothing else, so the durations in an open card
// sum to the booked figure its capacity meter prints above them. The estimated and actual breakdown
// is an editing question and belongs to PLAN-11.
const duration = computed(() => formatDuration(effectiveDuration(task), locale.value))

// The exclusion marker only makes sense on a trackable task. On a break or a meeting the flag
// changes nothing about the quota that the category has not already decided, so the marker would be
// noise on the one row that least needs it.
const showExcluded = computed(() => task.trackable && task.excludeFromStats)
const showProject = computed(() => Boolean(task.client && task.project))

// Every task has a name. The client identifies the work when it is set, the project when it is not,
// and otherwise the localized category name, so a meeting reads `Réunions`. Two meetings on one day
// look identical, which the owner has accepted; no task can render nameless.
const primaryName = computed(() => task.client || task.project || categoryLabel.value)
</script>

<template>
  <!-- The category edge is the row's own left border, so it costs no track and no node. Every row
       carries the 3 px border whether or not a hue is drawn, so a non-trackable row sits at exactly
       the same x as its neighbours. Flush with the card's inner edge and drawn at full row height,
       consecutive rows of the same category merge into one unbroken band, which is the at-a-glance
       scan the edge exists for. -->
  <div
    class="group/row grid grid-cols-[1rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem] items-center gap-x-4 border-l-[3px] px-5 py-[clamp(0.5rem,1.1vh,0.75rem)]"
    :class="edgeHue === null ? 'border-l-transparent' : 'planning-cat-edge'"
    role="row"
    :style="edgeHue === null ? undefined : { '--planning-cat-hue': edgeHue }"
  >
    <!-- The category cell. The edge sits at this column, so this is where its accessible name
         belongs. The grip is the drag affordance for PLAN-15 and is decorative until then. -->
    <span class="grid place-items-center text-dimmed opacity-40" role="cell">
      <span class="sr-only">{{ categoryLabel }}</span>
      <UIcon aria-hidden="true" class="size-4" name="i-ph-dots-six-vertical-bold" />
    </span>

    <!-- Identity: the client, the project number, and both conditional markers on one baseline line
         joined by middle dots, so the whole line reads as one sequence rather than as a name with
         things stuck to it. Only the primary name truncates; the markers are shrink-0 so a rare
         marker is never the thing that gets cut. Neither marker is a badge, so a row that carries
         none draws nothing and loses no width. -->
    <div class="flex min-w-0 items-baseline gap-x-1.5" role="cell">
      <span class="truncate text-[15px] font-semibold tracking-tight text-highlighted">
        {{ primaryName }}
      </span>
      <span v-if="showProject" class="shrink-0 text-sm text-muted">
        <span aria-hidden="true">·</span> {{ task.project }}
      </span>
      <span v-if="isSplitContinuation" class="shrink-0 text-xs text-muted">
        <span aria-hidden="true">· {{ t('planning.splitTag') }}</span>
        <span class="sr-only">{{ t('planning.splitTagLabel') }}</span>
      </span>
      <span v-if="showExcluded" class="shrink-0 text-xs text-muted">
        <span aria-hidden="true">· {{ t('planning.excluded') }}</span>
        <span class="sr-only">{{ t('planning.excludedLabel') }}</span>
      </span>
    </div>

    <!-- Livraison. Left-aligned, because it is the one compound field of varying length and
         right-aligning it would put the month where the clock time sits on the row above.

         Every em dash on the row is a glyph for the eye and a word for a screen reader. Read out
         raw, an em dash is either silence or the word "dash" in a column whose header says
         `Livraison`, which says nothing at all, and the two reasons a value is missing have to stay
         apart: a deadline nobody entered is not the same fact as a word count that cannot exist. -->
    <div class="whitespace-nowrap text-sm" role="cell">
      <template v-if="deliveryDate">
        <span class="text-highlighted">{{ deliveryDate }}</span>
        <span v-if="task.deliveryTime" class="text-muted"> {{ task.deliveryTime }}</span>
      </template>
      <span v-else class="text-muted">
        <span aria-hidden="true">{{ t('planning.emDash') }}</span>
        <span class="sr-only">{{ t('planning.notSet') }}</span>
      </span>
    </div>

    <!-- Mots. Right-aligned tabular figures line up on their last digit down the column, so the eye
         reads magnitude without reading the numbers. The slash and the weight contrast make the pair
         read as one ratio with a numerator and a denominator. The slash is the only thing that says
         the two figures are one ratio, so it is read out rather than hidden: hidden, the cell
         announces as two unrelated numbers under a header that says `Mots`. -->
    <div class="whitespace-nowrap text-right text-sm tabular-nums" role="cell">
      <span v-if="!task.trackable" class="text-muted">
        <span aria-hidden="true">{{ t('planning.emDash') }}</span>
        <span class="sr-only">{{ t('planning.notApplicable') }}</span>
      </span>
      <template v-else>
        <span v-if="wordsDone" class="font-semibold text-highlighted">{{ wordsDone }}</span>
        <span v-else class="text-muted">
          <span aria-hidden="true">{{ t('planning.emDash') }}</span>
          <span class="sr-only">{{ t('planning.notSet') }}</span>
        </span>
        <template v-if="projectWords">
          <span class="text-muted"> / </span>
          <span class="text-muted">{{ projectWords }}</span>
        </template>
      </template>
    </div>

    <div
      class="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-highlighted"
      role="cell"
    >
      {{ duration }}
    </div>

    <PlanningStatusBadge role="cell" :status-key="task.statusKey" />
  </div>
</template>
