import type { Client } from '@libsql/client'

import { PreferencesPatchSchema } from '~~/server/models/preferences'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LOCALE, DEFAULT_THEME_ID } from '#shared/theme'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import {
  createTaskTestDb,
  instrumentedDb,
  OTHER_USER_ID,
  OWNER_ID,
  readSettingsRows
} from '../../../../helpers/taskTestDb'

// savePreferences, the handler behind PATCH /api/me/preferences.
//
// Derived from docs/specs/settings/preference-persistence.md:
//
//   "PATCH /api/me/preferences accepts a partial body of those fields, validates them, writes them
//   to the current user's settings row, refreshes the session payload, and returns the updated
//   values."
//
//   "All three fields optional is the partial-PATCH contract, the body carries only what changed."
//
//   "Writes are scoped to the current user from the session. A user can never write another user's
//   preferences." Restated in the design blueprint as "Writes are always scoped to the session user,
//   never a user id from the body."
//
//   "If the user somehow has no settings row when a write arrives (an edge that the backfill and
//   onboarding creation are meant to prevent), the write creates it rather than failing silently"
//   and "insert it with defaults plus the provided fields rather than failing".
//
//   "Then refresh the session with setUserSession merging the new values onto the existing user so
//   the next SSR render is not stale, call applyPreferenceCookies to refresh the i18n_redirected
//   locale cookie, and return the full updated set."
//
//   "Response 200: { lightTheme, darkTheme, locale } (the full current state, not just the patched
//   fields, so the client can reconcile)."
//
// The seam is useDb and nothing above it. Every criterion about what a column ends up holding is
// read back with raw SQL through readSettingsRows, because the response is resolved through
// loadUserPreferences and its coded fallbacks, so a handler that wrote nothing at all and answered
// from the defaults would look correct from the outside on several of these.
//
// loadUserPreferences, applyPreferenceCookies and setUserSession are Nuxt-auto-imported by the
// handler. installNitroGlobals puts the REAL loader and the REAL cookie writer on the global with
// only setCookie replaced by a recorder, so what lands in the log is what the shipped code chose to
// write rather than what a stub was told to record.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { savePreferences } = await import('~~/server/api/me/handlers/savePreferences')

const event = { __event: true } as never

// A body carrying the other account's id as well as the preference fields. The spec says the write
// is scoped to the session user "never a user id from the body", and the schema strips the unknown
// key on the way through, so the assertion is that the write still lands on the session user.
const SMUGGLED_EVENT = {
  context: { params: { id: OTHER_USER_ID, userId: OTHER_USER_ID } },
  path: `/api/me/preferences?userId=${OTHER_USER_ID}`
} as never

// Every fixture body goes through the shipped schema, so no case can assert behaviour for a request
// the API would have refused with a 422 before the handler ever ran.
function patch(input: Record<string, unknown>) {
  const parsed = PreferencesPatchSchema.safeParse(input)
  if (!parsed.success) throw new Error(`fixture patch is not a valid request: ${parsed.error}`)
  return parsed.data
}

// Two accounts whose stored preferences share no value, so a write landing on the wrong row is
// unmistakable in either direction.
const OWNER_STORED = { darkTheme: 'cafe', lightTheme: 'encre', locale: 'en' }
const OTHER_STORED = { darkTheme: 'foret', lightTheme: 'automne', locale: 'fr' }

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

// A settings row with the three preference columns set, inserted with raw SQL so a starting state is
// never shaped by the write path under test. The shared harness's seedSettings covers the work
// columns only and the shared helpers are frozen while other agents work in parallel, so the
// preference columns are seeded locally here.
async function seedPreferences(
  userId: string,
  values: { darkTheme: string; lightTheme: string; locale: string }
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO settings (id, user_id, light_theme, dark_theme, locale)
          VALUES (?, ?, ?, ?, ?)`,
    args: [`settings-${userId}`, userId, values.lightTheme, values.darkTheme, values.locale]
  })
}

// The stored row for one account, read with raw SQL, reduced to the three preference columns.
async function storedPreferences(userId: string) {
  const rows = await readSettingsRows(client, userId)
  return rows.map((row) => ({
    darkTheme: row.dark_theme,
    lightTheme: row.light_theme,
    locale: row.locale
  }))
}

const SESSION_USER = {
  email: 'owner@example.com',
  firstName: 'Alexandre',
  id: OWNER_ID,
  onboarded: true,
  role: 'user'
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ ...SESSION_USER })
})

describe('savePreferences', () => {
  describe('the write reaches the session user settings row', () => {
    it('stores a new locale on the row', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ locale: 'fr' }))

      expect(await storedPreferences(OWNER_ID)).toEqual([{ ...OWNER_STORED, locale: 'fr' }])
    })

    it('stores all three fields when the body carries all three', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(
        event,
        patch({ darkTheme: 'automne', lightTheme: 'foret', locale: 'fr' })
      )

      expect(await storedPreferences(OWNER_ID)).toEqual([
        { darkTheme: 'automne', lightTheme: 'foret', locale: 'fr' }
      ])
    })

    // "the body carries only what changed". A partial patch must leave the columns it says nothing
    // about exactly as they were, and each case carries the positive half so a handler that wrote
    // nothing could not pass on the untouched columns alone.
    it('leaves the two theme columns alone when only the locale is patched', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ locale: 'fr' }))

      expect(await storedPreferences(OWNER_ID)).toEqual([
        { darkTheme: OWNER_STORED.darkTheme, lightTheme: OWNER_STORED.lightTheme, locale: 'fr' }
      ])
    })

    it('leaves the locale and the dark theme alone when only the light theme is patched', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ lightTheme: 'foret' }))

      expect(await storedPreferences(OWNER_ID)).toEqual([
        { darkTheme: OWNER_STORED.darkTheme, lightTheme: 'foret', locale: OWNER_STORED.locale }
      ])
    })

    it('leaves the locale and the light theme alone when only the dark theme is patched', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ darkTheme: 'automne' }))

      expect(await storedPreferences(OWNER_ID)).toEqual([
        { darkTheme: 'automne', lightTheme: OWNER_STORED.lightTheme, locale: OWNER_STORED.locale }
      ])
    })

    it('rewrites the same row rather than adding a second one on a later save', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ locale: 'fr' }))
      await savePreferences(event, patch({ locale: 'en' }))

      expect(await storedPreferences(OWNER_ID)).toHaveLength(1)
      expect(await storedPreferences(OWNER_ID)).toEqual([{ ...OWNER_STORED, locale: 'en' }])
    })
  })

  // The spec's insert-if-missing edge: every account starts with no settings row, so this is the
  // first save rather than an exotic one.
  describe('the account has no settings row yet', () => {
    it('creates the row rather than failing the write', async () => {
      await savePreferences(event, patch({ locale: 'en' }))

      expect(await storedPreferences(OWNER_ID)).toHaveLength(1)
    })

    it('stores the provided field on the new row', async () => {
      await savePreferences(event, patch({ lightTheme: 'encre' }))

      expect(await storedPreferences(OWNER_ID)).toMatchObject([{ lightTheme: 'encre' }])
    })

    // "insert it with defaults plus the provided fields". A first partial save must not write nulls
    // or blanks over the columns the body said nothing about; the column defaults fill them.
    it('leaves the column defaults to fill the fields the body did not name', async () => {
      await savePreferences(event, patch({ lightTheme: 'encre' }))

      expect(await storedPreferences(OWNER_ID)).toEqual([
        { darkTheme: DEFAULT_THEME_ID, lightTheme: 'encre', locale: DEFAULT_LOCALE }
      ])
    })

    it('updates that same row on the next save instead of inserting another', async () => {
      await savePreferences(event, patch({ lightTheme: 'encre' }))

      await savePreferences(event, patch({ lightTheme: 'foret' }))

      expect(await storedPreferences(OWNER_ID)).toEqual([
        { darkTheme: DEFAULT_THEME_ID, lightTheme: 'foret', locale: DEFAULT_LOCALE }
      ])
    })

    // The insert path is the one that decides which account the new row belongs to, so it gets its
    // own scoping case rather than riding on the update path's.
    it('creates the row under the session user and under no other account', async () => {
      await savePreferences(event, patch({ locale: 'en' }))

      expect(await storedPreferences(OWNER_ID)).toHaveLength(1)
      expect(await storedPreferences(OTHER_USER_ID)).toEqual([])
    })
  })

  describe('the write is scoped to the session user and can never reach another account', () => {
    it('moves the session user row while another account row stays exactly as it was', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)
      await seedPreferences(OTHER_USER_ID, OTHER_STORED)

      await savePreferences(
        event,
        patch({ darkTheme: 'automne', lightTheme: 'foret', locale: 'fr' })
      )

      // Both halves in the same case. The other account's row being untouched proves nothing on its
      // own, because a handler that wrote nothing anywhere would satisfy it.
      expect(await storedPreferences(OWNER_ID)).toEqual([
        { darkTheme: 'automne', lightTheme: 'foret', locale: 'fr' }
      ])
      expect(await storedPreferences(OTHER_USER_ID)).toEqual([OTHER_STORED])
    })

    // The insert branch's version of the same danger: a write that resolved its scope from anywhere
    // but the session could create the session user's first row against the other account's id.
    it('does not touch another account row when the session user has none of their own', async () => {
      await seedPreferences(OTHER_USER_ID, OTHER_STORED)

      await savePreferences(event, patch({ locale: 'en' }))

      expect(await storedPreferences(OWNER_ID)).toMatchObject([{ locale: 'en' }])
      expect(await storedPreferences(OTHER_USER_ID)).toEqual([OTHER_STORED])
    })

    it('ignores another account id smuggled into the request', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)
      await seedPreferences(OTHER_USER_ID, OTHER_STORED)

      await savePreferences(SMUGGLED_EVENT, patch({ locale: 'fr' }))

      expect(await storedPreferences(OWNER_ID)).toEqual([{ ...OWNER_STORED, locale: 'fr' }])
      expect(await storedPreferences(OTHER_USER_ID)).toEqual([OTHER_STORED])
    })

    it('writes to whichever account the session names', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)
      await seedPreferences(OTHER_USER_ID, OTHER_STORED)

      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })
      await savePreferences(event, patch({ locale: 'en' }))

      expect(await storedPreferences(OTHER_USER_ID)).toEqual([{ ...OTHER_STORED, locale: 'en' }])
      expect(await storedPreferences(OWNER_ID)).toEqual([OWNER_STORED])
    })
  })

  describe('the response is the full current state read back from the database', () => {
    it('returns all three fields, not only the patched one', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await expect(savePreferences(event, patch({ locale: 'fr' }))).resolves.toEqual({
        ...OWNER_STORED,
        locale: 'fr'
      })
    })

    it('returns the column defaults alongside the patched field on a first save', async () => {
      await expect(savePreferences(event, patch({ darkTheme: 'encre' }))).resolves.toEqual({
        darkTheme: 'encre',
        lightTheme: DEFAULT_THEME_ID,
        locale: DEFAULT_LOCALE
      })
    })

    // The response is read back rather than echoed, so it reports what the database now holds even
    // when another writer changed the row between the write and the read.
    it('reports what the row holds rather than echoing the request', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      const saved = await savePreferences(event, patch({ locale: 'fr' }))
      const stored = await storedPreferences(OWNER_ID)

      expect([saved]).toEqual(stored)
    })
  })

  describe('the session and the locale cookie are refreshed', () => {
    it('leaves a session carrying the new preferences', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ locale: 'fr' }))

      expect(recorder.sessions.at(-1)).toMatchObject({ ...OWNER_STORED, locale: 'fr' })
    })

    // "merging the new values onto the existing user". The identity and the onboarding flag are on
    // the session too, and a refresh that rebuilt the user instead of merging would drop them and
    // sign the user back into a half-empty session.
    it('merges the preferences onto the existing session user rather than rebuilding it', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ locale: 'fr' }))

      expect(recorder.sessions.at(-1)).toMatchObject({
        email: SESSION_USER.email,
        firstName: SESSION_USER.firstName,
        id: OWNER_ID,
        onboarded: true,
        role: SESSION_USER.role
      })
    })

    // "call applyPreferenceCookies to refresh the i18n_redirected locale cookie". The cookie is
    // what @nuxtjs/i18n reads server-side, so a save that skipped it would render the previous
    // language on the next hard reload.
    it('mirrors the new locale into the i18n_redirected cookie', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ locale: 'fr' }))

      expect(recorder.cookies.at(-1)).toEqual({ name: 'i18n_redirected', value: 'fr' })
    })

    // A theme-only save still refreshes the cookie, and it has to carry the locale the row holds
    // rather than a blank, because applyPreferenceCookies is handed the whole read-back set.
    it('writes the stored locale into the cookie even on a theme-only save', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)

      await savePreferences(event, patch({ lightTheme: 'foret' }))

      expect(recorder.cookies.at(-1)).toEqual({
        name: 'i18n_redirected',
        value: OWNER_STORED.locale
      })
    })

    // The order matters rather than only the set of side effects. A refresh that ran before the
    // write would seal the previous values into the session and the cookie the next render reads,
    // and the response would still look correct because it is read back afterwards. The database
    // write is logged into the same ordered list as the session and cookie writes through the shared
    // instrument, so one list shows the whole sequence.
    it('writes the row before it refreshes the session and the cookie', async () => {
      await seedPreferences(OWNER_ID, OWNER_STORED)
      dbRef.current = instrumentedDb(harness.db, recorder.order)

      await savePreferences(event, patch({ locale: 'fr' }))

      expect(recorder.order).toEqual([
        'update:settings',
        'setUserSession',
        'setCookie:i18n_redirected'
      ])
    })

    // The same order on the insert branch, which is a different statement reached through a
    // different arm of the handler.
    it('inserts the first row before it refreshes the session and the cookie', async () => {
      dbRef.current = instrumentedDb(harness.db, recorder.order)

      await savePreferences(event, patch({ locale: 'fr' }))

      expect(recorder.order).toEqual([
        'insert:settings',
        'setUserSession',
        'setCookie:i18n_redirected'
      ])
    })
  })

  describe('an unauthenticated request', () => {
    // The exact code, because a crash rejects too and touches no data either. Only the status can
    // tell a refusal apart from a fault, and this project has already shipped a mutant that threw a
    // RangeError and looked like a refusal.
    it('is refused with exactly a 401 and writes nothing, while the same call writes under a session', async () => {
      expect.assertions(3)

      await seedPreferences(OWNER_ID, OWNER_STORED)
      recorder.setSession(null)

      await expect(savePreferences(event, patch({ locale: 'fr' }))).rejects.toMatchObject({
        statusCode: 401
      })
      expect(await storedPreferences(OWNER_ID)).toEqual([OWNER_STORED])

      // The positive half, so the absent write is attributable to the absent session rather than to
      // a fixture that would have written nothing either way.
      recorder.setSession({ ...SESSION_USER })
      await savePreferences(event, patch({ locale: 'fr' }))
      expect(await storedPreferences(OWNER_ID)).toEqual([{ ...OWNER_STORED, locale: 'fr' }])
    })

    it('leaves no session and no cookie behind when it refuses', async () => {
      expect.assertions(3)

      recorder.setSession(null)

      await expect(savePreferences(event, patch({ locale: 'fr' }))).rejects.toMatchObject({
        statusCode: 401
      })
      expect(recorder.sessions).toEqual([])
      expect(recorder.cookies).toEqual([])
    })
  })
})
