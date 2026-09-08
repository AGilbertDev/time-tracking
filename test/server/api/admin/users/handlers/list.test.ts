import type { Client } from '@libsql/client'
import type { SortColumn, SortOrder, UserStatus } from '~~/server/utils/manage-users'

import { SORT_COLUMNS, SORT_ORDERS } from '~~/server/utils/manage-users'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskTestDb } from '../../../../../helpers/taskTestDb'

import {
  countRows,
  createTaskTestDb,
  OTHER_USER_ID,
  OWNER_ID,
  seedUserAccount
} from '../../../../../helpers/taskTestDb'
import {
  clearUsers,
  readAllowedEmailRows,
  readAllUserRows,
  seedAllowedEmail,
  seedExtraUser,
  toSeconds
} from '../adminUsersFixtures'

// GET /api/admin/users, the paginated admin users list.
//
// Expected behaviour is taken from docs/specs/admin/users-table-sort-search.md (the request and
// response contract, the server processing order, the sortable-column whitelist, and the search
// behaviour) and from the "Users list" section of docs/specs/admin/manage-users.md (the data
// source, the columns, the status derivation, and the date source). The first of those supersedes
// the second on page size and ordering and says so explicitly, so where they disagree the newer
// spec is what these assertions encode.
//
// This is a list endpoint, so the project's backend convention applies and each half of it is a
// real assertion here rather than a comment: paging, sorting, and searching all happen on the
// server against the whole merged dataset and never against the rows already loaded for one page;
// only whitelisted columns can be sorted, so a raw column name from the query string never reaches
// the comparison; and the response carries the page rows plus a `total` count of every match.
//
// The fixture deliberately spans more than one page. On a single-page fixture `total` and
// `rows.length` agree, so every paging and total assertion would pass whether or not the handler
// counted the whole dataset. Fifteen distinct emails against the specced default page size of 12
// makes the two diverge, and it puts the alphabetically first email on the last page of the default
// date-descending order, which is what makes "sorting happens on the server against everything"
// observable rather than asserted.
//
// The seam is useDb, which hands back a genuine Drizzle instance over an in-memory libSQL database
// carrying the shipped DDL. Fixtures go in with raw SQL and assertions read raw SQL, so the handler
// is never also what sets up or reports on its own state.

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }))

vi.mock('~~/server/db/index', () => ({ useDb: () => dbRef.current }))

const { listUsers } = await import('~~/server/api/admin/users/handlers/list')

type ListQuery = {
  order: SortOrder
  page: number
  pageSize: number
  search?: string
  sort: SortColumn
}

// The defaults the route's ListQuerySchema applies before the handler ever runs: page 1, page size
// 12, sort by date descending, no search. They are restated here because the handler takes an
// already-validated query object, and a test that passed a partial one would be exercising a state
// no request can produce. The schema itself is another agent's subject.
function query(overrides: Partial<ListQuery> = {}): ListQuery {
  return { page: 1, pageSize: 12, sort: 'date', order: 'desc', ...overrides }
}

let harness: TaskTestDb
let client: Client

// The fifteen-email fixture. Five have a users row, ten are invited-only allowlist entries, and one
// email (dual@) sits in both tables so the union keyed by email can be checked for a duplicate.
//
// dual@example.com is the load-bearing row in three different ways. It is alphabetically first, so
// an email-ascending sort has to lift it from the last page to the top. Its users.created_at is the
// oldest date in the set, so the default date-descending order puts it last. And its allowlist
// invited_at is one of the newest dates in the set, so if the merge preferred invited_at over
// created_at for an account it would jump to the front instead, and the date-source rule fails
// loudly rather than silently.
const OWNER_CREATED = new Date('2026-03-01T00:00:00Z')
const OTHER_CREATED = new Date('2026-02-01T00:00:00Z')
const OTHER_DEACTIVATED = new Date('2026-04-15T00:00:00Z')
const GENEVIEVE_CREATED = new Date('2026-05-01T00:00:00Z')
const PENDING_CREATED = new Date('2026-06-01T00:00:00Z')
const DUAL_CREATED = new Date('2026-01-15T00:00:00Z')
const DUAL_INVITED = new Date('2026-07-20T00:00:00Z')

const INVITE_EMAILS = Array.from(
  { length: 10 },
  (_, index) => `invite${String(index + 1).padStart(2, '0')}@example.com`
)

// invite01 is the oldest and invite10 the newest, one day apart, so the date order is unambiguous
// and no two invited rows tie.
function invitedAtFor(index: number): Date {
  return new Date(`2026-07-${String(index + 1).padStart(2, '0')}T00:00:00Z`)
}

const ALL_EMAILS = [
  'owner@example.com',
  'other@example.com',
  'genevieve@example.com',
  'pending-account@example.com',
  'dual@example.com',
  ...INVITE_EMAILS
]

// The whole set in the default order: effective date descending, ties broken by email ascending.
const DATE_DESC_EMAILS = [
  ...[...INVITE_EMAILS].reverse(),
  'pending-account@example.com',
  'genevieve@example.com',
  'owner@example.com',
  'other@example.com',
  'dual@example.com'
]

const EMAIL_ASC_EMAILS = [...ALL_EMAILS].sort((a, b) => a.localeCompare(b))

async function seedFullDataset(): Promise<void> {
  await seedUserAccount(client, OWNER_ID, {
    createdAt: OWNER_CREATED,
    firstName: 'Alexandre',
    lastName: 'Gilbert',
    passwordHash: 'hash-owner',
    role: 'admin'
  })

  await seedUserAccount(client, OTHER_USER_ID, {
    createdAt: OTHER_CREATED,
    deactivatedAt: OTHER_DEACTIVATED,
    firstName: 'Bernard',
    lastName: 'Zola',
    passwordHash: 'hash-other',
    role: 'user'
  })

  await seedExtraUser(client, {
    createdAt: GENEVIEVE_CREATED,
    email: 'genevieve@example.com',
    firstName: 'Geneviève',
    id: 'user-genevieve',
    lastName: 'Éloïse',
    passwordHash: 'hash-genevieve'
  })

  // Accepted the magic link, never onboarded: a users row with no password and no name.
  await seedExtraUser(client, {
    createdAt: PENDING_CREATED,
    email: 'pending-account@example.com',
    id: 'user-pending',
    passwordHash: null
  })

  await seedExtraUser(client, {
    createdAt: DUAL_CREATED,
    email: 'dual@example.com',
    firstName: 'Colette',
    id: 'user-dual',
    lastName: 'Aubry',
    passwordHash: 'hash-dual'
  })
  await seedAllowedEmail(client, 'dual@example.com', DUAL_INVITED)

  for (const [index, email] of INVITE_EMAILS.entries()) {
    await seedAllowedEmail(client, email, invitedAtFor(index))
  }
}

function emailsOf(rows: { email: string }[]): string[] {
  return rows.map((row) => row.email)
}

beforeEach(async () => {
  harness = await createTaskTestDb()
  client = harness.client
  dbRef.current = harness.db
})

describe('listUsers pagination', () => {
  // Spec: "`total` is the count of rows after search filtering, across the whole merged dataset,
  // not the page length", and the response carries page, pageSize, rows, total, totalPages.
  it('returns one page of rows while reporting a total that counts every match', async () => {
    await seedFullDataset()

    const result = await listUsers(query())

    expect(result.rows).toHaveLength(12)
    // The whole point of the assertion above and this one together: 12 rows came back, 15 exist.
    expect(result.total).toBe(15)
    expect(await countRows(client, 'users')).toBe(5)
    expect(await countRows(client, 'allowed_emails')).toBe(11)
    expect(result.totalPages).toBe(2)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(12)
  })

  it('returns the remainder on the last page and repeats the same whole-dataset total', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ page: 2 }))

    expect(result.rows).toHaveLength(3)
    expect(result.total).toBe(15)
    expect(result.totalPages).toBe(2)
    expect(result.page).toBe(2)
  })

  it('partitions the whole dataset across its pages with no duplicate and no omission', async () => {
    await seedFullDataset()

    const first = await listUsers(query({ page: 1 }))
    const second = await listUsers(query({ page: 2 }))

    const seen = [...emailsOf(first.rows), ...emailsOf(second.rows)]
    expect(seen).toHaveLength(15)
    expect([...seen].sort()).toEqual([...ALL_EMAILS].sort())
  })

  it('slices a non-dividing page size into a correct last partial page', async () => {
    await seedFullDataset()

    const last = await listUsers(query({ page: 3, pageSize: 6 }))

    // totalPages = max(1, ceil(15 / 6)) = 3, and the third page holds the remaining three rows.
    expect(last.totalPages).toBe(3)
    expect(last.total).toBe(15)
    expect(last.rows).toHaveLength(3)
    expect(last.pageSize).toBe(6)
  })

  // Spec edge case: "A `page` beyond `totalPages` returns an empty `rows` array with an accurate
  // `total` and `totalPages` rather than an error."
  it('returns an empty page with an accurate total for a page beyond the last one', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ page: 3 }))

    expect(result.rows).toEqual([])
    expect(result.total).toBe(15)
    expect(result.totalPages).toBe(2)
  })

  // Spec edge case: "No emails at all yields total: 0, totalPages: 1, an empty rows array".
  it('reports total 0 and totalPages 1 when no email exists at all', async () => {
    await clearUsers(client)

    const result = await listUsers(query())

    expect(result.rows).toEqual([])
    expect(result.total).toBe(0)
    expect(result.totalPages).toBe(1)
  })
})

describe('listUsers ordering', () => {
  // Spec: "Default sort is sort=date, order=desc ... newest effective date first, ties broken by
  // email ascending."
  it('defaults to the effective date descending across the whole dataset', async () => {
    await seedFullDataset()

    const first = await listUsers(query({ page: 1 }))
    const second = await listUsers(query({ page: 2 }))

    expect([...emailsOf(first.rows), ...emailsOf(second.rows)]).toEqual(DATE_DESC_EMAILS)
  })

  it('breaks a tie on the effective date by email ascending', async () => {
    // Three invited-only rows sharing one invited_at to the second, seeded in a non-alphabetical
    // order so the tie-break has to do real work rather than inherit the insertion order.
    const shared = new Date('2026-08-01T00:00:00Z')
    await clearUsers(client)
    await seedAllowedEmail(client, 'charlie@example.com', shared)
    await seedAllowedEmail(client, 'alpha@example.com', shared)
    await seedAllowedEmail(client, 'bravo@example.com', shared)

    const ascending = await listUsers(query({ sort: 'date', order: 'asc' }))
    const descending = await listUsers(query({ sort: 'date', order: 'desc' }))

    // The tie-break is email ascending in both directions: it decides the order only after the
    // date comparison has come out equal, so reversing the sort must not reverse it.
    expect(emailsOf(ascending.rows)).toEqual([
      'alpha@example.com',
      'bravo@example.com',
      'charlie@example.com'
    ])
    expect(emailsOf(descending.rows)).toEqual([
      'alpha@example.com',
      'bravo@example.com',
      'charlie@example.com'
    ])
  })

  // Spec list criterion: "Ordering is stable and deterministic between two calls to the same page."
  it('returns an identical page for two identical requests', async () => {
    await seedFullDataset()

    const first = await listUsers(query({ page: 1 }))
    const second = await listUsers(query({ page: 1 }))

    expect(second).toEqual(first)
  })

  // Spec: "Sorting by each whitelisted column, in each direction, orders the full filtered dataset
  // and returns the correct page of that order, not a re-order of one page." The parameterisation
  // is driven by the whitelist itself, so a column added to it without a page-level sort fails
  // here rather than shipping unexercised.
  it.each(
    SORT_COLUMNS.flatMap((sort) => SORT_ORDERS.map((order) => ({ sort, order }))) as {
      order: SortOrder
      sort: SortColumn
    }[]
  )(
    'slices page 1 out of the whole-dataset order for sort=$sort order=$order',
    async ({ sort, order }) => {
      await seedFullDataset()

      const whole = await listUsers(query({ sort, order, pageSize: 100 }))
      const paged = await listUsers(query({ sort, order, pageSize: 12, page: 1 }))
      const second = await listUsers(query({ sort, order, pageSize: 12, page: 2 }))

      expect(whole.rows).toHaveLength(15)
      expect(emailsOf(paged.rows)).toEqual(emailsOf(whole.rows).slice(0, 12))
      expect(emailsOf(second.rows)).toEqual(emailsOf(whole.rows).slice(12))
    }
  )

  // The convention this feature exists to satisfy. Under the default order dual@example.com is on
  // the last page; an email-ascending sort must bring it to the top of page 1, which is only
  // possible if the sort ran against the whole dataset before the page was sliced. A client-side
  // sort of the loaded page could never produce this.
  it('sorts the whole dataset, lifting the alphabetically first email from the last page to the top', async () => {
    await seedFullDataset()

    const defaultLastPage = await listUsers(query({ page: 2 }))
    expect(emailsOf(defaultLastPage.rows)).toContain('dual@example.com')
    const defaultFirstPage = await listUsers(query({ page: 1 }))
    expect(emailsOf(defaultFirstPage.rows)).not.toContain('dual@example.com')

    const sorted = await listUsers(query({ sort: 'email', order: 'asc' }))

    expect(sorted.rows[0]?.email).toBe('dual@example.com')
    expect(emailsOf(sorted.rows)).toEqual(EMAIL_ASC_EMAILS.slice(0, 12))
  })

  it('sorts email descending from the whole dataset', async () => {
    await seedFullDataset()

    const sorted = await listUsers(query({ sort: 'email', order: 'desc' }))

    expect(emailsOf(sorted.rows)).toEqual([...EMAIL_ASC_EMAILS].reverse().slice(0, 12))
  })

  // Spec: "Null firstName, lastName, and role ... always sort to the end regardless of order, so
  // invited-only rows never crowd the top just because their fields are empty."
  it.each(SORT_ORDERS)('sorts rows with no first name last for order=%s', async (order) => {
    await seedFullDataset()

    const result = await listUsers(query({ sort: 'firstName', order, pageSize: 100 }))

    const named = ['Alexandre', 'Bernard', 'Colette', 'Geneviève']
    const expectedNamed = order === 'asc' ? named : [...named].reverse()
    expect(result.rows.slice(0, 4).map((row) => row.firstName)).toEqual(expectedNamed)
    // The eleven rows with no first name (ten invited-only, plus the users row that accepted the
    // link without onboarding) are all at the end, in both directions.
    expect(result.rows.slice(4).every((row) => row.firstName === null)).toBe(true)
    expect(result.rows.slice(4)).toHaveLength(11)
  })

  it.each(SORT_ORDERS)('sorts rows with no role last for order=%s', async (order) => {
    await seedFullDataset()

    const result = await listUsers(query({ sort: 'role', order, pageSize: 100 }))

    // Five accounts carry a role; the ten invited-only rows have none and go last either way.
    expect(result.rows.slice(0, 5).every((row) => row.role !== null)).toBe(true)
    expect(result.rows.slice(5).every((row) => row.role === null)).toBe(true)
    expect(result.rows.slice(5)).toHaveLength(10)
  })

  // Spec: "status sorts by the canonical value (active, deactivated, invited), never by the
  // translated label, so the order is stable and locale-independent on the server." The handler
  // takes no locale, so the observable form of that rule is a canonical grouping that no request
  // can influence, with the email tie-break inside each group.
  it('groups a status sort by canonical value with the email tie-break inside each group', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ sort: 'status', order: 'asc', pageSize: 100 }))

    const statuses: UserStatus[] = result.rows.map((row) => row.status)
    expect(statuses.slice(0, 11).every((status) => status === 'invited')).toBe(true)
    expect(statuses.slice(11, 14).every((status) => status === 'active')).toBe(true)
    expect(statuses[14]).toBe('deactivated')

    // Inside the active group the order is email ascending, not insertion order.
    expect(emailsOf(result.rows.slice(11, 14))).toEqual([
      'dual@example.com',
      'genevieve@example.com',
      'owner@example.com'
    ])
  })

  it('reverses the canonical status grouping for a descending status sort', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ sort: 'status', order: 'desc', pageSize: 100 }))

    expect(result.rows[0]?.status).toBe('deactivated')
    expect(result.rows.slice(1, 4).every((row) => row.status === 'active')).toBe(true)
    expect(result.rows.slice(4).every((row) => row.status === 'invited')).toBe(true)
  })

  // Spec: "`sort` only accepts the whitelisted columns. Sorting is never performed against a raw
  // column name from the query string." The route's Zod enum is the gate, but the handler must not
  // be the kind of code that would sort by whatever string it was handed, so it is driven here with
  // a real users column that is deliberately not on the whitelist.
  //
  // password_hash is the sharpest choice available: it is a real column, it is seeded with values
  // whose order differs from every whitelisted order, and it is the one field in the row that must
  // never leave the server. If a raw name could reach the comparison, the returned page would be
  // ordered by a secret, and an admin could read the relative order of stored password hashes off
  // a list that never displays them.
  it('never orders by a column outside the sortable whitelist', async () => {
    await seedFullDataset()

    const offWhitelist = await listUsers(
      query({ sort: 'passwordHash' as SortColumn, pageSize: 100 })
    )
    const emailAscending = await listUsers(query({ sort: 'email', order: 'asc', pageSize: 100 }))

    // Nothing outside the whitelist can influence the comparison, so the only ordering left is the
    // email-ascending tie-break every sort ends with. The full set still comes back.
    expect(emailsOf(offWhitelist.rows)).toEqual(emailsOf(emailAscending.rows))
    expect(offWhitelist.total).toBe(15)
    // And the row contract carries no such field to have sorted on in the first place.
    expect(Object.keys(offWhitelist.rows[0] ?? {})).not.toContain('passwordHash')
  })
})

describe('listUsers search', () => {
  // Spec: "Filtering happens on the server against the full merged set before pagination, so a
  // match on page five is found from page one." dual@ is on page 2 of the default order.
  it('finds a match that sits on a later page of the unfiltered order', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'dual' }))

    expect(emailsOf(result.rows)).toEqual(['dual@example.com'])
    expect(result.total).toBe(1)
    expect(result.totalPages).toBe(1)
  })

  it('reports total as the filtered count rather than the whole dataset', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'invite' }))

    expect(result.total).toBe(10)
    expect(result.rows).toHaveLength(10)
    expect(result.totalPages).toBe(1)
  })

  it('paginates the filtered set, so totalPages follows the filtered total', async () => {
    await seedFullDataset()

    const first = await listUsers(query({ search: 'invite', pageSize: 6, page: 1 }))
    const second = await listUsers(query({ search: 'invite', pageSize: 6, page: 2 }))

    expect(first.rows).toHaveLength(6)
    expect(second.rows).toHaveLength(4)
    expect(second.total).toBe(10)
    expect(second.totalPages).toBe(2)
  })

  it('returns an empty page with the filtered total for a page beyond the filtered last one', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'invite', pageSize: 6, page: 3 }))

    expect(result.rows).toEqual([])
    expect(result.total).toBe(10)
    expect(result.totalPages).toBe(2)
  })

  // Spec: "Folding is required, not optional. This is a French-first translator product, so
  // 'Genevieve' must match 'Geneviève'." The term used here appears only in the last name, never in
  // the email, so the fold is what makes the match rather than a substring of the address.
  it('matches an unaccented term against an accented last name', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'eloise' }))

    expect(emailsOf(result.rows)).toEqual(['genevieve@example.com'])
    expect(result.total).toBe(1)
  })

  it('matches an unaccented term against an accented first name', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'Genevieve' }))

    expect(result.rows.map((row) => row.firstName)).toEqual(['Geneviève'])
  })

  it('matches an email case-insensitively', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'OWNER@Example' }))

    expect(emailsOf(result.rows)).toEqual(['owner@example.com'])
  })

  it('matches a first name case-insensitively', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'ALEXANDRE' }))

    expect(emailsOf(result.rows)).toEqual(['owner@example.com'])
  })

  // Spec: "The term is trimmed. Empty or whitespace-only means no filter, and all rows pass."
  it.each([
    { label: 'whitespace-only', search: '   ' },
    { label: 'empty', search: '' },
    { label: 'absent', search: undefined }
  ])('treats a $label term as no filter', async ({ search }) => {
    await seedFullDataset()

    const result = await listUsers(query({ search }))

    expect(result.total).toBe(15)
    expect(result.rows).toHaveLength(12)
  })

  it('trims a padded term before matching', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: '  dual  ' }))

    expect(emailsOf(result.rows)).toEqual(['dual@example.com'])
  })

  // Spec edge case: "Search matches nothing. Server returns an empty page with total: 0."
  it('returns total 0 and totalPages 1 when the term matches nothing', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'no-such-person' }))

    expect(result.rows).toEqual([])
    expect(result.total).toBe(0)
    expect(result.totalPages).toBe(1)
  })

  // Spec, out of scope: "searching on role, status, or date. Search is name and email only." The
  // owner's row carries role 'admin' and status 'active', and no email or name in the fixture
  // contains either word, so a match on any of them would be a leak of the wider search this spec
  // deliberately did not build.
  it.each(['admin', 'active', 'deactivated'])(
    'does not match the %s role or status value',
    async (search) => {
      await seedFullDataset()

      const result = await listUsers(query({ search }))

      expect(result.rows).toEqual([])
      expect(result.total).toBe(0)
    }
  )

  it('orders the filtered set by the requested sort', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'invite', sort: 'email', order: 'desc' }))

    expect(emailsOf(result.rows)).toEqual([...INVITE_EMAILS].reverse())
  })
})

describe('listUsers row contract', () => {
  // "Users list" columns and status derivation in manage-users.md: an invited-only email shows
  // status invited, empty name and role, and its invited_at as the date.
  it('shapes an invited-only allowlist entry as invited with no name, no role, and its invited date', async () => {
    await clearUsers(client)
    const invitedAt = new Date('2026-08-03T10:00:00Z')
    await seedAllowedEmail(client, 'newcomer@example.com', invitedAt)

    const result = await listUsers(query())

    expect(result.rows).toEqual([
      {
        date: invitedAt,
        email: 'newcomer@example.com',
        firstName: null,
        lastName: null,
        role: null,
        status: 'invited'
      }
    ])
  })

  it('shapes an account with a password and no deactivation as active with its created date', async () => {
    await clearUsers(client)
    const createdAt = new Date('2026-04-04T08:00:00Z')
    await seedExtraUser(client, {
      createdAt,
      email: 'active@example.com',
      firstName: 'Anne',
      id: 'user-active',
      lastName: 'Roy',
      passwordHash: 'hash',
      role: 'admin'
    })

    const result = await listUsers(query())

    expect(result.rows).toEqual([
      {
        date: createdAt,
        email: 'active@example.com',
        firstName: 'Anne',
        lastName: 'Roy',
        role: 'admin',
        status: 'active'
      }
    ])
  })

  // Spec: "A users row with deactivated_at set shows Deactivated regardless of allowlist
  // membership", which is why the fixture keeps an allowlist row for the same email.
  it('shapes a deactivated account as deactivated even while it is still on the allowlist', async () => {
    await clearUsers(client)
    await seedExtraUser(client, {
      createdAt: new Date('2026-04-04T08:00:00Z'),
      deactivatedAt: new Date('2026-05-05T08:00:00Z'),
      email: 'gone@example.com',
      id: 'user-gone',
      passwordHash: 'hash'
    })
    await seedAllowedEmail(client, 'gone@example.com', new Date('2026-06-06T08:00:00Z'))

    const result = await listUsers(query())

    expect(result.rows.map((row) => row.status)).toEqual(['deactivated'])
  })

  // Spec: "A users row with a null password_hash shows Invited (accepted link, not onboarded)."
  it('shapes an account with no password as invited', async () => {
    await clearUsers(client)
    await seedExtraUser(client, {
      createdAt: new Date('2026-04-04T08:00:00Z'),
      email: 'accepted@example.com',
      id: 'user-accepted',
      passwordHash: null
    })

    const result = await listUsers(query())

    expect(result.rows.map((row) => row.status)).toEqual(['invited'])
  })

  // Spec data source: "One row per distinct email across both tables", and the date column is
  // users.created_at for rows that have a users row, otherwise allowed_emails.invited_at.
  it('collapses an email present in both tables into one row dated by its created_at', async () => {
    await seedFullDataset()

    const result = await listUsers(query({ search: 'dual', pageSize: 100 }))

    expect(result.rows).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.rows[0]?.date).toEqual(DUAL_CREATED)
    // The allowlist row for the same email carries a much later date, so this is a real choice
    // between the two rather than a coincidence.
    expect(DUAL_INVITED.getTime()).toBeGreaterThan(DUAL_CREATED.getTime())
  })

  it('collapses an email whose casing differs between the two tables into one row', async () => {
    await clearUsers(client)
    await seedExtraUser(client, {
      createdAt: new Date('2026-04-04T08:00:00Z'),
      email: 'Mixed.Case@Example.com',
      id: 'user-mixed',
      passwordHash: 'hash'
    })
    await seedAllowedEmail(client, 'mixed.case@example.com', new Date('2026-04-01T08:00:00Z'))

    const result = await listUsers(query())

    expect(result.rows).toHaveLength(1)
    expect(result.total).toBe(1)
  })
})

describe('listUsers is a read', () => {
  // The list is a GET and must write nothing. Every other handler in this folder is scoped to one
  // account and changes it; this one is scoped to nobody and changes none, so the guard is that
  // every row in both tables comes back byte-identical.
  it('leaves every users and allowlist row byte-identical', async () => {
    await seedFullDataset()

    const usersBefore = await readAllUserRows(client)
    const allowlistBefore = await readAllowedEmailRows(client)

    await listUsers(query())
    await listUsers(query({ page: 2, sort: 'email', order: 'asc', search: 'invite' }))

    expect(await readAllUserRows(client)).toEqual(usersBefore)
    expect(await readAllowedEmailRows(client)).toEqual(allowlistBefore)
    expect(await countRows(client, 'users')).toBe(5)
    expect(await countRows(client, 'allowed_emails')).toBe(11)
    // And the seeded dates really are the stored seconds, so the comparison above is over the
    // stored representation rather than a re-decoded one.
    expect(allowlistBefore.find((row) => row.email === 'dual@example.com')?.invited_at).toBe(
      toSeconds(DUAL_INVITED)
    )
  })
})
