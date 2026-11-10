import type { FontInfo, TabConfig, TabConfigPane, Workflow } from './types'

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

// --- Links in output ------------------------------------------------------------------------

export interface OutputLink {
  from: number
  to: number
  /** A URL, or a path as written, without the line suffix. */
  target: string
  url: boolean
  line?: number
  column?: number
}

// Paths: Windows drive paths, absolute or home-relative Unix paths (with an optional file://),
// and relative paths that have a separator and end in a file extension, so that prose like
// "and/or" is not taken for one. Any of them may carry a :line:column suffix.
const LINK_PATTERN = new RegExp(
  '(?:' + [
    String.raw`https?:\/\/[^\s"'<>)\]]+`,
    String.raw`(?<![\w/])[A-Za-z]:[\\/][^\s"'<>|:*?]+`,
    String.raw`(?<![\w.~/-])(?:file:\/\/)?~?\/(?:[\w.@+-]+\/)*[\w.@+-]+\/?`,
    String.raw`(?<![\w.~/-])(?:\.{1,2}[\\/])?(?:[\w.@+-]+[\\/])+[\w@+-]+(?:\.[A-Za-z0-9]{1,8})+`,
  ].join('|') + ')' + String.raw`(?::(\d+)(?::(\d+))?)?`,
  'g',
)

const MIME_TYPE = /^(?:application|audio|font|image|message|model|multipart|text|video)\/[\w.+-]+$/
const DIFF_HEADER = /^(?:diff --git |--- |\+\+\+ )/

export function findLinks(text: string): OutputLink[] {
  const links: OutputLink[] = []
  const diffHeader = DIFF_HEADER.test(text)
  for (const match of text.matchAll(LINK_PATTERN)) {
    const whole = match[0]
    const url = /^https?:/i.test(whole)
    // A trailing period or comma usually ends the sentence rather than the path.
    let end = whole.length
    while (end > 0 && /[.,;:]/.test(whole[end - 1])) end--
    let target = whole.slice(0, end)
    let line: number | undefined
    let column: number | undefined
    const suffix = match[1] ? `:${match[1]}${match[2] ? `:${match[2]}` : ''}` : ''
    if (!url && suffix && target.endsWith(suffix)) {
      line = Number(match[1])
      column = match[2] ? Number(match[2]) : undefined
      target = target.slice(0, -suffix.length)
    }
    if (!url) {
      target = target.replace(/^file:\/\//, '')
      const rooted = /^(?:[A-Za-z]:|~|\.{0,2}[\\/])/.test(target)
      // "node/20.1" and "HTTP/1.1" are versions, "text/html" is a media type: not files.
      if (!rooted && (/(?:^|[\\/])v?\d+(?:\.\d+)*$/.test(target) || MIME_TYPE.test(target))) continue
      // A bare "/" or "~/" is never meant as a link.
      if (target.replace(/^~/, '').replace(/[\\/]/g, '').length === 0) continue
      // git prefixes the two sides of a diff with a/ and b/, which are not directories.
      if (diffHeader && !rooted) target = target.replace(/^[ab]\//, '')
    }
    links.push({ from: match.index, to: match.index + end, target, url, line, column })
  }
  return links
}

/** Absolute form of a path printed by a command that ran in cwd. */
export function resolveOutputPath(target: string, cwd: string | undefined, home: string): string {
  // A WSL pane reports its directory as \\wsl.localhost\<distro>\..., and its paths live there.
  const wsl = /^\\\\wsl[^\\]*\\[^\\]+/.exec(cwd ?? '')?.[0]
  if (wsl && target.startsWith('/')) return wsl + target.replace(/\//g, '\\')
  if (target.startsWith('~')) return wsl ? target : home + target.slice(1)
  if (/^(?:[A-Za-z]:)?[\\/]/.test(target) || !cwd) return target
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  for (const part of target.split(/[\\/]/)) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join(sep) || sep
}

// --- Shell history import -------------------------------------------------------------------

/**
 * zsh writes its history "metafied": bytes 0x83 to 0xA2 become 0x83 followed by the byte xor 0x20,
 * which breaks every accented character if the file is read as plain UTF-8.
 */
export function unmetafy(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  let length = 0
  for (let i = 0; i < bytes.length; i++) {
    out[length++] = bytes[i] === 0x83 && i + 1 < bytes.length ? bytes[++i] ^ 0x20 : bytes[i]
  }
  return out.subarray(0, length)
}

/** Commands from a shell's own history file, oldest first. */
export function parseShellHistory(text: string, format: 'plain' | 'zsh' | 'fish'): string[] {
  const commands: string[] = []
  if (format === 'fish') {
    // Entries look like "- cmd: git status", with backslash escapes for newlines.
    for (const line of text.split(/\r?\n/)) {
      const match = /^- cmd: (.*)$/.exec(line)
      if (match) commands.push(match[1].replace(/\\(.)/g, (_, ch: string) => (ch === 'n' ? '\n' : ch)))
    }
    return commands.filter((c) => c.trim())
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (format === 'zsh') {
      // Extended history prefixes each entry with ": <start>:<elapsed>;".
      line = line.replace(/^: \d+:\d+;/, '')
      while (line.endsWith('\\') && i + 1 < lines.length) line = `${line.slice(0, -1)}\n${lines[++i]}`
    } else if (line.endsWith('`') || /^#\d+$/.test(line)) {
      // PowerShell continuation lines and bash timestamps.
      continue
    }
    if (line.trim()) commands.push(line)
  }
  return commands
}

// --- Agent request options ------------------------------------------------------------------

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Models whose refusals the API can retry on another model inside the same call. */
const SERVER_FALLBACK = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])
/** Models from before adaptive thinking, which take neither it nor an effort level. */
const NO_ADAPTIVE = /^claude-(?:haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|3)/

/** Thinking, effort and refusal fallback parameters that the given model accepts. */
export function modelRequestOptions(model: string, effort: Effort): Record<string, unknown> {
  if (NO_ADAPTIVE.test(model)) return {}
  const options: Record<string, unknown> = {
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort },
  }
  if (SERVER_FALLBACK.has(model)) {
    options.betas = ['server-side-fallback-2026-07-01']
    options.fallbacks = 'default'
  }
  return options
}

/** Text after the "#" that asks for a command in plain language, or null for a normal command. */
export function commandRequest(text: string): string | null {
  // One line only: a pasted script that opens with a comment is still a script to run.
  const match = /^#\s*(\S.*)$/.exec(text.trim())
  return match ? match[1].trim() : null
}

// --- Next command prediction ----------------------------------------------------------------

/**
 * The command most often run right after `previous`, on a tie the most recent. Follow-ups seen
 * in the same directory win over the rest of the history. History is oldest first.
 */
export function predictNextCommand(
  history: { command: string; cwd?: string }[],
  previous: string,
  cwd?: string,
): string | null {
  const local = new Map<string, { count: number; last: number }>()
  const global = new Map<string, { count: number; last: number }>()
  const target = previous.trim()
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].command.trim() !== target) continue
    const next = history[i + 1]
    const command = next.command.trim()
    if (!command || command === target) continue
    for (const scores of cwd && next.cwd === cwd ? [local, global] : [global]) {
      const entry = scores.get(command) ?? { count: 0, last: 0 }
      entry.count++
      entry.last = i
      scores.set(command, entry)
    }
  }
  let best: string | null = null
  let bestEntry = { count: 0, last: -1 }
  for (const [command, entry] of local.size ? local : global) {
    if (entry.count > bestEntry.count || (entry.count === bestEntry.count && entry.last > bestEntry.last)) {
      best = command
      bestEntry = entry
    }
  }
  return best
}

/** Short relative time in Portuguese, such as "há 5 min". */
export function formatAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `há ${days} d`
  const months = Math.floor(days / 30)
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`
}

// --- Git diff summary -----------------------------------------------------------------------

export interface GitDiffStats {
  files: number
  added: number
  removed: number
}

/** Sums `git diff --numstat` and counts untracked files from `git status --porcelain`. */
export function parseGitStats(numstat: string, porcelain: string): GitDiffStats {
  const stats: GitDiffStats = { files: 0, added: 0, removed: 0 }
  for (const line of numstat.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(line)
    if (!match) continue
    stats.files++
    // Binary files show "-" in both columns.
    if (match[1] !== '-') stats.added += Number(match[1])
    if (match[2] !== '-') stats.removed += Number(match[2])
  }
  stats.files += porcelain.split('\n').filter((line) => line.startsWith('??')).length
  return stats
}

/** Families from `fc-list --format '%{family[0]}\t%{spacing:-0}\n'`: monospaced if any of its faces is (spacing 100). */
export function parseFcList(output: string): FontInfo[] {
  const fonts = new Map<string, boolean>()
  for (const line of output.split('\n')) {
    const [family, spacing] = line.split('\t')
    const name = family?.trim()
    if (!name || name.startsWith('.')) continue
    fonts.set(name, (fonts.get(name) ?? false) || Number(spacing) >= 100)
  }
  return [...fonts].map(([family, mono]) => ({ family, mono })).sort((a, b) => a.family.localeCompare(b.family))
}

/** Fallbacks kept after the chosen family, so that prompt icons still find a Nerd Font glyph. */
const FONT_FALLBACK = ["'JetBrainsMono Nerd Font'", 'monospace']

/** The CSS font stack that puts `family` first. */
export function fontStack(family: string): string {
  const quoted = `'${family.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return [quoted, ...FONT_FALLBACK.filter((item) => item.toLowerCase() !== quoted.toLowerCase())].join(', ')
}

/** The first family of a CSS font stack, unquoted. */
export function primaryFamily(stack: string): string {
  const first = /^\s*(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|([^,]*))/.exec(stack)
  return (first?.[1] ?? first?.[2] ?? first?.[3] ?? '').replace(/\\(.)/g, '$1').trim()
}
