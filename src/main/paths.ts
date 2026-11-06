import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** User-editable configuration. WRAPPED_HOME isolates end-to-end tests from the real one. */
export const configDir = process.env.WRAPPED_HOME ?? join(homedir(), '.wrapped')

export function dataDir(): string {
  return process.env.WRAPPED_HOME ? join(process.env.WRAPPED_HOME, 'data') : app.getPath('userData')
}

export function shellResource(file: string): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'shell') : join(app.getAppPath(), 'resources', 'shell')
  return join(base, file)
}
