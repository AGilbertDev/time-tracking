import { foreignKey, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const allowedEmails = sqliteTable('allowed_emails', { email: text('email').primaryKey() })

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
    locale: text('locale').notNull().default('fr')
  },
  (table) => [foreignKey({ columns: [table.userId], foreignColumns: [users.id] })]
)
