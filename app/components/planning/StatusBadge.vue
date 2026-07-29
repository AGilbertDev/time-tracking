<script setup lang="ts">
import type { StatusKey } from '#shared/planning'

// The text status badge. A trackable task shows its status coloured by the reserved semantic role
// (Accepté info, En cours warning, En retard error, Terminé success) through a subtle UBadge. A
// non-trackable task shows an N/A badge with a dashed faint border, rendered as a raw span because a
// UBadge cannot draw a dashed border. The label always comes through i18n.
const { statusKey } = defineProps<{ statusKey: StatusKey }>()

const { t } = useI18n()

const color = computed<'info' | 'warning' | 'error' | 'success'>(() => {
  if (statusKey === 'accepte') return 'info'
  if (statusKey === 'encours') return 'warning'
  // A missed delivery is a problem rather than a stage, so it takes the error role and reads red in
  // every theme, matching the overbooked capacity reading and the late dot.
  if (statusKey === 'retard') return 'error'
  return 'success'
})

// Nuxt UI's subtle variant paints the label with the semantic 500 shade in light mode, which fails
// AA on the pale 10% wash (amber ~2:1, green ~2:1, blue ~3.3:1, red ~3.4:1). Darken the label to the
// 700 shade in light so every status reads at 4.5:1 while keeping the wash and the theme-agnostic
// status colour. Dark mode already clears AA at 400, so it is left untouched.
const textClass = computed(() => {
  if (color.value === 'info') return 'text-info-700 dark:text-info-400'
  if (color.value === 'warning') return 'text-warning-700 dark:text-warning-400'
  if (color.value === 'error') return 'text-error-700 dark:text-error-400'
  return 'text-success-700 dark:text-success-400'
})

const label = computed(() => t(`planning.status.${statusKey}`))
</script>

<template>
  <!-- Both forms fill the width of the fixed grid track they sit in, so every status on a card is the
       same size and its edges line up down the column whatever the label's length. -->
  <UBadge
    v-if="statusKey !== 'na'"
    :class="['w-full justify-center', textClass]"
    :color="color"
    :label="label"
    size="sm"
    variant="subtle"
  />
  <span
    v-else
    class="inline-flex w-full items-center justify-center rounded-md border border-dashed border-accented px-3 py-1 text-xs font-semibold text-muted"
  >
    {{ label }}
  </span>
</template>
