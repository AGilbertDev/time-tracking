# Planificateur de traduction

A planning and productivity tool for freelance translators. Track daily tasks, monitor words-per-hour throughput, and compare against your own targets.

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

All rights reserved, with one narrow permission. Anyone may install and run it as published to evaluate my work. That covers running it and nothing else, so not adopting it in your own projects, not adapting it, and not redistributing it. See [LICENSE](./LICENSE).
