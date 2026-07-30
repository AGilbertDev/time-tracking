import { TaskUpdateSchema } from '~~/server/models/tasks'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// sendZodError is the house error contract: it turns a ZodError into a structured 422 with a `data`
// object keyed by field name, so a client can say which field is wrong rather than only that the
// body was. Every expectation below comes from docs/specs/planning/task-write-api.md, the
// "validation and the error contract" section and acceptance criteria 6 and 7, not from reading the
// implementation as correct.
//
// This module had no test at all before PLAN-09, and PLAN-09 is what made the gap matter. The write
// schemas are strict(), and a strict object reports every rejected key in ONE issue carrying an
// empty path. Keying that issue by its path alone would drop it and leave a 422 whose `data` is
// empty, which is exactly the case AC7 needs to be actionable: a client that sent `userId` has to be
// told that `userId` is the field that is not writable.
//
// A top-level refine has an empty path for the same reason, so the contract answers both the same
// way: an issue that names no field is filed under FORM_LEVEL_KEY and `data` is never empty. The
// last block below covers that, and says why its old expectation was wrong.

// createError is a Nitro auto-import, so in the raw source it resolves to globalThis. A minimal
// stand-in keeps statusCode, statusMessage, and data assertable.
type ThrownError = { statusCode: number; statusMessage: string; data: Record<string, string> }

beforeEach(() => {
  vi.stubGlobal(
    'createError',
    (opts: { statusCode: number; statusMessage: string; data: unknown }) =>
      Object.assign(new Error(opts.statusMessage), opts)
  )
})

const { FORM_LEVEL_KEY, sendZodError } = await import('~~/server/utils/sendZodError')

// Runs a real schema to get a real ZodError, rather than hand-building issue objects. A hand-built
// issue would encode this test's guess at Zod's shape, and the whole point of the unrecognized_keys
// branch is that Zod's actual shape is not what a naive path-keyed loop expects.
function errorFrom(schema: z.ZodType, value: unknown): z.ZodError {
  const result = schema.safeParse(value)
  if (result.success)
    throw new Error('The fixture parsed successfully, so there is no error to map.')
  return result.error
}

function thrownBy(schema: z.ZodType, value: unknown): ThrownError {
  try {
    sendZodError(errorFrom(schema, value))
  } catch (error) {
    return error as ThrownError
  }
  throw new Error('sendZodError returned instead of throwing.')
}

describe('sendZodError', () => {
  describe('the status code and the thrown shape', () => {
    it('throws rather than returning, so a route can call it as the whole of its failure branch', () => {
      const schema = z.object({ date: z.string() })

      expect(() => sendZodError(errorFrom(schema, {}))).toThrow()
    })

    it('reports 422 rather than a 500 or a 400', () => {
      const schema = z.object({ date: z.string() })

      expect(thrownBy(schema, {}).statusCode).toBe(422)
    })
  })

  describe('per-field messages', () => {
    it('keys data by the field name that failed', () => {
      const schema = z.object({
        date: z.string().refine(() => false, { message: 'Must be a real calendar day.' })
      })

      expect(thrownBy(schema, { date: 'nonsense' }).data).toEqual({
        date: 'Must be a real calendar day.'
      })
    })

    it('reports both fields when a body fails two of them', () => {
      const schema = z.object({
        date: z.string().refine(() => false, { message: 'Bad date.' }),
        category: z.string().refine(() => false, { message: 'Bad category.' })
      })

      const data = thrownBy(schema, { date: 'x', category: 'y' }).data

      expect(data).toEqual({ date: 'Bad date.', category: 'Bad category.' })
    })

    it('joins a nested path with a dot so the client can locate the field', () => {
      const schema = z.object({
        range: z.object({ to: z.string().refine(() => false, { message: 'Bad end.' }) })
      })

      expect(thrownBy(schema, { range: { to: 'x' } }).data).toEqual({ 'range.to': 'Bad end.' })
    })

    it('concatenates every message into statusMessage', () => {
      const schema = z.object({
        date: z.string().refine(() => false, { message: 'Bad date.' }),
        category: z.string().refine(() => false, { message: 'Bad category.' })
      })

      const statusMessage = thrownBy(schema, { date: 'x', category: 'y' }).statusMessage

      expect(statusMessage).toContain('Bad date.')
      expect(statusMessage).toContain('Bad category.')
    })
  })

  describe('unrecognized_keys, the branch a strict write schema depends on', () => {
    // The regression this guards. A strict object reports all its rejected keys in one issue with an
    // empty path, so a loop that keys only by path leaves data empty and the 422 says nothing about
    // which field was refused. AC7 needs the field named, because refusing a server-owned key is
    // meant to tell the client that the key is not writable.
    it('names the rejected key in data rather than dropping it for having no path', () => {
      const schema = z.object({ date: z.string() }).strict()

      const data = thrownBy(schema, { date: '2026-07-20', userId: 'user-other' }).data

      expect(Object.keys(data)).toEqual(['userId'])
      expect(data.userId).toBeTruthy()
    })

    it('names every rejected key when a body carries several at once', () => {
      const schema = z.object({ date: z.string() }).strict()

      const data = thrownBy(schema, {
        date: '2026-07-20',
        wordsDone: 500,
        sortOrder: 3,
        splitGroupId: 'group-1'
      }).data

      expect(Object.keys(data).sort()).toEqual(['sortOrder', 'splitGroupId', 'wordsDone'])
    })

    it('reports a rejected key alongside a genuinely invalid field', () => {
      const schema = z
        .object({ date: z.string().refine(() => false, { message: 'Bad date.' }) })
        .strict()

      const data = thrownBy(schema, { date: 'x', userId: 'user-other' }).data

      expect(data.date).toBe('Bad date.')
      expect(data.userId).toBeTruthy()
    })
  })

  describe('an object-level issue with no path', () => {
    // ---------------------------------------------------------------------------------------------
    // Why this block changed. It used to assert `data` was empty here and called that a documented
    // limit rather than a defect, which was the wrong reading. The unrecognized_keys branch above
    // exists precisely because a 422 whose `data` is empty gives the client nothing to act on, and a
    // top-level refine produces the same empty path for the same reason a strict object does. So the
    // old expectation blessed one path-less case while the branch beside it fixed the other, and it
    // would have gone on passing while an empty PATCH answered with nothing in the map. It now pins
    // the contract instead: a path-less issue is filed under the form-level key.
    //
    // The predicate mirrors TaskUpdateSchema's rather than counting keys. Zod keeps a present-but-
    // undefined optional key in its output, so a key count admits a body of { date: undefined } that
    // maps to no column at all. Nothing here turns on which form is used, since both fail on {} with
    // the same path-less issue, but a fixture carrying the real message beside the rejected predicate
    // is the copy a later reader finds when they go looking for the empty-patch guard.
    // ---------------------------------------------------------------------------------------------
    const emptyPatchSchema = z
      .object({ date: z.string().optional() })
      .refine((body) => Object.values(body).some((value) => value !== undefined), {
        message: 'At least one task field must be provided.'
      })

    it('still reports 422 with the message', () => {
      const thrown = thrownBy(emptyPatchSchema, {})

      expect(thrown.statusCode).toBe(422)
      expect(thrown.statusMessage).toContain('At least one task field must be provided.')
    })

    it('files the message under the form-level key rather than dropping it', () => {
      const thrown = thrownBy(emptyPatchSchema, {})

      expect(thrown.data).toEqual({ _form: 'At least one task field must be provided.' })
    })

    // The name is the part a client hardcodes, so it is pinned as a literal here rather than read
    // back off the constant. A test that reads the same export as the code under test proves the
    // wiring and never the value, and the value is what a translation file keys off.
    it('names that key _form, the spelling the contract reserves', () => {
      expect(FORM_LEVEL_KEY).toBe('_form')
    })

    // The uniformity is the point. A client should be able to read one map for every 422 instead of
    // branching on whether this particular failure happened to name a field.
    it('never leaves data empty, whatever kind of issue produced the 422', () => {
      expect(Object.keys(thrownBy(emptyPatchSchema, {}).data).length).toBeGreaterThan(0)
    })

    it('reports a form-level failure alongside the fields that failed on their own', () => {
      const schema = z
        .object({ date: z.string().refine(() => false, { message: 'Bad date.' }) })
        .refine(() => false, { message: 'The body as a whole is wrong.' })

      const data = thrownBy(schema, { date: 'x' }).data

      expect(data).toEqual({ date: 'Bad date.', _form: 'The body as a whole is wrong.' })
    })

    // The real schema, not a mirror of it. Everything above runs against a fixture shaped like
    // TaskUpdateSchema, which proves the mapping but not that the shipped empty-patch guard actually
    // produces the shape being mapped. This is the case that closes that gap, and it is the exact
    // request the old expectation left answering with an empty map: PATCH /api/tasks/[id] with {}.
    it('makes the shipped empty-patch guard actionable, which is the case that prompted this', () => {
      const thrown = thrownBy(TaskUpdateSchema, {})

      expect(thrown.statusCode).toBe(422)
      expect(thrown.data).toEqual({ _form: 'At least one task field must be provided.' })
    })

    // A patch whose only key is present but undefined maps to no column either, so it fails the same
    // guard and has to arrive equally actionable.
    it('answers the same way for a patch whose only field is present but undefined', () => {
      expect(thrownBy(TaskUpdateSchema, { client: undefined }).data).toEqual({
        _form: 'At least one task field must be provided.'
      })
    })
  })
})
