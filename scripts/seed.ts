import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

import { allowedEmails } from '../server/db/schema'

const ownerEmail = process.env.NUXT_OWNER_EMAIL
if (!ownerEmail) throw new Error('NUXT_OWNER_EMAIL is not set.')

const client = createClient({
  url: process.env.NUXT_TURSO_URL!,
  authToken: process.env.NUXT_TURSO_AUTH_TOKEN!
})

const db = drizzle(client)

await db.insert(allowedEmails).values({ email: ownerEmail }).onConflictDoNothing()

console.log(`Seeded allowed_emails with ${ownerEmail}.`)
client.close()
