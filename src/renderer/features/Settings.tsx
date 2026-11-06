import { useEffect, useMemo, useState } from 'react'
import { getPath, settingFields, type SettingField } from '../../shared/settings'
import { rgbToHex, themeFromColors } from '../../shared/themes'
import type { Profile, ShellKind } from '../../shared/types'
import { actions, bindingFor, eventKeys } from '../actions'
import { api } from '../rpc'
import { useApp } from '../state/store'
import { Icon } from './icons'

function Field({ field }: { field: SettingField }) {
  const settings = useApp((state) => state.settings)
  const setSetting = useApp((state) => state.setSetting)
  const themes = useApp((state) => state.themes)
  const profiles = useApp((state) => state.profiles)
  const value = getPath(settings, field.path)
  const set = (next: unknown) => setSetting(field.path, next)
  switch (field.type) {
    case 'boolean':
      return <input type="checkbox" aria-label={field.label} checked={!!value} onChange={(event) => set(event.target.checked)} />
    case 'number':
      return <input type="number" aria-label={field.label} min={field.min} max={field.max} step={field.max && field.max <= 2 ? 0.05 : 1} value={value as number} onChange={(event) => set(Number(event.target.value))} />
    case 'select':
      return (
        <select aria-label={field.label} value={value as string} onChange={(event) => set(event.target.value)}>
          {field.options?.map((option) => <option key={option}>{option}</option>)}
        </select>
      )
    case 'theme':
      return (
        <select aria-label={field.label} value={value as string} onChange={(event) => set(event.target.value)}>
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
      )
    case 'profile':
      return (
        <select aria-label={field.label} value={value as string} onChange={(event) => set(event.target.value)}>
          <option value="">Automático</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      )
    case 'list':
      return <input aria-label={field.label} value={(value as string[]).join(', ')} onChange={(event) => set(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
    default:
      return <input aria-label={field.label} value={value as string} onChange={(event) => set(event.target.value)} />
  }
}

function emptyProfile(): Profile {
  return { id: '', name: '', command: 'powershell.exe', kind: 'powershell', icon: '❯', color: '#5eead4', startup: [] }
}

function ProfileEditor({ value, onDone }: { value: Profile; onDone(): void }) {
  const themes = useApp((state) => state.themes)
  const [draft, setDraft] = useState(value)
  const [envText, setEnvText] = useState(Object.entries(value.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'))
  const set = (patch: Partial<Profile>) => setDraft({ ...draft, ...patch })
  const save = () => {
    const env = Object.fromEntries(envText.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    void api.saveProfile({ ...draft, env }).then(onDone)
  }
  return (
    <form className="profile-form" onSubmit={(event) => { event.preventDefault(); save() }}>
      <label>Nome<input required value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label>Executável<input required value={draft.command} onChange={(e) => set({ command: e.target.value })} /></label>
      <label>Argumentos<input value={(draft.args ?? []).join(' ')} onChange={(e) => set({ args: e.target.value.split(' ').filter(Boolean) })} /></label>
      <label>Tipo de shell
        <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as ShellKind })}>
          {['powershell', 'bash', 'zsh', 'fish', 'cmd', 'other'].map((kind) => <option key={kind}>{kind}</option>)}
        </select>
      </label>
      <label>Diretório inicial<input value={draft.cwd ?? ''} onChange={(e) => set({ cwd: e.target.value || undefined })} /></label>
      <label>Ícone<input maxLength={4} value={draft.icon ?? ''} onChange={(e) => set({ icon: e.target.value })} /></label>
      <label>Cor<input type="color" value={draft.color ?? '#5eead4'} onChange={(e) => set({ color: e.target.value })} /></label>
      <label>Tema próprio
        <select value={draft.theme ?? ''} onChange={(e) => set({ theme: e.target.value || undefined })}>
          <option value="">Tema global</option>
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
      </label>
      <label className="wide">Comandos de início (um por linha)<textarea rows={3} value={(draft.startup ?? []).join('\n')} onChange={(e) => set({ startup: e.target.value.split('\n').filter(Boolean) })} /></label>
      <label className="wide">Variáveis de ambiente (NOME=valor)<textarea rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} /></label>
      <div className="form-actions wide">
        <button type="button" onClick={onDone}>Cancelar</button>
        <button type="submit" className="primary">Salvar perfil</button>
      </div>
    </form>
  )
}

function ProfilesSection() {
  const profiles = useApp((state) => state.profiles)
  const newTab = useApp((state) => state.newTab)
  const reloadConfig = useApp((state) => state.reloadConfig)
  const [editing, setEditing] = useState<Profile | null>(null)
  const done = () => {
    setEditing(null)
    void reloadConfig()
  }
  if (editing) return <ProfileEditor value={editing} onDone={done} />
  return (
    <div className="profiles">
      <button className="primary" data-testid="new-profile" onClick={() => setEditing(emptyProfile())}>Novo perfil</button>
      {profiles.map((profile) => (
        <div className="profile-row" key={profile.id}>
          <span className="profile-icon" style={{ color: profile.color }}>{profile.icon}</span>
          <div>
            <strong>{profile.name}</strong>
            <div className="muted">{profile.command}{profile.builtin ? ' · detectado' : ''}</div>
          </div>
          <div className="spacer" />
          <button onClick={() => newTab(profile.id)}>Abrir</button>
          <button onClick={() => setEditing(profile.builtin ? { ...profile, id: '', builtin: false, name: `${profile.name} (cópia)` } : profile)}>
            {profile.builtin ? 'Duplicar' : 'Editar'}
          </button>
          {!profile.builtin && <button title="Remover" onClick={() => void api.deleteProfile(profile.id).then(reloadConfig)}><Icon name="trash" size={13} /></button>}
        </div>
      ))}
    </div>
  )
}

function KeybindingsSection({ query }: { query: string }) {
  const keybindings = useApp((state) => state.keybindings)
  const reloadConfig = useApp((state) => state.reloadConfig)
  const [recording, setRecording] = useState<string | null>(null)
  const save = (id: string, keys: string | null) => {
    const next = { ...keybindings }
    if (keys === null) delete next[id]
    else next[id] = keys
    void api.saveKeybindings(next).then(reloadConfig)
    setRecording(null)
  }
  const shown = actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="keybindings">
      {shown.map((action) => (
        <div className="setting-row" key={action.id}>
          <span>{action.label}</span>
          <div className="key-tools">
            <button
              className={recording === action.id ? 'recording' : ''}
              onClick={() => setRecording(action.id)}
              onKeyDown={(event) => {
                if (recording !== action.id) return
                event.preventDefault()
                event.stopPropagation()
                if (event.key === 'Escape') return setRecording(null)
                const keys = eventKeys(event.nativeEvent)
                if (keys) save(action.id, keys)
              }}
            >
              {recording === action.id ? 'Pressione as teclas…' : bindingFor(action, keybindings) ?? 'sem atalho'}
            </button>
            <button title="Remover atalho" onClick={() => save(action.id, 'none')}><Icon name="close" size={12} /></button>
            {keybindings[action.id] && <button title="Restaurar padrão" onClick={() => save(action.id, null)}><Icon name="redo" size={12} /></button>}
          </div>
        </div>
      ))}
    </div>
  )
}

function dominantColors(image: HTMLImageElement): { dominant: string; accent: string } {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 48
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0, 48, 48)
  const { data } = context.getImageData(0, 0, 48, 48)
  const buckets = new Map<number, { count: number; r: number; g: number; b: number; chroma: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, chroma: 0 }
    bucket.count++
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.chroma += Math.max(r, g, b) - Math.min(r, g, b)
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count)
  const hex = (x: (typeof ranked)[number]) => rgbToHex(x.r / x.count, x.g / x.count, x.b / x.count)
  const vivid = [...ranked].sort((a, b) => b.chroma / b.count * Math.log(b.count + 1) - a.chroma / a.count * Math.log(a.count + 1))[0]
  return { dominant: hex(ranked[0]), accent: hex(vivid) }
}

function ThemeCreator() {
  const reloadConfig = useApp((state) => state.reloadConfig)
  const setSetting = useApp((state) => state.setSetting)
  const [status, setStatus] = useState('')
  const create = async () => {
    const picked = await api.pickImage()
    if (!picked) return
    const image = new Image()
    image.src = picked.dataUrl
    await image.decode()
    const { dominant, accent } = dominantColors(image)
    const name = picked.path.split(/[\\/]/).pop()!.replace(/\.\w+$/, '')
    const id = `imagem-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    await api.saveTheme(themeFromColors(id, name, dominant, accent, picked.path))
    await reloadConfig()
    setSetting('appearance.theme', id)
    setStatus(`Tema "${name}" criado.`)
  }
  return (
    <div className="setting-row">
      <span>Criar tema a partir de uma imagem</span>
      <div><button onClick={() => void create()}>Escolher imagem</button> <span className="muted">{status}</span></div>
    </div>
  )
}

/** One `directory = #color` per line; a tab takes the color of the first prefix of its cwd. */
function DirectoryColors() {
  const colors = useApp((state) => state.settings.appearance.directoryTabColors)
  const setSetting = useApp((state) => state.setSetting)
  const [text, setText] = useState(() => Object.entries(colors).map(([dir, color]) => `${dir} = ${color}`).join('\n'))
  const save = () => {
    const parsed: Record<string, string> = {}
    for (const line of text.split('\n')) {
      const match = /^(.+?)\s*=\s*(#[0-9a-f]{6})\s*$/i.exec(line)
      if (match) parsed[match[1]] = match[2]
    }
    setSetting('appearance.directoryTabColors', parsed)
  }
  return (
    <div className="setting-row">
      <span>Cor de aba por diretório (caminho = #rrggbb)</span>
      <textarea aria-label="Cor de aba por diretório" rows={3} value={text} onChange={(event) => setText(event.target.value)} onBlur={save} />
    </div>
  )
}

function AgentSection() {
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  useEffect(() => void api.hasApiKey().then(setHasKey), [])
  return (
    <div className="setting-row">
      <span>Chave da API Anthropic {hasKey ? '(configurada)' : ''}</span>
      <div>
        <input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} />
        <button disabled={!key} onClick={() => void api.saveApiKey(key).then(() => { setKey(''); setHasKey(true) })}>Salvar</button>
      </div>
    </div>
  )
}

const SECTIONS = ['Aparência', 'Janela', 'Terminal', 'Input', 'Perfis', 'Atalhos', 'Privacidade', 'Hotkey', 'Agente']

export function SettingsOverlay({ onClose }: { onClose(): void }) {
  const [section, setSection] = useState('Aparência')
  const [query, setQuery] = useState('')
  const fields = useMemo(() => {
    const needle = query.toLowerCase()
    return settingFields.filter((field) => (needle ? field.label.toLowerCase().includes(needle) : field.section === section))
  }, [query, section])
  return (
    <div className="overlay" onMouseDown={onClose} onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <div className="settings" data-testid="settings" onMouseDown={(event) => event.stopPropagation()}>
        <nav>
          <input autoFocus placeholder="Buscar configuração" value={query} onChange={(event) => setQuery(event.target.value)} />
          {SECTIONS.map((name) => (
            <button key={name} className={!query && section === name ? 'on' : ''} onClick={() => { setSection(name); setQuery('') }}>{name}</button>
          ))}
          <div className="spacer" />
          <button onClick={() => void api.openConfigDir()}>Abrir ~/.wrapped</button>
        </nav>
        <div className="settings-body">
          <header><h2>{query ? 'Resultados' : section}</h2><button onClick={onClose} title="Fechar"><Icon name="close" /></button></header>
          {!query && section === 'Perfis' && <ProfilesSection />}
          {section === 'Atalhos' && <KeybindingsSection query={query} />}
          {fields.map((field) => (
            <div className="setting-row" key={field.path}>
              <span>{field.label}</span>
              <Field field={field} />
            </div>
          ))}
          {!query && section === 'Aparência' && <ThemeCreator />}
          {!query && section === 'Aparência' && <DirectoryColors />}
          {!query && section === 'Agente' && <AgentSection />}
        </div>
      </div>
    </div>
  )
}
