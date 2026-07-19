<script setup lang="ts">
// The shared 3D flip primitive. It wraps a single changing glyph so that when the
// swapKey changes the old glyph rotates out and the new one rotates in, matching the
// header color-mode and language controls to the auth language toggle from one place.
// The motion is gated behind prefers-reduced-motion below, dropping to an opacity-only
// crossfade with no layout shift for users who opt out.
defineProps<{
  // The value that identifies the current glyph. A change re-keys the Transition and
  // triggers the flip. Pass the mode or the locale that the glyph represents.
  swapKey: string | number
}>()
</script>

<template>
  <span class="block perspective-[600px]">
    <Transition mode="out-in" name="flip">
      <!-- Flex-center the glyph so an inline icon aligns to the box center instead of
           the text baseline, which otherwise pushes it up by the font's descender gap.
           A single line of text stays centered too. -->
      <span :key="swapKey" class="flex items-center justify-center"><slot /></span>
    </Transition>
  </span>
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
