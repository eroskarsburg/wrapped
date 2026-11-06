import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { killAll } from './pty'
import { handlers, type Handlers } from './rpc'
import { initStore, loadSettings, watchConfig } from './store'
import { applySettings, broadcast, createWindow } from './window'

if (process.env.WRAPPED_HOME) app.setPath('userData', `${process.env.WRAPPED_HOME}/data`)

ipcMain.handle('rpc', (event, name: keyof Handlers, args: unknown[]) => {
  const handler = handlers[name] as unknown as (...params: unknown[]) => unknown
  if (typeof handler !== 'function') throw new Error(`rpc desconhecido: ${String(name)}`)
  return handler(event.sender, ...args)
})

app.whenReady().then(() => {
  initStore()
  createWindow()
  applySettings(loadSettings())
  watchConfig(() => {
    applySettings(loadSettings())
    broadcast('config-changed')
  })
  nativeTheme.on('updated', () => broadcast('os-theme', nativeTheme.shouldUseDarkColors))
})

app.on('wrapped-new-window' as never, () => createWindow())

app.on('window-all-closed', () => {
  killAll()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
