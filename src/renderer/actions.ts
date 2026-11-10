import { renderTemplate, workflowParams } from '../shared/logic'
import type { EnvCollection, SavedPrompt, TabConfig, Workflow } from '../shared/types'
import { api } from './rpc'
import type { ParamRequest } from './state/store'
import { useApp } from './state/store'

export interface Action {
  id: string
  label: string
  keys?: string
  /** Input-scoped actions leave the keystroke to the running program. */
  inputOnly?: boolean
  run(): void
}

const app = () => useApp.getState()

export const paneEvents = new EventTarget()
const emit = (name: string) => paneEvents.dispatchEvent(new CustomEvent(name, { detail: app().activeTab()?.activePaneId }))

export const actions: Action[] = [
  { id: 'palette', label: 'Abrir command palette', keys: 'ctrl-shift-P', run: () => app().openOverlay({ kind: 'palette' }) },
  { id: 'command-search', label: 'Buscar no histórico de comandos', keys: 'ctrl-r', inputOnly: true, run: () => app().openOverlay({ kind: 'commandSearch' }) },
  { id: 'settings', label: 'Abrir configurações', keys: 'ctrl-,', run: () => app().openOverlay({ kind: 'settings' }) },
  { id: 'new-tab', label: 'Nova aba', keys: 'ctrl-shift-T', run: () => app().newTab() },
  { id: 'close-tab', label: 'Fechar aba', keys: 'ctrl-shift-W', run: () => app().activeTab() && app().closeTab(app().activeTabId) },
  { id: 'undo-close', label: 'Reabrir aba fechada', keys: 'ctrl-alt-t', run: () => app().undoClose() },
  { id: 'next-tab', label: 'Próxima aba', keys: 'ctrl-tab', run: () => app().cycleTab(1) },
  { id: 'previous-tab', label: 'Aba anterior', keys: 'ctrl-shift-tab', run: () => app().cycleTab(-1) },
  { id: 'split-right', label: 'Dividir pane à direita', keys: 'ctrl-shift-D', run: () => app().splitPane('row') },
  { id: 'split-down', label: 'Dividir pane para baixo', keys: 'ctrl-shift-E', run: () => app().splitPane('column') },
  { id: 'close-pane', label: 'Fechar pane', keys: 'ctrl-shift-X', run: () => app().closePane() },
  { id: 'maximize-pane', label: 'Maximizar ou restaurar pane', keys: 'ctrl-shift-enter', run: () => app().toggleMaximize() },
  { id: 'next-pane', label: 'Próximo pane', keys: 'alt-right', run: () => app().focusAdjacent(1) },
  { id: 'previous-pane', label: 'Pane anterior', keys: 'alt-left', run: () => app().focusAdjacent(-1) },
  {
    id: 'sync-panes', label: 'Sincronizar input entre panes', keys: 'ctrl-alt-i',
    run() {
      const tab = app().activeTab()
      if (tab) app().updateTab(tab.id, { synced: !tab.synced })
    },
  },
  { id: 'find', label: 'Buscar nos blocos', keys: 'ctrl-shift-F', run: () => emit('find') },
  { id: 'block-previous', label: 'Selecionar bloco anterior', keys: 'ctrl-up', inputOnly: true, run: () => emit('block-previous') },
  { id: 'block-next', label: 'Selecionar próximo bloco', keys: 'ctrl-down', inputOnly: true, run: () => emit('block-next') },
  { id: 'block-copy-output', label: 'Copiar saída do bloco selecionado', keys: 'ctrl-alt-c', run: () => emit('block-copy-output') },
  { id: 'block-copy-command', label: 'Copiar comando do bloco selecionado', keys: 'ctrl-alt-shift-C', run: () => emit('block-copy-command') },
  { id: 'block-bookmark', label: 'Marcar bloco selecionado', keys: 'ctrl-alt-b', run: () => emit('block-bookmark') },
  { id: 'bookmark-previous', label: 'Ir ao bloco marcado anterior', keys: 'ctrl-alt-up', run: () => emit('bookmark-previous') },
  { id: 'bookmark-next', label: 'Ir ao próximo bloco marcado', keys: 'ctrl-alt-down', run: () => emit('bookmark-next') },
  { id: 'block-filter', label: 'Filtrar saída do bloco selecionado', keys: 'ctrl-alt-f', run: () => emit('block-filter') },
  { id: 'clear-blocks', label: 'Limpar blocos', keys: 'ctrl-shift-K', run: () => app().activeSession()?.updateBlocks((blocks) => blocks.filter((b) => b.running)) },
  { id: 'sidebar-tabs', label: 'Mostrar abas', keys: 'ctrl-b', run: () => app().setSidebar('tabs') },
  { id: 'sidebar-drive', label: 'Mostrar Drive', keys: 'ctrl-shift-Y', run: () => app().setSidebar('drive') },
  { id: 'sidebar-files', label: 'Mostrar arquivos', keys: 'ctrl-shift-B', run: () => app().setSidebar('files') },
  { id: 'sidebar-search', label: 'Busca global em arquivos', keys: 'ctrl-shift-G', run: () => app().setSidebar('search') },
  { id: 'sidebar-git', label: 'Mostrar alterações do git', keys: 'ctrl-shift-J', run: () => app().setSidebar('git') },
  { id: 'agent', label: 'Abrir ou fechar o agente', keys: 'ctrl-shift-A', run: () => app().toggleAgent() },
  { id: 'zoom-in', label: 'Aumentar zoom', keys: 'ctrl-=', run: () => zoom(10) },
  { id: 'zoom-out', label: 'Diminuir zoom', keys: 'ctrl--', run: () => zoom(-10) },
  { id: 'zoom-reset', label: 'Restaurar zoom', keys: 'ctrl-0', run: () => zoom(0) },
  { id: 'new-window', label: 'Nova janela', keys: 'ctrl-shift-N', run: () => void api.newWindow() },
  { id: 'open-config', label: 'Abrir pasta de configuração', run: () => void api.openConfigDir() },
]

function zoom(delta: number): void {
  const current = app().settings.appearance.zoom
  app().setSetting('appearance.zoom', delta === 0 ? 100 : Math.min(250, Math.max(50, current + delta)))
}

export function bindingFor(action: Action, overrides: Record<string, string>): string | undefined {
  const override = overrides[action.id]
  if (override === 'none') return undefined
  return override ?? action.keys
}

/** Normalizes an event: letters are uppercase with shift and lowercase without it. */
export function eventKeys(event: KeyboardEvent): string | null {
  const key = event.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const names: Record<string, string> = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', Escape: 'escape',
    Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    ' ': 'space',
  }
  let name = names[key] ?? (/^F\d+$/.test(key) ? key.toLowerCase() : key)
  if (name.length === 1) name = event.shiftKey ? name.toUpperCase() : name.toLowerCase()
  const parts = [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift', event.metaKey && 'meta', name]
  return parts.filter(Boolean).join('-')
}

export function installKeybindings(): () => void {
  const listener = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return
    const keys = eventKeys(event)
    if (!keys) return
    const { keybindings, overlay } = app()
    const action = actions.find((candidate) => bindingFor(candidate, keybindings) === keys)
    if (!action) return
    if (overlay && action.id !== 'palette' && action.id !== 'settings') return
    if (action.inputOnly && app().activeSession()?.running) return
    event.preventDefault()
    event.stopPropagation()
    action.run()
  }
  window.addEventListener('keydown', listener, true)
  return () => window.removeEventListener('keydown', listener, true)
}

// --- Parameterized runs ---------------------------------------------------------------------

export function runWorkflow(workflow: Workflow, mode: 'fill' | 'run' = 'fill'): void {
  const params = workflowParams(workflow).map((name): ParamRequest => {
    const argument = workflow.arguments?.find((a) => a.name === name)
    return {
      name,
      description: argument?.description,
      default: argument?.default_value,
      options: argument?.options,
      dynamic: argument?.dynamic_options,
    }
  })
  const finish = (values: Record<string, string>) => {
    const command = renderTemplate(workflow.command, values)
    const session = app().activeSession()
    if (mode === 'run' && session) app().submitToPanes(session, command)
    else app().fillInput(command)
  }
  if (params.length) app().openOverlay({ kind: 'params', title: workflow.name, params, onSubmit: finish })
  else finish({})
}

export function runPrompt(prompt: SavedPrompt): void {
  const params = [...prompt.prompt.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)].map((m) => m[1])
  const finish = (values: Record<string, string>) => app().sendToAgent(renderTemplate(prompt.prompt, values))
  if (params.length) {
    const unique = [...new Set(params)].map((name): ParamRequest => {
      const argument = prompt.arguments?.find((a) => a.name === name)
      return { name, description: argument?.description, default: argument?.default_value, options: argument?.options }
    })
    app().openOverlay({ kind: 'params', title: prompt.name, params: unique, onSubmit: finish })
  } else {
    finish({})
  }
}

export function launchTabConfig(config: TabConfig): void {
  const params = Object.entries(config.params ?? {}).map(([name, param]): ParamRequest => ({
    name,
    description: param.description,
    default: param.default,
    dynamic: param.type === 'branch' ? 'git branch --format=%(refname:short)' : undefined,
  }))
  if (params.length) {
    app().openOverlay({ kind: 'params', title: config.name, params, onSubmit: (values) => app().openTabConfig(config, values) })
  } else {
    app().openTabConfig(config, {})
  }
}

/** Builds the shell statements that load an env collection in the given shell. */
export function envCommand(collection: EnvCollection, shell: string): string {
  const quote = (value: string) => `'${value.replace(/'/g, shell === 'powershell' ? "''" : `'\\''`)}'`
  return Object.entries(collection.variables)
    .map(([name, value]) => {
      const dynamic = /^\$\((.*)\)$/s.exec(value)?.[1]
      if (shell === 'powershell') return `$env:${name} = ${dynamic ? `(${dynamic})` : quote(value)}`
      return `export ${name}=${dynamic ? `"$(${dynamic})"` : quote(value)}`
    })
    .join(shell === 'powershell' ? '; ' : ' && ')
}
