<script setup lang="ts">
import { coerceCategory, isTrackableCategory } from '#shared/categories'
import { effectiveDuration, formatCount, formatDuration, type PlanningTask } from '#shared/planning'

// The compact read-only task row (PLAN-06). One line at rest on an eight-column grid, collapsing on
// mobile to the four load-bearing columns (status dot, who, Mots, status). The column widths started
// as the mockup's and are now fixed rather than content-sized, because a per-row `auto` track made
// the columns drift from row to row inside a single card; the grid comment on the template explains
// the sizing. The grip renders as a drag affordance but does nothing this bout, and the trailing
// row-action column is reserved and empty for a later bout. Nothing here is clickable yet;
// expand-to-edit is a later bout.
const { task, isSplitContinuation = false } = defineProps<{
  task: PlanningTask
  isSplitContinuation?: boolean
}>()

const { t, locale } = useI18n()

// An unknown or stale category resolves to the non-trackable admin default before it reaches the UI,
// so the chip label and the trackable flag are always read from a valid id.
const category = computed(() => coerceCategory(task.category))
const trackable = computed(() => isTrackableCategory(task.category))
const duration = computed(() => formatDuration(effectiveDuration(task), locale.value))

// The status is not derived here. `task.statusKey` arrives already resolved from the list endpoint,
// including the `retard` pseudo-status, because deciding whether a delivery is late needs the current
// instant in the user's timezone and that is the server's call to make. The row only draws it.

// The Mots value: the words done with the French thousands space for a trackable task, an em dash for
// a non-trackable one whose time is removed from effective hours rather than producing words.
const wordsDisplay = computed(() =>
  trackable.value ? formatCount(task.wordsDone ?? 0, locale.value) : t('planning.emDash')
)

// The faint meta line under the who block. A continuation slice shows the split note with its own
// words for the day; a trackable task shows its delivery time when one is set. Otherwise there is no
// meta line.
const meta = computed(() => {
  if (isSplitContinuation)
    return t('planning.splitMeta', { count: formatCount(task.wordsDone ?? 0, locale.value) })
  if (task.deliveryTime) return t('planning.deliveryMeta', { time: task.deliveryTime })
  return ''
})

// The who block names the task. A trackable task carries its client (bold) and project (muted); a
// non-trackable task has neither per the tasks schema and instead stores its label in `instructions`
// (as the dev seed does), so the name falls back client -> project -> instructions. This matches the
// mockup, where a meeting, a break, or a terminology task shows its label in the who position.
const primaryName = computed(() => task.client ?? task.project ?? task.instructions ?? '')
const showProject = computed(() => Boolean(task.client && task.project))
</script>

<template>
  <!-- Every track except the who block is a fixed width. Each row is its own grid, so an `auto` track
       sized itself to that row's own content and the columns drifted from row to row inside one card
       (a `Réunions` chip is narrower than `Traduction`, `—` narrower than `2 800`). Fixed widths make
       the column positions identical on every row of every card, and the who block is the single
       flexible track, so all the width the other columns do not need goes to the task name rather
       than to a gutter. The widths are sized to the longest value each column can hold: `Mots` and
       `Durée` to a tabular `12 000` and `10 h 45`, the chip track to `Terminologie`, the longest
       French category label. -->
  <div
    class="grid grid-cols-[12px_minmax(0,1fr)_64px_96px] items-center gap-3 px-4 py-3.5 md:grid-cols-[20px_12px_minmax(0,1fr)_72px_72px_124px_96px_44px] md:gap-3.5 md:px-[18px]"
  >
    <!-- Drag grip: a visual affordance only in this bout; reorder and move arrive later. -->
    <span aria-hidden="true" class="hidden place-items-center text-dimmed opacity-40 md:grid">
      <UIcon class="size-4" name="i-ph-dots-six-vertical-bold" />
    </span>

    <PlanningStatusDot :status-key="task.statusKey" />

    <!-- Who block: client bold, project muted with a leading middle dot, and the split tag on a
         continuation slice, above the faint meta line. -->
    <div class="min-w-0">
      <div class="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        <span class="truncate text-[15px] font-semibold tracking-tight text-highlighted">
          {{ primaryName }}
        </span>
        <span v-if="showProject" class="text-muted">
          <span aria-hidden="true">·</span> {{ task.project }}
        </span>
        <UBadge
          v-if="isSplitContinuation"
          :aria-label="t('planning.splitTagLabel')"
          class="rounded-full"
          color="neutral"
          :label="t('planning.splitTag')"
          size="sm"
          variant="subtle"
        />
      </div>
      <p v-if="meta" class="mt-0.5 truncate text-xs text-muted">{{ meta }}</p>
    </div>

    <!-- Mots cell: uppercase faint label over the value. Both are flush right, so the tabular figures
         line up on their last digit down the card and the label sits square over them. -->
    <div class="whitespace-nowrap text-right text-sm">
      <span class="block text-[10.5px] uppercase tracking-wide text-muted">
        {{ t('planning.words') }}
      </span>
      <span class="font-semibold tabular-nums text-highlighted">{{ wordsDisplay }}</span>
    </div>

    <!-- Durée cell: effective duration, hidden on mobile, flush right for the same reason. -->
    <div class="hidden whitespace-nowrap text-right text-sm md:block">
      <span class="block text-[10.5px] uppercase tracking-wide text-muted">
        {{ t('planning.duration') }}
      </span>
      <span class="font-semibold tabular-nums text-highlighted">{{ duration }}</span>
    </div>

    <!-- The chip is start-aligned in its fixed track, so every chip's left edge lines up however
         short its label is. -->
    <PlanningCategoryChip
      :category-id="category"
      class="hidden justify-self-start md:inline-flex"
    />

    <PlanningStatusBadge :status-key="task.statusKey" />

    <!-- Reserved row-action slot, empty in this bout. It was 96px, which read as dead space at rest
         because nothing occupies it yet, so it is down to 44px: enough to hold a single hover menu
         button with no reflow, with the width it gave up going to the task name. Copy, split, and
         delete (PLAN-17, PLAN-18, PLAN-13) arrive in a later bout, and a group of three needs more
         room than this, so that bout either widens this track again or overlays the group on hover. -->
    <div aria-hidden="true" class="hidden md:block" />
  </div>
</template>
