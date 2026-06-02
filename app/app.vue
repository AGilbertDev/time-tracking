<script setup lang="ts">
const { activeId, active, activeOnPrimary } = useTheme()

// Apply the active atmosphere to the html element, expose a brightness-derived
// on-primary text color so labels stay legible on any primary fill, and recolor
// the favicon to match.
useHead({
  htmlAttrs: {
    'data-theme': activeId,
    style: computed(() => `--ui-text-inverted:${activeOnPrimary.value}`)
  },
  link: [
    {
      rel: 'icon',
      type: 'image/svg+xml',
      href: computed(() => themeFavicon(active.value.ink, active.value.primary))
    }
  ]
})
</script>

<template>
  <UApp>
    <NuxtLayout><NuxtPage /></NuxtLayout>
  </UApp>
</template>
