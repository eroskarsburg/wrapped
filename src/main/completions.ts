import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { commandWords, fuzzyFilter, tokenize } from '../shared/logic'
import type { Completion, CompletionResult, TokenInfo } from '../shared/types'
import { listCommands } from './shells'

type Names = string | string[]
interface Suggestion { name?: Names; description?: string; insertValue?: string }
interface Generator {
  script?: string[] | string | ((tokens: string[]) => string[] | string)
  splitOn?: string
  postProcess?: (out: string, tokens?: string[]) => Suggestion[]
  template?: string | string[]
}
interface Arg {
  name?: string
  description?: string
  isOptional?: boolean
  isVariadic?: boolean
  suggestions?: (string | Suggestion)[]
  template?: string | string[]
  generators?: Generator | Generator[]
}
interface Option { name: Names; description?: string; args?: Arg | Arg[] }
interface Subcommand {
  name: Names
  description?: string
  subcommands?: Subcommand[]
  options?: Option[]
  args?: Arg | Arg[]
}

const specCache = new Map<string, Subcommand | null>()
const namesOf = (names: Names | undefined): string[] => (Array.isArray(names) ? names : names ? [names] : [])
const listOf = <T>(value: T | T[] | undefined): T[] => (Array.isArray(value) ? value : value ? [value] : [])

function specDir(): string {
  const dir = dirname(require.resolve('@withfig/autocomplete'))
  return dir.replace('app.asar', 'app.asar.unpacked')
}

async function loadSpec(command: string): Promise<Subcommand | null> {
  const name = command.replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase()
  if (!/^[\w.+-]+$/.test(name)) return null
  if (specCache.has(name)) return specCache.get(name) ?? null
  let spec: Subcommand | null = null
  try {
    const file = join(specDir(), `${name}.js`)
    if (existsSync(file)) {
      const loaded = await import(/* @vite-ignore */ pathToFileURL(file).href)
      spec = (loaded.default ?? null) as Subcommand | null
      if (typeof spec === 'function') spec = null
    }
  } catch (error) {
    console.warn(`wrapped: spec ${name} inválido: ${error}`)
  }
  specCache.set(name, spec)
  return spec
}

interface Walk {
  command: Subcommand
  pendingArg: Arg | null
}

/** Follows the typed words down the spec, ending at the subcommand and argument being edited. */
function walkSpec(spec: Subcommand, words: string[]): Walk {
  let command = spec
  let pendingArg: Arg | null = null
  let positional = 0
  for (const word of words.slice(1)) {
    if (pendingArg && !pendingArg.isVariadic) {
      pendingArg = null
      continue
    }
    const sub = command.subcommands?.find((s) => namesOf(s.name).includes(word))
    if (sub) {
      command = sub
      positional = 0
      pendingArg = null
      continue
    }
    if (word.startsWith('-')) {
      const option = command.options?.find((o) => namesOf(o.name).includes(word.split('=')[0]))
      const arg = listOf(option?.args)[0]
      pendingArg = arg && !arg.isOptional && !word.includes('=') ? arg : null
      continue
    }
    positional++
  }
  if (!pendingArg) {
    const args = listOf(command.args)
    pendingArg = args[Math.min(positional, args.length - 1)] ?? null
  }
  return { command, pendingArg }
}

function run(script: string[], cwd: string): Promise<string> {
  return new Promise((done) => {
    execFile(script[0], script.slice(1), { cwd, timeout: 1500, windowsHide: true, maxBuffer: 1 << 22 }, (_, stdout) =>
      done(stdout ?? ''),
    )
  })
}

async function argSuggestions(arg: Arg, words: string[], cwd: string, current: string): Promise<Completion[]> {
  const out: Completion[] = []
  for (const entry of arg.suggestions ?? []) {
    const suggestion = typeof entry === 'string' ? { name: entry } : entry
    for (const name of namesOf(suggestion.name)) out.push({ label: name, description: suggestion.description, kind: 'arg' })
  }
  const templates = new Set(listOf(arg.template))
  await Promise.all(
    listOf(arg.generators).map(async (generator) => {
      for (const template of listOf(generator.template)) templates.add(template)
      const raw = generator.script
      const script = typeof raw === 'function' ? raw(words) : raw
      const argv = typeof script === 'string' ? script.split(' ') : script
      if (!argv?.length) return
      try {
        const text = await run(argv, cwd)
        if (generator.postProcess) {
          for (const item of generator.postProcess(text, words)) {
            for (const name of namesOf(item.name)) out.push({ label: name, description: item.description, kind: 'arg' })
          }
        } else if (generator.splitOn) {
          for (const name of text.split(generator.splitOn)) if (name.trim()) out.push({ label: name.trim(), kind: 'arg' })
        }
      } catch {
        // A generator that fails to parse simply offers nothing.
      }
    }),
  )
  if (templates.size) out.push(...(await pathCompletions(current, cwd, !templates.has('filepaths'))))
  return out
}

function quote(path: string): string {
  return /[\s()&]/.test(path) ? `"${path}"` : path
}

async function pathCompletions(current: string, cwd: string, foldersOnly = false): Promise<Completion[]> {
  const typed = current.replace(/^~(?=[\\/]|$)/, homedir())
  const lastSep = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\'))
  const dirPart = lastSep >= 0 ? typed.slice(0, lastSep + 1) : ''
  const namePart = lastSep >= 0 ? typed.slice(lastSep + 1) : typed
  const sep = lastSep >= 0 ? typed[lastSep] : process.platform === 'win32' ? '\\' : '/'
  const base = isAbsolute(dirPart) ? dirPart : resolve(cwd, dirPart)
  const entries = await fs.readdir(base || cwd, { withFileTypes: true }).catch(() => [])
  const shown = lastSep >= 0 ? current.slice(0, current.lastIndexOf(typed[lastSep]) + 1) : ''
  const items: Completion[] = []
  for (const entry of entries) {
    if (foldersOnly && !entry.isDirectory()) continue
    if (entry.name.startsWith('.') && !namePart.startsWith('.')) continue
    const suffix = entry.isDirectory() ? sep : ''
    items.push({
      label: entry.name + suffix,
      insert: quote(`${shown}${entry.name}${suffix}`),
      kind: entry.isDirectory() ? 'folder' : 'file',
    })
  }
  return items
}

const pathLike = (text: string) => /[\\/]/.test(text) || text.startsWith('.') || text.startsWith('~')

export async function completions(line: string, offset: number, cwd: string | undefined): Promise<CompletionResult> {
  const dir = cwd && !cwd.startsWith('\\\\') && existsSync(cwd) ? cwd : homedir()
  const { words, current, from } = commandWords(line, offset)
  const filter = (items: Completion[]) => {
    const seen = new Set<string>()
    const unique = items.filter((item) => !seen.has(item.label) && seen.add(item.label))
    return { from, items: fuzzyFilter(current, unique, (item) => item.label).slice(0, 40) }
  }

  if (words.length === 0) {
    if (pathLike(current)) return filter(await pathCompletions(current, dir))
    if (!current) return { from, items: [] }
    const known = await listCommands()
    return filter([...known].map((label): Completion => ({ label, kind: 'command' })))
  }

  const spec = await loadSpec(words[0])
  if (!spec) return filter(await pathCompletions(current, dir))
  const { command, pendingArg } = walkSpec(spec, words)
  if (current.startsWith('-')) {
    const options = (command.options ?? []).flatMap((option) =>
      namesOf(option.name).map((label): Completion => ({ label, description: option.description, kind: 'option' })),
    )
    return filter(options)
  }
  const items: Completion[] = (command.subcommands ?? []).flatMap((sub) =>
    namesOf(sub.name).slice(0, 1).map((label): Completion => ({ label, description: sub.description, kind: 'subcommand' })),
  )
  if (pendingArg) items.push(...(await argSuggestions(pendingArg, words, dir, current)))
  if (!items.length || pathLike(current)) items.push(...(await pathCompletions(current, dir)))
  return filter(items)
}

/** Documentation for the word under the mouse, used by the command inspector. */
export async function describeToken(line: string, offset: number): Promise<(TokenInfo & { from: number; to: number }) | null> {
  const tokens = tokenize(line)
  const index = tokens.findIndex((t) => offset >= t.from && offset <= t.to)
  if (index < 0) return null
  const token = tokens[index]
  if (token.type === 'operator' || token.type === 'comment') return null
  const { words } = commandWords(line, token.to)
  const span = { from: token.from, to: token.to }
  if (words.length === 0) {
    const spec = await loadSpec(token.text)
    return spec ? { name: token.text, description: spec.description, ...span } : null
  }
  const spec = await loadSpec(words[0])
  if (!spec) return null
  const { command } = walkSpec(spec, words)
  const option = command.options?.find((o) => namesOf(o.name).includes(token.text.split('=')[0]))
  if (option) return { name: token.text, description: option.description, ...span }
  const sub = command.subcommands?.find((s) => namesOf(s.name).includes(token.text))
  if (sub) return { name: token.text, description: sub.description, ...span }
  return null
}
