import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from '#shared/theme'

// Eight atmospheres, each with a light and a dark variant. The id maps to a
// [data-theme] block in main.css that recolors the Nuxt UI tokens. The colors
// here drive the dynamic favicon, so they must stay in sync with main.css. The
// light and dark picks are independent and the active one follows the color mode.
export interface ThemePalette {
  accent: string
  canvas: string
  ink: string
  primary: string
}

export interface ThemeOption {
  dark: ThemePalette
  darkName: string
  default?: boolean
  id: ThemeId
  light: ThemePalette
  name: string
}

// The palettes and display names for each atmosphere, keyed by the shared theme id.
// The id list itself lives in #shared/theme so the client cannot drift from what the
// server validates, and this record must cover every id in THEME_IDS.
const themeDefinitions: Record<ThemeId, Omit<ThemeOption, 'id'>> = {
  pastel: {
    name: 'Pastel',
    darkName: 'Pastel Night',
    default: true,
    light: { canvas: '#f5faf8', primary: '#5cc9a0', accent: '#b3a4f0', ink: '#33483f' },
    dark: { canvas: '#0b1120', primary: '#6ee7b7', accent: '#c4b5fd', ink: '#e2e8f0' }
  },
  ember: {
    name: 'Ember & Teal',
    darkName: 'Ember Dusk',
    light: { canvas: '#fdf7f0', primary: '#f2682c', accent: '#0d9488', ink: '#2e1f29' },
    dark: { canvas: '#1b1317', primary: '#f2682c', accent: '#2dd4bf', ink: '#f5ece8' }
  },
  onyx: {
    name: 'Onyx',
    darkName: 'Obsidian',
    light: { canvas: '#f4f4f6', primary: '#2f333a', accent: '#b87333', ink: '#1b1d22' },
    dark: { canvas: '#0b0c0f', primary: '#ccd2da', accent: '#d8965d', ink: '#eef0f3' }
  },
  coffee: {
    name: 'Mocha',
    darkName: 'Dark Roast',
    light: { canvas: '#f7f1e8', primary: '#6f4e37', accent: '#0d9488', ink: '#2e2018' },
    dark: { canvas: '#18120d', primary: '#c79a6a', accent: '#2dd4bf', ink: '#f1e6d8' }
  },
  forest: {
    name: 'Forest',
    darkName: 'Pinewood',
    light: { canvas: '#f4f7ec', primary: '#4d7c2f', accent: '#ca8a04', ink: '#26301a' },
    dark: { canvas: '#131a0d', primary: '#8bc34a', accent: '#eab308', ink: '#eef2e4' }
  },
  autumn: {
    name: 'Autumn',
    darkName: 'Harvest',
    light: { canvas: '#fdf4ec', primary: '#c2410c', accent: '#b91c1c', ink: '#3a2412' },
    dark: { canvas: '#1a130b', primary: '#e2722e', accent: '#f05252', ink: '#f3e9d9' }
  },
  berry: {
    name: 'Berry & Mint',
    darkName: 'Mulberry',
    light: { canvas: '#fdf2f7', primary: '#be185d', accent: '#0d9488', ink: '#2f1c28' },
    dark: { canvas: '#1b1218', primary: '#ec4899', accent: '#2dd4bf', ink: '#f6e8ef' }
  },
  frost: {
    name: 'Frost',
    darkName: 'Glacier',
    light: { canvas: '#f4f7fb', primary: '#335c81', accent: '#64748b', ink: '#1c2733' },
    dark: { canvas: '#0b1226', primary: '#6d8bce', accent: '#8a9bc4', ink: '#e6eaf4' }
  }
}

// Build the option list from the shared id list so the ids and their order stay in
// lockstep with what the server accepts.
export const themeOptions: ThemeOption[] = THEME_IDS.map((id) => ({
  id,
  ...themeDefinitions[id]
}))

const DEFAULT_THEME = DEFAULT_THEME_ID

// Build the favicon, which is the clock alone (no calendar). The ring uses the
// primary and the needles and pivot use the ink color, framed tight to the clock.
export function themeFavicon(ink: string, primary: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="136 136 72 72" fill="none"><path d="M170 144 A28 28 0 1 0 192 188" stroke="${primary}" stroke-width="13" stroke-linecap="round" fill="none"/><g stroke="${ink}" stroke-width="13" stroke-linecap="round"><line x1="170" y1="176" x2="156.8" y2="162.9"/><line x1="170" y1="176" x2="194.3" y2="154.4"/></g><circle cx="170" cy="176" r="5" fill="${ink}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Pick a readable text color for a primary fill from its perceived brightness.
// Dark primaries get white. Bright ones get a near-black tinted with the
// primary's own hue, never a flat mid gray. Works for any theme.
export function onPrimary(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  if (brightness < 150) return '#ffffff'
  // Scale the hue down to ~20% so it reads as almost black but keeps the tint.
  const channel = (value: number) =>
    Math.round(value * 0.2)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function useTheme() {
  const colorMode = useColorMode()
  const { user } = useUserSession()

  // Prefer the authenticated session value so the server-resolved atmosphere is
  // present on first paint, otherwise fall back to the coded default. A signed-out
  // visitor has no theme picker, so the default is all they ever need. SSR writes
  // these ids onto the html element for the pre-paint guard to read, no cookie.
  const lightTheme = useState<string>('theme-light', () => user.value?.lightTheme ?? DEFAULT_THEME)
  const darkTheme = useState<string>('theme-dark', () => user.value?.darkTheme ?? DEFAULT_THEME)

  const isDark = computed(() => colorMode.value === 'dark')
  const activeId = computed(() => (isDark.value ? darkTheme.value : lightTheme.value))
  const active = computed(() => {
    const option = themeOptions.find((entry) => entry.id === activeId.value) ?? themeOptions[0]
    return isDark.value ? option.dark : option.light
  })

  const activeOnPrimary = computed(() => onPrimary(active.value.primary))

  return {
    colorMode,
    isDark,
    lightTheme,
    darkTheme,
    themes: themeOptions,
    activeId,
    active,
    activeOnPrimary
  }
}
