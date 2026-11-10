import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { parseGitStats, type GitDiffStats } from '../shared/logic'
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
  // These calls run in the background while the user works in the same repository; without this,
  // "git status" takes index.lock and a commit started at the same moment fails.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  // Without quotePath=false, git prints "ação.ts" as "a\303\247\303\243o.ts", quotes included. The
  // other overrides keep the user's config (color.ui=always, mnemonic c/ w/ prefixes) out of the output
  // that is parsed or shown here.
  const config = ['core.quotePath=false', 'color.ui=false', 'diff.mnemonicPrefix=false', 'diff.noprefix=false']
  const { stdout } = await exec('git', [...config.flatMap((c) => ['-c', c]), ...args], { cwd, env, windowsHide: true, maxBuffer: 1 << 25, timeout: 15000 })
  return stdout
}

export async function searchFiles(root: string, query: string): Promise<SearchHit[]> {
  if (!query) return []
  try {
    // -z ends the file name and the line number with NUL, so that names with ":" or digits parse.
    const out = await git(root, 'grep', '-z', '-n', '-I', '-i', '-F', '--untracked', '--no-color', '-e', query)
    return out.split('\n').filter(Boolean).slice(0, 500).map((line) => {
      const [file = '', number = '0', ...text] = line.split('\0')
      return { path: join(root, file), line: Number(number), text: text.join('\0').trim().slice(0, 240) }
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
  // With -z, names come unquoted and a rename is "R  new\0old\0" instead of "old -> new".
  const out = await git(cwd, 'status', '--porcelain=v1', '-z', '-uall').catch(() => '')
  const fields = out.split('\0')
  const entries: GitStatusEntry[] = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (field.length < 4) continue
    const status = field.slice(0, 2)
    entries.push({ status: status.trim() || '?', path: field.slice(3) })
    if (/[RC]/.test(status)) i++
  }
  return entries
}

export async function gitDiff(cwd: string, file?: string): Promise<string> {
  const paths = file ? ['--', file] : []
  const diff = await git(cwd, 'diff', 'HEAD', ...paths).catch(() => git(cwd, 'diff', ...paths).catch(() => ''))
  if (diff || !file) return diff
  const text = await fs.readFile(join(cwd, file), 'utf8').catch(() => '')
  return text ? `+++ ${relative(cwd, join(cwd, file))} (novo)\n${text.split('\n').map((l) => `+${l}`).join('\n')}` : ''
}

/** Changed files and lines against HEAD, or null outside a repository. */
export async function gitStats(cwd: string): Promise<GitDiffStats | null> {
  try {
    // Untracked directories count as one entry: listing every file in them is slow in large trees.
    const porcelain = await git(cwd, 'status', '--porcelain=v1', '--untracked-files=normal')
    // A repository without commits has no HEAD to diff against, only staged files.
    const numstat = await git(cwd, 'diff', 'HEAD', '--numstat').catch(() => git(cwd, 'diff', '--cached', '--numstat').catch(() => ''))
    return parseGitStats(numstat, porcelain)
  } catch {
    return null
  }
}
