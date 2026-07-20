<script setup lang="ts">
import type { PlanningDayView } from '~/components/planning/Week.vue'

import {
  formatDayLabel,
  formatWeekLabel,
  getWeekDays,
  getWeekRange,
  isWorkDay,
  type PlanningTask,
  todayInZone
} from '#shared/planning'

// The signed-in owner's dashboard: the current Sunday-to-Saturday week with its read-only task rows
// (Bout 1 of the planning week). This page is the data owner. It reads the work settings and the
// week's tasks, derives the week from the pure helpers, and renders the stack. It writes nothing.
// The global auth middleware guarantees a session before this runs, so an unauthenticated visitor is
// already routed to sign-in rather than reaching a broken week.
const { t, locale, tm, rt } = useI18n()

// Authenticated dashboard, kept out of the index. The whole app is auth-gated; the intent is stated
// for the SEO stage even though there is nothing to optimize for search here.
useSeoMeta({
  title: () => t('planning.title'),
  robots: 'noindex, nofollow'
})

// The full and abbreviated month names are locale data held in the i18n `planning` namespace, so the
// formatters stay pure and the month copy lives in one place. tm returns the raw array and rt
// resolves each entry for the active locale.
const monthsLong = computed<string[]>(() =>
  (tm('planning.monthsLong') as string[]).map((m) => rt(m))
)
const monthsShort = computed<string[]>(() =>
  (tm('planning.monthsShort') as string[]).map((m) => rt(m))
)

// Forward the session cookie on SSR. A browser request attaches it automatically, but Nuxt's
// server-side $fetch to an internal route does not, so on a hard reload the APIs would see no session
// and the week would render empty until a client navigation.
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

// A single instant captured on the server and carried to the client through the payload, so today and
// the current week do not shift between the server render and hydration for a request near midnight.
const nowIso = useState('planning-now', () => new Date().toISOString())

// Work days and timezone come from the existing work-settings endpoint; today is computed in the
// user's own zone. The coded fallbacks match the server defaults so the shape is valid before the
// load resolves, but they are never used to override a real value.
const { data: settings } = await useAsyncData('planning-work-settings', () =>
  $fetch('/api/me/work-settings', { headers: requestHeaders })
)

const timezone = computed(() => settings.value?.timezone ?? 'America/Toronto')
const workDays = computed(() => settings.value?.workDays ?? [1, 2, 3, 4, 5])
const today = computed(() => todayInZone(new Date(nowIso.value), timezone.value))
const weekRange = computed(() => getWeekRange(today.value))

// The range sent to GET /api/tasks is derived only from the pure week helpers, so the client never
// sends an invalid range. Bout 1 renders the current week only; the switcher is a later bout.
const {
  data: tasks,
  status: tasksStatus,
  refresh: refreshTasks
} = await useAsyncData(
  () => `planning-tasks-${weekRange.value.from}-${weekRange.value.to}`,
  () =>
    $fetch<PlanningTask[]>('/api/tasks', {
      query: { from: weekRange.value.from, to: weekRange.value.to },
      headers: requestHeaders
    })
)

const weekLabel = computed(() =>
  formatWeekLabel(weekRange.value.from, weekRange.value.to, {
    locale: locale.value,
    prefix: t('planning.weekPrefix'),
    separator: t('planning.weekSeparator'),
    months: monthsLong.value
  })
)

// A task is a continuation slice when another task in the same split group falls on an earlier day of
// the fetched week. The earliest slice is the origin and reads normally; every later slice carries
// the `⇄ suite` tag and the split meta. A group with a single fetched slice cannot be told apart from
// a normal task, which is acceptable for this read-only bout.
const continuationIds = computed<Set<string>>(() => {
  const groups = new Map<string, PlanningTask[]>()
  for (const task of tasks.value ?? []) {
    if (!task.splitGroupId) continue
    const group = groups.get(task.splitGroupId) ?? []
    group.push(task)
    groups.set(task.splitGroupId, group)
  }

  const ids = new Set<string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
    )
    for (const slice of sorted.slice(1)) ids.add(slice.id)
  }
  return ids
})

// The seven day views, Sunday first. The week's Sunday is index 0 and its Saturday index 6, so the
// contextual off-day suffixes are keyed off the position rather than any ad-hoc date math. A non-work
// day gets its italic label; a working day gets none. The API already returns the tasks ordered by
// date then sortOrder, so filtering by day preserves that order.
const days = computed<PlanningDayView[]>(() => {
  const all = tasks.value ?? []
  return getWeekDays(today.value).map((date, index) => {
    const dayWork = isWorkDay(date, workDays.value)

    let offLabel: string | null = null
    if (!dayWork) {
      const base = t('planning.offDay.base')
      if (index === 0) offLabel = `${base} ${t('planning.offDay.sundaySuffix')}`
      else if (index === 6) offLabel = `${base} ${t('planning.offDay.saturdaySuffix')}`
      else offLabel = base
    }

    return {
      date,
      dayLabel: formatDayLabel(date, locale.value, monthsShort.value),
      isToday: date === today.value,
      isWorkDay: dayWork,
      offLabel,
      tasks: all.filter((task) => task.date === date)
    }
  })
})
</script>

<template>
  <div class="mx-auto w-full max-w-5xl px-6 py-[clamp(1.25rem,3vh,2rem)] sm:px-6 lg:px-8">
    <header class="mb-6">
      <h1
        class="text-[clamp(1.5rem,1.6vw+0.5rem,2.25rem)] font-bold tracking-tight text-balance text-highlighted"
      >
        {{ t('planning.title') }}
      </h1>
      <p class="mt-1 text-base text-muted">{{ weekLabel }}</p>
    </header>

    <!-- A failed range fetch (a client-side range bug or a network error) shows a recoverable
         message with a retry rather than a blank crash. An empty week is a normal state, not an
         error, and renders seven day headers with empty bodies. -->
    <div v-if="tasksStatus === 'error'" role="alert">
      <UAlert
        :actions="[
          {
            label: t('planning.retry'),
            color: 'neutral',
            variant: 'outline',
            onClick: () => refreshTasks()
          }
        ]"
        color="error"
        icon="i-ph-warning-circle"
        :title="t('planning.loadError')"
        variant="subtle"
      />
    </div>

    <PlanningWeek v-else :continuation-ids="continuationIds" :days="days" />
  </div>
</template>
