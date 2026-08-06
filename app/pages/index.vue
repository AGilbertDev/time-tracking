<script setup lang="ts">
import type { PlanningDayView } from '~/components/planning/Week.vue'
import type { OpenEditorTarget } from '~/utils/taskEditor'

import {
  addDays,
  computeCapacity,
  formatDayLabel,
  formatWeekLabel,
  getWeekDays,
  getWeekRange,
  isWorkDay,
  type PlanningTask,
  resolveSchedule,
  sumEffectiveDuration,
  todayInZone,
  type WorkScheduleRecord
} from '#shared/planning'
import { isSameEditorTarget } from '~/utils/taskEditor'

// The signed-in owner's dashboard: the current Sunday-to-Saturday week with its task rows and the
// inline editor that writes them. This page is the data owner. It reads the work settings and the
// week's tasks, derives the week from the pure helpers, renders the stack, and refreshes the week
// after a write. The global auth middleware guarantees a session before this runs, so an
// unauthenticated visitor is already routed to sign-in rather than reaching a broken week.
//
// It also owns the one open editor, because exactly one is open across the whole week and a per-card
// ref cannot express that. Every path that would close or replace it comes through one function here,
// which is what keeps the discard confirmation to a single instance and a single rule: a row click, a
// day collapse, a week switch, a route leave, Escape, Cancel, and a click outside all ask the same
// question and get the same answer.
const { t, locale, tm, rt } = useI18n()

// Authenticated dashboard, kept out of the index. The whole app is auth-gated; the intent is stated
// for the SEO stage even though there is nothing to optimize for search here.
useSeoMeta({
  title: () => t('planning.title'),
  robots: 'noindex, nofollow'
})

// The full month names are locale data held in the i18n `planning` namespace, so the formatters stay
// pure and the month copy lives in one place. The same array feeds both the week label and the
// day-card label, which use the full month name. tm returns the raw array and rt resolves each entry
// for the active locale.
const monthsLong = computed<string[]>(() =>
  (tm('planning.monthsLong') as string[]).map((m) => rt(m))
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

// Today in the user's own zone, computed from the single captured instant. It stays fixed for the
// session, so the today marker and the Aujourd'hui target never drift mid-navigation.
const today = computed(() => todayInZone(new Date(nowIso.value), timezone.value))

// The week the switcher points at (PLAN-08). It starts on today's week and moves by whole weeks;
// the visible range and days derive from it through the pure helpers, so the client never sends an
// invalid range to the endpoint.
const anchorDate = ref(today.value)
const weekRange = computed(() => getWeekRange(anchorDate.value))

// The effective-dated work schedule (PLAN-03), fetched once and reused across week switches: only
// tasks refetch when paging, and each visible day resolves its own schedule client-side with the
// shared resolveSchedule. An empty history resolves to the documented defaults, so the meter still
// renders 450 / 60.
const { data: scheduleRecords } = await useAsyncData('planning-work-schedule', () =>
  $fetch<WorkScheduleRecord[]>('/api/me/work-schedule', { headers: requestHeaders })
)

// Tasks for the visible week. The key is stable and the fetch is re-run through `watch: [weekRange]`
// on every week switch, so Nuxt's per-key promise guard applies only the latest range's response and
// silently discards a slow superseded one during rapid paging. The range is derived only from the
// pure week helpers, so the client never sends an invalid range.
const {
  data: tasks,
  status: tasksStatus,
  error: tasksError,
  refresh: refreshTasks
} = await useAsyncData(
  'planning-tasks',
  () =>
    $fetch<PlanningTask[]>('/api/tasks', {
      query: { from: weekRange.value.from, to: weekRange.value.to },
      headers: requestHeaders
    }),
  { watch: [weekRange] }
)

// Session expiry mid-navigation returns 401 from the read. Route to sign-in through the same path the
// global auth middleware uses rather than leaving a broken week. Any other failure keeps the
// recoverable error state below, so the user is never stranded.
const localePath = useLocalePath()
watch(tasksError, (err) => {
  const failure = err as { statusCode?: number; status?: number } | null
  if (failure?.statusCode === 401 || failure?.status === 401) navigateTo(localePath('signin'))
})

// --- the one open editor (PLAN-10, PLAN-11) -------------------------------------------------------

// A close or a replacement the page has asked for. `target` is what should be open afterwards, which
// is null for a plain close, and `after` is the continuation the caller needs run once the editor has
// actually gone: collapsing the card it sits in, switching the week, or completing a navigation. It is
// a callback rather than a second piece of state because the answer may take a user decision, and the
// caller is the only thing that knows what it was about to do.
type EditorIntent = { after?: () => void; target: null | OpenEditorTarget }

const openEditor = ref<null | OpenEditorTarget>(null)
const editorDirty = ref(false)
// Bumped to pull focus back into the open form, which is what declining the discard confirmation does.
const editorFocusRequest = ref(0)
const pendingIntent = ref<null | EditorIntent>(null)
const discardOpen = ref(false)
const discardOutcome = ref<'discard' | 'keep'>('keep')

// The polite live region's text. It has to live on the page rather than in the panel: the panel is
// destroyed on a successful save, so a region inside it would be removed in the same tick as the
// announcement it is supposed to make and would announce nothing at all. That is the kind of defect
// that ships broken and passes every visual check, so it is placed outside anything a save destroys.
const editorStatusMessage = ref('')

// Every close and every replacement runs through here, so the dirty check exists once. A clean editor
// goes quietly, in the common case with no prompt ever; a dirty one puts the confirmation in the way
// and loses nothing.
function requestEditorIntent(intent: EditorIntent) {
  if (!openEditor.value || !editorDirty.value) {
    applyEditorIntent(intent)
    return
  }

  pendingIntent.value = intent
  discardOutcome.value = 'keep'
  discardOpen.value = true
}

function applyEditorIntent(intent: EditorIntent) {
  const previous = openEditor.value
  openEditor.value = intent.target
  editorDirty.value = false

  const next = intent.target
  if (next) {
    // Scroll the row or the add control the panel opens under into view before the editor takes focus,
    // so a tall form does not push the line that identifies it off the top of the screen. The editor
    // focuses its first control with preventScroll for the same reason. No smooth scrolling, because
    // it would race the 150 ms day disclosure the same click may have triggered.
    nextTick(() => scrollEditorTargetIntoView(next))
  } else if (previous) {
    nextTick(() => focusEditorOrigin(previous))
  }

  intent.after?.()
}

// Pressing the control of the editor that is already open collapses it, which is what the
// aria-expanded on that control promises.
function onOpenEditorRequest(target: OpenEditorTarget) {
  requestEditorIntent({ target: isSameEditorTarget(openEditor.value, target) ? null : target })
}

function onCloseEditorRequest(after?: () => void) {
  requestEditorIntent({ after, target: null })
}

// The save has landed and the row has to come back from the server rather than be spliced in by hand,
// because the server owns sort_order, the day a row belongs to, statusKey, trackable, and the day's
// capacity meter. The planning week is a useAsyncData read, so the documented way to refresh it is its
// key. A refresh that fails leaves the page's existing week-level error and its retry, and the editor
// still closes, because the write already succeeded and there is nothing unsaved left in it.
async function onEditorSaved(payload: { mode: 'create' | 'update'; taskId: string }) {
  const origin = openEditor.value

  try {
    await refreshNuxtData('planning-tasks')
  } finally {
    openEditor.value = null
    editorDirty.value = false
  }

  await nextTick()
  await announceEditorStatus(
    payload.mode === 'create' ? t('planning.editor.created') : t('planning.editor.saved')
  )
  focusAfterSave(origin, payload)
}

// No toast. The collapse and the updated row are the visible confirmation, and a toast on every save
// in a flow the user repeats dozens of times a day is noise. The region is cleared first so that
// saving twice in a row announces twice rather than once.
async function announceEditorStatus(message: string) {
  editorStatusMessage.value = ''
  await nextTick()
  editorStatusMessage.value = message
}

function onDiscardKeepEditing() {
  discardOutcome.value = 'keep'
  discardOpen.value = false
}

function onDiscardConfirm() {
  discardOutcome.value = 'discard'
  discardOpen.value = false
}

// Both outcomes are acted on once the modal has actually gone. Reka restores focus to whatever held it
// before the dialog opened as part of closing, so anything set while that is still pending would be
// silently overwritten a frame later. Escape and an overlay click both land here as "keep editing",
// which is the safe reading of an ambiguous gesture.
function onDiscardClosed() {
  const intent = pendingIntent.value
  pendingIntent.value = null
  if (!intent) return

  if (discardOutcome.value === 'discard') {
    applyEditorIntent(intent)
    return
  }

  editorFocusRequest.value += 1
}

// Focus is never left on <body>. The row's own expand button is the right target when the save left it
// where it was, and a save that changes the day can move the row out of the visible week or into a card
// that is still collapsed, in which case the button either does not exist or sits inside an inert panel
// and focusing it would silently do nothing. The disclosure control of the card the editor was open in
// is the fallback, and it always exists and is always reachable now that every card is disclosable.
function focusFirstReachable(ids: string[]) {
  for (const id of ids) {
    const element = document.getElementById(id)
    if (element && !element.closest('[inert]')) {
      element.focus()
      return
    }
  }
}

function focusEditorOrigin(target: OpenEditorTarget) {
  focusFirstReachable(
    target.kind === 'edit'
      ? [`planning-task-toggle-${target.taskId}`, `planning-day-toggle-${target.date}`]
      : [`planning-day-add-${target.date}`, `planning-day-toggle-${target.date}`]
  )
}

// A create returns focus to the add control, so a second task is one keypress away.
function focusAfterSave(
  origin: null | OpenEditorTarget,
  payload: { mode: 'create' | 'update'; taskId: string }
) {
  if (!origin) return

  focusFirstReachable(
    payload.mode === 'create'
      ? [`planning-day-add-${origin.date}`, `planning-day-toggle-${origin.date}`]
      : [`planning-task-toggle-${payload.taskId}`, `planning-day-toggle-${origin.date}`]
  )
}

function scrollEditorTargetIntoView(target: OpenEditorTarget) {
  const id =
    target.kind === 'edit'
      ? `planning-task-toggle-${target.taskId}`
      : `planning-day-add-${target.date}`
  document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
}

// A refresh can take the open editor's row out of the week, either because a save moved it or because
// another tab deleted it, and the panel is unmounted with it. The page must not go on believing an
// editor is open and dirty when nothing is holding those values, or the next week switch would ask
// about work that no longer exists.
watch(tasks, () => {
  const target = openEditor.value
  if (target?.kind !== 'edit') return
  if ((tasks.value ?? []).some((task) => task.id === target.taskId)) return

  openEditor.value = null
  editorDirty.value = false
})

// Leaving the route with changes pending runs the same confirmation, through the router's own leave
// guard rather than a second mechanism. Discarding re-issues the navigation the guard refused.
const router = useRouter()
let leaveApproved = false

onBeforeRouteLeave((to) => {
  if (leaveApproved || !openEditor.value || !editorDirty.value) {
    leaveApproved = false
    return true
  }

  requestEditorIntent({
    after: () => {
      leaveApproved = true
      router.push(to.fullPath)
    },
    target: null
  })
  return false
})

// A reload or a closed tab gets the browser's own warning, which is the only thing that can interrupt
// either. A draft lost this way writes nothing, so there is no half-created row to clean up.
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!openEditor.value || !editorDirty.value) return

  event.preventDefault()
  // Older browsers only show the prompt when returnValue is set.
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

// The switcher moves by exactly one week (correct across month and year boundaries because addDays
// is), and Cette semaine re-anchors to today's week. Each change flows through anchorDate ->
// weekRange, which the tasks watcher refetches. Cette semaine is safe to press repeatedly: it
// re-anchors to the same known-good current week.
//
// Each one goes through the editor's dirty check first. Without it the day card is destroyed by the
// v-for key change and everything typed vanishes with no warning at all.
function goToPreviousWeek() {
  requestEditorIntent({
    after: () => {
      anchorDate.value = addDays(anchorDate.value, -7)
    },
    target: null
  })
}
function goToNextWeek() {
  requestEditorIntent({
    after: () => {
      anchorDate.value = addDays(anchorDate.value, 7)
    },
    target: null
  })
}
function goToCurrentWeek() {
  requestEditorIntent({
    after: () => {
      anchorDate.value = today.value
    },
    target: null
  })
}

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

// The seven day views, Sunday first. A non-work day gets the plain `Congé` label; a working day gets
// none. The API already returns the tasks ordered by date then sortOrder, so filtering by day
// preserves that order.
const days = computed<PlanningDayView[]>(() => {
  const all = tasks.value ?? []
  const schedule = scheduleRecords.value ?? []
  return getWeekDays(anchorDate.value).map((date) => {
    const dayWork = isWorkDay(date, workDays.value)
    const dayTasks = all.filter((task) => task.date === date)

    const offLabel = dayWork ? null : t('planning.offDay.base')

    // Capacity is a work-day concern only. A non-work day carries null so its card shows the off-day
    // hint and no meter (the do-not-police rule). workMinutes / bufferMinutes resolve from the
    // schedule history for that specific date, so a mid-week rate change is honoured per day.
    let capacity: PlanningDayView['capacity'] = null
    if (dayWork) {
      const resolved = resolveSchedule(schedule, date)
      const booked = sumEffectiveDuration(dayTasks)
      capacity = computeCapacity(booked, resolved.workMinutes, resolved.bufferMinutes)
    }

    return {
      date,
      dayLabel: formatDayLabel(date, locale.value, monthsLong.value),
      isToday: date === today.value,
      isWorkDay: dayWork,
      offLabel,
      tasks: dayTasks,
      capacity
    }
  })
})
</script>

<template>
  <!-- The planning week is a data-dense dashboard, so the container takes the wide step the styling
       conventions prescribe for that shape. The extra width at xl goes to the two tracks that benefit
       from slack, the task name and the capacity bar; every fixed track is untouched. This is a
       container max-width step, not a second arrangement, so the week keeps one layout at every
       width. -->
  <div
    class="mx-auto w-full max-w-5xl px-6 py-[clamp(1.25rem,3vh,2rem)] sm:px-6 lg:px-8 xl:max-w-6xl"
  >
    <header class="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="min-w-0">
        <h1
          class="text-[clamp(1.5rem,1.6vw+0.5rem,2.25rem)] font-bold tracking-tight text-balance text-highlighted"
        >
          {{ t('planning.title') }}
        </h1>
        <p class="mt-1 text-base text-muted">{{ weekLabel }}</p>
      </div>

      <!-- The week switcher (PLAN-08). Three text buttons: the prev and next controls read as
           `‹ Précédente` and `Suivante ›` with the chevron glyph aria-hidden, so the accessible name
           is the visible text; the middle control re-anchors to the current week. -->
      <!-- Each control carries data-editor-gate, which is how the editor's click-outside detector
           knows to stand down: these three run the discard confirmation themselves, and firing the
           quiet unsaved note underneath a modal would say the same thing twice. -->
      <div class="flex shrink-0 items-center gap-1.5">
        <UButton color="neutral" data-editor-gate variant="outline" @click="goToPreviousWeek">
          <span aria-hidden="true">‹</span>
          {{ t('planning.nav.previousWeek') }}
        </UButton>
        <UButton color="neutral" data-editor-gate variant="outline" @click="goToCurrentWeek">
          {{ t('planning.nav.currentWeek') }}
        </UButton>
        <UButton color="neutral" data-editor-gate variant="outline" @click="goToNextWeek">
          {{ t('planning.nav.nextWeek') }}
          <span aria-hidden="true">›</span>
        </UButton>
      </div>
    </header>

    <!-- The editor's success announcement. It lives here rather than inside the panel because the
         panel is destroyed on a successful save, so a region inside it would be torn down before it
         could speak. Follows profile.vue's shipped pattern. -->
    <p aria-atomic="true" aria-live="polite" class="sr-only">{{ editorStatusMessage }}</p>

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

    <PlanningWeek
      v-else
      :continuation-ids="continuationIds"
      :days="days"
      :editor-focus-request="editorFocusRequest"
      :open-editor="openEditor"
      @close-editor="onCloseEditorRequest"
      @open-editor="onOpenEditorRequest"
      @saved="onEditorSaved"
      @update:editor-dirty="editorDirty = $event"
    />

    <!-- One confirmation for every way an editor can be closed with changes pending, following the
         shared confirmation modal in app/pages/admin/users.vue so the app has one idiom. Continuer
         l'édition is first and neutral and Abandonner is second and error, so the safe action is the
         easy one and the destructive one looks destructive. It stays dismissible: Escape and an
         overlay click both mean keep editing. -->
    <UModal
      v-model:open="discardOpen"
      :description="t('planning.editor.discardBody')"
      :title="t('planning.editor.discardTitle')"
      :ui="{ footer: 'justify-end' }"
      @after:leave="onDiscardClosed"
    >
      <template #footer>
        <UButton
          color="neutral"
          :label="t('planning.editor.discardCancel')"
          variant="ghost"
          @click="onDiscardKeepEditing"
        />
        <UButton
          color="error"
          :label="t('planning.editor.discardConfirm')"
          @click="onDiscardConfirm"
        />
      </template>
    </UModal>
  </div>
</template>
