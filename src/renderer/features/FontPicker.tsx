import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { closestWeight, numericWeight, WEB_FONTS, webFontByFamily, type WebFont } from '../../shared/fontCatalog'
import { fontStack, primaryFamily } from '../../shared/logic'
import { FONT_WEIGHTS, type FontWeight } from '../../shared/settings'
import type { FontInfo } from '../../shared/types'
import { api } from '../rpc'
import { useApp } from '../state/store'
import { loadWebFont, loadWebFontWeight } from '../webFonts'

const WEIGHT_NAMES: Record<FontWeight, string> = {
  '100': 'Thin',
  '200': 'Extra Light',
  '300': 'Light',
  normal: 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  bold: 'Bold',
  '800': 'Extra Bold',
  '900': 'Black',
}

const SAMPLE = 'AaBb 0O1lI {} => != ~/'

let fontList: Promise<FontInfo[]> | null = null

/** Families from the main process, or from the browser's Local Font Access API if the system could not be asked. */
function loadFonts(): Promise<FontInfo[]> {
  fontList ??= api.listFonts().then(async (fonts) => {
    if (fonts.length) return fonts
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    const local = await query?.().catch(() => []) ?? []
    return [...new Set(local.map((font) => font.family))].sort((a, b) => a.localeCompare(b)).map((family) => ({ family }))
  })
  return fontList
}

/** Whether `family` draws "i" and "W" with the same advance; a missing family falls back to serif and fails. */
function measuresMonospaced(context: CanvasRenderingContext2D, family: string): boolean {
  context.font = `32px ${fontStack(family).split(',')[0]}, serif`
  const narrow = context.measureText('iiiiiiiiii').width
  return Math.abs(narrow - context.measureText('WWWWWWWWWW').width) < 0.5 && Math.abs(narrow - context.measureText('..........').width) < 0.5
}

function withMonoFlags(fonts: FontInfo[]): FontInfo[] {
  if (fonts.every((font) => font.mono !== undefined)) return fonts
  const context = document.createElement('canvas').getContext('2d')!
  return fonts.map((font) => (font.mono === undefined ? { ...font, mono: measuresMonospaced(context, font.family) } : font))
}

function Preview({ family, label }: { family: string; label: string }) {
  const appearance = useApp((state) => state.settings.appearance)
  const style: CSSProperties = {
    fontFamily: fontStack(family),
    fontSize: appearance.fontSize,
    fontWeight: appearance.fontWeight,
    lineHeight: appearance.lineHeight,
    fontVariantLigatures: appearance.ligatures ? 'normal' : 'none',
  }
  return (
    <div className="font-preview" data-testid="font-preview">
      <div className="font-preview-label">{label}</div>
      <pre style={style}>
        <span className="preview-path">~/projetos/wrapped</span> <span className="preview-branch">main</span>{'\n'}
        <b>❯ git status --short</b>{'\n'}
        <span className="preview-mod"> M src/renderer/main.tsx</span>{'\n'}
        <span className="preview-new">?? src/main/fonts.ts</span>{'\n'}
        <b>❯ npm test</b>{'\n'}
        <span className="preview-new">✓</span> 42 testes passaram <span className="preview-dim">(1,2s)</span>{'\n'}
        {'const ok = a => a !== null && a >= 0 // 0O 1lI |'}
      </pre>
    </div>
  )
}

type Entry = { family: string; mono: boolean; web?: WebFont }
type Status = 'loading' | 'ready' | 'error'

/** A catalog font row: downloads its regular weight once the row scrolls into view. */
function useWebPreview(entry: Entry, row: React.RefObject<HTMLDivElement | null>): Status | undefined {
  const [status, setStatus] = useState<Status | undefined>(entry.web ? undefined : 'ready')
  useEffect(() => {
    const font = entry.web
    const element = row.current
    if (!font || !element) return
    let alive = true
    const observer = new IntersectionObserver((items) => {
      if (!items.some((item) => item.isIntersecting)) return
      observer.disconnect()
      setStatus('loading')
      loadWebFontWeight(font, closestWeight(font, 400)).then(
        () => alive && setStatus('ready'),
        () => alive && setStatus('error'),
      )
    })
    observer.observe(element)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [entry.web, row])
  return status
}

function FontRow({ entry, selected, busy, downloaded, ligatures, weight, onHover, onChoose }: {
  entry: Entry
  selected: boolean
  busy: boolean
  downloaded: boolean
  ligatures: boolean
  weight: string
  onHover(family: string | null): void
  onChoose(entry: Entry): void
}) {
  const row = useRef<HTMLDivElement>(null)
  const status = useWebPreview(entry, row)
  const note = !entry.web
    ? entry.mono ? '' : ' · proporcional'
    : busy ? ' · baixando…'
      : status === 'error' ? ' · sem conexão'
        : status !== 'ready' ? ' · carregando prévia…'
          : downloaded ? ' · baixada' : ' · da web'
  return (
    <div
      ref={row}
      role="option"
      aria-selected={selected}
      data-family={entry.family}
      className={`font-option${selected ? ' on' : ''}${status !== 'ready' ? ' pending' : ''}`}
      onMouseEnter={() => onHover(status === 'ready' ? entry.family : null)}
      onClick={() => onChoose(entry)}
    >
      <span className="font-name">{entry.family}<span className="muted">{note}</span></span>
      <span className="font-sample" style={{ fontFamily: status === 'ready' ? fontStack(entry.family) : undefined, fontWeight: weight, fontVariantLigatures: ligatures ? 'normal' : 'none' }}>{SAMPLE}</span>
    </div>
  )
}

export function FontPicker() {
  const appearance = useApp((state) => state.settings.appearance)
  const setSetting = useApp((state) => state.setSetting)
  const [fonts, setFonts] = useState<FontInfo[] | null>(null)
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [monoOnly, setMonoOnly] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [custom, setCustom] = useState(appearance.fontFamily)
  const listRef = useRef<HTMLDivElement>(null)
  const current = primaryFamily(appearance.fontFamily)

  useEffect(() => {
    let alive = true
    void loadFonts().then((list) => alive && setFonts(withMonoFlags(list)))
    void api.downloadedWebFonts().then((ids) => alive && setDownloaded(new Set(ids)))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => setCustom(appearance.fontFamily), [appearance.fontFamily])
  // The weight buttons draw every weight of the font in use.
  useEffect(() => {
    const font = webFontByFamily(current)
    if (font) void loadWebFont(font).catch(() => undefined)
  }, [current])

  const installed = useMemo(() => new Set(fonts?.map((font) => font.family.toLowerCase())), [fonts])
  const needle = query.trim().toLowerCase()
  const system = useMemo<Entry[]>(
    () => (fonts ?? []).filter((font) => (!monoOnly || font.mono || font.family === current) && font.family.toLowerCase().includes(needle)).map((font) => ({ family: font.family, mono: !!font.mono })),
    [fonts, needle, monoOnly, current],
  )
  const web = useMemo<Entry[]>(
    () => (fonts === null ? [] : WEB_FONTS.filter((font) => !installed.has(font.family.toLowerCase()) && font.family.toLowerCase().includes(needle)).map((font) => ({ family: font.family, mono: true, web: font }))),
    [fonts, installed, needle],
  )
  const shown = useMemo(() => [...system, ...web], [system, web])

  const choose = async (entry: Entry) => {
    setError('')
    if (entry.web) {
      const font = entry.web
      setBusy(font.id)
      try {
        await loadWebFont(font, [...new Set([closestWeight(font, numericWeight(appearance.fontWeight)), closestWeight(font, 700)])])
        setDownloaded((ids) => new Set(ids).add(font.id))
      } catch {
        setError(`Não foi possível baixar ${font.family}. Verifique a conexão.`)
        return
      } finally {
        setBusy(null)
      }
    }
    setSetting('appearance.fontFamily', fontStack(entry.family))
  }
  const move = (delta: number) => {
    const index = shown.findIndex((font) => font.family === current)
    const next = shown[Math.max(0, Math.min(shown.length - 1, index + delta))]
    if (!next) return
    void choose(next)
    listRef.current?.querySelector(`[data-family="${CSS.escape(next.family)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const previewFamily = hovered ?? current
  const missing = fonts !== null && !installed.has(current.toLowerCase()) && !webFontByFamily(current)
  const label = hovered && hovered !== current
    ? `Prévia: ${hovered} (clique para aplicar)`
    : `Em uso: ${current}${missing ? ' (não instalada, o terminal usa a próxima fonte da lista)' : ''}`

  const row = (entry: Entry) => (
    <FontRow
      key={`${entry.web ? 'web' : 'sys'}:${entry.family}`}
      entry={entry}
      selected={entry.family === current}
      busy={busy === entry.web?.id}
      downloaded={!!entry.web && downloaded.has(entry.web.id)}
      ligatures={appearance.ligatures}
      weight={appearance.fontWeight}
      onHover={setHovered}
      onChoose={(chosen) => void choose(chosen)}
    />
  )

  return (
    <section className="font-picker" data-testid="font-picker">
      <Preview family={previewFamily} label={label} />

      <div className="font-controls">
        <label className="font-size">
          <span>Tamanho</span>
          <input
            type="range"
            aria-label="Tamanho da fonte (controle deslizante)"
            min={8}
            max={32}
            value={appearance.fontSize}
            onChange={(event) => setSetting('appearance.fontSize', Number(event.target.value))}
          />
          <input
            type="number"
            aria-label="Tamanho da fonte"
            min={8}
            max={32}
            value={appearance.fontSize}
            onChange={(event) => {
              const size = Number(event.target.value)
              if (size >= 8 && size <= 32) setSetting('appearance.fontSize', size)
            }}
          />
          <span className="muted">px</span>
        </label>
        <div className="font-weights" role="radiogroup" aria-label="Peso da fonte">
          {FONT_WEIGHTS.map((weight) => (
            <button
              key={weight}
              role="radio"
              aria-checked={appearance.fontWeight === weight}
              className={appearance.fontWeight === weight ? 'on' : ''}
              title={`${WEIGHT_NAMES[weight]} (${weight})`}
              onClick={() => setSetting('appearance.fontWeight', weight)}
            >
              <span style={{ fontFamily: fontStack(previewFamily), fontWeight: weight }}>Aa</span>
              <small>{WEIGHT_NAMES[weight]}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="font-browser">
        <div className="font-filter">
          <input placeholder="Buscar fonte" aria-label="Buscar fonte" value={query} onChange={(event) => setQuery(event.target.value)} />
          <label><input type="checkbox" checked={monoOnly} onChange={(event) => setMonoOnly(event.target.checked)} /> Só monoespaçadas</label>
        </div>
        {error && <div className="font-error">{error}</div>}
        <div
          className="font-list"
          role="listbox"
          aria-label="Fontes"
          tabIndex={0}
          ref={listRef}
          onMouseLeave={() => setHovered(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              move(event.key === 'ArrowDown' ? 1 : -1)
            }
          }}
        >
          {fonts === null && <div className="muted font-empty">Carregando fontes…</div>}
          {fonts !== null && shown.length === 0 && <div className="muted font-empty">Nenhuma fonte encontrada.</div>}
          {system.length > 0 && <div className="font-group">Instaladas no sistema</div>}
          {system.map(row)}
          {web.length > 0 && <div className="font-group">Populares da web <span className="muted">· baixadas na hora, ficam em ~/.wrapped/fonts</span></div>}
          {web.map(row)}
        </div>
        <label className="font-custom">
          <span className="muted">Lista CSS de fontes (avançado)</span>
          <input
            aria-label="Fonte"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onBlur={() => custom.trim() && custom !== appearance.fontFamily && setSetting('appearance.fontFamily', custom.trim())}
            onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
          />
        </label>
      </div>
    </section>
  )
}
