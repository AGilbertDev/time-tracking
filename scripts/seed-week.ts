import { createClient } from '@libsql/client'
import { and, eq, gte, lte } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'

import { settings, tasks, users } from '../server/db/schema'

// Dev-only seed for the read-only planning week (PLAN-04, Bout 1). It fills the owner's current
// week with a handful of representative tasks so `bun dev` shows a populated week rather than seven
// empty day cards. It writes tasks only. It is never invoked by CI, a deploy hook, or app boot, and
// it writes to whatever database .env points at, so it is the developer's responsibility to point
// it at a development database and never at production.
//
// Run it with:
//   bun run seed:week
//
// It requires NUXT_OWNER_EMAIL, NUXT_TURSO_URL, and NUXT_TURSO_AUTH_TOKEN in .env, and an existing
// owner user row, which `bun run seed` creates if needed.

const ownerEmail = process.env.NUXT_OWNER_EMAIL
if (!ownerEmail) throw new Error('NUXT_OWNER_EMAIL is not set.')

console.warn(
  `seed:week writes to the database that .env points at. Confirm it is a development database, ` +
    `never production, before continuing.`
)

const client = createClient({
  url: process.env.NUXT_TURSO_URL!,
  authToken: process.env.NUXT_TURSO_AUTH_TOKEN!
})

const db = drizzle(client)

// The current week is computed at run time, so the seed always targets the week the developer sees.
// These are inlined rather than imported from shared/planning.ts because that module ships with the
// frontend bout and is the target of the unit-test stage; the seed keeps its own small, DB-free copy
// so it does not preempt or diverge from that shared module. They mirror the spec's helpers.

// The 'YYYY-MM-DD' calendar day of an instant as seen in a timezone, so an instant late in the day
// reads as the correct local day rather than drifting. en-CA formats as YYYY-MM-DD.
function todayInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

// The 'YYYY-MM-DD' that is n days after date, computed at UTC midnight so month and year boundaries
// are correct and there is no daylight-saving drift.
function addDays(date: string, n: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + n * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

// The seven 'YYYY-MM-DD' strings from the week's Sunday through its Saturday, in order, for the
// Sunday-to-Saturday week containing date. Returned as a fixed seven-tuple so each day destructures
// to a plain string rather than a possibly-undefined array element.
function getWeekDays(date: string): [string, string, string, string, string, string, string] {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const sunday = addDays(date, -weekday)
  return [
    sunday,
    addDays(sunday, 1),
    addDays(sunday, 2),
    addDays(sunday, 3),
    addDays(sunday, 4),
    addDays(sunday, 5),
    addDays(sunday, 6)
  ]
}

// Resolve the owner the same way the app and the account seed do, by NUXT_OWNER_EMAIL, then look up
// their user row so the tasks are keyed to a real user id rather than a guessed one. Fail closed with
// a clear message if the owner row does not exist yet.
const owner = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).get()

if (!owner) {
  throw new Error(
    `No user row for ${ownerEmail}. Run \`bun run seed\` first to create the owner account.`
  )
}

// Read the owner's timezone so "today" and the target week match what the dashboard renders. Fall
// back to America/Toronto, the primary user's zone and the settings column default, when no settings
// row exists yet.
const ownerSettings = await db
  .select({ timezone: settings.timezone })
  .from(settings)
  .where(eq(settings.userId, owner.id))
  .get()

const timezone = ownerSettings?.timezone ?? 'America/Toronto'
const [sunday, monday, tuesday, wednesday, thursday, friday, saturday] = getWeekDays(
  todayInZone(new Date(), timezone)
)
const from = sunday
const to = saturday

// Re-run safety. Delete the owner's existing tasks in the target week before inserting, so a second
// run replaces rather than accumulates and never leaves a half-seeded or duplicated week. The delete
// is scoped to the owner and to the week range, so tasks in other weeks are untouched.
await db
  .delete(tasks)
  .where(and(eq(tasks.userId, owner.id), gte(tasks.date, from), lte(tasks.date, to)))

// A shared group id links the two slices of one logical multi-day translation, one row per day, each
// carrying its own words. The second slice is the "suite" the row marks with the split tag.
const splitGroupId = crypto.randomUUID()

// A spread of representative tasks across the week, covering every state the row must show: trackable
// translation and revision with a mix of Accepté, En cours, and Terminé; non-trackable meetings,
// breaks, terminology, and admin with a null status so the row reads N/A; a two-day split pair; and
// work on a weekend day so an off-day card still renders its rows. Categories come from the PLAN-02
// contract. Words and durations are realistic so the week reads well.
const rows = [
  // Sunday, an off day, carries one non-trackable admin task so the start-of-week card shows content.
  {
    userId: owner.id,
    date: sunday,
    category: 'admin',
    instructions: 'Planification de la semaine',
    estimatedMinutes: 30,
    actualMinutes: 30,
    sortOrder: 0
  },
  // Monday, a work day, an in-progress translation with a same-week delivery, then a short meeting.
  {
    userId: owner.id,
    date: monday,
    client: 'Trad-Média',
    project: 'P-4821',
    category: 'translation',
    deliveryDate: wednesday,
    deliveryTime: '16:00',
    projectWordCount: 5200,
    wordsDone: 1350,
    estimatedMinutes: 180,
    actualMinutes: 180,
    status: 'En cours',
    sortOrder: 0
  },
  {
    userId: owner.id,
    date: monday,
    category: 'meetings',
    instructions: 'Réunion de lancement de projet',
    estimatedMinutes: 30,
    actualMinutes: 30,
    sortOrder: 1
  },
  // Tuesday, a finished revision plus a break.
  {
    userId: owner.id,
    date: tuesday,
    client: 'Juritrad',
    project: 'R-1190',
    category: 'revision',
    deliveryTime: '12:00',
    projectWordCount: 2200,
    wordsDone: 2200,
    estimatedMinutes: 120,
    actualMinutes: 110,
    status: 'Terminé',
    sortOrder: 0
  },
  {
    userId: owner.id,
    date: tuesday,
    category: 'breaks',
    instructions: 'Pause déjeuner',
    estimatedMinutes: 45,
    actualMinutes: 45,
    sortOrder: 1
  },
  // Wednesday and Thursday, the two slices of one multi-day translation sharing a project and a split
  // group id, each with its own words. The first slice is accepted, the second is in progress.
  {
    userId: owner.id,
    date: wednesday,
    client: 'Groupe Lexi',
    project: 'P-5000',
    category: 'translation',
    deliveryDate: thursday,
    deliveryTime: '17:00',
    projectWordCount: 3000,
    wordsDone: 1400,
    estimatedMinutes: 185,
    actualMinutes: 185,
    status: 'Accepté',
    splitGroupId,
    sortOrder: 0
  },
  {
    userId: owner.id,
    date: thursday,
    client: 'Groupe Lexi',
    project: 'P-5000',
    category: 'translation',
    deliveryDate: thursday,
    deliveryTime: '17:00',
    projectWordCount: 3000,
    wordsDone: 1600,
    estimatedMinutes: 210,
    actualMinutes: null,
    status: 'En cours',
    splitGroupId,
    sortOrder: 0
  },
  // Friday, a non-trackable terminology task.
  {
    userId: owner.id,
    date: friday,
    category: 'terminology',
    instructions: 'Constitution du glossaire client',
    estimatedMinutes: 60,
    actualMinutes: 60,
    sortOrder: 0
  },
  // Saturday, an off day that still carries a trackable translation, honouring the do-not-police rule
  // that weekend work is recorded and bonifies the week.
  {
    userId: owner.id,
    date: saturday,
    client: 'Trad-Média',
    project: 'P-4990',
    category: 'translation',
    projectWordCount: 1800,
    wordsDone: 800,
    estimatedMinutes: 90,
    actualMinutes: 90,
    status: 'En cours',
    sortOrder: 0
  }
]

await db.insert(tasks).values(rows)

console.log(
  `Seeded ${rows.length} tasks for ${ownerEmail} across the week ${from} to ${to} ` +
    `(timezone ${timezone}).`
)

client.close()
