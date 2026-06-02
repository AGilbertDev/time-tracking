<script setup lang="ts"></script>

<template>
  <div class="flex min-h-dvh flex-col">
    <AppHeader />
    <UMain class="bg-muted dark:bg-(--ui-color-neutral-950)">
      <slot />
    </UMain>
    <AppFooter />
  </div>
</template>
