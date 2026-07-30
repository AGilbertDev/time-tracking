import {
  isValidCalendarDay,
  isValidClockTime,
  TaskCreateSchema,
  TaskIdParamSchema,
  TaskUpdateSchema
} from '~~/server/models/tasks'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORY_IDS } from '#shared/categories'

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

describe('isValidCalendarDay', () => {
  it('accepts a real calendar day', () => {
    expect(isValidCalendarDay('2026-07-20')).toBe(true)
  })

  it('accepts February 29 in a leap year', () => {
    expect(isValidCalendarDay('2024-02-29')).toBe(true)
  })

  // The round-trip check is the point: 2026-02-31 passes the shape and is not a real day, and
  // JavaScript would otherwise roll it forward into March.
  it('rejects a shape-valid day that is not a real date', () => {
    expect(isValidCalendarDay('2026-02-31')).toBe(false)
  })

  it('rejects February 29 in a non-leap year', () => {
    expect(isValidCalendarDay('2026-02-29')).toBe(false)
  })

  it.each(['2026-13-01', '2026-00-10', '2026-07-32', '20260720', '2026-7-20', '26-07-20', ''])(
    'rejects the malformed day %s',
    (value) => {
      expect(isValidCalendarDay(value)).toBe(false)
    }
  )
})

describe('isValidClockTime (HH:MM, 24-hour)', () => {
  it.each(['00:00', '09:30', '13:45', '23:59'])('accepts %s', (value) => {
    expect(isValidClockTime(value)).toBe(true)
  })

  it.each(['24:00', '12:60', '9:30', '13:5', '1345', '13:45:00', ''])('rejects %s', (value) => {
    expect(isValidClockTime(value)).toBe(false)
  })
})

describe('TaskCreateSchema', () => {
  describe('required fields (AC10)', () => {
    // Only date and category are required, because they are the only two NOT NULL columns with no
    // default. Adding a break or a meeting should cost the user nothing more.
    it('accepts a body of only date and category', () => {
      const result = TaskCreateSchema.safeParse(MINIMAL_CREATE)

      expect(result.success).toBe(true)
      expect(result.data).toEqual(MINIMAL_CREATE)
    })

    it('rejects a body with no date', () => {
      expect(TaskCreateSchema.safeParse({ category: 'translation' }).success).toBe(false)
    })

    it('rejects a body with no category', () => {
      expect(TaskCreateSchema.safeParse({ date: '2026-07-20' }).success).toBe(false)
    })

    // The columns are NOT NULL, so neither field is nullable even though most of the others are.
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
