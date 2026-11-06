import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { delimiter, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { toWslPath } from '../shared/logic'
import type { Profile } from '../shared/types'
import { shellResource } from './paths'

const exec = promisify(execFile)

function which(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function detectProfiles(): Promise<Profile[]> {
  const profiles: Profile[] = []
  const add = (profile: Omit<Profile, 'builtin'>) => profiles.push({ ...profile, builtin: true })

  const pwsh = which('pwsh.exe')
  if (pwsh) add({ id: 'pwsh', name: 'PowerShell 7', command: pwsh, kind: 'powershell', icon: '❯', color: '#6fa8ff' })
  const powershell = which('powershell.exe') ?? 'powershell.exe'
  add({ id: 'powershell', name: 'Windows PowerShell', command: powershell, kind: 'powershell', icon: '❯', color: '#6fa8ff' })

  const gitBash = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find(existsSync)
  if (gitBash) add({ id: 'git-bash', name: 'Git Bash', command: gitBash, kind: 'bash', icon: '$', color: '#f0717b' })

  add({ id: 'cmd', name: 'Prompt de Comando', command: process.env.ComSpec ?? 'cmd.exe', kind: 'cmd', icon: '>', color: '#c5ced9' })

  for (const distro of await wslDistros()) {
    add({
      id: `wsl-${distro.toLowerCase()}`,
      name: `WSL: ${distro}`,
      command: 'wsl.exe',
      args: ['-d', distro],
      kind: 'bash',
      wsl: true,
      icon: '🐧',
      color: '#e5c07b',
    })
  }
  return profiles
}

async function wslDistros(): Promise<string[]> {
  try {
    const { stdout } = await exec('wsl.exe', ['-l', '-q'], { encoding: 'buffer', timeout: 4000, windowsHide: true })
    return stdout
      .toString('utf16le')
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, '').trim())
      .filter((name) => name && !name.startsWith('docker-desktop'))
  } catch {
    return []
  }
}

/** Command line that starts a profile with the integration script, and whether it has one. */
export function launchArgs(profile: Profile): { args: string[]; integrated: boolean; env: Record<string, string> } {
  const extra = profile.args ?? []
  switch (profile.kind) {
    case 'powershell':
      return {
        args: [...extra, '-NoLogo', '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', shellResource('wrapped.ps1')],
        integrated: true,
        env: {},
      }
    case 'bash': {
      const script = shellResource('wrapped.bash')
      const path = profile.wsl ? toWslPath(script) : script.replace(/\\/g, '/')
      const prefix = profile.wsl ? [...extra, '--', 'bash'] : extra
      return { args: [...prefix, '--rcfile', path, '-i'], integrated: true, env: {} }
    }
    case 'zsh': {
      const dir = shellResource('zsh')
      const path = profile.wsl ? toWslPath(dir) : dir.replace(/\\/g, '/')
      if (profile.wsl) {
        return {
          args: [...extra, '--', 'env', `ZDOTDIR=${path}`, 'zsh', '-i'],
          integrated: true,
          env: {},
        }
      }
      return { args: [...extra, '-i'], integrated: true, env: { ZDOTDIR: path } }
    }
    case 'fish': {
      const script = shellResource('wrapped.fish')
      const path = profile.wsl ? toWslPath(script) : script.replace(/\\/g, '/')
      const prefix = profile.wsl ? [...extra, '--', 'fish'] : extra
      return { args: [...prefix, '--interactive', '--init-command', `source ${path}`], integrated: true, env: {} }
    }
    default:
      return { args: extra, integrated: false, env: {} }
  }
}

const SHELL_BUILTINS = [
  'alias', 'bg', 'bind', 'break', 'builtin', 'cd', 'command', 'continue', 'declare', 'dirs', 'echo', 'eval', 'exec',
  'exit', 'export', 'false', 'fg', 'for', 'function', 'hash', 'help', 'history', 'if', 'jobs', 'kill', 'let', 'local',
  'logout', 'popd', 'printf', 'pushd', 'pwd', 'read', 'readonly', 'return', 'set', 'shift', 'source', 'test', 'times',
  'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'until', 'wait', 'while', 'foreach', 'switch',
  'try', 'param', 'class', 'do', 'dir', 'copy', 'del', 'move', 'ren', 'rd', 'md', 'mkdir', 'cls', 'ver', 'vol', 'start',
]

let knownCommands: Promise<Set<string>> | null = null

/** Executables on PATH, shell builtins and PowerShell commands, used for underlining and suggestions. */
export function listCommands(): Promise<Set<string>> {
  knownCommands ??= (async () => {
    const names = new Set(SHELL_BUILTINS)
    const executable = new Set(['.exe', '.cmd', '.bat', '.com', '.ps1', ''])
    await Promise.all(
      (process.env.PATH ?? '').split(delimiter).map(async (dir) => {
        if (!dir) return
        const entries = await fs.readdir(dir).catch(() => [] as string[])
        for (const entry of entries) {
          const ext = extname(entry).toLowerCase()
          if (executable.has(ext)) names.add(ext ? entry.slice(0, -ext.length) : entry)
        }
      }),
    )
    try {
      const { stdout } = await exec(
        'powershell.exe',
        ['-NoProfile', '-NoLogo', '-Command', '(Get-Command -CommandType Cmdlet,Function).Name -join "`n"'],
        { timeout: 15000, windowsHide: true, maxBuffer: 1 << 24 },
      )
      for (const name of stdout.split(/\r?\n/)) if (name) names.add(name)
    } catch {
      // Falling back to PATH alone only makes the underline less precise.
    }
    return names
  })()
  return knownCommands
}

export async function nodeVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await exec('node', ['--version'], { timeout: 3000, windowsHide: true, shell: true })
    return `node ${stdout.trim().replace(/^v/, '')}`
  } catch {
    return undefined
  }
}
