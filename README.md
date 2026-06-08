# Planificateur de traduction

A planning and productivity tool for professional translators. Track daily tasks, monitor words-per-hour performance, and compare against employer benchmarks.

## Stack

- **Nuxt 4** + Vue 3 + TypeScript
- **Nuxt UI v4** — component library (Tailwind v4 + Reka UI)
- **Drizzle ORM** + **Turso** (libSQL) — persistent database
- **nuxt-auth-utils** — session management
- **Resend** — magic-link email delivery
- **@nuxtjs/i18n** — FR (default) + EN

## Auth

Owner-managed magic-link. No passwords, no OAuth. Access is gated by an `allowed_emails` allowlist in the database. The owner's email is seeded via the `OWNER_EMAIL` env var on first deployment.

## Getting started

```bash
bun install
bun run dev        # http://localhost:8080
```

## Env vars

Copy `.env.example` to `.env` and fill in values.

## Docs

- [`docs/concept.md`](docs/concept.md) — what the original planning app did (reference only)
- [`docs/spec.md`](docs/spec.md) — v1 product spec for the rebuild

## License

Copyright (c) 2026 Alexandre Gilbert. All rights reserved. This code is published for viewing only. See [LICENSE](./LICENSE).
