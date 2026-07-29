# Design: the category column, with coloured names

The visual blueprint for [`category-column-coloured-names.md`](category-column-coloured-names.md)
(`PLAN-32c`). That spec owns the information contract and hands this stage seven open questions.
This document closes all seven and nothing else. It writes no Vue and edits no component.

It inherits [`extend-tasks-design.md`](extend-tasks-design.md) rather than replacing it. The track
order, the alignment rules, the fixed-track lesson, and the width derivations for Livraison, Mots,
Durée and Statut all stand exactly as that blueprint set them. What changes is that a coloured 3 px
edge becomes a coloured word in a track of its own, which costs width, and that a decorative colour
becomes text and so acquires a contrast floor.

The two governing rules are still the ones from the simplifying pass. Colour carries meaning, and
the interface shows only what is functional.

## Summary of the seven decisions

| #   | Question                               | Decision                                                                                                                                                                                 |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The nine colours                       | The user's hues kept verbatim where they were given. `revision_external` 115, `admin` 305, `dtp` 60, `proofreading` 230. Worst measured cell in the whole set is 5.07:1.                          |
| 2   | Does fixed lightness survive at 4.5:1  | Yes, whole, with **zero exceptions**. One lightness and one chroma per mode carries all nine and in fact carries all 360 hues. Light moves from 0.55 to 0.47, dark stays at 0.74.        |
| 3   | Proofreading's pale grey               | It does not survive. `Relecture` becomes slate blue at hue 230. Measured reason below, and it goes back to the user as a substitution rather than a silent fix.                  |
| 4   | The status collision                   | Positional first, typographic second. Chromatic separation is measured as unavailable and is explicitly not relied on, which is what lets the user's hues survive verbatim.                     |
| 5   | The task column on a non-trackable row | The em dash with `planning.notSet` behind it. No new key.                                                                                                                                |
| 6   | Column position and width              | Track 2, right after the grip, `9rem`. `min-w-[52rem]` becomes `min-w-[62rem]`. The container does not widen, because it already does at `xl`.                                           |
| 7   | The delivery separator                 | A plain space, no glyph. The join moves into a pure `formatDeadline` in `shared/planning.ts` that returns the two parts, so the two-tone rendering survives and the space is assertable. |

## Decision 1. The nine colours, measured

### The rig

A throwaway script converted OKLCH to sRGB with CSS Color 4 style gamut mapping (chroma reduced
under a `deltaEOK` 0.02 budget with local clipping), then computed WCAG 2.x relative luminance and
contrast ratios. Every background was resolved out of the repo rather than assumed. `@nuxt/ui`
resolves `bg-default` to `#fff` and `bg-elevated` to `neutral-100` in light, and `bg-default` to
`neutral-900` and `bg-elevated` to `neutral-800` in dark. `DayCard.vue` L54 to L63 gives a work day
`bg-default dark:bg-elevated` and an off day `bg-elevated dark:bg-default`, and the disclosure
region below the header band paints no background of its own, so a task row always sits directly on
its card's surface. The five `neutral-100` / `-800` / `-900` values came from the surface ramps in
`main.css` L28 to L93.

### The correction the matrix forces

**The off-day card is the harder surface in light mode and the easier one in dark mode.** The spec
and both shipped comments say the muted off-day card fails first, and that is true in light, where a
dark word on `neutral-100` has less contrast than the same word on white. It inverts in dark,
because `bg-elevated` is `neutral-800` while `bg-default` is `neutral-900`, so the work-day card is
the _lighter_ of the two and a light word has less contrast there.

| Mode  | Card     | Token              | Binding theme | Background | Luminance |
| ----- | -------- | ------------------ | ------------- | ---------- | --------- |
| light | off day  | `bg-elevated`      | automne       | `#f3e4d8`  | 0.7950    |
| light | work day | `bg-default`       | all           | `#ffffff`  | 1.0000    |
| dark  | work day | `dark:bg-elevated` | pastel        | `#172b26`  | 0.0205    |
| dark  | off day  | `dark:bg-default`  | pastel        | `#10201c`  | 0.0123    |

So the two cells to check on the built page are **the automne off-day card in light** and **the
pastel work-day card in dark**. Every other surface has more headroom, and measuring only one card
per mode is the mistake that has already been made twice on this row.

### The fixed values

```css
@layer base {
  :root {
    --planning-cat-l: 0.47;
    --planning-cat-c: 0.11;
  }

  .dark {
    --planning-cat-l: 0.74;
    --planning-cat-c: 0.13;
  }
}
```

Light goes from 0.55 to 0.47, which is what the spec predicted. **Dark does not move**, which is
what the spec predicted wrong, and the number says so plainly. At `0.74 0.13` the worst of the nine
on the hardest dark surface is 6.08:1, so dark had 1.5 of headroom it did not know about. Dark
chroma drops from 0.14 to 0.13 for a different reason, given under gamut below.

The shipped `0.55 0.15` fails the text floor for all nine categories, between 3.59:1 and 4.24:1 on
the automne off-day card, so the retune was necessary rather than precautionary. That is the same
surface the `--planning-cat-l` comment already names, measured against the stricter floor.

### The resolved palette

| Category            | The user's colour              | Hue | Light     | Effective C | Dark      | Effective C |
| ------------------- | ----------------------- | --- | --------- | ----------- | --------- | ----------- |
| `translation`       | cyan                    | 195 | `#006b6c` | 0.080       | `#00c4c4` | 0.126       |
| `revision_internal` | apple green             | 140 | `#36692a` | 0.110       | `#7dbf6e` | 0.130       |
| `revision_external` | apple green (derived)   | 115 | `#596100` | 0.107       | `#a8b44b` | 0.130       |
| `proofreading`      | pale grey (substituted) | 230 | `#00658c` | 0.094       | `#3bb9ed` | 0.130       |
| `terminology`       | wine red                | 20  | `#8e3d40` | 0.110       | `#f28788` | 0.130       |
| `meetings`          | pink                    | 340 | `#823f6e` | 0.110       | `#e189c5` | 0.130       |
| `breaks`            | navy                    | 265 | `#3c5898` | 0.110       | `#82a8fd` | 0.130       |
| `admin`             | not specified           | 305 | `#69498c` | 0.110       | `#be95ec` | 0.130       |
| `dtp`               | not specified           | 60  | `#864900` | 0.110       | `#e6964f` | 0.130       |

The hex values are informational. **Nothing in the codebase holds one.** They are here so a later
reader can re-check a ratio without re-running the rig.

### Gamut, and why the effective chroma is not always the nominal chroma

sRGB cannot hold a saturated cyan at a lightness dark enough to pass 4.5:1. At `L 0.47` the sRGB
chroma ceiling at hue 195 is 0.080, at 230 it is 0.094 and at 115 it is 0.107, while wine red can
hold 0.189 and navy 0.301. So a single nominal chroma is a ceiling that three of nine hues sit
under after gamut mapping, and the light palette's real chroma spread is 0.080 to 0.110.

That is accepted deliberately, and it is what ships today (the shipped `0.15` is out of gamut for
five of the nine hues). **Lightness is what carries contrast, and lightness is exactly even.**
Chroma is what carries vividness, and every category gets as much of it as sRGB can give at that
lightness. Translation's cyan is the palette's least saturated member for a physical reason rather
than a design one.

Dark chroma is 0.13 rather than the shipped 0.14 because at `L 0.74` navy's ceiling is 0.133. At
0.13 only cyan is mapped, so the dark spread is 0.126 to 0.130, which is three percent. At 0.14 both
cyan and navy would be mapped and the spread would triple for no visible gain.

### The full matrix, 180 cells

Every cell is the contrast ratio of the category name against its card background. **No cell is
below 5.07:1.** The floor is 4.5:1.

**Light, work-day card (`bg-default` `#ffffff`, identical in all five themes).**

| Category            | ratio |
| ------------------- | ----- |
| `translation`       | 6.31  |
| `revision_internal` | 6.53  |
| `revision_external` | 6.67  |
| `proofreading`      | 6.52  |
| `terminology`       | 7.23  |
| `meetings`          | 7.26  |
| `breaks`            | 6.93  |
| `admin`             | 7.17  |
| `dtp`               | 7.07  |

**Light, off-day card (`bg-elevated`, `neutral-100`). This block holds the worst cell in the set.**

| Category            | pastel | encre | cafe | automne  | foret |
| ------------------- | ------ | ----- | ---- | -------- | ----- |
| `translation`       | 5.40   | 5.28  | 5.19 | **5.07** | 5.21  |
| `revision_internal` | 5.59   | 5.47  | 5.37 | 5.25     | 5.39  |
| `revision_external` | 5.72   | 5.59  | 5.49 | 5.37     | 5.51  |
| `proofreading`      | 5.58   | 5.46  | 5.36 | 5.24     | 5.39  |
| `terminology`       | 6.19   | 6.05  | 5.95 | 5.82     | 5.97  |
| `meetings`          | 6.21   | 6.08  | 5.97 | 5.84     | 6.00  |
| `breaks`            | 5.93   | 5.80  | 5.70 | 5.58     | 5.73  |
| `admin`             | 6.14   | 6.01  | 5.90 | 5.77     | 5.93  |
| `dtp`               | 6.05   | 5.92  | 5.81 | 5.69     | 5.84  |

**Dark, work-day card (`dark:bg-elevated`, `neutral-800`). The harder of the two dark surfaces.**

| Category            | pastel   | encre | cafe | automne | foret |
| ------------------- | -------- | ----- | ---- | ------- | ----- |
| `translation`       | 6.85     | 7.44  | 7.89 | 7.81    | 7.28  |
| `revision_internal` | 6.76     | 7.34  | 7.78 | 7.70    | 7.18  |
| `revision_external` | 6.61     | 7.18  | 7.61 | 7.53    | 7.02  |
| `proofreading`      | 6.64     | 7.21  | 7.64 | 7.56    | 7.05  |
| `terminology`       | 6.10     | 6.63  | 7.03 | 6.95    | 6.48  |
| `meetings`          | **6.08** | 6.61  | 7.00 | 6.93    | 6.46  |
| `breaks`            | 6.39     | 6.94  | 7.35 | 7.28    | 6.78  |
| `admin`             | 6.16     | 6.70  | 7.10 | 7.02    | 6.55  |
| `dtp`               | 6.25     | 6.80  | 7.20 | 7.13    | 6.64  |

**Dark, off-day card (`dark:bg-default`, `neutral-900`).**

| Category            | pastel | encre | cafe | automne | foret |
| ------------------- | ------ | ----- | ---- | ------- | ----- |
| `translation`       | 7.76   | 8.33  | 8.61 | 8.54    | 8.22  |
| `revision_internal` | 7.65   | 8.21  | 8.49 | 8.43    | 8.11  |
| `revision_external` | 7.48   | 8.03  | 8.31 | 8.24    | 7.93  |
| `proofreading`      | 7.51   | 8.07  | 8.34 | 8.27    | 7.96  |
| `terminology`       | 6.91   | 7.42  | 7.67 | 7.61    | 7.32  |
| `meetings`          | 6.88   | 7.39  | 7.64 | 7.58    | 7.29  |
| `breaks`            | 7.23   | 7.76  | 8.02 | 7.96    | 7.66  |
| `admin`             | 6.98   | 7.49  | 7.75 | 7.69    | 7.40  |
| `dtp`               | 7.08   | 7.60  | 7.86 | 7.80    | 7.50  |

### The worst cell per category, which is what `AC3` asks for

Every one of the nine has its worst cell in the same place, the **automne off-day card in light
mode** on `#f3e4d8`, because light is the tighter mode and automne has the darkest `neutral-100`.

| Category            | Worst ratio | Where                                  |
| ------------------- | ----------- | -------------------------------------- |
| `translation`       | **5.07:1**  | light, off-day card, automne `#f3e4d8` |
| `proofreading`      | 5.24:1      | light, off-day card, automne `#f3e4d8` |
| `revision_internal` | 5.25:1      | light, off-day card, automne `#f3e4d8` |
| `revision_external` | 5.37:1      | light, off-day card, automne `#f3e4d8` |
| `breaks`            | 5.58:1      | light, off-day card, automne `#f3e4d8` |
| `dtp`               | 5.69:1      | light, off-day card, automne `#f3e4d8` |
| `admin`             | 5.77:1      | light, off-day card, automne `#f3e4d8` |
| `terminology`       | 5.82:1      | light, off-day card, automne `#f3e4d8` |
| `meetings`          | 5.84:1      | light, off-day card, automne `#f3e4d8` |

The single number to re-check on the built page is **5.07:1, `translation` on an automne off-day
card in light mode**. If that one holds, the other 179 hold.

### Hue spacing, and why the revision pair reads as a pair

Sorted around the circle, with the gap to the next member.

| From                    | To                      | Gap    |
| ----------------------- | ----------------------- | ------ |
| `terminology` 20        | `dtp` 60                | 40     |
| `dtp` 60                | `revision_external` 115 | 55     |
| `revision_external` 115 | `revision_internal` 140 | **25** |
| `revision_internal` 140 | `translation` 195       | 55     |
| `translation` 195       | `proofreading` 230      | 35     |
| `proofreading` 230      | `breaks` 265            | 35     |
| `breaks` 265            | `admin` 305             | 40     |
| `admin` 305             | `meetings` 340          | 35     |
| `meetings` 340          | `terminology` 20        | 40     |

**The revision pair is the closest pair in the palette, and it is the only pair inside 35 degrees.**
That ten-degree margin is the whole answer to `AC5`. Proximity itself encodes the sibling
relationship, so the pair reads as related for the same reason it reads as two things.

Measured in Oklab, the pair's separation is a chord of 0.0470, which is roughly 2.3 just-noticeable
differences at the usual 0.02 estimate. Distinct when compared, obviously the same family when
scanned. The next closest pair in the set is `translation` against `proofreading` at 0.0538, then
`proofreading` against `breaks` at 0.0632 and `admin` against `meetings` at 0.0662.

**The spec expected the pair to need a lightness or chroma exception and it does not.** The reason is
the direction the sibling was moved. Putting `revision_external` at 115 leaves the 140-to-195 arc
empty, which protects the two most frequent categories in the app from each other. Moving it the
other way, to 165 or so, would have put it 30 degrees from translation's cyan and destroyed the
uniqueness of the closest pair, which is the property doing the work.

The honest cost is that at a lightness dark enough to pass 4.5:1, hue 115 resolves to an olive green
(`#596100`) in light mode rather than to a fresh apple green. That is the same compromise the
fixed-lightness rule already makes for navy and wine red, and the user chose that rule over
literal fidelity. In dark mode the pair reads as two clear greens, `#a8b44b` and `#7dbf6e`.

### Watch items for the accessibility read, none of them blockers

- **`dtp` `#864900` against café's and automne's `text-muted`.** Café's `neutral-500` is `#6e5a48`
  (`L 0.48 C 0.038 H 64`) and automne's is `#7a5040` (`L 0.47 C 0.062 H 42`), so in those two themes
  the row's muted text sits at the same lightness as `dtp`'s ochre in a neighbouring hue. Separation
  is by chroma, 0.110 against 0.038 and 0.062, which is 2.7 JND against automne. `text-muted` never
  appears in the category column, so the two are never adjacent, but it is worth one look.
- **`translation` 195 against `proofreading` 230.** After the revision pair this is the tightest
  useful comparison in the column, at 35 degrees and about 2.7 JND. Both are trackable and both are
  common. The colour is a scanning aid on a printed word, never the carrier.

## Decision 2. Fixed lightness survives whole, with zero exceptions

One lightness and one chroma per mode carries all nine categories with at least 0.57 of headroom
over the floor. **No category opts out.** The overview anticipated two exceptions, the revision pair
and the wine-red-against-pink pair, and the measurements support neither.

- **The revision pair** is answered by hue direction rather than by a lightness exception, above.
- **Wine red 20 against pink 340** are 40 degrees apart, which is joint second-widest in the set.
  Their Oklab chord is 0.075, well past the revision pair's 0.047. `#8e3d40` and `#823f6e` in light,
  `#f28788` and `#e189c5` in dark. The overview's worry was that fixed lightness drops the very
  difference the user's original palette used to tell them apart, and it does, but 40 degrees at 0.11 chroma
  is enough on its own.

The rule also survives in a stronger form than it had. **Every hue from 0 to 359 clears the floor at
these fixed values**, measured across the whole circle on all twenty surfaces. The worst reading
anywhere is 5.02:1 at hue 175 in light and 6.07:1 at hue 352 in dark. This matters for `PLAN-30` and
is covered under the contract below.

## Decision 3. Proofreading loses pale grey and becomes slate blue

**`Relecture` renders at hue 230, `#00658c` in light and `#3bb9ed` in dark.** The user's literal pale grey
does not ship, and this is a substitution to put back to the user's rather than a fix to bury.

**Approved rather than proposed.** The owner approved the substitution on 2026-07-29 and will tell the
user that their colour for `Relecture` changed and why. So this ships as a decision rather than
as a recommendation waiting on theirs, and it stays theirs to overrule.

Grey was tested first and fails both halves of `AC4`.

- **A grey that passes is a dark grey.** Chroma zero at `L 0.47` is a mid-dark neutral, which is the
  same tonal band as the row's own `text-muted`. The five themes' light `text-muted` measures
  `L 0.47` to `L 0.53` at chroma 0.03 to 0.06. A chroma-zero category name would sit inside that
  band, so `Relecture` would read as the one row whose colour failed to load rather than as one of
  the user's nine colours. Passing contrast is necessary and is not sufficient, exactly as `AC4` says.
- **A low-chroma slate, as a compromise, is worse rather than better.** The obvious middle route is
  to keep the intent of pale by giving proofreading the palette's lowest chroma at a cool hue. That
  collides head-on with the tinted neutral ramps. Encre's `neutral-500` is `#5a6b85`, which resolves
  to `L 0.52 C 0.046 H 259`, a blue-grey. A proofreading slate at `L 0.47 C 0.045` near hue 230
  would be within about 30 degrees of it at the same chroma and the same lightness, so in the encre
  theme the compromise reproduces exactly the failure it was meant to avoid.

So the only version of proofreading that both passes 4.5:1 and reads as a deliberate colour is a
real hue at the shared chroma. Hue 230 is chosen because 195 to 265 is the widest empty arc in the user's
palette, and 230 is its centre, so proofreading takes the one place in the circle where a new member
costs the least separation from everything else. At `C 0.11` it is 0.094 after gamut mapping, which
is more than twice any theme neutral's chroma, so it cannot be mistaken for a neutral in any theme.

Two things this buys beyond passing.

- **It keeps the contract shape simple.** The spec's second reason for changing the contract was that
  grey is not a hue and a hue number cannot express chroma zero. With no chroma-zero member, the
  contract stays a hue per category and `main.css` keeps both fixed values, which is the shape that
  gives `PLAN-30` its colour for free.
- **It puts proofreading in the trackable-work family.** Translation, both revisions and proofreading
  are the four categories that produce words, and they now occupy 115 to 230, one connected arc of
  the circle, while the five non-trackables sit in the warm and violet arc. That is not load-bearing
  and nothing in the app reads it, but it is a real pattern the eye can pick up for free.

**What goes back to the user's, in one sentence.** `Relecture` is a slate blue rather than a pale grey,
because a grey dark enough to read as text at 14 px stops reading as one of your colours and starts
reading as the row's ordinary muted text.

## Decision 4. The status collision is solved by position and by weight, not by hue

### Chromatic separation is measured as unavailable, and that is the finding

Nine categories and four reserved status roles do not fit one circle at one lightness. The numbers,
with the status roles read from `app.config.ts` (`success: green`, `info: blue`, `warning: amber`,
`error: red`) and the Tailwind v4 ramps.

| Status role                                   | Rendered as | Nearest category                  | Hue gap |
| --------------------------------------------- | ----------- | --------------------------------- | ------- |
| `info` blue-800 `L 0.424 C 0.199 H 265.6`     | `#193cb8`   | `breaks` 265 `#3c5898`            | **0.6** |
| `error` red-800 `L 0.444 C 0.177 H 26.9`      | `#9f0712`   | `terminology` 20 `#8e3d40`        | 6.9     |
| `success` green-800 `L 0.448 C 0.119 H 151.3` | `#016630`   | `revision_internal` 140 `#36692a` | 11.3    |
| `warning` amber-800 `L 0.473 C 0.137 H 46.2`  | `#973c00`   | `dtp` 60 `#864900`                | 13.8    |

`breaks` and `info` are the same hue to within half a degree. `revision_internal` and `success` sit
at `L 0.47 C 0.110` against `L 0.448 C 0.119`, which is functionally the same colour. In dark,
`terminology` `#f28788` and `error` `#ff6467` are 2.2 degrees apart.

**Nothing can be done about that without giving up the user's colours, so hue is not the mechanism.** There
is one tendency worth recording and not relying on. The status roles are more saturated than the
categories in three of four cases, because the category chroma is capped at 0.11 while the status
shades run 0.137 to 0.199. It fails for `success` in light (0.119 against 0.110), which is the
tightest pair in the whole comparison, so it is an observation rather than a defence.

Refusing the chromatic mechanism is what lets wine red stay at 20, apple green at 140 and navy at 265. That is a benefit rather than a concession.

### Amendment from the accessibility stage. Position was necessary and it was not sufficient

Everything above stays as written, because the reasoning is still the reasoning and a later reader
should see what was decided and why. One conclusion is amended. The sentence "Nothing can be done
about that without giving up the user's colours, so hue is not the mechanism" carried its own escape hatch
and this stage walked through it. **Moving `success` gives up nothing of the user's.** A category hue is the
user's own colour and ships verbatim. `success` is a reserved role that nobody chose for its
looks, so it is the cheapest thing on the row to move, and the design stage had already ruled out the
expensive move rather than this one.

What changed the answer is a measurement this section did not take. The two colours are not merely
close, they are closer than the pair that is supposed to look related. `revision_internal` against
`success` green-800 is an Oklab chord of 0.0336, while `revision_internal` against
`revision_external` is 0.0461. So the pair a user must never confuse read as more alike than the pair
designed to read as siblings, which inverts the relationship the palette was built to carry. Under
simulated protanopia the same pair collapses to 0.0201, roughly one just-noticeable difference, while
the sibling pair holds at 0.0302.

`success` is therefore emerald rather than green, which is `oklch(0.432 0.095 167)` at shade 800 in
place of `oklch(0.448 0.119 151)`. It lifts the closest trackable category to 0.0604, and to 0.0548
under protanopia, so the ordering is right again in normal vision and for a dichromat. teal was
measured too and rejected, because it lands 7 degrees from `translation`'s cyan and trades one
collision for another. Emerald is the value that maximises the smallest distance to any of the four
trackable categories.

**Both defences ship, and that is deliberate rather than one stage overruling another.** They fail
differently, which is the whole reason to keep both. Position and weight survive any palette change
and do nothing for a user who cannot separate the hues at all. The hue shift survives a layout change
and does nothing if the two cells ever end up adjacent. Neither one covers what the two cover
together.

Two consequences to record rather than discover later. The hue move also improves contrast, since the
worst `Terminé` reading on the muted off-day card goes from 5.74:1 to 6.13:1, so emerald would be
defensible on that ground alone. And `success` is a reserved semantic role, so every success state in
the app shifts from green to emerald and not only the planning rows. The owner accepted that on
2026-07-29, on the grounds that the alternative was overriding a colour the user gave.

### What actually separates them

**Positional, and it is primary.** The category is track 2 and the status is track 7. Between them
sit the task name, the delivery, the words and the duration. At a 1280 px viewport the two coloured
words are about 640 px apart and are never adjacent at any width, because both tracks are fixed and
there is no second arrangement. This is the cheapest separation available and it costs nothing,
which is what `AC6` said it would.

**Typographic, and it is what a user notices second.** The row already sorts itself into two tiers.
Semibold carries the things the row asserts, which are the task name, the duration and the status.
Regular carries the things the row describes, which are the delivery date, the words denominator and
the markers. **The category joins the regular tier at `font-normal`, and the status keeps
`font-semibold`.** So the two coloured words differ in weight before they differ in anything else. A
category is a classification that does not change, a status is a state that does, and the weight
says which is which.

**Structural, and it is free.** All nine categories print, on every row, so the category column is
an unbroken ladder of colour down a card. The status column prints a coloured word only on trackable
rows and the em dash otherwise, so it is intermittent. Down one seeded card the two columns do not
even have the same shape.

### What a user sees that tells the two columns apart

On the worst seeded row, a terminology task in the same card as a late translation, the user sees
`Terminologie` in a dull red at regular weight at the left end of the row under a header that says
`Catégorie`, and `En retard` in a vivid red at semibold at the right end under a header that says
`Statut`, with a deadline, a word ratio and a duration in between. The words share no letters. The
weights differ. The columns are labelled. Neither is a chip.

The accessibility stage's job here is to look at one such card on screen, per the spec, rather than
to re-measure a table of ratios.

## Decision 5. A non-trackable row prints the em dash under `Tâche`

`primaryName` stops falling back to the category label. When a task has neither a client nor a
project the name cell prints the em dash with `planning.notSet` behind it, using the row's existing
missing-value pattern. **No new i18n key.**

```text
Grip │ Catégorie │ Tâche │ Livraison │ Mots │ Durée │ Statut
  ⠿  │ Pauses    │   —   │     —     │  —   │ 1 h 00│   —
```

**Why, in terms of what the row is for.** The `Tâche` column answers which piece of work a row is.
A break is not a piece of work, so the column has no answer, and printing the classification there
is a category answering a question nobody asked. It is also the row's widest, heaviest cell, at
`1fr`, `text-[15px]`, semibold, `text-highlighted`, so the duplication lands in the most prominent
place on the row. The eye reads `Pauses` in bold as though it were a client and then finds `Pauses`
again one column to its left in colour. Removing that is the whole reason `AC7` exists, and the
option of accepting the duplication is the one the spec asked to be argued rather than defaulted
into. It does not survive the argument.

**Nothing is removed from the row.** The spec's edge case warns that two meetings on one day already
look identical and that this decision must not make it worse by taking away the only word those rows
carry. It does not. The word `Réunions` still prints, in a labelled column, in colour, one track to
the left. Before this feature the category on those rows was a 3 px edge and a screen-reader-only
span; after it, it is a printed word. Those rows gain a carrier rather than losing one.

**`notSet` rather than `notApplicable`, deliberately.** The row keeps the two apart and the
distinction is real here. A name is a fact nobody entered, not a fact that cannot exist, because
once `PLAN-09` ships a user may well give a meeting a project name and it will print. So the Tâche
cell uses `planning.notSet` (`Non précisé` in FR, `Not set` in EN) whether or not the task is
trackable, and `planning.notApplicable` (`Sans objet`, `Not applicable`) stays reserved for the Mots
and Statut cells on a non-trackable row, where the fact genuinely cannot exist. One branch, one key,
and it is the more truthful of the two.

That also means a trackable task with no client and no project is handled by the same branch, which
is correct and was previously masked by the category fallback.

**Rendering.** The fallback is not semibold and not `text-highlighted`, because it is an absence
rather than a name. It matches the row's other missing values.

```html
<!-- name cell, when there is neither a client nor a project -->
<span class="text-[15px] text-muted">
  <span aria-hidden="true">{{ t('planning.emDash') }}</span>
  <span class="sr-only">{{ t('planning.notSet') }}</span>
</span>
```

`showProject`, the split marker and the exclusion marker are unchanged on those rows. The comment at
`TaskRow.vue` L91 to L94 is replaced with the reasoning above, and the sentence about two meetings
looking identical is kept, because it is still true and still accepted.

## Decision 6. Position, width, and the grid

### Position

**Track 2, immediately after the grip.** Four reasons, in order of weight.

1. It is where the edge was, so the association the user has already learned between a colour and a kind
   of work survives the change of carrier. A column of colour running down the left of a card is the
   at-a-glance vertical scan the edge existed for, now made of words.
2. It is the far end of the row from the status, which is decision 4's primary mechanism.
3. `DayCard.vue` already lists the category first among its six column headers, so no header
   reorders and no i18n changes.
4. The reading order becomes what kind of work, whose work, when it is due, how big, how long, where
   it stands. The category is the fastest field to read and the one that predicts what the rest of
   the row will say, so it reads first.

### Width

**`9rem`, 144 px, matching Livraison.**

The longest rendered label is `Internal revision` and `External revision` in EN at seventeen
characters, ahead of `Révision interne` and `Révision externe` in FR at sixteen. At `text-sm`
regular in Hanken Grotesk that is about 125 px, using the same per-character basis the previous
blueprint used for `En retard`. 144 px leaves about 19 px, which is the margin that covers the
`system-ui` fallback metrics before the webfont loads.

**Truncation is ruled out for this column**, per the spec's edge case. The two revision members
differ only in their last word, so a truncated `Révision …` would make them identical. The cell
carries `whitespace-nowrap` and no `truncate`.

### The grid

Eight tracks. One insertion, and the 3 px border leaves.

```text
grid grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem]
gap-x-4 items-center
```

| #   | Track              | Width               | Align  | Change                                                 |
| --- | ------------------ | ------------------- | ------ | ------------------------------------------------------ |
| 1   | Grip               | `1rem`              | centre | Unchanged. Loses its `sr-only` category span (`AC10`). |
| 2   | **Catégorie**      | `9rem`              | left   | **New.**                                               |
| 3   | Identity + markers | `minmax(12rem,1fr)` | left   | Unchanged.                                             |
| 4   | Livraison          | `9rem`              | left   | Unchanged.                                             |
| 5   | Mots               | `7.5rem`            | right  | Unchanged (`PLAN-33` owns it).                         |
| 6   | Durée              | `4.5rem`            | right  | Unchanged.                                             |
| 7   | Statut             | `6rem`              | left   | Unchanged.                                             |
| 8   | Row actions        | `3rem`              | right  | Unchanged, still reserved and empty.                   |

The same string appears in `TaskRow.vue` and in `DayCard.vue`'s column-header row and the two must
stay byte-identical, which is `AC11`. Every track except the name stays a fixed length, which is the
lesson the row comment records.

The category is left-aligned for the same reason Statut is. There is no box to centre and a
left-aligned word under a left-aligned header is the cleanest column available.

### The 3 px border goes in three places

`TaskRow.vue`'s `border-l-[3px]` and its `:class` and `:style` edge bindings go, `main.css` loses
`.planning-cat-edge`, and the two transparent 3 px borders that existed only to align the day header
band (`DayCard.vue` L89) and the column-header row (L237) with the row edge go with it. All three
elements keep `px-5`, so they stay aligned with nothing to align to.

### Minimum width, re-derived

| Part                | Old                | New                  |
| ------------------- | ------------------ | -------------------- |
| Fixed tracks        | 496 px             | 640 px               |
| Gaps                | 6 at 16 px = 96 px | 7 at 16 px = 112 px  |
| Name minimum        | 192 px             | 192 px               |
| Card padding `px-5` | 40 px              | 40 px                |
| Category edge       | 3 px               | 0 px                 |
| **Row minimum**     | **827 px**         | **984 px**           |
| `min-w-[…]`         | `52rem` (832 px)   | **`62rem`** (992 px) |

`min-w-[62rem]` goes on the same `role="table"` wrapper inside the `overflow-x-auto` scroller, so
the day card keeps scrolling inside its own container and the page body still never scrolls
sideways. `AC11` and WCAG 1.4.10 hold for the same reason they held before, and the reasoning in
`DayCard.vue`'s header comment is unaffected, because that comment is about the header band's own
three-zone grid rather than about the row.

### Confirming the owner's premise, with the numbers

`app/pages/index.vue` L196 already reads
`mx-auto w-full max-w-5xl px-6 py-[clamp(1.25rem,3vh,2rem)] sm:px-6 lg:px-8 xl:max-w-6xl`, so the
widening the previous blueprint specified did ship. The spec's line reference is stale.

| Viewport       | Container           | Card outer | Grid    | Name track | Scrolls                  |
| -------------- | ------------------- | ---------- | ------- | ---------- | ------------------------ |
| 1280 px and up | `max-w-6xl` 1152 px | 1088 px    | 1048 px | **296 px** | no                       |
| 1152 px        | 1088 px             | 1088 px    | 1048 px | 296 px     | no                       |
| 1048 px        | 984 px              | 984 px     | 944 px  | 192 px     | no, exactly at the floor |
| 1024 px        | 960 px              | 960 px     | 920 px  | 192 px     | yes, by 32 px            |

**The premise is confirmed.** At 1280 px the name track gets 296 px against a worst seeded name of
about 200 px for `Éditions Pluriel · P-4821`, so there is 96 px of slack and no truncation. The
column fits with room left over, as the owner said.

**`max-w-5xl` does not have to widen.** The `xl` step already does the work, and above 1280 px
nothing is tight. The honest cost to record is at the bottom of the `lg` band. The card becomes
scroll-free at a 1048 px viewport and wider, where today it is scroll-free at 891 px and wider, so
between 1024 px and 1047 px the day card gains up to 32 px of horizontal scroll it did not have.

Trimming a derived track to buy those 32 px was considered and declined. Statut has 22 px of slack
over `En retard` and Durée has 12 px over `10 h 45`, so the pixels exist, but taking them would
replace two measured widths with two arbitrary ones to serve a 23 px band of viewport, and the
card's own scroller is the designed answer to exactly this. The widths stay as they were derived.

### The grip cell, the header placeholder, and the table semantics

Grid auto-placement fills from track 1, so a headerless leading track needs an in-flow placeholder
or every visible label slides one track left. That placeholder must not be `sr-only`, because
`sr-only` is `position: absolute` and an absolutely positioned grid item takes no track, which is the
exact bug `DayCard.vue`'s comment records.

The ARIA table should be six columns wide, because the grip track and the reserved actions track are
decorative. So both the grip cell and the header's leading placeholder take `role="presentation"`,
which leaves them in flow for the grid and removes them from the accessibility tree. The grip's icon
is already `aria-hidden`, so neither exposes anything, and every row then owns exactly six cells
under exactly six column headers.

```html
<!-- DayCard.vue, the column-header row -->
<span role="presentation" />
<!-- grip track -->
<span role="columnheader">{{ t('planning.columns.category') }}</span>
<!-- now visible -->
<span role="columnheader">{{ t('planning.columns.task') }}</span>
<span role="columnheader">{{ t('planning.columns.delivery') }}</span>
<span class="text-right" role="columnheader">{{ t('planning.columns.words') }}</span>
<span class="text-right" role="columnheader">{{ t('planning.columns.duration') }}</span>
<span role="columnheader">{{ t('planning.columns.status') }}</span>
```

`Catégorie` prints in the same `text-[11px] font-medium uppercase tracking-wide text-toned` as the
other five. `AC10` is satisfied on both sides, the `sr-only` span inside the grip cell goes with its
comment, and the note about `sr-only` grid items being out of flow is preserved in the rewritten
`DayCard.vue` comment because that lesson is what the placeholder is for.

## Decision 7. The delivery separator is a plain space, moved into a pure function

**A plain space, no glyph.** The comment at `TaskRow.vue` L57 to L61 argues that the deadline should
read as one fact and that tone contrast joins the date and the time rather than a separator. This
feature vindicates that comment rather than overriding it, so it stays. The bug was never the choice
of separator, it was that the separator was not being emitted.

A comma, a bullet or a middle dot would each split one deadline into two facts. And a space is
already sufficient in both locales. In FR `29 juill. 12:00` the period reads as the abbreviation
mark it is and the space does the separating, which is correct French typography. In EN
`29 Jul. 2026 12:00` and in the cross-year FR `4 janv. 2027 12:00` the space separates two digit
groups, which is all that was wrong.

No non-breaking space is needed, because the cell already carries `whitespace-nowrap`.

**The join moves into `shared/planning.ts`.** This is the spec's first route and it is the right one.
The compiler strips a whitespace-only text node with no previous sibling, and no amount of whitespace
in the template escapes that, but an interpolation's value is not a text node and cannot be
condensed. Putting the space inside a returned string moves it somewhere the compiler cannot reach
and somewhere the existing node-environment suite can assert on, at no infrastructure cost.
**Component render testing is not taken on**, because a DOM environment and `@nuxt/test-utils` would
be new infrastructure for the project bought to cover one space.

The function returns the two parts rather than one string, which is the variant the spec sanctions,
so the two-tone rendering survives.

```ts
// The composed delivery deadline, as the two parts the row prints in two tones. The date and the
// time read as one deadline, so the separator is a plain space and never a glyph, and it lives here
// rather than in the template because Vue's condenseWhitespace drops a whitespace-only text node
// that has no previous sibling and no amount of template whitespace survives that. The leading space
// on timeSuffix is load-bearing. Do not trim it.
//
// Null means there is no deadline to print and the row shows the em dash instead, which also covers
// an unparseable delivery date, since formatDeliveryDate returns an empty string there and a lone
// time under a header that says Livraison would read as a real value.
export type Deadline = { date: string; timeSuffix: string }

export function formatDeadline(
  deliveryDate: string | null | undefined,
  taskDate: string,
  months: readonly string[],
  deliveryTime: string | null | undefined
): Deadline | null
```

Behaviour, which is what the unit stage asserts.

| `deliveryDate`                   | `deliveryTime` | Returns                                          |
| -------------------------------- | -------------- | ------------------------------------------------ |
| `'2026-07-29'`, task in 2026, FR | `'12:00'`      | `{ date: '29 juill.', timeSuffix: ' 12:00' }`    |
| `'2026-07-29'`, task in 2026, EN | `'12:00'`      | `{ date: '29 Jul.', timeSuffix: ' 12:00' }`      |
| `'2027-01-04'`, task in 2026, FR | `'12:00'`      | `{ date: '4 janv. 2027', timeSuffix: ' 12:00' }` |
| `'2026-07-29'`, task in 2026     | `null`         | `{ date: '29 juill.', timeSuffix: '' }`          |
| `null`                           | anything       | `null`                                           |
| `'not-a-date'`                   | anything       | `null`                                           |

`formatDeliveryDate` keeps its current signature and behaviour byte for byte, per `AC28` of
`extend-tasks.md`. `formatDeadline` calls it.

The row renders the pair and branches once.

```html
<div class="whitespace-nowrap text-sm" role="cell">
  <template v-if="deadline">
    <span class="text-highlighted">{{ deadline.date }}</span>
    <span v-if="deadline.timeSuffix" class="text-muted">{{ deadline.timeSuffix }}</span>
  </template>
  <span v-else class="text-muted">
    <span aria-hidden="true">{{ t('planning.emDash') }}</span>
    <span class="sr-only">{{ t('planning.notSet') }}</span>
  </span>
</div>
```

## The shared contract, pinned

`backend` and `frontend` run in parallel from this section, so it is verbatim rather than
descriptive.

### Division of labour

| Lives in                  | Owns                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `app/assets/css/main.css` | `--planning-cat-l` and `--planning-cat-c`, one pair per mode, and the `.planning-cat-name` rule that composes them with the hue. |
| `shared/categories.ts`    | Which category is which hue, and the total lookup from an arbitrary stored value to a hue.                                       |
| A component               | A class name and a custom-property name. No hue, no lightness, no chroma, no token name, no per-category class string.           |

That is the same split that ships today and it is what `AC2` allows. There is exactly one
category-to-colour mapping, and it is `DEFAULT_CATEGORIES`.

**The contract returns a hue and not a resolved colour, and that is deliberate.** The spec's third
requirement is a light value and a dark value per category, and this shape satisfies it, because the
resolved colour does differ per mode. The mode difference is carried once by the `.dark` override of
`--planning-cat-l` rather than nine times by a pair of values in TypeScript. Putting two colours per
category in the contract would put eighteen colour values into a shared module, would duplicate what
`main.css` already expresses, and would break the property below. A hue is the right carrier because
`proofreading` takes a real hue, so there is no chroma-zero member for a hue number to fail to
express, which was the spec's second reason for changing shape.

### `PLAN-30` still gets its colour for free, and more freely than the ring gave it

The ring existed so that a category nobody designed would inherit a safe colour. **It is replaced by
a measured guarantee over the whole circle.** At `0.47 0.11` in light and `0.74 0.13` in dark, every
integer hue from 0 to 359 clears 4.5:1 on all twenty card surfaces, with the worst reading anywhere
being 5.02:1 at hue 175 in light and 6.07:1 at hue 352 in dark.

So `PLAN-30` may hand the user a full hue wheel and every choice they can make passes by construction.
That is strictly stronger than eight pre-approved slots, and it is why the ring goes rather than
being resized. What `PLAN-30` still owns is uniqueness, which is a product question about two
categories looking alike rather than a contrast question.

### `shared/categories.ts` after this feature

The exports that change.

```ts
// A category descriptor. It carries the id, the trackable flag, and the hue its name is printed at,
// and deliberately no display name, because per project convention all visible strings live in i18n,
// resolved from the id through the categories.<id> key convention. Every category has a hue, so
// there is no null case: the user's original app coloured every kind of work and PLAN-32c
// restores that, which is what reversed AC18 of extend-tasks.md and retired edgeSlot.
export type Category = {
  id: CategoryId
  trackable: boolean
  hue: number
}
```

```ts
// The nine defaults with their locked trackable flags and their designed hues, in the same order as
// DEFAULT_CATEGORY_IDS. The hues are the user's own colours from the app they use today,
// kept verbatim wherever the user named one: cyan for translation, apple green for revision, wine red for
// terminology, pink for meetings, navy for breaks. revision_external is the derived sibling of
// revision_internal and sits 25 degrees off it, which is the closest pair in the palette by a ten
// degree margin, so proximity is what says the two are the same work on different people's text.
// admin and dtp are chosen, because the user named no colour for either. proofreading is a substitution
// rather than the user's colour. Their pale grey cannot both clear the 4.5:1 text floor and still read as a
// colour rather than as the row's own muted text, so it takes the centre of the palette's widest
// empty arc instead. That substitution is recorded in the design blueprint and is the user's to overrule.
//
// Only the hue lives here. The lightness and the chroma are fixed once per mode in main.css, so
// every category lands at the same lightness and therefore at the same measured contrast, and any
// hue a user picks in PLAN-30 inherits that contrast for free. The blueprint measures every hue from
// 0 to 359 at those fixed values against all twenty card surfaces; the worst reading is 5.02:1.
// A hue is deliberately not a semantic token. primary and secondary are redefined by all five
// themes and success, info, warning and error are reserved for status, so a category would either
// shift identity when the user changes atmosphere or read as a status.
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'translation', trackable: true, hue: 195 },
  { id: 'revision_internal', trackable: true, hue: 140 },
  { id: 'revision_external', trackable: true, hue: 115 },
  { id: 'proofreading', trackable: true, hue: 230 },
  { id: 'terminology', trackable: false, hue: 20 },
  { id: 'meetings', trackable: false, hue: 340 },
  { id: 'breaks', trackable: false, hue: 265 },
  { id: 'admin', trackable: false, hue: 305 },
  { id: 'dtp', trackable: false, hue: 60 }
] as const
```

```ts
// The hue angle a category's name is printed at. It coerces the id first, so an unknown or stale
// value resolves to the non-trackable admin default and borrows admin's colour rather than another
// category's, and the function is total: every input returns a number and nothing returns null,
// because every category now has a colour. This is the single source of truth for the mapping. The
// task row and, later, PLAN-11's category selector and PLAN-30's category form all read it from
// here, which is what makes the association between a colour and a kind of work learnable rather
// than two copies that can drift.
export function categoryHue(id: unknown): number {
  return CATEGORY_BY_ID[coerceCategory(id) as DefaultCategoryId].hue
}
```

The exports that go.

- **`CATEGORY_HUE_SLOTS`** goes. The ring is replaced by the whole-circle guarantee above.
- **`categoryEdgeHue`** goes, replaced by `categoryHue`. It has exactly one consumer, `TaskRow.vue`
  L55, so there is no ripple.
- **`Category.edgeSlot`** goes, replaced by `Category.hue`.

The exports that must come out byte-identical, per `AC13`.

- **`DEFAULT_CATEGORY_IDS`**, **`DefaultCategoryId`**, **`CategoryId`**.
- **`DEFAULT_CATEGORY_ID`** and **`coerceCategory`**, which is what makes `categoryHue` total.
- **`isTrackableCategory`**, read by `server/api/tasks/handlers/list.ts` L93 and `scripts/seed.ts`.

`CATEGORY_BY_ID` stays as it is, since it is derived from `DEFAULT_CATEGORIES`.

### `main.css` after this feature

`--planning-cat-l` and `--planning-cat-c` take the new values above and keep their comment, rewritten
to record the text floor rather than the edge floor. `.planning-cat-edge` is replaced.

```css
/* The category colour, now carried by the printed category name rather than by a row edge. Only the
   hue varies per category and it arrives as --planning-cat-hue set inline from the shared category
   contract; lightness and chroma are fixed here so every category, including one a user creates in
   PLAN-30, lands at the same lightness and therefore at the same measured contrast. A new category
   needs one number, never a new colour ramp.
   The floor is WCAG 2.2 AA 1.4.3 at 4.5:1, because the name is 14 px regular text. That is stricter
   than the 3:1 the edge was tuned against under 1.4.11, and the shipped 0.55 / 0.15 fails it for all
   nine categories, between 3.59:1 and 4.24:1 on an automne off-day card. At 0.47 / 0.11 the worst
   cell in the whole set is 5.07:1, translation's cyan on that same card, and every one of the 180
   readings in the design blueprint clears the floor. Every hue from 0 to 359 clears it too, at
   5.02:1 or better, which is what gives a user-created category its contrast for free.
   Dark does not move from 0.74, because it was already clearing 6.08:1 at its worst. Its chroma
   drops to 0.13 only so that navy stays inside sRGB and cyan is the one hue gamut mapping touches.
   Note which surface binds, because it inverts between modes and both shipped comments only record
   the light half. In light, bg-elevated is neutral-100 and the off-day card is the harder one. In
   dark, bg-elevated is neutral-800 while bg-default is neutral-900, so the work-day card is the
   lighter surface and the harder one. */
@layer base {
  :root {
    --planning-cat-l: 0.47;
    --planning-cat-c: 0.11;
  }

  .dark {
    --planning-cat-l: 0.74;
    --planning-cat-c: 0.13;
  }
}

.planning-cat-name {
  color: oklch(var(--planning-cat-l) var(--planning-cat-c) var(--planning-cat-hue));
}
```

The unitless hue in a custom property is fine, since `oklch()`'s hue accepts a `<number>`, and it is
how the shipped edge already works.

### The category cell, verbatim

`TaskRow.vue` imports `categoryHue` in place of `categoryEdgeHue`, keeps `coerceCategory` and
`categoryLabel`, and drops `edgeHue` and both edge bindings from the row root.

```ts
const category = computed(() => coerceCategory(task.category))
const categoryLabel = computed(() => t(`categories.${category.value}`))
const catHue = computed(() => categoryHue(category.value))
```

```html
<!-- The category, printed in its own colour. The hue is the only thing this component knows about
     the colour: lightness, chroma and the dark override are fixed in main.css and which category is
     which hue lives once in the shared contract. Regular weight rather than semibold, so the two
     coloured words on the row differ in weight before they differ in hue. The status is semibold at
     the row's other end and hue separation from the reserved status roles is not achievable, so
     position and weight are what tell a category from a status. No truncate: the two revision
     members differ only in their last word. -->
<span
  class="planning-cat-name whitespace-nowrap text-sm font-normal"
  role="cell"
  :style="{ '--planning-cat-hue': catHue }"
>
  {{ categoryLabel }}
</span>
```

## Layout regions

Unchanged in structure. Only the fifth region changes.

1. **Page container.** Title, week label, week switcher. Untouched.
2. **The week stack.** Seven day cards. Untouched.
3. **The day header band.** Three fixed zones. Loses its transparent 3 px left border only.
4. **The disclosure region.** Holds the column header line, which gains a visible `Catégorie`, and
   the task rows. `min-w-[52rem]` becomes `min-w-[62rem]`.
5. **The task row.** Eight tracks, no left border, a coloured category word in track 2.

## Component hierarchy

- `div.mx-auto.max-w-5xl.xl:max-w-6xl` (`pages/index.vue`, unchanged)
  - `PlanningWeek`
    - `PlanningDayCard` (`section`, `rounded-2xl`, `bg-default ring ring-accented shadow-md dark:bg-elevated dark:ring-default` on a work day, `border border-dashed border-accented bg-elevated dark:bg-default` on an off day)
      - the header band (`grid`, three zones, `PlanningCapacityBar`, `PlanningCapacityReading`)
      - the disclosure region (`grid-rows-[0fr]` to `grid-rows-[1fr]`)
        - `div.overflow-x-auto` → `div.min-w-[62rem][role=table]`
          - the column-header row, seven in-flow grid items, six of them `columnheader`
          - `div[role=rowgroup].divide-y.divide-default`
            - `PlanningTaskRow` (eight tracks)
              - grip cell, `role="presentation"`, `i-ph-dots-six-vertical-bold`
              - **the category cell, `.planning-cat-name`**
              - the identity cell, name plus both markers
              - the delivery cell, `formatDeadline`'s two parts
              - the words cell, unchanged
              - the duration cell, unchanged
              - `PlanningStatusBadge`, unchanged

No Nuxt UI primitive is added. The row is a grid of spans by design, and `AC12` forbids a badge, a
chip, a pill or a dot, so `UBadge` stays out. `UIcon` in the grip is the only Nuxt UI component in
the row and it does not change.

## Key Tailwind decisions

- **Row grid.** `grid grid-cols-[1rem_9rem_minmax(12rem,1fr)_9rem_7.5rem_4.5rem_6rem_3rem] gap-x-4 items-center px-5 py-[clamp(0.5rem,1.1vh,0.75rem)]`. Every track fixed but the name. The `border-l-[3px]` and both edge bindings are gone.
- **Category name.** `planning-cat-name whitespace-nowrap text-sm font-normal`. Colour from the class, hue from the inline custom property, nothing else.
- **Category header.** `text-[11px] font-medium uppercase tracking-wide text-toned`, inherited from the header row, no per-cell class.
- **Column-header row.** `grid grid-cols-[…same string…] gap-x-4 border-b border-default px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-toned`. Loses `border-l-[3px] border-l-transparent`.
- **Day header band.** Loses `border-l-[3px] border-l-transparent`, keeps everything else.
- **Scroll floor.** `min-w-[62rem]` on the `role="table"` wrapper.
- **Missing name.** `text-[15px] text-muted` with the `aria-hidden` em dash and an `sr-only` `notSet`.
- **Fluid values are untouched.** The row's `py-[clamp(0.5rem,1.1vh,0.75rem)]`, the band's `py-[clamp(0.75rem,1.6vh,1rem)]` and the container's `py-[clamp(1.25rem,3vh,2rem)]` all stand. Nothing in this feature adds a heading, so no new `clamp()` type ramp is needed.
- **Semantic tokens everywhere else.** `bg-default`, `bg-elevated`, `bg-accented`, `text-highlighted`, `text-muted`, `text-toned`, `border-default`, `ring-accented`. The only non-token colour on the row is the category, which is the sixth fixed role `main.css` already declares, and the status, which is a reserved semantic role.

## Responsive behaviour

There is one row layout and one header layout at every width, so `AC25` and `D14` hold. Nothing in
this feature adds a breakpoint.

- **`xl` and up (1280 px).** `max-w-6xl` gives the name track 296 px. Comfortable, no scroll.
- **1048 px to 1279 px.** The name track shrinks toward its 192 px minimum. No scroll.
- **Below 1048 px.** The day card scrolls horizontally inside its own `overflow-x-auto`, up to 32 px
  at a 1024 px viewport and more below. The page body never scrolls sideways. The scroller is a tab
  stop and is named by the day heading, unchanged.
- **320 px and 200 % zoom.** Unchanged from what ships. The card scrolls, and the header band's
  narrowed-but-not-solved problem is the same as before, since this feature does not touch the band's
  grid.

## Motion

**None added.** The only two transitions on this surface are the disclosure region's
`transition-[grid-template-rows] duration-150 ease-out` and the chevron's
`transition-transform duration-150`, and both already carry `motion-reduce:transition-none`. A
category name does not animate, does not fade in, and gets no hover treatment, because the row is
strictly read-only until `PLAN-11`. The `.btn-glow` ring is for buttons and has no business on a
table cell.

## What each build stage owns

- **`backend`.** `shared/categories.ts` for the colour contract, and `shared/planning.ts` for
  `formatDeadline`. Both are the shared layer, so they land together and `frontend` touches neither.
  `isTrackableCategory` and `formatDeliveryDate` come out byte-identical.
- **`frontend`.** `TaskRow.vue`, `DayCard.vue`, `app/assets/css/main.css`. No locale file changes,
  because every string this feature prints already exists.
- **`unit-test`.** The rewrite the spec describes, plus `formatDeadline` across the six rows of its
  behaviour table, plus the nine hues being unique and in range, plus `categoryHue` being total and
  returning 305 for `''`, `null`, `undefined`, a number, an object and a stale `'revision'`.
- **`accessibility`.** Re-measure the one binding cell, `translation` on an automne off-day card in
  light mode, expected at 5.07:1. Read one seeded card holding both a coloured category and a
  coloured status. Confirm the row announces its category once. Confirm the Tâche cell announces
  `Non précisé` rather than a bare dash. WCAG 1.4.1 is satisfied by construction and is not to be
  re-litigated.

## Open questions this blueprint does not close

- **Slate blue for `Relecture` is accepted, and what is left is telling the user's.** Not open in the way the
  other two items here are. Decision 3 overrides the user's literal pale grey with a measured reason, the
  owner has approved it, and it ships. What remains is that the owner tells the user it changed and why,
  and it stays the user's to overrule. A one-integer edit moves it back or moves it elsewhere under the
  whole-circle guarantee, so nothing is locked in by shipping first.
- **Whether `admin` at 305 and `dtp` at 60 are colours the user would have picked.** The user named neither, so
  these are chosen. Violet and ochre both sit in empty arcs and both measure clean, and either can be
  moved with a one-integer edit under the whole-circle guarantee.
- **Whether the olive cast of `Révision externe` in light mode reads as apple green's sibling on
  screen.** The measurement says the pair is the closest in the palette by a clear margin. The eye
  should confirm it on a seeded card holding both.
