<script setup lang="ts">
import { categoryHue, coerceCategory } from '#shared/categories'
import {
  effectiveDuration,
  formatCount,
  formatDeadline,
  formatDuration,
  type PlanningTask
} from '#shared/planning'

// The at-rest task row (PLAN-06), rebuilt for progressive disclosure. One line, six labelled cells
// on an eight-track grid, with the category printed as a coloured word in the first of them. It is
// seen only inside a day the user deliberately opened, and it stays strictly read-only: nothing in
// it is clickable, and the only interactive element the week adds is the day-header disclosure
// button.
//
// Every track except the task name is a fixed width. Each row is its own grid, so an `auto` track
// sizes itself to that row's own content and the columns drift from row to row inside one card,
// which is the lesson the shipped row already recorded. The name is the single `1fr`, so all the
// slack lands on the field that identifies the row. The first track is the grip and the eighth is
// reserved and deliberately has no child: the copy and delete buttons (PLAN-17, PLAN-13) land as a
// hover overlay positioned against `group/row`, so the grid is never re-cut when they arrive. Both
// of those tracks are decorative, so both take `role="presentation"`, which leaves them in flow for
// the grid and out of the accessibility tree, and every row then owns exactly six cells under
// exactly six column headers.
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
// formatDeadline stays pure and the month copy lives in one place, exactly as the full month names
// already work for the week and day labels.
const monthsShort = computed<string[]>(() =>
  (tm('planning.monthsShort') as string[]).map((m) => rt(m))
)

// An unknown or stale stored category resolves to the non-trackable admin default before it reaches
// the UI, so the printed category name and its hue are always read from a valid id. The raw value
// stays on the contract uncoerced for PLAN-11 to round-trip on save.
const category = computed(() => coerceCategory(task.category))
const categoryLabel = computed(() => t(`categories.${category.value}`))

// The category is printed as a word, so the colour is redundant reinforcement rather than the
// carrier. That is what satisfies WCAG 1.4.1 by construction: a user who perceives no colour at all
// reads `Révision interne` and loses nothing. It is also what retired the `sr-only` category name
// the 3 px edge needed, since a printed word and an accessible name in the same cell would make the
// row announce its category twice.
const catHue = computed(() => categoryHue(category.value))

// The delivery deadline reads as one fact: the date, then a plain space, then the stored time. No
// separator glyph, because a separator would split what the eye should read as a single deadline;
// the tone contrast between the date and the time joins them instead. A delivery with no time shows
// the date alone, and no delivery date shows the em dash whatever the time holds. The deadline
// takes no colour when the task is late, because the status column already reads `En retard`.
//
// The space lives inside `timeSuffix` rather than in the template. Vue's `condenseWhitespace` drops
// a whitespace-only text node that has no previous sibling, so a leading space in the time span
// never reached the DOM and the year ran into the hour. An interpolated value is not a text node
// and cannot be condensed, which is why the join is the shared function's and not this template's.
const deadline = computed(() =>
  formatDeadline(task.deliveryDate, task.date, monthsShort.value, task.deliveryTime)
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

// The name answers which piece of work a row is: the client when it is set, the project when it is
// not. It no longer falls back to the localized category name. A break is not a piece of work, so
// the column has no answer, and printing the classification in the row's widest and heaviest cell
// said the same word twice, once in bold under `Tâche` and once in colour one track to its left.
// Two meetings on one day still look identical, which the owner has accepted, and those rows now
// carry their category as a printed word rather than as a 3 px edge, so they gain a carrier rather
// than lose one. A trackable task with neither a client nor a project takes the same branch, which
// is correct and which the category fallback used to mask.
const primaryName = computed(() => task.client || task.project || null)
</script>

<template>
  <div
    class="group/row grid grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem] items-center gap-x-4 px-5 py-[clamp(0.5rem,1.1vh,0.75rem)]"
    role="row"
  >
    <!-- The grip is the drag affordance for PLAN-15 and is decorative until then, so the cell is
         presentational and carries no accessible name of its own. -->
    <span class="grid place-items-center text-dimmed opacity-40" role="presentation">
      <UIcon aria-hidden="true" class="size-4" name="i-ph-dots-six-vertical-bold" />
    </span>

    <!-- The category, printed in its own colour. The hue is the only thing this component knows about
         the colour: lightness, chroma and the dark override are fixed in main.css and which category is
         which hue lives once in the shared contract. Regular weight rather than semibold, so the two
         coloured words on the row differ in weight before they differ in hue. The status is semibold at
         the row's other end, so position and weight are the first two things telling a category from a
         status. No truncate: the two revision members differ only in their last word.

         Hue is the third defence rather than no defence, which is a correction to the blueprint. Only
         the four trackable categories can ever show a coloured status, so `revision_internal` beside a
         green `Terminé` was the one pair that landed in the same row at nearly the same colour. The
         accessibility stage measured it and moved `success` from green to emerald in app.config.ts,
         which is a reserved role rather than one of the primary user's colours, so her hues still ship
         verbatim. All three defences are kept because they fail differently: position survives a
         palette change, hue survives a layout change. -->
    <span
      class="planning-cat-name whitespace-nowrap text-sm font-normal"
      role="cell"
      :style="{ '--planning-cat-hue': catHue }"
    >
      {{ categoryLabel }}
    </span>

    <!-- Identity: the client, the project number, and both conditional markers on one baseline line
         joined by middle dots, so the whole line reads as one sequence rather than as a name with
         things stuck to it. Only the primary name truncates; the markers are shrink-0 so a rare
         marker is never the thing that gets cut. Neither marker is a badge, so a row that carries
         none draws nothing and loses no width.

         A row with neither a client nor a project prints the em dash instead, not semibold and not
         highlighted, because it is an absence rather than a name. It reads `notSet` rather than
         `notApplicable`: a name is a fact nobody entered rather than one that cannot exist, and once
         PLAN-09 ships a user may well give a meeting a project name and it will print. -->
    <div class="flex min-w-0 items-baseline gap-x-1.5" role="cell">
      <span
        v-if="primaryName"
        class="truncate text-[15px] font-semibold tracking-tight text-highlighted"
      >
        {{ primaryName }}
      </span>
      <span v-else class="text-[15px] text-muted">
        <span aria-hidden="true">{{ t('planning.emDash') }}</span>
        <span class="sr-only">{{ t('planning.notSet') }}</span>
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
      <template v-if="deadline">
        <span class="text-highlighted">{{ deadline.date }}</span>
        <span v-if="deadline.timeSuffix" class="text-muted">{{ deadline.timeSuffix }}</span>
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
