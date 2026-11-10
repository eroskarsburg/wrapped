import { useEffect, useState } from 'react'
import type { GitDiffStats } from '../../shared/logic'
import { stripAnsi } from '../../shared/oscRouter'
import { api } from '../rpc'
import { useApp } from '../state/store'
import type { PaneSession } from '../terminal/PaneSession'

export function PromptChips({ session }: { session: PaneSession }) {
  const chips = useApp((state) => state.settings.appearance.promptChips)
  const mode = useApp((state) => state.settings.appearance.promptMode)
  const nodeVersion = useApp((state) => state.nodeVersion)
  const [now, setNow] = useState(() => new Date())
  const [diff, setDiff] = useState<GitDiffStats | null>(null)
  const { meta, profile, lastExit } = session
  const showDiff = chips.includes('diff') && !!meta.git && !!meta.cwd

  // Refreshed whenever the prompt comes back, since any command may have changed the tree.
  useEffect(() => {
    if (!showDiff || meta.cwd?.startsWith('\\\\')) {
      setDiff(null)
      return
    }
    let cancelled = false
    void api.gitStats(meta.cwd!).then((stats) => !cancelled && setDiff(stats)).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [showDiff, meta.cwd, meta.git, session.blocks.length, lastExit])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  if (mode === 'shell' && meta.prompt?.trim()) return <pre className="shell-prompt">{stripAnsi(meta.prompt)}</pre>

  const values: Record<string, string | undefined> = {
    cwd: meta.cwd?.replace(/^.*[\\/](?=[^\\/]+[\\/][^\\/]+$)/, '…\\'),
    git: meta.git,
    venv: meta.venv?.split(/[\\/]/).pop(),
    node: nodeVersion,
    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    user: meta.user,
  }
  return (
    <div className="prompt-chips">
      <span className="chip profile" style={{ color: profile.color }}>{profile.icon} {profile.name}</span>
      {chips.map((chip) => values[chip] && <span key={chip} className={`chip chip-${chip}`}>{values[chip]}</span>)}
      {diff && diff.files > 0 && (
        <button className="chip chip-diff" title="Ver alterações do git" onClick={() => useApp.setState({ sidebar: 'git' })}>
          {diff.files} {diff.files === 1 ? 'arquivo' : 'arquivos'} <span className="diff-add">+{diff.added}</span> <span className="diff-del">−{diff.removed}</span>
        </button>
      )}
      {lastExit ? <span className="chip chip-exit">exit {lastExit}</span> : null}
    </div>
  )
}
