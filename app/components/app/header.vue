<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { t, locale, setLocale } = useI18n()
const { clear, user } = useUserSession()
const localePath = useLocalePath()

// The language menu item shows the active locale and toggles to the other on click.
const otherLocale = computed(() => (locale.value === 'fr' ? 'en' : 'fr'))

const firstName = computed(() => user.value?.firstName ?? '')
const username = computed(() =>
  `${user.value?.firstName ?? ''} ${user.value?.lastName ?? ''}`.trim()
)

// Build initials from the first and last name for the avatar fallback.
const initials = computed(() => {
  const first = user.value?.firstName?.[0] ?? ''
  const last = user.value?.lastName?.[0] ?? ''
  return (first + last).toUpperCase()
})

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return t('header.greetingMorning', { name: firstName.value })
  if (hour < 18) return t('header.greetingAfternoon', { name: firstName.value })
  return t('header.greetingEvening', { name: firstName.value })
})

async function logout() {
  await clear()
  await navigateTo(localePath('signin'))
}

const items = computed<DropdownMenuItem[][]>(() => [
  [{ label: t('header.profile'), icon: 'i-carbon-user' }],
  [
    {
      label: t('header.language', { code: locale.value.toUpperCase() }),
      icon: 'i-carbon-language',
      onSelect: () => setLocale(otherLocale.value)
    }
  ],
  [{ label: t('header.logout'), icon: 'i-carbon-logout', onSelect: logout }]
])
</script>

<template>
  <UHeader :ui="{ container: 'max-w-full' }">
    <template #title>
      <NuxtLink :aria-label="t('app.name')" :to="localePath('index')">
        <AppLogo class="h-12" />
      </NuxtLink>
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <span class="text-muted">{{ greeting }}</span>
        <UDropdownMenu :items="items">
          <UAvatar :alt="username" size="3xl" :text="initials" />
        </UDropdownMenu>
      </div>
    </template>
  </UHeader>
</template>
