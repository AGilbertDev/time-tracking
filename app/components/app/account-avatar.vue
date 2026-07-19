<script setup lang="ts">
// The initials circle shared by the header trigger, the header account popover, and the profile
// page. It renders the fallback initials from accountInitials on a solid primary fill, with the
// readable-on-primary text colour derived from the active theme, so the one idiom lives in a single
// place instead of being copied at each call site. The size and text scale come from the caller
// through a passthrough class (for example size-9, size-14, size-16 text-2xl).
//
// It is decorative in every current use: a visible name and email always sit next to it, so it is
// hidden from assistive technology to avoid announcing the bare initials as if they were content.
defineProps<{ initials: string }>()

const { activeOnPrimary } = useTheme()
</script>

<template>
  <span
    aria-hidden="true"
    class="grid place-items-center rounded-full bg-primary font-semibold"
    :style="{ color: activeOnPrimary }"
  >
    {{ initials }}
  </span>
</template>
