---
paths:
  - 'app/**/*.vue'
  - 'app/**/*.ts'
---

Before changing this file, load `/nuxt-conventions:frontend` and `/nuxt-conventions:styling` and follow them.

The short version, so an edit is never made without it. Nuxt UI primitives first, then Nuxt features, then custom Vue, then Tailwind for the gaps. Every user-facing string goes through `useI18n()` with both locales added together. Semantic tokens only, never a raw hex. `min-h-dvh`, never `min-h-screen`. Phosphor icons through the icon prop, Simple Icons for brands only. Every icon-only control carries an `aria-label`.
