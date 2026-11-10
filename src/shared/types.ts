export type ShellKind = 'powershell' | 'bash' | 'zsh' | 'fish' | 'cmd' | 'other'

export interface Profile {
  id: string
  name: string
  command: string
  args?: string[]
  kind: ShellKind
  cwd?: string
  env?: Record<string, string>
  icon?: string
  color?: string
  theme?: string
  startup?: string[]
  /** WSL paths need the integration script translated to /mnt/c. */
  wsl?: boolean
  builtin?: boolean
}

export interface SessionMeta {
  cwd?: string
  git?: string
  shell?: string
  venv?: string
  user?: string
  host?: string
  prompt?: string
  aliases?: Record<string, string>
}

export interface HistoryEntry {
  command: string
  cwd?: string
  exitCode?: number | null
  at?: number
  durationMs?: number
  shell?: string
}

export interface ThemeColors {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
}

export interface Theme {
  id: string
  name: string
  accent: string
  background: string
  foreground: string
  details: 'darker' | 'lighter'
  normal: ThemeColors
  bright: ThemeColors
  backgroundImage?: string
  gradient?: { top: string; bottom: string }
  imageOpacity?: number
  builtin?: boolean
}

export interface TabConfigPane {
  id: string
  type?: 'terminal' | 'agent'
  split?: 'horizontal' | 'vertical'
  children?: string[]
  directory?: string
  commands?: string[]
  shell?: string
  is_focused?: boolean
}

export interface TabConfigParam {
  type?: 'text' | 'branch' | 'repo'
  description?: string
  default?: string
}

export interface TabConfig {
  file?: string
  name: string
  title?: string
  color?: string
  panes: TabConfigPane[]
  params?: Record<string, TabConfigParam>
}

export interface WorkflowArgument {
  name: string
  description?: string
  default_value?: string
  /** Static suggestions for the argument. */
  options?: string[]
  /** Shell command whose output lines are the suggestions. */
  dynamic_options?: string
}

export interface Workflow {
  file?: string
  name: string
  command: string
  description?: string
  tags?: string[]
  alias?: string
  arguments?: WorkflowArgument[]
  env?: string
}

export interface SavedPrompt {
  file?: string
  name: string
  prompt: string
  description?: string
  arguments?: WorkflowArgument[]
}

export interface EnvCollection {
  file?: string
  name: string
  description?: string
  /** A value starting with "$(" and ending in ")" is resolved by running the command in the shell. */
  variables: Record<string, string>
}

export interface Notebook {
  file: string
  title: string
  content: string
}

export type KnowledgeKind = 'workflows' | 'prompts' | 'env'

export interface Completion {
  label: string
  insert?: string
  description?: string
  kind: 'subcommand' | 'option' | 'arg' | 'file' | 'folder' | 'history' | 'command'
}

export interface CompletionResult {
  from: number
  items: Completion[]
}

export interface TokenInfo {
  name: string
  description?: string
}

export interface FileEntry {
  name: string
  path: string
  dir: boolean
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface GitStatusEntry {
  path: string
  status: string
}

export interface PersistedBlock {
  id: string
  command: string
  cwd?: string
  git?: string
  exitCode: number | null
  startedAt: number
  durationMs: number
  lines: StyledLine[]
  bookmarked?: boolean
  background?: boolean
}

export interface StyledSpan {
  t: string
  fg?: string
  bg?: string
  b?: 1
  i?: 1
  u?: 1
  d?: 1
  s?: 1
}

export type StyledLine = StyledSpan[]

export type PaneKind = 'terminal' | 'editor' | 'markdown' | 'notebook' | 'diff'

export interface PaneLeaf {
  type: 'leaf'
  id: string
  kind: PaneKind
  profileId?: string
  cwd?: string
  file?: string
  /** Line to show when an editor pane opens. */
  line?: number
  startup?: string[]
}

export interface PaneSplit {
  type: 'split'
  id: string
  direction: 'row' | 'column'
  children: PaneNode[]
  sizes: number[]
}

export type PaneNode = PaneLeaf | PaneSplit

export interface TabState {
  id: string
  title: string
  customTitle?: boolean
  color?: string
  root: PaneNode
  activePaneId: string
  synced?: boolean
}

export interface WindowSession {
  tabs: TabState[]
  activeTabId: string
  blocks: Record<string, PersistedBlock[]>
}

export interface AgentProfile {
  name: string
  /** Allow runs without asking; deny always asks, whatever the autonomy level. */
  allow: string[]
  deny: string[]
  execute: 'always_ask' | 'agent_decides' | 'always_allow'
  writeFiles: 'always_ask' | 'always_allow'
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking' }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'toolResult'; id: string; output: string; isError?: boolean }
  | { type: 'approval'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; message: string }
