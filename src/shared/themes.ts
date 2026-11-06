import type { Theme, ThemeColors } from './types'

const c = (
  black: string, red: string, green: string, yellow: string,
  blue: string, magenta: string, cyan: string, white: string,
): ThemeColors => ({ black, red, green, yellow, blue, magenta, cyan, white })

export const builtinThemes: Theme[] = [
  {
    id: 'wrapped-dark', name: 'Wrapped Dark', builtin: true, details: 'darker',
    accent: '#5eead4', background: '#101418', foreground: '#dbe2ea',
    normal: c('#1c2430', '#f0717b', '#7fd88f', '#e5c07b', '#6fa8ff', '#c792ea', '#56d4dd', '#c5ced9'),
    bright: c('#536070', '#ff8d96', '#a0efae', '#f6d58f', '#94c0ff', '#ddb3f8', '#83e8ef', '#f5f7fa'),
  },
  {
    id: 'wrapped-light', name: 'Wrapped Light', builtin: true, details: 'lighter',
    accent: '#0d9488', background: '#f7f8fa', foreground: '#1f2933',
    normal: c('#1f2933', '#c8323f', '#1f8a4c', '#a86a00', '#2465d6', '#8a3fb5', '#0b7f8c', '#cdd3da'),
    bright: c('#59636e', '#e0525e', '#2fa864', '#c78a12', '#4583ee', '#a65fd0', '#1a9cab', '#ffffff'),
  },
  {
    id: 'dracula', name: 'Dracula', builtin: true, details: 'darker',
    accent: '#bd93f9', background: '#282a36', foreground: '#f8f8f2',
    normal: c('#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'),
    bright: c('#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'),
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', builtin: true, details: 'darker',
    accent: '#2aa198', background: '#002b36', foreground: '#839496',
    normal: c('#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'),
    bright: c('#586e75', '#cb4b16', '#93a1a1', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'),
  },
  {
    id: 'solarized-light', name: 'Solarized Light', builtin: true, details: 'lighter',
    accent: '#2aa198', background: '#fdf6e3', foreground: '#657b83',
    normal: c('#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'),
    bright: c('#586e75', '#cb4b16', '#93a1a1', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'),
  },
  {
    id: 'gruvbox-dark', name: 'Gruvbox Dark', builtin: true, details: 'darker',
    accent: '#fe8019', background: '#282828', foreground: '#ebdbb2',
    normal: c('#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984'),
    bright: c('#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'),
  },
  {
    id: 'nord', name: 'Nord', builtin: true, details: 'darker',
    accent: '#88c0d0', background: '#2e3440', foreground: '#d8dee9',
    normal: c('#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'),
    bright: c('#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'),
  },
]

export function findTheme(themes: Theme[], id: string): Theme {
  return themes.find((t) => t.id === id) ?? themes.find((t) => t.id === 'wrapped-dark') ?? builtinThemes[0]
}

function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

/**
 * Reads the YAML structure of a theme file, returning null when required colors are missing.
 * `terminal_colors.normal/bright` and `details` follow the layout most terminal themes use.
 */
export function parseThemeFile(id: string, raw: unknown): Theme | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, any>
  if (!isHex(t.background) || !isHex(t.foreground)) return null
  const fallback = t.details === 'lighter' ? builtinThemes[1] : builtinThemes[0]
  const palette = (source: unknown, base: ThemeColors): ThemeColors => {
    const out = { ...base }
    for (const key of Object.keys(base) as (keyof ThemeColors)[]) {
      const value = (source as Record<string, unknown> | undefined)?.[key]
      if (isHex(value)) out[key] = value
    }
    return out
  }
  return {
    id,
    name: typeof t.name === 'string' ? t.name : id,
    accent: isHex(t.accent) ? t.accent : fallback.accent,
    background: t.background,
    foreground: t.foreground,
    details: t.details === 'lighter' ? 'lighter' : 'darker',
    normal: palette(t.terminal_colors?.normal, fallback.normal),
    bright: palette(t.terminal_colors?.bright, fallback.bright),
    backgroundImage: typeof t.background_image?.path === 'string' ? t.background_image.path : undefined,
    imageOpacity: typeof t.background_image?.opacity === 'number' ? t.background_image.opacity : undefined,
    gradient:
      isHex(t.gradient?.top) && isHex(t.gradient?.bottom) ? { top: t.gradient.top, bottom: t.gradient.bottom } : undefined,
  }
}

export function themeToFile(theme: Theme): Record<string, unknown> {
  return {
    name: theme.name,
    accent: theme.accent,
    background: theme.background,
    foreground: theme.foreground,
    details: theme.details,
    terminal_colors: { normal: theme.normal, bright: theme.bright },
    ...(theme.gradient ? { gradient: theme.gradient } : {}),
    ...(theme.backgroundImage
      ? { background_image: { path: theme.backgroundImage, opacity: theme.imageOpacity ?? 30 } }
      : {}),
  }
}

/** CSS custom properties of a theme, applied to the window or to a single pane. */
export function themeTokens(theme: Theme): Record<string, string> {
  const dark = theme.details === 'darker'
  const toward = dark ? '#ffffff' : '#000000'
  const tokens: Record<string, string> = {
    '--bg': theme.background,
    '--fg': theme.foreground,
    '--accent': theme.accent,
    '--surface': mix(theme.background, toward, 0.04),
    '--surface-2': mix(theme.background, toward, 0.08),
    '--border': mix(theme.background, toward, 0.13),
    '--muted': mix(theme.foreground, theme.background, 0.42),
    '--on-accent': dark ? '#071311' : '#ffffff',
  }
  const colors = [...Object.values(theme.normal), ...Object.values(theme.bright)]
  colors.forEach((color, index) => {
    tokens[`--ansi-${index}`] = color
  })
  return tokens
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount)
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Builds a theme around the dominant colors sampled from a background image. */
export function themeFromColors(id: string, name: string, dominant: string, accent: string, image?: string): Theme {
  const dark = luminance(dominant) < 0.35
  const base = dark ? builtinThemes[0] : builtinThemes[1]
  return {
    ...base,
    id,
    name,
    builtin: false,
    accent,
    details: dark ? 'darker' : 'lighter',
    background: mix(dominant, dark ? '#000000' : '#ffffff', 0.55),
    foreground: dark ? '#e8ecf1' : '#1b2128',
    backgroundImage: image,
    imageOpacity: 25,
  }
}
