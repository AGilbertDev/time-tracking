<script setup lang="ts">
// Theme gallery v2. Same layout as /themes, but the DARK palettes are rebuilt on
// the principle behind Dracula / Tokyo Night / Nord: surfaces are a near-neutral
// charcoal (differing only by lightness), and the vivid primary + a DISTINCT accent
// hue carry the theme's color — so nothing reads as two tones of one hue. Light
// variants are unchanged from v1. Each pair keeps a significant, evocative name.
definePageMeta({ layout: false })

interface Palette {
  accent: string
  border: string
  canvas: string
  chrome: string
  ink: string
  muted: string
  primary: string
  surface: string
}

interface Theme {
  dark: Palette
  id: string
  light: Palette
  story: string
}

const themes: Theme[] = [
  {
    id: 'pastel',
    story: 'Cool slate · mint + violet',
    light: {
      canvas: '#f5faf8',
      surface: '#ffffff',
      chrome: '#e8f4ee',
      border: '#d5e9e0',
      ink: '#33483f',
      muted: '#6f8a80',
      primary: '#5cc9a0',
      accent: '#b3a4f0'
    },
    dark: {
      canvas: '#0d1017',
      surface: '#151a23',
      chrome: '#1c2230',
      border: '#2a3242',
      ink: '#e6edf3',
      muted: '#8b94a3',
      primary: '#5eead4',
      accent: '#b6a9ea'
    }
  },
  {
    id: 'ember',
    story: 'Warm graphite · orange + teal',
    light: {
      canvas: '#fdf7f0',
      surface: '#ffffff',
      chrome: '#fde9dd',
      border: '#f6d8c6',
      ink: '#2e1f29',
      muted: '#7a6a72',
      primary: '#f2682c',
      accent: '#0d9488'
    },
    dark: {
      canvas: '#181614',
      surface: '#201d1a',
      chrome: '#282421',
      border: '#38332e',
      ink: '#f6efe9',
      muted: '#a8a09a',
      primary: '#fb6f3b',
      accent: '#36a594'
    }
  },
  {
    id: 'onyx',
    story: 'Graphite · steel blue + copper',
    light: {
      canvas: '#f4f4f6',
      surface: '#ffffff',
      chrome: '#e8e9ec',
      border: '#d6d8dd',
      ink: '#1b1d22',
      muted: '#5a5e67',
      primary: '#3f6088',
      accent: '#b87333'
    },
    dark: {
      canvas: '#0e0f12',
      surface: '#16181c',
      chrome: '#1e2127',
      border: '#2c3039',
      ink: '#eef0f3',
      muted: '#98a0ab',
      primary: '#5e83b3',
      accent: '#d8965d'
    }
  },
  {
    id: 'coffee',
    story: 'Warm graphite · latte + teal',
    light: {
      canvas: '#f7f1e8',
      surface: '#ffffff',
      chrome: '#efe1ce',
      border: '#e3d2ba',
      ink: '#2e2018',
      muted: '#6e5c4b',
      primary: '#6f4e37',
      accent: '#0d9488'
    },
    dark: {
      canvas: '#15130f',
      surface: '#1d1a15',
      chrome: '#25211b',
      border: '#342e25',
      ink: '#f1e8da',
      muted: '#ada294',
      primary: '#d2a679',
      accent: '#36a594'
    }
  },
  {
    id: 'forest',
    story: 'Green graphite · leaf + gold',
    light: {
      canvas: '#f4f7ec',
      surface: '#ffffff',
      chrome: '#e7eed6',
      border: '#d4dfbb',
      ink: '#26301a',
      muted: '#5e6b4a',
      primary: '#4d7c2f',
      accent: '#ca8a04'
    },
    dark: {
      canvas: '#0f120c',
      surface: '#171b12',
      chrome: '#1f2417',
      border: '#2d3422',
      ink: '#ecf2e2',
      muted: '#a3b094',
      primary: '#9ccc5a',
      accent: '#cf9f3a'
    }
  },
  {
    id: 'autumn',
    story: 'Warm graphite · rust + crimson',
    light: {
      canvas: '#fdf4ec',
      surface: '#ffffff',
      chrome: '#fbe6d2',
      border: '#f4d4b2',
      ink: '#3a2412',
      muted: '#7c5f44',
      primary: '#c2410c',
      accent: '#b91c1c'
    },
    dark: {
      canvas: '#161210',
      surface: '#1e1815',
      chrome: '#261d18',
      border: '#352822',
      ink: '#f3e9dd',
      muted: '#b3a294',
      primary: '#e0712e',
      accent: '#d3625a'
    }
  },
  {
    id: 'berry',
    story: 'Plum graphite · magenta + teal',
    light: {
      canvas: '#fdf2f7',
      surface: '#ffffff',
      chrome: '#fbdeec',
      border: '#f4c5db',
      ink: '#2f1c28',
      muted: '#7d5366',
      primary: '#be185d',
      accent: '#0d9488'
    },
    dark: {
      canvas: '#14111a',
      surface: '#1d1925',
      chrome: '#251f2f',
      border: '#342c40',
      ink: '#f4eaf2',
      muted: '#ab9fb5',
      primary: '#ec4899',
      accent: '#36a594'
    }
  },
  {
    id: 'frost',
    story: 'Cool graphite · glacier cyan + slate',
    light: {
      canvas: '#f4f7fb',
      surface: '#ffffff',
      chrome: '#e7eef5',
      border: '#d3dde8',
      ink: '#1c2733',
      muted: '#5c6b7a',
      primary: '#0e7490',
      accent: '#64748b'
    },
    dark: {
      canvas: '#0c111d',
      surface: '#141a28',
      chrome: '#1c2333',
      border: '#2a3346',
      ink: '#e6ecf6',
      muted: '#94a1b8',
      primary: '#38bdf8',
      accent: '#8a9bc4'
    }
  }
]

// The chromatic relationship between each theme's primary and its complement.
const shapes: Record<string, string> = {
  pastel: 'Triadic',
  ember: 'Complementary',
  onyx: 'Complementary',
  coffee: 'Complementary',
  forest: 'Analogous',
  autumn: 'Analogous',
  berry: 'Complementary',
  frost: 'Analogous'
}

// Names come from i18n (theme.names.<id>.light|dark) so the gallery matches the
// live picker. Each pair is one collection spanning the theme's light → dark colors.
const { t } = useI18n()

// Flatten into left (light) and right (dark) cards. Two columns keep light on
// the left and dark on the right for every row.
const cards = computed(() =>
  themes.flatMap((theme, index) => [
    {
      key: `${theme.id}-l`,
      label: t(`theme.names.${theme.id}.light`),
      palette: theme.light,
      shape: shapes[theme.id],
      story: theme.story,
      def: index === 0
    },
    {
      key: `${theme.id}-d`,
      label: t(`theme.names.${theme.id}.dark`),
      palette: theme.dark,
      shape: shapes[theme.id],
      story: theme.story,
      def: index === 0
    }
  ])
)

// Reserved semantic colors. Identical in every theme so status always reads the
// same, independent of the atmosphere. These are what keep the UI from feeling
// monochrome.
const reserved = {
  success: '#16a34a',
  info: '#2563eb',
  warning: '#d97706',
  danger: '#dc2626'
}

// Soft wash for badge backgrounds.
function wash(hex: string) {
  return `${hex}22`
}
</script>

<template>
  <div class="min-h-dvh p-4 sm:p-8">
    <header class="mx-auto mb-8 max-w-5xl">
      <div class="flex items-center gap-3">
        <img alt="" class="h-12 w-auto" src="/logo.svg" />
        <div>
          <h1 class="text-2xl font-bold text-neutral-900">All themes — light and dark (v2)</h1>
          <p class="mt-0.5 text-sm text-neutral-600">
            Dark surfaces are now near-neutral charcoal; the vivid primary + accent carry each
            theme's color, so nothing reads as two tones of one hue.
          </p>
        </div>
      </div>
    </header>

    <div class="mx-auto grid max-w-5xl grid-cols-2 gap-5">
      <section v-for="card in cards" :key="card.key">
        <div class="mb-2 flex items-center gap-2">
          <p class="text-sm font-semibold text-neutral-800">
            {{ card.label
            }}<span v-if="card.def" class="font-normal text-neutral-400"> (default)</span>
          </p>
          <span class="text-xs text-neutral-500">{{ card.shape }}</span>
          <span class="ml-auto flex items-center gap-1">
            <span
              class="size-3.5 rounded-full ring-1 ring-black/10"
              :style="{ background: card.palette.primary }"
              title="primary"
            />
            <span
              class="size-3.5 rounded-full ring-1 ring-black/10"
              :style="{ background: card.palette.accent }"
              title="complement"
            />
          </span>
        </div>

        <!-- Mockup window. -->
        <div
          class="overflow-hidden rounded-xl shadow-lg"
          :style="{ background: card.palette.canvas, border: `1px solid ${card.palette.border}` }"
        >
          <!-- Nav. -->
          <div
            class="flex items-center justify-between px-4 py-3"
            :style="{
              background: card.palette.chrome,
              borderBottom: `1px solid ${card.palette.border}`
            }"
          >
            <div class="flex items-center gap-2">
              <div class="size-6 rounded-md" :style="{ background: card.palette.primary }" />
              <span class="font-semibold" :style="{ color: card.palette.ink }">Suivi</span>
            </div>
            <div class="flex items-center gap-3 text-xs">
              <span class="font-medium" :style="{ color: card.palette.accent }">Semaine</span>
              <span :style="{ color: card.palette.muted }">Statistiques</span>
              <div
                class="grid size-7 place-items-center rounded-full text-xs font-semibold"
                :style="{
                  background: card.palette.primary,
                  color: onPrimary(card.palette.primary)
                }"
              >
                AG
              </div>
            </div>
          </div>

          <!-- Body. -->
          <div class="space-y-3 p-4">
            <div>
              <h3 class="text-base font-bold" :style="{ color: card.palette.ink }">
                Bonsoir, Alexandre
              </h3>
              <p class="text-xs" :style="{ color: card.palette.muted }">Voici votre semaine.</p>
            </div>

            <!-- Task cards. Status badges use reserved semantic colors. -->
            <div
              v-for="task in [
                {
                  name: 'Traduction — Acme',
                  status: 'En cours',
                  color: reserved.info,
                  meta: '14 h 00 · 1 200 mots'
                },
                {
                  name: 'Révision — Beta',
                  status: 'Livré',
                  color: reserved.success,
                  meta: '17 h 30 · 800 mots'
                }
              ]"
              :key="task.name"
              class="space-y-2 rounded-lg p-3"
              :style="{
                background: card.palette.surface,
                border: `1px solid ${card.palette.border}`
              }"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium" :style="{ color: card.palette.ink }">
                  {{ task.name }}
                </span>
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :style="{ background: wash(task.color), color: task.color }"
                >
                  {{ task.status }}
                </span>
              </div>
              <p class="text-xs" :style="{ color: card.palette.muted }">{{ task.meta }}</p>
            </div>

            <!-- Buttons. -->
            <div class="flex gap-2">
              <button
                class="rounded-lg px-3 py-2 text-xs font-medium"
                :style="{
                  background: card.palette.primary,
                  color: onPrimary(card.palette.primary)
                }"
              >
                Nouvelle tâche
              </button>
              <button
                class="rounded-lg px-3 py-2 text-xs font-medium"
                :style="{
                  background: 'transparent',
                  color: card.palette.accent,
                  border: `1px solid ${card.palette.accent}`
                }"
              >
                Importer
              </button>
            </div>
          </div>

          <!-- Footer. -->
          <div
            class="px-4 py-2 text-center text-xs"
            :style="{
              background: card.palette.chrome,
              borderTop: `1px solid ${card.palette.border}`,
              color: card.palette.muted
            }"
          >
            © 2026 Alexandre Gilbert
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
