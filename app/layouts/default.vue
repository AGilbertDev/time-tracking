<script setup lang="ts"></script>

<template>
  <div class="flex min-h-dvh flex-col">
    <AppHeader />
    <UMain>
      <slot />
    </UMain>
    <AppFooter />
  </div>
</template>
