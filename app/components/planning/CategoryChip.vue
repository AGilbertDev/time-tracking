<script setup lang="ts">
import { chipVariant } from '#shared/planning'

// The category chip. The chipVariant to colour map lives only here: translation gets the primary
// wash, revision the accent (secondary) wash, everything else the neutral chip. The label is the
// localized category name resolved from the existing categories.<id> keys, never the raw stored id.
// The caller passes an already-coerced category id so an unknown value has resolved to admin.
const { categoryId } = defineProps<{ categoryId: string }>()

const { t } = useI18n()

const color = computed<'primary' | 'secondary' | 'neutral'>(() => {
  const variant = chipVariant(categoryId)
  if (variant === 'trad') return 'primary'
  if (variant === 'rev') return 'secondary'
  return 'neutral'
})

// The subtle variant labels the chip with the 500 shade in light mode, which slips just under AA on
// the pale wash in some themes (primary and secondary both dip to ~4:1). Darken the label to the 700
// shade in light so every theme clears 4.5:1 while the wash stays. Secondary also grazes AA at 400 in
// one dark theme, so its dark label lifts to 300; primary already clears AA in dark and stays at 400.
// The neutral chip already reads at 12:1, so it takes no override.
const textClass = computed(() => {
  if (color.value === 'primary') return 'text-primary-700 dark:text-primary-400'
  if (color.value === 'secondary') return 'text-secondary-700 dark:text-secondary-300'
  return ''
})

const label = computed(() => t(`categories.${categoryId}`))
</script>

<template>
  <UBadge
    :class="['rounded-full', textClass]"
    :color="color"
    :label="label"
    size="sm"
    variant="subtle"
  />
</template>
