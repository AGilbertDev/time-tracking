<script setup lang="ts">
const { activeId, active, activeOnPrimary } = useTheme()

// First-paint atmosphere guard. The server can't know the OS color scheme for
// `system` users, so the SSR-rendered data-theme may be the wrong (light) pick.
// This runs synchronously before paint — the same technique color-mode uses for
// the .dark class — resolving dark via matchMedia and reading the theme cookies,
// so the correct atmosphere is set before the browser paints. No flash.
const noFlashTheme = `(function(){try{
  function c(n){var m=document.cookie.match('(?:^|;\\\\s*)'+n+'=([^;]*)');return m&&decodeURIComponent(m[1]);}
  var p;try{p=localStorage.getItem('nuxt-color-mode');}catch(e){}
  p=p||c('nuxt-color-mode')||'system';
  var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  var t=(d?c('ui-theme-dark'):c('ui-theme-light'))||'pastel';
  document.documentElement.setAttribute('data-theme',t);
}catch(e){}})();`

// Apply the active atmosphere to the html element, expose a brightness-derived
// on-primary text color so labels stay legible on any primary fill, and recolor
// the favicon to match.
useHead({
  script: [{ innerHTML: noFlashTheme, tagPosition: 'head', tagPriority: 'critical' }],
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
