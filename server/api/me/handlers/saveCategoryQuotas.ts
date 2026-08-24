import type { H3Event } from 'h3'

import type { CategoryQuotasPatch } from '../../../models/category-quotas'
import type { CategoryQuotaEntry } from '../../../utils/loadCategoryQuotas'

import { useDb } from '../../../db/index'
import { categoryQuotas } from '../../../db/schema'

// Writes the submitted per-category quotas and returns the full resolved set so the client can
// reconcile against what the database actually holds rather than against what it sent. Only the
// categories present in the body are written and the others are untouched, which is the same partial
// idiom saveWorkSettings uses. The write is always scoped to the session user.
//
// Each row is an upsert on (user_id, category_id), the unique index being the conflict target, so a
// save updates the user's single current row for that category rather than appending a new one. There
// is no date on the body and none to store: under the snapshot model the figure a task is measured
// against is written onto the task when the task is written, so editing here changes what future tasks
// are measured against and cannot reach a task that already exists.
//
// One statement per row, and no transaction. A failure part way through leaves some rows written and
// some not, which is a valid state rather than a stranded one: every row that landed holds a complete
// figure, every row that did not is still resolving its previous value or the shipped default, and
// saving again upserts on the same key and converges. Each row is independently meaningful, unlike a
// two-table write where half the state is nonsense.
export async function saveCategoryQuotas(
  event: H3Event,
  body: CategoryQuotasPatch
): Promise<CategoryQuotaEntry[]> {
  const { user } = await requireUserSession(event)
  const db = useDb()

  for (const entry of body.quotas) {
    await db
      .insert(categoryQuotas)
      .values({
        userId: user.id,
        categoryId: entry.categoryId,
        quotaWph: entry.quotaWph
      })
      .onConflictDoUpdate({
        target: [categoryQuotas.userId, categoryQuotas.categoryId],
        // updatedAt is set here as well as on insert, because $defaultFn only fires for an insert and
        // an update that forgets it leaves a stale instant, which is the mistake update.ts avoids the
        // same way.
        set: { quotaWph: entry.quotaWph, updatedAt: new Date() }
      })
  }

  // Read back through the single read path so the response is the same shape the GET returns and
  // reflects exactly what the database now holds, including the rows this call did not touch.
  return loadResolvedCategoryQuotas(user.id)
}
