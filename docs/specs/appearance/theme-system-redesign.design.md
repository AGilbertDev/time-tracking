# Design: Theme system redesign

Design-stage output for [`theme-system-redesign.md`](./theme-system-redesign.md). This is the
authoritative source for the five expanded ramps (Job 1), the WCAG 2.2 AA validation tables, and the
UI-upgrade component decisions (Job 2). Frontend and backend stages implement the hex values and class
decisions here verbatim. No app source was changed by this stage.

**Refined-palette revision (2026-07-19, owner-approved).** Each theme now carries a distinct **primary**
and a distinct **accent** ("agencement", chosen by a colour-harmony scheme), where the earlier version had
only a primary. This revision (a) rebuilds **café's primary** — it shifts darker from caramel to **espresso**
(`#7a4a24` light / `#c98a4f` dark), and the former caramel becomes café's **accent**; (b) adds a full
**accent ramp per theme**, wired to Nuxt UI's `secondary` alias (see the "Accent token" subsection); and
(c) keeps every other primary and every neutral ramp exactly as the earlier version validated them. The
pastel light-primary AA fix (`#159a82` → `#00866f`) is retained. Nothing in the glow/radial chrome changes:
the glow ring and page effects still derive from `primary`, never the accent.

All ramps and ratios below were computed in OKLCH / sRGB and WCAG relative-luminance math, not eyeballed.
The script lives only in the scratchpad; the numbers are reproduced here so the accessibility stage can
re-verify against them rather than recomputing blind.

## Mechanism confirmation (load-bearing for frontend/backend)

Read from `node_modules/@nuxt/ui/dist/runtime/index.css` and the shipped `main.css`. These are the exact
token reads Nuxt UI v4 performs, and they decide which ramp step each anchor must land on.

**Primary token.** `--ui-primary` = `--ui-color-primary-500` in light, `--ui-color-primary-400` in dark.
So each theme's **light** primary anchor is ramp step **500** and its **dark** primary anchor is step
**400**. One shared primary ramp per theme ID serves both modes (Nuxt UI just reads a different step).
`app.config.ts` keeps `ui.colors.primary: 'brand'`; the `:root` / `[data-theme]` blocks redefine
`--ui-color-primary-*` directly and win, so no `app.config` change is needed.

**Solid button label.** A solid `UButton color="primary"` renders `bg-primary text-inverted`. `--ui-text-inverted`
is `#fff` in light and `--ui-color-neutral-900` in dark. So the critical label case is **white on
primary-500 in light mode** (dark mode puts the near-black neutral-900 on the lighter primary-400, which is
never tight).

**Accent (secondary) token.** The accent is wired as a full `--ui-color-secondary-50…950` ramp per theme
block, so Nuxt UI's built-in `secondary` alias consumes it with **zero `app.config` change** — the same
mechanism as primary. `--ui-secondary` resolves to `--ui-color-secondary-500` in light and
`--ui-color-secondary-400` in dark. Every accent *text* role (links, `text-secondary` on subtle
chips/badges, soft buttons) and every accent *label* role (white `text-inverted` on a solid
`color="secondary"` fill in light; near-black neutral-900 label in dark) therefore reads step **500 in
light / 400 in dark**. That is why each theme's accent ramp is tuned so **secondary-500 clears 4.5:1 as
text/label on the light canvas** (the darker of the two light backgrounds, so it also clears on the white
surface) and **secondary-400 clears 4.5:1 as text/label on the dark surface**.
Purely graphical accent touches (a chip tint, an active-state underline) sit at low alpha over the surface
and only need 3:1, which the same steps clear. Full wiring and the exact component roles are in the "Accent
token" subsection under Job 1.

**Neutral token map** (which neutral step each semantic reads):

| Semantic | Light reads | Dark reads |
| --- | --- | --- |
| `--ui-bg` (surface) | `#fff` (fixed) | neutral-900 |
| `--ui-bg-muted` (canvas) | neutral-50 | neutral-800 |
| `--ui-bg-elevated` | neutral-100 | neutral-800 |
| `--ui-bg-accented` | neutral-200 | neutral-700 |
| `--ui-border` (default) | neutral-200 | neutral-800 → **lifted to neutral-600** by the shipped `.dark` block |
| `--ui-border-muted` | neutral-200 | neutral-700 |
| `--ui-border-accented` (inputs) | neutral-300 | neutral-700 |
| `--ui-text-dimmed` | neutral-400 | neutral-500 |
| `--ui-text-muted` | neutral-500 | neutral-400 |
| `--ui-text` (body) | neutral-700 | neutral-200 |
| `--ui-text-highlighted` | neutral-900 | `#fff` |

This is why the anchors map onto the single shared neutral ramp as: light canvas → n50, light border →
n200, light muted → n500, light body text → n700; dark canvas → n900, dark surface → n800, dark muted →
n400, dark border → n600 (the lift target), dark body text → n200.

---

## Job 1 — Expanded ramps and AA validation

### Result summary

- **All five themes pass WCAG 2.2 AA in both modes** for body text, muted text, primary fill + its button
  label, and the accent in every role it is used (accent text/fill on surface and canvas, and the label on
  a solid accent fill). The per-theme tables in 1b list every ratio.
- **Café's primary was rebuilt to espresso** (`#7a4a24` light / `#c98a4f` dark) per the owner-approved
  refined palette. Its white button label reads **7.41:1** in light and the near-black label reads
  **6.45:1** in dark — both clear 4.5 comfortably (espresso is darker than the old caramel, so the label
  case only got easier). The former caramel is now café's **accent**. Every other primary ramp and all five
  neutral ramps are unchanged from the earlier version.
- **Pastel (teal seafoam) light primary keeps its earlier AA adjustment.** The white `text-inverted` label
  on the solid primary-500 fill was only **3.51:1** at the seafoam anchor `#159a82`; minimal on-hue
  darkening to **`#159a82` → `#00866f` (4.53:1)** clears it while keeping a uniform white label across all
  five themes and zero component override. Dark mode keeps the full-brightness seafoam `#34c3a3`. Retained
  verbatim; details in 1c.
- **Three accent anchors needed a minimal on-hue AA adjustment; two did not.** The light accent anchors for
  **pastel, encre, and café** were too light to double as `text-secondary`/solid-label on a light background,
  so each was darkened on-hue to land its secondary-500 step at ≥4.5:1 on the canvas (pastel `#9a7fd6 →
  #7e62b7`, encre `#0e97a0 → #007d86`, café `#cf9b52 → #976614`). **Automne** (`#a5342b`) and **forêt** (`#9c4368`) already
  cleared 4.5:1 and sit at secondary-500 unchanged. One dark accent, **automne** `#d1584a`, missed
  text-on-surface by a hair (4.21) and was brightened on-hue to `#d85e50` (4.56). All recorded in 1c.
- Default and accented **borders sit below 3:1 by design**. They are decorative separators / soft input
  rings, exempt from WCAG 1.4.11. Numbers and the one accessibility-stage flag are in the border section.
- The oklch **glint derivation with the shipped `+25` offset still matches each target closely.** Café's
  primary-hue is essentially unchanged by the espresso shift (57° vs the old caramel's 58°), so its glint
  behaviour is the same family as before; the only visible change is that café's light-mode glint is now
  deeper because the primary it derives from is deeper. No theme needs a per-theme `--glint-hue`. See 1e.

### 1a. Ramps (implement verbatim in `main.css`)

Each theme is one `--ui-color-primary-50…950` ramp, one `--ui-color-secondary-50…950` (accent) ramp, and
one `--ui-color-neutral-50…950` ramp, all shared across light and dark. `pastel` is the `:root` default;
the other four are `[data-theme="<id>"]` blocks. The `--color-<id>-*` `@theme static` surface scale for each
theme equals that theme's neutral ramp. The `secondary` ramp is new in this revision; see the "Accent token"
subsection for how it is wired and used.

**pastel** — teal seafoam primary + lilac accent (default → `:root`). `primary-500` is the AA-adjusted
`#00866f` (seafoam anchor `#159a82` darkened on-hue for the white-label bar; see 1c); `primary-400` is the
seafoam anchor `#34c3a3`. `secondary-500` is the AA-adjusted `#7e62b7` (lilac anchor `#9a7fd6` darkened for
text/label; see 1c); `secondary-400` is the lilac dark anchor `#b9a0ea`.
```
primary    50 #e5fcf5  100 #cdf5e9  200 #ace8d7  300 #7bd8c0  400 #34c3a3  500 #00866f
           600 #00725c  700 #005d4a  800 #004c3c  900 #003f31  950 #00291e
secondary  50 #f7ebff  100 #ecdeff  200 #ddccff  300 #c9b4f5  400 #b9a0ea  500 #7e62b7
           600 #6b4fa2  700 #563889  800 #432473  900 #321a58  950 #250948
neutral    50 #f1faf6  100 #e1f1eb  200 #d0e8e0  300 #afccc3  400 #8fb0a7  500 #55736b
           600 #26403a  700 #12312b  800 #172b26  900 #10201c  950 #091915
```

**encre** — ink-blue primary + sarcelle (teal) accent. `secondary-500` is the AA-adjusted `#007d86` (teal
anchor `#0e97a0` darkened for text/label; see 1c); `secondary-400` is the teal dark anchor `#2fc7cd`.
```
primary    50 #e8f7ff  100 #d2ecff  200 #b6daff  300 #87bbff  400 #5b9be8  500 #2a5cb8
           600 #1b4ba2  700 #0f3b89  800 #092e72  900 #06265f  950 #021640
secondary  50 #c6ffff  100 #b1f5f8  200 #92e8eb  300 #66d6db  400 #2fc7cd  500 #007d86
           600 #006a73  700 #00535c  800 #004049  900 #002f36  950 #002027
neutral    50 #f5f7fb  100 #e7ebf4  200 #d8e0ec  300 #b5c1d4  400 #93a2bc  500 #5a6b85
           600 #26344f  700 #14203a  800 #14203a  900 #0d1626  950 #070f1f
```

**cafe** — **espresso primary (changed)** + caramel accent. The primary shifts darker from the old caramel
to espresso: `primary-500 = #7a4a24`, `primary-400 = #c98a4f` (both owner-approved anchors). The former
caramel is now the accent: `secondary-500` is the AA-adjusted `#976614` (caramel anchor `#cf9b52` darkened
for text/label; see 1c); `secondary-400` is the caramel dark anchor `#e6c07e`.
```
primary    50 #ffeace  100 #ffdab9  200 #f0c29a  300 #dba472  400 #c98a4f  500 #7a4a24
           600 #683a12  700 #542700  800 #411600  900 #2f0d00  950 #210200
secondary  50 #fff1d2  100 #ffe9c4  200 #f7ddb0  300 #eecd95  400 #e6c07e  500 #976614
           600 #835300  700 #6c3d00  800 #572a00  900 #411e00  950 #310f00
neutral    50 #faf5ee  100 #f0e8dc  200 #e7dbcb  300 #cdbba8  400 #b39c86  500 #6e5a48
           600 #322619  700 #2a1d12  800 #221a12  900 #17110c  950 #100b06
```

**automne** — burnt-orange primary + maple-red accent. `secondary-500` is the maple-red light anchor
`#a5342b`, kept unchanged (already clears 4.5 as text); `secondary-400` is the maple dark anchor brightened
on-hue to `#d85e50` (anchor `#d1584a` missed dark text-on-surface by a hair; see 1c).
```
primary    50 #ffefe3  100 #ffddc9  200 #ffc5a7  300 #ff9a6e  400 #e2703a  500 #c0531f
           600 #a73f03  700 #8c2e00  800 #742300  900 #611c00  950 #410f00
secondary  50 #ffded4  100 #ffc9bd  200 #ffaa9d  300 #ed8273  400 #d85e50  500 #a5342b
           600 #8f1e18  700 #750000  800 #5e0000  900 #440000  950 #320000
neutral    50 #fbf2ea  100 #f3e4d8  200 #ecd6c6  300 #d6b7a2  400 #c09880  500 #7a5040
           600 #38220f  700 #34160c  800 #281911  900 #1b1109  950 #140a04
```

**foret** — pine-green primary + plum/heather accent. `secondary-500` is the plum light anchor `#9c4368`,
kept unchanged (already clears 4.5 as text); `secondary-400` is the plum dark anchor `#cd7396`.
```
primary    50 #e8fbef  100 #d2f4df  200 #b5e7c9  300 #7ecba0  400 #3da76c  500 #1f7a50
           600 #046740  700 #005531  800 #004527  900 #00381f  950 #002411
secondary  50 #ffe8f7  100 #ffdaec  200 #ffc5da  300 #eea6bf  400 #cd7396  500 #9c4368
           600 #842d53  700 #6a133e  800 #54002c  900 #3d001d  950 #2a000e
neutral    50 #f0f6f1  100 #e2ece4  200 #d3e3d7  300 #b3c7b9  400 #93ac9c  500 #4e6656
           600 #24382b  700 #12241a  800 #16261b  900 #0e1a12  950 #08130c
```

Construction notes:
- Primary: step 500 = the light anchor, step 400 = the dark anchor. Steps 50–300 are lightness-lifted tints
  toward white with tapering chroma; steps 600–950 darken from the 500 anchor on the same hue. Café's
  primary is the only one rebuilt this revision (caramel → espresso); the other four are unchanged. Every
  ramp is monotonic in OKLCH lightness (verified), so hover/active states never invert.
- Secondary (accent): same construction as primary — step 500 = the light accent (AA-tuned for text/label
  on the light surface), step 400 = the dark accent (AA-tuned for text/label on the dark surface), tints
  above 400 and deepened steps below 500, all on the accent hue and monotonic in OKLCH lightness (verified).
  Because 500 is text-legible, the original *bright* light-accent tone for pastel/encre/café lives near step
  400/450 rather than at 500; graphical accent fills that want the brightest tint reference secondary-400.
- Neutral: unchanged from the earlier version. The eight semantic-bearing steps are pinned to the anchors
  (50, 200, 400, 500, 600, 700, 800, 900); 100 and 300 are oklch midpoints; 950 is a hair below 900.
- **Two intentional flat spots, both harmless:** `encre` n700 = n800 = `#14203a`, and `foret` n700
  (`#12241a`) is a hair darker than n800 (`#16261b`), because each theme's light-body-text anchor and
  dark-surface anchor share lightness. Nothing depends on the ordering between them: light body text (n700)
  reads at >15:1, and the *visible* dark-mode default border is n600 (the lift target), not n700. Leave as
  listed.

### 1b. WCAG 2.2 AA tables

Ratios are the actual computed contrast for the anchor/ramp values above. "Target" is the applicable bar.
Every row passes.

**pastel** (teal seafoam; light primary = adjusted `#00866f`, dark primary = `#34c3a3`)
| Check | Light | Dark | Target |
| --- | --- | --- | --- |
| Body text (n700 L / n200 D) on canvas | 13.16 | 13.09 | 4.5 |
| Body text on surface | 14.00 | 11.56 | 4.5 |
| Muted (n500 L / n400 D) on canvas | 4.87 | 7.18 | 4.5 |
| Muted on surface | 5.18 | 6.34 | 4.5 |
| Primary fill on surface (500 L / 400 D) | 4.53 | 6.72 | 3.0 |
| Primary fill on canvas | 4.26 | 7.61 | 3.0 |
| **Button label on primary** (white L / n900 D) | **4.53** | 7.61 | 4.5 |
| Accent text/fill on surface (sec 500 L / 400 D) | 4.86 | 6.58 | 4.5 |
| Accent text/fill on canvas | 4.57 | 7.45 | 4.5 |
| **Label on accent fill** (white L / n900 D) | **4.86** | 7.45 | 4.5 |

**encre**
| Check | Light | Dark | Target |
| --- | --- | --- | --- |
| Body text on canvas | 15.09 | 13.62 | 4.5 |
| Body text on surface | 16.19 | 12.17 | 4.5 |
| Muted on canvas | 5.05 | 7.01 | 4.5 |
| Muted on surface | 5.42 | 6.27 | 4.5 |
| Primary fill on surface | 6.32 | 5.63 | 3.0 |
| Primary fill on canvas | 5.89 | 6.29 | 3.0 |
| **Button label on primary** | **6.32** | 6.29 | 4.5 |
| Accent text/fill on surface (sec 500 L / 400 D) | 4.91 | 7.84 | 4.5 |
| Accent text/fill on canvas | 4.58 | 8.77 | 4.5 |
| **Label on accent fill** (white L / n900 D) | **4.91** | 8.77 | 4.5 |

**cafe** (primary rebuilt to espresso: light `#7a4a24`, dark `#c98a4f`; accent = caramel)
| Check | Light | Dark | Target |
| --- | --- | --- | --- |
| Body text on canvas | 15.09 | 13.72 | 4.5 |
| Body text on surface | 16.12 | 12.57 | 4.5 |
| Muted on canvas | 6.01 | 7.15 | 4.5 |
| Muted on surface | 6.43 | 6.55 | 4.5 |
| Primary fill on surface | 7.30 | 5.91 | 3.0 |
| Primary fill on canvas | 6.84 | 6.45 | 3.0 |
| **Button label on primary** | **7.41** | 6.45 | 4.5 |
| Accent text/fill on surface (sec 500 L / 400 D) | 4.89 | 9.97 | 4.5 |
| Accent text/fill on canvas | 4.58 | 10.88 | 4.5 |
| **Label on accent fill** (white L / n900 D) | **4.97** | 10.88 | 4.5 |

**automne**
| Check | Light | Dark | Target |
| --- | --- | --- | --- |
| Body text on canvas | 15.00 | 13.27 | 4.5 |
| Body text on surface | 15.99 | 12.12 | 4.5 |
| Muted on canvas | 6.23 | 7.11 | 4.5 |
| Muted on surface | 6.64 | 6.50 | 4.5 |
| Primary fill on surface | 4.50 | 5.34 | 3.0 |
| Primary fill on canvas | 4.22 | 5.85 | 3.0 |
| **Button label on primary** | **4.67** | 5.85 | 4.5 |
| Accent text/fill on surface (sec 500 L / 400 D) | 6.48 | 4.56 | 4.5 |
| Accent text/fill on canvas | 6.08 | 4.99 | 4.5 |
| **Label on accent fill** (white L / n900 D) | **6.72** | 4.99 | 4.5 |

**foret**
| Check | Light | Dark | Target |
| --- | --- | --- | --- |
| Body text on canvas | 14.82 | 13.39 | 4.5 |
| Body text on surface | 15.85 | 11.86 | 4.5 |
| Muted on canvas | 5.70 | 7.34 | 4.5 |
| Muted on surface | 6.10 | 6.50 | 4.5 |
| Primary fill on surface | 5.18 | 5.23 | 3.0 |
| Primary fill on canvas | 4.84 | 5.91 | 3.0 |
| **Button label on primary** | **5.31** | 5.91 | 4.5 |
| Accent text/fill on surface (sec 500 L / 400 D) | 6.00 | 4.89 | 4.5 |
| Accent text/fill on canvas | 5.61 | 5.52 | 4.5 |
| **Label on accent fill** (white L / n900 D) | **6.15** | 5.52 | 4.5 |

### 1c. Adjustments

**Summary of every change from the owner-approved anchors.** Primaries: café rebuilt to espresso (a palette
decision, not an AA fix), pastel light-500 kept darkened for AA. Accents: three light anchors darkened and
one dark anchor brightened, all on-hue and minimal, so each `secondary` step clears the 4.5 bar in the role
it carries. Full list:

| Token | Anchor | Applied | Reason | Before → After |
| --- | --- | --- | --- | --- |
| pastel primary-500 (light) | `#159a82` | `#00866f` | white label 3.51 < 4.5 | 3.51 → **4.53** |
| café primary-500 (light) | `#7a4a24` | `#7a4a24` | none — new espresso anchor, passes as-is | 7.41 |
| café primary-400 (dark) | `#c98a4f` | `#c98a4f` | none — new espresso anchor, passes as-is | 6.45 |
| pastel secondary-500 (light) | `#9a7fd6` | `#7e62b7` | accent text on canvas 3.09 < 4.5 | 3.09 → **4.57** |
| encre secondary-500 (light) | `#0e97a0` | `#007d86` | accent text on canvas 3.29 < 4.5 | 3.29 → **4.58** |
| café secondary-500 (light) | `#cf9b52` | `#976614` | accent text on canvas 2.29 < 4.5 | 2.29 → **4.58** |
| automne secondary-500 (light) | `#a5342b` | `#a5342b` | none — passes as-is | 6.48 |
| automne secondary-400 (dark) | `#d1584a` | `#d85e50` | accent text on n800 surface 4.21 < 4.5 | 4.21 → **4.56** |
| forêt secondary-500 (light) | `#9c4368` | `#9c4368` | none — passes as-is | 6.00 |

Every other primary anchor, every dark accent anchor not listed, and all five neutral ramps are unchanged.
Recorded design notes:

- **Café primary → espresso (palette change, not an AA fix).** The owner moved café's primary darker from
  the old caramel (`#a9611f` / `#d08a45`) to espresso (`#7a4a24` / `#c98a4f`) and promoted the caramel to
  the accent. The whole café primary ramp is therefore rebuilt on the espresso hue; because espresso is
  darker than caramel, the white/near-black label cases got *easier* (7.41 light, 6.45 dark), so no AA
  adjustment of the espresso anchors was needed. The old caramel now lives in café's `secondary` ramp.
- **Three light accent anchors darkened for text/label legibility.** The accent doubles as `text-secondary`
  (links, subtle chips, soft buttons) and as the label backdrop for a solid `color="secondary"` button, both
  of which read step 500 in light. These were tuned against the **canvas** (`bg-muted`), which is a hair
  darker than the white surface, so accent text clears 4.5 on *either* light background. The bright anchors
  for pastel (`#9a7fd6`), encre (`#0e97a0`), and café (`#cf9b52`) measured 3.09 / 3.29 / 2.29 on the canvas —
  below 4.5 — so each was darkened on-hue to `#7e62b7` / `#007d86` / `#976614` (canvas 4.57 / 4.58 / 4.58; on
  the white surface 4.86 / 4.91 / 4.89). This is the same discipline as the pastel primary fix and needs zero
  Nuxt UI override. Automne (`#a5342b`, canvas 6.08) and forêt (`#9c4368`, canvas 5.61) were already dark
  enough and sit at secondary-500 unchanged. The brightest tone of each darkened accent is preserved at
  secondary-400 for dark mode and for graphical light-mode fills.
- **One dark accent brightened.** Automne's dark accent `#d1584a` read only 4.21 as `text-secondary` on the
  dark surface (n800 `#281911`); brightening on-hue to `#d85e50` clears it at 4.56. All four other dark
  accents were bright enough on their dark surfaces (6.58–9.97) and are unchanged.
- **Pastel white label — kept from the earlier version.** White
  `text-inverted` on the solid primary-500 fill measured **3.51:1** at `#159a82`, below the 4.5 bar. The
  minimal on-hue darkening that clears it is **`#159a82` → `#00866f`** (white label **3.51 → 4.53:1**,
  primary-on-surface 3.51 → 4.53:1). This is the applied value in the pastel ramp above. Rationale for
  darkening the fill rather than changing the label: it keeps a **uniform white label across all five
  themes** and needs **zero Nuxt UI button override**, and it is the same fix that would apply to any theme
  failing this bar. Only the light-mode primary deepens (seafoam → a slightly deeper teal); dark mode is
  untouched (`primary-400 = #34c3a3`, the full-brightness seafoam), so the theme still reads seafoam overall.
  - **Alternative, if preserving the exact `#159a82` seafoam brightness in light matters more than white-label
    uniformity:** keep `primary-500 = #159a82` and override the solid-primary button label to a dark teal-tinted
    tone (the `onPrimary()` idiom), e.g. a near-black `#04211c`, which clears 4.5:1 easily on `#159a82`. Cost:
    a per-theme button label override and a label color that differs from the other four themes. Not recommended,
    but available as an owner call.
- **automne primary-on-surface in light is exactly 4.50:1** against the 3.0 bar (huge margin) and the label
  is 4.67:1 — both clear comfortably; noted only so the accessibility stage does not read `4.50` as a fail.

### 1c-bis. Accent token — wiring and component roles

**Chosen token: `--ui-color-secondary-50…950`, consumed by Nuxt UI's built-in `secondary` alias.** Each
theme block redefines the `secondary` ramp exactly like it redefines `primary`, so `--ui-secondary`
resolves to `secondary-500` in light and `secondary-400` in dark with **no `app.config.ts` change** (the
`secondary` alias already ships; the `:root` / `[data-theme]` var overrides win). A custom `--app-accent-*`
set was considered and rejected: it would duplicate the ramp machinery, would not get the built-in
`color="secondary"` variants (`solid` / `soft` / `subtle` / `outline` / `ghost`) for free, and would need a
hand-written text/fill/hover map per surface. Reusing `secondary` is less code and inherits Nuxt UI's
accessible variant math.

**Discipline — the accent is a *secondary* token, never a second primary.** It is used sparingly for genuine
secondary emphasis and must not flood the UI. The glow ring, `.page-radial`, focus rings, and every primary
CTA stay on `primary`. Concretely, the accent is allowed on exactly these roles and no others without a
follow-up design note:

| Role | Nuxt UI usage | Reads step |
| --- | --- | --- |
| Inline links inside content | `text-secondary` (or a prose link class mapped to it) | 500 L / 400 D |
| Category chips / tags | `UBadge color="secondary" variant="subtle"` | 500 L / 400 D text on a 10% fill |
| Secondary / soft buttons | `UButton color="secondary" variant="soft"` (or `solid` where a filled secondary is wanted) | 500 L / 400 D |
| Small active-state / highlight touches | active tab underline, selected-item marker, `bg-secondary` at low alpha | 400/500 graphical |

**Not allowed on:** primary CTAs, the `.btn-glow` ring, the page radial, body text, form field chrome,
status colours (`success` / `info` / `warning` / `error` stay fixed), or large filled regions. If a design
later wants a filled secondary hero, that is a new decision, not something this token grants by default.

**Why 500/400 are the AA-critical steps.** Every text and label role above resolves to `--ui-secondary`,
which is `secondary-500` (light) / `secondary-400` (dark). That is why 1a tuned those two steps to clear
4.5:1 as text/label on their respective surfaces (see the 1b accent rows and the 1c adjustment table).
Graphical-only touches (the 10% chip fill, a low-alpha active marker) fall under the 3:1 non-text bar, which
the same steps clear with margin.

### 1d. Borders — classified, exempt, one flag

| Theme | Light default border (n200) on surface | Dark default border (n600, lifted) on surface | Light input ring (n300) on surface |
| --- | --- | --- | --- |
| pastel | 1.29 | 1.33 | 1.71 |
| encre | 1.33 | 1.30 | 1.82 |
| cafe | 1.34 | 1.17 | 1.84 |
| automne | 1.35 | 1.13 | 1.81 |
| foret | 1.30 | 1.26 | 1.74 |

These sit far below 3:1, and that is correct and intended:

- **Default borders (n200 light / n600 dark) are decorative structural separators** — card rings, header /
  footer edges, `USeparator` dividers. They convey no state and are not required to identify a control, so
  WCAG 1.4.11 exempts them. They are meant to read as soft hairlines, matching the shipped design (the
  current eight themes ship the same sub-3:1 default borders). Do **not** darken them; a 3:1 separator on a
  pale surface reads as a heavy outline and breaks the aesthetic. The shipped `.dark` border-lift to
  neutral-600 is preserved; on the new near-black dark surfaces it produces a faint (≈1.2–1.4:1) hairline
  that is visible as an edge but never a hard line — the intended effect.
- **Interactive control boundaries** (inputs, selects) use `--ui-border-accented`. At rest they are also
  below 3:1. The identifiable-state requirement of 1.4.11 is carried by the **focus-visible primary
  outline** (`focus-visible:outline-2 outline-primary`, a high-contrast state indicator) plus the input's
  own fill idiom (the shipped autofill/tint rules). **Flag for the accessibility stage:** verify that an
  unfocused, empty input is still identifiable as a field on each surface; if it fails, the minimal fix is
  a subtle `bg-elevated` fill on inputs (identify by fill contrast) rather than a heavier border. This is a
  pre-existing Nuxt UI condition, not introduced by this feature.

### 1e. Glint derivation — validate and resolve

The glow and radial derive the glint as `oklch(from var(--ui-primary) calc(l * 1.1) c calc(h + 25))`. With
the shipped `+25` offset:

| Theme | Primary hue | Derived glint (light / dark) | Target glint | Hue gap to target | Verdict |
| --- | --- | --- | --- | --- | --- |
| pastel | 176° | `#00959b` / `#36d9df` | `#2cc0a0` / `#55d8bc` | ~25° | drifts cyan — acceptable |
| encre | 261° | `#6b5dc4` / `#9ca4ff` | `#3e86d6` / `#6fb6f2` | ~8° | close — validates |
| automne | 43° | `#c57400` / `#e89511` | `#e07636` / `#f08c4e` | ~6° | close — validates |
| foret | 158° | `#008b7d` / `#00bea7` | `#35a86a` / `#58c486` | ~3° | close — validates |
| cafe | 57° | `#7c5f25` / `#ccab59` | `#c98a3e` / `#e2a863` | ~15° | deeper light glint (espresso primary); same olive-gold family — acceptable |

- For **encre / automne / foret**, the `+25` derivation lands within a few degrees of the listed target and
  reads as the intended lighter accent. Validated; no change.
- For **pastel** (now teal seafoam) and **cafe**, the `+25` shift drifts the glint slightly — pastel ~25°
  toward cyan (`#00959b` vs the seafoam target `#2cc0a0`), cafe ~15° toward olive-gold. Both stay in the
  theme's own color family and read as a brighter same-family glint, so both are **acceptable as-is with no
  special-case override**. **Café note:** the espresso primary (hue 57°, essentially the old caramel's 58°)
  keeps the same glint hue-family as before, but because the light-mode primary is now darker, its derived
  light glint (`#7c5f25`) is deeper than the old caramel-based one — expected, since the glow derives from
  `primary`, and consistent with the "glow follows primary, not accent" rule. Pastel's glint is a bright
  seafoam/cyan close to its own primary, exactly like every other theme.
- **No theme needs a per-theme `--glint-hue` value.** Every theme uses the default `+25deg`.

**Mechanism note (retained, now unused per-theme).** The `--glint-hue` custom property (default `25deg`,
consumed as `calc(h + var(--glint-hue))` in `.btn-glow` and `.page-radial`) is still worth introducing as a
general lever so a future theme can retune its glint hue without editing the shipped derivation. But with the
seafoam pastel, **no `[data-theme]` block overrides it** — there is no special case to carry. If the frontend
prefers, it may skip introducing the variable entirely and leave the shipped `calc(h + 25)` untouched, since
nothing now depends on a per-theme value. Either way the glow/radial mechanism is unchanged in behaviour and
stays within scope.

---

## Job 2 — UI-upgrade component blueprint

> **Pending UI corrections (not yet reflected below).** This refined-palette revision only reworked the
> colour system (Job 1). The Job 2 blueprint below still describes the earlier UI intent and is **awaiting a
> separate frontend design pass** to correct these owner decisions, which are recorded here as a checklist
> and intentionally **not** spec'd in detail in this revision:
>
> - Put the **language control back inside the theme/settings popover** rather than surfacing it as a
>   standalone header button (revises H3's "surface locale as a header button" recommendation).
> - **No page gradient** on the app shell (revises H1 — the `.page-radial` on the layout wrapper is to be
>   dropped for this pass; `.page-radial` remains available for auth pages).
> - **Keep the 3D flip** on the mode control (H3's flip stays).
> - **Logo hover-scale** micro-interaction on the header brand mark.
> - **Vertically centered nav** in the header.
>
> Treat the sections below as historical context for the still-valid parts (glow on CTAs, flip mechanism,
> hover micro-interactions) until that pass rewrites them. Where a bullet conflicts with the checklist above,
> the checklist wins.

Semantic tokens only, Nuxt UI first, Phosphor `i-ph-*` icons, all motion gated behind
`prefers-reduced-motion: reduce` (via Tailwind `motion-safe:` / `motion-reduce:` or the existing scoped
media query). Boldness stays on the glow and the flip; everything else quiet.

### H1 — Page-glow on the app shell

- **Reuse `.page-radial` verbatim** (already theme-derived from `--ui-primary`, already dark-dimmed). No
  second radial, no new utility.
- **Mount point:** `app/layouts/default.vue`, on the single root wrapper that owns the shell canvas. That
  wrapper keeps its `bg-muted` background-color and adds `page-radial` so the radial `background-image`
  layers over the flat canvas exactly as the auth pages do (assumption 7). Use `min-h-dvh` on that wrapper.
- **Anchoring:** `.page-radial` anchors the gradient at `100% 0%` (top-right) of its box. Put the class on
  the layout wrapper (not on `UMain`, whose scroll would drag the glow); the sticky `UHeader` (`bg-elevated`,
  opaque) sits over the top strip and the glow bleeds into the content region below it — the intended depth
  cue.
- **Dark reduction:** already encoded — `.page-radial` uses 0.14 alpha, `.dark .page-radial` 0.07. Verified
  against the three darkest canvases (pastel `#10201c`, automne `#1b1109`, foret `#0e1a12`): at 0.07 the
  primary-derived tint reads as a faint wash, never a blob. No change needed.
- **Motion:** none. Static background, no animated element introduced, so no reduced-motion obligation of
  its own (H1 satisfied by construction).

### H2 — Header icon-control hover micro-interactions

Targets: the color-mode toggle (`AppColorModeToggle`) and the account-menu trigger (the initials circle in
`app/components/app/header.vue`), plus the language control if surfaced as a standalone header button (see
H3).

- **Ghost icon controls** (color-mode, language) — the color change fits an icon glyph:
  ```
  transition-colors duration-200 hover:text-primary
  motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-110
  ```
  Color transition is unconditional; the `scale-110` is gated by `motion-safe:` so it simply is not applied
  under reduce (no movement, no layout shift), while `hover:text-primary` still fires. This is exactly the
  "color may remain, scale must not animate" split H2 requires. `110` sits at the quiet end of the 110–125
  range, matching the portfolio navbar's restraint.
- **Account trigger circle** (`bg-primary` filled avatar) — `hover:text-primary` is meaningless on a filled
  circle, so use scale plus a soft primary ring instead of a text color change:
  ```
  transition duration-200 motion-safe:hover:scale-105 hover:ring-2 hover:ring-primary/40
  ```
  Slightly smaller scale (`105`) because the avatar is larger than the icon glyphs and `110` reads as a
  jump. The ring uses the semantic `ring-primary` token at low alpha.
- Keep the existing `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`
  on every control; hover treatment never replaces the focus ring.

### H3 — 3D flip on the header mode and language controls

- **Reuse the shipped flip**, do not author a new one. The implementation is in
  `app/components/app/locale-toggle.vue`: the `perspective-[600px]` wrapper, `<Transition name="flip"
  mode="out-in">` around the keyed glyph, and the scoped `.flip-enter/leave` `rotateY(±90deg)` + opacity
  transition, already with the `@media (prefers-reduced-motion: reduce)` block that drops to opacity-only
  with `transform: none` and no layout shift.
- **Make it shared.** Extract the flip into one reusable primitive so the auth toggle and the header
  controls use a single implementation — recommended shape: a tiny `AppFlipSwap` wrapper that renders
  `<Transition name="flip" mode="out-in"><slot :key="key" /></Transition>` with the perspective wrapper and
  the scoped style moved in. `locale-toggle.vue` then consumes `AppFlipSwap` rather than duplicating the
  CSS. (Equivalent alternative: promote `.flip-*` + a perspective utility into `main.css` and wrap each
  changing glyph in `<Transition name="flip" mode="out-in">`. Either is fine; the CSS and timings must stay
  identical to the shipped toggle.)
- **Color-mode control:** wrap the sun/moon glyph in the flip Transition keyed on the resolved mode
  (`colorMode.value` / `isDark`). Toggling mode changes the key → the sun flips to the moon. Keep it behind
  the existing `<ClientOnly>` mode guard so SSR does not mismatch.
- **Language control:** the header currently exposes language as a dropdown *row*, which has no standalone
  glyph to flip. To satisfy H3, surface the locale as a standalone `AppLocaleToggle` button in the header
  `#right` cluster (reuse the existing component as-is — it already carries the flip), matching the auth
  pattern, and drop the redundant menu row (or keep the row purely as a secondary affordance). Frontend's
  call on placement; the requirement is that the header's mode control and a header locale control both flip
  identically to the auth toggle.
- **Trigger:** a `mode` change re-keys the color-mode Transition; a `locale` change re-keys the locale
  Transition (the same `:key="locale"` mechanism the auth toggle already uses). No imperative triggering.
- **Reduced motion:** inherited verbatim from the shipped scoped media query — rotateY disabled, opacity-only
  crossfade, no layout shift between motion states. If promoted to `main.css`, carry the same media query.

### H4 — `.btn-glow` on primary CTAs

- **Keep it on genuine solid-primary action buttons only.** The auth submit buttons
  (`signin.vue`, `signup.vue`, `onboarding.vue`) already carry `.btn-glow`; the pattern holds unchanged.
- This feature adds no new page or CTA, so there is **no new mandatory placement**. When a primary CTA does
  land (e.g. the oversized `2xl` hero button reserved in `app.config.ts`), it is the natural home for
  `.btn-glow`.
- **Do not** put `.btn-glow` on the account trigger circle or the icon toggles — those are H2's domain;
  mixing the spinning ring onto chrome controls would break the "everything else quiet" rule (H5).
- The saturated new primaries (seafoam teal, deep blue, caramel, burnt orange, pine) make the conic ring
  read clearly where the old muted pastel-teal was faint — the ring earns its place now. Every theme's ring
  uses the default `+25deg` glint derivation (Job 1e); on pastel it sweeps teal→bright seafoam/cyan.
- **Motion:** unchanged — the 7s spin is already gated behind `prefers-reduced-motion: reduce`; the static
  ring and soft glow remain for opted-out users.

### H5 — Restraint

No animation beyond the already-gated glow spin (H4), the H2 hover scale (`motion-safe`-gated), and the H3
flip (media-query-gated). No scroll choreography, no new always-lit element. The page-glow (H1) is static.

---

## Assumptions made

1. **Solid-button label = `text-inverted`** (verified in the Nuxt UI dist): white in light, neutral-900 in
   dark. The critical case is therefore white-on-primary-500 (and white-on-secondary-500) in light only.
2. **`--ui-primary` = primary-500 (light) / primary-400 (dark)** and, by the same Nuxt UI v4 convention,
   **`--ui-secondary` = secondary-500 (light) / secondary-400 (dark)**. The `secondary` alias ships by
   default, so redefining `--ui-color-secondary-*` per theme block (like primary) wires the accent with no
   `app.config.ts` change. Not separately re-derivable from the installed CSS (generated at build), but
   consistent with every shipped value.
3. **Accent = the `secondary` token, used sparingly** for links, chips/badges, secondary/soft buttons, and
   small active-state touches only (see the "Accent token" subsection). It is not a second primary; the
   glow, radial, focus rings, and primary CTAs stay on `primary`.
4. **Default borders are decorative** (card rings, dividers, header/footer edges) and exempt from 1.4.11;
   interactive boundaries lean on the focus ring. This matches the shipped themes, which ship the same
   sub-3:1 borders. If the accessibility stage disagrees for inputs, the fix is a subtle input fill, not a
   heavier border.
5. **Pastel light primary was darkened for AA** (`#159a82` → `#00866f`) so the white button label clears
   4.5:1. This revision adds accent adjustments (three light accents darkened, one dark accent brightened,
   café primary rebuilt to espresso) — all in the 1c table. The `--glint-hue` variable is optional and
   unused per-theme; every theme uses the shipped default `+25deg` derivation, so the glow/radial mechanism
   stays untouched. Everything else is anchor-faithful.
6. **Third header swatch dot = glint**, per spec assumption 2; where a theme's glint reads poorly as a dot
   against the row, `surface` is the fallback — a per-theme frontend call, not required by the contract.
