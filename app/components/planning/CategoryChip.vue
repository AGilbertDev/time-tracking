<script setup lang="ts">
// The category chip. Category is meaning-neutral in the calmer week, so the chip is a plain neutral
// badge rather than a coloured wash: colour is reserved for the task status and the capacity meter.
// The neutral subtle badge already reads at ~12:1, so it needs no AA label override. The label is the
// localized category name resolved from the existing categories.<id> keys, never the raw stored id.
// The caller passes an already-coerced category id so an unknown value has resolved to admin.
const { categoryId } = defineProps<{ categoryId: string }>()

const { t } = useI18n()

const label = computed(() => t(`categories.${categoryId}`))
</script>

<template>
  <UBadge class="rounded-full" color="neutral" :label="label" size="sm" variant="subtle" />
</template>
