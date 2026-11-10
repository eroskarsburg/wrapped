import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { buildMatcher, compileSecretPatterns } from '../../shared/logic'
import { findTheme, themeTokens } from '../../shared/themes'
import type { PaneLeaf } from '../../shared/types'
import { paneEvents } from '../actions'
import { api } from '../rpc'
import { ensureSession, takeRestoredBlocks, useApp } from '../state/store'
import { lineText } from '../terminal/extract'
import type { Block, PaneSession } from '../terminal/PaneSession'
import { BlockView } from './BlockView'
import { Icon } from './icons'
import { InputEditor } from './InputEditor'

function useSession(session: PaneSession): void {
  useSyncExternalStore(session.subscribe, session.snapshot)
}

interface FindMatch { blockId: string; line: number; index: number }

function FindBar({ session, onChange, onClose }: { session: PaneSession; onChange(find: RegExp | null, current: FindMatch | null): void; onClose(): void }) {
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCase] = useState(false)
  const [cursor, setCursor] = useState(0)
  const matcher = useMemo(() => buildMatcher({ query, regex, caseSensitive }), [query, regex, caseSensitive])
  const matches = useMemo(() => {
    const found: FindMatch[] = []
    if (!matcher) return found
    for (const block of [...session.blocks].reverse()) {
      block.lines.forEach((line, lineIndex) => {
        let index = 0
        for (const match of lineText(line).matchAll(matcher)) {
          if (match[0]) found.push({ blockId: block.id, line: lineIndex, index: index++ })
        }
      })
    }
    return found
  }, [matcher, session.blocks])
  const current = matches[Math.min(cursor, matches.length - 1)] ?? null

  useEffect(() => {
    onChange(matcher, current)
    if (current) document.querySelector(`[data-block="${current.blockId}"] mark.current`)?.scrollIntoView({ block: 'center' })
  }, [matcher, current, onChange])

  const step = (delta: number) => matches.length && setCursor((cursor + delta + matches.length) % matches.length)

  return (
    <div className="find-bar">
      <input
        autoFocus placeholder="Buscar nos blocos" value={query}
        onChange={(event) => { setQuery(event.target.value); setCursor(0) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter') step(event.shiftKey ? -1 : 1)
        }}
      />
      <label><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> regex</label>
      <label><input type="checkbox" checked={caseSensitive} onChange={(e) => setCase(e.target.checked)} /> Aa</label>
      <span className="muted">{matches.length ? `${Math.min(cursor, matches.length - 1) + 1}/${matches.length}` : '0/0'}</span>
      <button onClick={onClose} title="Fechar"><Icon name="close" size={14} /></button>
    </div>
  )
}

export function TerminalPane({ leaf, active, visible }: { leaf: PaneLeaf; active: boolean; visible: boolean }) {
  const session = useMemo(() => ensureSession(leaf, takeRestoredBlocks(leaf.id)), [leaf.id])
  useSession(session)
  const container = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const altLayer = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [find, setFind] = useState<{ open: boolean; matcher: RegExp | null; current: FindMatch | null }>({ open: false, matcher: null, current: null })
  const [filterRequests, setFilterRequests] = useState<Record<string, number>>({})
  const inputPosition = useApp((state) => state.settings.appearance.inputPosition)
  const compact = useApp((state) => state.settings.appearance.compactBlocks)
  const dividers = useApp((state) => state.settings.appearance.blockDividers)
  const redaction = useApp((state) => state.settings.privacy.secretRedaction)
  const customSecrets = useApp((state) => state.settings.privacy.customSecretRegex)
  const copyOnSelect = useApp((state) => state.settings.terminal.copyOnSelect)
  const showCliToolbar = useApp((state) => state.settings.agent.showCliAgentToolbar)
  const focusOnHover = useApp((state) => state.settings.appearance.focusOnHover)
  const focusPane = useApp((state) => state.focusPane)
  const themes = useApp((state) => state.themes)
  const paneStyle = useMemo(() => {
    if (!session.profile.theme) return undefined
    const theme = findTheme(themes, session.profile.theme)
    return { ...themeTokens(theme), background: theme.background, color: theme.foreground } as CSSProperties
  }, [session, themes])
  const secrets = useMemo(() => (redaction ? compileSecretPatterns(customSecrets) : null), [redaction, customSecrets])
  const { blocks, running, alt, integrated, ready, exited } = session
  const fullScreen = alt || !integrated

  useLayoutEffect(() => {
    if (container.current) session.mount(container.current)
  }, [session])

  useEffect(() => {
    const element = list.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (visible) session.fit(element.clientWidth - 28, element.clientHeight - 8)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [session, visible])

  useEffect(() => {
    if (fullScreen && altLayer.current) session.placeHost(altLayer.current)
  }, [fullScreen, session])

  useEffect(() => {
    if (!active || !visible) return
    if (fullScreen || running) session.focus()
  }, [active, visible, fullScreen, !!running, session])

  // Follows new output unless the user scrolled up to read.
  useEffect(() => {
    const element = list.current
    if (element && pinned.current) element.scrollTop = inputPosition === 'top' ? 0 : element.scrollHeight
  })

  const select = useCallback((block: Block, range: boolean) => {
    session.updateBlocks((all) => {
      const anchor = all.findIndex((b) => b.selected)
      const target = all.findIndex((b) => b.id === block.id)
      if (range && anchor >= 0) {
        const [from, to] = anchor < target ? [anchor, target] : [target, anchor]
        return all.map((b, i) => ({ ...b, selected: i >= from && i <= to }))
      }
      return all.map((b) => ({ ...b, selected: b.id === block.id ? !b.selected : false }))
    })
  }, [session])

  useEffect(() => {
    const selectedBlocks = () => session.blocks.filter((b) => b.selected)
    const move = (delta: number) => {
      session.updateBlocks((all) => {
        const current = all.findIndex((b) => b.selected)
        const next = Math.max(0, Math.min(all.length - 1, current < 0 ? all.length - 1 : current + delta))
        return all.map((b, i) => ({ ...b, selected: i === next }))
      })
      const id = session.blocks.find((b) => b.selected)?.id
      if (id) list.current?.querySelector(`[data-block="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    const jumpBookmark = (delta: number) => {
      const all = session.blocks
      const current = all.findIndex((b) => b.selected)
      const start = current < 0 ? (delta > 0 ? -1 : all.length) : current
      for (let i = start + delta; i >= 0 && i < all.length; i += delta) {
        if (!all[i].bookmarked) continue
        const id = all[i].id
        session.updateBlocks((blocks) => blocks.map((b) => ({ ...b, selected: b.id === id })))
        list.current?.querySelector(`[data-block="${id}"]`)?.scrollIntoView({ block: 'start' })
        return
      }
    }
    const text = (block: Block) => block.lines.map(lineText).join('\n')
    const handlers: Record<string, () => void> = {
      find: () => setFind((state) => ({ ...state, open: true })),
      'block-previous': () => move(-1),
      'block-next': () => move(1),
      'bookmark-previous': () => jumpBookmark(-1),
      'bookmark-next': () => jumpBookmark(1),
      'block-copy-output': () => void api.copyText(selectedBlocks().map(text).join('\n\n')),
      'block-copy-command': () => void api.copyText(selectedBlocks().map((b) => b.command).join('\n')),
      'block-bookmark': () => session.updateBlocks((all) => all.map((b) => (b.selected ? { ...b, bookmarked: !b.bookmarked } : b))),
      'block-filter': () => {
        const id = selectedBlocks()[0]?.id ?? session.blocks.at(-1)?.id
        if (id) setFilterRequests((state) => ({ ...state, [id]: (state[id] ?? 0) + 1 }))
      },
    }
    const removers = Object.entries(handlers).map(([name, handler]) => {
      const listener = (event: Event) => {
        if ((event as CustomEvent).detail === session.id) handler()
      }
      paneEvents.addEventListener(name, listener)
      return () => paneEvents.removeEventListener(name, listener)
    })
    return () => removers.forEach((remove) => remove())
  }, [session])

  const onFindChange = useCallback((matcher: RegExp | null, current: FindMatch | null) => {
    setFind((state) => ({ ...state, matcher, current }))
  }, [])

  const className = ['terminal-pane', `input-${inputPosition}`, compact && 'compact', dividers && 'dividers'].filter(Boolean).join(' ')
  const showInput = integrated && !alt && !running && exited === null
  const input = showInput ? <InputEditor session={session} active={active && visible} disabled={!ready} /> : null

  return (
    <div
      className={className} ref={container} data-pane={session.id} style={paneStyle}
      onMouseDown={() => focusPane(session.id)}
      onMouseEnter={() => focusOnHover && focusPane(session.id)}
      onMouseUp={() => {
        const text = window.getSelection()?.toString()
        if (copyOnSelect && text) void api.copyText(text)
      }}
    >
      {find.open && <FindBar session={session} onChange={onFindChange} onClose={() => setFind({ open: false, matcher: null, current: null })} />}
      <div
        className="block-list" ref={list}
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = inputPosition === 'top' ? el.scrollTop < 8 : el.scrollHeight - el.scrollTop - el.clientHeight < 8
        }}
      >
        <div className="block-stack">
          {blocks.length === 0 && !running && integrated && <div className="zero-state"><p>Digite um comando abaixo.</p><p className="muted">Ctrl+Shift+P abre a command palette</p></div>}
          {(inputPosition === 'top' ? [...blocks].reverse() : blocks).map((block) => (
            <BlockView
              key={block.id} block={block} session={session} find={find.matcher} currentMatch={find.current}
              secrets={secrets} filterRequest={filterRequests[block.id] ?? 0} onSelect={select}
            />
          ))}
          {inputPosition === 'classic' && input}
        </div>
      </div>
      {running && !fullScreen && (
        <div className="running-bar">
          {session.isCliAgent && showCliToolbar ? <CliAgentInput session={session} /> : (
            <span className="muted">Executando… as teclas vão para o programa</span>
          )}
          <button title="Interromper (Ctrl+C)" onClick={() => session.interrupt()}><Icon name="stop" size={13} /></button>
        </div>
      )}
      {session.stalled && !running && exited === null && (
        <div className="running-bar" data-testid="stalled-bar">
          <span className="muted">O shell está esperando o resto do comando (aspas ou parênteses sem fechar?). Ctrl+C cancela.</span>
          <button title="Cancelar (Ctrl+C)" onClick={() => session.cancelPending()}><Icon name="stop" size={13} /></button>
        </div>
      )}
      {exited !== null && <div className="exited">Sessão encerrada (código {exited}).</div>}
      {inputPosition !== 'classic' && input}
      <div className={fullScreen ? 'alt-layer on' : 'alt-layer'} ref={altLayer} onClick={() => session.focus()} />
    </div>
  )
}

/** Rich input for CLI agents: multi-line prompts written to the program at once. */
function CliAgentInput({ session }: { session: PaneSession }) {
  const [text, setText] = useState('')
  const send = () => {
    if (!text.trim()) return
    session.sendRaw(`\x1b[200~${text}\x1b[201~\r`)
    setText('')
    session.focus()
  }
  return (
    <div className="cli-agent">
      <textarea
        rows={1} placeholder="Prompt para o agente CLI (Ctrl+Enter envia)" value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.ctrlKey) send()
          if (event.key === 'Escape') session.focus()
        }}
      />
      <button onClick={send}>Enviar</button>
    </div>
  )
}
