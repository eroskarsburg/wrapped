export const defaultSettings = {
  appearance: {
    theme: 'wrapped-dark',
    syncOsTheme: false,
    lightTheme: 'solarized-light',
    darkTheme: 'wrapped-dark',
    fontFamily: "'Cascadia Code', Consolas, monospace",
    fontSize: 13,
    fontWeight: 'normal' as 'normal' | 'bold' | '300' | '500',
    lineHeight: 1.35,
    ligatures: false,
    minimumContrast: 1,
    cursorStyle: 'bar' as 'bar' | 'block' | 'underline',
    cursorBlink: true,
    compactBlocks: false,
    blockDividers: true,
    jumpToBottom: true,
    inputPosition: 'bottom' as 'bottom' | 'top' | 'classic',
    promptMode: 'chips' as 'chips' | 'shell',
    promptChips: ['cwd', 'git', 'venv', 'node', 'time'] as string[],
    verticalTabs: true,
    dimInactivePanes: true,
    focusOnHover: false,
    windowOpacity: 100,
    backdrop: 'none' as 'none' | 'mica' | 'acrylic' | 'tabbed',
    zoom: 100,
    directoryTabColors: {} as Record<string, string>,
  },
  terminal: {
    defaultProfile: '',
    copyOnSelect: false,
    osc52: 'write' as 'off' | 'write',
    audibleBell: false,
    scrollback: 20000,
    restoreSession: true,
    confirmClose: true,
    undoCloseSeconds: 30,
    longCommandNotifySeconds: 30,
  },
  input: {
    vim: false,
    syntaxHighlighting: true,
    errorUnderline: true,
    autosuggestions: true,
    completionsWhileTyping: false,
    aliasExpansion: false,
    commandCorrections: true,
    closeBrackets: true,
    commandInspector: true,
  },
  privacy: {
    secretRedaction: true,
    customSecretRegex: [] as string[],
  },
  hotkey: {
    mode: 'off' as 'off' | 'toggle' | 'quake',
    keybinding: 'Control+`',
    quakeHeightPercent: 50,
    quakePosition: 'top' as 'top' | 'bottom',
  },
  agent: {
    enabled: false,
    model: 'claude-opus-5-5',
    naturalLanguageDetection: true,
    activeProfile: 'Padrão',
    showCliAgentToolbar: true,
  },
}

export type Settings = typeof defaultSettings

export interface SettingField {
  path: string
  label: string
  section: string
  type: 'boolean' | 'number' | 'text' | 'select' | 'list' | 'theme' | 'profile'
  options?: string[]
  min?: number
  max?: number
}

export const settingFields: SettingField[] = [
  { path: 'appearance.theme', label: 'Tema', section: 'Aparência', type: 'theme' },
  { path: 'appearance.syncOsTheme', label: 'Seguir claro/escuro do sistema', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.lightTheme', label: 'Tema no modo claro', section: 'Aparência', type: 'theme' },
  { path: 'appearance.darkTheme', label: 'Tema no modo escuro', section: 'Aparência', type: 'theme' },
  { path: 'appearance.fontFamily', label: 'Fonte', section: 'Aparência', type: 'text' },
  { path: 'appearance.fontSize', label: 'Tamanho da fonte', section: 'Aparência', type: 'number', min: 8, max: 32 },
  { path: 'appearance.fontWeight', label: 'Peso da fonte', section: 'Aparência', type: 'select', options: ['300', 'normal', '500', 'bold'] },
  { path: 'appearance.lineHeight', label: 'Altura da linha', section: 'Aparência', type: 'number', min: 1, max: 2 },
  { path: 'appearance.ligatures', label: 'Ligaduras', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.minimumContrast', label: 'Contraste mínimo (1 a 21)', section: 'Aparência', type: 'number', min: 1, max: 21 },
  { path: 'appearance.cursorStyle', label: 'Estilo do cursor', section: 'Aparência', type: 'select', options: ['bar', 'block', 'underline'] },
  { path: 'appearance.cursorBlink', label: 'Cursor piscando', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.compactBlocks', label: 'Blocos compactos', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.blockDividers', label: 'Divisores entre blocos', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.jumpToBottom', label: 'Botão de ir ao fim do bloco', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.inputPosition', label: 'Posição do input', section: 'Aparência', type: 'select', options: ['bottom', 'top', 'classic'] },
  { path: 'appearance.promptMode', label: 'Prompt', section: 'Aparência', type: 'select', options: ['chips', 'shell'] },
  { path: 'appearance.promptChips', label: 'Chips do prompt (cwd, git, venv, node, time, user)', section: 'Aparência', type: 'list' },
  { path: 'appearance.verticalTabs', label: 'Abas verticais', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.dimInactivePanes', label: 'Escurecer panes inativos', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.focusOnHover', label: 'Focar pane ao passar o mouse', section: 'Aparência', type: 'boolean' },
  { path: 'appearance.windowOpacity', label: 'Opacidade da janela (%)', section: 'Janela', type: 'number', min: 20, max: 100 },
  { path: 'appearance.backdrop', label: 'Material de fundo', section: 'Janela', type: 'select', options: ['none', 'mica', 'acrylic', 'tabbed'] },
  { path: 'appearance.zoom', label: 'Zoom (%)', section: 'Janela', type: 'number', min: 50, max: 250 },
  { path: 'terminal.defaultProfile', label: 'Perfil padrão', section: 'Terminal', type: 'profile' },
  { path: 'terminal.copyOnSelect', label: 'Copiar ao selecionar', section: 'Terminal', type: 'boolean' },
  { path: 'terminal.osc52', label: 'Acesso de programas ao clipboard (OSC 52)', section: 'Terminal', type: 'select', options: ['off', 'write'] },
  { path: 'terminal.audibleBell', label: 'Bell sonoro', section: 'Terminal', type: 'boolean' },
  { path: 'terminal.scrollback', label: 'Linhas de scrollback por bloco', section: 'Terminal', type: 'number', min: 1000, max: 200000 },
  { path: 'terminal.restoreSession', label: 'Restaurar sessão ao abrir', section: 'Terminal', type: 'boolean' },
  { path: 'terminal.confirmClose', label: 'Confirmar ao fechar com comando rodando', section: 'Terminal', type: 'boolean' },
  { path: 'terminal.undoCloseSeconds', label: 'Janela de desfazer fechamento (s)', section: 'Terminal', type: 'number', min: 0, max: 300 },
  { path: 'terminal.longCommandNotifySeconds', label: 'Notificar comandos acima de (s)', section: 'Terminal', type: 'number', min: 0, max: 3600 },
  { path: 'input.vim', label: 'Modo Vim', section: 'Input', type: 'boolean' },
  { path: 'input.syntaxHighlighting', label: 'Realce de sintaxe', section: 'Input', type: 'boolean' },
  { path: 'input.errorUnderline', label: 'Sublinhar comandos inválidos', section: 'Input', type: 'boolean' },
  { path: 'input.autosuggestions', label: 'Autosuggestions do histórico', section: 'Input', type: 'boolean' },
  { path: 'input.completionsWhileTyping', label: 'Completions enquanto digita', section: 'Input', type: 'boolean' },
  { path: 'input.aliasExpansion', label: 'Expandir aliases', section: 'Input', type: 'boolean' },
  { path: 'input.commandCorrections', label: 'Sugerir correção de comando', section: 'Input', type: 'boolean' },
  { path: 'input.closeBrackets', label: 'Fechar aspas e colchetes', section: 'Input', type: 'boolean' },
  { path: 'input.commandInspector', label: 'Command inspector ao passar o mouse', section: 'Input', type: 'boolean' },
  { path: 'privacy.secretRedaction', label: 'Ocultar secrets na saída', section: 'Privacidade', type: 'boolean' },
  { path: 'privacy.customSecretRegex', label: 'Regex extras de secrets', section: 'Privacidade', type: 'list' },
  { path: 'hotkey.mode', label: 'Hotkey global', section: 'Hotkey', type: 'select', options: ['off', 'toggle', 'quake'] },
  { path: 'hotkey.keybinding', label: 'Atalho global', section: 'Hotkey', type: 'text' },
  { path: 'hotkey.quakeHeightPercent', label: 'Altura da janela Quake (%)', section: 'Hotkey', type: 'number', min: 20, max: 100 },
  { path: 'hotkey.quakePosition', label: 'Posição da janela Quake', section: 'Hotkey', type: 'select', options: ['top', 'bottom'] },
  { path: 'agent.enabled', label: 'Ativar Agent Mode', section: 'Agente', type: 'boolean' },
  { path: 'agent.model', label: 'Modelo', section: 'Agente', type: 'select', options: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] },
  { path: 'agent.activeProfile', label: 'Perfil de permissões (de ~/.wrapped/agent_profiles)', section: 'Agente', type: 'text' },
  { path: 'agent.naturalLanguageDetection', label: 'Detectar linguagem natural no input', section: 'Agente', type: 'boolean' },
  { path: 'agent.showCliAgentToolbar', label: 'Toolbar para CLI agents (claude, codex…)', section: 'Agente', type: 'boolean' },
]

export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], source)
}

export function setPath<T>(source: T, path: string, value: unknown): T {
  const keys = path.split('.')
  const copy = structuredClone(source) as Record<string, unknown>
  let node = copy
  for (const key of keys.slice(0, -1)) {
    node[key] = { ...((node[key] as Record<string, unknown>) ?? {}) }
    node = node[key] as Record<string, unknown>
  }
  node[keys.at(-1)!] = value
  return copy as T
}

/** Fills whatever the user's file leaves out, so that older files keep working. */
export function mergeSettings(user: unknown): Settings {
  const merge = (base: unknown, over: unknown): unknown => {
    if (over === undefined) return base
    const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
    if (!isObject(base) || !isObject(over)) return over
    const out: Record<string, unknown> = { ...over }
    for (const key of Object.keys(base)) out[key] = merge(base[key], over[key])
    return out
  }
  return merge(defaultSettings, user) as Settings
}
