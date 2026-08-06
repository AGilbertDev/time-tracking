import { joinDuration, splitDuration } from '~~/app/utils/taskDuration'
import { describe, expect, it } from 'vitest'

// The hours-and-minutes marshalling behind Durée estimée and Durée réelle.
//
// Every case below is derived from docs/specs/planning/task-inline-editor.md rather than from the
// module. The criteria it answers are AC21 (a null contract field renders as an empty control rather
// than as the string null), AC25 (the two durations are independent plain inputs), AC27 (clearing
// Durée réelle sends actualMinutes: null, entering zero sends 0, and the two are distinguishable),
// and AC62 (the hours-and-minutes conversion is covered at its boundaries, including a cleared value
// against a zero value).
//
// The one thing worth stating plainly, because a helpful coercion anywhere in this chain would erase
// it silently and no visual check would catch it. A null total means the work was never measured and
// the row falls back to the estimate through effectiveDuration. A zero total is a measurement that
// came out at zero and does not fall back. So an empty pair of boxes has to marshal back to null and
// a pair of zeroes has to marshal back to 0, and the two can never collapse into each other.

describe('splitDuration', () => {
  // AC21: a null contract field is an empty control. Both boxes are empty rather than showing 0,
  // because a 0 in the box would then be saved back as a measurement the user never made.
  it('turns a null total into two empty boxes', () => {
    expect(splitDuration(null)).toEqual({ hours: null, minutes: null })
  })

  it('turns an absent total into two empty boxes', () => {
    expect(splitDuration(undefined)).toEqual({ hours: null, minutes: null })
  })

  // AC27, the half of the distinction that lives on the way in. A stored zero is real recorded data,
  // so it shows as a pair of zeroes and not as two empty boxes.
  it('turns a stored zero into a pair of zeroes rather than empty boxes', () => {
    expect(splitDuration(0)).toEqual({ hours: 0, minutes: 0 })
  })

  it('never renders the same pair for a null total and a zero total', () => {
    expect(splitDuration(null)).not.toEqual(splitDuration(0))
  })

  it.each([
    [1, { hours: 0, minutes: 1 }],
    [45, { hours: 0, minutes: 45 }],
    [59, { hours: 0, minutes: 59 }],
    [60, { hours: 1, minutes: 0 }],
    [90, { hours: 1, minutes: 30 }],
    [1440, { hours: 24, minutes: 0 }]
  ])('splits %i minutes into its hours and minutes pair', (total, expected) => {
    expect(splitDuration(total)).toEqual(expected)
  })

  // A duration is whole minutes on both sides of the boundary, so the minutes box is never allowed
  // to hold sixty or more and the pair is never fractional.
  it.each([1, 45, 60, 90, 599, 1440, 100_000])(
    'keeps the minutes box under an hour and both halves whole for %i',
    (total) => {
      const parts = splitDuration(total)

      expect(parts.minutes).toBeGreaterThanOrEqual(0)
      expect(parts.minutes).toBeLessThan(60)
      expect(Number.isInteger(parts.hours)).toBe(true)
      expect(Number.isInteger(parts.minutes)).toBe(true)
    }
  )

  // AC21 again, read as widely as it deserves. A box must never be handed a value it cannot render,
  // so a total that is not a real number is an empty pair rather than a pair of NaN.
  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'treats the unusable total %p as two empty boxes',
    (total) => {
      expect(splitDuration(total)).toEqual({ hours: null, minutes: null })
    }
  )
})

describe('joinDuration', () => {
  // AC27, the half that decides what the request body carries. Two empty boxes are the absence the
  // API reads as never measured, so they must produce null and never 0.
  it('turns two empty boxes into null', () => {
    expect(joinDuration({ hours: null, minutes: null })).toBeNull()
  })

  it('turns two zeroes into a measured zero rather than into null', () => {
    const total = joinDuration({ hours: 0, minutes: 0 })

    expect(total).toBe(0)
    expect(total).not.toBeNull()
  })

  it('never produces the same total for two empty boxes and two zeroes', () => {
    expect(joinDuration({ hours: null, minutes: null })).not.toBe(
      joinDuration({ hours: 0, minutes: 0 })
    )
  })

  it.each([
    [{ hours: 0, minutes: 1 }, 1],
    [{ hours: 0, minutes: 45 }, 45],
    [{ hours: 1, minutes: 0 }, 60],
    [{ hours: 1, minutes: 30 }, 90],
    [{ hours: 24, minutes: 0 }, 1440]
  ])('joins %j into %i minutes', (parts, expected) => {
    expect(joinDuration(parts)).toBe(expected)
  })

  // Only a fully empty pair is a cleared duration. A box holding a typed number is not cleared, and
  // dropping the value the user typed because the other box is empty would lose real work, which the
  // "nothing is lost" rule in the interrupted-paths table rules out.
  it('counts an empty hours box beside typed minutes as those minutes', () => {
    expect(joinDuration({ hours: null, minutes: 30 })).toBe(30)
  })

  it('counts an empty minutes box beside typed hours as those hours', () => {
    expect(joinDuration({ hours: 2, minutes: null })).toBe(120)
  })

  it('reads a typed zero beside an empty box as a measurement rather than as nothing', () => {
    expect(joinDuration({ hours: null, minutes: 0 })).toBe(0)
    expect(joinDuration({ hours: 0, minutes: null })).toBe(0)
  })

  // The editor adds no rule the write API does not already enforce, so what it marshals has to be
  // something that boundary accepts: a whole number of minutes, never negative. The exact value a
  // nonsensical pair resolves to is not specified, so only the invariant is asserted here.
  it.each([
    { hours: -1, minutes: 0 },
    { hours: 0, minutes: -30 },
    { hours: 0.5, minutes: 0 },
    { hours: 0, minutes: 10.4 }
  ])('marshals the out-of-contract pair %j into a whole, non-negative total', (parts) => {
    const total = joinDuration(parts)

    expect(typeof total).toBe('number')
    expect(Number.isInteger(total)).toBe(true)
    expect(total as number).toBeGreaterThanOrEqual(0)
  })
})

describe('the two conversions round-trip', () => {
  // AC25 and AC27 together. The pair of boxes is only a second view of the stored integer, so a
  // value that goes out to the widget and comes back unedited has to be the same value. If it were
  // not, opening a row and saving another field would rewrite a duration nobody touched.
  it.each([0, 1, 30, 59, 60, 90, 1440, 100_000])('returns %i unchanged', (total) => {
    expect(joinDuration(splitDuration(total))).toBe(total)
  })

  it('returns an unmeasured duration as null rather than as zero', () => {
    expect(joinDuration(splitDuration(null))).toBeNull()
  })

  it('keeps a measured zero and an unmeasured duration apart across a full round trip', () => {
    expect(joinDuration(splitDuration(0))).toBe(0)
    expect(joinDuration(splitDuration(null))).toBeNull()
  })
})
