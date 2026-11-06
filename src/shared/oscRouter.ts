// Splits the raw PTY stream into command blocks using the shell integration markers.
// The shell's own prompt and echo are dropped here, since the UI draws its own input.

export type RouterEvent =
  | { type: 'promptReady' }
  | { type: 'commandStart' }
  | { type: 'output'; data: string }
  | { type: 'commandEnd'; exitCode: number | null }
  | { type: 'background'; data: string }
  | { type: 'meta'; data: Record<string, unknown> }

type State = 'boot' | 'prompt' | 'idle' | 'echo' | 'running'

const ESC = '\x1b'
const BEL = '\x07'
const MAX_PENDING = 1 << 16
const RESIZE_REPAINT_MS = 500

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])|[\x00-\x08\x0b-\x1f\x7f]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

function decodeHex(hex: string): string {
  const bytes = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return new TextDecoder().decode(bytes)
}

export class OscRouter {
  private state: State = 'boot'
  private pending = ''
  private ignoreBackgroundUntil = 0

  constructor(
    private readonly emit: (event: RouterEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get running(): boolean {
    return this.state === 'running'
  }

  /** The UI wrote a command; whatever follows until the C marker is the shell's echo. */
  noteSubmit(): void {
    if (this.state === 'idle') this.state = 'echo'
  }

  /** ConPTY repaints its screen after a resize, which must not look like background output. */
  noteResize(): void {
    this.ignoreBackgroundUntil = this.now() + RESIZE_REPAINT_MS
  }

  feed(chunk: string): void {
    let text = this.pending + chunk
    this.pending = ''
    let cursor = 0
    while (cursor < text.length) {
      const start = text.indexOf(`${ESC}]`, cursor)
      if (start < 0) break
      const end = findTerminator(text, start + 2)
      if (end === null) {
        if (text.length - start > MAX_PENDING) break
        this.route(text.slice(cursor, start))
        this.pending = text.slice(start)
        return
      }
      const body = text.slice(start + 2, end.bodyEnd)
      if (this.isControl(body)) {
        this.route(text.slice(cursor, start))
        this.control(body)
        cursor = end.next
      } else {
        this.route(text.slice(cursor, end.next))
        cursor = end.next
      }
    }
    text = text.slice(cursor)
    if (text.endsWith(ESC)) {
      this.pending = ESC
      text = text.slice(0, -1)
    }
    this.route(text)
  }

  private isControl(body: string): boolean {
    return body.startsWith('133;') || body.startsWith('7777;')
  }

  private control(body: string): void {
    if (body.startsWith('7777;')) {
      try {
        this.emit({ type: 'meta', data: JSON.parse(decodeHex(body.slice(5))) })
      } catch {
        // A malformed metadata message must never interrupt the command stream.
      }
      return
    }
    const [, kind, arg] = body.split(';')
    switch (kind) {
      case 'A':
        if (this.state === 'running') this.emit({ type: 'commandEnd', exitCode: null })
        this.state = 'prompt'
        break
      case 'B':
        this.state = 'idle'
        this.emit({ type: 'promptReady' })
        break
      case 'C':
        this.state = 'running'
        this.emit({ type: 'commandStart' })
        break
      case 'D':
        if (this.state === 'running') {
          const code = Number.parseInt(arg ?? '', 10)
          this.emit({ type: 'commandEnd', exitCode: Number.isNaN(code) ? null : code })
          this.state = 'prompt'
        }
        break
    }
  }

  private route(data: string): void {
    if (!data) return
    if (this.state === 'running') {
      this.emit({ type: 'output', data })
    } else if ((this.state === 'idle' || this.state === 'boot') && this.now() >= this.ignoreBackgroundUntil) {
      if (stripAnsi(data).trim()) this.emit({ type: 'background', data })
    }
  }
}

function findTerminator(text: string, from: number): { bodyEnd: number; next: number } | null {
  for (let i = from; i < text.length; i++) {
    if (text[i] === BEL) return { bodyEnd: i, next: i + 1 }
    if (text[i] === ESC) {
      if (i + 1 >= text.length) return null
      if (text[i + 1] === '\\') return { bodyEnd: i, next: i + 2 }
    }
  }
  return null
}
