import type { TabConfig, TabConfigPane, Workflow } from './types'

// --- Fuzzy matching -------------------------------------------------------------------------

/** Scores a subsequence match, favouring prefixes and consecutive runs. Null means no match. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let ti = 0
  let run = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    run = found === ti ? run + 1 : 0
    score += 1 + run * 2
    if (found === 0) score += 6
    else if (/[\s\-_/:.]/.test(t[found - 1])) score += 3
    score -= Math.min(found - ti, 4) * 0.25
    ti = found + 1
  }
  return score - text.length * 0.01
}

export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string): T[] {
  if (!query) return items
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const score = fuzzyScore(query, key(item))
    if (score !== null) scored.push({ item, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item)
}

/** Edit distance that counts a transposition as one edit, the most common typing mistake. */
export function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
      }
    }
  }
  return rows[a.length][b.length]
}

/** Closest known command to a mistyped one, within a distance that still reads as a typo. */
export function closestCommand(typed: string, known: Iterable<string>): string | null {
  const limit = Math.max(1, Math.floor(typed.length / 3))
  let best: string | null = null
  let bestDistance = limit + 1
  for (const candidate of known) {
    if (Math.abs(candidate.length - typed.length) > limit) continue
    const distance = editDistance(typed.toLowerCase(), candidate.toLowerCase())
    if (distance > 0 && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

// --- Command tokenizer ----------------------------------------------------------------------

export type TokenType = 'command' | 'subcommand' | 'option' | 'argument' | 'string' | 'variable' | 'operator' | 'comment'

export interface Token {
  type: TokenType
  from: number
  to: number
  text: string
}

const OPERATORS = new Set(['|', '||', '&&', ';', '&', '>', '>>', '<', '2>', '2>&1'])
const REDIRECTS = /^(?:>|>>|<|2>|2>&1)$/

/** Lightweight shell tokenizer, good enough for colouring and for locating the word being edited. */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let expectCommand = true
  let afterRedirect = false
  let words = 0
  while (i < line.length) {
    const ch = line[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const from = i
    if (ch === '#') {
      tokens.push({ type: 'comment', from, to: line.length, text: line.slice(from) })
      break
    }
    if (ch === '"' || ch === "'") {
      i++
      while (i < line.length && line[i] !== ch) i += line[i] === '\\' && ch === '"' ? 2 : 1
      i = Math.min(i + 1, line.length)
      tokens.push({ type: 'string', from, to: i, text: line.slice(from, i) })
      expectCommand = false
      words++
      continue
    }
    const op = /^(?:\|\||&&|2>&1|>>|2>|[|;&<>])/.exec(line.slice(i))
    if (op && OPERATORS.has(op[0])) {
      i += op[0].length
      tokens.push({ type: 'operator', from, to: i, text: op[0] })
      if (REDIRECTS.test(op[0])) {
        afterRedirect = true
      } else {
        expectCommand = true
        words = 0
      }
      continue
    }
    while (i < line.length && !/[\s|;&<>]/.test(line[i])) i += line[i] === '\\' ? 2 : 1
    i = Math.min(i, line.length)
    const text = line.slice(from, i)
    let type: TokenType = 'argument'
    if (expectCommand) type = 'command'
    else if (text.startsWith('-')) type = 'option'
    else if (text.startsWith('$')) type = 'variable'
    else if (words === 1 && !afterRedirect) type = 'subcommand'
    tokens.push({ type, from, to: i, text })
    expectCommand = false
    afterRedirect = false
    words++
  }
  return tokens
}

/** Words of the last pipeline segment, unquoted, ending at the given offset. */
export function commandWords(line: string, offset: number): { words: string[]; current: string; from: number } {
  const before = line.slice(0, offset)
  const tokens = tokenize(before)
  let start = 0
  tokens.forEach((token, index) => {
    if (token.type === 'operator' && !REDIRECTS.test(token.text)) start = index + 1
  })
  const segment = tokens.slice(start).filter((t) => t.type !== 'operator' && t.type !== 'comment')
  const last = segment.at(-1)
  const editing = last && last.to === offset
  const words = (editing ? segment.slice(0, -1) : segment).map((t) => t.text.replace(/^["']|["']$/g, ''))
  return {
    words,
    current: editing ? last.text.replace(/^["']/, '') : '',
    from: editing ? last.from : offset,
  }
}

// --- Parameters -----------------------------------------------------------------------------

const PARAM = /\{\{\s*([\w-]+)\s*\}\}/g

export function templateParams(text: string): string[] {
  return [...new Set([...text.matchAll(PARAM)].map((m) => m[1]))]
}

export function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(PARAM, (whole, name: string) => values[name] ?? whole)
}

export function workflowParams(workflow: Workflow): string[] {
  const declared = workflow.arguments?.map((a) => a.name) ?? []
  return [...new Set([...declared, ...templateParams(workflow.command)])].filter((name) =>
    templateParams(workflow.command).includes(name),
  )
}

// --- Tab configs ----------------------------------------------------------------------------

/** Returns the problems of a tab config, an empty list meaning that it is valid. */
export function validateTabConfig(config: TabConfig): string[] {
  const errors: string[] = []
  if (!config.name) errors.push('campo "name" é obrigatório')
  if (!Array.isArray(config.panes) || config.panes.length === 0) {
    errors.push('é preciso ao menos um [[panes]]')
    return errors
  }
  const byId = new Map<string, TabConfigPane>()
  for (const pane of config.panes) {
    if (!pane.id) errors.push('pane sem "id"')
    else if (byId.has(pane.id)) errors.push(`id duplicado: ${pane.id}`)
    byId.set(pane.id, pane)
    if (pane.split) {
      if (pane.split !== 'horizontal' && pane.split !== 'vertical') errors.push(`${pane.id}: split inválido`)
      if (!pane.children || pane.children.length < 2) errors.push(`${pane.id}: split precisa de 2+ filhos`)
    } else if (pane.children) {
      errors.push(`${pane.id}: pane folha não pode ter children`)
    }
  }
  for (const pane of config.panes) {
    for (const child of pane.children ?? []) {
      if (!byId.has(child)) errors.push(`${pane.id}: filho inexistente ${child}`)
    }
  }
  if (config.panes.filter((p) => p.is_focused).length > 1) errors.push('apenas um pane pode ter is_focused')
  const visit = (id: string, trail: Set<string>): void => {
    if (trail.has(id)) {
      errors.push(`ciclo na árvore em ${id}`)
      return
    }
    const next = new Set(trail).add(id)
    for (const child of byId.get(id)?.children ?? []) visit(child, next)
  }
  visit(config.panes[0].id, new Set())
  return errors
}

// --- Secret redaction -----------------------------------------------------------------------

export const DEFAULT_SECRET_PATTERNS: string[] = [
  'AKIA[0-9A-Z]{16}',
  'gh[pousr]_[A-Za-z0-9]{36,}',
  'github_pat_[A-Za-z0-9_]{40,}',
  'sk-[A-Za-z0-9_-]{20,}',
  'xox[baprs]-[A-Za-z0-9-]{10,}',
  'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  '(?<=[?&](?:token|api_key|apikey|secret|password)=)[^&\\s]+',
  '(?<=(?:password|passwd|secret|api[_-]?key|token)\\s*[=:]\\s*["\']?)[^\\s"\']{6,}',
]

export function compileSecretPatterns(custom: string[] = []): RegExp[] {
  const compiled: RegExp[] = []
  for (const source of [...DEFAULT_SECRET_PATTERNS, ...custom]) {
    try {
      compiled.push(new RegExp(source, 'gi'))
    } catch {
      // A broken user pattern must not disable the others.
    }
  }
  return compiled
}

export function secretRanges(text: string, patterns: RegExp[]): [number, number][] {
  const ranges: [number, number][] = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      if (match[0]) ranges.push([match.index, match.index + match[0].length])
    }
  }
  return mergeRanges(ranges)
}

export function redact(text: string, patterns: RegExp[]): string {
  let out = ''
  let cursor = 0
  for (const [from, to] of secretRanges(text, patterns)) {
    out += text.slice(cursor, from) + '•'.repeat(Math.min(to - from, 12))
    cursor = to
  }
  return out + text.slice(cursor)
}

export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

// --- Block filter ---------------------------------------------------------------------------

export interface FilterOptions {
  query: string
  regex?: boolean
  caseSensitive?: boolean
  context?: number
}

export function buildMatcher(options: FilterOptions): RegExp | null {
  if (!options.query) return null
  const source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

/** Indexes of the lines to keep, including the requested context around each match. */
export function filterLines(lines: string[], options: FilterOptions): number[] {
  const matcher = buildMatcher(options)
  if (!matcher) return options.query ? [] : lines.map((_, i) => i)
  const context = options.context ?? 0
  const keep = new Set<number>()
  lines.forEach((line, index) => {
    matcher.lastIndex = 0
    if (!matcher.test(line)) return
    for (let i = Math.max(0, index - context); i <= Math.min(lines.length - 1, index + context); i++) keep.add(i)
  })
  return [...keep].sort((a, b) => a - b)
}

// --- Shell helpers --------------------------------------------------------------------------

/** Encodes a command for the shell's line editor; newlines must not read as Enter. */
export function encodeCommand(command: string, kind: string): string {
  const text = command.replace(/\r\n/g, '\n').trimEnd()
  if (kind === 'powershell') return `${text.replace(/\t/g, '    ').replace(/\n/g, '\x1bj')}\r`
  if (kind === 'cmd' || !text.includes('\n')) return `${text}\r`
  return `\x1b[200~${text}\x1b[201~\r`
}

export function isClearCommand(command: string): boolean {
  return /^(?:clear|cls|clear-host)$/i.test(command.trim())
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function toWslPath(path: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  if (!match) return path.replace(/\\/g, '/')
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`
}

// --- Agent command policy -------------------------------------------------------------------

const READ_ONLY = /^(?:ls|dir|pwd|cat|type|head|tail|wc|echo|which|where|whoami|date|git (?:status|log|diff|show|branch)|Get-(?:ChildItem|Content|Location|Date|Process|Command))(?:\s|$)/i

function matchesAny(patterns: string[], command: string): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(`^(?:${pattern})$`, 'i').test(command)
    } catch {
      return false
    }
  })
}

/** Splits on shell separators, so that a rule cannot be dodged by chaining commands. */
export function commandSegments(command: string): string[] {
  const parts: string[] = []
  let cursor = 0
  for (const token of tokenize(command)) {
    if (token.type === 'operator' && !REDIRECTS.test(token.text)) {
      parts.push(command.slice(cursor, token.from))
      cursor = token.to
    }
  }
  parts.push(command.slice(cursor))
  return parts.map((part) => part.trim()).filter(Boolean)
}

export function commandNeedsApproval(
  command: string,
  profile: { allow: string[]; deny: string[]; execute: 'always_ask' | 'agent_decides' | 'always_allow' },
): boolean {
  const segments = commandSegments(command)
  if (segments.length === 0) return true
  if (segments.some((segment) => matchesAny(profile.deny, segment))) return true
  // Substitutions and redirects run or write things the segment text does not show.
  if (/[`\n]|\$\(|>/.test(command)) return profile.execute !== 'always_allow'
  if (segments.every((segment) => matchesAny(profile.allow, segment))) return false
  if (profile.execute === 'always_allow') return false
  if (profile.execute === 'always_ask') return true
  return !segments.every((segment) => READ_ONLY.test(segment))
}

const CLI_AGENTS = ['claude', 'codex', 'gemini', 'aider', 'opencode', 'copilot']

export function isCliAgentCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0]?.replace(/\.(?:exe|cmd)$/i, '').toLowerCase()
  return !!first && CLI_AGENTS.includes(first)
}

/** True when the text reads as a sentence rather than as a shell command. */
export function looksLikeNaturalLanguage(text: string, isKnownCommand: (word: string) => boolean): boolean {
  const words = text.trim().split(/\s+/)
  if (words.length < 3 || /[|&;><$`=]|--?\w/.test(text)) return false
  if (isKnownCommand(words[0])) return false
  return text.endsWith('?') || words.every((w) => /^[\p{L}'’,.?!]+$/u.test(w))
}
