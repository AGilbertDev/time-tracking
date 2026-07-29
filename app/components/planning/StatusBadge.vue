<script setup lang="ts">
import type { StatusKey } from '#shared/planning'

// The task row's single status carrier. It used to sit beside a coloured dot that encoded the same
// fact; the dot is gone, so this is the only thing on the row that says where a task stands, and it
// stays labelled rather than becoming a colour, because a status read only by hue is not readable
// at all (WCAG 1.4.1).
//
// It also lost its pill. Five filled boxes stacked down one column were the heaviest texture on a
// day card, and the label and its colour are what carried the meaning, never the rectangle around
// them. What is left is coloured semibold text on the plain card surface.
//
// A non-trackable task shows the em dash instead of the N/A label. A break or a meeting has no
// status rather than having a status called "not applicable", and the em dash is what the same
// row's Mots cell already prints, so the two read as one statement that neither figure applies.
// This is presentational only: `statusKey` still resolves to `na` and the shared contract, the
// server resolution, and the planning.status.na key are untouched. The key is in fact still read,
// as the accessible name behind the glyph, because a bare em dash announces as nothing.
const { statusKey } = defineProps<{ statusKey: StatusKey }>()

const { t } = useI18n()

// The status hues are the reserved semantic roles, so they read the same in every theme rather than
// being recoloured by the active atmosphere. A missed delivery is a problem rather than a stage, so
// it takes the error role and reads red, matching the overbooked capacity reading.
//
// `success` is emerald rather than green, and the reason belongs here as well as in app.config.ts,
// because this is the component that renders it. green-800 sat an Oklab chord of 0.0336 from the
// printed name of `revision_internal`, which is closer than the two revision categories are to each
// other, so a completed internal revision put nearly the same green in two cells of one row. Under
// simulated protanopia that fell to about one just-noticeable difference. emerald-800 lifts it to
// 0.0604, and 0.0548 under protanopia. A category hue is the primary user's own colour, so the
// reserved role is what moved. Do not put it back to green without re-measuring that pair.
//
// The light shade is 800 rather than the 700 the blueprint carried over from the badge. Losing the
// pale wash was assumed to improve the ratio, and on a work-day card it does. An off day that holds
// recorded weekend work is a card on the muted surface, and there the 700 shades measure 3.98:1 to
// 4.31:1 for the success and warning roles across the five themes, under the 4.5:1 this 14 px text
// needs. At 800 every role clears 5.7:1 on that surface and 7:1 on the work-day card. Dark stays at
// 400, which measures 5.2:1 or better everywhere.
//
// Re-measured on the rendered page after the emerald move, sampling the drawn pixels rather than the
// token definitions. Every one of the four coloured roles still clears 4.5:1 on all twenty card
// surfaces. The worst readings are `En retard` at 5.16:1 on a pastel dark work-day card, `En cours` at
// 5.71:1 on an automne light off-day card, `Accepté` at 5.64:1 on a pastel dark work-day card, and
// `Terminé` at 6.13:1 on an automne light off-day card. `Terminé` improved from 5.74:1, because
// emerald-800 is slightly darker than green-800, so the hue move helped contrast as well as
// separation.
const toneClass: Record<StatusKey, string> = {
  accepte: 'font-semibold text-info-800 dark:text-info-400',
  encours: 'font-semibold text-warning-800 dark:text-warning-400',
  retard: 'font-semibold text-error-800 dark:text-error-400',
  termine: 'font-semibold text-success-800 dark:text-success-400',
  na: 'font-normal text-muted'
}

const label = computed(() => t(`planning.status.${statusKey}`))
</script>

<template>
  <!-- One root, so the `role="cell"` the row hands down always lands on it. A status that does not
       apply prints the em dash and says `N/A`. The glyph alone is punctuation a screen reader either
       skips or reads as "dash", so the cell would announce as empty under a header that says
       `Statut` and a listener could not tell a status the row cannot have from a real one. The
       visible mark is unchanged. -->
  <span class="text-sm" :class="toneClass[statusKey]">
    <template v-if="statusKey === 'na'">
      <span aria-hidden="true">{{ t('planning.emDash') }}</span>
      <span class="sr-only">{{ label }}</span>
    </template>
    <template v-else>{{ label }}</template>
  </span>
</template>
