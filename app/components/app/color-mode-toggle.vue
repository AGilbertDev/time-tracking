<script setup lang="ts">
const { t } = useI18n()
const colorMode = useColorMode()

const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (value) => {
    colorMode.preference = value ? 'dark' : 'light'
  }
})
</script>

<template>
  <!-- The color mode is only known on the client, so guard against a hydration mismatch. -->
  <ClientOnly>
    <UButton
      :aria-label="t('theme.mode')"
      color="neutral"
      :icon="isDark ? 'i-ph-moon' : 'i-ph-sun'"
      variant="ghost"
      @click="isDark = !isDark"
    />
    <template #fallback>
      <div class="size-8" />
    </template>
  </ClientOnly>
</template>
