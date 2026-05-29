<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { t } = useI18n()
const user = { name: 'Test' }
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return t('header.greetingMorning', { name: user.name })
  if (hour < 18) return t('header.greetingAfternoon', { name: user.name })
  return t('header.greetingEvening', { name: user.name })
})
const items = ref<DropdownMenuItem[][]>([
  [{ label: t('header.profile'), icon: 'i-carbon-user' }],
  [{ label: t('header.logout'), icon: 'i-carbon-logout' }]
])
</script>

<template>
  <UHeader :ui="{ container: 'max-w-full' }">
    <template #title
      ><div class="flex items-center gap-2">
        <UIcon name="i-carbon-calendar" />{{ t('app.name') }}
      </div>
    </template>
    <template #right
      ><UDropdownMenu :items="items"
        ><span class="text-sm text-muted">{{ greeting }}</span
        ><UAvatar :alt="user.name" fallback="T"></UAvatar
      ></UDropdownMenu>
    </template>
  </UHeader>
</template>
