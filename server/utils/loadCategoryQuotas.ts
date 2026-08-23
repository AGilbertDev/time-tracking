import { asc, eq } from 'drizzle-orm'

import { DEFAULT_CATEGORIES } from '#shared/categories'
import { todayInZone } from '#shared/planning'

import type { CategoryQuotaRecord, CategoryQuotaSource } from './resolveCategoryQuota'

import { useDb } from '../db/index'
import { categoryQuotas } from '../db/schema'
import { loadWorkSettings } from './loadWorkSettings'
import { resolveCategoryQuota } from './resolveCategoryQuota'

// One entry of the finished answer both /api/me/category-quotas handlers return. It is the resolved
// shape declared once, next to the read path, the way WorkSettings is declared next to
// loadWorkSettings.
//
// source and effectiveFrom are part of the response rather than internal detail. They exist so the
// client never has to work out whether a figure is the user's own or a shipped default, because a page
// comparing a number against a hardcoded default to decide what to label it would be a second copy of
// the rule.
export interface CategoryQuotaEntry {
  categoryId: string
  effectiveFrom: string | null
  quotaWph: number
  source: CategoryQuotaSource
}

// Reads a user's stored category quotas, ordered by effective_from ascending. This is the single read
// path over the table, mirroring loadWorkSchedule, so the query lives in one place and the resolver
// stays pure. An empty history returns an empty array and no caller special-cases it, because the
// resolver then supplies the shipped default for any date.
//
// The ordering is for legibility rather than for correctness. The resolver scans rather than assuming
// order, so an unordered list resolves identically.
export async function loadCategoryQuotas(userId: string): Promise<CategoryQuotaRecord[]> {
  const db = useDb()

  const rows = await db
    .select({
      categoryId: categoryQuotas.categoryId,
      effectiveFrom: categoryQuotas.effectiveFrom,
      quotaWph: categoryQuotas.quotaWph
    })
    .from(categoryQuotas)
    .where(eq(categoryQuotas.userId, userId))
    .orderBy(asc(categoryQuotas.effectiveFrom))
    .all()

  return rows.map((row) => ({
    categoryId: row.categoryId,
    effectiveFrom: row.effectiveFrom,
    quotaWph: row.quotaWph
  }))
}

// One resolved entry per trackable category, in contract order, each already resolved for today in the
// user's own stored timezone. This is what both handlers return, so the GET and the PATCH read-back
// cannot disagree about what the database holds.
//
// Non-trackable categories are absent rather than present with a null quota, which is the contract's
// "a non-trackable category has no quota" expressed as absence and means the client renders what it is
// handed instead of filtering on a flag itself.
//
// Today comes from todayInZone against the timezone the user stored, so an edit made late in the
// evening does not land on tomorrow's date and no client clock decides which quota is current. `now` is
// a parameter only so a test can pin the instant, and every caller leaves it alone.
export async function loadResolvedCategoryQuotas(
  userId: string,
  now: Date = new Date()
): Promise<CategoryQuotaEntry[]> {
  const [records, workSettings] = await Promise.all([
    loadCategoryQuotas(userId),
    loadWorkSettings(userId)
  ])

  const today = todayInZone(now, workSettings.timezone)

  const entries: CategoryQuotaEntry[] = []
  for (const category of DEFAULT_CATEGORIES) {
    if (!category.trackable) continue

    const resolved = resolveCategoryQuota(category.id, records, today)
    // A trackable default category always resolves, since it carries a shipped figure, so this guard
    // is for the PLAN-30 case of a trackable category with no shipped default rather than for any of
    // the ten. Skipping keeps the endpoint total instead of returning an entry with no number in it.
    if (!resolved) continue

    entries.push({
      categoryId: category.id,
      effectiveFrom: resolved.effectiveFrom,
      quotaWph: resolved.quotaWph,
      source: resolved.source
    })
  }

  return entries
}
