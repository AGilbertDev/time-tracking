<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <UFooter :ui="{ root: 'bg-elevated', container: 'py-3 sm:py-4' }">
    <template #default>
      <p class="text-xs text-muted sm:text-sm">
        &copy; {{ new Date().getFullYear() }} Alexandre Gilbert. {{ t('footer.rights') }}
      </p>
    </template>
  </UFooter>
</template>
