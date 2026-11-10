import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { filterLines, findLinks, formatDuration, redact, resolveOutputPath, secretRanges, type FilterOptions } from '../../shared/logic'
import type { StyledLine, StyledSpan } from '../../shared/types'
import { api } from '../rpc'
import { getHomeDir, useApp } from '../state/store'
import { lineText } from '../terminal/extract'
import type { Block, PaneSession } from '../terminal/PaneSession'
import { Icon } from './icons'

const CHUNK = 200

type Mark = 'secret' | 'match' | 'current' | 'link'
interface Range { from: number; to: number; mark: Mark; target?: string }

function spanStyle(span: StyledSpan): CSSProperties | undefined {
  if (!span.fg && !span.bg && !span.b && !span.i && !span.u && !span.d && !span.s) return undefined
  return {
    color: span.fg,
    background: span.bg,
    fontWeight: span.b ? 600 : undefined,
    fontStyle: span.i ? 'italic' : undefined,
    textDecoration: span.u ? 'underline' : span.s ? 'line-through' : undefined,
    opacity: span.d ? 0.65 : undefined,
  }
}

function renderLine(line: StyledLine, ranges: Range[]): ReactNode {
  if (!ranges.length) {
    return line.map((span, i) => <span key={i} style={spanStyle(span)}>{span.t}</span>)
  }
  const cuts = [...new Set(ranges.flatMap((r) => [r.from, r.to]))].sort((a, b) => a - b)
  const nodes: ReactNode[] = []
  let offset = 0
  line.forEach((span, spanIndex) => {
    let start = 0
    const end = span.t.length
    const inner = cuts.filter((c) => c > offset && c < offset + end).map((c) => c - offset)
    for (const stop of [...inner, end]) {
      const at = offset + start
      const text = span.t.slice(start, stop)
      const range = ranges.find((r) => at >= r.from && at < r.to)
      const key = `${spanIndex}-${start}`
      if (range?.mark === 'secret') {
        nodes.push(<span key={key} className="secret" style={spanStyle(span)}>{'•'.repeat(text.length)}</span>)
      } else if (range?.mark === 'link') {
        nodes.push(<a key={key} className="link" data-target={range.target} title="Ctrl+clique para abrir" style={spanStyle(span)}>{text}</a>)
      } else if (range) {
        nodes.push(<mark key={key} className={range.mark === 'current' ? 'current' : ''} style={spanStyle(span)}>{text}</mark>)
      } else {
        nodes.push(<span key={key} style={spanStyle(span)}>{text}</span>)
      }
      start = stop
    }
    offset += end
  })
  return nodes
}

interface LineProps {
  line: StyledLine
  find: RegExp | null
  currentMatch: number | null
  secrets: RegExp[] | null
}

const OutputLine = memo(function OutputLine({ line, find, currentMatch, secrets }: LineProps) {
  const text = lineText(line)
  const ranges: Range[] = []
  if (secrets) for (const [from, to] of secretRanges(text, secrets)) ranges.push({ from, to, mark: 'secret' })
  if (find) {
    let index = 0
    for (const match of text.matchAll(find)) {
      if (!match[0]) continue
      ranges.push({ from: match.index, to: match.index + match[0].length, mark: index === currentMatch ? 'current' : 'match' })
      index++
    }
  }
  for (const link of findLinks(text)) {
    if (!ranges.some((r) => link.from < r.to && link.to > r.from)) {
      const target = link.url ? link.target : `${link.target}${link.line ? `:${link.line}` : ''}`
      ranges.push({ from: link.from, to: link.to, mark: 'link', target })
    }
  }
  return <div className="line">{text ? renderLine(line, ranges) : '​'}</div>
})

/** Selects a URL, path or address as a unit when it is double-clicked. */
function smartSelect(event: React.MouseEvent): void {
  const selection = window.getSelection()
  const node = selection?.anchorNode
  const lineEl = (node?.parentElement as HTMLElement | null)?.closest('.line')
  if (!selection || !lineEl) return
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
  let offset = selection.anchorOffset
  for (let current = walker.nextNode(); current && current !== node; current = walker.nextNode()) offset += current.textContent!.length
  const text = lineEl.textContent ?? ''
  const pattern = /https?:\/\/\S+|[A-Za-z]:[\\/][^\s"'<>|]+|[\w.+-]+@[\w-]+\.[\w.]+|\.{0,2}[\\/]?[\w.-]+(?:[\\/][\w.-]+)+|\d{1,3}(?:\.\d{1,3}){3}/g
  for (const match of text.matchAll(pattern)) {
    if (offset < match.index || offset > match.index + match[0].length) continue
    const point = (target: number): [Node, number] => {
      const nodes = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
      let remaining = target
      for (let current = nodes.nextNode(); current; current = nodes.nextNode()) {
        if (remaining <= current.textContent!.length) return [current, remaining]
        remaining -= current.textContent!.length
      }
      return [lineEl, 0]
    }
    const range = document.createRange()
    range.setStart(...point(match.index))
    range.setEnd(...point(match.index + match[0].length))
    selection.removeAllRanges()
    selection.addRange(range)
    event.preventDefault()
    if (useApp.getState().settings.terminal.copyOnSelect) void api.copyText(selection.toString())
    return
  }
}

export function exportBlock(block: Block, format: 'md' | 'html', text: string): void {
  const heading = block.command || 'Saída em background'
  if (format === 'md') {
    void api.saveAs('bloco.md', `\`\`\`shell\n${heading}\n\`\`\`\n\n\`\`\`\n${text}\n\`\`\`\n`)
    return
  }
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  void api.saveAs(
    'bloco.html',
    `<!doctype html><meta charset="utf-8"><title>${escape(heading)}</title><body style="background:#101418;color:#dbe2ea;font:13px monospace;padding:24px"><pre><b>${escape(heading)}</b>\n\n${escape(text)}</pre></body>`,
  )
}

interface BlockProps {
  block: Block
  session: PaneSession
  find: RegExp | null
  currentMatch: { blockId: string; line: number; index: number } | null
  secrets: RegExp[] | null
  filterRequest: number
  onSelect(block: Block, range: boolean): void
}

export const BlockView = memo(function BlockView({ block, session, find, currentMatch, secrets, filterRequest, onSelect }: BlockProps) {
  const liveSlot = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<FilterOptions | null>(null)
  const [revealed, setRevealed] = useState(false)
  const sendToAgent = useApp((state) => state.sendToAgent)
  const fillInput = useApp((state) => state.fillInput)
  const showBottom = useApp((state) => state.settings.appearance.jumpToBottom)
  const activeSecrets = revealed ? null : secrets

  useEffect(() => {
    if (block.running && liveSlot.current && !session.alt) session.placeHost(liveSlot.current)
  }, [block.running, session, session.alt])

  useEffect(() => {
    if (filterRequest > 0) setFilter((current) => current ?? { query: '', context: 0 })
  }, [filterRequest])

  const texts = useMemo(() => block.lines.map(lineText), [block.lines])
  const plain = (activeSecrets ? texts.map((line) => redact(line, activeSecrets)) : texts).join('\n')
  const visible = useMemo(() => (filter?.query ? filterLines(texts, filter) : null), [filter, texts])

  const patch = (update: Partial<Block>) =>
    session.updateBlocks((blocks) => blocks.map((b) => (b.id === block.id ? { ...b, ...update } : b)))

  const shown = visible ? visible.map((index) => ({ index, line: block.lines[index] })) : block.lines.map((line, index) => ({ index, line }))
  const chunks: (typeof shown)[] = []
  for (let i = 0; i < shown.length; i += CHUNK) chunks.push(shown.slice(i, i + CHUNK))
  const failed = !block.running && block.exitCode !== null && block.exitCode !== 0
  const long = block.lines.length > 60

  const className = ['block', failed && 'failed', block.selected && 'selected', block.running && 'running', block.background && 'background', block.restored && 'restored']
    .filter(Boolean).join(' ')

  return (
    <div className={className} data-block={block.id} ref={root}>
      <div className="block-header" onClick={(event) => onSelect(block, event.shiftKey)} onDoubleClick={() => patch({ collapsed: !block.collapsed })}>
        <div className="block-meta">
          {block.background ? <span>saída em background</span> : <>
            {block.cwd && <span className="meta-cwd">{block.cwd}</span>}
            {block.git && <span className="meta-git">{block.git}</span>}
            {!block.running && <span>{formatDuration(block.durationMs)}</span>}
            {failed && <span className="meta-exit">exit {block.exitCode}</span>}
            {block.bookmarked && <span className="meta-mark"><Icon name="bookmark" size={11} /></span>}
          </>}
        </div>
        {!block.background && <pre className="block-command" data-testid="block-command">{block.command}</pre>}
        <div className="block-actions" onClick={(event) => event.stopPropagation()}>
          <button title="Copiar comando" onClick={() => void api.copyText(block.command)}><Icon name="copy" size={14} /></button>
          <button title="Copiar saída" data-action="copy-output" onClick={() => void api.copyText(plain)}><Icon name="file" size={14} /></button>
          <button title="Filtrar saída" onClick={() => setFilter(filter ? null : { query: '', context: 0 })}><Icon name="filter" size={14} /></button>
          <button title="Marcar" onClick={() => patch({ bookmarked: !block.bookmarked })}><Icon name="bookmark" size={14} /></button>
          {!block.running && !block.background && <button title="Executar de novo" onClick={() => fillInput(block.command)}><Icon name="redo" size={14} /></button>}
          {secrets && <button title={revealed ? 'Ocultar secrets' : 'Revelar secrets'} onClick={() => setRevealed(!revealed)}><Icon name="eye" size={14} /></button>}
          <button title="Exportar como Markdown" onClick={() => exportBlock(block, 'md', plain)}><Icon name="share" size={14} /></button>
          <button title="Enviar ao agente" onClick={() => sendToAgent(`Comando: ${block.command}\nExit: ${block.exitCode}\nSaída:\n${plain}`)}><Icon name="agent" size={14} /></button>
          <button title="Recolher" onClick={() => patch({ collapsed: !block.collapsed })}><Icon name="chevron" size={14} /></button>
          {!block.running && <button title="Remover bloco" onClick={() => session.updateBlocks((blocks) => blocks.filter((b) => b.id !== block.id))}><Icon name="close" size={14} /></button>}
        </div>
      </div>

      {filter && (
        <div className="block-filter">
          <input
            autoFocus placeholder="Filtrar saída" value={filter.query}
            onChange={(event) => setFilter({ ...filter, query: event.target.value })}
            onKeyDown={(event) => event.key === 'Escape' && setFilter(null)}
          />
          <label><input type="checkbox" checked={!!filter.regex} onChange={(e) => setFilter({ ...filter, regex: e.target.checked })} /> regex</label>
          <label><input type="checkbox" checked={!!filter.caseSensitive} onChange={(e) => setFilter({ ...filter, caseSensitive: e.target.checked })} /> Aa</label>
          <label>contexto <input type="number" min={0} max={20} value={filter.context ?? 0} onChange={(e) => setFilter({ ...filter, context: Number(e.target.value) })} /></label>
          {visible && <span className="muted">{visible.length} linhas</span>}
        </div>
      )}

      {!block.collapsed && (
        <div
          className="block-output"
          onDoubleClick={smartSelect}
          onClick={(event) => {
            // Ctrl is required so that selecting text over a link never opens it.
            const target = (event.target as HTMLElement).closest<HTMLElement>('a.link')?.dataset.target
            if (!target || !event.ctrlKey) return
            if (/^https?:/i.test(target)) {
              void api.openExternal(target)
              return
            }
            const [, path, line] = /^(.*?)(?::(\d+))?$/.exec(target)!
            useApp.getState().openFile(resolveOutputPath(path, block.cwd, getHomeDir()), line ? Number(line) : undefined)
          }}
        >
          {block.running ? <div ref={liveSlot} className="live-slot" /> : chunks.map((chunk, i) => (
            <div className="chunk" key={i} style={{ containIntrinsicHeight: `auto ${chunk.length * 18}px` }}>
              {chunk.map(({ index, line }) => (
                <OutputLine
                  key={index} line={line} find={find} secrets={activeSecrets}
                  currentMatch={currentMatch?.blockId === block.id && currentMatch.line === index ? currentMatch.index : null}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {block.collapsed && <div className="block-collapsed">{block.lines.length} linhas recolhidas</div>}

      {block.correction && (
        <button className="correction" onClick={() => fillInput(block.correction!)}>
          Você quis dizer <code>{block.correction}</code>?
        </button>
      )}
      {long && showBottom && !block.collapsed && (
        <button className="jump-bottom" title="Ir ao fim do bloco" onClick={() => root.current?.querySelector('.block-output')?.lastElementChild?.scrollIntoView({ block: 'end' })}>
          <Icon name="down" size={14} />
        </button>
      )}
    </div>
  )
})
