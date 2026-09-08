import { RequestSchema, VerifySchema } from '~~/server/models/magic-link'
import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, LOCALES } from '#shared/theme'

// server/models/magic-link.ts, the two schemas behind the invite-only signup: the request that sends
// a link and the verification that consumes one. Both were uncovered.
//
// What they fix, from the module's own header and the specs it points at:
//
//   The email is normalized "so the allowlist key written by the admin invite and the key this
//   signup lookup reads always match. SQLite text comparison is case-sensitive, so a mixed-case
//   address would otherwise diverge from the lowercased allowlist entry and hit the neutral no-send
//   path, leaving the invitee unable to sign up." That is the sharpest consequence of any
//   normalization in the project, because the failure is silent by design: the request handler
//   answers { success: true } either way so the response never reveals whether an address is on the
//   allowlist (docs/specs/admin/manage-users.md line 157). An invitee who typed a capital would get
//   a cheerful confirmation and no email.
//
//   The locale is "sent by the signup form as its active UI locale so the magic-link email arrives
//   in that language. It falls back to the default only if a caller omits it, and uses the shared
//   LOCALES contract so the accepted set cannot drift from the rest of the app."
//
// LOCALES and DEFAULT_LOCALE are read from shared/theme.ts rather than retyped, because the module
// makes that contract the source and a retyped copy would keep passing after a locale was added.
// The refused values are literals, since a locale the app does not support cannot be derived from
// the list of the ones it does.
//
// Every field is given at least one value it refuses.

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

describe('RequestSchema email', () => {
  it('accepts a plain address', () => {
    const result = RequestSchema.safeParse({ email: 'invitee@example.com' })

    expect(result.success).toBe(true)
    expect(result.data?.email).toBe('invitee@example.com')
  })

  it('lowercases the address, so it matches the lowercased allowlist entry', () => {
    expect(RequestSchema.safeParse({ email: 'Invitee@Example.COM' }).data?.email).toBe(
      'invitee@example.com'
    )
  })

  it('trims the address', () => {
    expect(RequestSchema.safeParse({ email: '  invitee@example.com \n' }).data?.email).toBe(
      'invitee@example.com'
    )
  })

  it('normalizes before validating, so a padded mixed-case address reaches the allowlist lookup', () => {
    expect(RequestSchema.safeParse({ email: '\tINVITEE@EXAMPLE.COM  ' }).data?.email).toBe(
      'invitee@example.com'
    )
  })

  it('agrees with the admin invite normalization, which writes the key this reads', () => {
    // server/models/admin.ts applies the same three steps. These two are the write and the read of
    // one key, so a divergence between them is an invitee who can never sign up while the admin sees
    // a successful invite.
    expect(RequestSchema.safeParse({ email: ' MiXeD@Example.COM ' }).data?.email).toBe(
      'mixed@example.com'
    )
  })

  it.each([
    ['no at sign', 'not-an-email'],
    ['no domain', 'invitee@'],
    ['no local part', '@example.com'],
    ['no dot in the domain', 'invitee@example'],
    ['an interior space', 'in vitee@example.com'],
    ['two at signs', 'a@@b.com'],
    ['an empty string', ''],
    ['whitespace only', ' \t ']
  ])('refuses an email with %s', (_label, email) => {
    expect(RequestSchema.safeParse({ email }).success).toBe(false)
  })

  it.each([
    ['missing', {}],
    ['null', { email: null }],
    ['a number', { email: 1 }],
    ['an array', { email: ['a@b.com'] }]
  ])('refuses an email that is %s', (_label, body) => {
    expect(RequestSchema.safeParse(body).success).toBe(false)
  })

  it('reports a malformed email on the email path', () => {
    const result = RequestSchema.safeParse({ email: 'nope' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['email']])
  })
})

describe('RequestSchema locale', () => {
  it.each(LOCALES)('accepts the supported locale %s', (locale) => {
    const result = RequestSchema.safeParse({ email: 'invitee@example.com', locale })

    expect(result.data?.locale).toBe(locale)
  })

  it('defaults to the shared default locale when a caller omits it', () => {
    // Read from DEFAULT_LOCALE rather than compared to 'fr', so the assertion follows the contract
    // if the default ever moves. AGENTS.md makes FR the default and EN the supported second.
    const result = RequestSchema.safeParse({ email: 'invitee@example.com' })

    expect(result.data?.locale).toBe(DEFAULT_LOCALE)
  })

  it('defaults to French specifically, which is the product non-negotiable', () => {
    // Asserted as a literal once, next to the contract-read assertion above, because "FR default" is
    // a product rule in AGENTS.md and not merely whatever the constant happens to say.
    expect(RequestSchema.safeParse({ email: 'invitee@example.com' }).data?.locale).toBe('fr')
  })

  it.each([
    ['a locale the app does not support', 'de'],
    ['an uppercase locale', 'FR'],
    ['a region-qualified locale', 'fr-CA'],
    ['an English region variant', 'en-US'],
    ['an empty string', ''],
    ['a three-letter code', 'fra']
  ])('refuses %s', (_label, locale) => {
    // A locale outside the set would index emailTemplates with a key that does not exist, so the
    // refusal here is what stops an undefined template reaching the send.
    expect(RequestSchema.safeParse({ email: 'invitee@example.com', locale }).success).toBe(false)
  })

  it.each([
    ['null', null],
    ['a number', 1],
    ['a boolean', true],
    ['an array', ['fr']]
  ])('refuses a locale that is %s', (_label, locale) => {
    // Null is refused rather than defaulted, which is the correct half of the absent-against-null
    // distinction: a default answers "you decide", an explicit null asks for no locale at all and
    // there is no such thing here.
    expect(RequestSchema.safeParse({ email: 'invitee@example.com', locale }).success).toBe(false)
  })

  it('reports a bad locale on the locale path while the email is fine', () => {
    const result = RequestSchema.safeParse({ email: 'invitee@example.com', locale: 'de' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['locale']])
  })
})

describe('RequestSchema as a whole', () => {
  it('parses a fully specified request', () => {
    expect(RequestSchema.safeParse({ email: ' Invitee@Example.com ', locale: 'en' }).data).toEqual({
      email: 'invitee@example.com',
      locale: 'en'
    })
  })

  it('refuses an empty body, since the email has no default', () => {
    expect(RequestSchema.safeParse({}).success).toBe(false)
  })

  it('reports both fields when both are wrong', () => {
    const result = RequestSchema.safeParse({ email: 'nope', locale: 'de' })

    expect(
      result.error?.issues
        .map((issue) => issue.path)
        .flat()
        .sort()
    ).toEqual(['email', 'locale'])
  })

  it('drops any other key rather than carrying it to the handler', () => {
    const result = RequestSchema.safeParse({ email: 'invitee@example.com', token: 'forged' })

    expect(result.success).toBe(true)
    expect(Object.keys(result.data!).sort()).toEqual(['email', 'locale'])
  })
})

describe('VerifySchema token', () => {
  it('accepts a uuid of the shape crypto.randomUUID produces', () => {
    // server/api/magic-link/handlers/request.ts mints the token with crypto.randomUUID, so a v4 uuid
    // is the only shape that ever reaches this schema legitimately.
    const result = VerifySchema.safeParse({ token: VALID_UUID })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ token: VALID_UUID })
  })

  it('accepts an uppercase uuid, which is the same token to a case-insensitive reader', () => {
    expect(VerifySchema.safeParse({ token: VALID_UUID.toUpperCase() }).success).toBe(true)
  })

  it.each([
    ['a plain word', 'not-a-uuid'],
    ['an empty string', ''],
    ['a uuid with the dashes removed', '11111111111141118111111111111111'],
    ['a uuid in braces', `{${VALID_UUID}}`],
    ['a uuid with a trailing space', `${VALID_UUID} `],
    ['a uuid with a leading space', ` ${VALID_UUID}`],
    ['a truncated uuid', '11111111-1111-4111-8111-1111111111'],
    ['a uuid with an extra group', `${VALID_UUID}-1111`],
    ['a uuid with a non-hex character', '1111111g-1111-4111-8111-111111111111'],
    ['a uuid with an invalid variant nibble', '11111111-1111-4111-c111-111111111111']
  ])('refuses %s', (_label, token) => {
    // A path or query parameter is untrusted input like any other, so a malformed token fails here
    // rather than reaching the token lookup.
    expect(VerifySchema.safeParse({ token }).success).toBe(false)
  })

  it('is not trimmed, unlike the email, so a padded token is refused rather than repaired', () => {
    // Correct for a token. Repairing one would mean accepting a value that is not the one the email
    // carried, and the token is a credential rather than a typed field.
    expect(VerifySchema.safeParse({ token: ` ${VALID_UUID} ` }).success).toBe(false)
  })

  it.each([
    ['missing', {}],
    ['null', { token: null }],
    ['a number', { token: 1 }],
    ['an array', { token: [VALID_UUID] }],
    ['two repeated token params', { token: [VALID_UUID, VALID_UUID] }]
  ])('refuses a token that is %s', (_label, body) => {
    expect(VerifySchema.safeParse(body).success).toBe(false)
  })

  it('reports a malformed token on the token path', () => {
    const result = VerifySchema.safeParse({ token: 'nope' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['token']])
  })

  it('accepts any RFC-shaped uuid version, not only version 4', () => {
    // z.uuid() is version-agnostic, so a v1-shaped value and the nil uuid both parse. Recorded
    // rather than presented as intent: it is harmless, because the schema only decides whether the
    // string is well formed and the handler still has to find a stored row matching it, and every
    // stored token is a v4 from crypto.randomUUID. If this ever needed pinning the schema would say
    // z.uuid('v4') rather than the handler guessing.
    expect(VerifySchema.safeParse({ token: '11111111-1111-1111-8111-111111111111' }).success).toBe(
      true
    )
    expect(VerifySchema.safeParse({ token: '00000000-0000-0000-0000-000000000000' }).success).toBe(
      true
    )
  })

  it('drops any other key rather than carrying it to the handler', () => {
    const result = VerifySchema.safeParse({ token: VALID_UUID, email: 'someone@example.com' })

    expect(result.success).toBe(true)
    expect(Object.keys(result.data!)).toEqual(['token'])
  })
})
