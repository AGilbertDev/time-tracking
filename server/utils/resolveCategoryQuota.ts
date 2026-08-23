import { defaultQuotaWph, isTrackableCategory } from '#shared/categories'

// The per-category quota resolution, in one place, pure and database-free (PLAN-32b).
//
// This lives under server/utils rather than in shared/ on purpose, and that is a deliberate
// departure from how resolveSchedule was done. resolveSchedule is pure and sits in shared/planning.ts,
// and the dashboard page calls it, so the client resolves the schedule itself. A pure resolver in
// shared/ is an open invitation to do the same thing with a quota, and there is no second consumer
// that needs one on the client, because the API returns finished figures. Keeping it server-side is
// what makes "no quota is computed in a component" enforceable rather than hoped for.

// One stored row from category_quotas, as the read path returns it and as the resolver consumes it.
// Declared here rather than next to the query so the resolver can be tested without touching a
// database, which is the same split loadWorkSchedule keeps with WorkScheduleRecord.
export interface CategoryQuotaRecord {
  categoryId: string
  effectiveFrom: string
  quotaWph: number
}

// Where a resolved figure came from. A client is handed this rather than left to compare a number
// against a hardcoded default, because that comparison would be a second copy of the rule.
export type CategoryQuotaSource = 'default' | 'user'

// The same, plus the one source only a single task can have.
export type TaskQuotaSource = CategoryQuotaSource | 'override'

// A resolved quota for a category on a date. effectiveFrom is the date of the winning stored row, or
// null when the figure is the shipped default and therefore belongs to no dated row.
export interface ResolvedCategoryQuota {
  effectiveFrom: string | null
  quotaWph: number
  source: CategoryQuotaSource
}

// A resolved quota for one task. effectiveFrom is null for an override as well as for a default,
// because a per-task override is not effective-dated. The source is what tells the two apart.
export interface ResolvedTaskQuota {
  effectiveFrom: string | null
  quotaWph: number
  source: TaskQuotaSource
}

// The user's own figure for one category on one date, or the category's shipped default when they
// have no row effective by then, or null when the category carries no quota at all.
//
// The trackable gate comes first and it is a gate rather than a last resort. A non-trackable category
// has no quota by definition, so no stored row and no shipped number can produce one, and the check
// coerces the id first so an unknown or retired value resolves to the non-trackable fallback and
// returns null. That is the same fail-closed direction the contract documents for isTrackableCategory,
// which is that words must never reach a quota numerator by accident.
//
// The winning row is the one with the latest effective_from on or before the date being resolved, so
// a date earlier than every stored row falls through to the shipped default and there is no gap and
// no discontinuity. Rows are scanned rather than assumed ordered, so an unordered list resolves the
// same as an ordered one and the read path's ORDER BY is an optimisation rather than a precondition.
//
// A row naming a category this is not asked about never participates, which is what makes a row for a
// retired or renamed id harmless. Such a row is left in place rather than deleted, so if the id comes
// back its quota comes back with it.
export function resolveCategoryQuota(
  categoryId: unknown,
  records: readonly CategoryQuotaRecord[],
  on: string
): ResolvedCategoryQuota | null {
  if (!isTrackableCategory(categoryId)) return null

  let winner: CategoryQuotaRecord | undefined
  for (const record of records) {
    if (record.categoryId !== categoryId) continue
    if (record.effectiveFrom > on) continue
    // Both dates are 'YYYY-MM-DD', so the later one is the greater string and no date arithmetic is
    // needed to compare them.
    if (!winner || record.effectiveFrom > winner.effectiveFrom) winner = record
  }

  if (winner) {
    return { effectiveFrom: winner.effectiveFrom, quotaWph: winner.quotaWph, source: 'user' }
  }

  // The shipped default, and null when there is none. A user-created category from PLAN-30 has no
  // shipped number, so a trackable one with no stored row resolves to null rather than to a figure
  // invented for a kind of work nobody has described yet.
  const shipped = defaultQuotaWph(categoryId)
  if (shipped === null) return null

  return { effectiveFrom: null, quotaWph: shipped, source: 'default' }
}

// The quota one task is measured against, or null when the task's category carries none.
//
// The order is the trackable gate, then the task's own override, then the user's stored row effective
// on the task's date, then the category's shipped default. The gate is first for a reason that matters
// today rather than in theory. The task editor shows the quota field for every category on purpose, so
// a user can type an override onto a meeting or a break, and taking the override first would hand a
// non-trackable task a quota. The stored override is left alone rather than cleared, so recategorizing
// the row to a trackable category brings it back and nothing is destroyed to enforce the gate.
//
// This has no runtime caller yet, which is accepted deliberately. The resolution order is a decided
// rule, writing it down once with tests is what stops it being re-derived under pressure later, and
// PLAN-22 is the feature that reads it.
export function resolveTaskQuota(
  task: { category: unknown; date: string; quotaWphOverride?: number | null },
  records: readonly CategoryQuotaRecord[]
): ResolvedTaskQuota | null {
  if (!isTrackableCategory(task.category)) return null

  // A stored override has to be a usable divisor before it wins. No API path can write a zero or a
  // negative today, because quotaWphSchema floors the override at 1, so this is defence against a row
  // that got there some other way rather than a live bug. It is worth keeping anyway, since the quota
  // is the divisor in words over quota and a zero reaching that division is exactly the failure this
  // file's fail-closed direction exists to prevent. An unusable value is treated as no override at all,
  // which is the same path a NULL takes, so the row falls through to its category's quota rather than
  // losing a perfectly good figure. Do not remove this as dead defensive code.
  if (
    task.quotaWphOverride !== null &&
    task.quotaWphOverride !== undefined &&
    task.quotaWphOverride > 0
  ) {
    return { effectiveFrom: null, quotaWph: task.quotaWphOverride, source: 'override' }
  }

  return resolveCategoryQuota(task.category, records, task.date)
}
