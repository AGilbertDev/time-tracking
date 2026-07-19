<script setup lang="ts">
const { t, locale, setLocale } = useI18n()
const { savePreferences } = usePreferences()

// Toggle targets whichever locale is not currently active.
const otherLocale = computed(() => oppositeLocale(locale.value))

// Switch the interface immediately, then persist so the choice follows the user to
// another device. savePreferences is a no-op for a signed-out visitor, so the same
// control serves the auth pages and the authenticated header.
function switchLocale() {
  setLocale(otherLocale.value)
  savePreferences({ locale: otherLocale.value })
}
</script>

<template>
  <button
    :aria-label="t('a11y.switchLocale')"
    class="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md font-semibold text-primary transition-transform duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:hover:scale-110"
    type="button"
    @click="switchLocale"
  >
    <AppFlipSwap :swap-key="locale">
      <span aria-hidden="true">{{ locale.toUpperCase() }}</span>
    </AppFlipSwap>
  </button>
</template>
