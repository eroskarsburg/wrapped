import { describe, expect, it } from 'vitest'
import { OscRouter, stripAnsi, type RouterEvent } from '../../src/shared/oscRouter'

const hex = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('hex')

function run(chunks: string[], prepare?: (router: OscRouter) => void) {
  const events: RouterEvent[] = []
  const router = new OscRouter((e) => events.push(e))
  prepare?.(router)
  for (const chunk of chunks) router.feed(chunk)
  return { events, router }
}

const prompt = '\x1b]133;A\x07\x1b]133;B\x07 '

describe('OscRouter', () => {
  it('drops the prompt and the echo, keeping only the command output', () => {
    const { events, router } = run([prompt])
    router.noteSubmit()
    router.feed('\x1b[12;2Hecho hello\r\n\x1b[2J\x1b[H\x1b]133;C\x07hello\r\n\x1b]133;D;0\x07')
    expect(events).toEqual([
      { type: 'promptReady' },
      { type: 'commandStart' },
      { type: 'output', data: 'hello\r\n' },
      { type: 'commandEnd', exitCode: 0 },
    ])
  })

  it('handles a marker split across any chunk boundary', () => {
    const stream = `${prompt}\x1b]133;C\x07abc\x1b]133;D;7\x07${prompt}`
    for (let cut = 1; cut < stream.length; cut++) {
      const { events } = run([stream.slice(0, cut), stream.slice(cut)])
      const output = events.flatMap((e) => (e.type === 'output' ? [e.data] : [])).join('')
      expect(output).toBe('abc')
      expect(events).toContainEqual({ type: 'commandEnd', exitCode: 7 })
    }
  })

  it('keeps a pasted script that marks each of its commands in one block', () => {
    const { events } = run([`${prompt}\x1b]133;C\x07um\r\n\x1b]133;C\x07dois\r\n\x1b]133;D;0\x07${prompt}`])
    expect(events.filter((e) => e.type === 'commandStart')).toHaveLength(1)
    expect(events.flatMap((e) => (e.type === 'output' ? [e.data] : [])).join('')).toBe('um\r\ndois\r\n')
  })

  it('accepts the ST terminator as well as BEL', () => {
    const { events } = run(['\x1b]133;B\x1b\\', '\x1b]133;C\x1b\\x\x1b]133;D;2\x1b\\'])
    expect(events).toContainEqual({ type: 'commandEnd', exitCode: 2 })
  })

  it('passes unrelated OSC sequences through to the block', () => {
    const { events } = run([`${prompt}\x1b]133;C\x07\x1b]0;title\x07x\x1b]133;D;0\x07`])
    expect(events.flatMap((e) => (e.type === 'output' ? [e.data] : [])).join('')).toBe('\x1b]0;title\x07x')
  })

  it('decodes metadata', () => {
    const { events } = run([`\x1b]7777;${hex({ cwd: 'C:\\é', git: 'main' })}\x07`])
    expect(events).toEqual([{ type: 'meta', data: { cwd: 'C:\\é', git: 'main' } }])
  })

  it('survives malformed metadata', () => {
    const { events } = run(['\x1b]7777;zz\x07', prompt])
    expect(events).toEqual([{ type: 'promptReady' }])
  })

  it('reports text printed while idle as background output', () => {
    const { events } = run([prompt, 'job done\r\n'])
    expect(events).toContainEqual({ type: 'background', data: 'job done\r\n' })
  })

  it('ignores control-only noise while idle', () => {
    const { events } = run([prompt, '\x1b[?25h\x1b[3;1H  '])
    expect(events).toEqual([{ type: 'promptReady' }])
  })

  it('reports startup banners before the first prompt', () => {
    const { events } = run(['Bem-vindo\r\n', prompt])
    expect(events[0]).toEqual({ type: 'background', data: 'Bem-vindo\r\n' })
  })

  it('ignores ConPTY repaints right after a resize', () => {
    let now = 1000
    const events: RouterEvent[] = []
    const router = new OscRouter((e) => events.push(e), () => now)
    router.feed(prompt)
    router.noteResize()
    router.feed('old screen content')
    expect(events).toEqual([{ type: 'promptReady' }])
    now += 1000
    router.feed('real output')
    expect(events).toContainEqual({ type: 'background', data: 'real output' })
  })

  it('ends a running block when a new prompt arrives without D', () => {
    const { events } = run([`${prompt}\x1b]133;C\x07x${prompt}`])
    expect(events).toContainEqual({ type: 'commandEnd', exitCode: null })
  })

  it('ignores a D marker with no running command', () => {
    const { events } = run([`${prompt}\x1b]133;D;0\x07`])
    expect(events.some((e) => e.type === 'commandEnd')).toBe(false)
  })

  it('keeps a lone trailing ESC for the next chunk', () => {
    const { events } = run([`${prompt}\x1b]133;C\x07a\x1b`, '[31mb'])
    const output = events.flatMap((e) => (e.type === 'output' ? [e.data] : [])).join('')
    expect(output).toBe('a\x1b[31mb')
  })

  it('does not hold an unterminated OSC forever', () => {
    const long = `\x1b]9;${'x'.repeat(70000)}`
    const { events } = run([`${prompt}\x1b]133;C\x07`, long])
    expect(events.some((e) => e.type === 'output')).toBe(true)
  })
})

describe('stripAnsi', () => {
  it('removes CSI and OSC sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m \x1b]0;t\x07ok')).toBe('red ok')
  })
})
