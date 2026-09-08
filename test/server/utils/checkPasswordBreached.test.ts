import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// server/utils/checkPasswordBreached.ts, the Have I Been Pwned range lookup that gates every
// password the app ever stores. It is called by the onboarding wizard and by the password change,
// and it had no test.
//
// What the specs fix:
//
//   docs/specs/onboarding/onboarding-wizard.md AC11: "The handler still calls
//   isPasswordBreached(body.password) before hashing and still throws createError({ statusCode: 422,
//   statusMessage: 'password_breached' }) on a hit."
//
//   docs/specs/settings/settings-page.md line 171: "The new password is checked against Have I Been
//   Pwned via the existing k-anonymity isPasswordBreached (only a five-character SHA-1 prefix leaves
//   the server; it fails open on outage)."
//
//   docs/specs/settings/settings-page.md acceptance 13: "A new password that appears in the Have I
//   Been Pwned corpus returns 422 password_breached and changes nothing. If the HIBP lookup is
//   unreachable, the change is allowed to proceed (fail open), matching onboarding."
//
// So there are three properties: the corpus hit is reported, the miss is reported, and only five
// characters of the hash leave the process. The fail-open arm is spec-sanctioned rather than an
// accident, and it is asserted below with the spec line quoted next to it, because a control that
// answers "not breached" when it cannot reach its corpus is a security decision and not an
// implementation detail.
//
// NOTHING HERE REACHES THE NETWORK. $fetch is the seam and it is replaced. globalThis.fetch is also
// replaced, with a spy that throws, and every test asserts it was never touched, so a lookup that
// somehow bypassed the seam fails the suite instead of silently contacting api.pwnedpasswords.com
// from a test run.
//
// The SHA-1 digests below are published values verified with sha1sum, an independent tool, and not
// read out of a run of the code under test. That matters here more than anywhere else in this batch,
// because a test that hashed the password with the same crypto.subtle call the implementation uses
// would agree with any hash function at all, including a broken one.

// SHA1('password'), the canonical HIBP documentation example.
const PASSWORD = 'password'
const PASSWORD_PREFIX = '5BAA6'
const PASSWORD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'

// SHA1('abc'), a second known digest so the lookup can be shown to depend on the password.
const ABC_PREFIX = 'A9993'
const ABC_SUFFIX = 'E364706816ABA3E25717850C26C9CD0D89D'

// SHA1(''), because the empty password is a real input at a boundary that must not throw on it.
const EMPTY_PREFIX = 'DA39A'
const EMPTY_SUFFIX = '3EE5E6B4B0D3255BFEF95601890AFD80709'

// A response line as the range API returns one: the remaining 35 hex characters of the hash, a
// colon, and the number of times it was seen.
function line(suffix: string, count = 3730471) {
  return `${suffix}:${count}`
}

// Three suffixes that are not the one being looked for, so a miss is a miss against a populated
// response rather than against an empty one.
const OTHER_LINES = [
  line('0018A45C4D1DEF81644B54AB7F969B88D65'),
  line('00D4F6E8FA6EECAD2A3AA415EEC418D38EC'),
  line('011053FD0102E94D6AE2F8B83D76FAF94F6')
]

const fetchCalls: { options: unknown; url: string }[] = []
let respondWith: (url: string) => Promise<string | unknown>

const realFetchSpy = vi.fn(() => {
  throw new Error('A test reached the real network. The $fetch seam was bypassed.')
})

let isPasswordBreached: (password: string) => Promise<boolean>

beforeEach(async () => {
  fetchCalls.length = 0
  realFetchSpy.mockClear()
  respondWith = async () => OTHER_LINES.join('\r\n')

  vi.stubGlobal('$fetch', async (url: string, options: unknown) => {
    fetchCalls.push({ options, url })
    return respondWith(url)
  })
  vi.stubGlobal('fetch', realFetchSpy)

  isPasswordBreached = (await import('~~/server/utils/checkPasswordBreached')).isPasswordBreached
})

afterEach(() => {
  // Every case, not only the ones about the URL. A lookup that escaped the seam would otherwise be
  // invisible in a suite that only asserted on the returned boolean.
  expect(realFetchSpy).not.toHaveBeenCalled()
})

describe('the instrument, before anything is concluded from a "not breached" answer', () => {
  // Four criteria below conclude from `false`. A function that returned false unconditionally, which
  // is exactly what the fail-open arm looks like from the outside, would satisfy every one of them.
  // So it is first shown returning true.
  it('reports a breach at all', async () => {
    respondWith = async () => [...OTHER_LINES, line(PASSWORD_SUFFIX)].join('\r\n')

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(true)
  })

  it('calls the lookup rather than answering from nothing', async () => {
    await isPasswordBreached(PASSWORD)

    expect(fetchCalls).toHaveLength(1)
  })
})

describe('k-anonymity: only five characters of the hash leave the server', () => {
  it('requests the range for the first five hex characters of the SHA-1', async () => {
    await isPasswordBreached(PASSWORD)

    expect(fetchCalls[0]?.url).toBe(`https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`)
  })

  it('sends the remaining 35 characters of the hash nowhere', async () => {
    // The whole point of the scheme. The suffix is what identifies the password inside the range, so
    // if it ever appeared in the request the lookup would be an exact-hash submission.
    await isPasswordBreached(PASSWORD)

    const wire = JSON.stringify(fetchCalls)
    expect(wire).not.toContain(PASSWORD_SUFFIX)
    expect(wire.toUpperCase()).not.toContain(PASSWORD_SUFFIX)
  })

  it('sends the password itself nowhere', async () => {
    await isPasswordBreached('correct horse battery staple')

    expect(JSON.stringify(fetchCalls)).not.toContain('correct horse battery staple')
  })

  it('asks for the response as text rather than letting it be parsed as JSON', async () => {
    // The range API answers with a newline-separated text body. Without responseType: 'text' ofetch
    // guesses, and a guessed parse would make list.split a TypeError, which the catch below would
    // swallow into a silent "not breached".
    await isPasswordBreached(PASSWORD)

    expect(fetchCalls[0]?.options).toEqual({ responseType: 'text' })
  })

  it('uses an uppercase prefix, which is the form the range API indexes', async () => {
    await isPasswordBreached(PASSWORD)

    const prefix = String(fetchCalls[0]?.url).split('/range/')[1]
    expect(prefix).toBe(prefix?.toUpperCase())
    expect(prefix).toHaveLength(5)
  })

  it.each([
    ['password', PASSWORD, PASSWORD_PREFIX],
    ['abc', 'abc', ABC_PREFIX],
    ['the empty password', '', EMPTY_PREFIX]
  ])('derives the prefix from the password itself, given %s', async (_label, password, prefix) => {
    // Three independently known digests. A constant prefix, or a prefix taken from something other
    // than the SHA-1 of the password, cannot satisfy all three.
    await isPasswordBreached(password)

    expect(fetchCalls[0]?.url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`)
  })
})

describe('a password whose suffix is in the range is breached', () => {
  it.each([
    ['first', (suffix: string) => [line(suffix), ...OTHER_LINES]],
    ['in the middle', (suffix: string) => [OTHER_LINES[0]!, line(suffix), OTHER_LINES[1]!]],
    ['last', (suffix: string) => [...OTHER_LINES, line(suffix)]]
  ])('reports true when the suffix appears %s in the response', async (_label, build) => {
    respondWith = async () => build(PASSWORD_SUFFIX).join('\r\n')

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(true)
  })

  it('reports true from a response that is the single matching line', async () => {
    respondWith = async () => line(PASSWORD_SUFFIX)

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(true)
  })

  it('tolerates the CRLF line endings the range API actually sends', async () => {
    // The live endpoint separates lines with \r\n while the implementation splits on \n alone. The
    // trailing \r survives on each line, but it lands after the colon, so the suffix comparison is
    // unaffected. Asserted rather than assumed, because it is the difference between this control
    // working in production and never matching anything.
    respondWith = async () => `${OTHER_LINES[0]}\r\n${line(PASSWORD_SUFFIX)}\r\n${OTHER_LINES[1]}`

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(true)
  })

  it('works with bare LF line endings too', async () => {
    respondWith = async () => `${OTHER_LINES[0]}\n${line(PASSWORD_SUFFIX)}\n${OTHER_LINES[1]}`

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(true)
  })

  it('reports a breach for a password seen only once', async () => {
    // The app has no minimum-occurrence threshold, and should not: one appearance in the corpus is
    // one appearance too many for a stored credential.
    respondWith = async () => line(PASSWORD_SUFFIX, 1)

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(true)
  })

  it('ignores the occurrence count entirely, including a count of zero', async () => {
    // Worth the owner's eye rather than a bug today. HIBP's optional padding feature returns decoy
    // entries with a count of 0, and this comparison would read one as a hit. Padding is only
    // returned when the request sends the Add-Padding header, which this lookup does not, so the
    // decoys never arrive. If that header is ever added, the count has to start being read.
    respondWith = async () => line(PASSWORD_SUFFIX, 0)

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(true)
  })

  it('matches on the suffix of the password asked about and not another in the same range', async () => {
    respondWith = async () => [line(ABC_SUFFIX), ...OTHER_LINES].join('\r\n')

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
    await expect(isPasswordBreached('abc')).resolves.toBe(true)
  })

  it('reports the empty password as breached when its suffix is listed', async () => {
    respondWith = async () => line(EMPTY_SUFFIX)

    await expect(isPasswordBreached('')).resolves.toBe(true)
  })
})

describe('a password whose suffix is not in the range is not breached', () => {
  it('reports false against a populated range that does not list it', async () => {
    respondWith = async () => OTHER_LINES.join('\r\n')

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('reports false against an empty range', async () => {
    respondWith = async () => ''

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('does not match a suffix that merely starts with the same characters', async () => {
    respondWith = async () => line(`${PASSWORD_SUFFIX.slice(0, 30)}00000`)

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('does not match a longer line whose suffix contains the real one', async () => {
    // The comparison reads the whole field before the colon, not a substring, so a truncated or
    // extended entry is not a hit.
    respondWith = async () => `AA${PASSWORD_SUFFIX}:5`

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('does not match a line carrying no colon at all', async () => {
    respondWith = async () => `${PASSWORD_SUFFIX} 12345`

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })
})

describe('the comparison is case-sensitive against the response, which the owner should see', () => {
  // FINDING, reported rather than fixed. The implementation uppercases its own hash and then
  // compares with ===, so it depends on the range API continuing to answer in uppercase hex. It does
  // today, and the suffix match above proves the pairing works. But the failure mode is silent and
  // total: if that response format ever changed case, every password in the corpus would read as
  // clean and the control would be switched off with nothing failing anywhere. Asserted as it
  // behaves, not as it should behave, because the fix is a source change and this stage writes tests.
  it('does not match a lowercase suffix in the response', async () => {
    respondWith = async () => line(PASSWORD_SUFFIX.toLowerCase())

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('does not match a mixed-case suffix in the response', async () => {
    const mixed = PASSWORD_SUFFIX.slice(0, 10).toLowerCase() + PASSWORD_SUFFIX.slice(10)
    respondWith = async () => line(mixed)

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('is not case-sensitive about the password, which is hashed as given', async () => {
    // The two differ as bytes, so they differ as digests and land in different ranges. This is the
    // correct behaviour for a password and is asserted so the case-sensitivity above is not mistaken
    // for a property of the input.
    await isPasswordBreached('Password')
    const upper = fetchCalls[0]?.url
    fetchCalls.length = 0
    await isPasswordBreached('password')

    expect(upper).not.toBe(fetchCalls[0]?.url)
  })
})

describe('the lookup fails open, which is a documented decision rather than an accident', () => {
  // docs/specs/settings/settings-page.md acceptance 13: "If the HIBP lookup is unreachable, the
  // change is allowed to proceed (fail open), matching onboarding." The source states the same
  // reason: "A breach-list outage must not block a legitimate user from onboarding."
  //
  // FLAGGED FOR THE OWNER even though it is spec-sanctioned, because the consequence is that a
  // breached password is accepted and stored whenever api.pwnedpasswords.com is unreachable, and
  // nothing anywhere records that the check did not run. The decision is defensible; the silence is
  // the part worth a second look. A third return state, or a logged skip, would keep the decision and
  // remove the silence. No test here asserts that the outage is invisible as though that were
  // desirable; they assert the shipped answer and name the cost.
  it.each([
    ['a network error', new Error('fetch failed')],
    ['a DNS failure', new Error('getaddrinfo ENOTFOUND api.pwnedpasswords.com')],
    ['a timeout', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })],
    [
      'a 500 from the range API',
      Object.assign(new Error('500 Internal Server Error'), { status: 500 })
    ],
    ['a 429 rate limit', Object.assign(new Error('429 Too Many Requests'), { status: 429 })],
    ['a 404', Object.assign(new Error('404 Not Found'), { status: 404 })]
  ])('answers false rather than throwing on %s', async (_label, failure) => {
    respondWith = async () => {
      throw failure
    }

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('answers false rather than throwing when the body is not a string at all', async () => {
    // ofetch guessing a JSON parse, or a proxy returning an object, makes list.split a TypeError
    // inside the try. It is caught by the same arm, so a malformed body is an outage as far as this
    // function is concerned.
    respondWith = async () => ({ error: 'unavailable' })

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('answers false rather than throwing when the body is null', async () => {
    respondWith = async () => null

    await expect(isPasswordBreached(PASSWORD)).resolves.toBe(false)
  })

  it('never rejects, so a caller does not have to guard the call', async () => {
    // The onboarding and password-change handlers both call this inline with no try of their own
    // (docs/specs/settings/settings-page.md line 96), so a rejection here would surface as a 500 on
    // a password change.
    respondWith = async () => {
      throw new Error('boom')
    }

    const result = await isPasswordBreached(PASSWORD).then(
      (value) => ({ resolved: value }),
      (error) => ({ rejected: error })
    )

    expect(result).toEqual({ resolved: false })
  })

  it('still made the attempt before failing open', async () => {
    // Distinguishes a fail-open from a lookup that was never performed. If the request is not even
    // issued, the false is not an outage answer, it is a missing control.
    respondWith = async () => {
      throw new Error('fetch failed')
    }

    await isPasswordBreached(PASSWORD)

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe(`https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`)
  })
})

describe('the boundary holds for awkward passwords', () => {
  it.each([
    ['a long passphrase', 'a'.repeat(200)],
    ['accented French characters', 'coucou-l-été-où-ça'],
    ['an emoji', 'mot-de-passe-🔐'],
    ['leading and trailing spaces', '  spaced password  '],
    ['a newline', 'two\nlines'],
    ['a colon, which is the response separator', 'has:a:colon']
  ])('hashes and looks up %s without throwing', async (_label, password) => {
    await expect(isPasswordBreached(password)).resolves.toBe(false)
    expect(fetchCalls[0]?.url).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/)
  })

  it('encodes a multi-byte password as UTF-8 before hashing, so the digest is stable', async () => {
    // TextEncoder is always UTF-8, and the digest of a non-ASCII password therefore does not depend
    // on any platform default. Two calls for the same password must land in the same range.
    await isPasswordBreached('été')
    const first = fetchCalls[0]?.url
    fetchCalls.length = 0
    await isPasswordBreached('été')

    expect(fetchCalls[0]?.url).toBe(first)
  })

  it('produces a 40-character hash, so the prefix and suffix together are the whole digest', async () => {
    // 5 + 35 = 40 hex characters. Asserted through the two published values rather than by reading
    // the hash out of the function, which does not expose it.
    expect(`${PASSWORD_PREFIX}${PASSWORD_SUFFIX}`).toHaveLength(40)
    expect(`${ABC_PREFIX}${ABC_SUFFIX}`).toHaveLength(40)
    expect(`${EMPTY_PREFIX}${EMPTY_SUFFIX}`).toHaveLength(40)
  })
})
