import { closestWeight, numericWeight, webFontByFamily, type WebFont } from '../shared/fontCatalog'
import { primaryFamily } from '../shared/logic'
import { api } from './rpc'

const faces = new Map<string, Promise<void>>()

/** Registers one weight of a catalog font with the document, downloading it the first time. */
export function loadWebFontWeight(font: WebFont, weight: number): Promise<void> {
  const key = `${font.id}/${weight}`
  let pending = faces.get(key)
  if (!pending) {
    pending = api.webFont(font.id, weight).then(async (data) => {
      const face = new FontFace(font.family, data as Uint8Array<ArrayBuffer>, { weight: String(weight) })
      document.fonts.add(await face.load())
    })
    pending.catch(() => faces.delete(key))
    faces.set(key, pending)
  }
  return pending
}

export function loadWebFont(font: WebFont, weights = font.weights): Promise<void> {
  return Promise.all(weights.map((weight) => loadWebFontWeight(font, weight))).then(() => undefined)
}

/**
 * Makes sure the weights the terminal draws with (the configured one and bold) are registered when
 * the font stack starts with a catalog font. Resolves to whether anything had to be loaded.
 */
export async function ensureConfiguredFont(stack: string, weight: string): Promise<boolean> {
  const font = webFontByFamily(primaryFamily(stack))
  if (!font) return false
  const wanted = [...new Set([closestWeight(font, numericWeight(weight)), closestWeight(font, 700)])]
  const missing = wanted.filter((w) => !faces.has(`${font.id}/${w}`))
  await loadWebFont(font, wanted)
  return missing.length > 0
}
