import { BrowserWindow, globalShortcut, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import type { Settings } from '../shared/settings'
import { builtinThemes, findTheme } from '../shared/themes'
import { loadSettings } from './store'

let mainWindow: BrowserWindow | null = null
let quakeWindow: BrowserWindow | null = null

function titleBarColors(settings: Settings) {
  const theme = findTheme(builtinThemes, settings.appearance.theme)
  return { color: '#00000000', symbolColor: theme.foreground, height: 36 }
}

export function createWindow(quake = false): BrowserWindow {
  const settings = loadSettings()
  const window = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 520,
    minHeight: 320,
    show: false,
    frame: !quake ? undefined : false,
    titleBarStyle: quake ? undefined : 'hidden',
    titleBarOverlay: quake ? undefined : titleBarColors(settings),
    backgroundColor: settings.appearance.backdrop === 'none' ? findTheme(builtinThemes, settings.appearance.theme).background : '#00000000',
    backgroundMaterial: settings.appearance.backdrop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  window.once('ready-to-show', () => {
    if (!quake && !process.env.WRAPPED_HIDDEN) window.show()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const devServer = process.env.ELECTRON_RENDERER_URL
  const query = quake ? { quake: '1' } : undefined
  if (devServer) void window.loadURL(quake ? `${devServer}?quake=1` : devServer)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query })

  if (quake) quakeWindow = window
  else mainWindow ??= window
  window.on('closed', () => {
    if (window === mainWindow) mainWindow = null
    if (window === quakeWindow) quakeWindow = null
  })
  return window
}

function placeQuake(window: BrowserWindow, settings: Settings): void {
  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const height = Math.round((bounds.height * settings.hotkey.quakeHeightPercent) / 100)
  const y = settings.hotkey.quakePosition === 'top' ? bounds.y : bounds.y + bounds.height - height
  window.setBounds({ x: bounds.x, y, width: bounds.width, height })
}

function toggle(settings: Settings): void {
  if (settings.hotkey.mode === 'quake') {
    const window = quakeWindow ?? createWindow(true)
    if (window.isVisible() && window.isFocused()) {
      window.hide()
    } else {
      placeQuake(window, settings)
      window.show()
      window.focus()
    }
    return
  }
  const window = mainWindow ?? createWindow()
  if (window.isVisible() && window.isFocused()) {
    window.hide()
  } else {
    window.show()
    window.focus()
  }
}

export function applySettings(settings: Settings): void {
  globalShortcut.unregisterAll()
  if (settings.hotkey.mode !== 'off') {
    try {
      globalShortcut.register(settings.hotkey.keybinding, () => toggle(settings))
    } catch (error) {
      console.warn(`wrapped: hotkey inválida: ${error}`)
    }
  }
  nativeTheme.themeSource = 'system'
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundMaterial(settings.appearance.backdrop)
    window.setOpacity(settings.appearance.backdrop === 'none' ? settings.appearance.windowOpacity / 100 : 1)
    if (window === quakeWindow) continue
    window.setTitleBarOverlay(titleBarColors(settings))
  }
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, ...args)
}
