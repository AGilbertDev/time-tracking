<script setup lang="ts">
import type { ThemePalette } from '~/composables/useTheme'

// The appearance step reuses the theme palettes and swatch idiom from the header so the picker
// previews each theme's colours the same way everywhere. Light and dark themes are chosen
// independently, and the language choice maps to the interface locale. None of these block the
// wizard, so they only ever write pre-seeded defaults into the shared form.
const { t } = useI18n()
const { themes } = useTheme()
const form = useOnboardingForm()

// Each theme becomes a radio item carrying its own swatch so the label slot can render the three
// preview dots. The light selector previews the light palette and the dark selector the dark one.
interface ThemeRadioItem {
  label: string
  swatch: ThemePalette
  value: string
}

const lightItems = computed<ThemeRadioItem[]>(() =>
  themes.map((option) => ({
    value: option.id,
    label: t(`theme.names.${option.id}`),
    swatch: option.light
  }))
)

const darkItems = computed<ThemeRadioItem[]>(() =>
  themes.map((option) => ({
    value: option.id,
    label: t(`theme.names.${option.id}`),
    swatch: option.dark
  }))
)

// The two language choices map onto the interface locale the wizard persists.
const languageItems = computed<{ label: string; value: string }[]>(() => [
  { value: 'fr', label: t('onboarding.appearance.languageFr') },
  { value: 'en', label: t('onboarding.appearance.languageEn') }
])
</script>

<template>
  <div class="flex flex-col gap-6">
    <UFormField :label="t('onboarding.appearance.lightTheme')">
      <URadioGroup
        v-model="form.lightTheme"
        color="primary"
        :items="lightItems"
        :ui="{ fieldset: 'grid grid-cols-2 gap-2 w-full' }"
        variant="card"
      >
        <template #label="{ item }">
          <span class="flex items-center gap-2">
            <span aria-hidden="true" class="flex -space-x-1">
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: (item as ThemeRadioItem).swatch.canvas }"
              />
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: (item as ThemeRadioItem).swatch.primary }"
              />
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: (item as ThemeRadioItem).swatch.accent }"
              />
            </span>
            {{ item.label }}
          </span>
        </template>
      </URadioGroup>
    </UFormField>

    <UFormField :label="t('onboarding.appearance.darkTheme')">
      <URadioGroup
        v-model="form.darkTheme"
        color="primary"
        :items="darkItems"
        :ui="{ fieldset: 'grid grid-cols-2 gap-2 w-full' }"
        variant="card"
      >
        <template #label="{ item }">
          <span class="flex items-center gap-2">
            <span aria-hidden="true" class="flex -space-x-1">
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: (item as ThemeRadioItem).swatch.canvas }"
              />
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: (item as ThemeRadioItem).swatch.primary }"
              />
              <span
                class="size-3.5 rounded-full ring-1 ring-default"
                :style="{ background: (item as ThemeRadioItem).swatch.accent }"
              />
            </span>
            {{ item.label }}
          </span>
        </template>
      </URadioGroup>
    </UFormField>

    <UFormField :label="t('onboarding.appearance.language')">
      <URadioGroup
        v-model="form.locale"
        color="primary"
        :items="languageItems"
        orientation="horizontal"
        :ui="{ fieldset: 'grid grid-cols-2 gap-2 w-full' }"
        variant="card"
      />
    </UFormField>
  </div>
</template>
