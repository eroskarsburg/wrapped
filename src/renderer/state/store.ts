import { create } from 'zustand'
import { renderTemplate } from '../../shared/logic'
import { defaultSettings, setPath, type Settings } from '../../shared/settings'
import { builtinThemes, findTheme } from '../../shared/themes'
import type {
  EnvCollection, HistoryEntry, Notebook, PaneKind, PaneLeaf, PaneNode, PaneSplit, PersistedBlock, Profile, SavedPrompt,
  TabConfig, TabConfigPane, TabState, Theme, WindowSession, Workflow,
} from '../../shared/types'
import { api } from '../rpc'
import { PaneSession, type SessionHooks } from '../terminal/PaneSession'

export type SidebarView = 'tabs' | 'drive' | 'files' | 'search' | 'git'

export type Overlay =
  | { kind: 'palette'; filter?: string }
  | { kind: 'commandSearch' }
  | { kind: 'settings'; section?: string }
  | { kind: 'params'; title: string; params: ParamRequest[]; onSubmit: (values: Record<string, string>) => void }
  | null

export interface ParamRequest {
  name: string
  description?: string
  default?: string
  options?: string[]
  dynamic?: string
}

interface ClosedTab {
  tab: TabState
  at: number
}

export const sessions = new Map<string, PaneSession>()
export const history: HistoryEntry[] = []
export const knownCommands = new Set<string>()

let seq = 0
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`

export function leaves(node: PaneNode): PaneLeaf[] {
  return node.type === 'leaf' ? [node] : node.children.flatMap(leaves)
}

function mapNode(node: PaneNode, update: (leaf: PaneLeaf) => PaneNode): PaneNode {
  if (node.type === 'leaf') return update(node)
  return { ...node, children: node.children.map((child) => mapNode(child, update)) }
}

function removeLeaf(node: PaneNode, id: string): PaneNode | null {
  if (node.type === 'leaf') return node.id === id ? null : node
  const sizes: number[] = []
  const children: PaneNode[] = []
  node.children.forEach((child, index) => {
    const kept = removeLeaf(child, id)
    if (kept) {
      children.push(kept)
      sizes.push(node.sizes[index])
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes }
}

interface AppState {
  settings: Settings
  themes: Theme[]
  profiles: Profile[]
  keybindings: Record<string, string>
  tabs: TabState[]
  activeTabId: string
  sidebar: SidebarView | null
  agentOpen: boolean
  overlay: Overlay
  workflows: Workflow[]
  prompts: SavedPrompt[]
  envCollections: EnvCollection[]
  notebooks: Notebook[]
  tabConfigs: { config: TabConfig; errors: string[] }[]
  closed: ClosedTab[]
  osDark: boolean
  agentDraft: { text: string; id: number } | null
  inputDraft: { paneId: string; text: string; id: number } | null
  loaded: boolean
  nodeVersion?: string
  /** Bumped when a command starts or ends, for views that summarize sessions. */
  sessionTick: number

  load(): Promise<void>
  reloadConfig(): Promise<void>
  setSetting(path: string, value: unknown): void
  activeTheme(): Theme
  themeForPane(profile: Profile | undefined): Theme
  activeTab(): TabState | undefined
  activeSession(): PaneSession | undefined
  newTab(profileId?: string, cwd?: string, startup?: string[]): void
  closeTab(id: string): void
  undoClose(): void
  selectTab(id: string): void
  cycleTab(delta: number): void
  moveTab(from: number, to: number): void
  updateTab(id: string, patch: Partial<TabState>): void
  splitPane(direction: 'row' | 'column', kind?: PaneKind, extra?: Partial<PaneLeaf>): void
  closePane(id?: string): void
  focusPane(id: string): void
  focusAdjacent(delta: number): void
  resizeSplit(tabId: string, splitId: string, sizes: number[]): void
  openFile(path: string): void
  openTabConfig(config: TabConfig, values: Record<string, string>): void
  openOverlay(overlay: Overlay): void
  setSidebar(view: SidebarView | null): void
  toggleAgent(open?: boolean): void
  sendToAgent(text: string): void
  fillInput(text: string, paneId?: string): void
  submitToPanes(session: PaneSession, command: string): void
  persist(): void
}

const defaultProfile = (state: AppState, id?: string): Profile =>
  state.profiles.find((p) => p.id === (id || state.settings.terminal.defaultProfile)) ?? state.profiles[0]

const leafFor = (kind: PaneKind, extra: Partial<PaneLeaf> = {}): PaneLeaf => ({ type: 'leaf', id: newId('pane'), kind, ...extra })

export function ensureSession(leaf: PaneLeaf, restored: PersistedBlock[] = []): PaneSession {
  const existing = sessions.get(leaf.id)
  if (existing) return existing
  const state = useApp.getState()
  const profile = defaultProfile(state, leaf.profileId)
  const session = new PaneSession(leaf.id, profile, leaf.cwd, hooks, leaf.startup ?? [], restored)
  sessions.set(leaf.id, session)
  session.applyAppearance(state.themeForPane(profile))
  return session
}

function disposeLeaf(leaf: PaneLeaf): void {
  sessions.get(leaf.id)?.dispose()
  sessions.delete(leaf.id)
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let restoredBlocks: Record<string, PersistedBlock[]> = {}
export const takeRestoredBlocks = (id: string): PersistedBlock[] => {
  const blocks = restoredBlocks[id] ?? []
  delete restoredBlocks[id]
  return blocks
}

const hooks: SessionHooks = {
  settings: () => useApp.getState().settings,
  knownCommands: () => knownCommands,
  onRunningChange() {
    useApp.setState((state) => ({ sessionTick: state.sessionTick + 1 }))
  },
  onBell() {
    if (useApp.getState().settings.terminal.audibleBell) playBell()
  },
  onCommandSubmitted(session, command) {
    history.push({ command, cwd: session.cwd, at: Date.now(), shell: session.kind })
  },
  onCommandFinished(session, block) {
    const state = useApp.getState()
    void api.appendHistory({
      command: block.command, cwd: block.cwd, exitCode: block.exitCode, at: block.startedAt,
      durationMs: block.durationMs, shell: session.kind,
    })
    const limit = state.settings.terminal.longCommandNotifySeconds
    if (limit > 0 && block.durationMs >= limit * 1000) {
      const status = block.exitCode === 0 ? 'concluído' : `falhou (${block.exitCode})`
      void api.notify('Comando ' + status, block.command)
    }
    state.persist()
  },
  onMetaChange(session) {
    const state = useApp.getState()
    const cwd = session.cwd ?? ''
    for (const tab of state.tabs) {
      if (!leaves(tab.root).some((leaf) => leaf.id === session.id)) continue
      const color = Object.entries(state.settings.appearance.directoryTabColors).find(([dir]) => cwd.startsWith(dir))?.[1]
      const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
      const patch: Partial<TabState> = {}
      if (!tab.customTitle && tab.activePaneId === session.id) patch.title = name
      if (color) patch.color = color
      if (Object.keys(patch).length) state.updateTab(tab.id, patch)
    }
    state.persist()
  },
}

function playBell(): void {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  gain.gain.value = 0.05
  oscillator.frequency.value = 660
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.08)
}

function tabFromConfig(config: TabConfig, values: Record<string, string>, profiles: Profile[]): TabState {
  const render = (text: string | undefined) => (text === undefined ? undefined : renderTemplate(text, values))
  const byId = new Map(config.panes.map((pane) => [pane.id, pane]))
  let focused = ''
  const build = (pane: TabConfigPane): PaneNode => {
    if (pane.split) {
      const children = (pane.children ?? []).map((id) => build(byId.get(id)!))
      return {
        type: 'split', id: newId('split'), direction: pane.split === 'horizontal' ? 'row' : 'column', children,
        sizes: children.map(() => 1 / children.length),
      } satisfies PaneSplit
    }
    const profile = pane.shell
      ? profiles.find((p) => p.id === pane.shell || p.command.toLowerCase().includes(pane.shell!.toLowerCase()))
      : undefined
    const leaf = leafFor('terminal', {
      cwd: render(pane.directory)?.replace(/^~/, homeDir),
      profileId: profile?.id,
      startup: (pane.commands ?? []).map((command) => render(command)!),
    })
    if (pane.is_focused) focused = leaf.id
    return leaf
  }
  const root = build(config.panes[0])
  return {
    id: newId('tab'),
    title: render(config.title) ?? config.name,
    customTitle: true,
    color: config.color,
    root,
    activePaneId: focused || leaves(root)[0].id,
  }
}

let homeDir = ''

export const useApp = create<AppState>((set, get) => ({
  settings: structuredClone(defaultSettings),
  themes: builtinThemes,
  profiles: [],
  keybindings: {},
  tabs: [],
  activeTabId: '',
  sidebar: null,
  agentOpen: false,
  overlay: null,
  workflows: [],
  prompts: [],
  envCollections: [],
  notebooks: [],
  tabConfigs: [],
  closed: [],
  osDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  agentDraft: null,
  inputDraft: null,
  loaded: false,
  sessionTick: 0,

  async load() {
    const [settings, profiles, session, entries, home] = await Promise.all([
      api.loadSettings(), api.listProfiles(), api.loadSession(), api.loadHistory(), api.homeDir(),
    ])
    homeDir = home
    history.push(...entries)
    // Listing PowerShell commands takes seconds, and the shell should not wait for it.
    void api.listCommands().then((commands) => commands.forEach((command) => knownCommands.add(command)))
    set({ settings, profiles, sidebar: settings.appearance.verticalTabs ? 'tabs' : null })
    void api.nodeVersion().then((nodeVersion) => set({ nodeVersion }))
    await get().reloadConfig()
    const usable = settings.terminal.restoreSession && session?.tabs?.length && !new URLSearchParams(location.search).has('quake')
    if (usable) {
      restoredBlocks = session.blocks ?? {}
      set({ tabs: session.tabs, activeTabId: session.activeTabId })
    } else {
      get().newTab()
    }
    set({ loaded: true })
  },

  async reloadConfig() {
    const [settings, themes, keybindings, knowledge, notebooks, tabConfigs, profiles] = await Promise.all([
      api.loadSettings(), api.listThemes(), api.loadKeybindings(), api.listKnowledge(), api.listNotebooks(),
      api.listTabConfigs(), api.listProfiles(),
    ])
    set({
      settings, themes, keybindings, notebooks, tabConfigs, profiles,
      workflows: knowledge.workflows, prompts: knowledge.prompts, envCollections: knowledge.env,
    })
  },

  setSetting(path, value) {
    const settings = setPath(get().settings, path, value)
    set({ settings })
    void api.saveSettings(settings)
  },

  activeTheme() {
    const { settings, themes, osDark } = get()
    const { appearance } = settings
    const id = appearance.syncOsTheme ? (osDark ? appearance.darkTheme : appearance.lightTheme) : appearance.theme
    return findTheme(themes, id)
  },

  themeForPane(profile) {
    return profile?.theme ? findTheme(get().themes, profile.theme) : get().activeTheme()
  },

  activeTab: () => get().tabs.find((tab) => tab.id === get().activeTabId),

  /** The focused terminal, or the tab's first one while an editor pane has the focus. */
  activeSession() {
    const tab = get().activeTab()
    if (!tab) return undefined
    return sessions.get(tab.activePaneId) ?? leaves(tab.root).map((leaf) => sessions.get(leaf.id)).find(Boolean)
  },

  newTab(profileId, cwd, startup) {
    const profile = defaultProfile(get(), profileId)
    const leaf = leafFor('terminal', { profileId: profile?.id, cwd: cwd ?? profile?.cwd ?? get().activeSession()?.cwd, startup })
    const tab: TabState = { id: newId('tab'), title: profile?.name ?? 'Terminal', root: leaf, activePaneId: leaf.id, color: profile?.color }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
    get().persist()
  },

  closeTab(id) {
    const state = get()
    const tab = state.tabs.find((t) => t.id === id)
    if (!tab) return
    const busy = leaves(tab.root).some((leaf) => sessions.get(leaf.id)?.running)
    if (busy && state.settings.terminal.confirmClose && !confirm('Há um comando em execução nesta aba. Fechar mesmo assim?')) return
    const index = state.tabs.indexOf(tab)
    const tabs = state.tabs.filter((t) => t !== tab)
    leaves(tab.root).forEach(disposeLeaf)
    set({
      tabs,
      activeTabId: state.activeTabId === id ? (tabs[index] ?? tabs[index - 1])?.id ?? '' : state.activeTabId,
      closed: [...state.closed, { tab, at: Date.now() }].slice(-10),
    })
    if (tabs.length === 0) get().newTab()
    get().persist()
  },

  undoClose() {
    const state = get()
    const limit = state.settings.terminal.undoCloseSeconds * 1000
    const last = state.closed.at(-1)
    if (!last || Date.now() - last.at > limit) return
    set({ tabs: [...state.tabs, last.tab], activeTabId: last.tab.id, closed: state.closed.slice(0, -1) })
  },

  selectTab: (id) => set({ activeTabId: id }),

  cycleTab(delta) {
    const { tabs, activeTabId } = get()
    const index = tabs.findIndex((tab) => tab.id === activeTabId)
    if (tabs.length) set({ activeTabId: tabs[(index + delta + tabs.length) % tabs.length].id })
  },

  moveTab(from, to) {
    set((state) => {
      const tabs = [...state.tabs]
      const [tab] = tabs.splice(from, 1)
      tabs.splice(to, 0, tab)
      return { tabs }
    })
  },

  updateTab(id, patch) {
    set((state) => ({ tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) }))
    get().persist()
  },

  splitPane(direction, kind = 'terminal', extra = {}) {
    const tab = get().activeTab()
    if (!tab) return
    const source = leaves(tab.root).find((leaf) => leaf.id === tab.activePaneId)
    const session = sessions.get(tab.activePaneId)
    const leaf = leafFor(kind, { profileId: source?.profileId, cwd: session?.cwd ?? source?.cwd, ...extra })
    const root = mapNode(tab.root, (current) =>
      current.id === tab.activePaneId
        ? { type: 'split', id: newId('split'), direction, children: [current, leaf], sizes: [0.5, 0.5] }
        : current,
    )
    get().updateTab(tab.id, { root, activePaneId: leaf.id })
  },

  closePane(id) {
    const tab = get().activeTab()
    if (!tab) return
    const paneId = id ?? tab.activePaneId
    const target = leaves(tab.root).find((leaf) => leaf.id === paneId)
    if (!target) return
    const root = removeLeaf(tab.root, paneId)
    if (!root) {
      get().closeTab(tab.id)
      return
    }
    disposeLeaf(target)
    get().updateTab(tab.id, { root, activePaneId: leaves(root)[0].id })
  },

  focusPane(id) {
    const tab = get().activeTab()
    if (tab && tab.activePaneId !== id) get().updateTab(tab.id, { activePaneId: id })
  },

  focusAdjacent(delta) {
    const tab = get().activeTab()
    if (!tab) return
    const all = leaves(tab.root)
    const index = all.findIndex((leaf) => leaf.id === tab.activePaneId)
    get().updateTab(tab.id, { activePaneId: all[(index + delta + all.length) % all.length].id })
  },

  resizeSplit(tabId, splitId, sizes) {
    const update = (node: PaneNode): PaneNode =>
      node.type === 'leaf' ? node : node.id === splitId ? { ...node, sizes } : { ...node, children: node.children.map(update) }
    const tab = get().tabs.find((t) => t.id === tabId)
    if (tab) get().updateTab(tabId, { root: update(tab.root) })
  },

  openFile(path) {
    const kind: PaneKind = /\.(?:md|markdown)$/i.test(path) ? 'markdown' : 'editor'
    get().splitPane('row', kind, { file: path })
  },

  openTabConfig(config, values) {
    const tab = tabFromConfig(config, values, get().profiles)
    const wantsAgent = config.panes.some((pane) => pane.type === 'agent')
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id, agentOpen: state.agentOpen || wantsAgent }))
    get().persist()
  },

  openOverlay: (overlay) => set({ overlay }),
  setSidebar: (view) => set((state) => ({ sidebar: state.sidebar === view ? null : view })),
  toggleAgent: (open) => set((state) => ({ agentOpen: open ?? !state.agentOpen })),
  sendToAgent: (text) => set({ agentOpen: true, agentDraft: { text, id: Date.now() } }),

  fillInput(text, paneId) {
    const id = paneId ?? get().activeTab()?.activePaneId
    if (id) set({ inputDraft: { paneId: id, text, id: Date.now() } })
  },

  submitToPanes(session, command) {
    const tab = get().tabs.find((t) => leaves(t.root).some((leaf) => leaf.id === session.id))
    if (tab?.synced) {
      for (const leaf of leaves(tab.root)) sessions.get(leaf.id)?.submit(command)
    } else {
      session.submit(command)
    }
  },

  persist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const { tabs, activeTabId } = get()
      const blocks: WindowSession['blocks'] = {}
      for (const tab of tabs) {
        for (const leaf of leaves(tab.root)) {
          const session = sessions.get(leaf.id)
          if (session) {
            blocks[leaf.id] = session.persistable()
            leaf.cwd = session.cwd ?? leaf.cwd
            leaf.startup = undefined
          }
        }
      }
      void api.saveSession({ tabs, activeTabId, blocks })
    }, 800)
  },
}))
