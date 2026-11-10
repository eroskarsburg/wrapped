import { app, BrowserWindow, clipboard, dialog, Notification, shell, type WebContents } from 'electron'
import { homedir } from 'node:os'
import { promises as fs } from 'node:fs'
import type { Settings } from '../shared/settings'
import type { EnvCollection, HistoryEntry, KnowledgeKind, Profile, TabConfig, Theme, WindowSession } from '../shared/types'
import { agentConversation, generateCommand, resetConversation } from './agent'
import { gitDiff, gitStats, gitStatus, listDir, readText, searchFiles, writeText } from './code'
import { completions, describeToken } from './completions'
import { downloadedWebFonts, listFonts, webFont } from './fonts'
import { applySettings } from './window'
import { configDir } from './paths'
import { createSession, getSession } from './pty'
import { detectProfiles, listCommands, nodeVersion, runQuiet } from './shells'
import * as store from './store'

let builtinProfiles: Promise<Profile[]> | null = null

async function allProfiles(): Promise<Profile[]> {
  builtinProfiles ??= detectProfiles()
  return [...(await builtinProfiles), ...(await store.listUserProfiles())]
}

/** First argument of each handler is injected: the WebContents of the calling window. */
export const handlers = {
  // PTY
  async ptyCreate(sender: WebContents, paneId: string, profile: Profile, cwd: string | undefined, cols: number, rows: number) {
    return createSession(paneId, profile, cwd, cols, rows, store.loadSettings().appearance.promptMode === 'shell', sender)
  },
  ptySubmit: (_: WebContents, paneId: string, command: string) => getSession(paneId)?.submit(command),
  ptyWrite: (_: WebContents, paneId: string, data: string) => getSession(paneId)?.write(data),
  ptyResize: (_: WebContents, paneId: string, cols: number, rows: number) => getSession(paneId)?.resize(cols, rows),
  ptyKill: (_: WebContents, paneId: string) => getSession(paneId)?.kill(),

  // Configuration
  loadSettings: () => store.loadSettings(),
  saveSettings(_: WebContents, settings: Settings) {
    store.saveSettings(settings)
    applySettings(settings)
  },
  loadKeybindings: () => store.loadKeybindings(),
  saveKeybindings: (_: WebContents, bindings: Record<string, string>) => store.saveKeybindings(bindings),
  listProfiles: () => allProfiles(),
  saveProfile: (_: WebContents, profile: Profile) => store.saveProfile(profile),
  deleteProfile: (_: WebContents, id: string) => store.deleteProfile(id),
  listThemes: () => store.listThemes(),
  listFonts: () => listFonts(),
  webFont: (_: WebContents, id: string, weight: number) => webFont(id, weight),
  downloadedWebFonts: () => downloadedWebFonts(),
  saveTheme: (_: WebContents, theme: Theme) => store.saveTheme(theme),
  listTabConfigs: () => store.listTabConfigs(),
  saveTabConfig: (_: WebContents, config: TabConfig) => store.saveTabConfig(config),
  listKnowledge: () => store.listKnowledge(),
  saveKnowledge: (_: WebContents, kind: KnowledgeKind, item: { name: string; file?: string }) => store.saveKnowledge(kind, item),
  deleteConfigFile: (_: WebContents, file: string) => store.deleteConfigFile(file),
  listNotebooks: () => store.listNotebooks(),
  createNotebook: (_: WebContents, title: string) => store.createNotebook(title),
  openConfigDir: () => shell.openPath(configDir),

  // Knowledge import and export
  async exportEnv(_: WebContents, collection: EnvCollection) {
    const { filePath } = await dialog.showSaveDialog({ defaultPath: `${collection.name}.env` })
    if (filePath) await store.exportEnv(collection, filePath)
  },
  async importFile(_: WebContents, kind: KnowledgeKind | 'notebooks' | 'themes') {
    const filters = kind === 'notebooks' ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
    const { filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters })
    for (const file of filePaths) {
      const name = file.split(/[\\/]/).pop()!
      await fs.copyFile(file, `${configDir}/${kind}/${name}`)
    }
    return filePaths.length
  },
  async saveAs(_: WebContents, name: string, content: string) {
    const { filePath } = await dialog.showSaveDialog({ defaultPath: name })
    if (filePath) await fs.writeFile(filePath, content)
  },
  async pickImage() {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (!filePaths[0]) return null
    const data = await fs.readFile(filePaths[0])
    const ext = filePaths[0].split('.').pop()!.toLowerCase().replace('jpg', 'jpeg')
    return { path: filePaths[0], dataUrl: `data:image/${ext};base64,${data.toString('base64')}` }
  },
  async readImage(_: WebContents, path: string) {
    const data = await fs.readFile(path).catch(() => null)
    if (!data) return null
    const ext = path.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg')
    return `data:image/${ext};base64,${data.toString('base64')}`
  },

  // History and session
  loadHistory: () => store.loadHistory(),
  appendHistory: (_: WebContents, entry: HistoryEntry) => store.appendHistory(entry),
  loadSession: () => store.loadSession(),
  saveSession: (_: WebContents, session: WindowSession) => store.saveSession(session),

  // Input intelligence
  completions: (_: WebContents, line: string, offset: number, cwd?: string) => completions(line, offset, cwd),
  describeToken: (_: WebContents, line: string, offset: number) => describeToken(line, offset),
  listCommands: async () => [...(await listCommands())],

  // Code
  homeDir: () => homedir(),
  runQuiet: (_: WebContents, command: string, cwd?: string) => runQuiet(command, cwd),
  nodeVersion: () => nodeVersion(),
  listDir: (_: WebContents, dir: string) => listDir(dir),
  readText: (_: WebContents, path: string) => readText(path),
  writeText: (_: WebContents, path: string, content: string) => writeText(path, content),
  searchFiles: (_: WebContents, root: string, query: string) => searchFiles(root, query),
  gitStatus: (_: WebContents, cwd: string) => gitStatus(cwd),
  gitDiff: (_: WebContents, cwd: string, file?: string) => gitDiff(cwd, file),
  gitStats: (_: WebContents, cwd: string) => gitStats(cwd),

  // Agent
  agentSend(sender: WebContents, id: string, text: string, context: { cwd?: string; shell?: string; paneId?: string }) {
    void agentConversation(id, sender).send_(text, context)
  },
  agentApprove: (sender: WebContents, id: string, requestId: string, allowed: boolean) =>
    agentConversation(id, sender).approve(requestId, allowed),
  agentCommandResult: (sender: WebContents, id: string, requestId: string, output: string) =>
    agentConversation(id, sender).commandResult(requestId, output),
  agentStop: (sender: WebContents, id: string) => agentConversation(id, sender).stop(),
  agentReset: (_: WebContents, id: string) => resetConversation(id),
  generateCommand: (_: WebContents, request: string, context: { cwd?: string; shell?: string }) => generateCommand(request, context),
  saveApiKey: (_: WebContents, key: string) => store.saveApiKey(key),
  hasApiKey: () => !!(store.loadApiKey() || process.env.ANTHROPIC_API_KEY),
  listAgentProfiles: () => store.listAgentProfiles(),

  // Desktop
  openExternal(_: WebContents, target: string) {
    if (/^https?:\/\//i.test(target) || /^mailto:/i.test(target)) void shell.openExternal(target)
    else void shell.openPath(target)
  },
  copyText: (_: WebContents, text: string) => clipboard.writeText(text),
  readClipboard: () => clipboard.readText(),
  notify(_: WebContents, title: string, body: string) {
    const window = BrowserWindow.getAllWindows()[0]
    if (window?.isFocused()) return
    const notification = new Notification({ title, body })
    notification.on('click', () => window?.show())
    notification.show()
  },
  setZoom: (sender: WebContents, percent: number) => sender.setZoomFactor(percent / 100),
  minimize: (sender: WebContents) => BrowserWindow.fromWebContents(sender)?.minimize(),
  newWindow: () => app.emit('wrapped-new-window'),
}

export type Handlers = typeof handlers
