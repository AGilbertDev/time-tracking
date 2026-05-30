<script setup lang="ts">
const { t, locale, setLocale } = useI18n()

// Toggle targets whichever locale is not currently active.
const otherLocale = computed(() => (locale.value === 'fr' ? 'en' : 'fr'))
</script>

<template>
  <button
    :aria-label="t('a11y.switchLocale')"
    class="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md font-semibold text-primary perspective-[600px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    type="button"
    @click="setLocale(otherLocale)"
  >
    <Transition mode="out-in" name="flip">
      <span :key="locale" aria-hidden="true" class="block">{{ locale.toUpperCase() }}</span>
    </Transition>
  </button>
</template>

<style scoped>
.flip-enter-active,
.flip-leave-active {
  transition:
    transform 0.35s,
    opacity 0.35s;
  transform-style: preserve-3d;
}
.flip-enter-from {
  transform: rotateY(-90deg);
  opacity: 0;
}
.flip-leave-to {
  transform: rotateY(90deg);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .flip-enter-active,
  .flip-leave-active {
    transition: opacity 0.15s;
    transform: none;
  }
  .flip-enter-from,
  .flip-leave-to {
    transform: none;
  }
}
</style>
