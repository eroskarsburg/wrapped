import type { WebContents } from 'electron'
import * as nodePty from 'node-pty'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { encodeCommand } from '../shared/logic'
import { OscRouter, type RouterEvent } from '../shared/oscRouter'
import type { Profile } from '../shared/types'
import { launchArgs } from './shells'

export type PtyEvent = RouterEvent | { type: 'raw'; data: string } | { type: 'exit'; code: number }

const FLUSH_MS = 8

class PtySession {
  private readonly proc: nodePty.IPty
  private readonly router: OscRouter | null
  private queue: PtyEvent[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly paneId: string,
    readonly profile: Profile,
    cwd: string,
    cols: number,
    rows: number,
    honorPrompt: boolean,
    private readonly sink: WebContents,
  ) {
    const launch = launchArgs(profile)
    this.proc = nodePty.spawn(profile.command, launch.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      useConptyDll: true,
      env: {
        ...(process.env as Record<string, string>),
        TERM_PROGRAM: 'Wrapped',
        COLORTERM: 'truecolor',
        WRAPPED_HONOR_PROMPT: honorPrompt ? '1' : '0',
        ...launch.env,
        ...profile.env,
      },
    })
    this.router = launch.integrated ? new OscRouter((event) => this.push(event)) : null
    this.proc.onData((data) => {
      if (this.router) this.router.feed(data)
      else this.push({ type: 'raw', data })
    })
    this.proc.onExit(({ exitCode }) => {
      this.push({ type: 'exit', code: exitCode })
      sessions.delete(paneId)
    })
  }

  get integrated(): boolean {
    return this.router !== null
  }

  private push(event: PtyEvent): void {
    const last = this.queue.at(-1)
    if (event.type === 'output' && last?.type === 'output') last.data += event.data
    else this.queue.push(event)
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS)
  }

  private flush(): void {
    this.timer = null
    const events = this.queue
    this.queue = []
    if (!this.sink.isDestroyed()) this.sink.send('pty', this.paneId, events)
  }

  submit(command: string): void {
    this.router?.noteSubmit()
    this.proc.write(encodeCommand(command, this.profile.kind))
  }

  write(data: string): void {
    this.proc.write(data)
  }

  resize(cols: number, rows: number): void {
    this.router?.noteResize()
    try {
      this.proc.resize(cols, rows)
    } catch {
      // The process may have exited between the layout change and this call.
    }
  }

  kill(): void {
    try {
      this.proc.kill()
    } catch {
      // Already gone.
    }
  }
}

const sessions = new Map<string, PtySession>()

export function createSession(
  paneId: string,
  profile: Profile,
  cwd: string | undefined,
  cols: number,
  rows: number,
  honorPrompt: boolean,
  sink: WebContents,
): { integrated: boolean; cwd: string } {
  sessions.get(paneId)?.kill()
  const start = cwd && !cwd.startsWith('\\\\') && existsSync(cwd) ? cwd : homedir()
  const session = new PtySession(paneId, profile, start, cols, rows, honorPrompt, sink)
  sessions.set(paneId, session)
  return { integrated: session.integrated, cwd: start }
}

export function getSession(paneId: string): PtySession | undefined {
  return sessions.get(paneId)
}

export function killAll(): void {
  for (const session of sessions.values()) session.kill()
}
