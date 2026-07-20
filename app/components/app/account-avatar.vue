<script setup lang="ts">
// The initials circle shared by the header trigger, the header account popover, and the profile
// page. It renders the fallback initials from accountInitials on a solid primary fill, with the
// readable-on-primary text colour derived from the active theme, so the one idiom lives in a single
// place instead of being copied at each call site. The size and text scale come from the caller
// through a passthrough class (for example size-9, size-14, size-16 text-2xl).
//
// It is decorative in every current use: a visible name and email always sit next to it, so it is
// hidden from assistive technology to avoid announcing the bare initials as if they were content.
//
// When src is set (a stored avatar URL, or a local object-URL preview) it renders that image filling
// the circle instead of the initials; otherwise it falls back to the initials idiom. The image is a
// native <img> so an object-URL preview and a remote URL take the exact same path and no image-domain
// allowlist is involved. It carries an empty alt and stays inside the aria-hidden wrapper because the
// avatar is decorative here, mirrored by the visible name and email beside it.
const props = defineProps<{ initials: string; src?: string | null }>()

const { activeOnPrimary } = useTheme()

// If the <img> fails to load (the serve route 404s because the object is gone though the column is
// set, or 401s because the cookie is missing on the image request), fall back to the initials circle
// instead of a broken-image icon. Reset on every src change so a new file pick or a successful
// re-upload gets a fresh attempt rather than staying stuck on the fallback.
const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false)
)
</script>

<template>
  <span
    aria-hidden="true"
    class="grid place-items-center overflow-hidden rounded-full bg-primary font-semibold"
    :style="{ color: activeOnPrimary }"
  >
    <img
      v-if="src && !failed"
      alt=""
      class="aspect-square size-full rounded-full object-cover"
      :src="src"
      @error="failed = true"
    />
    <template v-else>{{ initials }}</template>
  </span>
</template>
