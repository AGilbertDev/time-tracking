import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'
import { avatarStorage } from '../../../utils/avatarStorage'

// DELETE /api/me/avatar. Nulls users.avatar_url and deletes the stored object through avatarStorage,
// reverting the user to the initials circle, then refreshes the session. The target is always the
// session user; no id is read from the request. Removing when none is set is a safe no-op.
export async function removeAvatar(event: H3Event) {
  const { user } = await requireUserSession(event)

  // Idempotent no-op: the desired end state (no avatar) already holds, so there is no object to
  // delete and nothing to write. Return the same success shape without a storage call.
  if (!user.avatarUrl) {
    return { avatarUrl: null }
  }

  // No invalid states / safe recovery (spec: "Remove: row, then object"). Null the column first so
  // the app never references an object it is about to delete. If this update fails, nothing changed
  // and the user retries.
  await useDb()
    .update(users)
    .set({ avatarUrl: null, updatedAt: new Date() })
    .where(eq(users.id, user.id))

  // Then delete the stored object through the util. A delete failure after the column is nulled is
  // logged and swallowed: the row is already in the correct state, the user's avatar is gone from
  // their view, and the leftover object is unreferenced and overwritten by any future upload at the
  // same deterministic key. The key is derived from user.id inside the util.
  try {
    await avatarStorage.del(user.id)
  } catch (error) {
    console.error(
      'avatar storage delete failed after column nulled; leftover object is self-healing',
      {
        userId: user.id,
        error
      }
    )
  }

  // Refresh the session so the initials circle returns immediately without a re-login.
  await setUserSession(event, { user: { ...user, avatarUrl: null } })

  return { avatarUrl: null }
}
