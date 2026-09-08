import type { Client } from '@libsql/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../helpers/taskTestDb'

import {
  createTaskTestDb,
  instrumentedDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedUserAccount
} from '../../helpers/taskTestDb'

// server/middleware/validate-session.ts, which runs on every authenticated request in the
// application and had no test at all.
//
// What it is for is stated in its own header and restated by two specs. Sessions are stateless
// sealed cookies with no server-side store, so an account deleted or deactivated in the database
// would otherwise keep a valid cookie until its own maxAge expired. This middleware is the only
// thing that revokes one.
//
//   docs/specs/admin/manage-users.md line 160: "set deactivated_at = now. The existing
//   validate-session.ts middleware and login.ts 403 then enforce the deactivation on the account's
//   next request and login."
//
//   docs/specs/settings/settings-page.md line 150, "Account deactivated mid-session (another tab or
//   an admin). The session-validation middleware clears the session and redirects on the next
//   navigation, and the authenticated wrapper 401s the API call."
//
//   docs/specs/settings/settings-page.md line 178 fixes what it deliberately does not check:
//   "server/middleware/validate-session.ts, which revalidates account existence and deactivation,
//   not a password version."
//
// So there are four questions, and they are the four the brief names: an active account passes
// through, a deactivated one is revoked, a request carrying no session is left alone rather than
// erroring, and a users row that has vanished is handled.
//
// TWO KNOWN GAPS, RECORDED RATHER THAN ASSERTED AS CORRECT
//
// docs/TODO.md holds two open entries about this exact select, and neither is asserted here as
// intended behaviour. They are named at the tests that touch the mechanism, so a later reader sees
// the limitation next to the code that carries it rather than mistaking the assertion for approval:
//
//   "A live session elsewhere keeps a stale `onboarded` flag after a reset." The fix named there is
//   to add onboarded_at to the select this middleware already runs and reconcile the session flag
//   against it.
//
//   "`defineAdminEventHandler` trusts the role in the session cookie, which nothing reconciles."
//   The fix named there is one more column on the same select. An admin demoted to `user` in the
//   database keeps every admin route until the session is renewed.
//
// Both entries say the two are one piece of work in this one select. Until that work lands, the
// middleware reconciles deactivation and nothing else, and that is what is asserted below.
//
// HOW IT IS DRIVEN
//
// The Vitest environment is node with no Nuxt runtime, so the auto-imported Nitro and
// nuxt-auth-utils helpers resolve to globalThis and are stubbed there. defineEventHandler is stubbed
// before the import because the module calls it at import time; stubbing it to the identity function
// makes the default export the raw handler, which is the thing under test.
//
// test/helpers/nitroGlobals.ts covers createError, getCookie, sendRedirect and setUserSession, but
// not getUserSession, clearUserSession or getRequestHeader, and it pins getCookie to undefined,
// which is the one input the locale branch below turns on. Rather than change a shared helper three
// other agents are working in, this suite carries its own recorder. That is a candidate addition to
// nitroGlobals once the parallel work has landed.
//
// The database is not mocked. useDb is the only seam, and it hands back a real Drizzle instance over
// an in-memory libSQL database, so the select, the eq, and the timestamp column all run for real and
// "the row says deactivated" is a stored value rather than a stubbed one.

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const validateSession = (await import('~~/server/middleware/validate-session')).default as (
  event: unknown
) => Promise<unknown>

// The request the middleware is handed. Only the three members it reads are present: the method and
// the path it makes its page-navigation decision from, plus a marker so a stub can prove it was
// handed the event rather than something else.
type FakeEvent = {
  __event: true
  method: string
  path: string
}

function requestFor(overrides: Partial<FakeEvent> = {}): FakeEvent {
  return { __event: true, method: 'GET', path: '/planification', ...overrides }
}

// Everything the middleware did that is not a return value: whether it revoked the session, whether
// it wrote one, and where it sent the browser. A revocation is read from this rather than from the
// resolved value, because the handler resolves to undefined either way.
type Recorder = {
  cleared: unknown[]
  redirects: { status?: number; url: string }[]
  reads: string[]
  sessionWrites: unknown[]
}

let harness: TaskTestDb
let client: Client
let recorder: Recorder

// The session getUserSession will hand back. Null is a request carrying no cookie at all, which is
// what nuxt-auth-utils returns for an anonymous visitor.
let currentSession: unknown = null

// What getCookie('i18n_redirected') answers. Undefined is a visitor who has never had a locale
// persisted, which is the majority case and the one that must not produce an /undefined redirect.
let localeCookie: string | undefined

// What getRequestHeader(event, 'accept') answers. Undefined is a request with no Accept header at
// all, which the middleware coalesces to an empty string.
let acceptHeader: string | undefined

beforeEach(async () => {
  currentSession = null
  localeCookie = undefined
  acceptHeader = 'text/html,application/xhtml+xml'

  recorder = { cleared: [], redirects: [], reads: [], sessionWrites: [] }

  harness = await createTaskTestDb()
  client = harness.client
  // The read log is what makes "an active account passes through" mean the row was consulted and
  // approved, rather than the far weaker "no query ran".
  dbRef.current = instrumentedDb(harness.db, recorder.reads, undefined, {
    beforeSelect: (statement) => {
      recorder.reads.push(`select:${statement.table}`)
    }
  })

  vi.stubGlobal('getUserSession', async () => currentSession)
  vi.stubGlobal('clearUserSession', async (event: unknown) => {
    recorder.cleared.push(event)
  })
  vi.stubGlobal('setUserSession', async (_event: unknown, session: unknown) => {
    recorder.sessionWrites.push(session)
  })
  vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) =>
    name === 'accept' ? acceptHeader : undefined
  )
  vi.stubGlobal('getCookie', (_event: unknown, name: string) =>
    name === 'i18n_redirected' ? localeCookie : undefined
  )
  vi.stubGlobal('sendRedirect', async (_event: unknown, url: string, status?: number) => {
    recorder.redirects.push({ status, url })
  })
})

// A session cookie for one of the fixture users, in the shape nuxt-auth-utils seals. Only `id` is
// read by the middleware; the rest is present because the real cookie carries it and because two of
// the tests below are about what the middleware does NOT reconcile.
function sessionFor(userId: string, extra: Record<string, unknown> = {}) {
  return { user: { id: userId, email: 'owner@example.com', onboarded: true, ...extra } }
}

describe('the instrument, before anything is concluded from a middleware that did nothing', () => {
  // Three criteria below conclude from an absence: no revocation, no redirect, no query. A
  // middleware that did nothing at all would satisfy every one of them, so it is first shown doing
  // the whole of its job.
  it('revokes and redirects a deactivated account, so an absence means something', async () => {
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: new Date('2026-05-01T00:00:00Z') })
    currentSession = sessionFor(OWNER_ID)

    await validateSession(requestFor())

    expect(recorder.cleared).toHaveLength(1)
    expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
  })

  it('reads the users table on an authenticated request, so a pass-through is a verdict', async () => {
    currentSession = sessionFor(OWNER_ID)

    await validateSession(requestFor())

    expect(recorder.reads).toContain('select:users')
  })
})

describe('an authenticated request for an active account passes through', () => {
  it('leaves the session alone and sends no redirect', async () => {
    currentSession = sessionFor(OWNER_ID)

    await validateSession(requestFor())

    expect(recorder.cleared).toEqual([])
    expect(recorder.redirects).toEqual([])
  })

  it('resolves without a value, so the request continues to its handler', async () => {
    currentSession = sessionFor(OWNER_ID)

    await expect(validateSession(requestFor())).resolves.toBeUndefined()
  })

  it('passes through an account that was deactivated and then reactivated', async () => {
    // Reactivation clears deactivated_at (docs/specs/admin/manage-users.md line 180, "Reactivating a
    // deactivated account re-adds it to the allowlist and clears deactivated_at, and the user can
    // sign in again"). A null column has to read as active, not merely as "not the string set".
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: new Date('2026-05-01T00:00:00Z') })
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: null })
    currentSession = sessionFor(OWNER_ID)

    await validateSession(requestFor())

    expect(recorder.cleared).toEqual([])
    expect(recorder.redirects).toEqual([])
  })

  it('passes through on a request that is not a page navigation either', async () => {
    currentSession = sessionFor(OWNER_ID)
    acceptHeader = 'application/json'

    await validateSession(requestFor({ method: 'POST', path: '/api/tasks' }))

    expect(recorder.cleared).toEqual([])
    expect(recorder.redirects).toEqual([])
  })

  it('checks the account named by the session and not some other row', async () => {
    // Only the other fixture user is deactivated. A middleware selecting without the eq, or with the
    // wrong side of it, would revoke this request too.
    await seedUserAccount(client, OTHER_USER_ID, {
      deactivatedAt: new Date('2026-05-01T00:00:00Z')
    })
    currentSession = sessionFor(OWNER_ID)

    await validateSession(requestFor())

    expect(recorder.cleared).toEqual([])
  })
})

describe('an authenticated request for a deactivated account is refused', () => {
  const DEACTIVATED_AT = new Date('2026-05-01T00:00:00Z')

  beforeEach(async () => {
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: DEACTIVATED_AT })
    currentSession = sessionFor(OWNER_ID)
  })

  it('clears the session', async () => {
    await validateSession(requestFor())

    expect(recorder.cleared).toHaveLength(1)
  })

  it('clears the session for this very request rather than some other event', async () => {
    const event = requestFor()

    await validateSession(event)

    expect(recorder.cleared[0]).toBe(event)
  })

  it('redirects a page navigation to the sign-in route on this same request', async () => {
    // The file's own reasoning for redirecting rather than only clearing: "Clearing alone only
    // expires the cookie on the response, which the current server render still does not see, so
    // without the redirect the user would stay on the page until a second refresh."
    await validateSession(requestFor())

    expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
  })

  it('redirects with 302 exactly, not 301', async () => {
    // A revocation redirect that a browser cached permanently would strand the account at sign-in
    // even after a reactivation.
    await validateSession(requestFor())

    expect(recorder.redirects[0]?.status).toBe(302)
  })

  it('still resolves without throwing, so the refusal is a redirect and never a crash', async () => {
    await expect(validateSession(requestFor())).resolves.toBeUndefined()
  })

  it('refuses an account deactivated one second ago as readily as one deactivated a year ago', async () => {
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: new Date(Date.now() - 1000) })

    await validateSession(requestFor())

    expect(recorder.cleared).toHaveLength(1)
  })
})

describe('the account row has vanished', () => {
  it('clears the session when the session names a user that no longer exists', async () => {
    // The retention purge deletes rows outright (docs/specs/admin/manage-users.md line 189, "delete
    // users rows where deactivated_at is set and deactivated_at <= now - 365 days"), so a live
    // cookie naming a deleted account is a state production reaches.
    currentSession = sessionFor('user-deleted-last-year')

    await validateSession(requestFor())

    expect(recorder.cleared).toHaveLength(1)
  })

  it('redirects that page navigation rather than erroring on the missing row', async () => {
    currentSession = sessionFor('user-deleted-last-year')

    await expect(validateSession(requestFor())).resolves.toBeUndefined()
    expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
  })

  it('treats a deleted account exactly as it treats a deactivated one', async () => {
    // The two arms of `if (record && !record.deactivatedAt) return` must not diverge: an account
    // that is gone is at least as revoked as one that is switched off.
    currentSession = sessionFor('user-never-existed')
    await validateSession(requestFor())
    const forMissing = { cleared: recorder.cleared.length, redirects: [...recorder.redirects] }

    recorder = { cleared: [], redirects: [], reads: [], sessionWrites: [] }
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: new Date('2026-05-01T00:00:00Z') })
    currentSession = sessionFor(OWNER_ID)
    await validateSession(requestFor())

    expect({ cleared: recorder.cleared.length, redirects: recorder.redirects }).toEqual(forMissing)
  })
})

describe('a request carrying no session is left alone', () => {
  it.each([
    ['no session at all', null],
    ['an undefined session', undefined],
    ['a session with no user', {}],
    ['a session whose user is null', { user: null }],
    ['a session whose user carries no id', { user: { email: 'owner@example.com' } }],
    ['a session whose user id is an empty string', { user: { id: '' } }]
  ])('returns without clearing or redirecting given %s', async (_label, session) => {
    currentSession = session

    await expect(validateSession(requestFor())).resolves.toBeUndefined()
    expect(recorder.cleared).toEqual([])
    expect(recorder.redirects).toEqual([])
  })

  it('does not query the database at all, so anonymous traffic pays nothing', async () => {
    // The file's closing claim: "Requests without a session skip the query, so only authenticated
    // traffic pays for it." The read log makes that measurable rather than asserted in prose.
    currentSession = null

    await validateSession(requestFor())

    expect(recorder.reads).toEqual([])
  })

  it('does not error on an anonymous request to a page that does not exist', async () => {
    currentSession = null

    await expect(validateSession(requestFor({ path: '/nowhere' }))).resolves.toBeUndefined()
  })
})

describe('only a real page navigation is redirected', () => {
  beforeEach(async () => {
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: new Date('2026-05-01T00:00:00Z') })
    currentSession = sessionFor(OWNER_ID)
  })

  // Every one of these still has its session cleared. What changes is whether the response is turned
  // into a redirect, because "API or asset requests are left untouched" per the file's own rule and
  // because settings-page.md line 150 gives the API arm to the authenticated wrapper's 401 instead.
  it.each([
    ['a POST carrying an HTML Accept header', { accept: 'text/html', method: 'POST' }],
    ['a PATCH page-shaped request', { accept: 'text/html', method: 'PATCH' }],
    ['a GET asking for JSON', { accept: 'application/json', method: 'GET' }],
    ['a GET asking for an image', { accept: 'image/avif,image/webp', method: 'GET' }],
    ['a GET with no Accept header at all', { accept: undefined, method: 'GET' }],
    ['a GET with an empty Accept header', { accept: '', method: 'GET' }]
  ])('clears the session but sends no redirect for %s', async (_label, { accept, method }) => {
    acceptHeader = accept

    await validateSession(requestFor({ method, path: '/api/tasks' }))

    expect(recorder.cleared).toHaveLength(1)
    expect(recorder.redirects).toEqual([])
  })

  it('redirects a browser navigation whose Accept header lists html among several types', async () => {
    acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

    await validateSession(requestFor())

    expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
  })

  it('does not redirect a wildcard-only Accept, which is a fetch rather than a navigation', async () => {
    acceptHeader = '*/*'

    await validateSession(requestFor({ path: '/api/me' }))

    expect(recorder.cleared).toHaveLength(1)
    expect(recorder.redirects).toEqual([])
  })
})

describe('the auth pages are never redirected to themselves', () => {
  beforeEach(async () => {
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: new Date('2026-05-01T00:00:00Z') })
    currentSession = sessionFor(OWNER_ID)
    acceptHeader = 'text/html'
  })

  // Both localized sign-in paths and both localized sign-up paths, at the root, nested under a
  // locale prefix, with a trailing slash, and with a query string. The file's stated reason is "so
  // there is no loop", and a loop on the sign-in page is an app a revoked user cannot reach.
  it.each([
    '/connexion',
    '/connexion/',
    '/connexion?redirect=%2Fplanification',
    '/signin',
    '/signin/',
    '/signin?next=%2F',
    '/inscription',
    '/inscription/',
    '/signup',
    '/signup?token=abc',
    '/en/signin',
    '/fr/connexion/'
  ])('clears the session but does not redirect on %s', async (path) => {
    await validateSession(requestFor({ path }))

    expect(recorder.cleared).toHaveLength(1)
    expect(recorder.redirects).toEqual([])
  })

  it.each(['/planification', '/', '/parametres', '/admin/utilisateurs', '/profil'])(
    'redirects the ordinary page %s',
    async (path) => {
      await validateSession(requestFor({ path }))

      expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
    }
  )

  it('redirects a path that merely starts with an auth route name', async () => {
    // The pattern requires the route name to end at a slash, a query, or the end of the path, so
    // /connexions is an ordinary page and not the sign-in screen.
    await validateSession(requestFor({ path: '/connexions-anciennes' }))

    expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
  })

  it('redirects when the path is absent, treating an unknown path as an ordinary page', async () => {
    // event.path is coalesced to '' before the test, so a missing path must not throw.
    await validateSession({ __event: true, method: 'GET' })

    expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
  })
})

describe('the sign-in route follows the persisted locale', () => {
  beforeEach(async () => {
    await seedUserAccount(client, OWNER_ID, { deactivatedAt: new Date('2026-05-01T00:00:00Z') })
    currentSession = sessionFor(OWNER_ID)
    acceptHeader = 'text/html'
  })

  // The i18n_redirected cookie is the persisted locale mirror that
  // docs/specs/settings/preference-persistence.md line 190 makes the mechanism of record, so the
  // revocation redirect reads the same cookie the router does. An English user must not be dropped
  // onto the French route.
  it('sends an English user to /signin', async () => {
    localeCookie = 'en'

    await validateSession(requestFor())

    expect(recorder.redirects).toEqual([{ status: 302, url: '/signin' }])
  })

  it('sends a French user to /connexion', async () => {
    localeCookie = 'fr'

    await validateSession(requestFor())

    expect(recorder.redirects).toEqual([{ status: 302, url: '/connexion' }])
  })

  it.each([
    ['no cookie', undefined],
    ['an empty cookie', ''],
    ['a locale the app does not support', 'de'],
    ['an uppercase locale', 'EN'],
    ['a region-qualified locale', 'en-CA']
  ])('falls back to the French default given %s', async (_label, cookie) => {
    // French is the default locale (shared/theme.ts, DEFAULT_LOCALE) and AGENTS.md makes FR-first a
    // product non-negotiable, so anything that is not exactly 'en' resolves to /connexion. Worth
    // naming: 'en-CA' and 'EN' are English readers sent to the French route. The comparison is a
    // strict equality against the cookie the i18n module writes, and that module writes 'en', so
    // this is a narrow rather than a live problem.
    localeCookie = cookie

    await validateSession(requestFor())

    expect(recorder.redirects[0]?.url).toBe('/connexion')
  })
})

describe('what this select deliberately does not reconcile, per docs/TODO.md', () => {
  // NOT approval of the behaviour below. docs/TODO.md carries both of these as open entries and says
  // the fix is one more column on this same select, so they are recorded here as limitations that
  // travel with the code rather than dressed up as intent. The assertions are on the mechanism, that
  // the middleware never writes a session on the pass-through, which is exactly what a reconciliation
  // would have to change.

  it('leaves a stale onboarded flag in the session untouched', async () => {
    // docs/TODO.md, "A live session elsewhere keeps a stale `onboarded` flag after a reset": the
    // flag lives in the sealed cookie and this select does not read onboarded_at, so a second
    // device keeps onboarded: true until its session is renewed. The TODO calls it a limitation
    // rather than an invalid state, because it resolves on the next sign-in.
    await seedUserAccount(client, OWNER_ID, { onboardedAt: null })
    currentSession = sessionFor(OWNER_ID, { onboarded: true })

    await validateSession(requestFor())

    expect(recorder.sessionWrites).toEqual([])
    expect(recorder.cleared).toEqual([])
  })

  it('leaves a role the database has since changed untouched', async () => {
    // docs/TODO.md, "`defineAdminEventHandler` trusts the role in the session cookie, which nothing
    // reconciles": "An admin demoted to `user` keeps every admin route until they sign in again."
    // The stored role is read here to show the divergence is real and not hypothetical.
    await seedUserAccount(client, OWNER_ID, { role: 'user' })
    currentSession = sessionFor(OWNER_ID, { role: 'admin' })

    await validateSession(requestFor())

    const stored = await client.execute({
      sql: 'SELECT role FROM users WHERE id = ?',
      args: [OWNER_ID]
    })
    expect(stored.rows[0]?.role).toBe('user')
    expect(recorder.sessionWrites).toEqual([])
    expect(recorder.cleared).toEqual([])
  })

  it('does not check a password version, so a password change revokes nothing', async () => {
    // Asserted because docs/specs/settings/settings-page.md line 178 makes it a documented tradeoff
    // rather than an oversight: "There is no revocation list to clear, so a password change cannot
    // force other cookies to expire without adding a password-version column to users and checking
    // it on every request. That is a larger cross-cutting change and is out of scope."
    await seedUserAccount(client, OWNER_ID, { passwordHash: 'fake-scrypt$brand-new-password' })
    currentSession = sessionFor(OWNER_ID)

    await validateSession(requestFor())

    expect(recorder.cleared).toEqual([])
  })
})
