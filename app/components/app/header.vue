<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

// The menu carries custom fields on the theme rows, so the slot props know about them.
interface MenuItem extends DropdownMenuItem {
  active?: boolean
  swatch?: ThemePalette
}

const { t, locale, setLocale } = useI18n()
const { clear, user } = useUserSession()
const localePath = useLocalePath()
const { isDark, lightTheme, darkTheme, themes, activeOnPrimary } = useTheme()
const { savePreferences } = usePreferences()

// The language control lives inside the account popover, not the nav bar. It targets
// whichever locale is not active, switches the interface immediately for responsiveness,
// then persists the choice so it follows the user to another device.
const otherLocale = computed(() => oppositeLocale(locale.value))
function switchLocale() {
  setLocale(otherLocale.value)
  savePreferences({ locale: otherLocale.value })
}

const firstName = computed(() => user.value?.firstName ?? '')
const username = computed(() => accountName(user.value?.firstName, user.value?.lastName))

// Build initials from the first and last name for the avatar fallback.
const initials = computed(() => accountInitials(user.value?.firstName, user.value?.lastName))

// The greeting depends on the visitor's local hour, which the server cannot know,
// so deriving it during SSR mismatches on hydration. It is gated on mount and stays
// empty until then, then reacts to the name and the locale like any other computed.
const isMounted = ref(false)
onMounted(() => {
  isMounted.value = true
})
const greeting = computed(() => {
  if (!isMounted.value) return ''
  const hour = new Date().getHours()
  if (hour < 12) return t('header.greetingMorning', { name: firstName.value })
  if (hour < 18) return t('header.greetingAfternoon', { name: firstName.value })
  return t('header.greetingEvening', { name: firstName.value })
})

async function logout() {
  await clear()
  await navigateTo(localePath('signin'))
}

// The navigation items link ahead to pages that do not exist yet. With customRoutes
// set to config, useLocalePath only resolves a pages-map key once a matching page file
// exists, so until those pages land it returns the key unchanged instead of a localized
// path. navPath reads the NAV_ROUTES map, which mirrors the nuxt.config i18n pages map,
// and selects the path for the active locale so each link reaches its real localized
// route and cleanly 404s. Swap this for useLocalePath once the destination pages exist.

// Only the picker for the current mode is shown, and each theme previews its own
// swatch for that mode. Theme names are one proper noun per theme, identical across
// modes and locales. The active one gets a check via the trailing slot.
const items = computed<MenuItem[][]>(() => {
  const current = isDark.value ? darkTheme : lightTheme
  const themeRows = themes.map((option) => ({
    label: t(`theme.names.${option.id}`) + (option.default ? ` ${t('theme.default')}` : ''),
    swatch: isDark.value ? option.dark : option.light,
    active: current.value === option.id,
    onSelect: () => {
      // Update in memory for responsiveness, then persist the mode that changed.
      current.value = option.id
      savePreferences(isDark.value ? { darkTheme: option.id } : { lightTheme: option.id })
    }
  }))

  // The navigation group always carries Profile and Settings. Manage users is
  // pushed only for an admin, so it is absent from the DOM for everyone else.
  const navigation: MenuItem[] = [
    { label: t('header.profile'), icon: 'i-ph-user', to: navPath('profile', locale.value) },
    { label: t('header.settings'), icon: 'i-ph-gear-six', to: navPath('settings', locale.value) }
  ]
  if (isAdmin(user.value?.role)) {
    navigation.push({
      label: t('header.manageUsers'),
      icon: 'i-ph-users',
      to: navPath('admin-users', locale.value)
    })
  }

  return [
    // The identity block is a non-interactive label row rendered by the account slot.
    [{ type: 'label', slot: 'account' }],
    navigation,
    [
      {
        // The fixed palette icon distinguishes the theme picker from the navbar
        // light and dark mode toggle. The label still tracks the current mode.
        label: isDark.value ? t('theme.dark') : t('theme.light'),
        icon: 'i-ph-palette',
        children: themeRows
      },
      {
        // The language row toggles to the other locale and persists it. Its label
        // shows the target code so it reads as an action, not the current state.
        label: t('header.language', { code: otherLocale.value.toUpperCase() }),
        icon: 'i-ph-translate',
        onSelect: () => switchLocale()
      }
    ],
    [{ label: t('header.logout'), icon: 'i-ph-sign-out', color: 'error', onSelect: logout }]
  ]
})
</script>

<template>
  <UHeader :toggle="false" :ui="{ container: 'max-w-full px-6 sm:px-6 lg:px-8' }">
    <template #left>
      <!-- The brand mark scales up gently on hover. The scale is gated by motion-safe
           so it never moves for users who opt out of motion; inline-block gives the
           anchor a box to transform. -->
      <NuxtLink
        :aria-label="t('app.name')"
        class="inline-block transition-transform duration-200 motion-safe:hover:scale-110"
        :to="localePath('index')"
      >
        <AppLogo class="h-8 sm:h-10" />
      </NuxtLink>
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <span class="hidden text-sm text-muted sm:inline">{{ greeting }}</span>
        <AppColorModeToggle />
        <UDropdownMenu :items="items" :ui="{ content: 'w-64' }">
          <!-- The name is the friendliest accessible name, but it is empty before
               onboarding, so the label falls back to the email and finally to a
               static account label so the trigger always has an accessible name. -->
          <!-- The filled account circle. hover:text-primary is meaningless on a solid
               fill, so it gains a soft primary ring plus a motion-safe scale instead, at
               the quiet end of the range. The focus ring stays for keyboard users. -->
          <button
            :aria-label="triggerLabel(username, user?.email, t('header.accountMenu'))"
            class="grid size-9 cursor-pointer place-items-center rounded-full bg-primary text-sm font-semibold transition duration-200 hover:ring-2 hover:ring-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:hover:scale-105"
            :style="{ color: activeOnPrimary }"
            type="button"
          >
            {{ initials }}
          </button>

          <!-- The identity block is a full-width header at the top of the popover.
               The avatar sits on top as a prominent block, then the name, then the
               email beneath it. It is a label row, so it takes no focus and performs
               no action. The initials circle mirrors the trigger idiom at a larger
               size. -->
          <template #account>
            <div class="flex w-full flex-col items-center gap-2 px-2 py-3 text-center">
              <span
                class="grid size-14 place-items-center rounded-full bg-primary text-lg font-semibold"
                :style="{ color: activeOnPrimary }"
              >
                {{ initials }}
              </span>
              <div class="flex w-full min-w-0 flex-col items-center">
                <span v-if="username" class="w-full truncate text-sm font-medium text-highlighted">
                  {{ username }}
                </span>
                <span class="w-full truncate text-xs text-muted">{{ user?.email }}</span>
              </div>
            </div>
          </template>

          <!-- Theme rows show a swatch (canvas, primary, accent) so the picker previews
               each theme's agencement; every other row keeps its icon. -->
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

          <!-- Restore the submenu chevron, and mark the active theme. The check icon is
               decorative, so a visually hidden label carries the active state to a
               screen reader as well as to the eye. -->
          <template #item-trailing="{ item }">
            <UIcon v-if="item.children" class="size-4 text-dimmed" name="i-ph-caret-right" />
            <template v-else-if="item.active">
              <UIcon class="size-4 text-primary" name="i-ph-check" />
              <span class="sr-only">{{ t('theme.active') }}</span>
            </template>
          </template>
        </UDropdownMenu>
      </div>
    </template>
  </UHeader>
</template>
