import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import type { PasswordChange } from '../../../models/password'

import { useDb } from '../../../db/index'
import { users } from '../../../db/schema'
import { isPasswordBreached } from '../../../utils/checkPasswordBreached'

// Changes the current user's password, authorized by their current password. The single
// db.update is the only mutation, so the account is never left half-changed: either the new hash
// commits or the old password remains the only valid one. The change is always scoped to the
// session user, never an id from the request, so a user can only ever change their own password.
// Logs no password and no hash, and every failure code carries no secret material.
export async function changePassword(event: H3Event, body: PasswordChange) {
  const { user } = await requireUserSession(event)
  const db = useDb()

  const row = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .get()

  // One generic authorization failure for both a wrong current password and the no-hash edge
  // (an onboarded user always has a hash). It fails closed and discloses nothing beyond "the
  // current password is wrong". This flow is a change, not an initial set, so a missing hash is
  // rejected rather than treated as a first-password path.
  const currentPasswordIncorrect = () =>
    createError({ statusCode: 401, statusMessage: 'current_password_incorrect' })

  if (!row?.passwordHash) throw currentPasswordIncorrect()

  const currentMatches = await verifyPassword(row.passwordHash, body.currentPassword)
  if (!currentMatches) throw currentPasswordIncorrect()

  // Reject a no-op rotation so a user is not misled into believing they rotated a possibly
  // compromised credential when they did not. The current password was just verified, so a
  // direct plaintext comparison is sufficient and needs no second hash check.
  if (body.newPassword === body.currentPassword) {
    throw createError({ statusCode: 422, statusMessage: 'password_unchanged' })
  }

  // Reject a new password known to be compromised, matching onboarding. isPasswordBreached fails
  // open on a HIBP outage, so a breach-list outage never blocks a legitimate change.
  if (await isPasswordBreached(body.newPassword)) {
    throw createError({ statusCode: 422, statusMessage: 'password_breached' })
  }

  const passwordHash = await hashPassword(body.newPassword)
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id))

  // Refresh the current session carrying the existing user unchanged so the current device stays
  // cleanly signed in. Sessions are stateless sealed cookies with no server-side revocation list,
  // so a password change cannot force other devices to expire; that is a documented tradeoff in
  // the spec, not an oversight, and is out of scope here.
  await setUserSession(event, { user })

  return { success: true }
}
