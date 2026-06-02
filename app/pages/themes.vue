<script setup lang="ts">
// Temporary theme gallery. Each atmosphere shows its light variant on the left
// and its dark variant on the right. Palettes mirror main.css; on-primary text
// is derived with the same brightness rule as the live app (useTheme).
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
  darkName: string
  light: Palette
  name: string
}

const themes: Theme[] = [
  {
    name: 'Pastel',
    darkName: 'Pastel Night',
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
      canvas: '#0b1120',
      surface: '#0f172a',
      chrome: '#1e293b',
      border: '#334155',
      ink: '#e2e8f0',
      muted: '#94a3b8',
      primary: '#6ee7b7',
      accent: '#c4b5fd'
    }
  },
  {
    name: 'Ember & Teal',
    darkName: 'Ember Dusk',
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
      canvas: '#1b1317',
      surface: '#251a20',
      chrome: '#2d2027',
      border: '#3a2c33',
      ink: '#f5ece8',
      muted: '#bba7b0',
      primary: '#f2682c',
      accent: '#2dd4bf'
    }
  },
  {
    name: 'Onyx',
    darkName: 'Obsidian',
    light: {
      canvas: '#f4f4f6',
      surface: '#ffffff',
      chrome: '#e8e9ec',
      border: '#d6d8dd',
      ink: '#1b1d22',
      muted: '#5a5e67',
      primary: '#2f333a',
      accent: '#b87333'
    },
    dark: {
      canvas: '#0b0c0f',
      surface: '#14161a',
      chrome: '#1b1e23',
      border: '#2a2e36',
      ink: '#eef0f3',
      muted: '#99a1ac',
      primary: '#ccd2da',
      accent: '#d8965d'
    }
  },
  {
    name: 'Mocha',
    darkName: 'Dark Roast',
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
      canvas: '#18120d',
      surface: '#221a13',
      chrome: '#2a2017',
      border: '#38291c',
      ink: '#f1e6d8',
      muted: '#bcab97',
      primary: '#c79a6a',
      accent: '#2dd4bf'
    }
  },
  {
    name: 'Forest',
    darkName: 'Pinewood',
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
      canvas: '#131a0d',
      surface: '#1c2614',
      chrome: '#24301a',
      border: '#344426',
      ink: '#eef2e4',
      muted: '#a7b595',
      primary: '#8bc34a',
      accent: '#eab308'
    }
  },
  {
    name: 'Autumn',
    darkName: 'Harvest',
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
      canvas: '#1a130b',
      surface: '#241a0f',
      chrome: '#2c2113',
      border: '#3a2c1a',
      ink: '#f3e9d9',
      muted: '#bca88e',
      primary: '#e2722e',
      accent: '#f05252'
    }
  },
  {
    name: 'Berry & Mint',
    darkName: 'Mulberry',
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
      canvas: '#1b1218',
      surface: '#26181f',
      chrome: '#2e1e27',
      border: '#3b2833',
      ink: '#f6e8ef',
      muted: '#c2a0b2',
      primary: '#ec4899',
      accent: '#2dd4bf'
    }
  },
  {
    name: 'Frost',
    darkName: 'Glacier',
    light: {
      canvas: '#f4f7fb',
      surface: '#ffffff',
      chrome: '#e7eef5',
      border: '#d3dde8',
      ink: '#1c2733',
      muted: '#5c6b7a',
      primary: '#335c81',
      accent: '#64748b'
    },
    dark: {
      canvas: '#0b1226',
      surface: '#121a33',
      chrome: '#182142',
      border: '#243057',
      ink: '#e6eaf4',
      muted: '#95a0bd',
      primary: '#6d8bce',
      accent: '#8a9bc4'
    }
  }
]

// The chromatic relationship between each theme's primary and its complement.
const shapes: Record<string, string> = {
  Pastel: 'Triadic',
  'Ember & Teal': 'Complementary',
  Onyx: 'Neutral',
  Mocha: 'Complementary',
  Forest: 'Analogous',
  Autumn: 'Analogous',
  'Berry & Mint': 'Complementary',
  Frost: 'Analogous'
}

// Flatten into left (light) and right (dark) cards. Two columns keep light on
// the left and dark on the right for every row.
const cards = themes.flatMap((theme, index) => [
  {
    key: `${theme.name}-l`,
    label: theme.name,
    palette: theme.light,
    shape: shapes[theme.name],
    def: index === 0
  },
  {
    key: `${theme.darkName}-d`,
    label: theme.darkName,
    palette: theme.dark,
    shape: shapes[theme.name],
    def: index === 0
  }
])

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
          <h1 class="text-2xl font-bold text-neutral-900">All themes — light and dark</h1>
          <p class="mt-0.5 text-sm text-neutral-600">
            Each atmosphere with its light variant on the left and dark on the right.
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
