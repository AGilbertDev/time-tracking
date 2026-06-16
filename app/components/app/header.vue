<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

// The menu carries custom fields on the atmosphere rows, so the slot props know about them.
interface MenuItem extends DropdownMenuItem {
  active?: boolean
  swatch?: ThemePalette
}

const { t, locale, setLocale } = useI18n()
const { clear, user } = useUserSession()
const localePath = useLocalePath()
const { isDark, lightTheme, darkTheme, themes, activeOnPrimary } = useTheme()

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

// Only the picker for the current mode is shown, and each atmosphere previews its
// own swatch for that mode. The active one gets a check via the trailing slot.
const items = computed<MenuItem[][]>(() => {
  const current = isDark.value ? darkTheme : lightTheme
  const atmospheres = themes.map((option) => ({
    label:
      t(`theme.names.${option.id}.${isDark.value ? 'dark' : 'light'}`) +
      (option.default ? ` ${t('theme.default')}` : ''),
    swatch: isDark.value ? option.dark : option.light,
    active: current.value === option.id,
    onSelect: () => {
      current.value = option.id
    }
  }))

  return [
    [{ label: t('header.profile'), icon: 'i-carbon-user' }],
    [
      {
        label: isDark.value ? t('theme.dark') : t('theme.light'),
        icon: isDark.value ? 'i-carbon-moon' : 'i-carbon-sun',
        children: atmospheres
      }
    ],
    [
      {
        label: t('header.language', { code: locale.value.toUpperCase() }),
        icon: 'i-carbon-language',
        onSelect: () => setLocale(otherLocale.value)
      }
    ],
    [{ label: t('header.logout'), icon: 'i-carbon-logout', onSelect: logout }]
  ]
})
</script>

<template>
  <UHeader :toggle="false" :ui="{ container: 'max-w-full px-4 sm:px-6 lg:px-8' }">
    <template #title>
      <NuxtLink :aria-label="t('app.name')" :to="localePath('index')">
        <AppLogo class="h-8 sm:h-10" />
      </NuxtLink>
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <span class="hidden text-sm text-muted sm:inline">{{ greeting }}</span>
        <AppColorModeToggle />
        <UDropdownMenu :items="items" :ui="{ content: 'w-56' }">
          <button
            :aria-label="username"
            class="grid size-9 cursor-pointer place-items-center rounded-full bg-primary text-sm font-semibold"
            :style="{ color: activeOnPrimary }"
            type="button"
          >
            {{ initials }}
          </button>

          <!-- Atmosphere rows show a swatch, every other row keeps its icon. -->
          <template #item-leading="{ item }">
            <span v-if="item.swatch" class="flex -space-x-1">
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: item.swatch.canvas }"
              />
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: item.swatch.primary }"
              />
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: item.swatch.accent }"
              />
            </span>
            <UIcon v-else-if="item.icon" class="size-5 text-dimmed" :name="item.icon" />
          </template>

          <!-- Restore the submenu chevron, and mark the active atmosphere. -->
          <template #item-trailing="{ item }">
            <UIcon v-if="item.children" class="size-4 text-dimmed" name="i-carbon-chevron-right" />
            <UIcon v-else-if="item.active" class="size-4 text-primary" name="i-carbon-checkmark" />
          </template>
        </UDropdownMenu>
      </div>
    </template>
  </UHeader>
</template>
