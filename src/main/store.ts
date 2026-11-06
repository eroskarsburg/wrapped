import { safeStorage } from 'electron'
import { existsSync, mkdirSync, promises as fs, readFileSync, watch, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { validateTabConfig } from '../shared/logic'
import { defaultSettings, mergeSettings, type Settings } from '../shared/settings'
import { builtinThemes, parseThemeFile, themeToFile } from '../shared/themes'
import type {
  AgentProfile, EnvCollection, HistoryEntry, KnowledgeKind, Notebook, Profile, SavedPrompt, TabConfig, Theme,
  WindowSession, Workflow,
} from '../shared/types'
import { configDir, dataDir } from './paths'

const SUBDIRS = ['themes', 'profiles', 'tab_configs', 'workflows', 'notebooks', 'prompts', 'env', 'agent_profiles']
const MAX_HISTORY = 10000

const conf = (...parts: string[]) => join(configDir, ...parts)
const safeName = (name: string) => name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'item'

export function initStore(): void {
  const firstRun = !existsSync(configDir)
  for (const dir of SUBDIRS) mkdirSync(conf(dir), { recursive: true })
  mkdirSync(dataDir(), { recursive: true })
  if (firstRun) seedExamples()
}

function seedExamples(): void {
  writeFileSync(
    conf('workflows', 'desfazer_ultimo_commit.yaml'),
    stringifyYaml({
      name: 'Desfazer último commit',
      command: 'git reset --soft HEAD~{{quantidade}}',
      description: 'Desfaz commits mantendo as alterações em stage',
      tags: ['git'],
      arguments: [{ name: 'quantidade', description: 'Quantos commits desfazer', default_value: '1' }],
    }),
  )
  writeFileSync(
    conf('tab_configs', 'editor_e_servidor.toml'),
    stringifyToml({
      name: 'Dois terminais lado a lado',
      color: 'green',
      panes: [
        { id: 'root', split: 'horizontal', children: ['esquerda', 'direita'] },
        { id: 'esquerda', type: 'terminal', is_focused: true },
        { id: 'direita', type: 'terminal' },
      ],
    }),
  )
}

async function readFiles<T>(dir: string, ext: RegExp, read: (text: string, file: string) => T | null): Promise<T[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: T[] = []
  for (const name of names.filter((n) => ext.test(n)).sort()) {
    const file = join(dir, name)
    try {
      const item = read(await fs.readFile(file, 'utf8'), file)
      if (item) out.push(item)
    } catch (error) {
      console.warn(`wrapped: ignorando ${file}: ${error}`)
    }
  }
  return out
}

// --- Settings -------------------------------------------------------------------------------

export function loadSettings(): Settings {
  try {
    return mergeSettings(parseToml(readFileSync(conf('settings.toml'), 'utf8')))
  } catch {
    return structuredClone(defaultSettings)
  }
}

export function saveSettings(settings: Settings): void {
  writeFileSync(conf('settings.toml'), stringifyToml(settings as unknown as Record<string, unknown>))
}

export function loadKeybindings(): Record<string, string> {
  try {
    return (parseYaml(readFileSync(conf('keybindings.yaml'), 'utf8')) as Record<string, string>) ?? {}
  } catch {
    return {}
  }
}

export function saveKeybindings(bindings: Record<string, string>): void {
  writeFileSync(conf('keybindings.yaml'), stringifyYaml(bindings))
}

// --- Themes, profiles and tab configs -------------------------------------------------------

export async function listThemes(): Promise<Theme[]> {
  const custom = await readFiles(conf('themes'), /\.ya?ml$/i, (text, file) =>
    parseThemeFile(basename(file).replace(/\.ya?ml$/i, ''), parseYaml(text)),
  )
  return [...builtinThemes, ...custom]
}

export async function saveTheme(theme: Theme): Promise<void> {
  await fs.writeFile(conf('themes', `${theme.id}.yaml`), stringifyYaml(themeToFile(theme)))
}

export async function listUserProfiles(): Promise<Profile[]> {
  return readFiles(conf('profiles'), /\.toml$/i, (text, file) => {
    const raw = parseToml(text) as unknown as Profile
    if (!raw.name || !raw.command) return null
    return { ...raw, id: `user-${basename(file, '.toml')}`, kind: raw.kind ?? 'other' }
  })
}

export async function saveProfile(profile: Profile): Promise<void> {
  const { id, builtin, ...data } = profile
  const name = id?.startsWith('user-') ? id.slice(5) : safeName(profile.name)
  await fs.writeFile(conf('profiles', `${name}.toml`), stringifyToml(data as unknown as Record<string, unknown>))
}

export async function deleteProfile(id: string): Promise<void> {
  await fs.rm(conf('profiles', `${id.replace(/^user-/, '')}.toml`), { force: true })
}

export async function listTabConfigs(): Promise<{ config: TabConfig; errors: string[] }[]> {
  return readFiles(conf('tab_configs'), /\.toml$/i, (text, file) => {
    const config = { ...(parseToml(text) as unknown as TabConfig), file }
    return { config, errors: validateTabConfig(config) }
  })
}

export async function saveTabConfig(config: TabConfig): Promise<void> {
  const { file, ...data } = config
  const target = file ?? conf('tab_configs', `${safeName(config.name)}.toml`)
  await fs.writeFile(target, stringifyToml(data as unknown as Record<string, unknown>))
}

// --- Knowledge ------------------------------------------------------------------------------

export async function listKnowledge(): Promise<{ workflows: Workflow[]; prompts: SavedPrompt[]; env: EnvCollection[] }> {
  const read = <T>(dir: string) =>
    readFiles<T>(conf(dir), /\.ya?ml$/i, (text, file) => ({ ...(parseYaml(text) as T), file }))
  const [workflows, prompts, env] = await Promise.all([read<Workflow>('workflows'), read<SavedPrompt>('prompts'), read<EnvCollection>('env')])
  return { workflows, prompts, env }
}

export async function saveKnowledge(kind: KnowledgeKind, item: { name: string; file?: string }): Promise<string> {
  const { file, ...data } = item
  const target = file ?? conf(kind, `${safeName(item.name)}.yaml`)
  await fs.writeFile(target, stringifyYaml(data))
  return target
}

export async function deleteConfigFile(file: string): Promise<void> {
  if (!file.startsWith(configDir)) throw new Error('fora do diretório de configuração')
  await fs.rm(file, { force: true })
}

export async function exportEnv(collection: EnvCollection, target: string): Promise<void> {
  const lines = Object.entries(collection.variables).map(([k, v]) => `${k}=${JSON.stringify(v)}`)
  await fs.writeFile(target, `${lines.join('\n')}\n`)
}

export async function listNotebooks(): Promise<Notebook[]> {
  return readFiles(conf('notebooks'), /\.md$/i, (content, file) => ({
    file,
    content,
    title: /^#\s+(.+)$/m.exec(content)?.[1] ?? basename(file, '.md'),
  }))
}

export async function createNotebook(title: string): Promise<string> {
  const file = conf('notebooks', `${safeName(title)}.md`)
  if (!existsSync(file)) await fs.writeFile(file, `# ${title}\n\nNotas e comandos executáveis:\n\n\`\`\`shell\necho "olá"\n\`\`\`\n`)
  return file
}

// --- Agent ----------------------------------------------------------------------------------

const DEFAULT_AGENT_PROFILE: AgentProfile = {
  name: 'Padrão',
  allow: [],
  deny: ['rm(\\s.*)?', 'del(\\s.*)?', 'Remove-Item(\\s.*)?', 'curl(\\s.*)?', 'wget(\\s.*)?', 'ssh(\\s.*)?', 'git push(\\s.*)?', 'eval(\\s.*)?'],
  execute: 'always_ask',
  writeFiles: 'always_ask',
}

export async function listAgentProfiles(): Promise<AgentProfile[]> {
  const custom = await readFiles<AgentProfile>(conf('agent_profiles'), /\.ya?ml$/i, (text) => parseYaml(text) as AgentProfile)
  return [DEFAULT_AGENT_PROFILE, ...custom]
}

export async function loadRules(cwd?: string): Promise<string> {
  const parts: string[] = []
  for (const file of [conf('rules.md'), ...(cwd ? [join(cwd, 'AGENTS.md'), join(cwd, 'CLAUDE.md')] : [])]) {
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

export function loadMcpConfig(): Record<string, { command: string; args?: string[]; env?: Record<string, string> }> {
  try {
    return JSON.parse(readFileSync(conf('mcp.json'), 'utf8')).mcpServers ?? {}
  } catch {
    return {}
  }
}

const keyFile = () => join(dataDir(), 'agent.key')

export function saveApiKey(key: string): void {
  if (!key) {
    writeFileSync(keyFile(), '')
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Armazenamento seguro indisponível neste sistema')
  writeFileSync(keyFile(), safeStorage.encryptString(key))
}

export function loadApiKey(): string {
  try {
    const data = readFileSync(keyFile())
    return data.length ? safeStorage.decryptString(data) : ''
  } catch {
    return ''
  }
}

// --- History --------------------------------------------------------------------------------

const historyFile = () => join(dataDir(), 'history.ndjson')

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  await fs.appendFile(historyFile(), `${JSON.stringify(entry)}\n`)
}

/** Oldest first. Includes the shells' own history, so that a new install is useful right away. */
export async function loadHistory(): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = []
  const imports = [
    join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
    join(homedir(), '.bash_history'),
  ]
  if (!process.env.WRAPPED_HOME) {
    for (const file of imports) {
      const text = await fs.readFile(file, 'utf8').catch(() => '')
      for (const line of text.split(/\r?\n/).slice(-MAX_HISTORY)) {
        if (line.trim() && !line.endsWith('`')) entries.push({ command: line })
      }
    }
  }
  const own = await fs.readFile(historyFile(), 'utf8').catch(() => '')
  for (const line of own.split('\n').slice(-MAX_HISTORY)) {
    if (!line) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // Skips a line truncated by a crash.
    }
  }
  return entries
}

// --- Session --------------------------------------------------------------------------------

const sessionFile = () => join(dataDir(), 'session.json')

export function loadSession(): WindowSession | null {
  try {
    return JSON.parse(readFileSync(sessionFile(), 'utf8'))
  } catch {
    return null
  }
}

export function saveSession(session: WindowSession): void {
  // Written through a rename, so that a crash mid-write cannot lose the previous session.
  writeFileSync(`${sessionFile()}.tmp`, JSON.stringify(session))
  void fs.rename(`${sessionFile()}.tmp`, sessionFile())
}

export function watchConfig(onChange: () => void): void {
  let timer: NodeJS.Timeout | null = null
  watch(configDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 200)
  })
}
