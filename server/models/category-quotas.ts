import { z } from 'zod'

import { DEFAULT_CATEGORY_IDS, isTrackableCategory } from '#shared/categories'

import { quotaWphSchema } from './work-settings'

// The request boundary for PATCH /api/me/category-quotas (PLAN-32b).
//
// A category id here is validated against the contract and rejected rather than coerced, for the same
// reason the task write boundary rejects one. The client picked from a list the server gave it, so an
// unknown id is a client bug or a hostile request rather than history, and silently storing a quota
// against some other category would be data corruption dressed as robustness. coerceCategory defends
// the read path against ids already in the database, which is a different job. PLAN-30 turns this
// static set into a per-user lookup.
const trackableCategoryIdSchema = z.enum(DEFAULT_CATEGORY_IDS).refine(isTrackableCategory, {
  message: 'Category must be a trackable category.'
})

// One category and the figure being saved for it. quotaWph reuses the shared validator that also
// bounds the per-task override, so the two cannot drift. Its floor of 1 matters because the quota is
// the divisor in words over quota, and a stored 0 would divide by zero the moment PLAN-12 reads it.
// A high or low figure inside the range is accepted without comment, because the app records what the
// user tells it and does not police the figure.
const CategoryQuotaEntrySchema = z
  .object({
    categoryId: trackableCategoryIdSchema,
    quotaWph: quotaWphSchema
  })
  .strict()

// The PATCH body. It is partial by design, like the work-settings save: only the categories present
// are written and the others are left exactly as they are.
//
// There is no effectiveFrom. Under the snapshot model the table holds one current figure per category
// and the save updates it in place, so a date on the body would be a parameter with nowhere to be
// stored. What a past period was measured against is preserved on the task instead, which carries the
// figure it was written against.
export const CategoryQuotasPatchSchema = z
  .object({
    quotas: z
      .array(CategoryQuotaEntrySchema)
      .min(1, { message: 'At least one quota must be provided.' })
      // A duplicate category in one body has two answers for one row and no way to choose between
      // them, so it is a client bug worth surfacing rather than a last-one-wins upsert.
      .refine((quotas) => new Set(quotas.map((entry) => entry.categoryId)).size === quotas.length, {
        message: 'Quotas must not contain the same category twice.'
      })
  })
  .strict()

export type CategoryQuotasPatch = z.infer<typeof CategoryQuotasPatchSchema>
