<script setup lang="ts">
import type { FormError } from '@nuxt/ui'

import type { PlanningTask, TaskStatus } from '#shared/planning'
import type { TaskWriteRequest } from '~/composables/useTaskWrite'
import type { TaskEditorState, TaskWriteFailure } from '~/utils/taskEditor'

import {
  categoryHue,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  isDeliverableCategory
} from '#shared/categories'
import { statusKey, TASK_STATUSES } from '#shared/planning'
import { joinDuration, splitDuration } from '~/utils/taskDuration'
import {
  buildCreatePayload,
  classifyTaskWriteError,
  diffEditorState,
  displayedStatus,
  emptyEditorState,
  isEditorDirty,
  TASK_FIELD_ERROR_KEYS,
  TASK_NOTES_MAX,
  TASK_TEXT_MAX,
  taskToEditorState
} from '~/utils/taskEditor'

// The inline task editor (PLAN-10 and PLAN-11). One component for both jobs: given a task it edits
// that task, given none it drafts a new one on the day it opened in. Nothing branches on that beyond
// which baseline it starts from, which request it sends, and whether its heading is visible.
//
// It declares no ARIA role of its own. For an edit the parent wraps it in a row and a cell inside the
// day's hand-rolled table; for a draft the parent puts it in the day footer, outside the table
// entirely, because a draft has no tabular identity until it has been saved. One component, two
// mounting contexts, no knowledge of either.
//
// It holds no business rule. The client validates exactly one thing, that something changed, and every
// other rule stays on the server: the calendar-day check, the HH:MM shape, the numeric bounds, the
// trimming, and whether a status fits its category. It used to validate a second thing, that a category
// had been chosen, and that is gone because a category is always chosen now. The contract functions it
// reads are isDeliverableCategory and categoryHue, imported from shared/ so there is one copy of each
// rule rather than two. Nothing here derives an estimate from a word count and a quota; that is
// PLAN-12's and it belongs in the server write handlers, never in a component.
const props = defineProps<{
  // The day the editor opened in. It prefills a draft and is the day a failed patch would recreate
  // its task on.
  date: string
  // Bumped by the page to pull focus back into the form, which is what happens when the user declines
  // the discard confirmation. A token rather than a method call, because the page is three components
  // away and this is presentation plumbing rather than state.
  focusRequest?: number
  // The id the collapsed row's aria-controls points at, which also seeds every id inside the panel so
  // two open editors could never collide.
  panelId: string
  // Absent for a draft.
  task?: null | PlanningTask
}>()

const emit = defineEmits<{
  // The user asked to close (Cancel, Escape, or a clean click outside). The page decides, because it
  // is the one holding the dirty check and the confirmation, and because the same decision is reached
  // from four other places the editor knows nothing about.
  closeRequest: []
  saved: [{ mode: 'create' | 'update'; taskId: string }]
  'update:dirty': [dirty: boolean]
}>()

const { t } = useI18n()
const localePath = useLocalePath()
const { save, saving } = useTaskWrite()

// The loaded row, captured once. It is the thing every field is compared against, so it must not
// track a later refetch of the week: the editor is created and destroyed per open (AC30) and the
// parent keys it, so a fresh open re-reads it anyway.
const baseline: TaskEditorState = props.task
  ? taskToEditorState(props.task)
  : emptyEditorState(props.date)

const state = reactive<TaskEditorState>({ ...baseline })

// The two duration pairs are the component's own state rather than a view of the stored total, and
// that is load-bearing. Deriving each box from the total means clearing one box re-reads as a zero and
// the pair can never get back to empty, which would make an unmeasured Durée réelle unreachable once
// a figure had been typed. Holding the boxes and joining them means two empty boxes are null, two
// zeroes are 0, and AC27's two cases stay apart.
const estimated = reactive(splitDuration(baseline.estimatedMinutes))
const actual = reactive(splitDuration(baseline.actualMinutes))

watch(estimated, () => {
  state.estimatedMinutes = joinDuration(estimated)
})
watch(actual, () => {
  state.actualMinutes = joinDuration(actual)
})

// Dirty, the request body, and the refusal to send an empty patch all come from one comparison, so
// the save control can never be enabled with nothing to send. The page mirrors the verdict because
// every other close path in the week has to consult it.
const dirty = computed(() => isEditorDirty(baseline, state))
watch(dirty, (value) => emit('update:dirty', value), { immediate: true })

// What the save control waits for, which is not the same question as dirtiness for both of the
// editor's two jobs. An edit needs something to have changed, because the write API refuses an empty
// patch. A draft has something to send from the moment it opens, since a day alone is a legal task and
// the day came from the card the draft opened in, so its save is enabled immediately and pressing add
// then save records one task on that day in the preselected category.
//
// Dirtiness stays the separate question it is, and the page keeps reading it for the discard
// confirmation, where an untouched draft has to count as clean: nothing was typed, so a click outside
// takes nothing away and must not cost a prompt.
const canSave = computed(() => !props.task || dirty.value)

// The ten categories in contract order with their labels from the i18n layer. The colour is one hue
// angle read from categoryHue, so there is no category-to-colour mapping in this component and the
// association a user learns from a row is the association the selector teaches.
//
// One separator sits immediately above the catch-all and nowhere else, and that is the whole of how it
// is set apart: no muting, no icon, no suffix, no reordering, and its own row colour like every other
// option. A rule above the last entry says the nine specific kinds of work are above the line without
// ranking or disabling anything, which is worth most on a fresh draft, where the preselected value is
// the last item in the list.
//
// Its position is read from DEFAULT_CATEGORY_ID rather than from an index, because the rule is that the
// line sits above the catch-all rather than above the tenth thing, and the contract is what says which
// id that is.
//
// Nuxt UI treats a separator as a structural item, so it never joins the option collection: it cannot
// be selected or highlighted, keyboard navigation steps from the option above it straight to the one
// below, and Reka renders it aria-hidden, so a screen reader hears ten options and no extra noise. Its
// default theme class is already a semantic token in both modes, so it takes no override.
const categoryItems = computed(() =>
  DEFAULT_CATEGORIES.flatMap((category) => {
    const option = { label: t(`categories.${category.id}`), value: category.id }

    return category.id === DEFAULT_CATEGORY_ID ? [{ type: 'separator' as const }, option] : [option]
  })
)

// The closed trigger's label, read from the model rather than looked up in the items array, so there is
// one branch and no null case. The field always holds a value, and the same categories.<id> convention
// the row uses resolves it.
const selectedCategoryLabel = computed(() => t(`categories.${state.category}`))

// Whether the pending category carries a status, read from the pending selection rather than from the
// row's server-resolved flag, because the selection can differ from the stored category before a save
// and the flag describes the stored one. This one computed feeds both the disabled state and the help
// line, so the control cannot say it is unavailable while accepting input. Those two move together or
// not at all: the help text is wired into aria-describedby, so an operable control carrying it would
// announce that it is unavailable and then take a value anyway.
//
// It is isDeliverableCategory and not isTrackableCategory. Non-trackable means the row's words reach no
// quota; it does not mean the row has no status. The two were one function until `other` arrived, and
// `other` is the member where they differ, so keying this on trackability would disable the status
// field on the one category the whole feature exists to give a status to. displayedStatus and
// diffEditorState read the same shared function, so what the control shows, what it accepts and what the
// patch carries can never disagree.
const deliverable = computed(() => isDeliverableCategory(state.category))

// The three stored status values in cycle order plus a none option, labelled through the shared
// presentation keys so no fourth copy of the French status names exists anywhere under app/.
const STATUS_NONE = 'none'

const statusItems = computed(() => [
  { label: t('planning.editor.fields.statusNone'), value: STATUS_NONE },
  ...TASK_STATUSES.map((value) => ({
    label: t(`planning.status.${statusKey(value, true)}`),
    value: value as string
  }))
])

// What the control shows is what will be stored, so the displayed value is derived from the pending
// category and the user's choice together rather than held by the control. displayedStatus is the pure
// half of that and diffEditorState reads the same rule, so the field can never print a value the save
// is about to discard. The choice underneath is left alone, which is what makes a round trip through a
// statusless category and back restore the value that is still going to be stored rather than an empty
// field or a value that would be thrown away.
const statusModel = computed({
  get: () => displayedStatus(state) ?? STATUS_NONE,
  set: (value: string) => {
    state.status = value === STATUS_NONE ? null : (value as TaskStatus)
  }
})

// The counter is information rather than policing. Nothing is blocked, nothing is reformatted, and it
// exists only so the bound is not discovered through a 422. The two lifted tones are StatusBadge's,
// already measured against every card surface.
const notesLength = computed(() => state.notes.length)
const notesCounterText = computed(() =>
  t('planning.editor.fields.notesCounter', { count: notesLength.value, max: TASK_NOTES_MAX })
)
// The resting tone is `text-toned`, not the `text-dimmed` the blueprint carried. This is 12 px text
// stating a real bound, so 1.4.3 binds it at 4.5:1, and dimmed measures 2.01:1 to 2.94:1 across the
// four card surfaces the panel can sit on in the five themes. Toned clears 8.69:1 at its worst, which
// is the same correction the column header line already took for the same reason. The two lifted tones
// are StatusBadge's, already measured against every card surface.
const notesCounterClass = computed(() => {
  if (notesLength.value > TASK_NOTES_MAX) return 'text-xs text-error-800 dark:text-error-400'
  if (notesLength.value >= TASK_NOTES_MAX * 0.9)
    return 'text-xs text-warning-800 dark:text-warning-400'
  return 'text-xs text-toned'
})

// --- ids ------------------------------------------------------------------------------------------

// `panelId` is the form element's own id rather than a prefix for one, and that is an accessibility
// fix rather than a tidy-up. The collapsed row's `aria-controls` and the add control's both point at
// `panelId`, so unless some element actually carries it the reference resolves to nothing and the
// disclosure relationship AC29 asks for is only half declared. It is also how the click-outside
// detector finds the form without a typed template ref into UForm's exposed API.
const headingId = `${props.panelId}-heading`

// Each duration is two boxes under one label, and UFormField hands the same generated id to every
// control inside it, so two UInputNumbers in one field render two elements with the same id and the
// field's `<label for>` binds to whichever consumed the injection last. Each box therefore carries
// its own id, and the pair is named as a `role="group"` off the field's label instead of leaning on
// that binding: without the group a screen reader announces two bare spin buttons called "heures" and
// "minutes" with nothing saying which duration they belong to.
const estimatedLabelId = `${props.panelId}-estimated-label`
const actualLabelId = `${props.panelId}-actual-label`

// --- save, and the four ways it can fail ----------------------------------------------------------

// Typed rather than inferred, because the 422 path reads `errors` off it: UForm resolves every error
// it is handed to the id of the control that error belongs to, which is what lets focus land on the
// first offending field instead of nowhere.
const form = useTemplateRef<{
  clear: () => void
  errors: Array<{ id?: string; message: string; name?: string }>
  setErrors: (errors: FormError[]) => void
}>('form')
const failure = ref<null | TaskWriteFailure>(null)
// A 422 key with nowhere to attach: `_form`, or a field this build does not know. It surfaces at form
// level with the generic invalid-value line rather than as nothing and rather than the server's
// developer-facing English.
const unmappedMessage = ref<null | string>(null)
const lastRequest = ref<null | TaskWriteRequest>(null)
// The quiet in-place note for a click outside with changes pending. It stays until the editor is saved
// or discarded, because it is a true statement for as long as it is showing.
const outsideWarning = ref(false)

const alertKind = computed<'error' | 'gone' | 'none' | 'session'>(() => {
  const current = failure.value
  if (!current) return 'none'
  if (current.kind === 'gone') return 'gone'
  if (current.kind === 'unauthenticated') return 'session'
  if (current.kind === 'validation') return unmappedMessage.value ? 'error' : 'none'
  return 'error'
})

const canRetry = computed(
  () => failure.value?.kind === 'retryable' || failure.value?.kind === 'unauthenticated'
)

// The client refuses nothing of its own any more. It used to refuse a save with no category chosen,
// and there is no such state left to refuse: a draft opens on the shared default and the selector
// offers no way to clear one, so the check could only ever have fired on a state the form cannot reach.
// A save blocked by a dropdown the user never opened is the app declining to record something that
// happened, which is what this feature exists to stop.
function currentRequest(): TaskWriteRequest {
  if (props.task) {
    return { body: diffEditorState(baseline, state), id: props.task.id, mode: 'update' }
  }
  return { body: buildCreatePayload(state), mode: 'create' }
}

async function onSubmit() {
  // An empty patch is refused by the write API and the save control is disabled for it, so reaching
  // here with nothing to send can only be a native submit from the Enter key. A draft always has
  // something to send, so this only ever stands in the way of an unchanged edit.
  if (!canSave.value) return

  await runSave(currentRequest())
}

async function runSave(request: TaskWriteRequest) {
  failure.value = null
  unmappedMessage.value = null
  form.value?.clear()
  lastRequest.value = request

  try {
    const task = await save(request)
    emit('saved', { mode: request.mode, taskId: task.id })
  } catch (error) {
    const classified = classifyTaskWriteError(error)
    failure.value = classified
    if (classified.kind === 'validation') applyFieldErrors(classified.fields)
  }
}

// A retry re-sends the very same body, which is what makes it safe after an expired session: the user
// signs in elsewhere and nothing they typed had to be stored anywhere to survive.
async function onRetry() {
  const request = lastRequest.value
  if (request) await runSave(request)
}

// A patch against a row somebody else deleted can never succeed, so the only real recovery is to
// recreate it. The typed values are still good and the day is still there, and the new row gets a new
// id, which costs nothing because nothing references a task by id.
async function onSaveAsNew() {
  await runSave({ body: buildCreatePayload(state), mode: 'create' })
}

// A 422 is mapped by field name and never printed. Every key the contract knows lands on its own
// control through UForm's setErrors, so UFormField wires aria-invalid and aria-describedby itself.
function applyFieldErrors(fields: Record<string, string>) {
  const errors: FormError[] = []
  let unmapped = false

  for (const key of Object.keys(fields)) {
    const copyKey = TASK_FIELD_ERROR_KEYS[key]
    if (!copyKey) {
      unmapped = true
      continue
    }
    errors.push({
      message: t(copyKey, { max: key === 'notes' ? TASK_NOTES_MAX : TASK_TEXT_MAX }),
      name: key
    })
  }

  if (errors.length) form.value?.setErrors(errors)
  // A 422 that named nothing this build recognises still has to say something actionable.
  if (unmapped || errors.length === 0) {
    unmappedMessage.value = t('planning.editor.validation.invalid')
  }

  if (errors.length) void focusFirstErrorField()
}

// A validation failure has to be perceivable and not merely visible. UFormField wires `aria-invalid`
// and the message on each named control, but nothing about that reaches a user who is not looking:
// they pressed Enregistrer, the panel stayed open, and no field they can hear changed. Moving focus to
// the first offending control makes the screen reader read that field, its invalid state and its
// message in one go, which is the documented remedy for 3.3.1 on submit. It is deliberately the only
// focus move the failure paths make, so a 500 or an expired session leaves focus on the control the
// user pressed and the message is carried by the live region below instead.
async function focusFirstErrorField() {
  await nextTick()
  const first = form.value?.errors?.[0]
  if (!first?.id) return
  document.getElementById(first.id)?.focus()
}

// --- closing, and focus ---------------------------------------------------------------------------

// Escape from anywhere inside the form cancels, and the page decides what that costs. A key pressed
// inside an open popover or inside the discard confirmation never reaches here at all, because both
// are portalled out of this subtree, so there is no handler to stand down.
function onEscape(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  emit('closeRequest')
}

// A click outside collapses a clean editor with no prompt, ever, and never loses a dirty one. The
// detector treats every portalled layer as inside, so picking a category is not a click outside the
// form; the composable's comment carries the reasoning.
useClickOutsideEditor(
  () => document.getElementById(props.panelId),
  () => {
    if (dirty.value) {
      outsideWarning.value = true
      return
    }
    emit('closeRequest')
  }
)

const categorySelect = useTemplateRef<{ triggerRef?: HTMLElement }>('categorySelect')

// Focus lands on the category selector, which is the first control. preventScroll because the page has
// already scrolled the row this panel belongs to into view, and letting the browser scroll to a control
// near the bottom of a tall panel would push that row off the top.
function focusFirstField() {
  categorySelect.value?.triggerRef?.focus({ preventScroll: true })
}

onMounted(() => nextTick(focusFirstField))
watch(
  () => props.focusRequest,
  () => nextTick(focusFirstField)
)
</script>

<template>
  <!-- The left edge carries the category colour and binds to the model rather than to the row, which is
       what keeps the stripe honest about what will be saved: the selector's own value decides, not
       whatever the row happens to hold. It is drawn unconditionally, because a panel always has a
       category now, so there is no transparent state left to draw. The create default and the coercion
       fallback happen to be the same id today, and binding to the model is what keeps the edge correct
       if one of them later moves. -->
  <UForm
    :id="panelId"
    :aria-labelledby="headingId"
    class="planning-cat-edge rounded-xl border border-l-2 border-accented p-4 dark:border-default"
    :state="state"
    :style="{ '--planning-cat-hue': categoryHue(state.category) }"
    :validate-on="[]"
    @keydown.escape="onEscape"
    @submit="onSubmit"
  >
    <!-- A draft needs a visible heading because nothing else on screen says what the box is. An edit
         does not: the collapsed row is directly above it and printing the same thing twice is exactly
         the clutter this feature exists to reduce. -->
    <p :id="headingId" :class="task ? 'sr-only' : 'text-sm font-semibold text-highlighted'">
      {{ task ? t('planning.editor.editFormLabel') : t('planning.editor.newTask') }}
    </p>

    <!-- One twelve-column grid reflowing against the day card rather than the viewport, because the
         card is what the form has to fit inside. The DOM order is the spec's field order 1 through 13
         and nothing else, so the reading order, the tab order and the visual order are one thing. -->
    <div class="mt-3 grid grid-cols-12 gap-4">
      <!-- 1. Catégorie. Coloured trigger and coloured options, both reading the same hue from the
              shared contract, and one separator above the catch-all as the only thing setting it apart.
              The field is no longer required and no longer carries a placeholder, because it always
              holds a value: a draft opens on the shared default and there is no way to clear one. The
              preselected value reads plain rather than muted, because it is the value the save will
              honour and styling it as provisional would say the field is empty when it is not. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-3"
        :label="t('planning.editor.fields.category')"
        name="category"
      >
        <USelectMenu
          ref="categorySelect"
          v-model="state.category"
          class="w-full"
          :items="categoryItems"
          value-key="value"
        >
          <template #default>
            <span
              class="planning-cat-name"
              :style="{ '--planning-cat-hue': categoryHue(state.category) }"
            >
              {{ selectedCategoryLabel }}
            </span>
          </template>

          <!-- Each option in its own row colour, `Autre` included. The guard is a narrowing rather
               than a state: the items array holds one separator, which has no value and never reaches
               this slot, and testing for the value is what lets the option's own members be read
               without a cast. -->
          <template #item-label="{ item }">
            <span
              v-if="'value' in item"
              class="planning-cat-name"
              :style="{ '--planning-cat-hue': categoryHue(item.value) }"
            >
              {{ item.label }}
            </span>
          </template>
        </USelectMenu>
      </UFormField>

      <!-- 2. Jour. It is in the form because delete is PLAN-13 and drag is PLAN-16, so without it a
              task added to the wrong day would be stuck there with no way out. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-3"
        :label="t('planning.editor.fields.day')"
        name="date"
        required
      >
        <!-- `aria-required` rather than the native `required`, for the same reason the category
             carries it: UFormField's `required` is label decoration only. The native attribute would
             also hand the browser its own non-localized validation bubble, and the client here
             validates exactly two things and leaves the rest to the server. -->
        <UInput v-model="state.date" aria-required="true" class="w-full" type="date" />
      </UFormField>

      <!-- 3. Client. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-3"
        :label="t('planning.editor.fields.client')"
        name="client"
      >
        <UInput v-model="state.client" class="w-full" />
      </UFormField>

      <!-- 4. Numéro de projet. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-3"
        :label="t('planning.editor.fields.project')"
        name="project"
      >
        <UInput v-model="state.project" class="w-full" />
      </UFormField>

      <!-- 5. Livraison. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-3"
        :label="t('planning.editor.fields.deliveryDate')"
        name="deliveryDate"
      >
        <UInput v-model="state.deliveryDate" class="w-full" type="date" />
      </UFormField>

      <!-- 6. Heure. Legal with no delivery date, per the write API; the row reads the time only when
              a date is present, so a stray time is inert rather than wrong. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-2"
        :label="t('planning.editor.fields.deliveryTime')"
        name="deliveryTime"
      >
        <UInput v-model="state.deliveryTime" class="w-full" type="time" />
      </UFormField>

      <!-- 7. Mots. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-3"
        :help="t('planning.editor.fields.wordsHint')"
        :label="t('planning.editor.fields.words')"
        name="projectWordCount"
      >
        <UInputNumber v-model="state.projectWordCount" class="w-full" :min="0" />
      </UFormField>

      <!-- 8. Durée estimée. It starts its own line on purpose. PLAN-12 will one day derive the
              estimate from the word count and the quota, and putting the two fields side by side is
              the cheapest way to imply an automatic calculation that does not exist. A hole to the
              right of Mots costs nothing and buys that. -->
      <!-- The pair is a `role="group"` named from the field's own label, so entering it announces
           `Durée estimée` and each box then announces `heures` or `minutes` inside it. Without the
           group the two boxes are two unrelated spin buttons, because an aria-label on a control wins
           over the field label and neither box would ever say which duration it belongs to. Each box
           also carries its own id: UFormField injects one generated id into every control inside it,
           so two number inputs in one field otherwise render the same id twice. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-12 @2xl/day:col-start-1 @4xl/day:col-span-4"
        name="estimatedMinutes"
      >
        <template #label>
          <span :id="estimatedLabelId">{{ t('planning.editor.fields.estimatedDuration') }}</span>
        </template>
        <div :aria-labelledby="estimatedLabelId" class="flex items-end gap-3" role="group">
          <div class="flex items-center gap-1.5">
            <UInputNumber
              :id="`${panelId}-estimated-hours`"
              v-model="estimated.hours"
              :aria-label="t('onboarding.work.hoursLabel')"
              class="w-24"
              :min="0"
            />
            <span class="text-sm text-muted">{{ t('onboarding.work.unitHours') }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <UInputNumber
              :id="`${panelId}-estimated-minutes`"
              v-model="estimated.minutes"
              :aria-label="t('onboarding.work.minutesLabel')"
              class="w-24"
              :min="0"
              :step="5"
            />
            <span class="text-sm text-muted">{{ t('onboarding.work.unitMinutes') }}</span>
          </div>
        </div>
      </UFormField>

      <!-- 9. Durée réelle. Visually identical to the field beside it, with nothing linking the two:
              two inputs of equal weight side by side is the layout that says two independent facts of
              the same kind, which is what they are. Typing one never changes the other. -->
      <UFormField class="col-span-12 @2xl/day:col-span-12 @4xl/day:col-span-4" name="actualMinutes">
        <template #label>
          <span :id="actualLabelId">{{ t('planning.editor.fields.actualDuration') }}</span>
        </template>
        <div :aria-labelledby="actualLabelId" class="flex items-end gap-3" role="group">
          <div class="flex items-center gap-1.5">
            <UInputNumber
              :id="`${panelId}-actual-hours`"
              v-model="actual.hours"
              :aria-label="t('onboarding.work.hoursLabel')"
              class="w-24"
              :min="0"
            />
            <span class="text-sm text-muted">{{ t('onboarding.work.unitHours') }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <UInputNumber
              :id="`${panelId}-actual-minutes`"
              v-model="actual.minutes"
              :aria-label="t('onboarding.work.minutesLabel')"
              class="w-24"
              :min="0"
              :step="5"
            />
            <span class="text-sm text-muted">{{ t('onboarding.work.unitMinutes') }}</span>
          </div>
        </div>
      </UFormField>

      <!-- 10. Statut. Disabled on a category that carries no status, with the reason under the
               control, and the payload omits the key entirely rather than sending null: the server
               clears the stored value itself as part of the same write, so there is one place that
               clears it.

               The rule is whether the category carries a status and never whether it is trackable.
               Those were one fact until `other` arrived, and `other` is the member where they differ:
               it is not trackable, so its words reach no quota, and it does carry a status, because it
               is real work of a kind the user did not name and marking it finished is the most ordinary
               thing they will want from it. The disabled state and the help line both read the one
               `deliverable` computed, so they move together and the control cannot say it is
               unavailable while accepting input. Half of that change would be worse than none of it:
               the help text rides `aria-describedby`, so it is announced and not merely visible, and a
               control that is announced as unavailable and then takes a value invites an action it
               will not honour. The displayed value reads the same shared contract function through
               `displayedStatus`, so all three agree without any of them copying a rule.

               The displayed value is derived rather than held, so it is always what will be stored. A
               category flip to a statusless member empties the control immediately rather than leaving
               it printing a value the same save is about to discard.

               The spec handed the accessibility stage the choice between this and `aria-disabled` on a
               readonly control, and `disabled` is what it settled on. Three reasons. A genuinely
               inactive control is exempt from 4.1.2 and 2.1.1, so skipping the tab order is not a
               failure. UFormField renders the hint as a real element after the control and
               `aria-describedby` links it, so both the state and the reason are in the accessibility
               tree and reachable in browse mode; only focus mode skips them, which is the accepted
               cost. And `aria-disabled` on a control that looks operable, takes focus, and then
               silently refuses input is the worse failure of the two: it invites an action and answers
               with nothing, which is the dead end the project's own conventions rule out. The state
               change is also caused by the user's own adjacent action on the category selector, so
               cause and effect sit two controls apart. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-4"
        :help="deliverable ? undefined : t('planning.editor.fields.statusUnavailable')"
        :label="t('planning.editor.fields.status')"
        name="status"
      >
        <USelect
          v-model="statusModel"
          class="w-full"
          :disabled="!deliverable"
          :items="statusItems"
          value-key="value"
        />
      </UFormField>

      <!-- 11. Quota. Shown for every category rather than hidden on some: nothing reads it on a
               non-trackable task, and hiding it would need the same two-part treatment the status
               gets for no gain. -->
      <UFormField
        class="col-span-12 @2xl/day:col-span-6 @4xl/day:col-span-3"
        :help="t('planning.editor.fields.quotaHint')"
        :hint="t('onboarding.work.unitWph')"
        :label="t('planning.editor.fields.quota')"
        name="quotaWphOverride"
      >
        <UInputNumber v-model="state.quotaWphOverride" class="w-full" :min="1" />
      </UFormField>

      <!-- 12. Exclure des stats. -->
      <UFormField class="col-span-12 @4xl/day:col-span-9" name="excludeFromStats">
        <USwitch
          v-model="state.excludeFromStats"
          :description="t('planning.editor.fields.excludeHint')"
          :label="t('planning.editor.fields.excludeFromStats')"
        />
      </UFormField>

      <!-- 13. Notes. The counter goes in the hint beside the label rather than under the control,
               because help is where a 422 lands and a counter competing with an error on one line is
               worse than either alone.

               The counter text is passed as the `hint` prop as well as rendered through the slot, and
               that is what puts it in the textarea's `aria-describedby`. Nuxt UI builds that list from
               the props it was given rather than from the slots that rendered, so a slot-only hint gets
               an id and is never referenced by anything, which leaves the bound discoverable only by
               reading around the field. The slot still draws it, so the text appears once. -->
      <UFormField
        class="col-span-12"
        :hint="notesCounterText"
        :label="t('planning.editor.fields.notes')"
        name="notes"
      >
        <template #hint>
          <span :class="notesCounterClass">{{ notesCounterText }}</span>
        </template>
        <UTextarea
          v-model="state.notes"
          class="w-full"
          :placeholder="t('planning.editor.fields.notesPlaceholder')"
          :rows="3"
        />
      </UFormField>
    </div>

    <!-- The footer. One message slot with four possible occupants, so there is one place on screen
         where the editor speaks. It sits under the fields and above the buttons rather than at the top
         of the panel, because the user's eye and the scroll position are both at the save control they
         just pressed. -->
    <div class="mt-4">
      <!-- The three alerts live inside one element that is always in the document and carries
           `role="alert"`, rather than each being an alert that appears. A live region has to exist
           before its content changes for the change to be announced, and a save that fails is
           otherwise completely silent: the panel does not move, focus stays on the control that was
           pressed, and only a sighted user learns anything. The spacing is on the alerts themselves
           rather than on this wrapper, so an empty wrapper adds no height and the resting layout is
           byte-for-byte what it was. -->
      <div role="alert">
        <UAlert
          v-if="alertKind === 'gone'"
          class="mb-3"
          color="warning"
          icon="i-ph-info"
          :title="t('planning.editor.gone')"
          variant="subtle"
        />

        <UAlert
          v-else-if="alertKind === 'session'"
          :actions="[
            {
              label: t('planning.editor.signInNewTab'),
              color: 'neutral',
              variant: 'outline',
              to: localePath('signin'),
              target: '_blank',
              rel: 'noopener noreferrer',
              trailingIcon: 'i-ph-arrow-square-out'
            },
            { label: t('planning.retry'), color: 'neutral', variant: 'outline', onClick: onRetry }
          ]"
          class="mb-3"
          color="error"
          icon="i-ph-warning-circle"
          :title="t('planning.editor.sessionExpired')"
          variant="subtle"
        />

        <UAlert
          v-else-if="alertKind === 'error'"
          :actions="
            canRetry
              ? [
                  {
                    label: t('planning.retry'),
                    color: 'neutral',
                    variant: 'outline',
                    onClick: onRetry
                  }
                ]
              : []
          "
          class="mb-3"
          color="error"
          :description="unmappedMessage ?? undefined"
          icon="i-ph-warning-circle"
          :title="t('planning.editor.saveError')"
          variant="subtle"
        />
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <!-- The quiet unsaved note. The element is always present and only its content changes, so the
             `role="status"` announces politely when the note appears; an element that appears carrying
             a live role is announced far less reliably. It replaces the empty span that used to hold
             the left end of the row open, so `justify-between` still pushes the buttons right when
             there is nothing to say. Polite and never focused, which is what the spec asks for: the
             user's click landed somewhere else on purpose and nothing may be taken away from them. -->
        <p
          class="inline-flex items-center gap-1.5 text-xs text-warning-800 dark:text-warning-400"
          role="status"
        >
          <template v-if="outsideWarning">
            <UIcon aria-hidden="true" class="size-4" name="i-ph-warning-circle" />
            {{ t('planning.editor.unsaved') }}
          </template>
        </p>

        <!-- The 404 is the one state that changes the controls rather than adding to them. A save
             button that retries a patch against a deleted row is a dead end dressed as an action, so
             the pair is replaced by the only two things the user can actually do. -->
        <div v-if="alertKind === 'gone'" class="flex items-center gap-2">
          <UButton
            color="neutral"
            :label="t('planning.editor.goneDiscard')"
            variant="ghost"
            @click="emit('closeRequest')"
          />
          <UButton
            color="primary"
            icon="i-ph-check-bold"
            :label="t('planning.editor.goneCreate')"
            :loading="saving"
            @click="onSaveAsNew"
          />
        </div>

        <div v-else class="flex items-center gap-2">
          <UButton
            color="neutral"
            :label="t('planning.editor.cancel')"
            variant="ghost"
            @click="emit('closeRequest')"
          />
          <!-- On an edit an enabled save button is the ambient unsaved affordance, which is why nothing
               else is added for it. On a draft it is enabled from the first paint, because there is
               always a task to create: the day came from the card and the category is already chosen,
               so nothing is left to wait for. It is never disabled for a missing category, since there
               is no such state. The loading state spans the write and the refresh that follows it, so
               the control is never dead and two rapid activations produce one request. -->
          <UButton
            color="primary"
            :disabled="!canSave"
            icon="i-ph-check-bold"
            :label="t('planning.editor.save')"
            :loading="saving"
            type="submit"
          />
        </div>
      </div>
    </div>
  </UForm>
</template>
