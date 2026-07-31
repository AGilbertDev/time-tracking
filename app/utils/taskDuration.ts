// Marshalling between a duration stored as whole minutes and the hours-and-minutes pair the task
// editor shows. This is input marshalling rather than a business rule: the same fact is on screen as
// two boxes and in the column as one integer, and nothing about that has any meaning off the screen.
// So it stays on the client, and it stays in a pure module rather than inline in the component so it
// can be unit-tested at its boundaries, following the precedent app/utils/account.ts sets.
//
// It deliberately does not reuse clampMinutes from app/components/settings/work-fields.vue. That
// helper clamps into 1 through 1440 because dailyWorkMinutes is required and can never be null, and
// both task durations are nullable. Durée réelle in particular is genuinely nullable: clearing it
// means the work was never measured and the row falls back to the estimate, while a stored zero is a
// measurement of zero and does not fall back. Coercing an empty pair to 0 would erase that
// distinction, which is the one thing this module exists to protect.

// A duration as the two controls hold it. Null means the box is empty, which is what UInputNumber
// emits when its input is cleared, rather than 0.
export type DurationParts = { hours: number | null; minutes: number | null }

// The two boxes for a stored duration. A null total is two empty boxes, and a stored 0 is two zeroes,
// so the pair says which of the two it is. A negative or fractional total cannot come from the API's
// integer schema, and is floored at zero and rounded rather than trusted, so the pair is never
// negative and never fractional.
export function splitDuration(total: number | null | undefined): DurationParts {
  if (typeof total !== 'number' || !Number.isFinite(total)) return { hours: null, minutes: null }

  const safe = Math.max(0, Math.round(total))
  return { hours: Math.floor(safe / 60), minutes: safe % 60 }
}

// The stored total for a pair of boxes. Two empty boxes are null, the absence the API reads as "not
// measured". One empty box beside a filled one counts the empty half as zero, because a user who
// typed 30 in the minutes box has entered half an hour rather than nothing. Two zeroes are 0, a real
// measurement, which is what keeps AC27's two cases apart.
export function joinDuration(parts: DurationParts): number | null {
  const { hours, minutes } = parts
  if (hours === null && minutes === null) return null

  const total = (hours ?? 0) * 60 + (minutes ?? 0)
  return Math.max(0, Math.round(total))
}
