---
paths:
  - 'server/**/*.ts'
  - 'shared/**/*.ts'
---

Before changing this file, load `/nuxt-conventions:backend` and follow it.

The short version, so an edit is never made without it. Validate at the boundary with Zod before anything touches the database. Keep handlers thin and put the logic in `server/utils/`. `useRuntimeConfig()` for every secret, never `process.env` in a handler. `createError` for expected failures. List endpoints paginate, sort, and search on the server and return a total. A derived value is resolved here and arrives finished, never sent as a raw row plus the rules for reading it.
