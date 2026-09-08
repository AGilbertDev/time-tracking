import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LOCALE, DEFAULT_THEME_ID } from '#shared/theme'

import type { NitroRecorder } from '../../../../helpers/nitroGlobals'
import type { TaskTestDb } from '../../../../helpers/taskTestDb'

import { installNitroGlobals } from '../../../../helpers/nitroGlobals'
import { createTaskTestDb, OTHER_USER_ID, OWNER_ID } from '../../../../helpers/taskTestDb'

// getPreferences, the handler behind GET /api/me/preferences.
//
// Derived from docs/specs/settings/preference-persistence.md:
//
//   "GET /api/me/preferences returns the current user's light_theme, dark_theme, and locale."
//
//   "The read is always scoped to the session user, never an id from the request." (restated in the
//   handler's own contract, and in the spec's "Writes are scoped to the current user from the
//   session. A user can never write another user's preferences.")
//
//   "Returns the coded defaults when no row exists yet, which covers the window between a
//   magic-link sign-in and onboarding completion" — the spec's "New user between session creation
//   and onboarding" edge case, and its "the session carries no preferences and the app falls back to
//   the documented defaults".
//
//   "Stored theme id no longer exists (an atmosphere was renamed or removed). The resolver falls
//   back to the default id rather than rendering a broken data-theme."
//
// THIS HANDLER IS TWO LINES AND BOTH OF THEM ARE AN AUTHORISATION DECISION. It reads the session
// user and hands that id to the single read path, so the only things worth proving are that the id
// it reads is the session's and that no id reachable from the request can displace it. Every case
// below therefore runs against two seeded accounts holding deliberately different preferences, so a
// read scoped to the wrong account produces a different answer rather than the same one.
//
// The seam is useDb and nothing else. loadUserPreferences is Nuxt-auto-imported by the handler, so
// without the Nuxt transform it has to be put on the global, and installNitroGlobals puts the REAL
// implementation there reading through the mocked useDb. A stubbed loader returning a fixed object
// would decide the very answer these cases ask for, and the scoping assertion would then be a
// statement about the stub rather than about the query.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { getPreferences } = await import('~~/server/api/me/handlers/getPreferences')

const event = { __event: true } as never

// An event carrying the other account's id in every place a handler could plausibly reach for one:
// the h3 context params, the request path's query string, and the raw node url. The spec says the
// read is "never an id from the request", so a handler honouring that answers identically whether it
// is handed this event or the bare one above.
const SMUGGLED = {
  context: { params: { id: OTHER_USER_ID, userId: OTHER_USER_ID } },
  node: { req: { url: `/api/me/preferences?userId=${OTHER_USER_ID}` } },
  path: `/api/me/preferences?userId=${OTHER_USER_ID}`
} as never

let harness: TaskTestDb
let client: Client
let recorder: NitroRecorder

// A settings row with the three preference columns set, inserted with raw SQL so a fixture is never
// shaped by the write path a sibling suite is checking. The shared harness's seedSettings covers the
// work columns only, and the shared helpers are frozen while other agents work in parallel, so the
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

// The two accounts hold no value in common, so no assertion below can pass by reading the wrong row.
const OWNER_PREFERENCES = { darkTheme: 'cafe', lightTheme: 'encre', locale: 'en' }
const OTHER_PREFERENCES = { darkTheme: 'foret', lightTheme: 'automne', locale: 'fr' }

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
  recorder = installNitroGlobals()
  recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })
})

describe('getPreferences', () => {
  describe('it returns the session user own persisted preferences', () => {
    it('returns the three stored preference columns', async () => {
      await seedPreferences(OWNER_ID, OWNER_PREFERENCES)

      await expect(getPreferences(event)).resolves.toEqual(OWNER_PREFERENCES)
    })

    // The spec's "New user between session creation and onboarding": a magic-link account has no
    // settings row until the wizard completes, and the read has to answer with the coded defaults
    // rather than fail. The expected values are read from shared/theme.ts rather than retyped, so a
    // change to the shipped default moves this case with it instead of leaving it asserting a stale
    // literal.
    it('falls back to the coded defaults when the account has no settings row yet', async () => {
      await expect(getPreferences(event)).resolves.toEqual({
        darkTheme: DEFAULT_THEME_ID,
        lightTheme: DEFAULT_THEME_ID,
        locale: DEFAULT_LOCALE
      })
    })

    // The spec's "Stored theme id no longer exists" edge case. The columns are free text at the
    // database level, so a renamed or retired atmosphere can still be sitting in a row.
    it('narrows a stored theme id that no longer exists back to the default', async () => {
      await seedPreferences(OWNER_ID, {
        darkTheme: 'ember',
        lightTheme: 'ember',
        locale: 'en'
      })

      await expect(getPreferences(event)).resolves.toEqual({
        darkTheme: DEFAULT_THEME_ID,
        lightTheme: DEFAULT_THEME_ID,
        locale: 'en'
      })
    })
  })

  // The whole value of testing a two-line handler. A second account is seeded with preferences that
  // share no value with the session user's, so a read scoped to the wrong id returns visibly
  // different data instead of the same data.
  describe('the read is scoped to the session user and to no other account', () => {
    it('returns the session user preferences while another account holds different ones', async () => {
      await seedPreferences(OWNER_ID, OWNER_PREFERENCES)
      await seedPreferences(OTHER_USER_ID, OTHER_PREFERENCES)

      // Both halves in one case. The absence on its own would be satisfied by a handler that
      // returned the coded defaults and read nothing at all.
      await expect(getPreferences(event)).resolves.toEqual(OWNER_PREFERENCES)
      await expect(getPreferences(event)).resolves.not.toMatchObject(OTHER_PREFERENCES)
    })

    // The account with no row of its own must still get the defaults rather than inherit the other
    // account's row, which is the failure mode of a read whose WHERE clause went missing entirely.
    it('does not fall through to another account row when the session user has none', async () => {
      await seedPreferences(OTHER_USER_ID, OTHER_PREFERENCES)

      await expect(getPreferences(event)).resolves.toEqual({
        darkTheme: DEFAULT_THEME_ID,
        lightTheme: DEFAULT_THEME_ID,
        locale: DEFAULT_LOCALE
      })
    })

    // "never an id from the request". The same request, with the other account's id planted in the
    // params, the query string and the raw url, has to answer with the session user's row.
    it('ignores another account id smuggled into the request', async () => {
      await seedPreferences(OWNER_ID, OWNER_PREFERENCES)
      await seedPreferences(OTHER_USER_ID, OTHER_PREFERENCES)

      await expect(getPreferences(SMUGGLED)).resolves.toEqual(OWNER_PREFERENCES)
    })

    // The answer has to move when the session moves and only when the session moves, which is what
    // separates a read scoped to the session from a read scoped to a constant.
    it('answers as whichever account the session names', async () => {
      await seedPreferences(OWNER_ID, OWNER_PREFERENCES)
      await seedPreferences(OTHER_USER_ID, OTHER_PREFERENCES)

      const asOwner = await getPreferences(event)
      recorder.setSession({ email: 'other@example.com', id: OTHER_USER_ID })
      const asOther = await getPreferences(event)

      expect([asOwner, asOther]).toEqual([OWNER_PREFERENCES, OTHER_PREFERENCES])
    })
  })

  // The exact status matters rather than the mere rejection. A handler that crashed on a missing
  // session would also reject, and only the code tells a refusal apart from a fault.
  describe('an unauthenticated request', () => {
    it('is refused with exactly a 401 while the same call answers under a session', async () => {
      expect.assertions(2)

      await seedPreferences(OWNER_ID, OWNER_PREFERENCES)
      recorder.setSession(null)

      await expect(getPreferences(event)).rejects.toMatchObject({ statusCode: 401 })

      // The positive half, so the 401 is attributable to the absent session rather than to a broken
      // fixture that would have failed either way.
      recorder.setSession({ email: 'owner@example.com', id: OWNER_ID })
      await expect(getPreferences(event)).resolves.toEqual(OWNER_PREFERENCES)
    })
  })
})
