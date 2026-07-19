import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from '#shared/theme'

// Five themes, each with a matched light and dark rendering under one name. The id
// maps to a [data-theme] block in main.css that recolors the Nuxt UI tokens. The
// colors here drive the dynamic favicon and the header swatch dots, so they must stay
// in sync with main.css. The light and dark picks are independent and the active one
// follows the color mode. Display names live in i18n (theme.names.<id>), one per theme,
// so they are not duplicated here. accent is the theme's agencement (the secondary
// token); it is the third swatch dot the header renders so the picker shows the pairing.
export interface ThemePalette {
  accent: string
  canvas: string
  ink: string
  primary: string
}

export interface ThemeOption {
  dark: ThemePalette
  default?: boolean
  id: ThemeId
  light: ThemePalette
}

// The palettes for each theme, keyed by the shared theme id. The id list itself lives
// in #shared/theme so the client cannot drift from what the server validates, and this
// record must cover every id in THEME_IDS. Values are the anchors from the
// theme-system-redesign design doc (canvas, primary, accent, and text as ink).
const themeDefinitions: Record<ThemeId, Omit<ThemeOption, 'id'>> = {
  pastel: {
    default: true,
    light: { canvas: '#f1faf6', primary: '#00866f', accent: '#7e62b7', ink: '#12312b' },
    dark: { canvas: '#10201c', primary: '#34c3a3', accent: '#b9a0ea', ink: '#e4f2ec' }
  },
  encre: {
    light: { canvas: '#f5f7fb', primary: '#2a5cb8', accent: '#007d86', ink: '#14203a' },
    dark: { canvas: '#0d1626', primary: '#5b9be8', accent: '#2fc7cd', ink: '#e6ecf5' }
  },
  cafe: {
    light: { canvas: '#faf5ee', primary: '#7a4a24', accent: '#976614', ink: '#2a1d12' },
    dark: { canvas: '#17110c', primary: '#c98a4f', accent: '#e6c07e', ink: '#f2e9dd' }
  },
  automne: {
    light: { canvas: '#fbf2ea', primary: '#c0531f', accent: '#a5342b', ink: '#34160c' },
    dark: { canvas: '#1b1109', primary: '#e2703a', accent: '#d85e50', ink: '#f6e7da' }
  },
  foret: {
    light: { canvas: '#f0f6f1', primary: '#1f7a50', accent: '#9c4368', ink: '#12241a' },
    dark: { canvas: '#0e1a12', primary: '#3da76c', accent: '#cd7396', ink: '#e4efe7' }
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

  // Prefer the authenticated session value so the server-resolved theme is
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
