import {
  DeactivateSchema,
  InviteSchema,
  ListQuerySchema,
  ReactivateSchema
} from '~~/server/models/admin'
import { SORT_COLUMNS, SORT_ORDERS } from '~~/server/utils/manage-users'
import { describe, expect, it } from 'vitest'

// server/models/admin.ts, the validation boundary for the whole admin membership surface: the three
// email-keyed actions (invite, deactivate, reactivate) and the list query behind the users table.
//
// What the specs fix:
//
//   docs/specs/admin/manage-users.md line 84: "Normalize the email (trim, lowercase) so the
//   allowlist key and the later magic-link lookup match." Line 37 makes email the key every row
//   action is aimed by, and the module's own header says the same: "Doing it in the schema means the
//   allowlist key written here always matches the key the magic-link allowlist lookup reads later,
//   and the handlers never see a stray-cased or padded address."
//
//   docs/specs/admin/users-table-sort-search.md is the source for the list query. `sort` and `order`
//   are enums over the server's own whitelists, and line 119 gives the reason the sort is
//   server-decided: "status sorts by the canonical value (active, deactivated, invited), never by the
//   translated label, so the order is stable and locale-independent on the server."
//
// The module header fixes the rest: page is 1-based and defaults to 1, pageSize defaults to 12 and is
// bounded "so a caller cannot request an unbounded page", a malformed param "fails validation and the
// route returns a 400", a valid page past the last page "is not an error and simply returns an empty
// page", and search "is trimmed and length-capped; empty or absent means no filter".
//
// Every field is given at least one value it refuses. A schema suite that only feeds valid input
// proves the parse runs and never that the boundary is a boundary.
//
// The two enums are read from server/utils/manage-users.ts rather than retyped, because that module
// is the declared single source of truth for them and a retyped copy would keep passing after a
// column was added there. The rejected values below are literals on purpose: a raw column name that
// must never reach an ORDER BY cannot be derived from the list of the ones that may.

describe('the email key shared by invite, deactivate, and reactivate', () => {
  const schemas = [
    ['InviteSchema', InviteSchema],
    ['DeactivateSchema', DeactivateSchema],
    ['ReactivateSchema', ReactivateSchema]
  ] as const

  describe.each(schemas)('%s', (_name, schema) => {
    it('accepts a plain lowercase address', () => {
      const result = schema.safeParse({ email: 'owner@example.com' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ email: 'owner@example.com' })
    })

    it('lowercases the address, so the allowlist key matches the later lookup', () => {
      // SQLite text comparison is case-sensitive, which is why this happens in the schema rather
      // than in each handler. A stray-cased invite would write a key the magic-link request could
      // never find, leaving the invitee unable to sign up.
      const result = schema.safeParse({ email: 'Owner@Example.COM' })

      expect(result.data).toEqual({ email: 'owner@example.com' })
    })

    it('trims surrounding whitespace before validating', () => {
      const result = schema.safeParse({ email: '   owner@example.com\n' })

      expect(result.data).toEqual({ email: 'owner@example.com' })
    })

    it('normalizes then validates, so a padded mixed-case address is accepted and cleaned', () => {
      // The order matters. Validating first would reject the padded form outright rather than
      // cleaning it, and an admin who pasted an address with a trailing space would see a 400.
      const result = schema.safeParse({ email: '  Alexandre.Gilbert@Example.Org  ' })

      expect(result.data).toEqual({ email: 'alexandre.gilbert@example.org' })
    })

    it.each([
      ['no local part', '@example.com'],
      ['no domain', 'owner@'],
      ['no at sign', 'not-an-email'],
      ['no dot in the domain', 'owner@example'],
      ['a single-label domain', 'a@b'],
      ['an interior space', 'owner example@test.com'],
      ['two at signs', 'owner@@example.com'],
      ['an empty string', ''],
      ['whitespace only', '   ']
    ])('refuses %s', (_label, email) => {
      expect(schema.safeParse({ email }).success).toBe(false)
    })

    it.each([
      ['a missing email key', {}],
      ['a null email', { email: null }],
      ['a numeric email', { email: 12345 }],
      ['an array of addresses', { email: ['a@b.com', 'c@d.com'] }],
      ['an object', { email: { address: 'a@b.com' } }],
      ['a body that is not an object at all', 'owner@example.com']
    ])('refuses %s', (_label, body) => {
      expect(schema.safeParse(body).success).toBe(false)
    })

    it('reports the failure on the email path, so the route can name the field', () => {
      const result = schema.safeParse({ email: 'not-an-email' })

      expect(result.success).toBe(false)
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([['email']])
    })

    it('accepts a subaddressed and multi-label address, which is a real deliverable form', () => {
      const result = schema.safeParse({ email: 'owner+admin@mail.example.co.uk' })

      expect(result.data).toEqual({ email: 'owner+admin@mail.example.co.uk' })
    })

    it('drops any other key rather than carrying it to the handler', () => {
      // These bodies are not strict(), so an unknown key is stripped instead of refused. Worth
      // asserting rather than assuming, because it is what makes the shape a handler receives
      // exactly one field wide no matter what a client sends. Unlike the task write boundary, which
      // is strict() and answers 422, a client that sends role here is silently ignored. That is a
      // deliberate difference in kind: nothing downstream reads a second key, so there is no
      // mass-assignment surface to protect, and the neutral drop is the shipped choice.
      const result = schema.safeParse({ email: 'owner@example.com', role: 'admin', id: 'x' })

      expect(result.success).toBe(true)
      expect(Object.keys(result.data!)).toEqual(['email'])
    })
  })

  it('gives all three actions the same rule, so one cannot drift from the others', () => {
    // The three are separate schemas over one shared emailSchema. If one were ever rewritten inline,
    // this is what would catch the divergence.
    const padded = { email: '  MiXeD@Example.COM ' }

    expect(InviteSchema.safeParse(padded).data).toEqual(DeactivateSchema.safeParse(padded).data)
    expect(InviteSchema.safeParse(padded).data).toEqual(ReactivateSchema.safeParse(padded).data)
  })
})

describe('ListQuerySchema defaults, for a request that names no params', () => {
  it('defaults to the first page of twelve, newest first', () => {
    const result = ListQuerySchema.safeParse({})

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ page: 1, pageSize: 12, sort: 'date', order: 'desc' })
  })

  it('leaves search absent rather than defaulting it to an empty string', () => {
    // "empty or absent means no filter", so the handler has one absent case to read rather than two.
    const result = ListQuerySchema.safeParse({})

    expect(result.data).not.toHaveProperty('search')
  })

  it('defaults each param independently of the others', () => {
    const result = ListQuerySchema.safeParse({ page: '4' })

    expect(result.data).toEqual({ page: 4, pageSize: 12, sort: 'date', order: 'desc' })
  })
})

describe('ListQuerySchema page and pageSize, which arrive as query strings', () => {
  it.each([
    ['a string', '3', 3],
    ['a number', 3, 3],
    ['exponent notation', '1e3', 1000],
    ['the first page', '1', 1]
  ])('coerces page given %s', (_label, value, expected) => {
    expect(ListQuerySchema.safeParse({ page: value }).data?.page).toBe(expected)
  })

  it.each([
    ['zero', '0'],
    ['a negative page', '-1'],
    ['a fractional page', '1.5'],
    ['a non-numeric page', 'abc'],
    ['an empty string, which coerces to zero', ''],
    ['a boolean-looking string', 'true'],
    ['null', null],
    ['two repeated page params', ['1', '2']]
  ])('refuses page given %s', (_label, value) => {
    expect(ListQuerySchema.safeParse({ page: value }).success).toBe(false)
  })

  it('accepts a page far past the last one, which is an empty page and not an error', () => {
    // The module header is explicit: "A valid page past the last page is not an error and simply
    // returns an empty page, handled downstream." So page carries no upper bound, deliberately.
    expect(ListQuerySchema.safeParse({ page: '1000000' }).data?.page).toBe(1000000)
  })

  it.each([
    ['the smallest page', '1', 1],
    ['the documented default', '12', 12],
    ['the largest page', '100', 100]
  ])('accepts pageSize %s', (_label, value, expected) => {
    expect(ListQuerySchema.safeParse({ pageSize: value }).data?.pageSize).toBe(expected)
  })

  it.each([
    ['zero', '0'],
    ['a negative size', '-5'],
    ['one past the cap', '101'],
    ['a wildly unbounded size', '100000'],
    ['a fractional size', '12.5'],
    ['a non-numeric size', 'all']
  ])('refuses pageSize given %s', (_label, value) => {
    // The bound is the reason the cap exists: "pageSize is bounded so a caller cannot request an
    // unbounded page." A refused 100000 is the whole point.
    expect(ListQuerySchema.safeParse({ pageSize: value }).success).toBe(false)
  })

  it('reports a malformed page on the page path, so the 400 can name the field', () => {
    const result = ListQuerySchema.safeParse({ page: '0' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['page'])
  })

  it('reports both malformed numbers rather than stopping at the first', () => {
    const result = ListQuerySchema.safeParse({ page: '0', pageSize: '999' })

    expect(result.success).toBe(false)
    expect(
      result.error?.issues
        .map((issue) => issue.path)
        .flat()
        .sort()
    ).toEqual(['page', 'pageSize'])
  })
})

describe('ListQuerySchema sort and order, which never reach SQL as raw text', () => {
  it.each(SORT_COLUMNS)('accepts the whitelisted sort column %s', (column) => {
    expect(ListQuerySchema.safeParse({ sort: column }).data?.sort).toBe(column)
  })

  it.each([
    'created_at',
    'password_hash',
    'deactivated_at',
    'id',
    'firstname',
    'FirstName',
    'email desc',
    'email; DROP TABLE users',
    'random()',
    ''
  ])('refuses the sort value %j', (value) => {
    // "sort and order are Zod enums derived from the single-source-of-truth whitelists in
    // manage-users.ts, so a raw column name never reaches the sort." The three refused column names
    // are real columns on the users table, which is what makes the enum a boundary rather than a
    // spelling check.
    expect(ListQuerySchema.safeParse({ sort: value }).success).toBe(false)
  })

  it.each(SORT_ORDERS)('accepts the order %s', (order) => {
    expect(ListQuerySchema.safeParse({ order }).data?.order).toBe(order)
  })

  it.each(['ASC', 'Desc', 'ascending', 'up', '', 'desc, id asc'])(
    'refuses the order value %j',
    (value) => {
      expect(ListQuerySchema.safeParse({ order: value }).success).toBe(false)
    }
  )

  it.each([
    ['null', null],
    ['a number', 1],
    ['an array', ['email']]
  ])('refuses a sort that is %s rather than a string', (_label, value) => {
    expect(ListQuerySchema.safeParse({ sort: value }).success).toBe(false)
  })

  it('defaults the sort to the date column and the order to newest first', () => {
    // A default that names a real whitelisted column, so the route never has to branch on absence.
    const result = ListQuerySchema.safeParse({})

    expect(SORT_COLUMNS).toContain(result.data!.sort)
    expect(SORT_ORDERS).toContain(result.data!.order)
  })
})

describe('ListQuerySchema search, which is trimmed and capped', () => {
  it('trims a search term', () => {
    expect(ListQuerySchema.safeParse({ search: '  alexandre  ' }).data?.search).toBe('alexandre')
  })

  it('keeps an interior space, so a two-word search still works', () => {
    expect(ListQuerySchema.safeParse({ search: 'Alexandre Gilbert' }).data?.search).toBe(
      'Alexandre Gilbert'
    )
  })

  it('does not lowercase the term, leaving case folding to the query', () => {
    expect(ListQuerySchema.safeParse({ search: 'Alexandre' }).data?.search).toBe('Alexandre')
  })

  it('reduces a whitespace-only search to an empty string, which means no filter', () => {
    expect(ListQuerySchema.safeParse({ search: '   ' }).data?.search).toBe('')
  })

  it('accepts an explicit empty search', () => {
    expect(ListQuerySchema.safeParse({ search: '' }).data?.search).toBe('')
  })

  it('accepts exactly 200 characters', () => {
    expect(ListQuerySchema.safeParse({ search: 'a'.repeat(200) }).success).toBe(true)
  })

  it('refuses 201 characters', () => {
    expect(ListQuerySchema.safeParse({ search: 'a'.repeat(201) }).success).toBe(false)
  })

  it('measures the cap after trimming', () => {
    // trim() runs before max(), so 200 characters wrapped in whitespace is a legal 200 rather than
    // an over-long 204.
    expect(ListQuerySchema.safeParse({ search: `  ${'a'.repeat(200)}  ` }).success).toBe(true)
  })

  it.each([
    ['a number', 12],
    ['null', null],
    ['an array of terms', ['a', 'b']],
    ['a boolean', true]
  ])('refuses a search that is %s', (_label, value) => {
    expect(ListQuerySchema.safeParse({ search: value }).success).toBe(false)
  })

  it('accepts an accented term, since the users being searched have French names', () => {
    expect(ListQuerySchema.safeParse({ search: 'Éloïse' }).data?.search).toBe('Éloïse')
  })

  it('accepts a term containing SQL punctuation as a literal string', () => {
    // The term is a value bound into a parameterized LIKE rather than concatenated, so it is text to
    // be searched for and not a shape to be refused. Refusing it would hide a real surname.
    expect(ListQuerySchema.safeParse({ search: "O'Brien" }).data?.search).toBe("O'Brien")
  })
})

describe('ListQuerySchema as a whole', () => {
  it('parses a fully specified query', () => {
    const result = ListQuerySchema.safeParse({
      page: '2',
      pageSize: '25',
      sort: 'email',
      order: 'asc',
      search: '  gilbert '
    })

    expect(result.data).toEqual({
      page: 2,
      pageSize: 25,
      sort: 'email',
      order: 'asc',
      search: 'gilbert'
    })
  })

  it('drops an unknown query param rather than refusing the request', () => {
    const result = ListQuerySchema.safeParse({ page: '1', status: 'deactivated' })

    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('status')
  })

  it('refuses the whole query when one param is malformed, rather than falling back to a default', () => {
    // The distinction the module header draws: "When a param is absent it falls back to its default.
    // When a param is present but malformed, such as a non-numeric page or page=0, it fails
    // validation and the route returns a 400." Silently serving page 1 for page=0 would show the
    // admin a page they did not ask for.
    expect(ListQuerySchema.safeParse({ page: '0', sort: 'email' }).success).toBe(false)
  })
})
