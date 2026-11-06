import type { IBuffer, IBufferCell } from '@xterm/xterm'
import type { StyledLine, StyledSpan } from '../../shared/types'

// Default 256-color cube and grayscale; the first 16 stay as theme variables.
function palette256(index: number): string {
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10
    return `rgb(${gray},${gray},${gray})`
  }
  const n = index - 16
  const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
  return `rgb(${level(Math.floor(n / 36))},${level(Math.floor(n / 6) % 6)},${level(n % 6)})`
}

function color(mode: 'fg' | 'bg', cell: IBufferCell): string | undefined {
  const value = mode === 'fg' ? cell.getFgColor() : cell.getBgColor()
  const palette = mode === 'fg' ? cell.isFgPalette() : cell.isBgPalette()
  const rgb = mode === 'fg' ? cell.isFgRGB() : cell.isBgRGB()
  if (palette) return value < 16 ? `var(--ansi-${value})` : palette256(value)
  if (rgb) return `#${value.toString(16).padStart(6, '0')}`
  return undefined
}

function styleKey(span: Omit<StyledSpan, 't'>): string {
  return `${span.fg}|${span.bg}|${span.b}|${span.i}|${span.u}|${span.d}|${span.s}`
}

/** Reads a buffer into styled logical lines, so that wrapped rows reflow with the pane later on. */
export function extractLines(buffer: IBuffer): StyledLine[] {
  const lines: StyledLine[] = []
  const cell = buffer.getNullCell()
  const end = buffer.baseY + buffer.cursorY
  for (let y = 0; y < buffer.length; y++) {
    const row = buffer.getLine(y)
    if (!row) continue
    if (y > end && row.translateToString(true) === '') continue
    const spans: StyledLine = row.isWrapped && lines.length ? lines.pop()! : []
    let trailing = row.length
    while (trailing > 0) {
      const chars = row.getCell(trailing - 1, cell)
      if (chars?.getChars() && chars.getChars() !== ' ') break
      if (chars && !chars.isBgDefault()) break
      trailing--
    }
    let lastKey = spans.length ? styleKey(spans.at(-1)!) : ''
    for (let x = 0; x < trailing; x++) {
      const current = row.getCell(x, cell)
      if (!current || current.getWidth() === 0) continue
      const inverse = !!current.isInverse()
      const fg = color('fg', current)
      const bg = color('bg', current)
      const style: Omit<StyledSpan, 't'> = {}
      const shownFg = inverse ? (bg ?? 'var(--bg)') : fg
      const shownBg = inverse ? (fg ?? 'var(--fg)') : bg
      if (shownFg) style.fg = shownFg
      if (shownBg) style.bg = shownBg
      if (current.isBold()) style.b = 1
      if (current.isItalic()) style.i = 1
      if (current.isUnderline()) style.u = 1
      if (current.isDim()) style.d = 1
      if (current.isStrikethrough()) style.s = 1
      const key = styleKey(style)
      const text = current.getChars() || ' '
      if (key === lastKey && spans.length) spans.at(-1)!.t += text
      else spans.push({ t: text, ...style })
      lastKey = key
    }
    lines.push(spans)
  }
  while (lines.length && lineText(lines.at(-1)!).trim() === '') lines.pop()
  return lines
}

export function lineText(line: StyledLine): string {
  return line.map((span) => span.t).join('')
}
