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
    quotaWph: integer('quota_wph').notNull().default(450),
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
    // Free-text category id. The trackable flag and the known set live in the
    // PLAN-02 contract; coerced at read, validated at the PLAN-09 write boundary.
    category: text('category').notNull(),
    deliveryDate: text('delivery_date'),
    deliveryTime: text('delivery_time'),
    // Plain integer counts and whole-minute durations. The schema stores raw
    // facts only; the quota math (PLAN-22) and the frozen estimate (PLAN-12)
    // live in their own features. wordsDone is the quota numerator, treated as
    // zero when absent. quotaWphOverride NULL means use settings.quota_wph.
    projectWordCount: integer('project_word_count'),
    wordsDone: integer('words_done'),
    quotaWphOverride: integer('quota_wph_override'),
    estimatedMinutes: integer('estimated_minutes'),
    actualMinutes: integer('actual_minutes'),
    // Free text. Trackable only ('Accepté' / 'En cours' / 'Terminé'); NULL reads
    // as 'N/A' for non-trackable tasks. Validated at the PLAN-09 write boundary.
    status: text('status'),
    // Takes this task out of the quota numerator while its duration still comes out of the
    // denominator, which is the split PLAN-22 implements. SQLite has no boolean type, so the
    // mode 'boolean' integer is how this repo already stores one (magicLinkTokens.used). It is
    // NOT NULL with a false default because "not excluded" is the answer for every existing row
    // and a nullable flag would give the quota engine a third state to interpret.
    excludeFromStats: integer('exclude_from_stats', { mode: 'boolean' }).notNull().default(false),
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
    // and gives a future erasure path (PLAN-29) a clean sweep. Fires only with
    // PRAGMA foreign_keys = ON, which the libSQL/Turso client must enable.
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
    // leaves no orphans and gives the future erasure path a clean sweep. Fires
    // only with PRAGMA foreign_keys = ON, which the libSQL/Turso client enables.
    foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    // A unique index on (user_id, effective_from) forbids two records for the
    // same user on the same effective date (which would make resolution
    // ambiguous) and serves the resolution query
    // WHERE user_id = ? AND effective_from <= ? ORDER BY effective_from DESC.
    // user_id first for the equality match, effective_from second for the range.
    uniqueIndex('work_schedule_user_id_effective_from_idx').on(table.userId, table.effectiveFrom)
  ]
)
