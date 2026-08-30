import { eq } from 'drizzle-orm'

import { DEFAULT_CATEGORIES } from '#shared/categories'

import type { CategoryQuotaRecord, CategoryQuotaSource } from './resolveCategoryQuota'

import { useDb } from '../db/index'
import { categoryQuotas } from '../db/schema'
import { resolveCategoryQuota } from './resolveCategoryQuota'

// One entry of the finished answer both /api/me/category-quotas handlers return. It is the resolved
// shape declared once, next to the read path, the way WorkSettings is declared next to
// loadWorkSettings.
//
// source is part of the response rather than internal detail. It exists so the client never has to
// work out whether a figure is the user's own or a shipped default, because a page comparing a number
// against a hardcoded default to decide what to label it would be a second copy of the rule.
//
// There is no effectiveFrom. It carried the date of the winning row, and under the snapshot model
// there is no winning row and no date, so keeping the field would mean shipping one that only ever
// says nothing.
export interface CategoryQuotaEntry {
  categoryId: string
  quotaWph: number
  source: CategoryQuotaSource
}

// Reads a user's stored category quotas. This is the single read path over the table, mirroring
// loadWorkSchedule, so the query lives in one place and the resolver stays pure. No rows returns an
// empty array and no caller special-cases it, because the resolver then supplies the shipped default.
//
// There is no ORDER BY. The table holds one row per user and category, so there is nothing to order
// and nothing for the resolver to be independent of.
export async function loadCategoryQuotas(userId: string): Promise<CategoryQuotaRecord[]> {
  const db = useDb()

  const rows = await db
    .select({
      categoryId: categoryQuotas.categoryId,
      quotaWph: categoryQuotas.quotaWph
    })
    .from(categoryQuotas)
    .where(eq(categoryQuotas.userId, userId))
    .all()

  return rows.map((row) => ({ categoryId: row.categoryId, quotaWph: row.quotaWph }))
}

// One resolved entry per trackable category, in contract order, each already resolved to the figure
// currently in force. This is what both handlers return, so the GET and the PATCH read-back cannot
// disagree about what the database holds.
//
// Non-trackable categories are absent rather than present with a null quota, which is the contract's
// "a non-trackable category has no quota" expressed as absence and means the client renders what it is
// handed instead of filtering on a flag itself.
//
// Nothing here reads a clock or a timezone. The resolution is not date-dependent under the snapshot
// model, so todayInZone and the loadWorkSettings call this used to make are both gone, which removes a
// dependency rather than adding one.
export async function loadResolvedCategoryQuotas(userId: string): Promise<CategoryQuotaEntry[]> {
  const records = await loadCategoryQuotas(userId)

  const entries: CategoryQuotaEntry[] = []
  for (const category of DEFAULT_CATEGORIES) {
    if (!category.trackable) continue

    const resolved = resolveCategoryQuota(category.id, records)
    // A trackable default category always resolves, since it carries a shipped figure, so this guard
    // is for the PLAN-30 case of a trackable category with no shipped default rather than for any of
    // the ten. Skipping keeps the endpoint total instead of returning an entry with no number in it.
    if (!resolved) continue

    entries.push({
      categoryId: category.id,
      quotaWph: resolved.quotaWph,
      source: resolved.source
    })
  }

  return entries
}
