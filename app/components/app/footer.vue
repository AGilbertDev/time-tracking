<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <UFooter>
    <template #default>
      <p class="text-muted text-sm">
        &copy; {{ new Date().getFullYear() }} Alexandre Gilbert. {{ t('footer.rights') }}
      </p>
    </template>
  </UFooter>
</template>
