<script setup lang="ts">
import { coerceCategory, isTrackableCategory } from '#shared/categories'
import {
  effectiveDuration,
  formatCount,
  formatDuration,
  type PlanningTask,
  statusKey
} from '#shared/planning'

// The compact read-only task row (PLAN-06). One line at rest on the eight-column grid taken verbatim
// from the mockup, collapsing on mobile to the four load-bearing columns (status dot, who, Mots,
// status). The grip renders as a drag affordance but does nothing this bout, and the trailing
// row-action column is reserved and empty so a later bout drops the copy/split/delete buttons into it
// without any reflow. Nothing here is clickable yet; expand-to-edit is a later bout.
const { task, isSplitContinuation = false } = defineProps<{
  task: PlanningTask
  isSplitContinuation?: boolean
}>()

const { t, locale } = useI18n()

// An unknown or stale category resolves to the non-trackable admin default before it reaches the UI,
// so the chip label and the trackable flag are always read from a valid id.
const category = computed(() => coerceCategory(task.category))
const trackable = computed(() => isTrackableCategory(task.category))
const sKey = computed(() => statusKey(task.status, trackable.value))
const duration = computed(() => formatDuration(effectiveDuration(task), locale.value))

// The Mots value: the words done with the French thousands space for a trackable task, an em dash for
// a non-trackable one whose time is removed from effective hours rather than producing words.
const wordsDisplay = computed(() =>
  trackable.value ? formatCount(task.wordsDone ?? 0, locale.value) : t('planning.emDash')
)

// The faint meta line under the who block. A continuation slice shows the split note with its own
// words for the day; a non-trackable task states its time is removed from effective hours; a
// trackable task shows its delivery time when one is set. Otherwise there is no meta line.
const meta = computed(() => {
  if (isSplitContinuation)
    return t('planning.splitMeta', { count: formatCount(task.wordsDone ?? 0, locale.value) })
  if (!trackable.value) return t('planning.nonTrackableMeta')
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
  <div
    class="grid grid-cols-[12px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 md:grid-cols-[20px_12px_minmax(0,1.5fr)_auto_auto_auto_104px_96px] md:gap-3.5 md:px-[18px]"
  >
    <!-- Drag grip: a visual affordance only in this bout; reorder and move arrive later. -->
    <span aria-hidden="true" class="hidden place-items-center text-dimmed opacity-40 md:grid">
      <UIcon class="size-4" name="i-ph-dots-six-vertical-bold" />
    </span>

    <PlanningStatusDot :status-key="sKey" />

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
          class="rounded-full text-secondary-700 dark:text-secondary-300"
          color="secondary"
          :label="t('planning.splitTag')"
          size="sm"
          variant="subtle"
        />
      </div>
      <p v-if="meta" class="mt-0.5 truncate text-xs text-muted">{{ meta }}</p>
    </div>

    <!-- Mots cell: uppercase faint label over the value. -->
    <div class="whitespace-nowrap text-sm">
      <span class="block text-[10.5px] uppercase tracking-wide text-muted">
        {{ t('planning.words') }}
      </span>
      <span class="font-semibold tabular-nums text-highlighted">{{ wordsDisplay }}</span>
    </div>

    <!-- Durée cell: effective duration, hidden on mobile. -->
    <div class="hidden whitespace-nowrap text-sm md:block">
      <span class="block text-[10.5px] uppercase tracking-wide text-muted">
        {{ t('planning.duration') }}
      </span>
      <span class="font-semibold tabular-nums text-highlighted">{{ duration }}</span>
    </div>

    <PlanningCategoryChip
      :category-id="category"
      class="hidden justify-self-start md:inline-flex"
    />

    <PlanningStatusBadge class="justify-self-end" :status-key="sKey" />

    <!-- Reserved row-action slot (96px): empty in this bout. Copy, split, and delete (PLAN-17,
         PLAN-18, PLAN-13) drop in here on hover in a later bout, so keeping the column reserved
         matches the at-rest appearance and leaves the hook in place. -->
    <div aria-hidden="true" class="hidden md:block" />
  </div>
</template>
