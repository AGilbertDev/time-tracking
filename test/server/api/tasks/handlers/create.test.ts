import type { Client } from '@libsql/client'

import { TaskCreateSchema } from '~~/server/models/tasks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CATEGORY_ID } from '#shared/categories'

import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import {
  countTasks,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  readStoredRow,
  seedCategoryQuota,
  seedSettings,
  seedTask
} from '../../../../helpers/taskTestDb'

// createTask, the handler behind POST /api/tasks.
//
// Derived from docs/specs/planning/task-write-api.md acceptance criteria AC5, AC10, AC11, AC16,
// AC18, AC23, AC26, AC40 and AC43, plus the "Do not store the fallback" and "estimated_minutes is
// stored, not derived" sections. Its AC30 and AC31 were about the words_done mirror; migration 0008
// dropped the column, so those two are replaced per docs/specs/planning/task-inline-editor.md AC8
// rather than deleted, and the replacements are marked as such where they sit.
//
// One criterion insists on being verified against the stored database row rather than against the
// response, because the response resolves the estimate fallback for display and would look right
// either way. So the seam here is `useDb`, which returns a genuine Drizzle instance over an
// in-memory SQLite database with the shipped tasks DDL. Column defaults, NOT NULL constraints and
// the max(sort_order) aggregate all run for real, and the assertions read raw SQL.
//
// Bodies are built through TaskCreateSchema, because the handler's input is by contract the
// schema's output and a hand-shaped object would test a request the route can never deliver.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { createTask } = await import('~~/server/api/tasks/handlers/create')

const event = { __event: true } as never

let harness: TaskTestDb
let client: Client

// A valid create body as the route would hand it over.
function body(input: Record<string, unknown>) {
  const parsed = TaskCreateSchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture body is not a valid request: ${parsed.error}`)
  return parsed.data
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db

  vi.stubGlobal('requireUserSession', async () => ({ user: { id: OWNER_ID } }))
  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string; data?: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
})

describe('createTask', () => {
  describe('the smallest legal request (AC10)', () => {
    it('creates a task from only a date and a category', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect(created).toMatchObject({ date: '2026-07-20', category: 'breaks' })
      expect(await countTasks(client)).toBe(1)
    })

    it('assigns sortOrder, defaults excludeFromStats to false, and leaves every other column NULL', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))
      const stored = await readStoredRow(client, created.id)

      expect(stored).toMatchObject({
        user_id: OWNER_ID,
        date: '2026-07-20',
        category: 'breaks',
        sort_order: 0,
        exclude_from_stats: 0
      })

      for (const column of [
        'client',
        'project',
        'delivery_date',
        'delivery_time',
        'project_word_count',
        'quota_wph_override',
        'estimated_minutes',
        'actual_minutes',
        'status',
        'notes',
        'split_group_id'
      ]) {
        expect(stored?.[column]).toBeNull()
      }
    })

    it('stamps created_at and updated_at', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))
      const stored = await readStoredRow(client, created.id)

      expect(Number(stored?.created_at)).toBeGreaterThan(0)
      expect(Number(stored?.updated_at)).toBeGreaterThan(0)
    })

    // -------------------------------------------------------------------------------------------
    // UC20 and UC21. The smallest legal add is now a day, because the write boundary defaults the
    // category. The `body` helper parses through the real TaskCreateSchema, so this exercises the
    // default rather than a fixture that happens to contain the value.
    //
    // The stored row is read rather than only the parse result, because the criterion is about what
    // the database ends up holding. A save with no category choice stores `other`, which is what lets
    // the create form stop blocking on a dropdown nobody touched.
    // -------------------------------------------------------------------------------------------
    it('creates a task from only a date and stores the defaulted category', async () => {
      const created = await createTask(event, body({ date: '2026-07-20' }))
      const stored = await readStoredRow(client, created.id)

      expect(created).toMatchObject({ date: '2026-07-20', category: DEFAULT_CATEGORY_ID })
      expect(stored?.category).toBe('other')
      expect(await countTasks(client)).toBe(1)
    })

    // UC21 again, from the response side. The defaulted row comes back resolved exactly as any other
    // create does, and it carries the pair of facts that made the two flags necessary. Its words reach
    // no quota and it does carry a status, so a fresh unclassified row is immediately usable.
    it('returns a defaulted create as a fully resolved row', async () => {
      const created = await createTask(event, body({ date: '2026-07-20' }))

      expect(created.trackable).toBe(false)
      expect(created.deliverable).toBe(true)
      // No status was sent and none is stored, so this is the ordinary no-status reading rather than
      // the not-applicable one a break would get.
      expect(created.status).toBeNull()
      expect(created.statusKey).toBe('na')
    })

    // UC12 and UC19 on the create endpoint. An explicit `other` with a status is legal, which is the
    // half a rule keyed on trackability would have refused.
    it('creates an other task carrying a status', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'other', status: 'Terminé' })
      )

      expect((await readStoredRow(client, created.id))?.status).toBe('Terminé')
      expect(created.statusKey).toBe('termine')
    })
  })

  describe('the column a create must never fill', () => {
    // -------------------------------------------------------------------------------------------
    // AC16. DO NOT MAKE THIS PASS BY AUTO-FILLING actual_minutes FROM estimated_minutes.
    //
    // This is the 2026-07-29 locked decision and the spec names it as the one most likely to be
    // undone by a later implementer acting helpfully, because auto-filling looks like a convenience
    // and the app this replaces did exactly that. Storing the copy makes a duration the user
    // confirmed at 2 h 00 and a duration the app assumed at 2 h 00 into identical rows, and nothing
    // downstream can tell them apart afterwards. effectiveDuration resolves the fallback at read
    // time, so leaving the column NULL behaves identically on screen and keeps the distinction.
    //
    // The assertion reads the stored column on purpose. AC16 says so explicitly: the response
    // resolves the fallback for display and would show the estimate either way, so asserting on the
    // response would pass whether or not the auto-fill was there.
    // -------------------------------------------------------------------------------------------
    it('stores actual_minutes as NULL when the body carries an estimate and no actual (AC16)', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', estimatedMinutes: 120 })
      )

      const stored = await readStoredRow(client, created.id)
      expect(stored?.estimated_minutes).toBe(120)
      expect(stored?.actual_minutes).toBeNull()
    })

    it('stores an actual_minutes the user actually sent', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          estimatedMinutes: 120,
          actualMinutes: 95
        })
      )

      expect((await readStoredRow(client, created.id))?.actual_minutes).toBe(95)
    })

    it('stores an explicit actualMinutes of 0 as a measurement rather than as unmeasured', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', actualMinutes: 0 })
      )

      expect((await readStoredRow(client, created.id))?.actual_minutes).toBe(0)
    })

    // -------------------------------------------------------------------------------------------
    // PLAN-11 AC6 and AC8, replacing the two guards that used to assert the words_done mirror was
    // never written. Migration 0008 dropped the column, so the mirror has nowhere left to go and
    // `SELECT words_done` is now a SQL error rather than an assertion.
    //
    // The guards are replaced rather than deleted. Deleting them would leave nothing asserting that
    // a body carrying wordsDone is still an error, and it is: the write API's AC29 refused it as a
    // named exclusion from the writable list, and strict() now refuses it as an unknown key, so the
    // criterion still holds for a different reason. Deleting them would also leave nothing here
    // noticing if a later hand re-added the column and the mirror with it.
    // -------------------------------------------------------------------------------------------
    it('refuses a body carrying wordsDone, now as an unknown key (AC8)', () => {
      const result = TaskCreateSchema.safeParse({
        date: '2026-07-20',
        category: 'translation',
        wordsDone: 500
      })

      expect(result.success).toBe(false)
    })

    it('stores project_word_count and writes no words_done column at all', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', projectWordCount: 12_000 })
      )

      const stored = await readStoredRow(client, created.id)
      const columns = Object.keys(stored ?? {})

      // Positive control first. The row really was read and the surviving words column really is
      // visible, so the absence asserted below is a finding rather than an empty read.
      expect(stored?.project_word_count).toBe(12_000)
      expect(columns).toContain('project_word_count')

      expect(columns).not.toContain('words_done')
    })
  })

  describe('estimated_minutes is stored, never derived (AC18)', () => {
    // The derivation needs a per-category quota that does not exist yet, and because the estimate is
    // frozen by definition a value derived from today's wrong global quota would never self-correct.
    it('stores NULL when no estimate is sent, even with a word count and a quota override present', async () => {
      await seedSettings(client, OWNER_ID, 'America/Toronto')

      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          projectWordCount: 12_000,
          quotaWphOverride: 500
        })
      )

      const stored = await readStoredRow(client, created.id)
      expect(stored?.estimated_minutes).toBeNull()
      expect(stored?.project_word_count).toBe(12_000)
      expect(stored?.quota_wph_override).toBe(500)
    })

    it('stores an estimate the user sent verbatim', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          projectWordCount: 12_000,
          estimatedMinutes: 1_600
        })
      )

      expect((await readStoredRow(client, created.id))?.estimated_minutes).toBe(1_600)
    })
  })

  describe('empty string becomes NULL in the column (AC11)', () => {
    it.each([
      ['client', 'client'],
      ['project', 'project']
    ])('stores %s sent as an empty string as NULL', async (field, column) => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', [field]: '' })
      )

      expect((await readStoredRow(client, created.id))?.[column]).toBeNull()
    })

    it('stores a trimmed value when one was actually given', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', client: '  Acme  ' })
      )

      expect((await readStoredRow(client, created.id))?.client).toBe('Acme')
    })
  })

  describe('the owning user comes from the session (AC5)', () => {
    it('writes the session user id', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect((await readStoredRow(client, created.id))?.user_id).toBe(OWNER_ID)
    })

    // The schema already refuses a userId, so this covers the handler on its own: even a body that
    // somehow carried one could not reach the column, because the insert reads the session.
    it('ignores a userId smuggled past the schema', async () => {
      const smuggled = {
        ...body({ date: '2026-07-20', category: 'breaks' }),
        userId: OTHER_USER_ID
      } as never

      const created = await createTask(event, smuggled)

      expect((await readStoredRow(client, created.id))?.user_id).toBe(OWNER_ID)
    })
  })

  describe('status against category (AC23)', () => {
    it('refuses a non-null status on a non-trackable category and creates no row', async () => {
      await expect(
        createTask(event, body({ date: '2026-07-20', category: 'breaks', status: 'En cours' }))
      ).rejects.toMatchObject({ statusCode: 422 })

      expect(await countTasks(client)).toBe(0)
    })

    it('accepts a status on a trackable category', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', status: 'Accepté' })
      )

      expect((await readStoredRow(client, created.id))?.status).toBe('Accepté')
      expect(created.statusKey).toBe('accepte')
    })

    // A trackable category with no status is a legitimate row; statusKey maps NULL to na.
    it('accepts a trackable task with no status', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'translation' }))

      expect((await readStoredRow(client, created.id))?.status).toBeNull()
      expect(created.statusKey).toBe('na')
    })

    it('accepts a non-trackable category with an explicit null status', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'breaks', status: null })
      )

      expect(created.statusKey).toBe('na')
      expect(created.trackable).toBe(false)
    })
  })

  describe('sort_order is assigned by the server (AC26)', () => {
    it('gives the first task of a day sort_order 0', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect((await readStoredRow(client, created.id))?.sort_order).toBe(0)
      expect(created.sortOrder).toBe(0)
    })

    it('gives a task on a day whose highest is 3 sort_order 4', async () => {
      await seedTask(client, { id: 'a', date: '2026-07-20', category: 'admin', sortOrder: 3 })

      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect((await readStoredRow(client, created.id))?.sort_order).toBe(4)
    })

    it('lands each successive task of the same day at the end', async () => {
      const first = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))
      const second = await createTask(event, body({ date: '2026-07-20', category: 'admin' }))
      const third = await createTask(event, body({ date: '2026-07-20', category: 'meetings' }))

      expect([first.sortOrder, second.sortOrder, third.sortOrder]).toEqual([0, 1, 2])
    })

    it('scopes the scan to the day, so another day does not move it', async () => {
      await seedTask(client, { id: 'a', date: '2026-07-19', category: 'admin', sortOrder: 7 })

      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect(created.sortOrder).toBe(0)
    })

    it('scopes the scan to the session user, so another user tasks that day do not move it', async () => {
      await seedTask(client, {
        id: 'theirs',
        userId: OTHER_USER_ID,
        date: '2026-07-20',
        category: 'admin',
        sortOrder: 7
      })

      const created = await createTask(event, body({ date: '2026-07-20', category: 'breaks' }))

      expect(created.sortOrder).toBe(0)
    })
  })

  describe('the response is a TaskListItem (AC40, AC43)', () => {
    it('returns exactly the contract fields, statusKey and trackable included', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          client: 'Acme',
          project: 'Manual',
          deliveryDate: '2026-07-25',
          deliveryTime: '17:00',
          projectWordCount: 12_000,
          quotaWphOverride: 500,
          estimatedMinutes: 1_600,
          status: 'Accepté',
          excludeFromStats: true
        })
      )

      expect(Object.keys(created).sort()).toEqual(
        [
          'actualMinutes',
          'category',
          'client',
          'date',
          'deliveryDate',
          'deliveryTime',
          'estimatedMinutes',
          'excludeFromStats',
          'id',
          'notes',
          'project',
          'projectWordCount',
          'quotaWphOverride',
          'sortOrder',
          'splitGroupId',
          'status',
          'statusKey',
          'trackable',
          'deliverable'
        ].sort()
      )

      expect(created).toMatchObject({
        client: 'Acme',
        project: 'Manual',
        deliveryDate: '2026-07-25',
        deliveryTime: '17:00',
        projectWordCount: 12_000,
        quotaWphOverride: 500,
        estimatedMinutes: 1_600,
        actualMinutes: null,
        status: 'Accepté',
        excludeFromStats: true,
        splitGroupId: null,
        trackable: true
      })
    })

    // AC43: the client is handed the verdict rather than the inputs, resolved server-side against
    // the user's own clock.
    it('returns statusKey retard for a task whose delivery is already past', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          status: 'Accepté',
          deliveryDate: '2020-01-01',
          deliveryTime: '09:00'
        })
      )

      expect(created.statusKey).toBe('retard')
    })

    it('does not return retard for a delivery still in the future', async () => {
      const created = await createTask(
        event,
        body({
          date: '2026-07-20',
          category: 'translation',
          status: 'Accepté',
          deliveryDate: '2999-12-31'
        })
      )

      expect(created.statusKey).toBe('accepte')
    })

    it('resolves trackable false for a non-trackable category', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'meetings' }))

      expect(created).toMatchObject({ trackable: false, statusKey: 'na' })
    })
  })

  describe('edge cases the spec allows rather than polices', () => {
    it('stores a project word count on a non-trackable task', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'meetings', projectWordCount: 500 })
      )

      expect((await readStoredRow(client, created.id))?.project_word_count).toBe(500)
    })

    it('stores a quota override on a non-trackable task', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'breaks', quotaWphOverride: 500 })
      )

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(500)
    })

    it('stores a delivery time with no delivery date', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', deliveryTime: '09:00' })
      )

      const stored = await readStoredRow(client, created.id)
      expect(stored?.delivery_time).toBe('09:00')
      expect(stored?.delivery_date).toBeNull()
    })

    it('stores a delivery date before the task date', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', deliveryDate: '2026-07-01' })
      )

      expect((await readStoredRow(client, created.id))?.delivery_date).toBe('2026-07-01')
    })
  })
})

// The notes column, from docs/specs/planning/task-inline-editor.md rather than from the write-API
// spec above. AC11 says a create accepting notes stores it, and AC12 says a whitespace-only note
// stores NULL rather than a whitespace string and a multiline note keeps its newline. Both are claims
// about what lands in the column, so they are read back with raw SQL rather than off the response.
describe('createTask and the notes column (AC11, AC12)', () => {
  it('stores a note the request carried', async () => {
    const created = await createTask(
      event,
      body({ date: '2026-07-20', category: 'translation', notes: 'Relire le glossaire.' })
    )

    expect((await readStoredRow(client, created.id))?.notes).toBe('Relire le glossaire.')
    expect(created.notes).toBe('Relire le glossaire.')
  })

  it('stores NULL for a note made of nothing but whitespace', async () => {
    const created = await createTask(
      event,
      body({ date: '2026-07-20', category: 'translation', notes: '   ' })
    )

    expect((await readStoredRow(client, created.id))?.notes).toBeNull()
  })

  it('stores NULL rather than an empty string for a cleared note', async () => {
    const created = await createTask(
      event,
      body({ date: '2026-07-20', category: 'translation', notes: '' })
    )

    const stored = await readStoredRow(client, created.id)
    expect(stored?.notes).toBeNull()
    expect(stored?.notes).not.toBe('')
  })

  it('stores both lines of a multiline note with the newline intact', async () => {
    const created = await createTask(
      event,
      body({ date: '2026-07-20', category: 'translation', notes: 'ligne un\nligne deux' })
    )

    expect((await readStoredRow(client, created.id))?.notes).toBe('ligne un\nligne deux')
  })

  it('stores a 2000-character note whole', async () => {
    const created = await createTask(
      event,
      body({ date: '2026-07-20', category: 'translation', notes: 'a'.repeat(2000) })
    )

    expect(String((await readStoredRow(client, created.id))?.notes)).toHaveLength(2000)
  })

  // A note on a meeting or a break is one of the cases the field exists for, so trackability has
  // nothing to do with it.
  it('stores a note on a non-trackable task', async () => {
    const created = await createTask(
      event,
      body({ date: '2026-07-20', category: 'meetings', notes: 'Ordre du jour envoyé.' })
    )

    expect((await readStoredRow(client, created.id))?.notes).toBe('Ordre du jour envoyé.')
  })

  // -----------------------------------------------------------------------------------------------
  // The quota snapshot, from docs/specs/planning/per-category-quotas.md AC12. The task stores the
  // words-per-hour figure its category was set to at the moment it was written, the way an invoice line
  // stores the price it was sold at, so a later edit to that setting cannot move it.
  //
  // Read off the stored row rather than off the response throughout. The response carries
  // quotaWphOverride either way, so a handler that resolved a figure and forgot to write it would look
  // identical from the outside on every case but the first.
  // -----------------------------------------------------------------------------------------------
  describe('the quota snapshot (AC12)', () => {
    it('stores the shipped default for a trackable category when the user has saved nothing', async () => {
      const created = await createTask(event, body({ date: '2026-07-20', category: 'translation' }))

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(240)
      expect(created.quotaWphOverride).toBe(240)
    })

    // Each trackable category takes its own figure, so the snapshot is resolved from the task's
    // category rather than from one number the handler happened to have.
    it.each([
      ['translation', 240],
      ['revision_internal', 1000],
      ['revision_external', 1300],
      ['proofreading', 2000]
    ])('stores %s at its own figure of %i', async (category, expected) => {
      const created = await createTask(event, body({ date: '2026-07-20', category }))

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(expected)
    })

    // AC12's last verifiable case: "A create for a user with a stored category_quotas row uses that row
    // rather than the shipped default." This is the branch production takes the moment the user saves
    // once, so a snapshot reading only the contract would pass every other case here.
    it('prefers the user stored row over the shipped default', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

      const created = await createTask(event, body({ date: '2026-07-20', category: 'translation' }))

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(300)
    })

    // Another user's row is not this user's setting. The resolution is scoped to the session user like
    // every other read on this path.
    it('ignores another user stored row', async () => {
      await seedCategoryQuota(client, OTHER_USER_ID, 'translation', 999)

      const created = await createTask(event, body({ date: '2026-07-20', category: 'translation' }))

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(240)
    })

    it.each(['terminology', 'meetings', 'breaks', 'admin', 'dtp', 'other'])(
      'stores no figure for the non-trackable %s',
      async (category) => {
        const created = await createTask(event, body({ date: '2026-07-20', category }))

        expect((await readStoredRow(client, created.id))?.quota_wph_override).toBeNull()
      }
    )

    // THE COMMON PATH, and it looks like an edge case and is not. TaskCreateSchema defaults category to
    // DEFAULT_CATEGORY_ID, which is `other`, and `other` is not trackable. The inline editor creates a
    // row from that same default, so the ordinary task made in the running app gets no figure here and
    // gets one from the first patch that sets a real category. The matching case is in update.test.ts.
    it('stores no figure for a create that names no category at all', async () => {
      const created = await createTask(event, body({ date: '2026-07-20' }))

      expect(created.category).toBe(DEFAULT_CATEGORY_ID)
      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBeNull()
    })

    // Precedence rule 1. A figure in the body is the user stating what this task's figure is, so the
    // server stores what they sent rather than resolving over the top of it.
    it('stores the figure the body carries rather than the resolved one', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', quotaWphOverride: 400 })
      )

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(400)
    })

    it('stores the figure the body carries even when the user has a stored row', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', quotaWphOverride: 400 })
      )

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBe(400)
    })

    // Precedence rule 2. An explicit null is the user asking this task to follow their category setting,
    // and a snapshot written over the top would make the clear a silent no-op.
    it('leaves the figure NULL when the body clears it explicitly', async () => {
      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', quotaWphOverride: null })
      )

      expect((await readStoredRow(client, created.id))?.quota_wph_override).toBeNull()
    })

    // The snapshot must not have cost the create its other guarantees. A resolution read sits between
    // the sort-order read and the insert, so this checks the row is still whole.
    it('writes a complete row alongside the snapshot', async () => {
      await seedCategoryQuota(client, OWNER_ID, 'translation', 300)

      const created = await createTask(
        event,
        body({ date: '2026-07-20', category: 'translation', client: 'Acme', projectWordCount: 900 })
      )
      const stored = await readStoredRow(client, created.id)

      expect(stored).toMatchObject({
        client: 'Acme',
        project_word_count: 900,
        quota_wph_override: 300,
        sort_order: 0,
        user_id: OWNER_ID
      })
    })
  })
})
