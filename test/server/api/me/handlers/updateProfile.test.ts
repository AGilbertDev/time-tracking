import type { Client } from '@libsql/client'

import { ProfilePatchSchema } from '~~/server/models/profile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  instrumentedDb,
  OTHER_USER_ID,
  OWNER_ID,
  readUserRow,
  seedUserAccount
} from '../../../../helpers/taskTestDb'

// updateProfile, the handler behind PATCH /api/me/profile.
//
// Derived from docs/specs/settings/profile-page.md:
//
//   AC4. "Editing the first and/or last name to a valid value [...] and saving calls
//   PATCH /api/me/profile, persists to users.first_name / users.last_name, returns
//   { firstName, lastName }, and the header popover and this page show the new name immediately
//   without a re-login or hard refresh."
//
//   AC6. "The write is scoped to the session user. A user can never change another user's identity;
//   the handler never reads an id from the request body."
//
//   Data contract: "db.update(users).set({ ...provided fields, updatedAt: new Date() }).where(eq(
//   users.id, user.id)). Only the provided fields are written. This is the only mutation."
//
//   "Refresh the session with setUserSession(event, { user: { ...user, ...provided fields } }) so the
//   header popover and this page reflect the new name on the next render without a re-login, matching
//   how savePreferences merges onto the existing session user."
//
//   "Response 200: { firstName, lastName } (the full current identity name, so the client
//   reconciles)."
//
//   "The email is never accepted in this body and is never written by this route."
//
//   Edge case: "Re-saving the same value is accepted (idempotent), so there is no lockout and no
//   invalid state either way."
//
// The seam is useDb. Every criterion about what a column ends up holding is read back with raw SQL
// through readUserRow, because the response is assembled from the session rather than from the row,
// so a handler that wrote nothing at all would return exactly the right answer.
//
// The spec's 422 cases (a name empty after trim, over 100 characters, or an empty body) belong to
// ProfilePatchSchema and are covered where that schema is tested. Every fixture body here is parsed
// through the shipped schema first, so no case asserts behaviour for a request the route would have
// refused before this handler ran.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { updateProfile } = await import('~~/server/api/me/handlers/updateProfile')

const event = { __event: true } as never

// The other account's id everywhere a handler could reach for one. AC6 says the handler "never
// reads an id from the request body", so this event must behave exactly like the bare one.
const SMUGGLED_EVENT = {
  context: { params: { id: OTHER_USER_ID, userId: OTHER_USER_ID } },
  path: `/api/me/profile?userId=${OTHER_USER_ID}`
} as never

function patch(input: Record<string, unknown>) {
  const parsed = ProfilePatchSchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture patch is not a valid request: ${parsed.error}`)
  return parsed.data
}

// The stored identity of one account, read raw. Only the columns the spec names, so a change to any
// of them is visible and a change to none of them cannot hide.
async function storedIdentity(userId: string) {
  const row = await readUserRow(client, userId)
  return {
    avatar_url: row?.avatar_url,
    email: row?.email,
    first_name: row?.first_name,
    last_name: row?.last_name,
    password_hash: row?.password_hash,
    role: row?.role
  }
}

const OWNER_NAME = { firstName: 'Alexandre', lastName: 'Gilbert' }
const OTHER_NAME = { firstName: 'Marie', lastName: 'Tremblay' }

const SESSION_USER = {
  email: 'owner@example.com',
  firstName: OWNER_NAME.firstName,
  id: OWNER_ID,
  lastName: OWNER_NAME.lastName,
  locale: 'fr',
  onboarded: true,
  role: 'user'
}

// Midday UTC on a fixed day, so the updatedAt stamp is a known instant rather than whatever the
// clock happened to read.
const NOW = new Date('2026-09-07T12:00:00Z')

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ ...SESSION_USER })

  await seedUserAccount(client, OWNER_ID, {
    avatarUrl: 'https://blob.example/avatars/owner.webp',
    firstName: OWNER_NAME.firstName,
    lastName: OWNER_NAME.lastName,
    passwordHash: 'stored-hash-owner',
    role: 'user'
  })
  await seedUserAccount(client, OTHER_USER_ID, {
    firstName: OTHER_NAME.firstName,
    lastName: OTHER_NAME.lastName
  })

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('updateProfile', () => {
  describe('AC4: the name persists to the session user own row', () => {
    it('stores both names when the body carries both', async () => {
      await updateProfile(event, patch({ firstName: 'Alex', lastName: 'Tremblay-Gilbert' }))

      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        first_name: 'Alex',
        last_name: 'Tremblay-Gilbert'
      })
    })

    it('returns the updated identity name so the client can reconcile', async () => {
      await expect(
        updateProfile(event, patch({ firstName: 'Alex', lastName: 'Tremblay-Gilbert' }))
      ).resolves.toEqual({ firstName: 'Alex', lastName: 'Tremblay-Gilbert' })
    })

    // "Response 200: { firstName, lastName } (the full current identity name, so the client
    // reconciles)". A partial patch still answers with both halves, the unpatched one taken from the
    // identity already in force, so the client never has to merge the response itself.
    it('returns the full current name even when only one half was patched', async () => {
      await expect(updateProfile(event, patch({ firstName: 'Alex' }))).resolves.toEqual({
        firstName: 'Alex',
        lastName: OWNER_NAME.lastName
      })
    })

    // "the ...provided fields, updatedAt: new Date()" half of the contract. The row records when the
    // identity last moved, which is what an admin screen and any later audit read.
    it('stamps updatedAt with the instant of the write', async () => {
      await updateProfile(event, patch({ firstName: 'Alex' }))

      const row = await readUserRow(client, OWNER_ID)

      expect(row?.updated_at).toBe(Math.floor(NOW.getTime() / 1000))
    })

    // The spec's "Re-saving the same value is accepted (idempotent), so there is no lockout".
    it('accepts a save that sets the name it already holds', async () => {
      await expect(updateProfile(event, patch(OWNER_NAME))).resolves.toEqual(OWNER_NAME)
      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        first_name: OWNER_NAME.firstName,
        last_name: OWNER_NAME.lastName
      })
    })
  })

  // "Only the provided fields are written." Each case pairs the untouched column with the column
  // that did move, because a handler that wrote nothing at all would satisfy the untouched half.
  describe('only the provided fields are written', () => {
    it('leaves the last name alone when only the first name is patched', async () => {
      await updateProfile(event, patch({ firstName: 'Alex' }))

      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        first_name: 'Alex',
        last_name: OWNER_NAME.lastName
      })
    })

    it('leaves the first name alone when only the last name is patched', async () => {
      await updateProfile(event, patch({ lastName: 'Tremblay' }))

      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        first_name: OWNER_NAME.firstName,
        last_name: 'Tremblay'
      })
    })

    // "The email is never accepted in this body and is never written by this route." The email is
    // the login key, so a route that could move it would be an account-takeover surface.
    it('never writes the email', async () => {
      await updateProfile(event, patch({ firstName: 'Alex', lastName: 'Tremblay' }))

      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        email: 'owner@example.com',
        first_name: 'Alex'
      })
    })

    // The role is the admin gate and the password hash is the credential, neither of which is
    // identity this route owns. A set() that carried the whole body would blank them.
    it('leaves the role, the password hash and the avatar alone', async () => {
      await updateProfile(event, patch({ firstName: 'Alex' }))

      expect(await storedIdentity(OWNER_ID)).toEqual({
        avatar_url: 'https://blob.example/avatars/owner.webp',
        email: 'owner@example.com',
        first_name: 'Alex',
        last_name: OWNER_NAME.lastName,
        password_hash: 'stored-hash-owner',
        role: 'user'
      })
    })

    // "This is the only mutation", which is what makes the spec's "there is no half-done identity
    // state" true. Two statements would open a window where one name had moved and the other had not.
    it('issues exactly one update statement', async () => {
      dbRef.current = instrumentedDb(harness.db, recorder.order)

      await updateProfile(event, patch({ firstName: 'Alex', lastName: 'Tremblay' }))

      expect(recorder.order.filter((entry) => entry.startsWith('update:'))).toEqual([
        'update:users'
      ])
    })
  })

  describe('AC6: the write is scoped to the session user and can never reach another identity', () => {
    it('moves the session user name while another account name stays exactly as it was', async () => {
      await updateProfile(event, patch({ firstName: 'Alex', lastName: 'Tremblay' }))

      // Both halves in one case: the other identity being untouched proves nothing on its own,
      // because a handler that wrote nothing anywhere would satisfy it.
      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        first_name: 'Alex',
        last_name: 'Tremblay'
      })
      expect(await storedIdentity(OTHER_USER_ID)).toMatchObject({
        first_name: OTHER_NAME.firstName,
        last_name: OTHER_NAME.lastName
      })
    })

    // "the handler never reads an id from the request body".
    it('ignores another account id smuggled into the request', async () => {
      await updateProfile(SMUGGLED_EVENT, patch({ firstName: 'Alex' }))

      expect(await storedIdentity(OWNER_ID)).toMatchObject({ first_name: 'Alex' })
      expect(await storedIdentity(OTHER_USER_ID)).toMatchObject({
        first_name: OTHER_NAME.firstName
      })
    })

    // The write has to follow the session and only the session, which is what separates a scoped
    // write from one aimed at a constant.
    it('writes to whichever account the session names', async () => {
      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })

      await updateProfile(event, patch({ firstName: 'Marianne' }))

      expect(await storedIdentity(OTHER_USER_ID)).toMatchObject({ first_name: 'Marianne' })
      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        first_name: OWNER_NAME.firstName
      })
    })
  })

  describe('AC4: the session is refreshed so the new name shows with no re-login', () => {
    it('leaves a session carrying the new name', async () => {
      await updateProfile(event, patch({ firstName: 'Alex', lastName: 'Tremblay' }))

      expect(recorder.sessions.at(-1)).toMatchObject({
        firstName: 'Alex',
        lastName: 'Tremblay'
      })
    })

    // "merging onto the existing session user". The email, the role, the locale and the onboarding
    // flag all ride on the same session, and a refresh that rebuilt the user would drop them and
    // strand the account mid-session.
    it('merges the new name onto the existing session user rather than rebuilding it', async () => {
      await updateProfile(event, patch({ firstName: 'Alex' }))

      expect(recorder.sessions.at(-1)).toEqual({
        ...SESSION_USER,
        firstName: 'Alex'
      })
    })

    it('leaves the unpatched half of the name on the session untouched', async () => {
      await updateProfile(event, patch({ firstName: 'Alex' }))

      expect(recorder.sessions.at(-1)).toMatchObject({ lastName: OWNER_NAME.lastName })
    })

    // The order matters rather than only the set of side effects. A refresh that ran before the
    // write would seal a name into the session that the database might then refuse, and the response
    // is built from the session so it would look correct either way.
    it('writes the row before it refreshes the session', async () => {
      dbRef.current = instrumentedDb(harness.db, recorder.order)

      await updateProfile(event, patch({ firstName: 'Alex' }))

      expect(recorder.order).toEqual(['update:users', 'setUserSession'])
    })
  })

  describe('an unauthenticated request', () => {
    // The exact code, because a crash rejects too and writes nothing either. Only the status can
    // tell a refusal apart from a fault.
    it('is refused with exactly a 401 and writes nothing, while the same call writes under a session', async () => {
      expect.assertions(3)

      recorder.setSession(null)

      await expect(updateProfile(event, patch({ firstName: 'Alex' }))).rejects.toMatchObject({
        statusCode: 401
      })
      expect(await storedIdentity(OWNER_ID)).toMatchObject({
        first_name: OWNER_NAME.firstName
      })

      // The positive half, so the absent write is attributable to the absent session rather than to
      // a fixture that would have written nothing either way.
      recorder.setSession({ ...SESSION_USER })
      await updateProfile(event, patch({ firstName: 'Alex' }))
      expect(await storedIdentity(OWNER_ID)).toMatchObject({ first_name: 'Alex' })
    })

    it('leaves no refreshed session behind when it refuses', async () => {
      expect.assertions(2)

      recorder.setSession(null)

      await expect(updateProfile(event, patch({ firstName: 'Alex' }))).rejects.toMatchObject({
        statusCode: 401
      })
      expect(recorder.sessions).toEqual([])
    })
  })
})
