/** Popular programming fonts that Wrapped downloads on demand from Fontsource (jsDelivr). */
export interface WebFont {
  id: string
  family: string
  weights: number[]
}

export const WEB_FONTS: WebFont[] = [
  { id: 'jetbrains-mono', family: 'JetBrains Mono', weights: [100, 200, 300, 400, 500, 600, 700, 800] },
  { id: 'fira-code', family: 'Fira Code', weights: [300, 400, 500, 600, 700] },
  { id: 'cascadia-code', family: 'Cascadia Code', weights: [200, 300, 400, 500, 600, 700] },
  { id: 'source-code-pro', family: 'Source Code Pro', weights: [200, 300, 400, 500, 600, 700, 800, 900] },
  { id: 'geist-mono', family: 'Geist Mono', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: 'ibm-plex-mono', family: 'IBM Plex Mono', weights: [100, 200, 300, 400, 500, 600, 700] },
  { id: 'roboto-mono', family: 'Roboto Mono', weights: [100, 200, 300, 400, 500, 600, 700] },
  { id: 'ubuntu-mono', family: 'Ubuntu Mono', weights: [400, 700] },
  { id: 'inconsolata', family: 'Inconsolata', weights: [200, 300, 400, 500, 600, 700, 800, 900] },
  { id: 'iosevka', family: 'Iosevka', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: 'commit-mono', family: 'Commit Mono', weights: [200, 300, 400, 500, 600, 700] },
  { id: 'monaspace-neon', family: 'Monaspace Neon', weights: [200, 300, 400, 500, 600, 700, 800] },
  { id: 'victor-mono', family: 'Victor Mono', weights: [100, 200, 300, 400, 500, 600, 700] },
  { id: 'fira-mono', family: 'Fira Mono', weights: [400, 500, 700] },
  { id: 'space-mono', family: 'Space Mono', weights: [400, 700] },
  { id: 'dm-mono', family: 'DM Mono', weights: [300, 400, 500] },
  { id: 'red-hat-mono', family: 'Red Hat Mono', weights: [300, 400, 500, 600, 700] },
  { id: 'intel-one-mono', family: 'Intel One Mono', weights: [300, 400, 500, 600, 700] },
  { id: 'martian-mono', family: 'Martian Mono', weights: [100, 200, 300, 400, 500, 600, 700, 800] },
  { id: 'noto-sans-mono', family: 'Noto Sans Mono', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: 'azeret-mono', family: 'Azeret Mono', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { id: 'spline-sans-mono', family: 'Spline Sans Mono', weights: [300, 400, 500, 600, 700] },
  { id: 'sometype-mono', family: 'Sometype Mono', weights: [400, 500, 600, 700] },
  { id: 'overpass-mono', family: 'Overpass Mono', weights: [300, 400, 500, 600, 700] },
  { id: 'anonymous-pro', family: 'Anonymous Pro', weights: [400, 700] },
  { id: 'courier-prime', family: 'Courier Prime', weights: [400, 700] },
]

export function webFontByFamily(family: string): WebFont | undefined {
  const needle = family.toLowerCase()
  return WEB_FONTS.find((font) => font.family.toLowerCase() === needle)
}

/** The CSS weight a setting such as "normal" or "bold" stands for. */
export function numericWeight(weight: string): number {
  return weight === 'normal' ? 400 : weight === 'bold' ? 700 : Number(weight) || 400
}

/** The weight of `font` closest to `weight`, which is the one the browser would pick. */
export function closestWeight(font: WebFont, weight: number): number {
  return font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0])
}
