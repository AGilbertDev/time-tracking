// Canonical task category ids shared by the client and the server. Nuxt 4 auto-imports
// everything under shared/ into both the app and the Nitro server, so this is the one place
// the category ids and their trackable flag are declared and both sides validate against the
// same list. A category answers one load-bearing question about a task. Does it produce billable
// words that count toward the quota, or does it consume scheduled time without producing any.
// That single fact is the trackable flag, and the quota engine and the task row UI both read
// it from here so the two can never disagree.

// The six default category ids, in the locked contract order from the planning overview. These
// are plain lowercase English words used as stable storage keys, never shown to the user. The
// display names live in the i18n layer keyed by id (categories.<id>), so a label can be renamed
// with a locale-file edit that never touches stored data or this union.
export const DEFAULT_CATEGORY_IDS = [
  'translation',
  'revision',
  'terminology',
  'meetings',
  'breaks',
  'admin'
] as const

export type DefaultCategoryId = (typeof DEFAULT_CATEGORY_IDS)[number]

// The broader id type. It permits a user-created id string while keeping editor autocomplete on
// the six defaults. This is the extensibility seam for PLAN-30, which will layer custom
// categories on top; PLAN-02 ships and validates only the frozen six.
export type CategoryId = DefaultCategoryId | (string & {})

// The category edge hue ring. A task row carries its category as a coloured left edge rather than
// as a printed word, and the whole colour contract is one hue angle per category: lightness and
// chroma are fixed once in main.css, so every category lands at the same visual weight and the
// same contrast in each mode and a new one needs a single integer rather than a hand-tuned ramp.
// Slot order is the assignment order, and the earliest slots sit furthest from the four reserved
// status hues (error ~27, warning ~78, success ~148, info ~258) so a category edge is never
// mistaken for a status. PLAN-30 assigns a user-created category the next unused slot, wrapping
// modulo the ring length, which is why this is a ring rather than a list sized to the six defaults.
export const CATEGORY_HUE_SLOTS = [195, 300, 115, 345, 240, 170, 275, 320] as const

// A category descriptor. It carries the id, the trackable flag, and the edge hue slot, and
// deliberately no display name, because per project convention all visible strings live in i18n,
// resolved from the id through the categories.<id> key convention. A null edgeSlot means neutral,
// which with an edge treatment means no edge is drawn at all.
export type Category = {
  id: CategoryId
  trackable: boolean
  edgeSlot: number | null
}

// The six defaults with their locked trackable flags, in the same order as DEFAULT_CATEGORY_IDS.
// translation and revision produce words and count toward the quota numerator. terminology,
// meetings, breaks, and admin produce no words and instead remove their duration from effective
// hours, so they are non-trackable.
//
// Only the two trackable categories take an edge hue. The distinction the colour exists to make is
// translation against revision, and a non-trackable row already prints its category as its own
// name, so a hue there would repeat a word the row already carries. Drawing no edge on those rows
// also leaves trackable work visually distinct from breaks and meetings at no extra cost.
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'translation', trackable: true, edgeSlot: 0 },
  { id: 'revision', trackable: true, edgeSlot: 1 },
  { id: 'terminology', trackable: false, edgeSlot: null },
  { id: 'meetings', trackable: false, edgeSlot: null },
  { id: 'breaks', trackable: false, edgeSlot: null },
  { id: 'admin', trackable: false, edgeSlot: null }
] as const

// A descriptor lookup keyed by id so the trackable flag is read from one place rather than
// re-derived at each call site.
const CATEGORY_BY_ID: Record<DefaultCategoryId, Category> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((category) => [category.id, category])
) as Record<DefaultCategoryId, Category>

// The safe fallback id. It is admin on purpose, a non-trackable default. If an unknown or stale
// category were treated as trackable, its task's words would wrongly enter the quota numerator
// and pollute the headline number the employer reads at review time. A non-trackable fallback
// fails closed for the quota, contributing no words and correctly removing its duration from
// effective hours. admin is the natural catch-all bucket for uncategorized work, so a coerced
// task reads sensibly to the user as well as computing safely.
export const DEFAULT_CATEGORY_ID: CategoryId = 'admin'

// Narrows an arbitrary stored value to a known category id, falling back to the default when it
// is not one of DEFAULT_CATEGORY_IDS. The tasks.category column is free text at the database
// level, so a value left over from a renamed or retired category must resolve to a valid id
// rather than reach the UI raw, the same discipline coerceThemeId gives theme ids. Pure and
// DB-free so it is unit-testable. PLAN-30 will extend the validated set to a user's own
// categories; for PLAN-02 coercion checks the six defaults only.
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

// The hue angle a category's row edge is drawn at, or null when the category reads as neutral and
// no edge is drawn. It coerces the id first, so an unknown or stale value resolves to the
// non-trackable default and draws nothing rather than borrowing another category's colour. This is
// the single source of truth for the mapping: the task row and, later, PLAN-11's category selector
// both read it from here, which is what makes the association between a colour and a category
// learnable rather than two copies that can drift. A slot outside the ring resolves to null rather
// than undefined, so the function is total.
export function categoryEdgeHue(id: unknown): number | null {
  const slot = CATEGORY_BY_ID[coerceCategory(id) as DefaultCategoryId].edgeSlot
  if (slot === null) return null
  return CATEGORY_HUE_SLOTS[slot % CATEGORY_HUE_SLOTS.length] ?? null
}
