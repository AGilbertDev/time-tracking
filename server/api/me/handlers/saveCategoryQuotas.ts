import type { H3Event } from 'h3'

import { todayInZone } from '#shared/planning'

import type { CategoryQuotasPatch } from '../../../models/category-quotas'
import type { CategoryQuotaEntry } from '../../../utils/loadCategoryQuotas'

import { useDb } from '../../../db/index'
import { categoryQuotas } from '../../../db/schema'

// Writes the submitted per-category quotas for one effective date and returns the full resolved set so
// the client can reconcile against what the database actually holds rather than against what it sent.
// Only the categories present in the body are written and the others are untouched, which is the same
// partial idiom saveWorkSettings uses. The write is always scoped to the session user.
//
// The effective date is the one the body names, or today in the user's own stored timezone. The zone
// comes from the user's settings rather than from the server's clock, so an edit made late in the
// evening does not land on tomorrow's date, and no date ever arrives from the client's clock.
//
// Each row is an upsert on (user_id, category_id, effective_from), the unique index being the conflict
// target, so saving twice on the same day updates that day's row instead of piling up rows the
// resolver would have to break a tie between. That is also how a typo is corrected, and it is why an
// edit never restates a period already reported: a new date writes a new row and leaves every earlier
// row exactly as it was.
//
// One statement per row, and no transaction. A failure part way through leaves some rows written and
// some not, which is a valid state rather than a stranded one: every row that landed is a complete,
// correctly dated row, every row that did not is still resolving its previous value or the shipped
// default, and saving again upserts on the same key and converges. Each row is independently
// meaningful, unlike a two-table write where half the state is nonsense.
export async function saveCategoryQuotas(
  event: H3Event,
  body: CategoryQuotasPatch
): Promise<CategoryQuotaEntry[]> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const { timezone } = await loadWorkSettings(user.id)
  const effectiveFrom = body.effectiveFrom ?? todayInZone(new Date(), timezone)

  for (const entry of body.quotas) {
    await db
      .insert(categoryQuotas)
      .values({
        userId: user.id,
        categoryId: entry.categoryId,
        quotaWph: entry.quotaWph,
        effectiveFrom
      })
      .onConflictDoUpdate({
        target: [categoryQuotas.userId, categoryQuotas.categoryId, categoryQuotas.effectiveFrom],
        // updatedAt is set here as well as on insert, because $defaultFn only fires for an insert and
        // a row corrected later in the day should say when it was corrected.
        set: { quotaWph: entry.quotaWph, updatedAt: new Date() }
      })
  }

  // Read back through the single read path so the response is the same shape the GET returns and
  // reflects exactly what the database now holds, including the rows this call did not touch.
  return loadResolvedCategoryQuotas(user.id)
}
