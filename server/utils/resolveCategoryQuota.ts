import { defaultQuotaWph, isTrackableCategory } from '#shared/categories'

// The per-category quota resolution, in one place, pure and database-free (PLAN-32b).
//
// This lives under server/utils rather than in shared/ on purpose, and that is a deliberate
// departure from how resolveSchedule was done. resolveSchedule is pure and sits in shared/planning.ts,
// and the dashboard page calls it, so the client resolves the schedule itself. A pure resolver in
// shared/ is an open invitation to do the same thing with a quota, and there is no second consumer
// that needs one on the client, because the API returns finished figures. Keeping it server-side is
// what makes "no quota is computed in a component" enforceable rather than hoped for.
//
// Nothing here is effective dated. The snapshot model the owner approved on 2026-08-24 keeps one
// current row per user and category and writes the figure onto the task instead, so no step compares
// a date to anything and no function here takes a date at all.

// One stored row from category_quotas, as the read path returns it and as the resolver consumes it.
// Declared here rather than next to the query so the resolver can be tested without touching a
// database, which is the same split loadWorkSchedule keeps with WorkScheduleRecord.
export interface CategoryQuotaRecord {
  categoryId: string
  quotaWph: number
}

// Where a resolved figure came from. A client is handed this rather than left to compare a number
// against a hardcoded default, because that comparison would be a second copy of the rule.
export type CategoryQuotaSource = 'default' | 'user'

// The same, plus the one source only a single task can have. It is named 'task' rather than
// 'override' because under the snapshot model the figure on the task is the record rather than an
// exception to one: the write path puts it there for every task written in a trackable category.
export type TaskQuotaSource = CategoryQuotaSource | 'task'

// A resolved quota for a category.
export interface ResolvedCategoryQuota {
  quotaWph: number
  source: CategoryQuotaSource
}

// A resolved quota for one task. The source is what tells the task's own stored figure apart from
// the category's current setting and from the shipped default.
export interface ResolvedTaskQuota {
  quotaWph: number
  source: TaskQuotaSource
}

// The user's own current figure for one category, or the category's shipped default when they have
// no row for it, or null when the category carries no quota at all.
//
// The trackable gate comes first and it is a gate rather than a last resort. A non-trackable category
// has no quota by definition, so no stored row and no shipped number can produce one, and the check
// coerces the id first so an unknown or retired value resolves to the non-trackable fallback and
// returns null. That is the same fail-closed direction the contract documents for isTrackableCategory,
// which is that words must never reach a quota numerator by accident.
//
// There is at most one row per user and category, guaranteed by the unique index, so the scan below
// takes the first match rather than choosing between candidates. A row naming a category this is not
// asked about never participates, which is what makes a row for a retired or renamed id harmless.
// Such a row is left in place rather than deleted, so if the id comes back its quota comes back with
// it.
export function resolveCategoryQuota(
  categoryId: unknown,
  records: readonly CategoryQuotaRecord[]
): ResolvedCategoryQuota | null {
  if (!isTrackableCategory(categoryId)) return null

  const stored = records.find((record) => record.categoryId === categoryId)
  if (stored) return { quotaWph: stored.quotaWph, source: 'user' }

  // The shipped default, and null when there is none. A user-created category from PLAN-30 has no
  // shipped number, so a trackable one with no stored row resolves to null rather than to a figure
  // invented for a kind of work nobody has described yet.
  const shipped = defaultQuotaWph(categoryId)
  if (shipped === null) return null

  return { quotaWph: shipped, source: 'default' }
}

// The quota one task is measured against, or null when the task's category carries none.
//
// The order is the trackable gate, then the task's own stored figure, then the user's current row for
// the category, then the category's shipped default. The gate is first for a reason that matters
// today rather than in theory. The task editor shows the quota field for every category on purpose, so
// a user can type a figure onto a meeting or a break, and taking the stored figure first would hand a
// non-trackable task a quota. The stored figure is left alone rather than cleared, so recategorizing
// the row to a trackable category brings it back and nothing is destroyed to enforce the gate.
//
// Steps three and four are a narrower set than they used to be. A task written through the API in a
// trackable category carries its own figure, so the fallback is reached by exactly three kinds of row:
// a task written before PLAN-32b, a task whose figure the user deliberately cleared, and a task
// inserted outside the write path, which today means the dev seed. All three are real, so the fallback
// is live code rather than a leftover.
//
// This has no runtime caller. The write path resolves a category rather than a task, so PLAN-22 is
// still the feature that reads this one. It is written down here with tests anyway, because the
// resolution order is a decided rule and writing it once is what stops it being re-derived under
// pressure later.
export function resolveTaskQuota(
  task: { category: unknown; quotaWphOverride?: number | null },
  records: readonly CategoryQuotaRecord[]
): ResolvedTaskQuota | null {
  if (!isTrackableCategory(task.category)) return null

  // A stored figure has to be a usable divisor before it wins. No API path can write a zero or a
  // negative today, because quotaWphSchema floors the field at 1, so this is defence against a row
  // that got there some other way rather than a live bug. It is worth keeping anyway, since the quota
  // is the divisor in words over quota and a zero reaching that division is exactly the failure this
  // file's fail-closed direction exists to prevent. An unusable value is treated as no figure at all,
  // which is the same path a NULL takes, so the row falls through to its category's quota rather than
  // losing a perfectly good figure. Do not remove this as dead defensive code.
  if (
    task.quotaWphOverride !== null &&
    task.quotaWphOverride !== undefined &&
    task.quotaWphOverride > 0
  ) {
    return { quotaWph: task.quotaWphOverride, source: 'task' }
  }

  return resolveCategoryQuota(task.category, records)
}
