import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

import { allowedEmails, users } from '../server/db/schema'

const ownerEmail = process.env.NUXT_OWNER_EMAIL
if (!ownerEmail) throw new Error('NUXT_OWNER_EMAIL is not set.')

const client = createClient({
  url: process.env.NUXT_TURSO_URL!,
  authToken: process.env.NUXT_TURSO_AUTH_TOKEN!
})

const db = drizzle(client)

// Allowlist the owner so the magic-link request flow will send them a link.
await db.insert(allowedEmails).values({ email: ownerEmail }).onConflictDoNothing()

// Create the owner's admin row. Name and password stay null so the owner goes
// through the same magic-link then onboarding flow as every other user.
await db.insert(users).values({ email: ownerEmail, role: 'admin' }).onConflictDoNothing()

console.log(`Seeded owner admin account for ${ownerEmail}.`)
client.close()
