import enMessages from '~~/i18n/locales/en.json'
import frMessages from '~~/i18n/locales/fr.json'
import { describe, expect, it } from 'vitest'

// One guard over the shipped locale files, holding three rules, checked against the real copy rather
// than against invented cases.
//
// Rule one is punctuation. AGENTS.md makes it a product non-negotiable that French uses a space
// before `? ! : ;`, and the inline task editor spec restates it as AC57, which asks for a real U+00A0
// in the JSON rather than a plain space.
//
// Rule two is a quantity and its unit, so `24 h` and `5 Mo` cannot break across a line. The owner
// ruled on this and the answer was yes, so it is guarded here with no baseline and no exception list.
// The three instances that existed when the rule was written were corrected rather than excused.
//
// Rule three is key parity between the two files. Every key in one locale exists in the other, in
// both directions, because the two failures are different. A key in `fr` and missing from `en`
// renders a raw dotted key on screen to an English reader, and the reverse does the same to a French
// one, and each is invisible to anyone testing in the other language.
//
// Rule three is here because this branch alone edited keys by hand in two files three times over. It
// removed `categoryRequired` and `categoryPlaceholder` and renamed `statusNotTrackable` to
// `statusNotDeliverable`, and every one of those was a manual edit in two places where forgetting the
// second file ships a missing translation. The conventions already require a contract change and its
// i18n to land in one step, and this makes that rule enforceable rather than remembered.
//
// Until this file existed none of the three rules had anything protecting them. All were verified
// only by throwaway scripts that no longer exist, and every one of those runs found live problems,
// which is the argument for a committed guard instead of another script.
//
// Why the guard carries its own positive controls, in the committed test rather than beside it. A
// plain space and a no-break space are visually identical in an editor, in a terminal, and in a
// pull-request diff. That is not hypothetical. It is exactly how a plain space survived inside
// `planning.editor.validation.timeInvalid` through a spec review, a design stage, an implementation
// stage, and one earlier punctuation pass, and how two more survived in the avatar copy. A guard for
// an invisible property that cannot demonstrate it detects the property is decoration, so both
// detectors are exercised below against strings that are deliberately wrong and strings that are
// deliberately right. If a detector ever stops working, those tests fail before the copy tests can
// pass over the real files for the wrong reason.
//
// Why a colon glued to a letter or a digit is exempt. `HH:MM` in the time-format message is a
// technical token, and so are a clock time, a ratio, and a URL scheme. French prose always puts some
// whitespace before a colon, so a colon with an alphanumeric character hard against it is structural
// and takes no space at all. A guard that flagged `HH:MM` would be wrong rather than strict, and a
// guard that produces false positives is one the next person suppresses or deletes. The exemption is
// resolved from the shape of the string, so it is not a list of blessed keys that has to be
// maintained, and a new technical token is exempt automatically while new prose is not.
//
// ---------------------------------------------------------------------------------------------------
// WHAT COUNTS AS A UNIT, and the limit of rule two.
//
// The boundary is drawn from the shape of the token rather than from a list of unit names, for the
// same reason the colon exemption is. A list needs maintaining and goes stale, and the next person to
// add a unit will not find it.
//
// A token counts as a unit when it is a single ASCII letter, as in `h`, or an uppercase ASCII letter
// followed by lowercase ASCII letters, as in `Mo`, or one of the bare symbols `%`, `$`, and `°`.
// Everything else after a numeral is treated as prose and left alone.
//
// NAMED LIMIT, deliberately narrow. A lowercase unit symbol of two or more letters is NOT covered, so
// `min`, `km`, `kg`, and `ml` would pass unnoticed. In shape those are indistinguishable from
// ordinary short French words, and this copy really does contain `en`, `mot`, and `sur` sitting
// directly after a numeral, every one of them prose. `{value} en trop` is the clearest case. A rule
// wide enough to catch `min` would flag it, and a rule that fires on ordinary prose is one the next
// person suppresses, which would cost both rules rather than just the missing half.
//
// So the limit is accepted knowingly. If a lowercase multi-letter unit ever enters the copy it needs
// either a wider rule with a way to tell `km` from `en`, or that one string handled on its own. It
// does not need this guard loosened until it fires on prose.
// ---------------------------------------------------------------------------------------------------

// The one correct character in both rules. AC57 names U+00A0 specifically, so the visually similar
// narrow no-break space U+202F is not accepted. Mixing the two in hand-authored JSON is one of the
// things this guard exists to prevent, and the distinction matters because nothing on screen reveals
// which one a string holds.
//
// Written as an escape rather than as the character itself, on purpose. A guard whose own source
// depends on an invisible byte is fragile in exactly the way it exists to prevent.
const NO_BREAK_SPACE = '\u00A0'

// The punctuation French sets off with a space. These two-part marks are the whole set, so nothing
// here covers a comma or a full stop, which take no preceding space in French any more than in
// English.
const SPACED_PUNCTUATION = new Set(['!', ':', ';', '?'])

// A numeral, or a closing brace so an interpolated `{max}` counts as the quantity it will hold at
// runtime, then one whitespace character, then the token that follows it.
const QUANTITY_PATTERN = /([\d}])(\s)([\p{L}%$°]+)/gu

type Finding = {
  // The character actually found, named as a code point. A failure message printing two
  // identical-looking spaces would tell nobody anything.
  found: string
  rule: 'punctuation' | 'unit'
  // The mark or the unit symbol the space belongs in front of.
  subject: string
}

// Labels a character as its code point, which is the only readable way to report on a property that
// is invisible by nature.
function codePoint(character: string): string {
  if (character === '') return 'start of string'
  return `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
}

// Reports whether a colon at this index is part of a technical token rather than prose. The test is
// the character hard against its left, because French prose never writes a colon with a letter or a
// digit touching it, while `HH:MM`, `14:30`, `3:1`, and `https://` all do.
function isTechnicalColon(value: string, index: number): boolean {
  const previous = value[index - 1]
  if (previous === undefined) return false
  return /[\p{L}\p{N}]/u.test(previous)
}

// Reports whether a token following a numeral is a unit symbol rather than a prose word. The shapes
// and the reason for the narrow lowercase limit are in the header block.
export function isUnitSymbol(token: string): boolean {
  if (/^[%$°]$/u.test(token)) return true
  if (/^[A-Za-z]$/u.test(token)) return true
  return /^[A-Z][a-z]+$/u.test(token)
}

// Rule one. Every place a French string sets off `? ! : ;` with the wrong character. Pure, so the
// tests can drive it with strings whose correctness is known before it is ever pointed at a real
// locale file.
export function findPunctuationViolations(value: string): Finding[] {
  const findings: Finding[] = []

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (!SPACED_PUNCTUATION.has(character)) continue
    if (character === ':' && isTechnicalColon(value, index)) continue

    const previous = index > 0 ? value[index - 1]! : ''
    if (previous === NO_BREAK_SPACE) continue

    findings.push({ found: codePoint(previous), rule: 'punctuation', subject: character })
  }

  return findings
}

// Rule two. Every place a French string separates a quantity from its unit with the wrong character.
export function findUnitViolations(value: string): Finding[] {
  const findings: Finding[] = []

  for (const match of value.matchAll(QUANTITY_PATTERN)) {
    const separator = match[2]!
    const token = match[3]!

    if (!isUnitSymbol(token)) continue
    if (separator === NO_BREAK_SPACE) continue

    findings.push({ found: codePoint(separator), rule: 'unit', subject: token })
  }

  return findings
}

// Both rules over one string, which is what the technical-token tests use.
export function findSpacingViolations(value: string): Finding[] {
  return [...findPunctuationViolations(value), ...findUnitViolations(value)]
}

// Counts the occurrences already correct under each rule, which is what stops a clean run from being
// a vacuous one. A traversal that silently yielded nothing would report zero violations and look
// identical to a passing suite.
function countCorrect(value: string): { punctuation: number; unit: number } {
  let punctuation = 0
  let unit = 0

  for (let index = 1; index < value.length; index += 1) {
    if (!SPACED_PUNCTUATION.has(value[index]!)) continue
    if (value[index - 1] === NO_BREAK_SPACE) punctuation += 1
  }

  for (const match of value.matchAll(QUANTITY_PATTERN)) {
    if (isUnitSymbol(match[3]!) && match[2] === NO_BREAK_SPACE) unit += 1
  }

  return { punctuation, unit }
}

type ParityGap = {
  key: string
  // The locale the key is absent from, which is the half a reader of that language loses. Reporting
  // the direction rather than only the key is the same reasoning as reporting a code point rather
  // than a character, because "the counts differ by one" tells nobody which file to open.
  missingFrom: 'en' | 'fr'
}

// Rule three. Every key missing from either side, in both directions. Pure and taking both maps as
// arguments rather than reading the module-level ones, which is what lets the tests drive it with
// deliberately unbalanced pairs.
export function findParityGaps(
  french: Map<string, string>,
  english: Map<string, string>
): ParityGap[] {
  const gaps: ParityGap[] = []

  for (const key of french.keys()) {
    if (!english.has(key)) gaps.push({ key, missingFrom: 'en' })
  }

  for (const key of english.keys()) {
    if (!french.has(key)) gaps.push({ key, missingFrom: 'fr' })
  }

  return gaps
}

// Flattens a locale file to key-and-string pairs, following arrays as well as objects so the month
// name lists are covered rather than skipped.
//
// Segments are joined with a dot, so two different shapes can flatten to one path: `{"a.b": {"c":
// …}}` and `{"a": {"b.c": …}}` both produce `a.b.c`. A plain overwrite would drop the first string,
// and a dropped string is never punctuation-checked and never parity-compared, so the loss would be
// silent and this whole suite would report clean on copy it never read. Colliding on a key is
// therefore a hard failure rather than a last-write-wins. No key in either locale file contains a
// literal dot today, so this guards the flattener against a future one rather than fixing a live
// miss.
function flattenStrings(source: unknown, prefix = '', out = new Map<string, string>()) {
  if (typeof source === 'string') {
    if (out.has(prefix)) {
      throw new Error(
        `Duplicate flattened locale key "${prefix}". A literal dot in a key has collided with a ` +
          `nested path, so one of the two strings would be dropped and never checked.`
      )
    }
    out.set(prefix, source)
    return out
  }

  if (Array.isArray(source)) {
    source.forEach((item, index) => flattenStrings(item, `${prefix}[${index}]`, out))
    return out
  }

  if (source !== null && typeof source === 'object') {
    for (const [key, value] of Object.entries(source)) {
      flattenStrings(value, prefix ? `${prefix}.${key}` : key, out)
    }
  }

  return out
}

const FRENCH_STRINGS = flattenStrings(frMessages)
const ENGLISH_STRINGS = flattenStrings(enMessages)

describe('rule one detects an invisible property before punctuation', () => {
  // Positive controls. Every one uses a synthetic string whose correctness is decided here rather
  // than read from the repository, so a detector that stopped detecting anything fails these before
  // it can report the real copy as clean.

  it.each([...SPACED_PUNCTUATION])('flags a plain space before %s', (punctuation) => {
    const findings = findPunctuationViolations(`Une phrase ${punctuation}`)

    expect(findings).toHaveLength(1)
    expect(findings[0]).toEqual({ found: 'U+0020', rule: 'punctuation', subject: punctuation })
  })

  it.each([...SPACED_PUNCTUATION])('accepts a no-break space before %s', (punctuation) => {
    expect(findPunctuationViolations(`Une phrase${NO_BREAK_SPACE}${punctuation}`)).toEqual([])
  })

  it.each([...SPACED_PUNCTUATION])('flags %s with no space at all in prose', (punctuation) => {
    // A colon is exempt when a letter touches it, so this case uses a comma to put a
    // non-alphanumeric character on the left and keep every mark under the same rule.
    const findings = findPunctuationViolations(`Une phrase,${punctuation}`)

    expect(findings).toHaveLength(1)
    expect(findings[0]?.found).toBe('U+002C')
  })

  it('rejects the narrow no-break space, because AC57 names U+00A0', () => {
    const findings = findPunctuationViolations('Une phrase\u202F?')

    expect(findings).toHaveLength(1)
    expect(findings[0]?.found).toBe('U+202F')
  })

  it('reports the offending code point so a failure says which space it found', () => {
    // The whole point of naming the code point. These two strings render identically everywhere a
    // person would look at them, and only one is correct.
    const wrong = findPunctuationViolations('Abandonner les modifications ?')
    const right = findPunctuationViolations(`Abandonner les modifications${NO_BREAK_SPACE}?`)

    expect(wrong).toEqual([{ found: 'U+0020', rule: 'punctuation', subject: '?' }])
    expect(right).toEqual([])
  })

  it('finds every violation in a string rather than stopping at the first', () => {
    expect(findPunctuationViolations('Vraiment ? Oui ! Bon ;')).toHaveLength(3)
  })

  it('flags punctuation opening a string, which has nothing before it to be a space', () => {
    expect(findPunctuationViolations('? une phrase')).toEqual([
      { found: 'start of string', rule: 'punctuation', subject: '?' }
    ])
  })
})

describe('a colon inside a technical token is exempt rather than flagged', () => {
  // A guard that produced false positives here would be wrong rather than strict, and would be
  // suppressed by whoever hit it next.

  it.each([
    ['a time format placeholder', 'Entrez une heure au format 24\u00A0h (HH:MM).'],
    ['a clock time', 'La livraison est à 14:30.'],
    ['a ratio', 'Un rapport de 3:1.'],
    ['a URL scheme', 'Visitez https://exemple.com pour continuer.']
  ])('exempts %s', (_label, value) => {
    expect(findSpacingViolations(value)).toEqual([])
  })

  it('still flags a prose colon in a string that also holds a technical one', () => {
    // The exemption is resolved per occurrence, so one technical colon does not excuse the rest of
    // the string.
    const findings = findPunctuationViolations('Format : 24\u00A0h (HH:MM).')

    expect(findings).toEqual([{ found: 'U+0020', rule: 'punctuation', subject: ':' }])
  })
})

describe('rule two tells a unit symbol from a prose word by its shape', () => {
  it.each(['h', 's', 'm', 'Mo', 'Ko', 'Go', 'Wh', '%', '$', '°'])(
    'treats %s as a unit',
    (token) => {
      expect(isUnitSymbol(token)).toBe(true)
    }
  )

  it.each(['en', 'mot', 'sur', 'tâche', 'caractères', 'utilisateurs', 'min', 'km'])(
    'treats %s as prose rather than a unit',
    (token) => {
      expect(isUnitSymbol(token)).toBe(false)
    }
  )

  it('flags a plain space between a quantity and its unit', () => {
    const findings = findUnitViolations('Taille maximale de 5 Mo.')

    expect(findings).toEqual([{ found: 'U+0020', rule: 'unit', subject: 'Mo' }])
  })

  it('accepts a no-break space between a quantity and its unit', () => {
    expect(findUnitViolations(`Taille maximale de 5${NO_BREAK_SPACE}Mo.`)).toEqual([])
  })

  it('rejects the narrow no-break space before a unit as well', () => {
    expect(findUnitViolations('Format 24\u202Fh')).toEqual([
      { found: 'U+202F', rule: 'unit', subject: 'h' }
    ])
  })

  it('reads an interpolated placeholder as the quantity it will hold', () => {
    // `{max} Mo` is a real quantity at runtime, so the rule applies to it exactly as to a literal.
    expect(findUnitViolations('Taille maximale de {max} Mo.')).toEqual([
      { found: 'U+0020', rule: 'unit', subject: 'Mo' }
    ])
  })

  it('leaves ordinary prose after a numeral alone', () => {
    // The strings this copy actually contains. A rule wide enough to catch `min` would flag every one
    // of these, which is the false-positive trade the header block records.
    expect(findUnitViolations('Au moins 8 caractères.')).toEqual([])
    expect(findUnitViolations('{value} en trop')).toEqual([])
    expect(findUnitViolations("Le quota doit être d'au moins 1 mot à l'heure.")).toEqual([])
    expect(findUnitViolations('Étape {current} sur {total}')).toEqual([])
  })
})

describe('the shipped French copy obeys both rules', () => {
  it('puts a no-break space before every ? ! : ; that is not a technical token', () => {
    const violations: string[] = []

    for (const [key, value] of FRENCH_STRINGS) {
      for (const finding of findPunctuationViolations(value)) {
        violations.push(
          `${key} has "${finding.subject}" preceded by ${finding.found}, expected U+00A0 -> ${JSON.stringify(value)}`
        )
      }
    }

    expect(violations).toEqual([])
  })

  it('puts a no-break space between every quantity and its unit', () => {
    const violations: string[] = []

    for (const [key, value] of FRENCH_STRINGS) {
      for (const finding of findUnitViolations(value)) {
        violations.push(
          `${key} separates the quantity from "${finding.subject}" with ${finding.found}, expected U+00A0 -> ${JSON.stringify(value)}`
        )
      }
    }

    expect(violations).toEqual([])
  })

  it('examines a substantial body of copy, so a clean run is not an empty one', () => {
    // Anti-vacuity. A broken traversal would report no violations and be indistinguishable from a
    // passing suite, so the guard asserts it actually had something to look at.
    expect(FRENCH_STRINGS.size).toBeGreaterThan(100)
  })

  it('verifies real no-break spaces under both rules rather than passing over none', () => {
    // The second half of the anti-vacuity check, and it covers both rules. Either rule holding
    // trivially because no French string exercises it would be a different claim from the rule being
    // obeyed.
    const totals = [...FRENCH_STRINGS.values()].reduce(
      (running, value) => {
        const counts = countCorrect(value)
        return {
          punctuation: running.punctuation + counts.punctuation,
          unit: running.unit + counts.unit
        }
      },
      { punctuation: 0, unit: 0 }
    )

    expect(totals.punctuation).toBeGreaterThan(0)
    expect(totals.unit).toBeGreaterThan(0)
  })
})

describe('rule three detects a key present in one locale and missing from the other', () => {
  // Positive controls, driven with synthetic pairs whose balance is decided here rather than read
  // from the repository. A comparison that stopped comparing would fail these before it could report
  // the real files as balanced.

  const pair = (french: string[], english: string[]) =>
    [
      new Map(french.map((key) => [key, 'valeur'])),
      new Map(english.map((key) => [key, 'value']))
    ] as const

  it('flags a key present in French and missing from English', () => {
    const [fr, en] = pair(['a.one', 'a.two'], ['a.one'])

    expect(findParityGaps(fr, en)).toEqual([{ key: 'a.two', missingFrom: 'en' }])
  })

  it('flags a key present in English and missing from French', () => {
    // The reverse direction is a different failure and is asserted separately, because a guard
    // written in one direction only passes happily while an English-only key ships a raw key to a
    // French reader.
    const [fr, en] = pair(['a.one'], ['a.one', 'a.two'])

    expect(findParityGaps(fr, en)).toEqual([{ key: 'a.two', missingFrom: 'fr' }])
  })

  it('flags gaps in both directions at once', () => {
    const [fr, en] = pair(['shared', 'french.only'], ['shared', 'english.only'])

    expect(findParityGaps(fr, en)).toEqual([
      { key: 'french.only', missingFrom: 'en' },
      { key: 'english.only', missingFrom: 'fr' }
    ])
  })

  it('accepts a balanced pair', () => {
    const [fr, en] = pair(['a.one', 'a.two'], ['a.two', 'a.one'])

    // Order does not matter, only membership, since a locale file is a map rather than a sequence.
    expect(findParityGaps(fr, en)).toEqual([])
  })

  it('is not fooled by equal key counts that name different keys', () => {
    // The failure a count comparison misses entirely. Both sides hold two keys, so the totals agree
    // and the files are still broken in both languages.
    const [fr, en] = pair(['a.one', 'a.two'], ['a.one', 'a.three'])

    expect(findParityGaps(fr, en)).toEqual([
      { key: 'a.two', missingFrom: 'en' },
      { key: 'a.three', missingFrom: 'fr' }
    ])
  })
})

describe('the shipped locale files are at key parity', () => {
  it('has every key in both files, in both directions', () => {
    const gaps = findParityGaps(FRENCH_STRINGS, ENGLISH_STRINGS).map(
      (gap) => `${gap.key} is missing from ${gap.missingFrom}.json`
    )

    expect(gaps).toEqual([])
  })

  it('compares two non-empty key sets, so a clean run is not an empty one', () => {
    // Anti-vacuity for rule three. Parity over two empty maps passes trivially, and an empty English
    // map would otherwise be caught only as several hundred gaps rather than as a broken traversal.
    // Both sides are asserted, because the rule is symmetric and so is the way it can go vacuous.
    expect(FRENCH_STRINGS.size).toBeGreaterThan(100)
    expect(ENGLISH_STRINGS.size).toBeGreaterThan(100)
  })
})

describe('the French punctuation rule does not leak into English', () => {
  it('leaves English punctuation with no no-break space before it', () => {
    // English sets off none of these marks with a space, so a U+00A0 appearing before one in en.json
    // is the French rule applied to the wrong file rather than a deliberate choice.
    //
    // Only the punctuation rule is asserted here. English number-plus-unit spacing is genuinely
    // defensible, so `5 MB` with a plain space is left alone rather than either required or
    // forbidden, and the owner's ruling covered the French copy only.
    const leaks: string[] = []

    for (const [key, value] of ENGLISH_STRINGS) {
      if (countCorrect(value).punctuation > 0) leaks.push(`${key} -> ${JSON.stringify(value)}`)
    }

    expect(leaks).toEqual([])
  })
})
