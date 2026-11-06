import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITheme } from '@xterm/xterm'
import { closestCommand, isClearCommand, isCliAgentCommand } from '../../shared/logic'
import type { RouterEvent } from '../../shared/oscRouter'
import type { Settings } from '../../shared/settings'
import type { PersistedBlock, Profile, SessionMeta, Theme } from '../../shared/types'
import { api, onEvent } from '../rpc'
import { extractLines, lineText } from './extract'

export interface Block extends PersistedBlock {
  running?: boolean
  collapsed?: boolean
  selected?: boolean
  correction?: string
  restored?: boolean
}

type PtyEvent = RouterEvent | { type: 'raw'; data: string } | { type: 'exit'; code: number }

const NOT_FOUND = /not recognized|não é reconhecido|command not found|não encontrado/i
const PERSISTED_LINES = 400

export function xtermTheme(theme: Theme): ITheme {
  const { normal: n, bright: b } = theme
  return {
    background: '#00000000',
    foreground: theme.foreground,
    cursor: theme.accent,
    selectionBackground: `${theme.accent}55`,
    black: n.black, red: n.red, green: n.green, yellow: n.yellow, blue: n.blue, magenta: n.magenta, cyan: n.cyan, white: n.white,
    brightBlack: b.black, brightRed: b.red, brightGreen: b.green, brightYellow: b.yellow, brightBlue: b.blue,
    brightMagenta: b.magenta, brightCyan: b.cyan, brightWhite: b.white,
  }
}

export interface SessionHooks {
  settings(): Settings
  knownCommands(): Set<string>
  onBell(): void
  onCommandFinished(session: PaneSession, block: Block): void
  onCommandSubmitted(session: PaneSession, command: string): void
  onMetaChange(session: PaneSession): void
}

export class PaneSession {
  blocks: Block[] = []
  meta: SessionMeta = {}
  ready = false
  exited: number | null = null
  integrated = true
  alt = false
  started = false
  lastExit: number | null = null
  version = 0
  /** Set while a TUI owns the pane; the pane then shows the host full size. */
  readonly host = document.createElement('div')
  readonly parking = document.createElement('div')

  private readonly term: Terminal
  private readonly scratch: Terminal
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private pendingCommand: string | null = null
  private queue: string[] = []
  private blockCounter = 0
  private cols = 80
  private rows = 24
  private heightFrame = 0
  private finishers: Promise<void> = Promise.resolve()
  private commandWaiters: { block?: Block; resolve: (output: string) => void }[] = []

  constructor(
    readonly id: string,
    readonly profile: Profile,
    private readonly startCwd: string | undefined,
    private readonly hooks: SessionHooks,
    private readonly startup: string[],
    restored: PersistedBlock[],
  ) {
    const { appearance, terminal } = hooks.settings()
    this.term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: terminal.scrollback,
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      fontWeight: appearance.fontWeight,
      lineHeight: appearance.lineHeight,
      cursorStyle: appearance.cursorStyle,
      cursorBlink: appearance.cursorBlink,
      minimumContrastRatio: appearance.minimumContrast,
    })
    this.scratch = new Terminal({ allowProposedApi: true, scrollback: terminal.scrollback, cols: 200, rows: 50 })
    this.host.className = 'live-host'
    this.parking.className = 'live-parking'
    this.parking.appendChild(this.host)
    this.blocks = restored.map((block) => ({ ...block, restored: true }))
    if (restored.length) this.blockCounter = restored.length
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(new WebLinksAddon((_, uri) => void api.openExternal(uri)))
    this.term.onData((data) => void api.ptyWrite(this.id, data))
    this.term.onBell(() => hooks.onBell())
    this.term.buffer.onBufferChange((buffer) => {
      this.alt = buffer.type === 'alternate'
      this.notify()
    })
    this.term.parser.registerOscHandler(52, (data) => this.handleClipboard(data))
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event))
    this.term.onWriteParsed(() => this.scheduleHeight())
    this.disposers.push(onEvent('pty', (paneId: string, events: PtyEvent[]) => {
      if (paneId === this.id) for (const event of events) this.handle(event)
    }))
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): number => this.version

  notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  get running(): Block | null {
    return this.blocks.at(-1)?.running ? this.blocks.at(-1)! : null
  }

  get kind(): string {
    return this.meta.shell ?? this.profile.kind
  }

  get cwd(): string | undefined {
    return this.meta.cwd ?? this.startCwd
  }

  /** The xterm needs a laid-out element to measure its cells, hence the parking element. */
  mount(container: HTMLElement): void {
    container.appendChild(this.parking)
    if (this.term.element) return
    this.term.open(this.host)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      this.term.loadAddon(webgl)
    } catch {
      // The DOM renderer takes over when WebGL is unavailable.
    }
  }

  cellSize(): { width: number; height: number } {
    const core = (this.term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } } })._core
    const cell = core?._renderService?.dimensions?.css?.cell
    if (cell?.width) return cell
    const { fontSize, lineHeight, fontFamily } = this.hooks.settings().appearance
    const context = document.createElement('canvas').getContext('2d')!
    context.font = `${fontSize}px ${fontFamily}`
    return { width: context.measureText('W').width, height: Math.ceil(fontSize * lineHeight) }
  }

  /** Applies a new viewport size and starts the shell the first time the pane has one. */
  fit(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    const cell = this.cellSize()
    const cols = Math.max(20, Math.floor(width / cell.width))
    const rows = Math.max(5, Math.floor(height / cell.height))
    if (!this.started) {
      this.cols = cols
      this.rows = rows
      this.term.resize(cols, rows)
      void this.start()
      return
    }
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.term.resize(cols, rows)
    void api.ptyResize(this.id, cols, rows)
    this.scheduleHeight()
  }

  private async start(): Promise<void> {
    this.started = true
    this.queue.push(...(this.profile.startup ?? []), ...this.startup)
    const { integrated } = await api.ptyCreate(this.id, this.profile, this.startCwd, this.cols, this.rows)
    this.integrated = integrated
    if (!integrated) {
      this.placeHost(null)
      this.alt = true
    }
    this.notify()
  }

  private handle(event: PtyEvent): void {
    switch (event.type) {
      case 'raw':
        this.term.write(event.data)
        break
      case 'output':
        this.term.write(event.data)
        break
      case 'background':
        this.appendBackground(event.data)
        break
      case 'commandStart':
        this.beginBlock()
        break
      case 'commandEnd':
        this.finishers = this.finishers.then(() => this.endBlock(event.exitCode))
        break
      case 'promptReady':
        this.finishers = this.finishers.then(() => this.onPrompt())
        break
      case 'meta': {
        const previous = this.meta.cwd
        this.meta = { ...this.meta, ...(event.data as SessionMeta) }
        if (previous !== this.meta.cwd) this.hooks.onMetaChange(this)
        this.notify()
        break
      }
      case 'exit':
        this.exited = event.code
        this.ready = false
        if (this.running) void this.endBlock(null)
        this.notify()
        break
    }
  }

  private onPrompt(): void {
    this.ready = true
    const next = this.queue.shift()
    this.notify()
    if (next) this.submit(next)
  }

  private beginBlock(): void {
    this.term.reset()
    const block: Block = {
      id: `${this.id}-${++this.blockCounter}`,
      command: this.pendingCommand ?? '',
      cwd: this.meta.cwd,
      git: this.meta.git,
      exitCode: null,
      startedAt: Date.now(),
      durationMs: 0,
      lines: [],
      running: true,
    }
    this.pendingCommand = null
    this.blocks = [...this.blocks, block]
    const waiter = this.commandWaiters.find((w) => !w.block)
    if (waiter) waiter.block = block
    this.notify()
    this.scheduleHeight()
  }

  private endBlock(exitCode: number | null): Promise<void> {
    const block = this.running
    if (!block) return Promise.resolve()
    return new Promise((resolve) => {
      // An empty write resolves once everything queued before it has been parsed.
      this.term.write('', () => {
        const lines = extractLines(this.term.buffer.normal)
        const finished: Block = { ...block, lines, exitCode, durationMs: Date.now() - block.startedAt, running: false }
        finished.correction = this.findCorrection(finished)
        this.blocks = isClearCommand(block.command) ? [] : this.blocks.map((b) => (b === block ? finished : b))
        this.lastExit = exitCode
        this.term.reset()
        this.placeHost(null)
        this.notify()
        this.hooks.onCommandFinished(this, finished)
        const waiterIndex = this.commandWaiters.findIndex((w) => w.block === block)
        if (waiterIndex >= 0) {
          const [waiter] = this.commandWaiters.splice(waiterIndex, 1)
          const text = lines.map(lineText).join('\n')
          waiter.resolve(`exit code: ${exitCode ?? 'desconhecido'}\n${text}`)
        }
        resolve()
      })
    })
  }

  private findCorrection(block: Block): string | undefined {
    if (!block.exitCode || !this.hooks.settings().input.commandCorrections) return undefined
    if (!block.lines.slice(0, 4).some((line) => NOT_FOUND.test(lineText(line)))) return undefined
    const first = block.command.trim().split(/\s+/)[0]
    const known = closestCommand(first, this.hooks.knownCommands())
    return known ? block.command.replace(first, known) : undefined
  }

  private appendBackground(data: string): void {
    this.scratch.write(data, () => {
      const lines = extractLines(this.scratch.buffer.normal)
      this.scratch.reset()
      const last = this.blocks.at(-1)
      if (last?.background) {
        this.blocks = [...this.blocks.slice(0, -1), { ...last, lines: [...last.lines, ...lines] }]
      } else {
        this.blocks = [
          ...this.blocks,
          { id: `${this.id}-${++this.blockCounter}`, command: '', exitCode: 0, startedAt: Date.now(), durationMs: 0, lines, background: true },
        ]
      }
      this.notify()
    })
  }

  /** Runs a command now, or as soon as the shell is back at a prompt. */
  submit(command: string): void {
    if (!command.trim()) return
    if (!this.integrated) {
      void api.ptySubmit(this.id, command)
      return
    }
    if (!this.ready || this.running) {
      this.queue.push(command)
      return
    }
    this.ready = false
    this.pendingCommand = command
    this.hooks.onCommandSubmitted(this, command)
    this.notify()
    void api.ptySubmit(this.id, command)
  }

  /** Runs a command for the agent and resolves with its output once the block ends. */
  runForAgent(command: string): Promise<string> {
    return new Promise((resolve) => {
      this.commandWaiters.push({ resolve })
      this.submit(command)
    })
  }

  get isCliAgent(): boolean {
    const running = this.running
    return !!running && isCliAgentCommand(running.command)
  }

  /** Puts the live xterm in a block, in the alt-screen layer, or back in the parking spot. */
  placeHost(target: HTMLElement | null): void {
    const parent = target ?? this.parking
    if (this.host.parentElement !== parent) parent.appendChild(this.host)
    this.scheduleHeight()
  }

  private scheduleHeight(): void {
    if (this.heightFrame) return
    this.heightFrame = requestAnimationFrame(() => {
      this.heightFrame = 0
      const buffer = this.term.buffer.normal
      const used = this.alt || !this.integrated ? this.rows : Math.min(this.rows, buffer.baseY + buffer.cursorY + 1)
      this.host.style.height = `${Math.max(1, used) * this.cellSize().height}px`
    })
  }

  focus(): void {
    this.term.focus()
  }

  sendRaw(data: string): void {
    void api.ptyWrite(this.id, data)
  }

  interrupt(): void {
    this.sendRaw('\x03')
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true
    if (event.ctrlKey && !event.shiftKey && event.key === 'c' && this.term.hasSelection()) {
      void api.copyText(this.term.getSelection())
      this.term.clearSelection()
      return false
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'v') {
      void api.readClipboard().then((text) => this.term.paste(text))
      return false
    }
    return true
  }

  private handleClipboard(data: string): boolean {
    if (this.hooks.settings().terminal.osc52 === 'off') return true
    const [, payload] = data.split(';')
    if (payload && payload !== '?') {
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
      void api.copyText(new TextDecoder().decode(bytes))
    }
    return true
  }

  applyAppearance(theme: Theme): void {
    const { appearance } = this.hooks.settings()
    const options = this.term.options
    options.theme = xtermTheme(theme)
    options.fontFamily = appearance.fontFamily
    options.fontSize = appearance.fontSize
    options.fontWeight = appearance.fontWeight
    options.lineHeight = appearance.lineHeight
    options.cursorStyle = appearance.cursorStyle
    options.cursorBlink = appearance.cursorBlink
    options.minimumContrastRatio = appearance.minimumContrast
    this.scheduleHeight()
  }

  /** Mutates visible block state and redraws. */
  updateBlocks(update: (blocks: Block[]) => Block[]): void {
    this.blocks = update(this.blocks)
    this.notify()
  }

  persistable(): PersistedBlock[] {
    return this.blocks
      .filter((block) => !block.running)
      .slice(-100)
      .map(({ id, command, cwd, git, exitCode, startedAt, durationMs, bookmarked, background, lines }) => ({
        id, command, cwd, git, exitCode, startedAt, durationMs, bookmarked, background,
        lines: lines.slice(-PERSISTED_LINES),
      }))
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose()
    void api.ptyKill(this.id)
    this.term.dispose()
    this.scratch.dispose()
    this.parking.remove()
  }
}
