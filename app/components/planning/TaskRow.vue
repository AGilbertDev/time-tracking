<script setup lang="ts">
import { categoryHue, coerceCategory } from '#shared/categories'
import {
  effectiveDuration,
  formatCount,
  formatDeadline,
  formatDuration,
  type PlanningTask
} from '#shared/planning'

// The at-rest task row (PLAN-06), now the collapsed half of a disclosure (PLAN-11). One line, six
// labelled cells on an eight-track grid, with the category printed as a coloured word in the first of
// them. It is seen only inside a day the user deliberately opened, and it stays minimal on purpose:
// the whole line is now a click target that opens the editor beneath it, and the only thing this
// feature adds to the line itself is one glyph.
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
// Forward note for PLAN-13 and PLAN-17. The stretched pseudo-element on the expand button covers the
// whole row, the reserved eighth track included, so the row-action buttons those features put there
// will be swallowed by it unless they are given a higher stacking context of their own. They land as
// the hover overlay extend-tasks-design.md already documents, positioned against `group/row`, so the
// fix is a z-index on the overlay rather than any change to the grid.
//
// The row holds no derived business value. `statusKey`, `trackable` and `deliverable` all arrive
// resolved from the list endpoint, because deciding whether a delivery is late needs the current
// instant in the user's timezone and deciding whether a category produces words or carries a status is
// the contract's call. The row draws what it is handed.
const {
  expanded = false,
  isSplitContinuation = false,
  panelId,
  task
} = defineProps<{
  // Whether this row's editor is open. Exclusivity is decided a long way up, on the page, because a
  // per-row flag cannot express "one open editor across the whole week".
  expanded?: boolean
  isSplitContinuation?: boolean
  // The id of the panel the expand button controls.
  panelId: string
  task: PlanningTask
}>()

const emit = defineEmits<{ toggle: [] }>()

const { t, locale, tm, rt } = useI18n()

// The abbreviated month names are locale data held in the i18n `planning` namespace, so
// formatDeadline stays pure and the month copy lives in one place, exactly as the full month names
// already work for the week and day labels.
const monthsShort = computed<string[]>(() =>
  (tm('planning.monthsShort') as string[]).map((m) => rt(m))
)

// An unknown or stale stored category resolves to the shared default before it reaches the UI, so the
// printed category name and its hue are always read from a valid id. That default is `other`, named
// `Autre`, so a row holding a retired id reads as other work, which is true, rather than as
// Administration, which it never was. The raw value stays on the contract uncoerced so the editor can
// leave a stale id alone unless the user picks a category.
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

// Mots is one figure, this row's own word total. The done-over-total pair it used to print lost its
// numerator when migration 0008 dropped words_done, and the owner's reason for dropping it was
// reliability rather than tidiness: a figure nobody will enter every time makes worse statistics than
// no figure. A task whose category carries no deliverable has no word count that means anything, so
// its cell is the em dash under `notApplicable`. A null total is the em dash too, under `notSet`,
// because it is a figure nobody entered, and a stored zero prints `0`, because zero is a figure
// somebody did enter. An excluded task shows its real figure in full, since the app records reality
// and the `hors stats` marker is what says it does not count.
//
// The not-applicable case reads `deliverable` and not `trackable`, and the distinction is the whole
// point of the two flags. `other` is not trackable, so its words reach no quota, and it is a
// deliverable, so a word count on it is a real figure the user typed and the cell prints it. Keying
// this on trackability would refuse to print a number the user entered on what will be the most
// common non-trackable row in the app.
const projectWords = computed(() =>
  typeof task.projectWordCount === 'number'
    ? formatCount(task.projectWordCount, locale.value)
    : null
)

// The at-rest duration is the effective duration and nothing else, so the durations in an open card
// sum to the booked figure its capacity meter prints above them. The estimated and actual breakdown
// is an editing question and lives in the panel.
const duration = computed(() => formatDuration(effectiveDuration(task), locale.value))

// The exclusion marker only makes sense on a trackable task. On a break or a meeting the flag
// changes nothing about the quota that the category has not already decided, so the marker would be
// noise on the one row that least needs it.
//
// This one reads `trackable` and it is deliberately the odd one out beside the words cell above, which
// reads `deliverable`. Exclusion is a quota question and nothing else, so `trackable` is the flag that
// answers it. A sweep that changed this for consistency would print `hors stats` on an `Autre` row,
// where the flag is already inert because the category moves no quota figure, and no test would catch
// it.
const showExcluded = computed(() => task.trackable && task.excludeFromStats)
const showProject = computed(() => Boolean(task.client && task.project))

// The note marker is one bit and never the text. The text cannot fit, and it must not go in a title
// attribute either, since that is unreachable by keyboard and would be a second copy of the field.
// But a note nobody can see is a note nobody remembers, and with no marker the only way to find which
// rows carry one is to open every row, which is more clutter across a week rather than less. So the
// row says whether opening it will tell you something it cannot show, which is what "minimal relevant
// info at a glance" means. It shows on any task with a note, trackable or not, because a note on a
// meeting is one of the cases it exists for.
//
// The visible form is a glyph rather than a dimmed word, which departs from `hors stats` and `suite`
// on purpose: those are facts about the task's meaning and belong in words, while this is a pointer at
// the row's own disclosure, and a glyph is the honest form for a pointer. It is one decision in one
// place, so switching back to a word is an edit to this block and one copy key.
const showNote = computed(() => Boolean(task.notes))

// The name answers which piece of work a row is: the client when it is set, the project when it is
// not. It no longer falls back to the localized category name. A break is not a piece of work, so
// the column has no answer, and printing the classification in the row's widest and heaviest cell
// said the same word twice, once in bold under `Tâche` and once in colour one track to its left.
// Two meetings on one day still look identical, which the owner has accepted, and those rows now
// carry their category as a printed word rather than as a 3 px edge, so they gain a carrier rather
// than lose one. A trackable task with neither a client nor a project takes the same branch, which
// is correct and which the category fallback used to mask.
const primaryName = computed(() => task.client || task.project || null)

// The row is the click target, so the hover tint, the open tint and the focus ring are all drawn on
// the row and keyed off the button inside it. A low-opacity primary tint rather than a surface token,
// because no semantic surface reads on all four combinations of day type and colour mode: a day card
// is bg-default in light and bg-elevated in dark on a work day and the reverse on an off day. The
// open state is the same tint made permanent, so the row that owns the open panel is visibly the one
// being edited with no second mechanism.
const rowClass = computed(() => [
  'group/row relative grid grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_5rem_4.5rem_6rem_3rem] items-center gap-x-4 px-5 py-[clamp(0.5rem,1.1vh,0.75rem)]',
  'transition-colors duration-150 motion-reduce:transition-none',
  'has-[button:hover]:bg-primary/[0.06] dark:has-[button:hover]:bg-primary/10',
  'has-[button:focus-visible]:outline-2 has-[button:focus-visible]:-outline-offset-2 has-[button:focus-visible]:outline-primary',
  expanded && 'bg-primary/[0.06] dark:bg-primary/10'
])
</script>

<template>
  <div :class="rowClass" role="row">
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
         which is a reserved role rather than one of the user's colours, so those hues still ship
         verbatim. All three defences are kept because they fail differently: position survives a
         palette change, hue survives a layout change. -->
    <span
      class="planning-cat-name whitespace-nowrap text-sm font-normal"
      role="cell"
      :style="{ '--planning-cat-hue': catHue }"
    >
      {{ categoryLabel }}
    </span>

    <!-- Identity: the client, the project number, and the conditional markers on one baseline line
         joined by middle dots, so the whole line reads as one sequence rather than as a name with
         things stuck to it. Only the primary name truncates; the markers are shrink-0 so a rare
         marker is never the thing that gets cut. No marker is a badge, so a row that carries
         none draws nothing and loses no width.

         A row with neither a client nor a project prints the em dash instead, not semibold and not
         highlighted, because it is an absence rather than a name. It reads `notSet` rather than
         `notApplicable`: a name is a fact nobody entered rather than one that cannot exist, and a
         user may well give a meeting a project name and it will print.

         The expand control is a real button inside this cell with a stretched pseudo-element making
         the whole row clickable, which is exactly what the day header's disclosure button already
         does. Its accessible name is a screen-reader-only `Modifier` followed by the row's own name,
         so a row with neither a client nor a project still has a usable one. The focus ring is drawn
         on the row rather than on the button, because the row is the target. -->
    <div class="flex min-w-0 items-baseline gap-x-1.5" role="cell">
      <!-- `aria-controls` is emitted only while the panel is open, because the panel is created and
           destroyed rather than hidden (AC30) and an IDREF that resolves to nothing declares a
           relationship that is not there. `aria-expanded` carries the state either way, and the panel
           itself is the form element, whose id is this `panelId`. -->
      <button
        :id="`planning-task-toggle-${task.id}`"
        :aria-controls="expanded ? panelId : undefined"
        :aria-expanded="expanded"
        class="block min-w-0 truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        data-editor-gate
        type="button"
        @click="emit('toggle')"
      >
        <span class="sr-only">{{ t('planning.editor.editRowLabel') }}</span>
        <span v-if="primaryName" class="text-[15px] font-semibold tracking-tight text-highlighted">
          {{ primaryName }}
        </span>
        <span v-else class="text-[15px] text-muted">
          <span aria-hidden="true">{{ t('planning.emDash') }}</span>
          <span class="sr-only">{{ t('planning.notSet') }}</span>
        </span>
      </button>
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
      <!-- No middle dot before the glyph. A dot joins two readable strings in a sequence and a glyph
           is not a member of that sequence, so it takes ml-1 and saves the separator's ink as well.
           `self-center` because the line is items-baseline and a glyph has no baseline worth aligning
           to. The accessible name is carried the way every other one on this row is, an aria-hidden
           glyph beside an sr-only span, which avoids aria-label on a non-interactive element. -->
      <!-- `text-muted`, not the `text-dimmed` the blueprint asked for. The glyph is the only visual
           carrier of the fact that a row holds a note, so 1.4.11 binds it at 3:1 and dimmed resolves
           to neutral-400 in light, which measures 2.01:1 on a pastel or foret off-day card and no
           better than 2.94:1 on any of the four card surfaces in either mode. Muted clears 4.02:1 at
           its worst, it is the tone the other two row markers already use, and it stays quieter than
           the name beside it. -->
      <span v-if="showNote" class="ml-1 shrink-0 self-center text-muted">
        <UIcon aria-hidden="true" class="size-3.5" name="i-ph-note" />
        <span class="sr-only">{{ t('planning.noteLabel') }}</span>
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
         reads magnitude without reading the numbers. One figure at normal weight rather than
         semibold: weight marks the number the row is scanned by, and that is Durée, whose figures sum
         to the booked total the capacity meter prints above them. Two adjacent right-aligned tabular
         columns are also easier to tell apart when they differ in weight than when they are
         identical. -->
    <div class="whitespace-nowrap text-right text-sm tabular-nums" role="cell">
      <span v-if="!task.deliverable" class="text-muted">
        <span aria-hidden="true">{{ t('planning.emDash') }}</span>
        <span class="sr-only">{{ t('planning.notApplicable') }}</span>
      </span>
      <span v-else-if="projectWords" class="text-highlighted">{{ projectWords }}</span>
      <span v-else class="text-muted">
        <span aria-hidden="true">{{ t('planning.emDash') }}</span>
        <span class="sr-only">{{ t('planning.notSet') }}</span>
      </span>
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
