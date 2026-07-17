# Visual theme rework

## Intent

Bring the time-tracking app's visual identity in line with the reworked AGilbertDev portfolio conventions (`my-styling-conventions`, `my-frontend-conventions`). This is a visual-only pass: swap the icon set to Phosphor, add the signature glow utility and page radial (theme-derived), introduce oklch relative-color accents, centralize container padding, register an oversized CTA size, and enforce the round-media and fluid-section-padding rules where they apply. No server, DB, schema, auth-logic, or business-logic changes.

The app's 8-atmosphere theme system stays exactly as is. Every new accent and glow effect must be derived from the ACTIVE theme's `--ui-primary` (via oklch relative color) so it rethemes across all 8 atmospheres, never hardcoded to the portfolio's teal/cyan.

## Inputs

Not a runtime feature. The "inputs" are the conventions being applied:

1. Icons: Phosphor (`i-ph-*`) is the default set, replacing Carbon (`i-carbon-*`). Match icon weight to adjacent text (`-bold` next to bold/large text), scale icon with text, one weight family throughout. Simple Icons for brand marks only.
2. Signature glow: a `.btn-glow` utility in `main.css` (masked `conic-gradient` ring on `::before`, `@property --btn-angle` spinning ~7s, soft box-shadow, revealed on `:hover`, kept lit with `.glow-on`, spin gated behind `prefers-reduced-motion`, ring above content at `z-index: 1`), plus a faint page-level radial of the primary anchored top-right.
3. oklch relative-color accents derived from `--ui-primary` (`oklch(from var(--ui-primary) l c calc(h + 25))`, `calc(l * 1.1)`), not a hardcoded second hue.
4. Container/padding: one global `ui.container` in `app.config.ts` at scale `px-6 sm:px-6 lg:px-8`; fluid vertical section padding `py-[clamp(4rem,10vh,8rem)]`.
5. Oversized CTA: register a custom button size (`2xl`) in `app.config.ts`; scales down on mobile and stacks full width.
6. Round media: avatars/portraits sized by width (`aspect-square` + `w-full` in a width-bounded wrapper), never by height.
7. Buttons: primary action gets a bold trailing arrow `i-ph-arrow-right-bold`.

## Outputs and acceptance criteria

### Icons (app-wide swap)

- AC1. `grep -rn "i-carbon-" app/` returns zero results after the pass.
- AC2. Every swapped icon uses a Phosphor equivalent and sits in one weight family. Icons next to bold/large text use `-bold` variants. Proposed mapping (weight to be confirmed, see Open questions):

  | Carbon | Phosphor | Location |
  | --- | --- | --- |
  | `i-carbon-user` | `i-ph-user` | header.vue:59 |
  | `i-carbon-moon` / `i-carbon-sun` | `i-ph-moon` / `i-ph-sun` | header.vue:63, color-mode-toggle.vue:19 |
  | `i-carbon-language` | `i-ph-translate` | header.vue:70 |
  | `i-carbon-logout` | `i-ph-sign-out` | header.vue:74 |
  | `i-carbon-chevron-right` | `i-ph-caret-right` | header.vue:122 |
  | `i-carbon-checkmark` | `i-ph-check` | header.vue:123 |
  | `i-carbon-email` | `i-ph-envelope-simple` | signin.vue:57, signup.vue:56 |
  | `i-carbon-locked` | `i-ph-lock` | signin.vue:68 |

### Signature glow + page radial (theme-derived)

- AC3. A `.btn-glow` utility exists in `main.css` matching the convention (masked conic-gradient ring on `::before`, `@property --btn-angle`, ~7s spin, soft box-shadow, `:hover` reveal, `.glow-on` keeps it lit, `z-index: 1` above content).
- AC4. The ring and box-shadow colors are derived from `var(--ui-primary)` via oklch relative color (a hue-shifted cyan-ward stop and a lighter glint), so the glow tracks whichever of the 8 atmospheres is active in both light and dark. No hardcoded hex in the glow.
- AC5. The spin animation is disabled under `prefers-reduced-motion: reduce`; the static ring/glow may remain.
- AC6. A faint page-level radial of the primary (hue-shifted), anchored top-right, is present on at least the primary product surface (see Open questions for exact placement). It is fainter on dark canvases so it never muddies the darkest atmospheres. It is also derived from `--ui-primary`.
- AC7. The glow and radial are verified to look correct in all 8 atmospheres, light and dark (spot-check via the themes gallery page).

### oklch accents

- AC8. On-brand accents used anywhere in the visual pass are derived from `--ui-primary` with oklch relative color, not hardcoded. A retheme (switching atmosphere) shifts the accent automatically.
- AC9. The existing curated per-theme `accent` values in `useTheme.ts` and the themes gallery are left unchanged UNLESS the Open-questions decision says to migrate them (they are data for swatches/favicon, not chrome; default is to leave them).

### Container + section padding

- AC10. `app.config.ts` sets `ui.container` once to `px-6 sm:px-6 lg:px-8`; per-component `container` overrides that duplicate this scale are removed or reconciled (header currently sets its own `max-w-full px-4 sm:px-6 lg:px-8`).
- AC11. Stacked content sections use `py-[clamp(4rem,10vh,8rem)]` for vertical rhythm where a real sectioned surface exists.

### Oversized CTA

- AC12. A custom `2xl` button size is registered in `app.config.ts`, scales down on mobile (e.g. `text-base ... sm:text-xl`) and stacks full width so long bilingual labels never truncate.
- AC13. Where a primary hero/landing CTA exists, it uses the oversized size with a bold trailing arrow `i-ph-arrow-right-bold`. (No such CTA exists today, see Scope notes.)

### Round media

- AC14. Any round avatar/portrait is sized by width (`aspect-square` + `w-full` in a width-bounded wrapper), never by height. The header account button (`size-9 rounded-full`) is already width-driven and stays a perfect circle; confirm it still is after the pass.

### Portfolio-specific pattern decisions

- AC15. The spec records an explicit decision (below) on whether section composition, `SectionHeader`, `useSectionId`, and scroll reveal apply to this authenticated product. No scroll-reveal plugin or `SectionHeader` is added unless the decision says so.

## Portfolio-pattern applicability decision

These conventions were written for the single-page portfolio/landing site. This app is an authenticated time-tracking product with an empty `index.vue` placeholder and auth-flow pages (signin, signup, onboarding). Decision:

- Section composition under `components/home/`, one-`h1` hero, one-`h2`-per-section: DOES NOT APPLY now. There is no long marketing page. When a real dashboard/landing surface is built later it can adopt the pattern, but that is out of scope here.
- `SectionHeader` (mono `text-primary` kicker + `h2`): DEFER. Introduce only when a multi-section product page exists.
- `useSectionId` + locale-aware anchors: DOES NOT APPLY. No in-page anchor nav exists; navigation is route-based.
- Scroll reveal client plugin (`js` class, `[data-reveal]`, IntersectionObserver): DOES NOT APPLY. An authenticated tool does not benefit from marketing scroll choreography, and it adds a no-JS/hydration surface for no product value. Skip it.

Net: the visual pass adopts the atomic conventions (icons, glow, radial, oklch accents, container, oversized CTA, round media, fluid padding). It does NOT adopt the page-composition/scroll-reveal system.

## Per-file inventory

- `app/assets/css/main.css` — ADD: `@property --btn-angle`, the `.btn-glow` utility + `.glow-on` modifier (colors from `oklch(from var(--ui-primary) ...)`), the `prefers-reduced-motion` gate for the spin, and a page-level radial helper (a utility class or a background on the app shell) derived from `--ui-primary` and dimmed on `.dark`. NO change to the 8 `@theme static` ramps or the `[data-theme]` blocks. Autofill/border-lift blocks stay.
- `app/app.config.ts` — ADD: `ui.container` set to `px-6 sm:px-6 lg:px-8`; a `2xl` entry in `button.variants.size`. Existing default-size and slot overrides stay.
- `app/components/app/header.vue` — Swap 6 carbon icons (lines 59, 63, 70, 74, 122, 123) to Phosphor. Reconcile its inline `ui.container` (`max-w-full px-4 ...`) against the new global container (Open question on whether the header keeps `max-w-full`). Verify the round account button stays a perfect circle. NOTE: this file has a pre-existing uncommitted account-menu change; that is separate work (see Scope).
- `app/components/app/color-mode-toggle.vue` — Swap `i-carbon-moon`/`i-carbon-sun` (line 19) to Phosphor.
- `app/pages/signin.vue` — Swap `i-carbon-email` (57), `i-carbon-locked` (68). Optional: trailing arrow on the submit `UButton`, glow on the submit button. The dotted-radial background is a fixed decorative hex, acceptable to leave; may be reconciled with the new page radial.
- `app/pages/signup.vue` — Swap `i-carbon-email` (56). Same optional submit-button treatment as signin.
- `app/pages/onboarding.vue` — No carbon icons. Optional: submit-button glow/arrow to match signin/signup.
- `app/components/app/footer.vue` — No icons. Container reconciliation only if it duplicated the padding scale (it currently sets `py-3 sm:py-4`, vertical only, leave it).
- `app/components/app/logo.vue` — No change (inline SVG already theme-token driven).
- `app/components/app/locale-toggle.vue` — No change (no icon; text glyph flip).
- `app/composables/useTheme.ts` — No change by default. Only touched if the Open-questions decision migrates curated `accent` values to oklch (not recommended for this pass).
- `app/pages/index.vue` — Placeholder (`<div />`). No change unless a hero CTA is in scope (it is not).
- `app/pages/themes.vue`, `app/pages/themes-v2.vue` — Temporary gallery pages. Use them to verify the glow/radial across all 8 atmospheres. Optional: add a glow demo swatch. No structural change required.
- `app/layouts/default.vue`, `app/layouts/auth.vue` — Candidate host for the page-level radial background (Open question on placement). Otherwise no change.

## Edge cases

- Darkest atmospheres (onyx Obsidian, coffee Dark Roast, forest Pinewood, frost Glacier): the page radial must stay very low opacity on `.dark` so it does not muddy the near-black canvas. Verify per AC7.
- Low-chroma primaries (onyx's near-gray primary): an oklch `calc(h + 25)` hue shift on a near-gray produces almost no visible shift. The glow must still read as a subtle light ring rather than looking broken. Accept a subtle-to-invisible hue sweep on onyx; the box-shadow glow carries the effect there.
- `prefers-reduced-motion`: spin disabled; the ring and glow remain as a static accent. No layout shift between motion states.
- Autofill on inputs already paints a primary-tinted fill (`main.css`). Adding glow to an input wrapper must not fight the existing autofill box-shadow. Prefer glow on buttons, not inputs, unless verified.
- Bilingual labels: French strings run longer than English. The oversized CTA must wrap/stack full width (AC12) so no label truncates in either locale.
- Hydration: color-mode-dependent icons (moon/sun) already sit behind `<ClientOnly>` in color-mode-toggle. The header's moon/sun icon is inside a computed menu built client-side; confirm the Phosphor swap does not introduce an SSR/client name mismatch.

## Open questions

1. Icon weight family: pick one Phosphor weight for the whole app. Regular (`i-ph-*`) as the base with `-bold` next to bold/large text (per convention), or commit to `-bold` everywhere for a heavier feel? This sets the mapping in AC2.
2. Page radial placement: put it on the authenticated shell (`layouts/default.vue`, behind `UMain`), on the auth pages (signin/signup/onboarding), or both? The auth pages already have a dotted-radial decorative background; do we replace that with the new primary radial, layer them, or leave auth pages alone and scope the radial to the product shell only?
3. Curated per-theme `accent` values: keep the hand-picked accents in `useTheme.ts` (used for swatches and favicon) as-is, or migrate anything on-screen to oklch-derived accents? Recommendation: keep the curated data, use oklch only for the new glow/radial chrome. Confirm.
4. Glow reach: which buttons get `.btn-glow` on hover, and does anything get the permanent `.glow-on` (the portfolio uses it around the portrait)? Candidates: the auth submit buttons, and later a primary dashboard CTA. There is no portrait here, so is there any always-lit element?
5. Header container: the header currently sets `max-w-full px-4 sm:px-6 lg:px-8` (full-bleed, tighter mobile padding). Should it adopt the global `px-6 sm:px-6 lg:px-8` scale, keep `max-w-full`, or stay as an intentional exception?
6. Oversized CTA and trailing arrow: there is no hero/landing CTA in the app today (`index.vue` is empty). Register the `2xl` size now for future use only, or is a first product CTA in scope for this pass?

## Scope notes

- Out of scope: any backend, Nitro route, Drizzle/Turso schema, auth-logic, validation, or email change. This pass touches only CSS, `app.config.ts`, and the presentational layer of components/pages.
- The pre-existing uncommitted change in `app/components/app/header.vue` (account-menu work) is separate and NOT part of this rework. When implementing the icon swaps in header.vue, do not fold that change into this pass; keep it as its own commit.

## Design blueprint

Visual-only pass. Every accent is derived from the ACTIVE theme's `var(--ui-primary)` via oklch relative color, so all 8 atmospheres get their own on-brand glow and radial in both light and dark. No hardcoded teal/cyan, no raw hex in the new chrome.

Resolved decisions honored here: icons are Phosphor regular as the base with `-bold` only next to bold or large text; the page radial appears on the auth pages only and replaces the dotted-radial there; `.btn-glow` is a hover-only ring on primary CTAs and nothing is always-lit; a `2xl` button size is registered for future use with no new landing page.

### Layout regions

No new regions. The three surfaces touched are the authenticated shell (`layouts/default.vue`: `AppHeader` + `UMain` + `AppFooter`), the auth surface (`layouts/auth.vue`: a full-viewport centered card per page), and the temporary theme galleries (`themes.vue`, `themes-v2.vue`) used only to verify the glow and radial across all 8 atmospheres.

### Why `var(--ui-primary)` is the correct anchor

Nuxt UI resolves `--ui-primary` to `--ui-color-primary-500` in light and `--ui-color-primary-400` in dark. Because each `[data-theme]` block in `main.css` rewrites the primary ramp, `--ui-primary` is already the resolved active atmosphere's primary in the current color mode. Authoring the glow and radial against it means one definition rethemes across all 8 atmospheres with zero per-theme code.

### 1. `.btn-glow` / `.glow-on` — exact `main.css` authoring

Add this block to `main.css` (after the autofill rules, before or after the `[data-theme]` blocks; order does not matter since it targets `.btn-glow`, not the theme vars). Literal CSS to author:

```css
/* Signature glow. A slow conic-gradient ring masked to a thin border on ::before,
   plus a soft box-shadow, revealed on hover. All colors derived from the active
   theme's --ui-primary via oklch relative color, so every atmosphere gets its own
   on-brand sweep. The hue is nudged +25 toward cyan and lightened for the glint. */
@property --btn-angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}

.btn-glow {
  position: relative;
  isolation: isolate;
  /* Soft glow lives on the element itself, not on ::before: a mask clips box-shadow,
     so a shadow on the masked ring would never paint. Hidden until hover. */
  transition: box-shadow 0.3s ease;
}

.btn-glow::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1; /* above the button content so the ring shows over edge-to-edge media */
  border-radius: inherit;
  padding: 2px; /* ring thickness */
  background: conic-gradient(
    from var(--btn-angle),
    var(--ui-primary),
    oklch(from var(--ui-primary) l c calc(h + 25)),
    oklch(from var(--ui-primary) calc(l * 1.1) c calc(h + 25)),
    oklch(from var(--ui-primary) l c calc(h + 25)),
    var(--ui-primary)
  );
  /* Mask the fill down to just the padding ring. */
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
  animation: btn-glow-spin 7s linear infinite;
}

.btn-glow:hover,
.btn-glow.glow-on {
  box-shadow: 0 0 1.5rem
    oklch(from var(--ui-primary) calc(l * 1.1) c calc(h + 25) / 0.45);
}

.btn-glow:hover::before,
.btn-glow.glow-on::before {
  opacity: 1;
}

@keyframes btn-glow-spin {
  to {
    --btn-angle: 360deg;
  }
}

/* Spin is decorative. Keep the static ring and glow, drop the motion. */
@media (prefers-reduced-motion: reduce) {
  .btn-glow::before {
    animation: none;
  }
}
```

Notes for the frontend agent:
- `.glow-on` exists but is applied to nothing in this pass (no portrait). It is there so a future always-lit element can opt in.
- Onyx's near-gray primary produces almost no visible `+25` hue sweep. That is expected and accepted; the box-shadow carries the effect there. Do not special-case it.
- Do not put `.btn-glow` on inputs. The autofill rules already paint an inset primary-tinted box-shadow, and the two would fight.

### 2. Page radial — theme-derived, auth pages only

Add a `.page-radial` utility to `main.css`, anchored top-right, derived from the primary, fainter on `.dark`:

```css
/* Faint page-level radial of the primary (hue-shifted), anchored top-right.
   Auth surfaces only. Fainter on dark so it never muddies the darkest atmospheres. */
.page-radial {
  background-image: radial-gradient(
    120% 80% at 100% 0%,
    oklch(from var(--ui-primary) calc(l * 1.1) c calc(h + 25) / 0.14),
    transparent 60%
  );
}

.dark .page-radial {
  background-image: radial-gradient(
    120% 80% at 100% 0%,
    oklch(from var(--ui-primary) calc(l * 1.1) c calc(h + 25) / 0.07),
    transparent 55%
  );
}
```

Markup change: on each of the three auth page root `div`s (`signin.vue` L40, `signup.vue` L34, `onboarding.vue` L49), replace the dotted-radial utilities `bg-[radial-gradient(circle_at_center,rgba(17,24,39,0.035)_1px,transparent_1px)] bg-size-[22px_22px]` with the single class `page-radial`. Keep everything else on those divs unchanged: `bg-muted` stays as the base fill (a `background-color`, so it composes under the radial `background-image`), and `min-h-dvh flex items-center justify-center p-4 sm:p-6` stays. This preserves the single-viewport centering while swapping the decorative dot grid for the theme-derived radial.

Do NOT add the radial to `layouts/default.vue`. The authenticated product shell keeps its flat `bg-muted` / dark neutral-950 canvas (decision #2).

### 3. `app.config.ts` changes

Three additions inside the existing `ui: { ... }` object. Do not remove existing keys.

- Global container padding (satisfies AC10). Override the container `base` and keep Nuxt UI's own `mx-auto w-full max-w-(--ui-container)` so only the padding scale changes:

  ```ts
  container: {
    base: 'mx-auto w-full max-w-(--ui-container) px-6 sm:px-6 lg:px-8'
  }
  ```

- Register the `2xl` button size alongside the existing `md` entry. Scales down on mobile, larger from `sm:`. Pair with `block` at the call site so it stacks full width and long bilingual labels never truncate (AC12):

  ```ts
  button: {
    variants: {
      size: {
        md: { base: 'text-md' },
        '2xl': {
          base: 'text-base px-5 py-3 gap-2 sm:text-xl sm:px-7 sm:py-4',
          leadingIcon: 'size-5 sm:size-6',
          trailingIcon: 'size-5 sm:size-6'
        }
      }
    },
    defaultVariants: { size: 'md' }
  }
  ```

- Trailing-arrow convention (documented, applied at call sites, not in config): primary-action `UButton`s take `trailing-icon="i-ph-arrow-right-bold"`. This `-bold` glyph is the one sanctioned bold-weight icon in the app because it sits on a large solid CTA.

No `ui.icons` default-set change is needed; icons are named per usage.

### 4. Icon mapping table (`i-carbon-*` → `i-ph-*`)

`grep -rn "i-carbon-" app/` returns exactly the rows below (AC1 target: zero after the pass). One weight family: Phosphor regular everywhere. `-bold` is used only for the CTA trailing arrow, which sits on large solid buttons.

| Current | Phosphor | Weight | Why | Location |
| --- | --- | --- | --- | --- |
| `i-carbon-user` | `i-ph-user` | regular | menu row, `size-5` next to md label | header.vue:59 |
| `i-carbon-moon` | `i-ph-moon` | regular | menu row, `size-5` next to md label | header.vue:63 |
| `i-carbon-sun` | `i-ph-sun` | regular | menu row, `size-5` next to md label | header.vue:63 |
| `i-carbon-language` | `i-ph-translate` | regular | menu row, `size-5` next to md label | header.vue:70 |
| `i-carbon-logout` | `i-ph-sign-out` | regular | menu row, `size-5` next to md label | header.vue:74 |
| `i-carbon-chevron-right` | `i-ph-caret-right` | regular | `size-4` submenu indicator, dimmed | header.vue:122 |
| `i-carbon-checkmark` | `i-ph-check` | regular | `size-4` active mark | header.vue:123 |
| `i-carbon-moon` | `i-ph-moon` | regular | ghost icon button, standalone | color-mode-toggle.vue:19 |
| `i-carbon-sun` | `i-ph-sun` | regular | ghost icon button, standalone | color-mode-toggle.vue:19 |
| `i-carbon-email` | `i-ph-envelope-simple` | regular | input leading icon | signin.vue:57, signup.vue:56 |
| `i-carbon-locked` | `i-ph-lock` | regular | input leading icon | signin.vue:68 |

New `-bold` glyph introduced by this pass: `i-ph-arrow-right-bold` as the trailing icon on the auth submit CTAs (see §CTA below). It is the only bold-weight icon.

Hydration: the header moon/sun name is computed but only rendered inside `UDropdownMenu` content, which mounts on open (client), so the Phosphor swap introduces no SSR/client mismatch. `color-mode-toggle.vue` already sits behind `<ClientOnly>` with a `size-8` fallback; keep that.

### 5. Fluid section padding

`py-[clamp(4rem,10vh,8rem)]` applies to stacked content sections. No such sectioned surface exists today: the auth pages are a single centered card and `index.vue` is an empty placeholder. So this pass does NOT add the clamp to any current file (AC11 is vacuously satisfied). The auth pages keep the existing single-viewport centering pattern (`min-h-dvh flex items-center justify-center`), which is the correct expression of the fluid, fit-one-viewport convention for a centered card. Reserve `py-[clamp(4rem,10vh,8rem)]` for the first real dashboard/content section when it is built.

### 6. Round-media rule

No round avatar or portrait image exists in the app. The header account button is text initials on `grid size-9 ... rounded-full` (header.vue:94), already sized by width via `size-9` (sets width and height equally), so it stays a perfect circle after the pass — confirm no height-only utility creeps in (AC14). The auth/gallery logos (`AppLogo`, `themes*.vue` `<img src="/logo.svg">`) are height-driven (`h-10`, `h-12`) but they are inline SVG/logo marks, not round media, so the width-driven rule does not apply to them. There is no portrait, so nothing takes `.glow-on`. If a user avatar image is added later, wrap it width-bounded with `aspect-square w-full`, never `h-* w-auto`.

### 7. Component-by-component checklist

- **`app/assets/css/main.css`** — ADD the `@property --btn-angle` + `.btn-glow`/`.glow-on` block (§1), the `btn-glow-spin` keyframes, the `prefers-reduced-motion` gate, and the `.page-radial` + `.dark .page-radial` utility (§2). Do NOT touch the `@theme static` ramps, the `[data-theme]` blocks, the `.dark` border lift, or the autofill rules.
- **`app/app.config.ts`** — ADD `container.base`, the `2xl` button size, keep every existing key (§3).
- **`app/components/app/header.vue`** — Swap the 6 carbon icons at L59, L63, L70, L74, L122, L123 per the table. Reconcile the inline container: change `max-w-full px-4 sm:px-6 lg:px-8` to `max-w-full px-6 sm:px-6 lg:px-8` so the padding scale matches the new global while the header stays full-bleed (recommended answer to open question 5). Confirm the `size-9 rounded-full` account button is untouched. Do NOT fold in the separate uncommitted account-menu change.
- **`app/components/app/color-mode-toggle.vue`** — Swap `i-carbon-moon`/`i-carbon-sun` (L19) to `i-ph-moon`/`i-ph-sun`. Keep `<ClientOnly>` and the `size-8` fallback.
- **`app/components/app/footer.vue`** — No change. `py-3 sm:py-4` is vertical-only and intentional; it does not duplicate the horizontal container scale.
- **`app/components/app/logo.vue`** — No change. Inline SVG already driven by `var(--ui-text)` / `var(--ui-primary)`.
- **`app/components/app/locale-toggle.vue`** — No change. Text-glyph flip, no icon, motion already gated behind `prefers-reduced-motion`.
- **`app/pages/signin.vue`** — Swap `i-carbon-email` (L57) → `i-ph-envelope-simple`, `i-carbon-locked` (L68) → `i-ph-lock`. Replace the dotted-radial bg utilities on the root div (L40) with `page-radial` (keep `bg-muted` and the centering). Add `class="btn-glow"` and `trailing-icon="i-ph-arrow-right-bold"` to the submit `UButton` (the primary CTA).
- **`app/pages/signup.vue`** — Swap `i-carbon-email` (L56) → `i-ph-envelope-simple`. Replace dotted-radial bg on root div (L34) with `page-radial`. Add `btn-glow` + `i-ph-arrow-right-bold` to the submit `UButton`.
- **`app/pages/onboarding.vue`** — No carbon icons. Replace dotted-radial bg on root div (L49) with `page-radial`. Add `btn-glow` + `i-ph-arrow-right-bold` to the submit `UButton` to match signin/signup.
- **`app/pages/themes.vue`, `app/pages/themes-v2.vue`** — No structural change and no carbon icons. Use them to verify AC7: cycle all 8 atmospheres in light and dark, confirm the glow ring and page radial reface correctly (especially the 4 darkest dark themes and onyx's near-gray). Optional: drop one `.btn-glow` demo `UButton` in the gallery to eyeball the sweep. Remove any demo before shipping.
- **`app/composables/useTheme.ts`** — No change. Curated per-theme `accent` values stay as swatch/favicon data (open question 3, recommended answer: keep). The oklch derivation is only for the new glow/radial chrome.
- **`app/layouts/default.vue`, `app/layouts/auth.vue`** — No change. The radial lives on the auth pages' own root divs, not the layouts, so the product shell stays flat.

### Motion

Only the 7s ring spin is added, and it is gated behind `@media (prefers-reduced-motion: reduce)` (spin off, static ring and glow remain, no layout shift). The `.btn-glow` hover opacity/box-shadow transitions are short and purposeful. The existing locale-toggle flip is already gated and unchanged.

### Responsive behaviour

- Container padding is flat `px-6` through `sm:`, stepping to `lg:px-8` (a touch more on mobile, per the convention).
- The `2xl` CTA renders `text-base px-5 py-3` on mobile and `sm:text-xl sm:px-7 sm:py-4` from `sm:`, and is expected to be used with `block` so it stacks full width and never truncates a long French label.
- Auth cards stay `max-w-sm`, centered, single-viewport at every breakpoint.
- The page radial is anchored to the viewport top-right at all sizes; its `120% 80%` extent keeps it soft on both narrow and wide screens.
