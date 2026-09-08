import {
  isValidClockTime,
  MAX_RANGE_DAYS,
  TaskCreateSchema,
  TaskIdParamSchema,
  TaskListQuerySchema,
  TaskUpdateSchema
} from '~~/server/models/tasks'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORY_ID, DEFAULT_CATEGORY_IDS } from '#shared/categories'

// The Zod schemas behind POST /api/tasks, PATCH /api/tasks/[id], and both [id] routes' path
// parameter. They are the whole of the write boundary the tasks table was deliberately left
// permissive for, so what they accept is what the database holds forever.
//
// Every rule below is taken from docs/specs/planning/task-write-api.md: "The writable field
// contract" table, "Formats, ranges, and the little coercion there is", "Category validation rejects
// rather than coerces", "Status is validated against the category", and acceptance criteria AC6,
// AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC20, AC21, AC22, AC27, AC29 and AC46. Nothing here
// is derived from reading the implementation as correct.
//
// The three stored status values are written out as literals on purpose. AC44 exempts test fixtures
// from reading the shared tuple, because a test that reads the same constant as the code under test
// proves the wiring and never the value, and these accents are load-bearing.

// The smallest legal create body, per AC10. Individual cases extend it with the one field they test.
const MINIMAL_CREATE = { date: '2026-07-20', category: 'translation' } as const

describe('isValidClockTime (HH:MM, 24-hour)', () => {
  it.each(['00:00', '09:30', '13:45', '23:59'])('accepts %s', (value) => {
    expect(isValidClockTime(value)).toBe(true)
  })

  it.each(['24:00', '12:60', '9:30', '13:5', '1345', '13:45:00', ''])('rejects %s', (value) => {
    expect(isValidClockTime(value)).toBe(false)
  })
})

describe('TaskCreateSchema', () => {
  describe('required fields (AC10, UC20 to UC24)', () => {
    // Only date is required now. Category was required until the other-category spec gave it a
    // default at this boundary, and it stopped being required by the rule already in force rather
    // than by an exception to it, since that rule is that a field is required when its column is NOT
    // NULL and has no default. The column is still NOT NULL and it now has a default.
    it('accepts a body of only date and category', () => {
      const result = TaskCreateSchema.safeParse(MINIMAL_CREATE)

      expect(result.success).toBe(true)
      expect(result.data).toEqual(MINIMAL_CREATE)
    })

    it('rejects a body with no date', () => {
      expect(TaskCreateSchema.safeParse({ category: 'translation' }).success).toBe(false)
    })

    // UC20 and UC21, and this assertion is the inversion of one that read "rejects a body with no
    // category". The smallest legal add is now a day, which is what brings the create form in line
    // with do not police the user, because a save blocked by a dropdown nobody touched is the app
    // refusing to record something that happened.
    //
    // The category is read off the parse result rather than inferred from success alone, because the
    // criterion is about the value the boundary supplies and not merely about the body being accepted.
    it('accepts a body of only date and defaults the category', () => {
      const result = TaskCreateSchema.safeParse({ date: '2026-07-20' })

      expect(result.success).toBe(true)
      expect(result.data?.category).toBe('other')
    })

    // UC23: the default is read from the shared constant rather than from a literal repeated at the
    // boundary, so the coercion fallback and the create default cannot drift apart. Asserted against
    // DEFAULT_CATEGORY_ID rather than against the string, so a future move of the fallback moves this
    // with it instead of failing here.
    it('takes its default category from DEFAULT_CATEGORY_ID rather than a literal', () => {
      const result = TaskCreateSchema.safeParse({ date: '2026-07-20' })

      expect(result.data?.category).toBe(DEFAULT_CATEGORY_ID)
    })

    // UC19: an explicit choice and an omission reach the same stored value by two legal routes, which
    // is the point rather than a redundancy.
    it('accepts an explicit other, so omitting and choosing it agree', () => {
      const explicit = TaskCreateSchema.safeParse({ date: '2026-07-20', category: 'other' })
      const omitted = TaskCreateSchema.safeParse({ date: '2026-07-20' })

      // Both parses are asserted before the two are compared. Without the second assertion the
      // comparison can pass on a pair of undefineds, so a schema that stopped emitting a category
      // at all would satisfy it rather than fail it.
      expect(explicit.success).toBe(true)
      expect(omitted.success).toBe(true)
      expect(explicit.data?.category).toBe(DEFAULT_CATEGORY_ID)
      expect(explicit.data?.category).toBe(omitted.data?.category)
    })

    // The columns are NOT NULL, so neither field is nullable even though most of the others are. An
    // omitted category and an explicit null are deliberately different. Omitting it means "you decide"
    // and takes the default, and a null means "store nothing" against a NOT NULL column, which is not
    // a question the server can answer, so it stays a 422. A Zod default fires on undefined only,
    // which is exactly this distinction.
    it.each([
      ['date', { ...MINIMAL_CREATE, date: null }],
      ['category', { ...MINIMAL_CREATE, category: null }]
    ])('rejects an explicit null %s', (_field, body) => {
      expect(TaskCreateSchema.safeParse(body).success).toBe(false)
    })
  })

  describe('server-owned and other-feature fields are refused, not dropped (AC7, AC27, AC29)', () => {
    // strict() is the mass-assignment protection. A client that sends userId and gets a 201 has been
    // told its write succeeded as sent, which is false, so each of these is an error rather than a
    // silent omission.
    it.each([
      ['id', 'some-id'],
      ['userId', 'user-other'],
      ['createdAt', 1_700_000_000],
      ['updatedAt', 1_700_000_000],
      ['wordsDone', 500],
      ['sortOrder', 3],
      ['splitGroupId', 'group-1']
    ])('rejects a body carrying %s', (field, value) => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, [field]: value })

      expect(result.success).toBe(false)
    })

    it('rejects an unknown key', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, nope: 1 }).success).toBe(false)
    })

    // sendZodError keys `data` by field name, so a rejected key has to be nameable. A strict object
    // reports unknown keys in one issue whose `keys` array names them.
    it('names every rejected key in the unrecognized_keys issue', () => {
      const result = TaskCreateSchema.safeParse({
        ...MINIMAL_CREATE,
        userId: 'user-other',
        wordsDone: 500
      })

      expect(result.success).toBe(false)
      const issue = result.error?.issues.find((candidate) => candidate.code === 'unrecognized_keys')
      expect(issue).toBeDefined()
      expect(issue && 'keys' in issue ? issue.keys : []).toEqual(
        expect.arrayContaining(['userId', 'wordsDone'])
      )
    })
  })

  describe('two failing fields are both reported (AC6)', () => {
    it('reports one issue per bad field, keyed by field name', () => {
      const result = TaskCreateSchema.safeParse({
        date: '2026-02-31',
        category: 'not-a-category'
      })

      expect(result.success).toBe(false)
      const paths = result.error?.issues.map((issue) => issue.path.join('.')) ?? []
      expect(paths).toEqual(expect.arrayContaining(['date', 'category']))
    })
  })

  describe('free text is trimmed and an empty string becomes null (AC11)', () => {
    it.each(['client', 'project'] as const)(
      'stores %s sent as an empty string as null',
      (field) => {
        const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, [field]: '' })

        expect(result.success).toBe(true)
        expect(result.data?.[field]).toBeNull()
      }
    )

    it.each(['client', 'project'] as const)('stores whitespace-only %s as null', (field) => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, [field]: '   ' })

      expect(result.success).toBe(true)
      expect(result.data?.[field]).toBeNull()
    })

    it('trims surrounding whitespace off a real value', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, client: '  Acme  ' })

      expect(result.data?.client).toBe('Acme')
    })

    it('accepts an explicit null', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, client: null })

      expect(result.success).toBe(true)
      expect(result.data?.client).toBeNull()
    })

    it('accepts exactly 200 characters', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, client: 'a'.repeat(200) })

      expect(result.success).toBe(true)
    })

    it('rejects 201 characters', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, client: 'a'.repeat(201) }).success
      ).toBe(false)
    })
  })

  describe('numeric bounds (AC12, AC13)', () => {
    // The bounds are anti-garbage limits, not policy limits, so they are checked at the exact
    // values the contract table names.
    it.each([
      ['projectWordCount', 0, true],
      ['projectWordCount', 10_000_000, true],
      ['projectWordCount', -1, false],
      ['projectWordCount', 10_000_001, false],
      ['projectWordCount', 1.5, false],
      ['estimatedMinutes', 0, true],
      ['estimatedMinutes', 100_000, true],
      ['estimatedMinutes', -1, false],
      ['estimatedMinutes', 100_001, false],
      ['estimatedMinutes', 90.5, false],
      ['actualMinutes', 0, true],
      ['actualMinutes', 100_000, true],
      ['actualMinutes', -1, false],
      ['actualMinutes', 100_001, false],
      ['actualMinutes', 12.25, false],
      ['quotaWphOverride', 1, true],
      ['quotaWphOverride', 10_000, true],
      ['quotaWphOverride', 10_001, false],
      ['quotaWphOverride', -5, false],
      ['quotaWphOverride', 450.5, false]
    ] as const)('%s of %s parses as %s', (field, value, expected) => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, [field]: value }).success).toBe(
        expected
      )
    })

    // AC12 singles this out: zero is not merely out of range, it is the divisor in
    // estimated = words / quota, so admitting it would store a row that divides by zero the moment
    // PLAN-12 reads it.
    it('rejects quotaWphOverride of 0', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, quotaWphOverride: 0 }).success).toBe(
        false
      )
    })

    it.each(['projectWordCount', 'quotaWphOverride', 'estimatedMinutes', 'actualMinutes'] as const)(
      'accepts an explicit null %s',
      (field) => {
        const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, [field]: null })

        expect(result.success).toBe(true)
        expect(result.data?.[field]).toBeNull()
      }
    )
  })

  describe('types are not coerced', () => {
    it('rejects a number sent as a string', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, projectWordCount: '12000' }).success
      ).toBe(false)
    })

    it('rejects a boolean sent as a string', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, excludeFromStats: 'true' }).success
      ).toBe(false)
    })

    it.each([true, false])('accepts a real boolean excludeFromStats of %s', (value) => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, excludeFromStats: value })

      expect(result.success).toBe(true)
      expect(result.data?.excludeFromStats).toBe(value)
    })

    it('rejects a null excludeFromStats, since the column is NOT NULL with a default', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, excludeFromStats: null }).success
      ).toBe(false)
    })
  })

  describe('category is validated, never coerced (AC20, AC21)', () => {
    // The nine ids in the locked contract order, written out rather than read from the contract, so
    // this fails if the set itself changes rather than silently following it.
    it.each([
      'translation',
      'revision_internal',
      'revision_external',
      'proofreading',
      'terminology',
      'meetings',
      'breaks',
      'admin',
      'dtp'
    ])('accepts the contract category %s', (category) => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, category }).success).toBe(true)
    })

    // AC21: the valid set is read from DEFAULT_CATEGORY_IDS rather than retyped, so a category added
    // to the contract becomes writable with no change to the schema.
    it('accepts every id the shared contract declares', () => {
      for (const category of DEFAULT_CATEGORY_IDS) {
        expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, category }).success).toBe(true)
      }
    })

    // 'revision' is the retired id from the earlier six-member set. coerceCategory would fold it to
    // admin, and the write path must refuse it instead: silently storing admin on a task the user
    // labelled as revision is data corruption dressed as robustness.
    it('rejects the retired revision id rather than coercing it to admin', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, category: 'revision' })

      expect(result.success).toBe(false)
      expect(result.data).toBeUndefined()
    })

    it.each(['Translation', 'TRANSLATION', 'made-up', ''])(
      'rejects the category %s',
      (category) => {
        expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, category }).success).toBe(false)
      }
    )
  })

  describe('status is a strict enum of the three stored values (AC22)', () => {
    it.each(['Accepté', 'En cours', 'Terminé'])('accepts the stored status %s', (status) => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, status })

      expect(result.success).toBe(true)
      expect(result.data?.status).toBe(status)
    })

    // The accents are load-bearing: the overdue expression compares the finished value as a literal
    // string, so a row storing 'Termine' would read as late forever.
    it('rejects the de-accented Termine', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, status: 'Termine' }).success).toBe(
        false
      )
    })

    // N/A is what the read path derives for a non-trackable row. It is never a stored value.
    it('rejects the display-only N/A', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, status: 'N/A' }).success).toBe(false)
    })

    it.each(['termine', 'accepte', 'Done', 'En Cours', 'En retard'])(
      'rejects the non-stored status %s',
      (status) => {
        expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, status }).success).toBe(false)
      }
    )

    // A trackable task with no status yet is a legitimate row; statusKey maps NULL to 'na'.
    it('accepts an explicit null status', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, status: null })

      expect(result.success).toBe(true)
      expect(result.data?.status).toBeNull()
    })
  })

  describe('dates and times', () => {
    it('rejects a task date that is not a real calendar day', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, date: '2026-02-31' }).success).toBe(
        false
      )
    })

    it('rejects a delivery date that is not a real calendar day', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, deliveryDate: '2026-02-31' }).success
      ).toBe(false)
    })

    it.each(['deliveryDate', 'deliveryTime'] as const)('accepts a null %s', (field) => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, [field]: null })

      expect(result.success).toBe(true)
      expect(result.data?.[field]).toBeNull()
    })

    it('rejects a delivery time outside the 24-hour clock', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, deliveryTime: '25:00' }).success).toBe(
        false
      )
    })

    // The app records reality rather than policing it, so both of these odd combinations are legal.
    it('accepts a delivery time with no delivery date', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, deliveryTime: '09:00' }).success).toBe(
        true
      )
    })

    it('accepts a delivery date before the task date', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, deliveryDate: '2026-07-01' }).success
      ).toBe(true)
    })
  })

  // The notes column arrived with the inline task editor, so these cases come from
  // docs/specs/planning/task-inline-editor.md rather than from the write-API spec above. The criteria
  // are AC11 (a create or update accepting notes stores it, and null clears it), AC12 (whitespace
  // only stores NULL and a multiline value keeps its newline), AC13 (2000 accepted, 2001 a 422 naming
  // notes, and the length measured after trimming), AC15 (notes is writable on both endpoints because
  // both bodies are strict) and AC63 (the schema covered at 0, 1, 2000 and 2001 characters).
  //
  // The bound is deliberately not the 200 of the identity fields. A note is a paragraph, often pasted
  // out of an instruction in an email, and 200 characters would cut it mid-sentence. The figures are
  // written as literals here for the same reason the status values are, which is that reading the same
  // constant as the code under test proves the wiring and never the value.
  describe('the notes field (AC11, AC12, AC13, AC15, AC63)', () => {
    it('accepts a note and keeps its text', () => {
      const result = TaskCreateSchema.safeParse({
        ...MINIMAL_CREATE,
        notes: 'Relire le glossaire.'
      })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBe('Relire le glossaire.')
    })

    it('is writable on the create endpoint at all, which a strict body only allows if it is declared', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: 'x' }).success).toBe(true)
    })

    it('leaves an omitted note out of the parsed body, so the column is left alone', () => {
      const result = TaskCreateSchema.safeParse(MINIMAL_CREATE)

      expect(result.success).toBe(true)
      expect('notes' in (result.data ?? {})).toBe(false)
    })

    it('accepts an explicit null, which is what clears a note', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: null })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBeNull()
    })

    // AC63's zero-character case. A cleared field stored as '' and one stored as NULL are the same
    // thing to the user and two different things to every reader, so only NULL is stored.
    it('stores an empty note as null rather than as an empty string', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: '' })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBeNull()
    })

    // AC12: notes of '  ' store NULL, not a whitespace string.
    it.each(['  ', '\n', ' \n\t '])('stores the whitespace-only note %j as null', (value) => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: value })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBeNull()
    })

    it('accepts a note of one character', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: 'a' })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBe('a')
    })

    it('trims the ends of a note', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: '  Relire  ' })

      expect(result.data?.notes).toBe('Relire')
    })

    // AC12: 'ligne un\nligne deux' stores both lines with the newline intact, because trimming only
    // touches the ends.
    it('keeps the newlines inside a multiline note', () => {
      const result = TaskCreateSchema.safeParse({
        ...MINIMAL_CREATE,
        notes: 'ligne un\nligne deux'
      })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBe('ligne un\nligne deux')
    })

    it('keeps the interior newlines while trimming the ends of a multiline note', () => {
      const result = TaskCreateSchema.safeParse({
        ...MINIMAL_CREATE,
        notes: '\n ligne un\n\nligne deux \n'
      })

      expect(result.data?.notes).toBe('ligne un\n\nligne deux')
    })

    it('accepts a note of exactly 2000 characters', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: 'a'.repeat(2000) })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toHaveLength(2000)
    })

    it('rejects a note of 2001 characters', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: 'a'.repeat(2001) }).success
      ).toBe(false)
    })

    // AC13: the 422's `data` names notes, because sendZodError keys the response by field name and the
    // editor maps that key to its own French message.
    it('names notes in the issue path when the note is too long', () => {
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: 'a'.repeat(2001) })

      expect(result.success).toBe(false)
      expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('notes')
    })

    // AC13: the length is measured after trimming, so 2000 characters surrounded by spaces is
    // accepted rather than counted as 2002.
    it('measures the bound after trimming', () => {
      const result = TaskCreateSchema.safeParse({
        ...MINIMAL_CREATE,
        notes: `  ${'a'.repeat(2000)}  `
      })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toHaveLength(2000)
    })

    // The note is its own bound rather than the identity fields' 200, so a paragraph is not cut
    // mid-sentence.
    it('accepts a note far longer than the 200 the one-line fields allow', () => {
      expect(
        TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: 'a'.repeat(201) }).success
      ).toBe(true)
    })

    it('rejects a note that is not a string', () => {
      expect(TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: 42 }).success).toBe(false)
    })

    // Nothing in the editor or at the boundary polices what the user writes in a note.
    it('accepts a note carrying punctuation, accents, and an emoji', () => {
      const note = 'Réunion : suivi du dossier — voir pièce jointe 📎'
      const result = TaskCreateSchema.safeParse({ ...MINIMAL_CREATE, notes: note })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBe(note)
    })
  })
})

describe('TaskUpdateSchema', () => {
  describe('the empty patch is refused (AC8)', () => {
    it('rejects an empty object with the contract message', () => {
      const result = TaskUpdateSchema.safeParse({})

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('At least one task field must be provided.')
    })

    // The precedent this criterion names, WorkSettingsPatchSchema, refuses a body whose only fields
    // are explicitly undefined for the same recorded reason: a client bug should not be able to send
    // a meaningless write, and a patch that maps to no columns only bumps updatedAt.
    it('rejects a body whose only fields are explicitly undefined', () => {
      const result = TaskUpdateSchema.safeParse({ client: undefined, status: undefined })

      expect(result.success).toBe(false)
    })
  })

  describe('every writable field is optional on its own', () => {
    it.each([
      ['date', { date: '2026-07-21' }],
      ['client', { client: 'Acme' }],
      ['project', { project: 'Manual' }],
      ['category', { category: 'breaks' }],
      ['deliveryDate', { deliveryDate: '2026-07-25' }],
      ['deliveryTime', { deliveryTime: '09:00' }],
      ['projectWordCount', { projectWordCount: 12_000 }],
      ['quotaWphOverride', { quotaWphOverride: 500 }],
      ['estimatedMinutes', { estimatedMinutes: 120 }],
      ['actualMinutes', { actualMinutes: 90 }],
      ['status', { status: 'En cours' }],
      ['excludeFromStats', { excludeFromStats: true }]
    ])('accepts a patch carrying only %s', (_field, body) => {
      expect(TaskUpdateSchema.safeParse(body).success).toBe(true)
    })
  })

  describe('absent against explicit null (AC14)', () => {
    // The distinction is the whole point of a patch. effectiveDuration reads actualMinutes as "the
    // user measured this" and NULL as "the user did not", so clearing to 0 is not a way back to
    // unmeasured, because zero minutes is itself a measurement.
    it('carries an explicit null through as null', () => {
      const result = TaskUpdateSchema.safeParse({ actualMinutes: null })

      expect(result.success).toBe(true)
      expect(result.data?.actualMinutes).toBeNull()
    })

    it('carries an explicit 0 through as 0, not as a clear', () => {
      const result = TaskUpdateSchema.safeParse({ actualMinutes: 0 })

      expect(result.data?.actualMinutes).toBe(0)
    })

    it('leaves an omitted field absent from the parsed body rather than undefined-valued', () => {
      const result = TaskUpdateSchema.safeParse({ client: 'Acme' })

      expect(result.success).toBe(true)
      expect(Object.keys(result.data ?? {})).toEqual(['client'])
    })
  })

  describe('the same refusals as create (AC7, AC20, AC22, AC27, AC29)', () => {
    it.each([
      ['id', 'some-id'],
      ['userId', 'user-other'],
      ['createdAt', 1_700_000_000],
      ['updatedAt', 1_700_000_000],
      ['wordsDone', 500],
      ['sortOrder', 3],
      ['splitGroupId', 'group-1'],
      ['nope', true]
    ])('rejects a patch carrying %s', (field, value) => {
      expect(TaskUpdateSchema.safeParse({ [field]: value }).success).toBe(false)
    })

    it('rejects the retired revision category', () => {
      expect(TaskUpdateSchema.safeParse({ category: 'revision' }).success).toBe(false)
    })

    it('rejects the de-accented Termine', () => {
      expect(TaskUpdateSchema.safeParse({ status: 'Termine' }).success).toBe(false)
    })

    it('rejects the display-only N/A', () => {
      expect(TaskUpdateSchema.safeParse({ status: 'N/A' }).success).toBe(false)
    })

    it('rejects quotaWphOverride of 0', () => {
      expect(TaskUpdateSchema.safeParse({ quotaWphOverride: 0 }).success).toBe(false)
    })

    it.each([
      ['date', { date: null }],
      ['category', { category: null }]
    ])('rejects an explicit null %s, whose column is NOT NULL', (_field, body) => {
      expect(TaskUpdateSchema.safeParse(body).success).toBe(false)
    })
  })

  describe('empty string to null holds on update too (AC11)', () => {
    it.each(['client', 'project'] as const)('clears %s sent as an empty string', (field) => {
      const result = TaskUpdateSchema.safeParse({ [field]: '' })

      expect(result.success).toBe(true)
      expect(result.data?.[field]).toBeNull()
    })
  })

  // The notes half of the inline editor's contract, on the endpoint the editor patches through.
  // AC11 spells out all three states a patch can express for it, and AC15 says the field is writable
  // on both endpoints rather than only on create.
  describe('the notes field on a patch (AC11, AC15)', () => {
    it('accepts a patch carrying only notes', () => {
      const result = TaskUpdateSchema.safeParse({ notes: 'Relire le glossaire.' })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBe('Relire le glossaire.')
    })

    it('clears a note sent as an explicit null', () => {
      const result = TaskUpdateSchema.safeParse({ notes: null })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBeNull()
    })

    it('clears a note sent as an empty string', () => {
      const result = TaskUpdateSchema.safeParse({ notes: '' })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBeNull()
    })

    it('clears a note sent as whitespace only', () => {
      const result = TaskUpdateSchema.safeParse({ notes: '  \n ' })

      expect(result.success).toBe(true)
      expect(result.data?.notes).toBeNull()
    })

    // An omitted notes leaves the column alone, which is the difference between the two instructions a
    // partial patch can carry.
    it('leaves the column alone when notes is omitted', () => {
      const result = TaskUpdateSchema.safeParse({ client: 'Acme' })

      expect(result.success).toBe(true)
      expect('notes' in (result.data ?? {})).toBe(false)
    })

    it('keeps a multiline note intact on a patch', () => {
      const result = TaskUpdateSchema.safeParse({ notes: 'ligne un\nligne deux' })

      expect(result.data?.notes).toBe('ligne un\nligne deux')
    })

    it('accepts 2000 characters and rejects 2001 on a patch as well', () => {
      expect(TaskUpdateSchema.safeParse({ notes: 'a'.repeat(2000) }).success).toBe(true)
      expect(TaskUpdateSchema.safeParse({ notes: 'a'.repeat(2001) }).success).toBe(false)
    })
  })
})

describe('TaskIdParamSchema (AC9)', () => {
  it('accepts a non-empty id', () => {
    const result = TaskIdParamSchema.safeParse({ id: 'task-1' })

    expect(result.success).toBe(true)
    expect(result.data?.id).toBe('task-1')
  })

  // The id column is free text with a uuid default rather than a constrained type, so the write path
  // must not assert a uuid shape it cannot rely on. A well-formed id matching no row is a 404 later,
  // never a 422 here.
  it('accepts an id that is a valid string but not a uuid', () => {
    expect(TaskIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(true)
  })

  it('rejects an empty id with the contract message', () => {
    const result = TaskIdParamSchema.safeParse({ id: '' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('A task id is required.')
  })

  it('rejects a missing id', () => {
    expect(TaskIdParamSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a non-string id', () => {
    expect(TaskIdParamSchema.safeParse({ id: 42 }).success).toBe(false)
  })
})

// --- the read boundary (TaskListQuerySchema) -------------------------------------------------------
//
// Added to close pre-existing coverage debt. The three write schemas above were covered from the day
// they were written; the query schema behind GET /api/tasks never was, so the whole of the range
// validation, both refinements and the day-count helper behind them, had never been exercised.
//
// Every expected value below comes from docs/specs/planning/week-with-task-rows.md, not from reading
// the implementation as correct:
//
//   Line 41: "`from` after `to`, an inverted range. An equal `from` and `to` is valid and returns a
//   single day."
//
//   Line 42: "A span wider than a documented maximum. The endpoint is reused by the month and year
//   views later, so the cap is generous rather than tight. Assumption: the maximum span is 366 days
//   inclusive, which admits a full leap year and bounds the scan so a malformed or hostile query
//   cannot ask for an unbounded range. A wider span is a 422."
//
//   AC2: "No session returns 401. A missing, malformed, inverted, or over-wide range returns 422
//   through sendZodError with per-field messages, and never a 500."
//
//   Line 222 restates the bound: "The maximum accepted range span for the list endpoint is 366 days
//   inclusive, and a wider span is a 422."
//
// "Never a 500" is the load-bearing half of AC2 and it is why the boundaries below are asserted as
// refusals with a named path and message rather than merely as `success: false`. A refusal and a
// crash both fail a truthiness check, and only the message and the path tell them apart.

describe('TaskListQuerySchema (AC2, week-with-task-rows.md lines 41, 42, 222)', () => {
  const INVERTED_MESSAGE = 'The start of the range must not be after its end.'
  const OVER_WIDE_MESSAGE = `The range must not span more than ${MAX_RANGE_DAYS} days.`

  describe('both ends are required and must be real calendar days', () => {
    it('accepts a Sunday-to-Saturday week, which is what the page asks for', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2026-07-19', to: '2026-07-25' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ from: '2026-07-19', to: '2026-07-25' })
    })

    it.each([
      ['no from', { to: '2026-07-25' }],
      ['no to', { from: '2026-07-19' }],
      ['neither end', {}]
    ])('rejects a query with %s', (_label, query) => {
      expect(TaskListQuerySchema.safeParse(query).success).toBe(false)
    })

    it.each([
      ['a day that does not exist', '2026-02-31'],
      ['a thirteenth month', '2026-13-01'],
      ['a zero day', '2026-07-00'],
      ['an unpadded month', '2026-7-19'],
      ['a slashed date', '2026/07/19'],
      ['a full timestamp', '2026-07-19T00:00:00Z'],
      ['an empty string', '']
    ])('rejects %s as the start of the range', (_label, from) => {
      expect(TaskListQuerySchema.safeParse({ from, to: '2026-07-25' }).success).toBe(false)
    })

    it.each([
      ['null', null],
      ['a number', 20260719],
      ['an array', ['2026-07-19']]
    ])('rejects a from that is %s rather than a string', (_label, from) => {
      expect(TaskListQuerySchema.safeParse({ from, to: '2026-07-25' }).success).toBe(false)
    })

    it('rejects a 29 February in a non-leap year', () => {
      expect(TaskListQuerySchema.safeParse({ from: '2026-02-29', to: '2026-03-01' }).success).toBe(
        false
      )
    })

    it('accepts a 29 February in a leap year', () => {
      expect(TaskListQuerySchema.safeParse({ from: '2024-02-29', to: '2024-03-01' }).success).toBe(
        true
      )
    })

    it('names the offending end in the issue path', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2026-02-31', to: '2026-07-25' })

      expect(result.error?.issues.map((issue) => issue.path)).toEqual([['from']])
    })

    it('skips the range refinements when an end is missing or not a string', () => {
      // A field that fails its type check leaves the object with no parsed value, so the
      // object-level refinements do not run at all. This is the case the module's comment is
      // protecting: a refinement comparing undefined to a string is not something a 422 could
      // describe.
      for (const query of [{}, { from: null, to: null }, { from: 1, to: 2 }]) {
        const messages = TaskListQuerySchema.safeParse(query).error!.issues.map(
          (issue) => issue.message
        )

        expect(messages).not.toContain(INVERTED_MESSAGE)
        expect(messages).not.toContain(OVER_WIDE_MESSAGE)
      }
    })

    // FINDING, reported rather than fixed, and asserted as it behaves rather than as the source
    // describes it.
    //
    // The schema comment at server/models/tasks.ts says "The object-level refinements run only after
    // both fields are valid calendar days". That is true only for a field that fails its *type*
    // check. A string that is the wrong shape passes z.string() and fails calendarDaySchema's own
    // refine, which still leaves the object with two string values, so under Zod 4 the two
    // object-level refinements do run on them. rangeSpanDays then parses an unparseable date, gets
    // NaN, and `NaN <= 366` is false, so the width refinement fails and adds a third issue.
    //
    // Two things follow. AC2's substance holds: the answer is a 422 and never a 500, and the NaN
    // comparison fails closed by refusing rather than open by admitting. But AC2 also asks for
    // per-field messages, and one of the messages a malformed range gets is "The range must not span
    // more than 366 days", which is not what is wrong with it. The client derives the range from the
    // pure week helpers so it should never send one (line 197), which is why this has never been
    // seen; it would surface in a hand-typed URL or a client bug, and it would mislead whoever was
    // debugging it. A `.superRefine` guarded on both ends parsing, or a check inside the refinement,
    // would remove the spurious message. Left to the owner.
    it('adds a spurious width message when an end is a string of the wrong shape', () => {
      const result = TaskListQuerySchema.safeParse({ from: 'nonsense', to: 'rubbish' })

      expect(result.success).toBe(false)
      expect(
        result.error?.issues.map((issue) => ({ message: issue.message, path: issue.path }))
      ).toEqual([
        { message: 'Must be a real calendar day in the YYYY-MM-DD format.', path: ['from'] },
        { message: 'Must be a real calendar day in the YYYY-MM-DD format.', path: ['to'] },
        { message: OVER_WIDE_MESSAGE, path: ['to'] }
      ])
    })

    it('still refuses rather than admitting when the span cannot be computed', () => {
      // The direction of the failure is what matters most here. An unparseable end makes the span
      // NaN, and NaN fails every comparison, so the width refinement rejects. Had the comparison
      // been written the other way round, a garbage range would have passed the cap and reached the
      // database as an unbounded scan, which is the exact thing the cap exists to prevent.
      for (const query of [
        { from: 'nonsense', to: 'rubbish' },
        { from: '', to: '' },
        { from: '2026-07-19', to: 'rubbish' }
      ]) {
        expect(TaskListQuerySchema.safeParse(query).success).toBe(false)
      }
    })

    it('does not throw on any malformed input, so the route can always answer 422', () => {
      // AC2's "never a 500", asserted over the shapes a hostile or broken client actually sends.
      for (const query of [
        {},
        { from: null, to: null },
        { from: '', to: '' },
        { from: 'abc', to: 123 },
        { from: ['2026-07-19'], to: {} },
        'not an object',
        null,
        []
      ]) {
        expect(() => TaskListQuerySchema.safeParse(query)).not.toThrow()
        expect(TaskListQuerySchema.safeParse(query).success).toBe(false)
      }
    })
  })

  describe('the range must not be inverted (line 41)', () => {
    it('accepts an equal from and to, which is a single day', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2026-07-20', to: '2026-07-20' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ from: '2026-07-20', to: '2026-07-20' })
    })

    it('rejects a to one day before the from', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2026-07-21', to: '2026-07-20' })

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe(INVERTED_MESSAGE)
    })

    it('reports the inversion on the `to` path, per AC2 per-field messages', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2026-07-21', to: '2026-07-20' })

      expect(result.error?.issues[0]?.path).toEqual(['to'])
    })

    it.each([
      ['across a month boundary', '2026-08-01', '2026-07-31'],
      ['across a year boundary', '2027-01-01', '2026-12-31'],
      ['by a whole year', '2026-07-20', '2025-07-20']
    ])('rejects a range inverted %s', (_label, from, to) => {
      const result = TaskListQuerySchema.safeParse({ from, to })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.message === INVERTED_MESSAGE)).toBe(true)
    })

    it('compares the two ends lexicographically, which for YYYY-MM-DD is chronological', () => {
      // The schema comment states this as the reason the comparison is a plain string comparison
      // rather than a parse. It only holds because the format is zero-padded and fixed-width, so the
      // single-digit month and day cases are the ones worth pinning.
      expect(TaskListQuerySchema.safeParse({ from: '2026-01-02', to: '2026-09-01' }).success).toBe(
        true
      )
      expect(TaskListQuerySchema.safeParse({ from: '2026-09-01', to: '2026-01-02' }).success).toBe(
        false
      )
    })
  })

  describe(`the range must not span more than ${MAX_RANGE_DAYS} days (lines 42, 222)`, () => {
    it('publishes the documented maximum as 366', () => {
      // Read as a value rather than trusted, because every boundary case below is expressed against
      // it and the spec names the number twice.
      expect(MAX_RANGE_DAYS).toBe(366)
    })

    it('accepts a full leap year, which is the case the cap was sized for', () => {
      // 2024-01-01 to 2024-12-31 inclusive is 366 days, exactly the cap.
      const result = TaskListQuerySchema.safeParse({ from: '2024-01-01', to: '2024-12-31' })

      expect(result.success).toBe(true)
    })

    it('accepts a full ordinary year, which is 365 days', () => {
      expect(TaskListQuerySchema.safeParse({ from: '2025-01-01', to: '2025-12-31' }).success).toBe(
        true
      )
    })

    it('rejects 367 days, one past the cap', () => {
      // 2024-01-01 to 2025-01-01 inclusive is 367 days.
      const result = TaskListQuerySchema.safeParse({ from: '2024-01-01', to: '2025-01-01' })

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe(OVER_WIDE_MESSAGE)
    })

    it('reports the over-wide range on the `to` path, per AC2 per-field messages', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2024-01-01', to: '2025-01-01' })

      expect(result.error?.issues[0]?.path).toEqual(['to'])
    })

    it('accepts exactly 366 days in a non-leap span too', () => {
      // 2025-01-01 plus 365 days is 2026-01-01, which is 366 days inclusive. The cap is a day count
      // and not a calendar year, so both spans of 366 have to be admitted.
      expect(TaskListQuerySchema.safeParse({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(
        true
      )
    })

    it('rejects a decade, which is the unbounded scan the cap exists to prevent', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2020-01-01', to: '2030-01-01' })

      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.message === OVER_WIDE_MESSAGE)).toBe(true)
    })

    it('counts the span inclusively, so a single day is one and not zero', () => {
      // Asserted through the cap, which is the only observable the schema exposes. A span counted
      // exclusively would make 2024-01-01 to 2025-01-01 exactly 366 and accept it.
      expect(TaskListQuerySchema.safeParse({ from: '2024-01-01', to: '2024-12-31' }).success).toBe(
        true
      )
      expect(TaskListQuerySchema.safeParse({ from: '2024-01-01', to: '2025-01-01' }).success).toBe(
        false
      )
    })

    it('holds the cap on a span that crosses two daylight-saving changes', () => {
      // 2025-11-02 to 2026-11-02 inclusive is 366 days and crosses both Toronto clock changes, so
      // the boundary is exercised on a span where a naive day count could plausibly drift.
      //
      // Recorded from mutation testing rather than claimed: the schema's UTC parsing is NOT
      // observable through this boundary, and that is a property of the source rather than a gap
      // here. rangeSpanDays wraps the difference in Math.round, which absorbs any offset under
      // twelve hours, and a daylight-saving shift is at most two. Parsing both ends as local
      // midnight instead, or swapping Math.round for floor or ceil, all survive every test in the
      // repository, because with UTC midnight ends the quotient is already an exact integer and with
      // local ends the rounding corrects it. So the header's UTC claim is belt and braces on top of a
      // rounding that already makes the drift impossible. There is no assertion that could
      // distinguish them, and inventing one would mean asserting an implementation detail with no
      // observable consequence.
      expect(TaskListQuerySchema.safeParse({ from: '2025-11-02', to: '2026-11-02' }).success).toBe(
        true
      )
      expect(TaskListQuerySchema.safeParse({ from: '2025-11-02', to: '2026-11-03' }).success).toBe(
        false
      )
    })

    it('reports only the inversion, not the width, for a range that is inverted', () => {
      // The two refinements are independent, and an inverted range produces a negative span that the
      // width check passes. So the message an inverted range gets names the real problem rather than
      // both.
      const result = TaskListQuerySchema.safeParse({ from: '2026-12-31', to: '2026-01-01' })

      expect(result.error?.issues.map((issue) => issue.message)).toEqual([INVERTED_MESSAGE])
    })
  })

  describe('the schema hands the handler a clean range and nothing else', () => {
    it('drops an unknown query param rather than refusing the request', () => {
      const result = TaskListQuerySchema.safeParse({
        from: '2026-07-19',
        to: '2026-07-25',
        userId: 'user-other'
      })

      expect(result.success).toBe(true)
      expect(Object.keys(result.data!).sort()).toEqual(['from', 'to'])
    })

    it('does not coerce or reformat either end', () => {
      const result = TaskListQuerySchema.safeParse({ from: '2026-07-19', to: '2026-07-25' })

      expect(result.data?.from).toBe('2026-07-19')
      expect(result.data?.to).toBe('2026-07-25')
    })
  })
})
