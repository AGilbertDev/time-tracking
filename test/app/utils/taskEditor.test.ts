import type { TaskEditorState } from '~~/app/utils/taskEditor'

import {
  buildCreatePayload,
  classifyTaskWriteError,
  diffEditorState,
  displayedStatus,
  emptyEditorState,
  isEditorDirty,
  isSameEditorTarget,
  TASK_FIELD_ERROR_KEYS,
  TASK_NOTES_MAX,
  TASK_TEXT_MAX,
  taskToEditorState
} from '~~/app/utils/taskEditor'
import en from '~~/i18n/locales/en.json'
import fr from '~~/i18n/locales/fr.json'
import { describe, expect, it } from 'vitest'

import type { PlanningTask } from '#shared/planning'

import { DEFAULT_CATEGORY_ID, DEFAULT_CATEGORY_IDS } from '#shared/categories'

// The pure half of the inline task editor: the state a form holds, the comparison that decides
// whether anything changed, the request body that comparison produces, and the lookup from a 422's
// field names to copy keys.
//
// Every case is derived from docs/specs/planning/task-inline-editor.md and each block cites the
// criterion it enforces. Nothing here reads the implementation as the statement of what is correct.
// The criteria covered are AC21, AC23, AC27, AC35, AC38, AC39, AC40, AC44, AC45, AC47, AC48, AC58,
// AC62 and the "Data and product edge cases" table.
//
// docs/specs/planning/other-category.md then added criteria of its own, numbered UC rather than AC
// because it landed on the same branch. The ones this file covers are UC25, UC38, UC39, UC40, UC41
// and UC45. Two of them are the reason `displayedStatus` exists and one is the reason the save
// control asks a different question from the discard logic.
//
// UC38 to UC41 close a defect the accessibility stage found. Flipping the pending category to one
// that carries no status left the disabled `Statut` control still printing the value it held, while
// the payload omitted `status` and the server cleared the stored value as part of the same write. So
// the screen said `Terminé`, the user pressed save, and the status was silently discarded by the
// user's own action two controls away. The invariant the fix is written to is that what the control
// shows is what will be stored, so every block below asserts the displayed value and the payload
// together rather than one of them at a time. A test that checked only the payload would have passed
// against the defect.
//
// The status question reads `isDeliverableCategory` and never `isTrackableCategory`, which UC41 asks
// for by name so that a later reader cannot restore the old guard and stay green. Those two were one
// function until `other` arrived. `other` is not trackable, so its words reach no quota, and it is
// deliverable, so it does carry a status. A guard reading trackability here would empty the control
// the moment the user chose `Autre`, which is a data-loss path rather than the defect being fixed.
//
// The diff is the highest-value unit in the feature because it is two things at once: the dirty
// verdict that enables the save control, and the body sent to the write endpoint. A field it wrongly
// includes overwrites data the user did not touch, and a field it wrongly drops silently discards an
// edit the user made and watched collapse as if saved.
//
// Two distinctions get asserted hard and in both directions, because a convenience coercion would
// erase either of them without changing anything on screen.
//
//   actualMinutes: null means never measured and falls back to the estimate, 0 means a measurement
//   that came out at zero and does not fall back.
//
//   projectWordCount: null means nobody entered a figure and the cell prints an em dash, 0 means
//   somebody entered zero and the cell prints 0.
//
// A patch is also partial, so an omitted key and an explicit null are two different instructions to
// a .strict() schema: absent leaves the column alone, null clears it. A cleared field therefore has
// to appear in the body carrying null rather than simply not appearing.

// A stored row as GET /api/tasks returns one. Every field is overridable so a case can state only
// what it is about. The defaults are deliberately the absent ones, since absence is what most of the
// interesting comparisons are made against.
function planningTask(overrides: Partial<PlanningTask> = {}): PlanningTask {
  return {
    actualMinutes: null,
    category: 'translation',
    client: null,
    date: '2026-07-20',
    deliverable: true,
    deliveryDate: null,
    deliveryTime: null,
    estimatedMinutes: null,
    excludeFromStats: false,
    id: 'task-1',
    notes: null,
    project: null,
    projectWordCount: null,
    quotaWphOverride: null,
    sortOrder: 0,
    splitGroupId: null,
    status: null,
    statusKey: 'na',
    trackable: true,
    ...overrides
  }
}

// A filled form for a trackable task, used as the baseline that changes are measured against.
function filledState(overrides: Partial<TaskEditorState> = {}): TaskEditorState {
  return {
    actualMinutes: 120,
    category: 'translation',
    client: 'Acme',
    date: '2026-07-20',
    deliveryDate: '2026-07-22',
    deliveryTime: '14:30',
    estimatedMinutes: 90,
    excludeFromStats: false,
    notes: 'Relire le glossaire.',
    project: 'P-1234',
    projectWordCount: 1200,
    quotaWphOverride: 500,
    status: 'Accepté',
    ...overrides
  }
}

describe('emptyEditorState', () => {
  // AC35: pressing the add control opens a draft with every field empty except the day, which is the
  // card's date, and the category, which is the shared default. AC21: an empty control rather than the
  // string 'null'.
  it('fills the day from the card and the category from the default, and leaves the rest empty', () => {
    expect(emptyEditorState('2026-07-22')).toEqual({
      actualMinutes: null,
      category: 'other',
      client: '',
      date: '2026-07-22',
      deliveryDate: '',
      deliveryTime: '',
      estimatedMinutes: null,
      excludeFromStats: false,
      notes: '',
      project: '',
      projectWordCount: null,
      quotaWphOverride: null,
      status: null
    })
  })

  // UC25: a draft opens on a real preselected category, so a save is never blocked by a dropdown the
  // user never opened. It reads the shared constant rather than the literal, because the fallback and
  // the create default are one declaration and a test that retyped the id would not notice it moving.
  it('preselects the shared default category', () => {
    expect(emptyEditorState('2026-07-22').category).toBe(DEFAULT_CATEGORY_ID)
  })

  // The switch is a boolean and never null, per the field table.
  it('starts the exclude-from-stats switch off rather than unset', () => {
    expect(emptyEditorState('2026-07-22').excludeFromStats).toBe(false)
  })

  // AC27 and AC3 at the point a draft begins. An empty duration box and an empty words box are
  // absences, not zeroes, so a draft saved without touching them records nothing rather than
  // recording a measurement of zero and a word count of zero.
  it('starts the durations and the word count absent rather than at zero', () => {
    const draft = emptyEditorState('2026-07-22')

    expect(draft.actualMinutes).toBeNull()
    expect(draft.estimatedMinutes).toBeNull()
    expect(draft.projectWordCount).toBeNull()
  })
})

describe('taskToEditorState', () => {
  // AC21: expanding a row prefills every field from the row, and a null contract field renders as an
  // empty control rather than as the string 'null'.
  it('prefills every field from the loaded row', () => {
    const state = taskToEditorState(
      planningTask({
        actualMinutes: 45,
        category: 'proofreading',
        client: 'Acme',
        date: '2026-07-21',
        deliveryDate: '2026-07-23',
        deliveryTime: '09:15',
        estimatedMinutes: 60,
        excludeFromStats: true,
        notes: 'ligne un\nligne deux',
        project: 'P-9',
        projectWordCount: 800,
        quotaWphOverride: 420,
        status: 'En cours'
      })
    )

    expect(state).toEqual({
      actualMinutes: 45,
      category: 'proofreading',
      client: 'Acme',
      date: '2026-07-21',
      deliveryDate: '2026-07-23',
      deliveryTime: '09:15',
      estimatedMinutes: 60,
      excludeFromStats: true,
      notes: 'ligne un\nligne deux',
      project: 'P-9',
      projectWordCount: 800,
      quotaWphOverride: 420,
      status: 'En cours'
    })
  })

  it('renders every null text and date field as an empty control', () => {
    const state = taskToEditorState(planningTask())

    expect(state.client).toBe('')
    expect(state.project).toBe('')
    expect(state.notes).toBe('')
    expect(state.deliveryDate).toBe('')
    expect(state.deliveryTime).toBe('')
  })

  it('renders no field as the string null', () => {
    const values = Object.values(taskToEditorState(planningTask()))

    expect(values).not.toContain('null')
  })

  // AC27: a null actual duration is an unmeasured one and has to stay null, since a 0 here would be
  // saved back as a measurement the user never made.
  it('keeps an unmeasured actual duration null rather than turning it into zero', () => {
    expect(taskToEditorState(planningTask({ actualMinutes: null })).actualMinutes).toBeNull()
  })

  it('keeps a measured zero as zero rather than turning it into an empty box', () => {
    expect(taskToEditorState(planningTask({ actualMinutes: 0 })).actualMinutes).toBe(0)
  })

  // AC3: zero is a figure the user entered, so it survives into the form as zero.
  it('keeps a stored word count of zero as zero rather than as an empty box', () => {
    expect(taskToEditorState(planningTask({ projectWordCount: 0 })).projectWordCount).toBe(0)
  })

  it('keeps an absent word count absent', () => {
    expect(taskToEditorState(planningTask({ projectWordCount: null })).projectWordCount).toBeNull()
  })

  it('keeps a stored estimate of zero as zero', () => {
    expect(taskToEditorState(planningTask({ estimatedMinutes: 0 })).estimatedMinutes).toBe(0)
  })

  it('keeps a quota override of zero as zero rather than as the default', () => {
    // The empty box is what means "your default quota", so a stored figure has to stay a figure.
    expect(taskToEditorState(planningTask({ quotaWphOverride: 0 })).quotaWphOverride).toBe(0)
  })

  // AC40: a row whose stored category is a retired id displays the coerced value, so the selector
  // shows a real category rather than nothing.
  it('displays a valid category for a row holding a retired id', () => {
    const state = taskToEditorState(planningTask({ category: 'revision' }))

    expect(state.category).not.toBe('revision')
    expect(DEFAULT_CATEGORY_IDS).toContain(state.category)
  })
})

// The five ids the spec says carry no status, listed from the spec's own sentence rather than read
// out of the contract module. A break, a meeting, administration, desktop publishing and terminology
// work are consumed time with no deliverable, so a status on one of them would contradict every other
// reading of the row. Reading the contract here instead would make this file agree with whatever the
// contract happens to say, which is the one thing a spec-derived test must not do.
const STATUSLESS_CATEGORIES = ['terminology', 'meetings', 'breaks', 'admin', 'dtp'] as const

// The five that do carry one, which is the four trackable ids plus `other`. The tenth member is the
// only one where this list and the trackable list differ, and it is why there are two lists.
const STATUS_CARRYING_CATEGORIES = [
  'translation',
  'revision_internal',
  'revision_external',
  'proofreading',
  'other'
] as const

const STORED_STATUSES = ['Accepté', 'En cours', 'Terminé'] as const

describe('displayedStatus', () => {
  // UC38: the control never shows a value the pending category cannot hold. Asserted over every
  // statusless category against every stored status, because the defect was one control printing a
  // value another control had just made impossible.
  it.each(
    STATUSLESS_CATEGORIES.flatMap((category) =>
      STORED_STATUSES.map((status) => [category, status] as const)
    )
  )('shows nothing for a %s task holding %s', (category, status) => {
    expect(displayedStatus(filledState({ category, status }))).toBeNull()
  })

  // UC39 and the other half of the invariant. A category that carries a status shows the value that
  // will be stored, so the field is not emptied for its own sake.
  it.each(
    STATUS_CARRYING_CATEGORIES.flatMap((category) =>
      STORED_STATUSES.map((status) => [category, status] as const)
    )
  )('shows %s for a %s task holding it', (category, status) => {
    expect(displayedStatus(filledState({ category, status }))).toBe(status)
  })

  // UC8 and the whole reason the two flags were pulled apart, stated on the display side. `Autre` is
  // real work of a kind the user did not name, so marking it finished is the most ordinary thing they
  // will want from it, and the control has to print what they set.
  it('shows a stored status on the tenth category, which is not trackable and does carry one', () => {
    expect(displayedStatus(filledState({ category: 'other', status: 'Terminé' }))).toBe('Terminé')
  })

  // The none state is a real value rather than an absence to be filled in, so a task carrying no
  // status shows none whichever category it holds.
  it.each([...STATUS_CARRYING_CATEGORIES, ...STATUSLESS_CATEGORIES])(
    'shows nothing for a %s task that holds no status',
    (category) => {
      expect(displayedStatus(filledState({ category, status: null }))).toBeNull()
    }
  )

  // UC38 says the clearing happens immediately and before any save, so the displayed value is a
  // function of what the form holds now rather than of anything a save decided. The same stored
  // status reads two ways depending only on the pending category, with no write in between.
  it('answers on the pending category alone, with no save involved', () => {
    const carrying = filledState({ category: 'translation', status: 'Terminé' })
    const statusless = { ...carrying, category: 'breaks' as const }

    expect(displayedStatus(carrying)).toBe('Terminé')
    expect(displayedStatus(statusless)).toBeNull()
  })

  // The property that makes UC39's round trip possible at all. The display is derived and the user's
  // choice survives underneath, so flipping to a statusless category does not spend the value. If this
  // cleared state.status instead, flipping back would come back empty and the round trip would report
  // itself as a change the user never made.
  it('leaves the form untouched, so the choice survives a flip to a statusless category', () => {
    const state = filledState({ category: 'breaks', status: 'Terminé' })
    const before = { ...state }

    displayedStatus(state)

    expect(state).toEqual(before)
    expect(state.status).toBe('Terminé')
  })

  // The fail-open direction, on the display side. A row holding a retired or hand-edited id coerces to
  // the tenth category, which carries a status, so a value the user deliberately recorded stays on
  // screen instead of being hidden behind a none state nobody asked for. This is the opposite
  // direction from the quota question on purpose, because the safer error here is the one that does
  // not misstate what the user stored.
  it('shows the stored status of a row holding a retired category id', () => {
    expect(displayedStatus(filledState({ category: 'revision', status: 'Terminé' }))).toBe(
      'Terminé'
    )
  })

  it('shows the stored status of a row holding a category id nothing recognises', () => {
    expect(displayedStatus(filledState({ category: 'ma-categorie', status: 'En cours' }))).toBe(
      'En cours'
    )
  })

  // A draft opens on the tenth category, which carries a status, so its `Statut` control is operable
  // from the first paint rather than disabled. UC26 states that as a visible change from every
  // previous state of this form.
  it('reports the none state rather than an unavailable one on a fresh draft', () => {
    expect(displayedStatus(emptyEditorState('2026-07-22'))).toBeNull()
  })
})

describe('diffEditorState', () => {
  describe('nothing changed', () => {
    // AC39: the save control is disabled when nothing has changed, so no empty PATCH is ever sent.
    it('finds nothing when the form still holds what was loaded', () => {
      const baseline = filledState()

      expect(diffEditorState(baseline, { ...baseline })).toEqual({})
    })

    it('finds nothing on a row where every field is absent', () => {
      const baseline = taskToEditorState(planningTask())

      expect(diffEditorState(baseline, { ...baseline })).toEqual({})
    })
  })

  describe('one field changed (AC38)', () => {
    it('sends exactly one key when only the client name changed', () => {
      const baseline = filledState()
      const payload = diffEditorState(baseline, { ...baseline, client: 'Globex' })

      expect(payload).toEqual({ client: 'Globex' })
      expect(Object.keys(payload)).toHaveLength(1)
    })

    // AC44: changing the day moves the row, and the day is the only thing that changed.
    it('sends exactly the day when only the day changed', () => {
      const baseline = filledState()
      const payload = diffEditorState(baseline, { ...baseline, date: '2026-07-23' })

      expect(payload).toEqual({ date: '2026-07-23' })
    })

    it.each([
      ['project', 'P-4321'],
      ['deliveryDate', '2026-07-30'],
      ['deliveryTime', '08:00'],
      ['notes', 'Nouvelle note.']
    ] as const)('sends exactly %s when only %s changed', (field, value) => {
      const baseline = filledState()
      const payload = diffEditorState(baseline, { ...baseline, [field]: value })

      expect(payload).toEqual({ [field]: value })
    })
  })

  describe('several fields changed', () => {
    it('sends every changed field and nothing else', () => {
      const baseline = filledState()
      const payload = diffEditorState(baseline, {
        ...baseline,
        client: 'Globex',
        estimatedMinutes: 150,
        excludeFromStats: true,
        notes: 'Autre note.'
      })

      expect(payload).toEqual({
        client: 'Globex',
        estimatedMinutes: 150,
        excludeFromStats: true,
        notes: 'Autre note.'
      })
    })
  })

  describe('a field cleared to empty', () => {
    // An absent key and an explicit null are two different instructions to a partial patch, so a
    // cleared field has to be in the body carrying null. Omitting it would leave the old value in
    // the column while the form showed an empty box.
    it.each(['client', 'project', 'notes', 'deliveryDate', 'deliveryTime'] as const)(
      'sends an explicit null for a cleared %s rather than omitting it',
      (field) => {
        const baseline = filledState()
        const payload = diffEditorState(baseline, { ...baseline, [field]: '' })

        expect(field in payload).toBe(true)
        expect(payload[field]).toBeNull()
      }
    )

    // The trim-and-empty-to-null rule: a field holding nothing but whitespace is a cleared field on
    // both sides of the boundary, so clearing it that way is the same instruction.
    it.each(['client', 'project', 'notes'] as const)(
      'treats a %s left holding only whitespace as cleared',
      (field) => {
        const baseline = filledState()
        const payload = diffEditorState(baseline, { ...baseline, [field]: '   \n  ' })

        expect(payload[field]).toBeNull()
      }
    )

    // AC27: clearing Durée réelle sends null so the row falls back to the estimate again.
    it('sends an explicit null for a cleared actual duration', () => {
      const baseline = filledState({ actualMinutes: 120 })
      const payload = diffEditorState(baseline, { ...baseline, actualMinutes: null })

      expect('actualMinutes' in payload).toBe(true)
      expect(payload.actualMinutes).toBeNull()
    })

    it.each(['estimatedMinutes', 'projectWordCount', 'quotaWphOverride'] as const)(
      'sends an explicit null for a cleared %s',
      (field) => {
        const baseline = filledState()
        const payload = diffEditorState(baseline, { ...baseline, [field]: null })

        expect(field in payload).toBe(true)
        expect(payload[field]).toBeNull()
      }
    )
  })

  describe('a field set from absent to a value', () => {
    it.each(['client', 'project', 'notes', 'deliveryDate'] as const)(
      'sends %s when it was empty and now holds a value',
      (field) => {
        const baseline = taskToEditorState(planningTask())
        const payload = diffEditorState(baseline, { ...baseline, [field]: 'x' })

        expect(payload[field]).toBe('x')
      }
    )

    it('trims a value typed into an empty field before sending it', () => {
      const baseline = taskToEditorState(planningTask())
      const payload = diffEditorState(baseline, { ...baseline, client: '  Acme  ' })

      expect(payload.client).toBe('Acme')
    })

    it('sends a duration typed into an unmeasured field', () => {
      const baseline = taskToEditorState(planningTask({ actualMinutes: null }))
      const payload = diffEditorState(baseline, { ...baseline, actualMinutes: 75 })

      expect(payload).toEqual({ actualMinutes: 75 })
    })
  })

  describe('whitespace-only edits are not changes (AC62)', () => {
    it('finds nothing when a value differs only by surrounding whitespace', () => {
      const baseline = filledState({ client: 'Acme' })

      expect(diffEditorState(baseline, { ...baseline, client: '  Acme  ' })).toEqual({})
    })

    it('finds nothing when a space is typed into an empty field and the field was already empty', () => {
      const baseline = filledState({ client: '' })

      expect(diffEditorState(baseline, { ...baseline, client: ' ' })).toEqual({})
    })

    it('finds nothing when an already-absent field is filled with whitespace', () => {
      const baseline = taskToEditorState(planningTask({ notes: null }))

      expect(diffEditorState(baseline, { ...baseline, notes: '\n\t  ' })).toEqual({})
    })

    it('keeps the newlines inside a multiline note, since only the ends are trimmed', () => {
      const baseline = taskToEditorState(planningTask({ notes: null }))
      const payload = diffEditorState(baseline, {
        ...baseline,
        notes: '  ligne un\nligne deux  '
      })

      expect(payload.notes).toBe('ligne un\nligne deux')
    })

    it('finds nothing when a multiline note gains only surrounding whitespace', () => {
      const baseline = filledState({ notes: 'ligne un\nligne deux' })

      expect(
        diffEditorState(baseline, { ...baseline, notes: '  ligne un\nligne deux \n' })
      ).toEqual({})
    })
  })

  describe('a cleared value against a zero value (AC27, AC62)', () => {
    // The one distinction most easily erased by a helpful coercion, asserted in both directions at
    // the boundary the patch body crosses. A `|| 0`, a falsy check, or a Number('') anywhere in this
    // chain would make one of these four cases wrong while everything on screen still looked right.
    it('sends zero when an unmeasured duration is set to a measured zero', () => {
      const baseline = filledState({ actualMinutes: null })
      const payload = diffEditorState(baseline, { ...baseline, actualMinutes: 0 })

      expect('actualMinutes' in payload).toBe(true)
      expect(payload.actualMinutes).toBe(0)
      expect(payload.actualMinutes).not.toBeNull()
    })

    it('sends null when a measured zero is cleared back to unmeasured', () => {
      const baseline = filledState({ actualMinutes: 0 })
      const payload = diffEditorState(baseline, { ...baseline, actualMinutes: null })

      expect('actualMinutes' in payload).toBe(true)
      expect(payload.actualMinutes).toBeNull()
      expect(payload.actualMinutes).not.toBe(0)
    })

    it('finds no change between one unmeasured duration and another', () => {
      const baseline = filledState({ actualMinutes: null })

      expect(diffEditorState(baseline, { ...baseline, actualMinutes: null })).toEqual({})
    })

    it('finds no change between one measured zero and another', () => {
      const baseline = filledState({ actualMinutes: 0 })

      expect(diffEditorState(baseline, { ...baseline, actualMinutes: 0 })).toEqual({})
    })

    it('reports a measured zero as a change from unmeasured, so the save control enables', () => {
      const baseline = filledState({ actualMinutes: null })

      expect(isEditorDirty(baseline, { ...baseline, actualMinutes: 0 })).toBe(true)
    })

    it('reports clearing a measured zero as a change, so the way back to unmeasured exists', () => {
      const baseline = filledState({ actualMinutes: 0 })

      expect(isEditorDirty(baseline, { ...baseline, actualMinutes: null })).toBe(true)
    })

    // AC3 says a stored zero word count prints 0 because zero is a figure somebody entered, so the
    // same distinction has to survive the write path that puts it there.
    it('sends zero when an absent word count is set to zero', () => {
      const baseline = filledState({ projectWordCount: null })
      const payload = diffEditorState(baseline, { ...baseline, projectWordCount: 0 })

      expect('projectWordCount' in payload).toBe(true)
      expect(payload.projectWordCount).toBe(0)
      expect(payload.projectWordCount).not.toBeNull()
    })

    it('sends null when a word count of zero is cleared', () => {
      const baseline = filledState({ projectWordCount: 0 })
      const payload = diffEditorState(baseline, { ...baseline, projectWordCount: null })

      expect('projectWordCount' in payload).toBe(true)
      expect(payload.projectWordCount).toBeNull()
    })

    it('finds no change between one absent word count and another', () => {
      const baseline = filledState({ projectWordCount: null })

      expect(diffEditorState(baseline, { ...baseline, projectWordCount: null })).toEqual({})
    })

    it('finds no change between one word count of zero and another', () => {
      const baseline = filledState({ projectWordCount: 0 })

      expect(diffEditorState(baseline, { ...baseline, projectWordCount: 0 })).toEqual({})
    })

    it('keeps an estimate of zero apart from an absent estimate', () => {
      const absent = filledState({ estimatedMinutes: null })
      const zero = filledState({ estimatedMinutes: 0 })

      expect(diffEditorState(absent, zero).estimatedMinutes).toBe(0)
      expect(diffEditorState(zero, absent).estimatedMinutes).toBeNull()
    })

    it('never treats an empty text field as a zero', () => {
      // '' normalizes to null and not to 0, so a cleared box can never be stored as a figure.
      const baseline = filledState({ client: 'Acme' })

      expect(diffEditorState(baseline, { ...baseline, client: '' }).client).toBeNull()
      expect(diffEditorState(baseline, { ...baseline, client: '' }).client).not.toBe(0)
    })
  })

  describe('the exclude-from-stats switch', () => {
    it('sends true when the switch is turned on', () => {
      const baseline = filledState({ excludeFromStats: false })

      expect(diffEditorState(baseline, { ...baseline, excludeFromStats: true })).toEqual({
        excludeFromStats: true
      })
    })

    // An explicit false has to be sent rather than dropped as a falsy value, or turning the switch
    // back off would silently do nothing.
    it('sends an explicit false when the switch is turned off', () => {
      const baseline = filledState({ excludeFromStats: true })
      const payload = diffEditorState(baseline, { ...baseline, excludeFromStats: false })

      expect('excludeFromStats' in payload).toBe(true)
      expect(payload.excludeFromStats).toBe(false)
    })
  })

  describe('the category (AC40)', () => {
    it('sends no category when the selection matches what was loaded', () => {
      const baseline = filledState({ category: 'translation' })
      const payload = diffEditorState(baseline, { ...baseline, client: 'Globex' })

      expect('category' in payload).toBe(false)
    })

    it('sends the picked category when the selection changes', () => {
      const baseline = filledState({ category: 'translation' })
      const payload = diffEditorState(baseline, { ...baseline, category: 'proofreading' })

      expect(payload.category).toBe('proofreading')
    })

    // A row left holding a retired id has to stay patchable, and the strict enum on the write
    // boundary would refuse the stale id. Editing another field therefore carries no category key.
    it('leaves a retired category out of the body when the user edits another field', () => {
      const baseline = taskToEditorState(planningTask({ category: 'revision' }))
      const payload = diffEditorState(baseline, { ...baseline, client: 'Globex' })

      expect('category' in payload).toBe(false)
      expect(payload).toEqual({ client: 'Globex' })
    })

    it('repairs a retired category when the user actually picks one', () => {
      const baseline = taskToEditorState(planningTask({ category: 'revision' }))
      const payload = diffEditorState(baseline, { ...baseline, category: 'translation' })

      expect(payload.category).toBe('translation')
    })

    // A selector the user never opened is not a change, so an edit to another field on a draft names
    // no category. buildCreatePayload states it separately, which is what puts it in a create body.
    it('finds no category change while the preselected one is untouched', () => {
      const baseline = emptyEditorState('2026-07-22')
      const payload = diffEditorState(baseline, { ...baseline, client: 'Acme' })

      expect('category' in payload).toBe(false)
    })
  })

  describe('the status against the pending category (AC23)', () => {
    it('sends the picked status on a trackable category', () => {
      const baseline = filledState({ category: 'translation', status: 'Accepté' })
      const payload = diffEditorState(baseline, { ...baseline, status: 'Terminé' })

      expect(payload).toEqual({ status: 'Terminé' })
    })

    // The Aucun option means null, and a partial patch needs the explicit null to clear the column.
    it('sends an explicit null when the status is set to none on a trackable category', () => {
      const baseline = filledState({ category: 'translation', status: 'En cours' })
      const payload = diffEditorState(baseline, { ...baseline, status: null })

      expect('status' in payload).toBe(true)
      expect(payload.status).toBeNull()
    })

    // AC23: the resulting request body contains no status key at all. The server clears the stored
    // value itself as part of the same write, so there is one place that clears it.
    it('omits the status entirely when the pending category carries none', () => {
      const baseline = filledState({ category: 'translation', status: 'Terminé' })
      const payload = diffEditorState(baseline, {
        ...baseline,
        category: 'meetings',
        status: null
      })

      expect(payload).toEqual({ category: 'meetings' })
      expect('status' in payload).toBe(false)
    })

    it('omits the status even when the form still holds one under a non-trackable selection', () => {
      const baseline = filledState({ category: 'translation', status: 'Accepté' })
      const payload = diffEditorState(baseline, {
        ...baseline,
        category: 'breaks',
        status: 'Terminé'
      })

      expect('status' in payload).toBe(false)
    })

    // The pending selection decides, not the row's stored category, because the selection can differ
    // from what is stored before any save.
    it('sends the status when the pending selection is trackable and the stored one was not', () => {
      const baseline = taskToEditorState(planningTask({ category: 'meetings', status: null }))
      const payload = diffEditorState(baseline, {
        ...baseline,
        category: 'translation',
        status: 'Accepté'
      })

      expect(payload).toEqual({ category: 'translation', status: 'Accepté' })
    })

    // The "unchanged non-trackable row that still holds a stored status" edge case: the form omits
    // status, nothing else changed, so the save control stays disabled and the row keeps its value.
    it('finds nothing on an untouched non-trackable row that still holds a stored status', () => {
      const baseline = taskToEditorState(
        planningTask({ category: 'meetings', status: 'Accepté', trackable: false })
      )

      expect(diffEditorState(baseline, { ...baseline })).toEqual({})
      expect(isEditorDirty(baseline, { ...baseline })).toBe(false)
    })
  })

  describe('the product edge cases the editor must not police', () => {
    // A word count on a non-trackable task is allowed and stored. Blanking it would be the app
    // deciding what the user may record.
    it('sends a word count on a non-trackable category', () => {
      const baseline = taskToEditorState(planningTask({ category: 'meetings' }))
      const payload = diffEditorState(baseline, { ...baseline, projectWordCount: 300 })

      expect(payload).toEqual({ projectWordCount: 300 })
    })

    it('sends a quota override on a non-trackable category', () => {
      const baseline = taskToEditorState(planningTask({ category: 'breaks' }))
      const payload = diffEditorState(baseline, { ...baseline, quotaWphOverride: 600 })

      expect(payload).toEqual({ quotaWphOverride: 600 })
    })

    // A delivery time with no delivery date is legal and stored, per the write API.
    it('sends a delivery time with no delivery date', () => {
      const baseline = taskToEditorState(planningTask())
      const payload = diffEditorState(baseline, { ...baseline, deliveryTime: '17:00' })

      expect(payload).toEqual({ deliveryTime: '17:00' })
    })

    // A delivery date before the task's own day is allowed, and the row reads as late, which is the
    // correct signal rather than something to refuse.
    it('sends a delivery date that falls before the task day', () => {
      const baseline = taskToEditorState(planningTask({ date: '2026-07-20' }))
      const payload = diffEditorState(baseline, { ...baseline, deliveryDate: '2026-07-18' })

      expect(payload).toEqual({ deliveryDate: '2026-07-18' })
    })

    // Nothing reformats or refuses what the user writes in Notes.
    it('sends a note unchanged apart from its outer whitespace', () => {
      const baseline = taskToEditorState(planningTask())
      const long = 'a'.repeat(TASK_NOTES_MAX)
      const payload = diffEditorState(baseline, { ...baseline, notes: long })

      expect(payload.notes).toBe(long)
    })
  })
})

// UC41 asks for all four category transitions to be covered with the displayed value and the payload
// asserted each time, which is what makes this its own block rather than a few more cases inside the
// two blocks above. The pairing is the point. The defect these criteria close was exactly a
// disagreement between the two, so an assertion about one of them alone cannot see it.
describe('a category flip changes the display and the payload together (UC38 to UC41)', () => {
  // Transition one, from a category that carries a status to one that does not. The display clears
  // immediately per UC38, and per UC40 the payload carries exactly one key, the category, because the
  // server clears the stored status itself as part of the same write.
  it('clears the display and sends only the category, from a status-carrying id to a statusless one', () => {
    const baseline = filledState({ category: 'translation', status: 'Terminé' })
    const current = { ...baseline, category: 'breaks' as const }

    expect(displayedStatus(current)).toBeNull()
    expect(diffEditorState(baseline, current)).toEqual({ category: 'breaks' })
    expect(Object.keys(diffEditorState(baseline, current))).toHaveLength(1)
  })

  // Transition two, back again. UC39: the display restores the value that will still be stored, which
  // is the loaded row's status when the user chose nothing else, and the round trip leaves the row
  // unchanged so the save control goes back to disabled.
  it('restores the display and reports no change, on the way back to a status-carrying id', () => {
    const baseline = filledState({ category: 'translation', status: 'Terminé' })
    const flipped = { ...baseline, category: 'breaks' as const }
    const returned = { ...flipped, category: 'translation' as const }

    expect(displayedStatus(returned)).toBe('Terminé')
    expect(diffEditorState(baseline, returned)).toEqual({})
    expect(isEditorDirty(baseline, returned)).toBe(false)
  })

  // Transition three, from the tenth category to a trackable one. Both carry a status, so nothing
  // clears and the status is not resent, because the user did not touch it. The row's words start
  // counting toward the quota and nothing warns, since classifying a row later is the workflow the
  // default exists to allow.
  it('keeps the display and sends only the category, from other to a trackable id', () => {
    const baseline = filledState({ category: 'other', status: 'En cours' })
    const current = { ...baseline, category: 'translation' as const }

    expect(displayedStatus(current)).toBe('En cours')
    expect(diffEditorState(baseline, current)).toEqual({ category: 'translation' })
  })

  // Transition four, back to the tenth category. Still no clearing in either direction, which is the
  // half a guard keyed on trackability would get wrong. `other` is not trackable, so such a guard
  // would empty the control and drop the status from the payload on a write the user made for another
  // reason entirely.
  it('keeps the display and sends only the category, from a trackable id back to other', () => {
    const baseline = filledState({ category: 'translation', status: 'En cours' })
    const current = { ...baseline, category: 'other' as const }

    expect(displayedStatus(current)).toBe('En cours')
    expect(diffEditorState(baseline, current)).toEqual({ category: 'other' })
    expect('status' in diffEditorState(baseline, current)).toBe(false)
  })

  // The screen and the row agree at every point, which is the invariant rather than a fifth
  // transition. A status the user sets under the tenth category is both displayed and sent, so the
  // save honours what the field printed.
  it('displays and sends a status set under the tenth category', () => {
    const baseline = filledState({ category: 'other', status: null })
    const current = { ...baseline, status: 'Terminé' as const }

    expect(displayedStatus(current)).toBe('Terminé')
    expect(diffEditorState(baseline, current)).toEqual({ status: 'Terminé' })
  })

  // And the same invariant from the failing side. Whatever the pending category, the payload may never
  // carry a status the control refuses to show, because that is the exact shape of the defect. Checked
  // across every category so a single member drifting is caught rather than only the two the
  // transitions above happen to name.
  it.each([...STATUS_CARRYING_CATEGORIES, ...STATUSLESS_CATEGORIES])(
    'never sends a status the control hides, on a %s task',
    (category) => {
      const baseline = filledState({ category: 'translation', status: 'Accepté' })
      const current = { ...baseline, category, status: 'Terminé' as const }
      const payload = diffEditorState(baseline, current)

      if (displayedStatus(current) === null) {
        expect('status' in payload).toBe(false)
      } else {
        expect(payload.status).toBe(displayedStatus(current))
      }
    }
  )
})

describe('isEditorDirty', () => {
  // AC39: the verdict reads the same comparison the patch body comes from, so the save control can
  // never be enabled with nothing to send, and never disabled with something to send.
  it('reports a clean editor as clean', () => {
    const baseline = filledState()

    expect(isEditorDirty(baseline, { ...baseline })).toBe(false)
  })

  it('reports a changed field as dirty', () => {
    const baseline = filledState()

    expect(isEditorDirty(baseline, { ...baseline, client: 'Globex' })).toBe(true)
  })

  // "Dirty means at least one field differs on the normalized value, so typing a space and deleting
  // it is not dirty."
  it('reports a whitespace-only difference as clean', () => {
    const baseline = filledState({ client: 'Acme' })

    expect(isEditorDirty(baseline, { ...baseline, client: '  Acme  ' })).toBe(false)
  })

  it('agrees with the patch body on every case it is asked about', () => {
    const baseline = filledState()
    const cases: TaskEditorState[] = [
      { ...baseline },
      { ...baseline, client: 'Globex' },
      { ...baseline, client: '  Acme  ' },
      { ...baseline, actualMinutes: 0 },
      { ...baseline, actualMinutes: null },
      { ...baseline, category: 'meetings', status: null },
      { ...baseline, notes: '' }
    ]

    for (const current of cases) {
      const hasChanges = Object.keys(diffEditorState(baseline, current)).length > 0
      expect(isEditorDirty(baseline, current)).toBe(hasChanges)
    }
  })
})

// UC45, the half of the split save-enabled condition that lives in a pure module. An edit is saveable
// only when the diff is non-empty, and a draft is saveable from the moment it opens because a day and
// a defaulted category are already a legal create. `dirty` cannot express the second, since an
// untouched draft is not dirty, so the condition is two conditions rather than one.
//
// The obvious simplification is to make a bare draft report itself dirty, and it is wrong in a way
// that costs the user rather than the code. The page reads dirtiness for the discard confirmation, so
// a mis-clicked add control followed by a click outside would then cost a prompt for work nobody did.
// The three properties below are what that simplification would break, and the third is the one it
// would break silently.
describe('the split save-enabled condition (UC45)', () => {
  // An edit waits for a change. This is the condition the write API's refusal of an empty patch
  // requires, and it is unchanged by the split.
  it('reports an untouched edit as having nothing to send', () => {
    const baseline = filledState()

    expect(diffEditorState(baseline, { ...baseline })).toEqual({})
    expect(isEditorDirty(baseline, { ...baseline })).toBe(false)
  })

  // A draft always has something legal to send, which is the property that lets its save control be
  // enabled from the first paint. The body is a real create rather than an empty object, so pressing
  // add and then save immediately records one task holding its day and the preselected category.
  it('gives an untouched draft a legal create body with nothing typed into it', () => {
    const draft = emptyEditorState('2026-07-22')
    const payload = buildCreatePayload(draft)

    expect(Object.keys(payload).length).toBeGreaterThan(0)
    expect(payload).toEqual({ category: DEFAULT_CATEGORY_ID, date: '2026-07-22' })
  })

  // And the property the naive fix would break. An untouched draft is clean, so cancelling one,
  // clicking outside it, collapsing its day card or switching the week closes it with no discard
  // confirmation and writes nothing. Dirtiness keeps meaning what its name says, which is that the
  // user typed something.
  it('reports an untouched draft as clean, so closing it costs no discard confirmation', () => {
    const draft = emptyEditorState('2026-07-22')

    expect(isEditorDirty(draft, { ...draft })).toBe(false)
    expect(diffEditorState(draft, { ...draft })).toEqual({})
  })

  // The two conditions are therefore genuinely different answers on the same state rather than one
  // answer under two names, which is the thing a later reader collapsing them would remove. A draft
  // has something to send and is still clean, and no single boolean says both.
  it('has a draft that is clean and still has something to send, which one condition cannot say', () => {
    const draft = emptyEditorState('2026-07-22')

    expect(isEditorDirty(draft, { ...draft })).toBe(false)
    expect(Object.keys(buildCreatePayload(draft)).length).toBeGreaterThan(0)
  })

  // A draft the user typed into is dirty and behaves exactly as the editor spec's recovery table says,
  // so the discard confirmation still fires on work that exists.
  it('reports a draft the user typed into as dirty', () => {
    const draft = emptyEditorState('2026-07-22')

    expect(isEditorDirty(draft, { ...draft, client: 'Acme' })).toBe(true)
  })

  // Touching the preselected category is not typing, because the value is already the one the save
  // would send. The user has to change something for the draft to become dirty, which is what keeps a
  // mis-clicked add from costing a prompt even after the selector has been opened and closed again.
  it('leaves a draft clean when the category is set to the value it already held', () => {
    const draft = emptyEditorState('2026-07-22')

    expect(isEditorDirty(draft, { ...draft, category: DEFAULT_CATEGORY_ID })).toBe(false)
  })

  // A create is never blocked by a dropdown nobody touched, which is the other half of why the split
  // was needed. Every category produces a legal body from a draft with nothing else filled in.
  it.each([...STATUS_CARRYING_CATEGORIES, ...STATUSLESS_CATEGORIES])(
    'gives a draft on %s a legal create body with nothing else filled in',
    (category) => {
      const payload = buildCreatePayload({ ...emptyEditorState('2026-07-22'), category })

      expect(payload).toEqual({ category, date: '2026-07-22' })
    }
  )
})

describe('buildCreatePayload', () => {
  // AC45: a draft with only a category and a day saves successfully, which is the smallest legal add
  // and is what recording a break costs.
  it('sends exactly the day and the category for the smallest legal draft', () => {
    const draft: TaskEditorState = { ...emptyEditorState('2026-07-22'), category: 'breaks' }

    expect(buildCreatePayload(draft)).toEqual({ category: 'breaks', date: '2026-07-22' })
  })

  it('always carries the day, since the create schema requires it', () => {
    const draft: TaskEditorState = { ...emptyEditorState('2026-07-22'), category: 'translation' }

    expect(buildCreatePayload(draft).date).toBe('2026-07-22')
  })

  // A field the user left alone is absent rather than sent as null, so a create body says only what
  // the user actually filled.
  it('omits every field the user left empty rather than sending nulls', () => {
    const draft: TaskEditorState = { ...emptyEditorState('2026-07-22'), category: 'translation' }
    const payload = buildCreatePayload(draft)

    for (const field of [
      'actualMinutes',
      'client',
      'deliveryDate',
      'deliveryTime',
      'estimatedMinutes',
      'excludeFromStats',
      'notes',
      'project',
      'projectWordCount',
      'quotaWphOverride',
      'status'
    ]) {
      expect(field in payload).toBe(false)
    }
  })

  it('sends every field the user filled', () => {
    const draft: TaskEditorState = {
      actualMinutes: 30,
      category: 'translation',
      client: 'Acme',
      date: '2026-07-22',
      deliveryDate: '2026-07-24',
      deliveryTime: '11:00',
      estimatedMinutes: 60,
      excludeFromStats: true,
      notes: 'Note.',
      project: 'P-77',
      projectWordCount: 900,
      quotaWphOverride: 480,
      status: 'Accepté'
    }

    expect(buildCreatePayload(draft)).toEqual({
      actualMinutes: 30,
      category: 'translation',
      client: 'Acme',
      date: '2026-07-22',
      deliveryDate: '2026-07-24',
      deliveryTime: '11:00',
      estimatedMinutes: 60,
      excludeFromStats: true,
      notes: 'Note.',
      project: 'P-77',
      projectWordCount: 900,
      quotaWphOverride: 480,
      status: 'Accepté'
    })
  })

  // AC27 at the create boundary. A measurement of zero typed into a new task is real data and has to
  // reach the server as 0, where an untouched box has to stay out of the body entirely.
  it('sends a typed zero duration on a draft', () => {
    const draft: TaskEditorState = {
      ...emptyEditorState('2026-07-22'),
      actualMinutes: 0,
      category: 'translation'
    }
    const payload = buildCreatePayload(draft)

    expect('actualMinutes' in payload).toBe(true)
    expect(payload.actualMinutes).toBe(0)
  })

  it('omits an untouched duration on a draft rather than sending zero', () => {
    const draft: TaskEditorState = { ...emptyEditorState('2026-07-22'), category: 'translation' }

    expect('actualMinutes' in buildCreatePayload(draft)).toBe(false)
  })

  // AC3: zero is a figure somebody entered, so a draft that says zero words says zero words.
  it('sends a typed zero word count on a draft', () => {
    const draft: TaskEditorState = {
      ...emptyEditorState('2026-07-22'),
      category: 'translation',
      projectWordCount: 0
    }
    const payload = buildCreatePayload(draft)

    expect('projectWordCount' in payload).toBe(true)
    expect(payload.projectWordCount).toBe(0)
  })

  // UC25: pressing the add control and then save immediately records one task holding its day and the
  // preselected category, so the smallest legal add is a day and nothing else has to be touched.
  it('carries the preselected category on a draft nobody touched', () => {
    const payload = buildCreatePayload(emptyEditorState('2026-07-22'))

    expect(payload).toEqual({ category: DEFAULT_CATEGORY_ID, date: '2026-07-22' })
  })

  // AC23 on a create as well as on an edit.
  it('omits the status on a draft whose category carries none', () => {
    const draft: TaskEditorState = {
      ...emptyEditorState('2026-07-22'),
      category: 'meetings',
      status: 'Accepté'
    }

    expect('status' in buildCreatePayload(draft)).toBe(false)
  })

  it('omits a note the user only typed whitespace into', () => {
    const draft: TaskEditorState = {
      ...emptyEditorState('2026-07-22'),
      category: 'translation',
      notes: '   \n '
    }

    expect('notes' in buildCreatePayload(draft)).toBe(false)
  })

  it('trims a filled text field on a create the same way an edit does', () => {
    const draft: TaskEditorState = {
      ...emptyEditorState('2026-07-22'),
      category: 'translation',
      client: '  Acme  '
    }

    expect(buildCreatePayload(draft).client).toBe('Acme')
  })
})

describe('isSameEditorTarget', () => {
  // AC48: exactly one editor is open across the whole week, so the page has to be able to tell
  // whether the row being pressed is the one already open.
  it('reports the same task id as the same editor', () => {
    expect(
      isSameEditorTarget(
        { date: '2026-07-20', kind: 'edit', taskId: 'task-1' },
        { date: '2026-07-20', kind: 'edit', taskId: 'task-1' }
      )
    ).toBe(true)
  })

  it('reports two different task ids as different editors', () => {
    expect(
      isSameEditorTarget(
        { date: '2026-07-20', kind: 'edit', taskId: 'task-1' },
        { date: '2026-07-20', kind: 'edit', taskId: 'task-2' }
      )
    ).toBe(false)
  })

  // AC44 lets a save move a row to another day, so an edit is identified by its task rather than by
  // the day the row happens to sit on.
  it('identifies an edit by its task id rather than by its day', () => {
    expect(
      isSameEditorTarget(
        { date: '2026-07-20', kind: 'edit', taskId: 'task-1' },
        { date: '2026-07-23', kind: 'edit', taskId: 'task-1' }
      )
    ).toBe(true)
  })

  it('reports two drafts on the same day as the same editor', () => {
    expect(
      isSameEditorTarget(
        { date: '2026-07-20', kind: 'draft' },
        { date: '2026-07-20', kind: 'draft' }
      )
    ).toBe(true)
  })

  it('reports drafts on different days as different editors', () => {
    expect(
      isSameEditorTarget(
        { date: '2026-07-20', kind: 'draft' },
        { date: '2026-07-21', kind: 'draft' }
      )
    ).toBe(false)
  })

  it('never confuses a draft with an edit, even on the same day', () => {
    expect(
      isSameEditorTarget(
        { date: '2026-07-20', kind: 'draft' },
        { date: '2026-07-20', kind: 'edit', taskId: 'task-1' }
      )
    ).toBe(false)
  })

  it('reports nothing open as the same as nothing else', () => {
    expect(isSameEditorTarget(null, { date: '2026-07-20', kind: 'draft' })).toBe(false)
    expect(isSameEditorTarget({ date: '2026-07-20', kind: 'draft' }, null)).toBe(false)
    expect(isSameEditorTarget(null, null)).toBe(false)
  })
})

describe('the two free-text bounds', () => {
  // The spec states both figures, and the editor reads them from the contract layer so its counter
  // and its {max} copy quote the number the write boundary actually enforces.
  it('is 200 characters for the one-line identity fields', () => {
    expect(TASK_TEXT_MAX).toBe(200)
  })

  it('is 2000 characters for a note', () => {
    expect(TASK_NOTES_MAX).toBe(2000)
  })

  // They are separate constants so that tightening a client name never tightens a note.
  it('keeps the two bounds separate', () => {
    expect(TASK_NOTES_MAX).not.toBe(TASK_TEXT_MAX)
  })
})

describe('TASK_FIELD_ERROR_KEYS', () => {
  // AC58 and the validation table under Copy: the 422 mapping is a lookup from the data key, and the
  // client renders its own message rather than the server's developer-facing English.
  it.each([
    ['date', 'planning.editor.validation.dayInvalid'],
    ['client', 'planning.editor.validation.textTooLong'],
    ['project', 'planning.editor.validation.textTooLong'],
    ['deliveryDate', 'planning.editor.validation.deliveryDateInvalid'],
    ['deliveryTime', 'planning.editor.validation.timeInvalid'],
    ['projectWordCount', 'planning.editor.validation.wordsInvalid'],
    ['estimatedMinutes', 'planning.editor.validation.durationInvalid'],
    ['actualMinutes', 'planning.editor.validation.durationInvalid'],
    ['quotaWphOverride', 'planning.editor.validation.quotaInvalid'],
    ['status', 'planning.editor.validation.statusNotDeliverable'],
    ['notes', 'planning.editor.validation.notesTooLong'],
    ['category', 'planning.editor.validation.invalid']
  ])('maps the %s key to %s', (field, key) => {
    expect(TASK_FIELD_ERROR_KEYS[field]).toBe(key)
  })

  it('maps the spec table and nothing else', () => {
    expect(Object.keys(TASK_FIELD_ERROR_KEYS).sort()).toEqual([
      'actualMinutes',
      'category',
      'client',
      'date',
      'deliveryDate',
      'deliveryTime',
      'estimatedMinutes',
      'notes',
      'project',
      'projectWordCount',
      'quotaWphOverride',
      'status'
    ])
  })

  // AC47: an unrecognised key and a _form key both surface a form-level message, so neither is in
  // the per-field lookup.
  it('has no entry for _form, which belongs to the body as a whole', () => {
    expect(TASK_FIELD_ERROR_KEYS._form).toBeUndefined()
  })

  it('has no entry for a key a later schema might add', () => {
    expect(TASK_FIELD_ERROR_KEYS.wordsDone).toBeUndefined()
    expect(TASK_FIELD_ERROR_KEYS.somethingNew).toBeUndefined()
  })

  // AC56: every string the editor shows exists in both locale files. A mapping pointing at a key
  // that does not exist would render the raw key to the user, which is the failure AC58 names.
  it.each(Object.entries(TASK_FIELD_ERROR_KEYS))(
    'resolves the %s message in both locales',
    (_field, key) => {
      for (const locale of [fr, en] as unknown as Record<string, unknown>[]) {
        const message = key
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            locale
          )

        expect(typeof message).toBe('string')
        expect(message).not.toBe('')
      }
    }
  )
})

describe('classifyTaskWriteError', () => {
  // The interrupted-paths table gives each failure its own recovery rather than its own message, and
  // AC47 says a validation failure keeps the editor open with every typed value intact.
  it('classifies a 401 as an expired session, which must not navigate away', () => {
    expect(classifyTaskWriteError({ statusCode: 401 })).toEqual({ kind: 'unauthenticated' })
  })

  it('classifies a 404 as a row that no longer exists, which is never retried as a patch', () => {
    expect(classifyTaskWriteError({ statusCode: 404 })).toEqual({ kind: 'gone' })
  })

  it('reads the status off either shape the fetch layer reports it on', () => {
    // ofetch reports the code on `status` and h3's serialized body repeats it on `statusCode`.
    expect(classifyTaskWriteError({ status: 404 })).toEqual({ kind: 'gone' })
    expect(classifyTaskWriteError({ status: 401 })).toEqual({ kind: 'unauthenticated' })
  })

  it('classifies a 422 as a validation failure and keeps the field map', () => {
    const failure = classifyTaskWriteError({
      data: { data: { client: 'Must be at most 200 characters.', notes: 'Too long.' } },
      statusCode: 422
    })

    expect(failure).toEqual({
      fields: { client: 'Must be at most 200 characters.', notes: 'Too long.' },
      kind: 'validation'
    })
  })

  it('keeps a _form key from the 422 so the editor can surface it at form level', () => {
    const failure = classifyTaskWriteError({
      data: { data: { _form: 'Nothing to update.' } },
      statusCode: 422
    })

    expect(failure).toEqual({ fields: { _form: 'Nothing to update.' }, kind: 'validation' })
  })

  it('yields an empty field map for a 422 whose body is not the expected shape', () => {
    // The editor then shows its form-level message rather than nothing at all.
    expect(classifyTaskWriteError({ data: null, statusCode: 422 })).toEqual({
      fields: {},
      kind: 'validation'
    })
    expect(classifyTaskWriteError({ data: { data: 'nope' }, statusCode: 422 })).toEqual({
      fields: {},
      kind: 'validation'
    })
    expect(classifyTaskWriteError({ statusCode: 422 })).toEqual({ fields: {}, kind: 'validation' })
  })

  it('drops non-string entries from the 422 field map', () => {
    const failure = classifyTaskWriteError({
      data: { data: { client: 'Too long.', nested: { message: 'no' } } },
      statusCode: 422
    })

    expect(failure).toEqual({ fields: { client: 'Too long.' }, kind: 'validation' })
  })

  it.each([[400], [409], [500], [503]])('classifies a %i as retryable', (statusCode) => {
    expect(classifyTaskWriteError({ statusCode })).toEqual({ kind: 'retryable' })
  })

  it('classifies a network failure, which carries no status, as retryable', () => {
    expect(classifyTaskWriteError(new Error('Failed to fetch'))).toEqual({ kind: 'retryable' })
  })

  it.each([[null], [undefined], ['boom'], [42]])(
    'classifies the unrecognisable failure %p as retryable rather than throwing',
    (error) => {
      expect(classifyTaskWriteError(error)).toEqual({ kind: 'retryable' })
    }
  )
})
