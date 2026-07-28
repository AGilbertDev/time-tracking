# Alléger la semaine

A styling and copy refinement pass over the read-only planning week that already
shipped. This is not a new feature and it does not re-spec the week. The behaviour,
the data, the capacity math, the schedule resolver, and the week navigation all stay
exactly as specified in [`read-only-week-capacity-and-nav.md`](read-only-week-capacity-and-nav.md)
(which sits on Bout 1, [`week-with-task-rows.md`](week-with-task-rows.md)). This note
records only the visual treatment and copy changes. The layout reference is the same
mockup, [`dashboard-mockup.html`](dashboard-mockup.html).

## Problem

The week reads visually heavy. There are too many similar colours, the day cards blend
into the page background and into each other, and the category chips add coloured washes
that carry no meaning. The eye has to work to tell one card, one band, or one row from
the next.

## Guiding principle

Two rules drive every change below.

- **La couleur = du sens, pas de la décoration.** Colour is reserved for meaning, never
  for decoration. Semantic colour stays only where it reports a state, which is the task
  status and the capacity meter. Everything else is neutral.
- **Montre juste ce qui est fonctionnel.** The interface shows only what is functional.
  A line that does not help the user do or read something is removed.

The per-day-card content is liked and stays. The fields and the task rows are kept as
they are. Only the visual treatment and the copy change.

## Acceptance criteria

Each visual change applies to both light and dark mode.

- **AC1. Card separation.** Each work-day card reads as a distinct object against the page
  background. Raise the contrast between the page background and the card surface, give the
  card a subtle border and a soft shadow, and widen the gap between stacked cards (today the
  stack is `space-y-3.5` in `Week.vue` and the card is `bg-default ring ring-default
  shadow-sm` in `DayCard.vue`). Cards no longer melt into the background or into one another.
- **AC2. Day header structural tone.** On a work-day card the day header sits on a subtly
  darker or muted structural fill against the card body, so the header reads as its own band.
  The tone is structural and neutral, never a loud or saturated colour. Today this header
  has no fill, only a bottom border.
- **AC3. Off-day (Congé) cards.** Replace the current dashed transparent treatment
  (`border border-dashed border-default`) with a solid muted or secondary grey fill that
  reads clearly as off while staying solid. In both cases below the card keeps the solid
  muted treatment, the `Congé` label with no positional suffix (see the copy changes), and
  no capacity meter, because an off-day carries no quota and must never be shown as
  overbooked.
  - **Off-day with no tasks**, the common case. The card is the slim compact strip, a single
    line rather than a full-height empty card, with no meter and no rows. This matches the
    user's "empty card" intent.
  - **Off-day that holds recorded work.** It still reads as an off-day with the same solid
    muted treatment and `Congé` label and still shows no meter, but it renders its task rows,
    so it is not the slim single-line strip when it has content. Recorded weekend or holiday
    work must stay visible. This is the do-not-police rule (AGENTS.md, "the app records
    reality, not what the schedule says reality should be"), and the shipped `DayCard.vue`
    already behaves this way, since its `<ul v-if="tasks.length">` sits outside the work-day
    condition. Hiding those rows would be a regression, not a simplification.
- **AC4. Colour equals meaning only.** Neutralise the category chips, dropping the teal
  (translation) and purple / secondary (revision) washes in `CategoryChip.vue` in favour of
  a neutral chip, or a small neutral dot with plain text. Keep semantic colour only on the
  task status (Accepté, En cours, Terminé) and the capacity meter fill (good, warn, bad),
  and desaturate or soften even those so they signal calmly rather than shout. The softened
  status and meter tones must still clear the contrast bar the accessibility stage checks.
- **AC5. Calmer spacing.** Give the card a consistent vertical rhythm, less dense padding,
  and a clear hierarchy between the header, the meter, and the rows.
- **AC6. Capacity bars same length and aligned.** The day header reserves a fixed-width
  column for the day name and date, so the meter track starts at the same x position and has
  the same width on every work-day card regardless of how long the day name is, and the bars
  line up down the week. Today the meter is `ml-auto min-w-60 flex-1` sitting after a
  variable-width day heading in `DayCard.vue`, so the track start drifts by day.
- **AC7. Page title copy.** `planning.title` reads `Tableau de bord` (FR) and `Dashboard`
  (EN). It is used at `index.vue:29` (the SEO title) and `index.vue:203` (the `h1`).
- **AC8. Remove non-trackable meta.** A non-trackable row no longer shows the
  `retirée des heures effectives` line. The `planning.nonTrackableMeta` key and its use in
  `TaskRow.vue` are removed, so the row shows only what is functional.

### Copy / i18n changes

An unambiguous checklist for the frontend stage. Apply the removals and the change in both
`i18n/locales/fr.json` and `i18n/locales/en.json`.

**Keys removed** (delete the key in both locale files and the code that reads it):

- `planning.offDay.sundaySuffix` — read at `index.vue:168`.
- `planning.offDay.saturdaySuffix` — read at `index.vue:169`.
- `planning.nonTrackableMeta` — read at `TaskRow.vue:42`.

After removing the two suffixes, the off-day branch in `index.vue` (lines 165 to 171)
collapses so `offLabel` is just `planning.offDay.base` for every off day, with no Sunday or
Saturday distinction.

**Key changed:**

| Key | FR before | FR after | EN before | EN after |
| --- | --- | --- | --- | --- |
| `planning.title` | `Planning de traduction` | `Tableau de bord` | `Translation planning` | `Dashboard` |

**Kept.** `planning.offDay.base` stays `Congé` (FR) and `Day off` (EN).

The FR copy is Québécois. The space-before-punctuation rule applies to any FR string, and
`Tableau de bord` carries none of `? ! : ;`, so the rule holds but is not triggered here.

## Out of scope

No data or logic change, no new fields, no backend, no new endpoint, and no new page. The
task rows and their fields are unchanged. The capacity math, the schedule resolver, the
duration formatting, the week switcher behaviour, and the off-day work-day classification
are all untouched. The shared pure helpers keep their signatures. Neutralising the chip is a
view-layer change only, so any now-unused colour mapping inside `CategoryChip.vue` may be
tidied, but no shared helper's behaviour changes.

Because nothing spans more than one request or holds a token or a session, this refinement
adds no new interrupted or abandoned path. The existing recoverable load-error state and the
`Cette semaine` recovery from the shipped week are unchanged and still apply.

## Stages

Specs and code review are never skipped.

- **Design** runs. It maps the calmer treatment (card separation, the header tone, the solid
  slim off-day card, the neutral chip, and the softened semantic tones) onto the project's
  semantic tokens for both modes, and confirms the `Tableau de bord` copy.
- **Frontend** runs. It applies the eight changes above and the copy edits.
- **Accessibility** runs. Softening the status and meter colours and introducing a solid
  off-day fill both touch contrast, so the pass confirms the new tones still meet AA and that
  the numeric capacity reading stays the accessible carrier.
- **Backend** is skipped. There is no schema, endpoint, query, or data change.
- **Compliance** is skipped. No new personal data, no email, no third-party asset, and no
  public content. This stays the same authenticated dashboard.
- **SEO** is skipped. The page is an authenticated dashboard behind sign-in, already
  `noindex, nofollow`, so the title copy change is not an indexing concern.
- **Unit-test** is skipped. No pure logic changes. The capacity math, the resolver, and the
  duration formatting are unchanged, and their existing tests still cover them.

## Open questions

None. Every change and every affected key is specified above.
