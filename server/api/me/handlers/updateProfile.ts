import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import type { ProfilePatch } from '../../../models/profile'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'

// Updates the provided identity name fields on the current user's row and refreshes the session
// so the header popover reflects the new name on the next render without a re-login, mirroring
// savePreferences. The single db.update is the only mutation, so there is no half-done identity
// state: either the name commits or the old one remains. The write is always scoped to the
// session user, never an id from the request, so a user can only ever change their own identity.
// The email is never accepted in the body and is never written here.
export async function updateProfile(event: H3Event, body: ProfilePatch) {
  const { user } = await requireUserSession(event)
  const db = useDb()

  // Write only the provided fields onto their columns; an absent field is left untouched.
  const values: { firstName?: string; lastName?: string; updatedAt: Date } = {
    updatedAt: new Date()
  }
  if (body.firstName !== undefined) values.firstName = body.firstName
  if (body.lastName !== undefined) values.lastName = body.lastName

  await db.update(users).set(values).where(eq(users.id, user.id))

  // Merge the provided fields onto the existing session user so the change is visible immediately,
  // matching how savePreferences merges preferences onto the session.
  const updatedUser = {
    ...user,
    ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
    ...(body.lastName !== undefined ? { lastName: body.lastName } : {})
  }
  await setUserSession(event, { user: updatedUser })

  // Return the full current identity name so the client can reconcile.
  return { firstName: updatedUser.firstName, lastName: updatedUser.lastName }
}
