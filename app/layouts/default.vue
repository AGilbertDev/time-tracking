<script setup lang="ts"></script>

<template>
  <!-- The shell canvas is a flat background-color. Per the owner's UI correction the
       app shell carries no page gradient; the .page-radial stays reserved for the auth
       pages only. -->
  <div class="flex min-h-dvh flex-col bg-muted dark:bg-(--ui-color-neutral-950)">
    <AppHeader />
    <UMain>
      <slot />
    </UMain>
    <AppFooter />
  </div>
</template>
