<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { t } = useI18n()
const { clear } = useUserSession()
const localePath = useLocalePath()

const user = { fname: 'Alexandre ', lname: 'Gilbert' }
const username = user.fname + ' ' + user.lname

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return t('header.greetingMorning', { name: user.fname })
  if (hour < 18) return t('header.greetingAfternoon', { name: user.fname })
  return t('header.greetingEvening', { name: user.fname })
})

async function logout() {
  await clear()
  await navigateTo(localePath('/login'))
}

const items = ref<DropdownMenuItem[][]>([
  [{ label: t('header.profile'), icon: 'i-carbon-user' }],
  [{ label: t('header.logout'), icon: 'i-carbon-logout', onSelect: logout }]
])
</script>

<template>
  <UHeader :ui="{ container: 'max-w-full' }">
    <template #title
      ><div class="flex items-center gap-2"><AppLogo class="h-7" />{{ t('app.name') }}</div>
    </template>
    <template #right>
      <UDropdownMenu :items="items">
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted">{{ greeting }}</span>
          <UAvatar :alt="username" fallback="AG" /></div
      ></UDropdownMenu>
    </template>
  </UHeader>
</template>
