import { createClient } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'

import { allowedEmails, settings, tasks, users, workSchedule } from '../server/db/schema'
import { type DefaultCategoryId, isTrackableCategory } from '../shared/categories'
import {
  addDays,
  DEFAULT_SCHEDULE,
  getWeekDays,
  TASK_STATUSES,
  todayInZone
} from '../shared/planning'

// The one dev seed. It sets up the owner account, then wipes the owner's task and work-schedule rows
// and repopulates seven weeks, the current week plus the three before and the three after, so
// `bun dev` shows a populated week and the week switcher has somewhere to go in both directions. It
// is meant to be re-run at the start of a session: the span is computed from today, so the data is
// always current, and the wipe means a second run replaces rather than accumulates.
//
// Run it with:
//   bun run seed
//
// The account half is an idempotent upsert and never overwrites an existing owner, so re-seeding the
// data does not disturb a signed-in session or reset the owner's name, password, or preferences. The
// data half deletes and rewrites. It is never invoked by CI, a deploy hook, or app boot, and it
// writes to whatever database .env points at, so it is the developer's responsibility to point it at
// a development database and never at production.
//
// It requires NUXT_OWNER_EMAIL, NUXT_TURSO_URL, and NUXT_TURSO_AUTH_TOKEN in .env.
//
// The generated data is deterministic. Every pattern is picked by arithmetic on the week and day
// index rather than at random, so the same calendar week always seeds the same tasks and a UI
// change can be judged against a stable picture. The date helpers come from shared/planning.ts,
// the same module the page and the tests use, rather than a private copy.

// How many weeks to seed on each side of the current one.
const WEEKS_EITHER_SIDE = 3

const ownerEmail = process.env.NUXT_OWNER_EMAIL
if (!ownerEmail) throw new Error('NUXT_OWNER_EMAIL is not set.')

console.warn(
  `seed deletes every task and work_schedule row for ${ownerEmail} in the database that .env ` +
    `points at, then reseeds seven weeks. Confirm it is a development database, never production.`
)

const client = createClient({
  url: process.env.NUXT_TURSO_URL!,
  authToken: process.env.NUXT_TURSO_AUTH_TOKEN!
})

const db = drizzle(client)

// --- the owner account ---------------------------------------------------------------------------

// Allowlist the owner so the magic-link request flow will send them a link.
await db.insert(allowedEmails).values({ email: ownerEmail }).onConflictDoNothing()

// Create the owner's admin row. Name and password stay null so the owner goes through the same
// magic-link then onboarding flow as every other user. onConflictDoNothing keeps an existing owner
// exactly as it is, so re-running the seed for fresh task data never resets the account.
await db.insert(users).values({ email: ownerEmail, role: 'admin' }).onConflictDoNothing()

// Read the owner back so the tasks are keyed to the real user id rather than a guessed one.
const owner = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).get()

if (!owner)
  throw new Error(`Could not read back the user row for ${ownerEmail} after upserting it.`)

// Held as a plain string so the row builders below, which are functions rather than straight-line
// code, key their rows to the owner without each one re-proving that the lookup succeeded.
const ownerId = owner.id

// --- the seeded span -----------------------------------------------------------------------------

// Read the owner's timezone so "today" and the target weeks match what the dashboard renders. Fall
// back to America/Toronto, the user's zone and the settings column default, when no settings
// row exists yet.
const ownerSettings = await db
  .select({ timezone: settings.timezone })
  .from(settings)
  .where(eq(settings.userId, ownerId))
  .get()

const timezone = ownerSettings?.timezone ?? 'America/Toronto'
const today = todayInZone(new Date(), timezone)

// The seeded span, one entry per week, ordered oldest first. Each week is the seven Sunday-first
// days of the week that many weeks away from today, so the middle entry is always the current week.
const weeks = Array.from({ length: WEEKS_EITHER_SIDE * 2 + 1 }, (_unused, index) =>
  getWeekDays(addDays(today, (index - WEEKS_EITHER_SIDE) * 7))
)

// --- the shape a seeded row takes ----------------------------------------------------------------

type SeedTask = {
  userId: string
  date: string
  client?: string | null
  project?: string | null
  category: string
  deliveryDate?: string | null
  deliveryTime?: string | null
  projectWordCount?: number | null
  wordsDone?: number | null
  estimatedMinutes: number
  actualMinutes?: number | null
  status?: string | null
  // Omitted on almost every row. The column is NOT NULL with a false default, so leaving it out
  // seeds a task that counts normally, and only the deliberately excluded ones set it.
  excludeFromStats?: boolean
  splitGroupId?: string | null
  sortOrder: number
}

// One entry in a day pattern. The main trackable piece of work carries a word count; a non-trackable
// entry carries none, which is what tells the row builder to leave its client and project unset so
// the row renders by its localized category name.
type PatternEntry = { category: string; minutes: number; words?: number }

// A day's shape. `state` is the capacity band it lands in against the seeded 450-minute work day
// with its 60-minute buffer, so the seeded week exercises all three meter colours. `main` is the
// category of the first entry, which is what a split pair links across two days. It is typed from
// the shared contract rather than from a list written out here, so the next change to the default
// set does not have to find this line again.
type DayPattern = {
  state: 'good' | 'warn' | 'bad'
  main: DefaultCategoryId
  entries: PatternEntry[]
}

// --- generic content pools -----------------------------------------------------------------------

// Invented agency names, every one a bad translation or terminology pun. Nothing here names a real
// client, per the confidentiality rule, and the joke is the point: dev data should be obviously fake
// at a glance so a screenshot can never be mistaken for real work. `pick` takes the length modulo,
// so this list can grow or shrink freely.
//   Faux amis        false friends, the classic translation trap, here running the firm
//   Coquille         a typo in French typography, and also a scallop, hence the dish
//   Anglicismes      the support group Québécois copy editors keep threatening to found
//   Traduttore       from `traduttore, traditore`, translator traitor, incorporated
//   Idiome           home sweet home, with the home swapped for an idiom
//   Belles infidèles the classic term for a translation that is pretty and wrong
//   Calque           a loan translation, and also tracing paper, so Tracing & Sons
//   Le mot juste     the exact right word, crossed with the Montréal comedy festival
const CLIENTS = [
  'Faux Amis & Associés',
  'Coquille Saint-Jacques',
  'Anglicismes Anonymes',
  'Traduttore Traditore inc.',
  'Idiome Sweet Idiome',
  'Les Belles Infidèles',
  'Calque & Fils',
  'Le Mot Juste Pour Rire'
] as const

// The day patterns, grouped by the capacity band they produce. The first entry of every pattern is
// the trackable work; the rest is the non-trackable time that still eats the day. Durations are
// whole minutes and the sums are deliberate: under 390 reads good, 390 through 450 reads warn (the
// remaining time has fallen into the buffer), and over 450 reads overbooked.
//
// Between them these patterns and the two off-day rows further down put every one of the nine
// default categories on at least one seeded row, so a developer opening the dev app sees the whole
// set rather than a subset. The two revision members lead one pattern each rather than sharing one,
// because they are separate categories with separate quotas and a seed that only ever wrote one of
// them would make the pair look like a single category with a longer name.
const PATTERNS: DayPattern[] = [
  // good: 315
  {
    state: 'good',
    main: 'translation',
    entries: [
      { category: 'translation', minutes: 240, words: 2000 },
      { category: 'meetings', minutes: 30 },
      { category: 'breaks', minutes: 45 }
    ]
  },
  // good: 285
  {
    state: 'good',
    main: 'revision_internal',
    entries: [
      { category: 'revision_internal', minutes: 180, words: 1500 },
      { category: 'terminology', minutes: 60 },
      { category: 'breaks', minutes: 45 }
    ]
  },
  // good: 345
  {
    state: 'good',
    main: 'translation',
    entries: [
      { category: 'translation', minutes: 300, words: 2600 },
      { category: 'breaks', minutes: 45 }
    ]
  },
  // good: 375
  {
    state: 'good',
    main: 'proofreading',
    entries: [
      { category: 'proofreading', minutes: 255, words: 3200 },
      { category: 'dtp', minutes: 75 },
      { category: 'breaks', minutes: 45 }
    ]
  },
  // warn: 405
  {
    state: 'warn',
    main: 'translation',
    entries: [
      { category: 'translation', minutes: 330, words: 2800 },
      { category: 'meetings', minutes: 30 },
      { category: 'breaks', minutes: 45 }
    ]
  },
  // warn: 435
  {
    state: 'warn',
    main: 'revision_external',
    entries: [
      { category: 'revision_external', minutes: 240, words: 2100 },
      { category: 'admin', minutes: 60 },
      { category: 'meetings', minutes: 90 },
      { category: 'breaks', minutes: 45 }
    ]
  },
  // bad: 525
  {
    state: 'bad',
    main: 'translation',
    entries: [
      { category: 'translation', minutes: 360, words: 3000 },
      { category: 'meetings', minutes: 30 },
      { category: 'terminology', minutes: 90 },
      { category: 'breaks', minutes: 45 }
    ]
  },
  // bad: 480
  {
    state: 'bad',
    main: 'translation',
    entries: [
      { category: 'translation', minutes: 435, words: 3600 },
      { category: 'breaks', minutes: 45 }
    ]
  }
]

// The capacity band each work day of a week takes, Monday through Friday. It rotates by week index,
// so every seeded week shows a mix of comfortable, buffer, and overbooked days without two adjacent
// weeks looking identical.
const STATE_ROTATION: DayPattern['state'][] = ['good', 'warn', 'good', 'bad', 'warn']

// --- deterministic pickers -----------------------------------------------------------------------

// Picks from a pool by arithmetic on the week and day index, so the choice is stable across runs.
function pick<T>(pool: readonly T[], weekIndex: number, dayIndex: number, salt = 0): T {
  return pool[(weekIndex * 7 + dayIndex + salt) % pool.length]!
}

// The pattern for one work day: the band the rotation asks for, then a pattern in that band. On a
// split day the choice narrows to the translation-led patterns, because a split pair links a
// translation across two days.
function patternFor(weekIndex: number, dayIndex: number, needsTranslation: boolean): DayPattern {
  const state = STATE_ROTATION[(weekIndex + dayIndex) % STATE_ROTATION.length]!
  const pool = PATTERNS.filter(
    (pattern) => pattern.state === state && (!needsTranslation || pattern.main === 'translation')
  )
  // Every band has at least one translation-led pattern, so the filtered pool is never empty; the
  // fallback to the full list is belt and braces rather than a reachable branch.
  return pick(pool.length ? pool : PATTERNS, weekIndex, dayIndex)
}

// --- lifecycle by position in time ---------------------------------------------------------------

// Where a date sits relative to today, which decides how finished its tasks look. A past day is
// recorded work: it has a real duration and a completed status. Today is in progress. A future day
// is planned only, so it carries an estimate with no actual duration and no words yet, which also
// exercises the effectiveDuration fallback from actual to estimate.
type Phase = 'past' | 'today' | 'future'

function phaseOf(date: string): Phase {
  if (date < today) return 'past'
  if (date === today) return 'today'
  return 'future'
}

// The status a trackable task carries in each phase. The values are read from the shared tuple
// rather than written out again, because the seed is the one copy of this vocabulary that writes
// into the database. A seed that drifted from the contract would produce rows whose status the late
// comparison can never match, and those rows would then read as late forever with nothing on screen
// to explain why. The tuple is in cycle order, so a past day takes the last of it and a future day
// the first.
const [STATUS_ACCEPTED, STATUS_IN_PROGRESS, STATUS_DONE] = TASK_STATUSES

const STATUS_BY_PHASE: Record<Phase, string> = {
  past: STATUS_DONE,
  today: STATUS_IN_PROGRESS,
  future: STATUS_ACCEPTED
}

// --- row construction ----------------------------------------------------------------------------

// Builds the rows for one day from its pattern. The trackable entry gets a client, a project, a word
// count, and a delivery; the rest get no client, no project, and a null status, which is what makes
// the row read N/A and take its name from its own category. `sortOrder` follows the entry order,
// which is the order the day is worked.
function rowsForDay(
  date: string,
  pattern: DayPattern,
  weekIndex: number,
  dayIndex: number,
  weekDays: string[]
): SeedTask[] {
  const phase = phaseOf(date)

  return pattern.entries.map((entry, entryIndex) => {
    const base = {
      userId: ownerId,
      date,
      category: entry.category,
      estimatedMinutes: entry.minutes,
      sortOrder: entryIndex
    }

    // A non-trackable filler. It keeps a null status and no client, project, or word count, so the
    // row has nothing to name itself with and falls back to its localized category, which is the
    // whole point of leaving those columns empty. Its duration is recorded once the day has happened.
    if (entry.words === undefined) {
      return {
        ...base,
        actualMinutes: phase === 'future' ? null : entry.minutes,
        status: null
      }
    }

    // The trackable piece of work. Delivery lands two days later in the same week when there is room,
    // otherwise on the week's Saturday, so a delivery date never spills past the seeded week.
    const deliveryDate = weekDays[Math.min(dayIndex + 2, 6)] ?? date

    return {
      ...base,
      client: pick(CLIENTS, weekIndex, dayIndex, entryIndex),
      // P for a new translation, R for a review pass on a file somebody else wrote, which is what
      // the two revision members and proofreading all are. The letter is invented dev data and
      // nothing reads it, so it only has to stay legible to a developer scanning the column.
      project: `${entry.category === 'translation' ? 'P' : 'R'}-${1000 + weekIndex * 137 + dayIndex * 11 + entryIndex}`,
      deliveryDate,
      deliveryTime: dayIndex % 2 === 0 ? '16:00' : '12:00',
      projectWordCount: entry.words,
      // A finished project has all its words done; today's has roughly half; a planned one has none.
      wordsDone:
        phase === 'past' ? entry.words : phase === 'today' ? Math.round(entry.words / 2) : null,
      // A finished day records what it actually took, a little off the estimate in both directions so
      // the numbers do not all read as the plan met exactly.
      actualMinutes:
        phase === 'past'
          ? entry.minutes + (dayIndex % 2 === 0 ? -10 : 15)
          : phase === 'today'
            ? entry.minutes
            : null,
      status: STATUS_BY_PHASE[phase]
    }
  })
}

// --- build the span ------------------------------------------------------------------------------

const rows: SeedTask[] = []

weeks.forEach((weekDays, weekIndex) => {
  // Wednesday and Thursday of every other week carry the two slices of one multi-day translation, so
  // the split tag and its meta line are visible somewhere in the seeded span in both directions.
  const hasSplit = weekIndex % 2 === 0

  // Monday through Friday, the work days under the seeded schedule.
  for (let dayIndex = 1; dayIndex <= 5; dayIndex += 1) {
    const date = weekDays[dayIndex]!
    const isSplitDay = hasSplit && (dayIndex === 3 || dayIndex === 4)
    rows.push(
      ...rowsForDay(
        date,
        patternFor(weekIndex, dayIndex, isSplitDay),
        weekIndex,
        dayIndex,
        weekDays
      )
    )
  }

  if (hasSplit) {
    // Link the two translations into one logical task. Both slices share the client, the project, the
    // whole-project word count, the delivery, and a group id, and each keeps its own words for its own
    // day, which is what the row's split meta line reads. The second slice is the `suite`.
    const wednesday = rows.find((row) => row.date === weekDays[3] && row.category === 'translation')
    const thursday = rows.find((row) => row.date === weekDays[4] && row.category === 'translation')

    if (wednesday && thursday) {
      const splitGroupId = crypto.randomUUID()
      const projectWordCount = (wednesday.projectWordCount ?? 0) + (thursday.projectWordCount ?? 0)

      for (const slice of [wednesday, thursday]) {
        slice.splitGroupId = splitGroupId
        slice.client = wednesday.client
        slice.project = wednesday.project
        slice.projectWordCount = projectWordCount
        slice.deliveryDate = weekDays[4]
        slice.deliveryTime = '17:00'
      }
    }
  }

  // One task per week is left late, so the `En retard` pseudo-status has something to colour. The
  // list endpoint decides lateness in SQL from the delivery deadline against the user's clock, so the
  // seed does not set that status; it only creates the situation, an unfinished task whose delivery
  // has already passed, and lets the backend reach the verdict.
  //
  // The day is the most recent work day strictly before today, which puts a late task in the current
  // week as well as in each past one. Wednesday and Thursday are skipped because they can hold the
  // split pair, whose two slices share one delivery that this must not pull apart. A week entirely
  // today or later gets none, which is correct rather than a gap: nothing there can be late yet.
  const lateDay = [1, 2, 5]
    .map((dayIndex) => weekDays[dayIndex]!)
    .filter((date) => date < today)
    .at(-1)

  if (lateDay) {
    const lateTrackable = rows.find(
      (row) => row.date === lateDay && isTrackableCategory(row.category)
    )
    if (lateTrackable) {
      // Only the status and the delivery move. The durations are left exactly as the pattern set them,
      // so making a day late never shifts the capacity band that day was chosen to demonstrate.
      lateTrackable.status = STATUS_IN_PROGRESS
      lateTrackable.deliveryDate = lateDay
      lateTrackable.deliveryTime = '11:00'
      // A late task is partly done rather than untouched, which is the realistic case and keeps the
      // words column meaningful next to the red badge.
      lateTrackable.wordsDone = Math.round((lateTrackable.projectWordCount ?? 0) / 3)
    }
  }

  // One trackable task per week is excluded from the quota, so the exclusion marker is visible in
  // every seeded week in both directions. The pick is the week's first trackable task that was not
  // left late, so the two markers land on different rows and each reads on its own. The flag is only
  // ever put on a trackable task, because on a break or a meeting it changes nothing and the row
  // would carry a marker for a fact with no effect. Nothing else about the row moves: an excluded
  // task keeps its real words and its real duration, and the capacity meter still counts it, so the
  // day keeps the band its pattern was chosen to demonstrate.
  const excludedTrackable = rows.find(
    (row) =>
      weekDays.includes(row.date) && row.date !== lateDay && isTrackableCategory(row.category)
  )

  if (excludedTrackable) excludedTrackable.excludeFromStats = true

  // Some off days carry recorded work and some are empty, which is the common case. Every third week
  // logs a short Saturday translation, honouring the do-not-police rule that weekend work is recorded
  // and bonifies the week; every fourth week starts with a Sunday admin task.
  if (weekIndex % 3 === 0) {
    const saturday = weekDays[6]!
    const phase = phaseOf(saturday)
    rows.push({
      userId: ownerId,
      date: saturday,
      client: pick(CLIENTS, weekIndex, 6),
      project: `P-${2000 + weekIndex * 7}`,
      category: 'translation',
      projectWordCount: 1800,
      wordsDone: phase === 'past' ? 1800 : phase === 'today' ? 800 : null,
      estimatedMinutes: 90,
      actualMinutes: phase === 'future' ? null : 90,
      status: STATUS_BY_PHASE[phase],
      sortOrder: 0
    })
  }

  if (weekIndex % 4 === 1) {
    const sunday = weekDays[0]!
    rows.push({
      userId: ownerId,
      date: sunday,
      category: 'admin',
      estimatedMinutes: 30,
      actualMinutes: phaseOf(sunday) === 'future' ? null : 30,
      status: null,
      sortOrder: 0
    })
  }
})

// --- write ---------------------------------------------------------------------------------------

// Wipe first, so a re-run replaces the whole picture rather than merging into a stale one and never
// leaves a half-seeded span. Both deletes are scoped to the owner by user id, so another user's rows
// in a shared dev database are untouched, and no account, settings, or preference row is touched, so
// the owner stays able to sign in.
const deletedTasks = await db.delete(tasks).where(eq(tasks.userId, ownerId))
const deletedSchedule = await db.delete(workSchedule).where(eq(workSchedule.userId, ownerId))

// Insert in chunks. A single statement binds one parameter per column per row, and the whole span is
// well over a hundred rows, so chunking keeps the statement under any SQLite variable limit rather
// than relying on the client's ceiling being generous.
const CHUNK_SIZE = 50
for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
  await db.insert(tasks).values(rows.slice(start, start + CHUNK_SIZE))
}

// One work_schedule record (PLAN-03) so the capacity meter shows real numbers. effective_from is the
// first of the month of the earliest seeded week, comfortably on or before every seeded day, so
// resolveSchedule picks it for the whole span in both directions. The values are the resolver's own
// documented defaults, so with the record present or absent the meter reads the same figures; the
// record simply exercises the read path end to end, and it is what the day patterns above are
// balanced against.
const effectiveFrom = `${weeks[0]![0]!.slice(0, 7)}-01`

await db.insert(workSchedule).values({
  userId: ownerId,
  workMinutes: DEFAULT_SCHEDULE.workMinutes,
  workDays: JSON.stringify(DEFAULT_SCHEDULE.workDays),
  bufferMinutes: DEFAULT_SCHEDULE.bufferMinutes,
  effectiveFrom
})

const from = weeks[0]![0]!
const to = weeks.at(-1)![6]!

console.log(
  `Deleted ${deletedTasks.rowsAffected} task(s) and ${deletedSchedule.rowsAffected} ` +
    `work_schedule row(s) for ${ownerEmail}.`
)
console.log(
  `Seeded ${rows.length} tasks across ${weeks.length} weeks, ${from} to ${to} (today ${today}, ` +
    `timezone ${timezone}), plus one work_schedule record effective ${effectiveFrom}.`
)

client.close()
