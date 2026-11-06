import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('wrapped', {
  rpc: (name: string, args: unknown[]) => ipcRenderer.invoke('rpc', name, args),
  on(channel: string, listener: (...args: unknown[]) => void) {
    const wrapped = (_: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.off(channel, wrapped)
  },
})
