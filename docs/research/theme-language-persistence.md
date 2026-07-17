# Persisting theme and language without a flash

This is a record of a web-sourced research review done to validate how the app stores and delivers the user's theme and language preferences. It was run because the design was questioned mid-build, and the goal was to confirm whether saving the setting to the account is right and whether our flash-free approach matches accepted practice. The short answer is yes on both counts.

## The question

How do server-rendered web apps persist a signed-in user's theme (light and dark atmosphere) and language as durable account settings that follow the user across devices, without a flash of the wrong theme or language on first paint?

## The verdict

Saving the preference to the user's account is good practice and is exactly how a setting follows a user across devices. Our design matches the accepted flash-free architecture. We did not need to start over.

## Why this is hard at all

Server rendering builds the HTML before any client JavaScript runs. To avoid a flash, the server has to know the preference at render time. Two consequences follow, and they are the whole story.

- **A client-only store cannot drive SSR.** `localStorage` does not exist on the server, so a value read only on the client paints the default first and then corrects, which is the visible flash. Nuxt's own hydration guide uses this exact example and prescribes a server-readable cookie instead.
- **`prefers-color-scheme: system` can only be resolved on the client.** The server cannot read the OS setting, so a small synchronous inline `<head>` script is unavoidable for that one case. Every mature library does this, including `next-themes` and `@nuxtjs/color-mode`. A `useEffect` or `onMounted` runs too late and still flashes.

## The accepted pattern

1. Persist the explicit preference somewhere the server can read on each request so it can render the correct value into the initial HTML.
2. Run an inline pre-paint script only for the thing the server cannot know, the `system` color scheme.

For a logged-in user the database is the right source of truth, delivered to SSR through a server-readable channel. The common ways to deliver it are to read the database during SSR, to embed the value in the auth session, or to mirror it into a plain cookie. All three work, and they trade a per-render database read against sync and staleness.

## How the modules are meant to be used

- **`@nuxtjs/color-mode`** exposes `useColorMode()`. `preference` is the writable user choice and may be `system`, `value` is the read-only resolved light or dark. Nuxt UI auto-registers the module. It injects its own inline pre-paint script and persists the preference under `nuxt-color-mode`. Reading the resolved value in a template while the preference is `system` causes a flash, so the resolution belongs in the pre-paint script, not the template.
- **`@nuxtjs/i18n`** persists the locale in the `i18n_redirected` cookie by default and reads it server-side to render the right language on first paint. The locale must be switched through `setLocale()` rather than assigned directly, because that call loads translations, fires hooks, and updates the cookie. To layer account persistence, read the account locale during SSR to set the initial value and write the account on change, letting the module keep its own cookie in sync.

Theming libraries do not ship database or account persistence. That is always layered on by the app, typically an initial value fed in from the server plus a save callback on change. So account persistence is a deliberate choice, not a library default.

## How our app does it, and why it is sound

- **Source of truth:** theme (`light_theme`, `dark_theme`) and `locale` live on the per-user `settings` row. This is what makes the preference follow the user across devices.
- **Delivery:** the three values ride in the `nuxt-auth-utils` session, which is itself an encrypted, server-readable cookie. So the SSR render already has the value through a cookie, which is why a separate theme cookie mirror was unnecessary and removing it was correct.
- **First paint:** the server renders `data-theme` and injects `data-light-theme` and `data-dark-theme` onto `<html>`. A synchronous inline script reads those plus `matchMedia` to resolve `system` before paint. The values come from the same SSR render, so they cannot go stale the way a separate cookie could.
- **Locale first paint:** the session locale is mirrored to `i18n_redirected` so `@nuxtjs/i18n` resolves the right language server-side. That is the module's own mechanism and stays.
- **On change:** the write updates the database, refreshes the session so the next render is not stale, and the client re-reads the session.

This is the "database is the source of truth, delivered through a server-readable channel, with an inline script only for `system`" architecture, which the research calls the cleanest of the common options.

## Things the research explicitly warned against

- The inline script does not guarantee zero flash in every edge case (forced themes, incognito), but it covers the normal path.
- Detecting `system` on the server through the `sec-ch-prefers-color-scheme` client hint is not a reliable default. It needs an `Accept-CH` round trip and cannot read an explicit override, so the inline script stays necessary. Chasing server-side `system` detection would be a dead end.

## Confidence and caveats

Each building block is backed by a primary source (Nuxt hydration and cookie docs, the color-mode and i18n docs, the `next-themes` and Next.js anti-flash docs). Real products confirm account-level storage: Linear, Notion, and Discord all store theme on the account and follow the user across devices. The verdict on our exact stack is a synthesis, since no single source documents this precise combination end to end, so it is stated at medium confidence, but every part checks out. The underlying mechanisms are stable web-platform behavior, so this is not time-sensitive.

## Sources

- Nuxt hydration best practices — https://nuxt.com/docs/4.x/guide/best-practices/hydration
- Nuxt `useCookie` — https://nuxt.com/docs/api/composables/use-cookie
- Nuxt Color Mode — https://color-mode.nuxtjs.org/usage/basic
- Nuxt UI color mode integration — https://ui.nuxt.com/docs/getting-started/integrations/color-mode/nuxt
- Nuxt i18n browser language detection — https://i18n.nuxtjs.org/docs/guide/browser-language-detection
- Nuxt i18n lang switcher — https://i18n.nuxtjs.org/docs/guide/lang-switcher
- Next.js preventing flash before hydration — https://nextjs.org/docs/app/guides/preventing-flash-before-hydration
- next-themes — https://github.com/pacocoursey/next-themes
- Flash of inaccurate color theme (CSS-Tricks) — https://css-tricks.com/flash-of-inaccurate-color-theme-fart/
- Linear preferences — https://linear.app/docs/account-preferences
- Notion account settings — https://www.notion.com/help/account-settings
