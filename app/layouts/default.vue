<script setup lang="ts"></script>

<template>
  <div class="flex min-h-dvh flex-col">
    <AppHeader />
    <UMain class="bg-muted">
      <slot />
    </UMain>
    <USeparator />
    <AppFooter />
  </div>
</template>
