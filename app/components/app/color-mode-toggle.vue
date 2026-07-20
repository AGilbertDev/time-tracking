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
    <!-- Ghost icon control. It reads as a bare icon, not a visible button, so glow-off opts
         it out of the app-wide button glow ring; the hover feedback is the color change plus
         the motion-safe scale. hover:text-primary is unconditional; the scale is gated by
         motion-safe so it never moves for users who opt out. The sun/moon glyph flips on
         a mode change via the shared AppFlipSwap keyed on the resolved mode. -->
    <UButton
      :aria-label="t('theme.mode')"
      class="glow-off transition-colors duration-200 hover:text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-110"
      color="neutral"
      size="lg"
      square
      variant="ghost"
      @click="isDark = !isDark"
    >
      <AppFlipSwap :swap-key="isDark ? 'dark' : 'light'">
        <UIcon class="size-5" :name="isDark ? 'i-ph-moon' : 'i-ph-sun'" />
      </AppFlipSwap>
    </UButton>
    <template #fallback>
      <div class="size-9" />
    </template>
  </ClientOnly>
</template>
