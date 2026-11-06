import { useEffect, useState } from 'react'
import { stripAnsi } from '../../shared/oscRouter'
import { useApp } from '../state/store'
import type { PaneSession } from '../terminal/PaneSession'

export function PromptChips({ session }: { session: PaneSession }) {
  const chips = useApp((state) => state.settings.appearance.promptChips)
  const mode = useApp((state) => state.settings.appearance.promptMode)
  const nodeVersion = useApp((state) => state.nodeVersion)
  const [now, setNow] = useState(() => new Date())
  const { meta, profile, lastExit } = session

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
      {lastExit ? <span className="chip chip-exit">exit {lastExit}</span> : null}
    </div>
  )
}
