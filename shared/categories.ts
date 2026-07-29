// Canonical task category ids shared by the client and the server. Nuxt 4 auto-imports
// everything under shared/ into both the app and the Nitro server, so this is the one place
// the category ids, their trackable flag, and their colour are declared and both sides validate
// against the same list. A category answers one load-bearing question about a task. Does it produce
// billable words that count toward the quota, or does it consume scheduled time without producing
// any. That single fact is the trackable flag, and the quota engine and the task row UI both read
// it from here so the two can never disagree.
//
// A category also carries a colour, which is how the row says what kind of work it is without the
// user reading the word. The carrier is the printed category name, so the colour is one hue angle
// per category and nothing more. Lightness and chroma are fixed once per mode in main.css, which is
// why every category lands at the same visual weight and the same measured contrast, and why a new
// category needs a single integer rather than a hand-tuned ramp.
//
// The earlier hue ring is retired rather than resized. It existed so a category nobody designed
// would inherit a safe colour, and a measured guarantee over the whole circle does that better. At
// the fixed lightness and chroma every integer hue from 0 to 359 clears 4.5:1 on all twenty card
// surfaces, the worst reading anywhere being 5.02:1 in light and 6.07:1 in dark. So PLAN-30 can hand
// the user a full hue wheel and every choice they make passes by construction, which is stronger
// than a list of pre-approved slots. What PLAN-30 still owns is uniqueness, a product question about
// two categories looking alike rather than a contrast question.

// The nine default category ids, in the locked contract order from the planning overview. These
// are plain lowercase English storage keys, snake_case when the name runs to more than one word,
// and never shown to the user. The display names live in the i18n layer keyed by id
// (categories.<id>), so a label can be renamed with a locale-file edit that never touches stored
// data or this union.
export const DEFAULT_CATEGORY_IDS = [
  'translation',
  'revision_internal',
  'revision_external',
  'proofreading',
  'terminology',
  'meetings',
  'breaks',
  'admin',
  'dtp'
] as const

export type DefaultCategoryId = (typeof DEFAULT_CATEGORY_IDS)[number]

// The broader id type. It permits a user-created id string while keeping editor autocomplete on
// the nine defaults. This is the extensibility seam for PLAN-30, which will layer custom
// categories on top. PLAN-32a ships and validates only the frozen nine.
export type CategoryId = DefaultCategoryId | (string & {})

// A category descriptor. It carries the id, the trackable flag, and the hue its name is printed at,
// and deliberately no display name, because per project convention all visible strings live in i18n,
// resolved from the id through the categories.<id> key convention. Every category has a hue, so
// there is no null case: the user's original app coloured every kind of work and PLAN-32c
// restores that, which is what reversed AC18 of extend-tasks.md and retired edgeSlot.
export type Category = {
  id: CategoryId
  trackable: boolean
  hue: number
}

// The nine defaults with their locked trackable flags and their designed hues, in the same order as
// DEFAULT_CATEGORY_IDS. The hues are the user's own colours from the app they use today,
// kept verbatim wherever the user named one: cyan for translation, apple green for revision, wine red for
// terminology, pink for meetings, navy for breaks. revision_external is the derived sibling of
// revision_internal and sits 25 degrees off it, which is the closest pair in the palette by a ten
// degree margin, so proximity is what says the two are the same work on different people's text.
// admin and dtp are chosen, because the user named no colour for either. proofreading is a substitution
// rather than the user's colour. Their pale grey cannot both clear the 4.5:1 text floor and still read as a
// colour rather than as the row's own muted text, so it takes the centre of the palette's widest
// empty arc instead. That substitution is recorded in the design blueprint and is the user's to overrule.
//
// Only the hue lives here. The lightness and the chroma are fixed once per mode in main.css, so
// every category lands at the same lightness and therefore at the same measured contrast, and any
// hue a user picks in PLAN-30 inherits that contrast for free. The blueprint measures every hue from
// 0 to 359 at those fixed values against all twenty card surfaces; the worst reading is 5.02:1.
// A hue is deliberately not a semantic token. primary and secondary are redefined by all five
// themes and success, info, warning and error are reserved for status, so a category would either
// shift identity when the user changes atmosphere or read as a status.
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'translation', trackable: true, hue: 195 },
  { id: 'revision_internal', trackable: true, hue: 140 },
  { id: 'revision_external', trackable: true, hue: 115 },
  { id: 'proofreading', trackable: true, hue: 230 },
  { id: 'terminology', trackable: false, hue: 20 },
  { id: 'meetings', trackable: false, hue: 340 },
  { id: 'breaks', trackable: false, hue: 265 },
  { id: 'admin', trackable: false, hue: 305 },
  { id: 'dtp', trackable: false, hue: 60 }
] as const

// A descriptor lookup keyed by id so the trackable flag is read from one place rather than
// re-derived at each call site.
const CATEGORY_BY_ID: Record<DefaultCategoryId, Category> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((category) => [category.id, category])
) as Record<DefaultCategoryId, Category>

// The safe fallback id. It is admin on purpose, a non-trackable default. If an unknown or stale
// category were treated as trackable, its task's words would wrongly enter the quota numerator
// and pollute the headline number read at review time. A non-trackable fallback
// fails closed for the quota, contributing no words and correctly removing its duration from
// effective hours. admin is the natural catch-all bucket for uncategorized work, so a coerced
// task reads sensibly to the user as well as computing safely.
export const DEFAULT_CATEGORY_ID: CategoryId = 'admin'

// Narrows an arbitrary stored value to a known category id, falling back to the default when it
// is not one of DEFAULT_CATEGORY_IDS. The tasks.category column is free text at the database
// level, so a value left over from a renamed or retired category must resolve to a valid id
// rather than reach the UI raw, the same discipline coerceThemeId gives theme ids. Pure and
// DB-free so it is unit-testable. PLAN-30 will extend the validated set to a user's own
// categories. For PLAN-32a coercion checks the nine defaults only, so revision, the id the earlier
// six-member set carried, is now a stale value that folds to the default like any other.
export function coerceCategory(value: unknown): CategoryId {
  return (DEFAULT_CATEGORY_IDS as readonly string[]).includes(value as string)
    ? (value as CategoryId)
    : DEFAULT_CATEGORY_ID
}

// Reports whether a category id is trackable. It coerces the id first, so an unknown id resolves
// to the non-trackable default and can never be reported as trackable. This is the single source
// of truth for the flag. The quota engine and the task row UI both read it from here rather than
// hardcoding which categories are trackable.
export function isTrackableCategory(id: unknown): boolean {
  return CATEGORY_BY_ID[coerceCategory(id) as DefaultCategoryId].trackable
}

// The hue angle a category's name is printed at. It coerces the id first, so an unknown or stale
// value resolves to the non-trackable admin default and borrows admin's colour rather than another
// category's, and the function is total: every input returns a number and nothing returns null,
// because every category now has a colour. This is the single source of truth for the mapping. The
// task row and, later, PLAN-11's category selector and PLAN-30's category form all read it from
// here, which is what makes the association between a colour and a kind of work learnable rather
// than two copies that can drift.
export function categoryHue(id: unknown): number {
  return CATEGORY_BY_ID[coerceCategory(id) as DefaultCategoryId].hue
}
