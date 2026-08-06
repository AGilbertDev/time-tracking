// Canonical task category ids shared by the client and the server. Nuxt 4 auto-imports
// everything under shared/ into both the app and the Nitro server, so this is the one place
// the category ids, their two flags, and their colour are declared and both sides validate
// against the same list.
//
// A category answers two separate load-bearing questions about a task, and they are two declared
// flags rather than one because they are genuinely two questions.
//
// `trackable` answers whether the row's words count toward the quota. A trackable category produces
// billable words that reach the quota numerator, and a non-trackable one consumes scheduled time
// without producing any.
//
// `deliverable` answers whether the row is a piece of work that can be in progress, and therefore
// whether it has a meaningful status and a meaningful word count. A break, a meeting,
// administration, desktop publishing, and terminology work are consumed time with no deliverable,
// so a status on one would contradict everything else the app reports about it and a word count on
// one means nothing.
//
// For the first nine categories those two answers always agreed, which is why a single flag served
// both for as long as it did and why nobody had to notice it was doing two jobs. `other` is the
// member that pulls them apart. It is other work of a kind the user did not name, so it can be in
// progress and it can carry words, and it must still never move a quota figure.
//
// So anything deciding whether to show N/A, whether to disable the status field, or whether to
// print a word count reads `deliverable`. Anything feeding a quota numerator or denominator reads
// `trackable`. Neither flag is a synonym for the other, neither is derived from the other, and an id
// comparison against 'other' is not an acceptable substitute for either, because PLAN-30's
// user-created categories would inherit that special case instead of declaring their own answer.
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

// The ten default category ids, in the locked contract order from the planning overview. These
// are plain lowercase English storage keys, snake_case when the name runs to more than one word,
// and never shown to the user. The display names live in the i18n layer keyed by id
// (categories.<id>), so a label can be renamed with a locale-file edit that never touches stored
// data or this union.
//
// `other` is tenth and last, which is where a catch-all belongs in a list of specific kinds of work,
// and adding it at the end means none of the original nine changed index for anything that reads
// this tuple by position. Its id is 'other' because its name is Autre, and that order matters. The
// id followed the copy rather than the copy following the id, so the stored value, the visible name,
// and the spec's file name all say the same thing. An id asserting the row has no category, sitting
// under a name saying the row is other work, is how a later reader concludes the two are different
// things and writes code for a distinction that does not exist.
export const DEFAULT_CATEGORY_IDS = [
  'translation',
  'revision_internal',
  'revision_external',
  'proofreading',
  'terminology',
  'meetings',
  'breaks',
  'admin',
  'dtp',
  'other'
] as const

export type DefaultCategoryId = (typeof DEFAULT_CATEGORY_IDS)[number]

// The broader id type. It permits a user-created id string while keeping editor autocomplete on
// the ten defaults. This is the extensibility seam for PLAN-30, which will layer custom
// categories on top. PLAN-32a ships and validates only the frozen defaults.
export type CategoryId = DefaultCategoryId | (string & {})

// A category descriptor. It carries the id, the two flags, and the hue its name is printed at, and
// deliberately no display name, because per project convention all visible strings live in i18n,
// resolved from the id through the categories.<id> key convention. Every category has a hue, so
// there is no null case. The user's original app coloured every kind of work and PLAN-32c
// restores that, which is what reversed AC18 of extend-tasks.md and retired edgeSlot.
export type Category = {
  id: CategoryId
  // Do the row's words count toward the quota. Read this for anything statistical.
  trackable: boolean
  // Is the row a piece of work that can be in progress, so does it have a meaningful status and a
  // meaningful word count. Read this for the status field, for the N/A reading, and for the words
  // cell. It is not a synonym for `trackable` and the two differ for exactly one member today, which
  // is why the file header explains both at length rather than here. Every descriptor declares it
  // explicitly, including a PLAN-30 custom category, because a default would silently guess.
  deliverable: boolean
  hue: number
}

// The ten defaults with their locked flags and their designed hues, in the same order as
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
// The four trackable ids are deliverables, so they are `deliverable` too, and the five consumed-time
// ids are neither. `other` is the only member where the two flags disagree, and the reasoning for
// that is in the file header rather than repeated on the line.
//
// hue 90 on `other` is measured rather than picked. It is the maximum of the minimum Oklab chord
// from a candidate hue to the existing nine, so it is the best placement left on the whole wheel,
// and its neighbours `dtp` at 60 and `revision_external` at 115 both sit at about 0.05 from it. That
// is roughly the spacing of the deliberate revision sibling pair, so the palette is now full and an
// eleventh hue cannot be added by eye. The tighter spacing is accepted on this member specifically
// because Autre is the shortest label of the ten and shares no prefix with any other, so the word
// resolves the row on its own and the colour is doing almost no scanning work, unlike the two
// revision labels that differ only in their last word.
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'translation', trackable: true, deliverable: true, hue: 195 },
  { id: 'revision_internal', trackable: true, deliverable: true, hue: 140 },
  { id: 'revision_external', trackable: true, deliverable: true, hue: 115 },
  { id: 'proofreading', trackable: true, deliverable: true, hue: 230 },
  { id: 'terminology', trackable: false, deliverable: false, hue: 20 },
  { id: 'meetings', trackable: false, deliverable: false, hue: 340 },
  { id: 'breaks', trackable: false, deliverable: false, hue: 265 },
  { id: 'admin', trackable: false, deliverable: false, hue: 305 },
  { id: 'dtp', trackable: false, deliverable: false, hue: 60 },
  { id: 'other', trackable: false, deliverable: true, hue: 90 }
] as const

// A descriptor lookup keyed by id so both flags are read from one place rather than re-derived at
// each call site.
const CATEGORY_BY_ID: Record<DefaultCategoryId, Category> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((category) => [category.id, category])
) as Record<DefaultCategoryId, Category>

// The safe fallback id, and the value a task takes when nobody picks a category. One constant does
// both jobs deliberately rather than two that happen to agree, because they answer the same
// question, which is what a task's category is when nothing reliable says.
//
// It is non-trackable, and that part is unchanged from when this was admin. If an unknown or stale
// category were treated as trackable, its task's words would wrongly enter the quota numerator and
// pollute the headline number read at review time. A non-trackable fallback fails closed for the
// quota, contributing no words and correctly removing its duration from effective hours.
//
// It is `other` rather than `admin`, and this is the part worth reading, because admin was chosen
// once already and would be chosen again by anyone who does not know what it means. The owner's
// ruling of 2026-07-31, quoted so it survives that next reader:
//
//   "Admin is time tracking, email, etc"
//
// Administration is real work a translator books time against. Coercing an unknown or retired value
// into it makes the row assert something false about what the user did, and it quietly inflates a
// real category, so the one place in the app that exists to fail safely would instead be adding
// fictional administration hours. `other` asserts only what is actually known, which is that the
// kind of work is not recorded. Do not move this back to admin.
//
// Typed as DefaultCategoryId rather than the broader CategoryId, because the fallback is always one
// of the declared defaults. That is what lets the write boundary declare it as a Zod default without
// a cast.
export const DEFAULT_CATEGORY_ID: DefaultCategoryId = 'other'

// Narrows an arbitrary stored value to a known category id, falling back to the default when it
// is not one of DEFAULT_CATEGORY_IDS. The tasks.category column is free text at the database
// level, so a value left over from a renamed or retired category must resolve to a valid id
// rather than reach the UI raw, the same discipline coerceThemeId gives theme ids. Pure and
// DB-free so it is unit-testable. PLAN-30 will extend the validated set to a user's own
// categories. Coercion checks the declared defaults only, so revision, the id the earlier
// six-member set carried, is a stale value that folds to the default like any other. Since the
// default moved off admin, such a row now reads as Autre, which is true, rather than as
// Administration, which it never was.
export function coerceCategory(value: unknown): CategoryId {
  return (DEFAULT_CATEGORY_IDS as readonly string[]).includes(value as string)
    ? (value as CategoryId)
    : DEFAULT_CATEGORY_ID
}

// Reports whether a category's words count toward the quota. It coerces the id first, so an unknown
// id resolves to the non-trackable default and can never be reported as trackable, which is the
// fail-closed property the quota depends on. This is the single source of truth for the flag, and
// the quota engine and the task row UI both read it from here rather than hardcoding which
// categories are trackable.
//
// This is not the function to call when the question is about a status, an N/A reading, or a word
// count. That is isDeliverableCategory below, and the two were one function until `other` proved
// they are two questions.
export function isTrackableCategory(id: unknown): boolean {
  return CATEGORY_BY_ID[coerceCategory(id) as DefaultCategoryId].trackable
}

// Reports whether a category is a piece of work that can be in progress, so whether a status and a
// word count mean anything on it. It coerces the id first like its sibling, so an unknown id
// inherits `other`'s answer, which is true. That is the right fail direction for this flag even
// though it is the opposite of trackable's, because the risk here is hiding a status the user
// stored rather than inflating a number, and a legacy row holding a retired id with a real stored
// status should show it rather than read as N/A.
//
// Read this for the status control's disabled state, for statusKey's N/A guard, and for the words
// cell. Read isTrackableCategory for anything that reaches a quota. Overloading either one back
// into a single flag reintroduces exactly the defect this pair was split to fix.
export function isDeliverableCategory(id: unknown): boolean {
  return CATEGORY_BY_ID[coerceCategory(id) as DefaultCategoryId].deliverable
}

// The hue angle a category's name is printed at. It coerces the id first, so an unknown or stale
// value resolves to the default and borrows `other`'s colour rather than a real category's, and the
// function is total. Every input returns a number and nothing returns null, because every category
// now has a colour. This is the single source of truth for the mapping. The
// task row and, later, PLAN-11's category selector and PLAN-30's category form all read it from
// here, which is what makes the association between a colour and a kind of work learnable rather
// than two copies that can drift.
export function categoryHue(id: unknown): number {
  return CATEGORY_BY_ID[coerceCategory(id) as DefaultCategoryId].hue
}
