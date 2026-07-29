<script setup lang="ts">
import type { StatusKey } from '#shared/planning'

// The small colour dot that sits beside the text status badge, so the status reads at a glance and
// in full. The statusKey to colour map lives only here. Status colours use the reserved semantic
// tokens (info / warning / success) so they read the same in every theme, never recoloured by the
// active atmosphere. The non-trackable dot is the dimmed text token at half opacity.
const { statusKey } = defineProps<{ statusKey: StatusKey }>()

const dotClass: Record<StatusKey, string> = {
  accepte: 'bg-[var(--ui-info)]',
  encours: 'bg-[var(--ui-warning)]',
  termine: 'bg-[var(--ui-success)]',
  // A missed delivery is the one status that is a problem rather than a stage, so it takes the error
  // token, the same red the overbooked capacity reading uses.
  retard: 'bg-[var(--ui-error)]',
  na: 'bg-[var(--ui-text-dimmed)] opacity-50'
}
</script>

<template>
  <span aria-hidden="true" class="size-2.5 shrink-0 rounded-full" :class="dotClass[statusKey]" />
</template>
