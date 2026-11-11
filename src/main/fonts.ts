import { net } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { WEB_FONTS } from '../shared/fontCatalog'
import { parseFcList } from '../shared/logic'
import type { FontInfo } from '../shared/types'
import { configDir } from './paths'

const exec = promisify(execFile)

const WINDOWS_FONTS =
  'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'

async function query(): Promise<FontInfo[]> {
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_FONTS], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    // Windows does not say which families are monospaced; the renderer measures them.
    const families = new Set(String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    return [...families].sort((a, b) => a.localeCompare(b)).map((family) => ({ family }))
  }
  const { stdout } = await exec('fc-list', ['--format', '%{family[0]}\t%{spacing:-0}\n'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 })
  return parseFcList(String(stdout))
}

let cached: Promise<FontInfo[]> | null = null

/** Installed font families, read once per run; an empty list if the system cannot be asked. */
export function listFonts(): Promise<FontInfo[]> {
  cached ??= query().catch(() => {
    cached = null
    return []
  })
  return cached
}

const downloads = new Map<string, Promise<Uint8Array>>()

/**
 * One weight of a catalog font (Latin subset, woff2), downloaded once to ~/.wrapped/fonts and read
 * from there afterwards. Only catalog ids and weights are accepted, so no other URL can be fetched.
 */
export function webFont(id: string, weight: number): Promise<Uint8Array> {
  const font = WEB_FONTS.find((item) => item.id === id)
  if (!font || !font.weights.includes(weight)) return Promise.reject(new Error(`Fonte desconhecida: ${id} ${weight}`))
  const key = `${id}/${weight}`
  let pending = downloads.get(key)
  if (!pending) {
    pending = (async () => {
      const file = join(configDir, 'fonts', id, `${weight}.woff2`)
      const saved = await fs.readFile(file).catch(() => null)
      if (saved) return new Uint8Array(saved)
      const response = await net.fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${weight}-normal.woff2`)
      if (!response.ok) throw new Error(`Não foi possível baixar ${font.family} (${response.status})`)
      const data = new Uint8Array(await response.arrayBuffer())
      await fs.mkdir(join(configDir, 'fonts', id), { recursive: true })
      await fs.writeFile(file, data)
      return data
    })()
    pending.catch(() => downloads.delete(key))
    downloads.set(key, pending)
  }
  return pending
}

/** Catalog ids with at least one weight already downloaded. */
export async function downloadedWebFonts(): Promise<string[]> {
  const entries = await fs.readdir(join(configDir, 'fonts')).catch(() => [] as string[])
  return entries.filter((id) => WEB_FONTS.some((font) => font.id === id))
}
