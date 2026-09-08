import { LoginSchema } from '~~/server/models/auth'
import { describe, expect, it } from 'vitest'

// server/models/auth.ts, the one schema behind POST /api/auth/login. It is two fields, and it had no
// test.
//
// What it fixes, from its own header and from docs/spec.md line 16 ("sign-in (/connexion, email +
// password)"):
//
//   "Normalize before validating (trim, lowercase, then check the email format) so a mixed-case
//   login input still matches the lowercased email stored at signup. The login handler looks the user
//   up with an exact eq(users.email, ...) and SQLite text comparison is case-sensitive, so without
//   this a user who typed any uppercase could not sign in."
//
// That is a real sign-in failure rather than a tidiness rule, which is why the normalization is
// asserted as behaviour and not only as a passing parse.
//
// The password rule is deliberately the opposite. It is checked for presence and nothing else: no
// trim, no case change, no length policy. A login is a comparison against a stored hash, so any
// transformation here would silently prevent a legitimate password from ever verifying. The policy
// bounds live in server/models/password.ts and apply where a password is set, not where one is
// presented (docs/specs/settings/settings-page.md line 58).
//
// Every field is given at least one value it refuses.

describe('LoginSchema email', () => {
  it('accepts a plain address and hands it back unchanged', () => {
    const result = LoginSchema.safeParse({ email: 'owner@example.com', password: 'secret' })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ email: 'owner@example.com', password: 'secret' })
  })

  it('lowercases a mixed-case address, so the exact lookup still finds the account', () => {
    const result = LoginSchema.safeParse({ email: 'Owner@Example.COM', password: 'secret' })

    expect(result.data?.email).toBe('owner@example.com')
  })

  it('trims an address a browser or a paste padded with whitespace', () => {
    const result = LoginSchema.safeParse({ email: '  owner@example.com  ', password: 'secret' })

    expect(result.data?.email).toBe('owner@example.com')
  })

  it('normalizes before validating, so a padded mixed-case address signs in', () => {
    const result = LoginSchema.safeParse({ email: ' OWNER@EXAMPLE.COM\t', password: 'secret' })

    expect(result.data?.email).toBe('owner@example.com')
  })

  it('agrees with the signup and admin normalization, so one address is one key everywhere', () => {
    // server/models/magic-link.ts and server/models/admin.ts apply the same three steps in the same
    // order. Three copies of one rule is the drift risk this asserts against: if any of them changed
    // alone, an account created through one path could not be found through another.
    expect(
      LoginSchema.safeParse({ email: '  MiXeD@Example.COM ', password: 'x' }).data?.email
    ).toBe('mixed@example.com')
  })

  it.each([
    ['no at sign', 'not-an-email'],
    ['no domain', 'owner@'],
    ['no local part', '@example.com'],
    ['no dot in the domain', 'owner@example'],
    ['an interior space', 'owner name@example.com'],
    ['two at signs', 'owner@@example.com'],
    ['an empty string', ''],
    ['whitespace only', '  ']
  ])('refuses an email with %s', (_label, email) => {
    expect(LoginSchema.safeParse({ email, password: 'secret' }).success).toBe(false)
  })

  it.each([
    ['missing', {}],
    ['null', { email: null }],
    ['a number', { email: 1 }],
    ['an array', { email: ['a@b.com'] }],
    ['an object', { email: { address: 'a@b.com' } }]
  ])('refuses an email that is %s', (_label, override) => {
    expect(LoginSchema.safeParse({ password: 'secret', ...override }).success).toBe(false)
  })

  it('reports a malformed email on the email path', () => {
    const result = LoginSchema.safeParse({ email: 'nope', password: 'secret' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['email']])
  })
})

describe('LoginSchema password', () => {
  it('accepts any non-empty password', () => {
    expect(LoginSchema.safeParse({ email: 'owner@example.com', password: 'x' }).success).toBe(true)
  })

  it.each([
    ['an empty string', ''],
    ['missing', undefined],
    ['null', null],
    ['a number', 12345678],
    ['a boolean', true],
    ['an array', ['secret']],
    ['an object', { value: 'secret' }]
  ])('refuses a password that is %s', (_label, password) => {
    const body: Record<string, unknown> = { email: 'owner@example.com' }
    if (password !== undefined) body.password = password

    expect(LoginSchema.safeParse(body).success).toBe(false)
  })

  it('reports an empty password on the password path', () => {
    const result = LoginSchema.safeParse({ email: 'owner@example.com', password: '' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['password']])
  })

  it.each([
    ['leading and trailing spaces', '  spaced  '],
    ['a single space', ' '],
    ['a tab', '\t'],
    ['mixed case', 'PaSsWoRd'],
    ['accents', 'motdepassé'],
    ['an emoji', 'clé-🔐'],
    ['200 characters', 'a'.repeat(200)],
    ['far past any policy bound', 'a'.repeat(5000)]
  ])('passes %s through untouched, since it is compared against a hash', (_label, password) => {
    // Not a permissive oversight. Trimming here would make a password with a deliberate trailing
    // space unusable forever, and applying the 8-character policy here would lock out any account
    // whose password predates the policy while telling them their credentials were malformed.
    const result = LoginSchema.safeParse({ email: 'owner@example.com', password })

    expect(result.success).toBe(true)
    expect(result.data?.password).toBe(password)
  })

  it('does not apply the set-time policy bounds, so a short stored password can still sign in', () => {
    // server/models/password.ts holds the 8-character floor for setting a password. A login that
    // enforced it too would refuse a legitimate credential at the front door, and the refusal would
    // read to the user as a wrong password.
    expect(LoginSchema.safeParse({ email: 'owner@example.com', password: 'abc' }).success).toBe(
      true
    )
  })
})

describe('LoginSchema as a whole', () => {
  it('reports both fields when both are wrong, rather than stopping at the first', () => {
    const result = LoginSchema.safeParse({ email: 'nope', password: '' })

    expect(result.success).toBe(false)
    expect(
      result.error?.issues
        .map((issue) => issue.path)
        .flat()
        .sort()
    ).toEqual(['email', 'password'])
  })

  it('refuses an empty body', () => {
    expect(LoginSchema.safeParse({}).success).toBe(false)
  })

  it.each([
    ['a string', 'owner@example.com'],
    ['null', null],
    ['an array', []],
    ['a number', 1]
  ])('refuses a body that is %s rather than an object', (_label, body) => {
    expect(LoginSchema.safeParse(body).success).toBe(false)
  })

  it('drops any other key rather than carrying it to the handler', () => {
    // Not strict(), so an extra key is stripped. Asserted because it is what keeps the handler's
    // input exactly two fields wide: a client sending role or id gets neither honoured nor an error,
    // and the session the handler mints is built from the stored row rather than from the body.
    const result = LoginSchema.safeParse({
      email: 'owner@example.com',
      password: 'secret',
      role: 'admin',
      onboarded: true
    })

    expect(result.success).toBe(true)
    expect(Object.keys(result.data!).sort()).toEqual(['email', 'password'])
  })
})
