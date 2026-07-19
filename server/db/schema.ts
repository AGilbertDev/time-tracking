import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    // the primary user's zone.
    timezone: text('timezone').notNull().default('America/Toronto')
  },
  (table) => [foreignKey({ columns: [table.userId], foreignColumns: [users.id] })]
)

// One row per task-day slice. Multi-day work is one logical task made of one slice
// per day, sharing a project and a split_group_id, each slice carrying its own
// words_done and duration. Storing it this way keeps every period statistic a plain
// indexed range sum over (user_id, date). The table records raw facts only: category
// and status are free text coerced at read (PLAN-02 / PLAN-09), the estimate is frozen
// at write (PLAN-12), and the quota math lives in PLAN-22. Calendar and clock values
// (date, delivery_date, delivery_time) are text, while true lifecycle instants
// (created_at, updated_at) use the repo's integer Unix-seconds timestamp pattern.
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull(),
    // Calendar day this slice belongs to, 'YYYY-MM-DD'. The range key for period sums.
    date: text('date').notNull(),
    client: text('client'),
    project: text('project'),
    // Free-text category id. The trackable flag and known set live in PLAN-02.
    category: text('category').notNull(),
    // Deadline calendar day 'YYYY-MM-DD' and wall-clock time 'HH:MM' (24-hour).
    deliveryDate: text('delivery_date'),
    deliveryTime: text('delivery_time'),
    projectWordCount: integer('project_word_count'),
    // Words completed on this slice, on this day. The engine treats absent as zero.
    wordsDone: integer('words_done'),
    // Per-task override of the default quota. NULL means use settings.quota_wph.
    quotaWphOverride: integer('quota_wph_override'),
    // Frozen computed duration and real duration, whole minutes (PLAN-12).
    estimatedMinutes: integer('estimated_minutes'),
    actualMinutes: integer('actual_minutes'),
    // Free text. Trackable only; NULL reads as N/A for non-trackable tasks.
    status: text('status'),
    instructions: text('instructions'),
    // Plain grouping uuid shared across the slices of a split. No self-FK (PLAN-18).
    splitGroupId: text('split_group_id'),
    // Within-day ordering. The write API assigns it; drag reorder (PLAN-15) mutates it.
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date())
  },
  (table) => [
    // cascade so deleting a user removes their tasks and leaves no orphan rows,
    // supporting a clean data-erasure path (PLAN-29). This departs from the settings
    // FK, which has no onDelete; adopting the correct behavior from the start.
    foreignKey({ columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    // user_id first for the equality match, date second for the range, so a period
    // stat is a single indexed range scan.
    index('tasks_user_id_date_idx').on(table.userId, table.date)
  ]
)
