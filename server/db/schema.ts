import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const allowedEmails = sqliteTable('allowed_emails', {
  email: text('email').primaryKey(),
  // When the email was added to the allowlist. Stored as Unix seconds (mode 'timestamp'),
  // matching users.createdAt, so the admin users list can show a real date for invited-only
  // rows. The application default is set here for new inserts; the 0003 migration backfills
  // pre-existing rows with a SQL-side unixepoch() default.
  invitedAt: integer('invited_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
})

export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  deactivatedAt: integer('deactivated_at', { mode: 'timestamp' })
})

export const magicLinkTokens = sqliteTable('magic_link_tokens', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  used: integer('used', { mode: 'boolean' }).default(false)
})

export const settings = sqliteTable(
  'settings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull(),
    dailyWorkMinutes: integer('daily_work_minutes').default(450),
    workDays: text('work_days').notNull().default('[1,2,3,4,5]'),
    // Preference columns. The theme defaults match DEFAULT_THEME_ID in shared/theme.ts,
    // and the locale default matches the i18n defaultLocale. Locale lives here now rather
    // than on users so a single settings row holds every user preference.
    lightTheme: text('light_theme').notNull().default('pastel'),
    darkTheme: text('dark_theme').notNull().default('pastel'),
    locale: text('locale').notNull().default('fr'),
    // Owner's IANA timezone. The onboarding wizard captures it so the dashboard can render
    // day boundaries and quota windows in the user's local time. Defaults to America/Toronto,
    // the user's zone.
    timezone: text('timezone').notNull().default('America/Toronto')
  },
  (table) => [foreignKey({ columns: [table.userId], foreignColumns: [users.id] })]
)

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull(),
    // Calendar and clock values are text, not timestamp integers. date and
    // deliveryDate hold 'YYYY-MM-DD' and deliveryTime holds 'HH:MM' (24-hour),
    // so lexicographic order matches chronological order and a period stat is a
    // plain index-friendly range scan over (userId, date) with no timezone
    // ambiguity. Only true lifecycle instants (createdAt, updatedAt) use the
    // integer mode 'timestamp' pattern below.
    date: text('date').notNull(),
    // Free text. Absent on non-trackable tasks (a break has no client/project).
    client: text('client'),
    project: text('project'),
    // Free-text category id. The two category flags and the known set live in the
    // PLAN-02 contract, coerced at read and validated at the PLAN-09 write
    // boundary. No CHECK and no enum here on purpose, which is why adding a
    // category needs no migration and an existing row keeps whatever it holds.
    // Deliberately no DDL default either, even though a create now defaults it.
    // SQLite cannot add one to an existing column without rebuilding the table,
    // and a literal here could not import the contract, so it would be a second
    // copy of the fallback id free to drift. The default is declared once on
    // TaskCreateSchema instead.
    category: text('category').notNull(),
    deliveryDate: text('delivery_date'),
    deliveryTime: text('delivery_time'),
    // Plain integer counts and whole-minute durations. The schema stores raw
    // facts only; the quota math (PLAN-22) and the frozen estimate (PLAN-12)
    // live in their own features. quotaWphOverride NULL means the row takes its
    // category's quota, which is the user's own category_quotas row effective on
    // this task's date and otherwise the category's shipped default. The global
    // settings.quota_wph this used to name retired in migration 0011, because a
    // quota belongs to a kind of work rather than to a person. The resolution
    // order lives in server/utils/resolveCategoryQuota.ts and nowhere else.
    //
    // project_word_count is this row's own total, which is the whole project's
    // total only when the work is not split across days. The name reads as a
    // whole project's and is therefore mildly misleading, and it is kept rather
    // than renamed: a rename means either ALTER TABLE RENAME COLUMN plus an edit
    // to every reader or a create-copy-swap, and it also renames
    // projectWordCount on a request contract that has already shipped, which
    // turns an internal tidy into a breaking API change for no behaviour gained.
    //
    // There is no second words column. words_done was the quota numerator and
    // migration 0008 dropped it, because a per-row progress figure the user will
    // not reliably enter produces worse statistics than no figure. Work spanning
    // several days is several rows, each carrying the words actually done that
    // day as its own total, and that is what the quota engine sums.
    projectWordCount: integer('project_word_count'),
    quotaWphOverride: integer('quota_wph_override'),
    estimatedMinutes: integer('estimated_minutes'),
    actualMinutes: integer('actual_minutes'),
    // Free text ('Accepté' / 'En cours' / 'Terminé'), carried only by a category
    // the contract marks deliverable, which is not the same set as the trackable
    // ones. NULL reads as 'N/A' for a category that carries no status. Validated
    // at the PLAN-09 write boundary.
    status: text('status'),
    // Takes this task out of the quota numerator while its duration still comes out of the
    // denominator, which is the split PLAN-22 implements. SQLite has no boolean type, so the
    // mode 'boolean' integer is how this repo already stores one (magicLinkTokens.used). It is
    // NOT NULL with a false default because "not excluded" is the answer for every existing row
    // and a nullable flag would give the quota engine a third state to interpret.
    excludeFromStats: integer('exclude_from_stats', { mode: 'boolean' }).notNull().default(false),
    // The user's own free multiline text on this task, added by migration 0009.
    // Nullable with no default, and a cleared note stores NULL rather than '' so
    // every reader has one absent case instead of two. It is a fresh field rather
    // than a revival of the instructions column 0007 dropped: Consignes is out of
    // the product, nothing but the dev seed ever wrote that column, and a note is
    // the user's own reminder on one task rather than a client's instructions for
    // a job. Trimmed at the write boundary and bounded there by TASK_NOTES_MAX
    // from shared/planning.ts, which is where every other task field's meaning is
    // enforced. The bound lives in the shared layer rather than here because the
    // editor needs the same number for its character counter, so both sides read
    // one declaration instead of keeping two that drift.
    notes: text('notes'),
    // A plain grouping key (a shared uuid) linking the per-day slices of one
    // logical multi-day task. No self-FK: all slices are peers with no parent,
    // and a group of one (an interrupted split) is a valid state.
    splitGroupId: text('split_group_id'),
    // Within-day ordering. The write API assigns it; drag reorder (PLAN-15)
    // mutates it.
    sortOrder: integer('sort_order').notNull().default(0),
    // True lifecycle instants, Unix-seconds mode 'timestamp', matching users
    // exactly (no .notNull(), defaulted through $defaultFn).
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [
    // Deleting a user deletes their tasks. A user's tasks are their own personal
    // data with no reason to outlive the account, so cascade leaves no orphans
    // and gives a future erasure path (PLAN-29) a clean sweep.
    //
    // Cascade needs PRAGMA foreign_keys = ON, and no application code here sets
    // it. Turso enforces foreign keys by default at the server, so in production
    // enforcement comes from the platform rather than from any client
    // configuration, and the libSQL client needs no pragma of its own. The
    // pipeline orchestrator checked this on 2026-07-29 with a read-only probe
    // against the development database, running SELECT 1 as a positive control
    // first and then PRAGMA foreign_keys, which answered 1. Production was never
    // probed, so read this as verified in development only.
    //
    // Nothing depends on that cascade for erasure. The purge endpoint
    // (server/api/cron/purge-deactivated.get.ts) deletes tasks and work_schedule
    // explicitly, precisely because the pragma is unverified on the one database
    // where a failed erasure would matter. Read this cascade as a second line of
    // defence rather than as the mechanism.
    //
    // The suite does now cover this area, which it could not before. As long as
    // test/helpers/taskTestDb.ts issued no pragma, SQLite left foreign keys off
    // per connection and every key declared here was decoration under test, so a
    // broken cascade kept the suite green. That helper now turns the pragma on by
    // default and test/server/api/cron/purge-deactivated-rows.test.ts asserts
    // both that it reads back on and that an orphan insert is genuinely refused,
    // so the enforcement is proved rather than configured. The one suite that
    // opts out is that same file's purge case, which needs the cascade absent in
    // order to prove the explicit deletes do the work themselves.
    foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    // userId first for the equality match, date second for the range, so every
    // period stat is a single indexed range scan over (userId, date).
    index('tasks_user_id_date_idx').on(table.userId, table.date)
  ]
)

// The effective-dated work-schedule history (PLAN-03). The settings row holds
// the user's *current* daily work minutes, work days, and buffer, but that row
// is mutable and cannot answer "what was the work-day length on a past date".
// A period's quota denominator reads the work-hours setting in effect on that
// day, so the setting is versioned by date here in its own history table (the
// SCD Type 2 pattern), leaving the settings row for the live value. This bout
// only reads the history; the settings page writes it.
export const workSchedule = sqliteTable(
  'work_schedule',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull(),
    // The daily work-target in whole minutes for a work day under this record.
    workMinutes: integer('work_minutes').notNull(),
    // JSON array of weekday numbers 0-6 (0 = Sunday), the same representation as
    // settings.work_days. Coerced defensively on read before the resolver sees it.
    workDays: text('work_days').notNull().default('[1,2,3,4,5]'),
    // The buffer the user keeps for urgent work, in whole minutes.
    bufferMinutes: integer('buffer_minutes').notNull().default(60),
    // 'YYYY-MM-DD', the calendar day this record takes effect. Text so
    // lexicographic order equals chronological order, matching tasks.date.
    effectiveFrom: text('effective_from').notNull(),
    // True lifecycle instants, Unix-seconds mode 'timestamp', matching users
    // and tasks exactly (no .notNull(), defaulted through $defaultFn).
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [
    // Deleting a user deletes their schedule history. It is the user's own
    // personal preference data with no reason to outlive the account, so cascade
    // leaves no orphans and gives the future erasure path a clean sweep. It
    // fires for the same reason the tasks foreign key above does, Turso's server
    // default rather than anything the libSQL client sets, and the check behind
    // that statement and the limits on it are recorded there rather than twice.
    foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    // A unique index on (user_id, effective_from) forbids two records for the
    // same user on the same effective date (which would make resolution
    // ambiguous) and serves the resolution query
    // WHERE user_id = ? AND effective_from <= ? ORDER BY effective_from DESC.
    // user_id first for the equality match, effective_from second for the range.
    uniqueIndex('work_schedule_user_id_effective_from_idx').on(table.userId, table.effectiveFrom)
  ]
)

// The effective-dated per-category quota history (PLAN-32b). A quota is a property of a kind of work
// rather than a property of the person doing it, so the one global settings.quota_wph could not
// describe four kinds of work at once and retired in migration 0011. This table holds the user's own
// figure per category instead, and the shipped starting figures stay in shared/categories.ts as
// defaultQuotaWph, so a user with no rows here still resolves a working quota for every trackable
// category and there is no bootstrap step.
//
// It is a standalone table keyed by a free-text category_id rather than a quota column on a
// categories record, and that is deliberate twice over. There is no per-user categories record to put
// a column on, since the categories are still a code contract with no table behind them, so a quota
// column on the category would mean building that table first and that table is its own feature
// (PLAN-30). And free text means this table already accepts an id that does not exist yet, so a quota
// for a user-created category is an insert rather than a migration. That is the same seam
// CategoryId = DefaultCategoryId | (string & {}) keeps open in the type, expressed in the database
// rather than only in TypeScript. The cost is that a stored row can name a category the app no longer
// knows, which the resolver handles by never selecting it rather than by preventing it, and such a row
// is left in place so its quota comes back if its category does.
//
// The effective dating copies work_schedule above rather than inventing a second arrangement for the
// same problem. Editing a quota must not restate a period that has already been reported, so this is
// SCD Type 2, one row per effective date, effective_from held as 'YYYY-MM-DD' text so lexicographic
// order equals chronological order, and resolution is an index-friendly range scan.
export const categoryQuotas = sqliteTable(
  'category_quotas',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull(),
    // Free-text category id, the shared ten today and any user-created id later. No CHECK and no
    // enum here on purpose, for the reason given in the header. The write boundary validates the id
    // against the contract's trackable set, and the read path is asked about one category at a time
    // so a row naming an unknown id simply never participates.
    categoryId: text('category_id').notNull(),
    // The user's target words per hour for that category under this record. NOT NULL because a row
    // with no figure would say nothing that the row's absence does not already say better, and the
    // write boundary keeps it at 1 or above because the quota is a divisor.
    quotaWph: integer('quota_wph').notNull(),
    // 'YYYY-MM-DD', the calendar day this record takes effect. Text so lexicographic order equals
    // chronological order, matching work_schedule and tasks.date.
    effectiveFrom: text('effective_from').notNull(),
    // True lifecycle instants, Unix-seconds mode 'timestamp', matching users, tasks, and
    // work_schedule exactly (no .notNull(), defaulted through $defaultFn).
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [
    // Deleting a user deletes their quotas. They are the user's own configuration with no reason to
    // outlive the account, so cascade leaves no orphans. It fires for the same reason the tasks
    // foreign key does, Turso's server default rather than anything the libSQL client sets, and the
    // check behind that statement and the limits on it are recorded on that key rather than three
    // times. The purge endpoint deletes this table explicitly as well, precisely because the pragma
    // is unverified on the one database where a failed erasure would matter.
    foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    // A unique index on (user_id, category_id, effective_from) forbids two records for the same user,
    // category, and effective date, which would make resolution ambiguous, and it is the conflict
    // target the write upserts on so saving twice in a day updates that day's row rather than piling
    // up rows. It also serves the resolution query
    // WHERE user_id = ? AND category_id = ? AND effective_from <= ? ORDER BY effective_from DESC,
    // with the two equality columns first and the range column last.
    uniqueIndex('category_quotas_user_id_category_id_effective_from_idx').on(
      table.userId,
      table.categoryId,
      table.effectiveFrom
    )
  ]
)
