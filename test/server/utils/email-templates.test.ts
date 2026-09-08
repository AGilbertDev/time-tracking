import { emailTemplates } from '~~/server/utils/email-templates'
import { describe, expect, it } from 'vitest'

import { APP_NAME } from '#shared/brand'

// server/utils/email-templates.ts, the transactional copy for the three messages the app sends: the
// magic link, the invitation, and the deactivation notice. Only the module's own subject lines were
// ever evaluated, so all five body functions were uncovered.
//
// What the specs fix:
//
//   docs/specs/admin/manage-users.md line 91: the invitation is "fully bilingual: French first then
//   English in one message, with one call-to-action link", because "an invited person has no
//   persisted locale yet".
//
//   docs/specs/admin/manage-users.md line 166: the deactivation notice is "Localized templates under
//   emailTemplates.fr.accountDeactivated and emailTemplates.en.accountDeactivated, selected by the
//   target user's persisted locale (not a UI locale)", and line 161 says the message "states the
//   account is deactivated and to contact the admin".
//
//   docs/specs/admin/manage-users.md line 96 and line 260: the compliance baseline is a clear real
//   sender identity for CASL and CAN-SPAM, and the bilingual invitation satisfies the Law 101 French
//   obligation.
//
//   AGENTS.md makes copy quality a product non-negotiable: French first, English second, and French
//   uses a space before ? ! : ;.
//
// THE COPY IS ASSERTED AS SHIPPED AND NOT CORRECTED. The user is a professional translator and the
// module's own header says every string is "a proposal pending owner verification". So nothing below
// invents a better sentence or fixes a phrasing. What is asserted is structure that a test can own:
// which product name appears, that the link is reachable, that the recovery instruction is present,
// that French comes before English in the bilingual message, and that the French typography rule
// holds. Any wording concern is reported to the owner in prose rather than edited into the source.
//
// Nothing is mocked. This is a pure module of strings and five string-returning functions.

const LINK = 'https://time-tracker.agilbert.dev/api/magic-link/verify?token=abc-123'
const CONTACT = 'alexandre.gilbert.dev@gmail.com'

// French typography, the same rule test/i18n/locale-punctuation.test.ts enforces over the locale
// files, applied here because these strings are user-facing French that lives outside i18n and is
// therefore not covered by that guard.
const SPACED_PUNCTUATION = new Set(['?', '!', ':', ';'])
const NO_BREAK_SPACE = ' '

// Visible prose only. The bodies are HTML, so tags and attributes are removed before the rule is
// applied: `href="mailto:x@y.z"` and `https://` both carry a colon that no reader ever sees, and a
// guard that flagged them would be wrong rather than strict.
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

// A colon hard against a letter or a digit is structural rather than prose, which is the exemption
// test/i18n/locale-punctuation.test.ts resolves from the shape of the string rather than from a list
// of blessed keys. `HH:MM`, a clock time, a ratio, and `https://` all write a colon with a character
// touching it, and French prose never does. The exemption is deliberately colon-only: a semicolon
// carries no technical form, so it is always prose.
//
// The limit of the exemption, stated rather than smoothed over: it also excuses a genuine French
// prose colon written with no space at all, as in `Voici la liste:`. That is the shipped guard's
// documented tradeoff, because a rule that flagged `HH:MM` would produce false positives and get
// suppressed. It is repeated here rather than tightened, so this suite reports on the same rule the
// locale files are held to.
function isTechnicalColon(value: string, index: number): boolean {
  const previous = value[index - 1]
  if (previous === undefined) return false
  return /[\p{L}\p{N}]/u.test(previous)
}

// The accepted separator is a real U+00A0 and nothing else. A plain space is a violation, which is
// the point: AGENTS.md asks for the space and the inline-editor spec restates it as AC57 asking for
// a real no-break space in the copy, because an ordinary space lets the mark wrap to the next line
// on its own.
function findPunctuationViolations(value: string): string[] {
  const findings: string[] = []

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (!SPACED_PUNCTUATION.has(character)) continue
    if (character === ':' && isTechnicalColon(value, index)) continue

    const previous = index > 0 ? value[index - 1]! : 'start of string'
    if (previous === NO_BREAK_SPACE) continue

    findings.push(`${character} at ${index} preceded by ${JSON.stringify(previous)}`)
  }

  return findings
}

describe('the French typography detector, before anything is concluded from it finding nothing', () => {
  // Every French assertion below concludes from an empty findings array. A detector that always
  // returned nothing would satisfy all of them, and a plain space against a no-break space is
  // invisible in an editor and in a diff, so it is exercised against copy that is deliberately wrong
  // and copy that is deliberately right first.
  it.each([
    'Voulez-vous continuer?',
    'Attention!',
    'Premier point; deuxième point',
    'Voulez-vous continuer ?',
    'Attention !'
  ])('flags the wrongly spaced French punctuation in %j', (value) => {
    // The last two carry an ordinary space rather than U+00A0, and they are the reason the detector
    // is exercised at all: the two are visually identical in an editor, in a terminal, and in a
    // pull-request diff.
    expect(findPunctuationViolations(value)).not.toEqual([])
  })

  it.each([
    `Voulez-vous continuer${NO_BREAK_SPACE}?`,
    `Attention${NO_BREAK_SPACE}!`,
    `Voici la liste${NO_BREAK_SPACE}:`,
    `Premier point${NO_BREAK_SPACE}; deuxième point`
  ])('accepts %j, which carries a real no-break space', (value) => {
    expect(findPunctuationViolations(value)).toEqual([])
  })

  it('exempts a colon glued to an alphanumeric character, which is a technical token', () => {
    expect(findPunctuationViolations('mailto:someone@example.com')).toEqual([])
    expect(findPunctuationViolations('https://example.com')).toEqual([])
    expect(findPunctuationViolations('de 09:30 à 17:00')).toEqual([])
  })

  it('flags a semicolon even when a letter is hard against it, since it has no technical form', () => {
    expect(findPunctuationViolations('un point; puis un autre')).not.toEqual([])
  })

  it('strips markup before reading the prose, so an attribute is never scanned', () => {
    expect(visibleText('<a href="mailto:x@y.dev">Écrivez-nous</a>')).not.toContain('mailto')
  })
})

describe('every message names the product, which is the sender-identity baseline', () => {
  // manage-users.md line 260 names the CASL / CAN-SPAM baseline as a clear real sender identity. The
  // envelope side of that lives in sendEmail; the body side is that each message says which app
  // wrote, since a personal sender name alone does not tell the recipient. APP_NAME is read from
  // shared/brand.ts rather than retyped, which is what stops the brand drifting between the sender
  // name and the copy.
  it.each([
    ['fr.magicLink', emailTemplates.fr.magicLink.subject, emailTemplates.fr.magicLink.body(LINK)],
    ['en.magicLink', emailTemplates.en.magicLink.subject, emailTemplates.en.magicLink.body(LINK)],
    [
      'fr.accountDeactivated',
      emailTemplates.fr.accountDeactivated.subject,
      emailTemplates.fr.accountDeactivated.body(CONTACT)
    ],
    [
      'en.accountDeactivated',
      emailTemplates.en.accountDeactivated.subject,
      emailTemplates.en.accountDeactivated.body(CONTACT)
    ],
    ['invite', emailTemplates.invite.subject, emailTemplates.invite.body(LINK)]
  ])('%s carries the product name in both its subject and its body', (_label, subject, body) => {
    expect(subject).toContain(APP_NAME)
    expect(body).toContain(APP_NAME)
  })

  it('has no message whose subject is empty', () => {
    for (const subject of [
      emailTemplates.fr.magicLink.subject,
      emailTemplates.en.magicLink.subject,
      emailTemplates.fr.accountDeactivated.subject,
      emailTemplates.en.accountDeactivated.subject,
      emailTemplates.invite.subject
    ]) {
      expect(subject.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('the magic-link message', () => {
  it('puts the verification link in an anchor the recipient can click', () => {
    expect(emailTemplates.fr.magicLink.body(LINK)).toContain(`<a href="${LINK}">`)
    expect(emailTemplates.en.magicLink.body(LINK)).toContain(`<a href="${LINK}">`)
  })

  it('interpolates the link verbatim, without escaping or re-encoding its query string', () => {
    // The URL is built server-side by the request handler from runtimeConfig plus a generated uuid,
    // so it is not user input. It has to survive intact, because a re-encoded `?token=` would not
    // verify.
    const url = 'https://x.dev/api/magic-link/verify?token=11111111-1111-4111-8111-111111111111'

    expect(emailTemplates.fr.magicLink.body(url)).toContain(url)
    expect(emailTemplates.en.magicLink.body(url)).toContain(url)
  })

  it.each([
    ['fr', emailTemplates.fr.magicLink.body(LINK)],
    ['en', emailTemplates.en.magicLink.body(LINK)]
  ])(
    'states the 15-minute expiry in %s, which is the token lifetime the handler writes',
    (_locale, body) => {
      // server/api/magic-link/handlers/request.ts writes expiresAt = now + 15 minutes, so the copy and
      // the stored lifetime have to agree. A message promising a different number would send a user
      // back to a dead link.
      expect(body).toContain('15 minutes')
    }
  )

  it.each([
    ['fr', emailTemplates.fr.magicLink.body(LINK)],
    ['en', emailTemplates.en.magicLink.body(LINK)]
  ])('tells the recipient how to recover from an expired link in %s', (_locale, body) => {
    // The interrupted path. A magic link is a one-shot token with a 15-minute life, so the message
    // that carries it is the only place a recovery instruction can reach the invitee, and the
    // recovery is to request another one from the signup form.
    const text = visibleText(body)
    expect(text).toMatch(/expire/i)
    expect(text).toMatch(/formulaire|form/i)
  })

  it('is French-first and English-second as two separate localized messages', () => {
    // Unlike the invitation, the magic link is sent to somebody whose locale the signup form knows,
    // so it is one language per message rather than a bilingual body.
    expect(emailTemplates.fr.magicLink.body(LINK)).not.toContain('Click the link')
    expect(emailTemplates.en.magicLink.body(LINK)).not.toContain('Cliquez sur le lien')
  })

  it('offers exactly one call to action in each locale', () => {
    expect(emailTemplates.fr.magicLink.body(LINK).match(/<a /g)).toHaveLength(1)
    expect(emailTemplates.en.magicLink.body(LINK).match(/<a /g)).toHaveLength(1)
  })

  it('respects the French space-before-punctuation rule in its visible prose', () => {
    expect(findPunctuationViolations(visibleText(emailTemplates.fr.magicLink.body(LINK)))).toEqual(
      []
    )
    expect(findPunctuationViolations(emailTemplates.fr.magicLink.subject)).toEqual([])
  })
})

describe('the deactivation notice', () => {
  it.each([
    ['fr', emailTemplates.fr.accountDeactivated.body(CONTACT)],
    ['en', emailTemplates.en.accountDeactivated.body(CONTACT)]
  ])('gives the %s recipient a mailto contact route', (_locale, body) => {
    // manage-users.md line 161: the message "states the account is deactivated and to contact the
    // admin". Without a reachable address the notice is a dead end, and the recipient can no longer
    // sign in to ask.
    expect(body).toContain(`<a href="mailto:${CONTACT}">`)
    expect(visibleText(body)).toContain(CONTACT)
  })

  it('takes the contact address as a parameter rather than hardcoding it', () => {
    // The module header says so: "The contact address is passed in from runtimeConfig so it lives in
    // config, not here." A second address proves it is interpolated rather than fixed.
    const other = 'support@example.org'

    expect(emailTemplates.fr.accountDeactivated.body(other)).toContain(other)
    expect(emailTemplates.fr.accountDeactivated.body(other)).not.toContain(CONTACT)
  })

  it.each([
    ['fr', emailTemplates.fr.accountDeactivated.body(CONTACT), /désactivé/],
    ['en', emailTemplates.en.accountDeactivated.body(CONTACT), /deactivated/]
  ])('states in %s that the account is deactivated', (_locale, body, pattern) => {
    expect(body).toMatch(pattern)
  })

  it.each([
    ['fr', emailTemplates.fr.accountDeactivated.body(CONTACT), /plus accès/],
    ['en', emailTemplates.en.accountDeactivated.body(CONTACT), /no longer have access/]
  ])('states in %s that access is gone, not merely suspended', (_locale, body, pattern) => {
    expect(body).toMatch(pattern)
  })

  it('opens with a greeting in both locales', () => {
    expect(emailTemplates.fr.accountDeactivated.body(CONTACT)).toContain('Bonjour,')
    expect(emailTemplates.en.accountDeactivated.body(CONTACT)).toContain('Hello,')
  })

  it('respects the French space-before-punctuation rule in its visible prose', () => {
    expect(
      findPunctuationViolations(visibleText(emailTemplates.fr.accountDeactivated.body(CONTACT)))
    ).toEqual([])
    expect(findPunctuationViolations(emailTemplates.fr.accountDeactivated.subject)).toEqual([])
  })

  it('does not mix the two locales into one message, unlike the invitation', () => {
    expect(emailTemplates.fr.accountDeactivated.body(CONTACT)).not.toContain('Hello,')
    expect(emailTemplates.en.accountDeactivated.body(CONTACT)).not.toContain('Bonjour,')
  })
})

describe('the invitation is one bilingual message, French first', () => {
  const body = emailTemplates.invite.body(LINK)

  it('carries both languages in one body', () => {
    // manage-users.md line 91: an invited person has no persisted locale yet, so there is no locale
    // to select a template by.
    expect(body).toContain('Bonjour,')
    expect(body).toContain('Hello,')
  })

  it('puts the French before the English', () => {
    // AGENTS.md, French first and English second, and manage-users.md line 96 ties the ordering to
    // the Law 101 French obligation that the French version be at least as prominent.
    expect(body.indexOf('Bonjour,')).toBeLessThan(body.indexOf('Hello,'))
    expect(body.indexOf('Créer mon compte')).toBeLessThan(body.indexOf('Create my account'))
  })

  it('separates the two languages with a rule so a reader sees where French ends', () => {
    expect(body).toContain('<hr />')
    expect(body.indexOf('<hr />')).toBeGreaterThan(body.indexOf('Bonjour,'))
    expect(body.indexOf('<hr />')).toBeLessThan(body.indexOf('Hello,'))
  })

  it('points both call-to-action links at the same single destination', () => {
    // manage-users.md line 91 asks for "one call-to-action link". The message renders it once per
    // language, which is what a bilingual body has to do, and both must be the same URL so there is
    // only one destination to reason about.
    const hrefs = [...body.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1])

    expect(hrefs).toEqual([LINK, LINK])
  })

  it('is bilingual in its subject as well', () => {
    expect(emailTemplates.invite.subject).toContain('Invitation à créer votre compte')
    expect(emailTemplates.invite.subject).toContain('Invitation to create your')
    expect(emailTemplates.invite.subject.indexOf('Invitation à')).toBeLessThan(
      emailTemplates.invite.subject.indexOf('Invitation to')
    )
  })

  it('tells an unexpected recipient they can ignore it, in both languages', () => {
    // The abandoned path for an invitation sent to the wrong address. The allowlist gate still
    // stands behind the link, so ignoring it is genuinely safe advice.
    expect(body).toContain("Si vous n'attendiez pas cette invitation")
    expect(body).toContain('If you were not expecting this invitation')
  })

  it('interpolates the signup URL verbatim in both halves', () => {
    const url = 'https://time-tracker.agilbert.dev/inscription'

    expect(
      emailTemplates.invite.body(url).match(new RegExp(url.replace(/\W/g, '\\$&'), 'g'))
    ).toHaveLength(2)
  })

  it('respects the French space-before-punctuation rule in its French half', () => {
    const french = visibleText(body).split('Hello,')[0]!

    expect(findPunctuationViolations(french)).toEqual([])
  })

  it('respects the rule in its subject, where the two languages meet at a pipe', () => {
    expect(findPunctuationViolations(emailTemplates.invite.subject)).toEqual([])
  })
})

describe('the shape of the module, so a caller can select a template by locale', () => {
  it('offers the same two message kinds in both locales', () => {
    // request.ts and the deactivation handler both index this object by a locale string, so a key
    // present in one locale and missing from the other is an undefined template at send time.
    expect(Object.keys(emailTemplates.fr).sort()).toEqual(Object.keys(emailTemplates.en).sort())
  })

  it.each(['fr', 'en'] as const)(
    'gives every %s template a subject and a body function',
    (locale) => {
      for (const template of Object.values(emailTemplates[locale])) {
        expect(typeof template.subject).toBe('string')
        expect(typeof template.body).toBe('function')
      }
    }
  )

  it('keeps the invitation outside the locale map, because it belongs to no single locale', () => {
    expect(emailTemplates).not.toHaveProperty('fr.invite')
    expect(emailTemplates).not.toHaveProperty('en.invite')
    expect(typeof emailTemplates.invite.body).toBe('function')
  })

  it('produces a body that is non-empty for every template', () => {
    const bodies = [
      emailTemplates.fr.magicLink.body(LINK),
      emailTemplates.en.magicLink.body(LINK),
      emailTemplates.fr.accountDeactivated.body(CONTACT),
      emailTemplates.en.accountDeactivated.body(CONTACT),
      emailTemplates.invite.body(LINK)
    ]

    for (const body of bodies) {
      expect(body.trim().length).toBeGreaterThan(0)
      expect(body).toContain('<p>')
    }
  })
})
