import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { FileEntry, GitStatusEntry, SearchHit } from '../shared/types'

const exec = promisify(execFile)
const MAX_READ = 5 * 1024 * 1024
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'bin', 'obj', '.next', 'target', '__pycache__'])

export async function listDir(dir: string): Promise<FileEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .map((entry) => ({ name: entry.name, path: join(dir, entry.name), dir: entry.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

export async function readText(path: string): Promise<string> {
  const stat = await fs.stat(path)
  if (stat.size > MAX_READ) throw new Error('Arquivo grande demais para o editor')
  return fs.readFile(path, 'utf8')
}

export async function writeText(path: string, content: string): Promise<void> {
  await fs.writeFile(path, content)
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, windowsHide: true, maxBuffer: 1 << 25, timeout: 15000 })
  return stdout
}

export async function searchFiles(root: string, query: string): Promise<SearchHit[]> {
  if (!query) return []
  try {
    const out = await git(root, 'grep', '-n', '-I', '-i', '-F', '--untracked', '--no-color', '-e', query)
    return out.split('\n').filter(Boolean).slice(0, 500).map((line) => {
      const [, file, number, text] = /^(.+?):(\d+):(.*)$/.exec(line) ?? []
      return { path: join(root, file ?? ''), line: Number(number), text: (text ?? '').trim().slice(0, 240) }
    })
  } catch {
    return walkSearch(root, query)
  }
}

async function walkSearch(root: string, query: string): Promise<SearchHit[]> {
  const needle = query.toLowerCase()
  const hits: SearchHit[] = []
  const visit = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (hits.length >= 500) return
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) await visit(path)
        continue
      }
      const stat = await fs.stat(path).catch(() => null)
      if (!stat || stat.size > 1 << 20) continue
      const text = await fs.readFile(path, 'utf8').catch(() => '')
      if (text.includes('\0')) continue
      text.split('\n').forEach((line, index) => {
        if (line.toLowerCase().includes(needle)) hits.push({ path, line: index + 1, text: line.trim().slice(0, 240) })
      })
    }
  }
  await visit(root)
  return hits.slice(0, 500)
}

export async function gitStatus(cwd: string): Promise<GitStatusEntry[]> {
  const out = await git(cwd, 'status', '--porcelain=v1', '-uall').catch(() => '')
  return out.split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim() || '?', path: line.slice(3) }))
}

export async function gitDiff(cwd: string, file?: string): Promise<string> {
  const paths = file ? ['--', file] : []
  const diff = await git(cwd, 'diff', 'HEAD', ...paths).catch(() => git(cwd, 'diff', ...paths).catch(() => ''))
  if (diff || !file) return diff
  const text = await fs.readFile(join(cwd, file), 'utf8').catch(() => '')
  return text ? `+++ ${relative(cwd, join(cwd, file))} (novo)\n${text.split('\n').map((l) => `+${l}`).join('\n')}` : ''
}
