import type { H3Event } from 'h3'

import { eq } from 'drizzle-orm'

import { useDb } from '../../../../db/index'
import { categoryQuotas, settings, users } from '../../../../db/schema'
import { isOnboardingResetEnabled } from '../../../../utils/onboardingReset'

export type ResetOnboardingResult = { success: true }

// Clears the acting admin's own configuration and their onboarded_at timestamp, so the global
// middleware puts them back in front of the first-run wizard.
//
// The target is always the session user and there is no parameter to aim anywhere else. That is
// what the owner asked for, it is the safer shape because nothing can be pointed at another
// account by a malformed or hostile request, and it is the only shape that fully works today,
// since the thing that actually puts somebody in front of the wizard is the session refresh on
// this response and that only ever reaches the session making the request.
//
// What is cleared is the settings row and the category_quotas rows, deleted rather than rewritten
// with default values. Every read path already falls back to coded defaults when no row exists, so
// zero rows is precisely the state a brand-new magic-link user sits in, and writing defaults back
// would put a second copy of every default value in this file free to drift from the ones in
// loadUserPreferences, loadWorkSettings, and shared/categories.ts.
//
// What is never touched. The password hash, the role, the names, the avatar, the email, the
// deactivation flag, the allowlist, the work_schedule history, and above all the tasks. This
// handler never reads, writes, or deletes a tasks row. The owner's recorded work is not a setting,
// and a reset that touched it would be a data loss dressed up as a configuration action. Clearing
// the quota rows cannot move what past work was measured against either, because a task written
// since the per-category quotas feature carries its own frozen figure in tasks.quota_wph_override.
// work_schedule stays because nothing in the application can write it back, so deleting it would
// destroy data the user has no way to restore.
//
// Idempotent on purpose. Calling this on an account that is already reset succeeds as a no-op
// rather than returning 409, because calling it again is the documented recovery from a partial
// failure and a conflict response would break that recovery in exactly the state that needs it.
export async function resetOnboarding(event: H3Event): Promise<ResetOnboardingResult> {
  // The runtime switch, checked before anything is read or written. The owner has said this
  // feature's life is finite, so it ships with an off switch that is not a code change. An off
  // switch that meant deleting an endpoint, a page section and several test files would be a pull
  // request, and a pull request nobody opens leaves a destructive action live in a finished product.
  //
  // The refusal is the same 403 'forbidden' the admin wrapper already throws for a non-admin, and
  // that reuse is deliberate. From outside, a feature that is switched off and a caller who may not
  // use it are the same answer, which is that this caller may not do this. A distinct code would
  // tell a prober that the route exists and is merely disabled, and it would hand the client a
  // second failure branch to render for a state the user can do nothing about.
  //
  // The check lives here rather than in defineAdminEventHandler because that wrapper is shared by
  // every admin route and this switch governs one of them. Hiding the section on the settings page
  // is presentation and is not the gate. This is.
  if (!isOnboardingResetEnabled()) {
    throw createError({ statusCode: 403, statusMessage: 'forbidden' })
  }

  const { user } = await requireUserSession(event)
  const db = useDb()
  const now = new Date()

  // The write order below is load-bearing rather than incidental. This repository has no
  // db.transaction and no db.batch anywhere, so these are sequential awaited statements and the
  // safety comes from an ordering whose every partial outcome is a valid state, plus the
  // idempotency above, rather than from atomicity. That is a weaker guarantee than a transaction
  // and it is stated as such rather than papered over. The purge endpoint
  // (server/api/cron/purge-deactivated.get.ts) is the established precedent for a multi-table write
  // done this way, with the ordering argued in a comment.
  //
  // Step 1. Clear the flag first, naming only onboarded_at and updated_at so password_hash, role,
  // first_name, last_name, avatar_url, email, and deactivated_at are left holding exactly what they
  // held before. The password surviving byte for byte is the whole safety argument for this
  // design, because it is what lets the admin abandon the wizard and sign back in from any device.
  //
  // The flag clear must come first and the session refresh must come last, for the same reason. A
  // session saying onboarded: false over a row whose onboarded_at is still set is a trap. The
  // global middleware forces that user onto the wizard, and the wizard's re-entry guard reads the
  // still-set column and rejects the Finish submission with 409 already_onboarded, so the user can
  // neither finish nor leave. Putting the database change first and the session change last makes
  // that combination unreachable by construction rather than merely unlikely.
  await db.update(users).set({ onboardedAt: null, updatedAt: now }).where(eq(users.id, user.id))

  // Step 2 and step 3. The two row deletes sit in the middle because their partial outcomes are all
  // benign, since a read path with no row returns the coded defaults and the wizard's Finish upserts
  // over any settings row that survived.
  //
  // Settings before quotas is a tiebreak rather than a correctness rule. There is no foreign key
  // between them and no argument either way, so the order goes on which loss is easier to undo. The
  // wizard rewrites the settings row on Finish. Nothing rewrites the quota rows, so the user retypes
  // those figures on the settings page. Deleting the recoverable one first leaves the harder one
  // intact for one more attempt.
  await db.delete(settings).where(eq(settings.userId, user.id))

  // Keyed on user_id alone, so a quota row naming a category the app no longer knows is removed with
  // the rest and no coercion is involved.
  await db.delete(categoryQuotas).where(eq(categoryQuotas.userId, user.id))

  // Step 4. Read the preferences back through the single read path, which now finds no row and
  // returns the coded defaults, then refresh the session and the cookies. The interface therefore
  // switches to the default theme and to French at this moment, which the confirmation copy names so
  // it is expected rather than alarming.
  const preferences = await loadUserPreferences(user.id)

  // Every other field is carried forward from the session unchanged. The reset changes what the user
  // has configured, not who they are, and the role in particular has to survive because it is the
  // very thing that guards this endpoint.
  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      onboarded: false,
      role: user.role,
      lightTheme: preferences.lightTheme,
      darkTheme: preferences.darkTheme,
      locale: preferences.locale
    }
  })

  // Mirror the preferences into the client-readable cookies the no-flash guard reads.
  applyPreferenceCookies(event, preferences)

  return { success: true }
}
