import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter } from '../../shared/logic'
import { actions, bindingFor, envCommand, launchTabConfig, runPrompt, runWorkflow } from '../actions'
import { history, sessions, useApp, leaves, type ParamRequest } from '../state/store'
import { SettingsOverlay } from './Settings'

interface Entry {
  key: string
  type: string
  label: string
  hint?: string
  run(): void
}

function useEntries(): Entry[] {
  const state = useApp()
  return useMemo(() => {
    const entries: Entry[] = actions.map((action) => ({
      key: `action:${action.id}`, type: 'ação', label: action.label, hint: bindingFor(action, state.keybindings), run: action.run,
    }))
    for (const workflow of state.workflows) entries.push({ key: `wf:${workflow.name}`, type: 'workflow', label: workflow.name, hint: workflow.command, run: () => runWorkflow(workflow) })
    for (const notebook of state.notebooks) entries.push({ key: `nb:${notebook.file}`, type: 'notebook', label: notebook.title, run: () => state.splitPane('row', 'notebook', { file: notebook.file }) })
    for (const prompt of state.prompts) entries.push({ key: `pr:${prompt.name}`, type: 'prompt', label: prompt.name, run: () => runPrompt(prompt) })
    for (const collection of state.envCollections) {
      entries.push({
        key: `env:${collection.name}`, type: 'env', label: collection.name,
        run() {
          const session = state.activeSession()
          if (session) state.submitToPanes(session, envCommand(collection, session.kind))
        },
      })
    }
    for (const profile of state.profiles) entries.push({ key: `prof:${profile.id}`, type: 'perfil', label: `Novo terminal: ${profile.name}`, run: () => state.newTab(profile.id) })
    for (const { config, errors } of state.tabConfigs) {
      if (!errors.length) entries.push({ key: `cfg:${config.name}`, type: 'layout', label: config.name, run: () => launchTabConfig(config) })
    }
    for (const theme of state.themes) entries.push({ key: `theme:${theme.id}`, type: 'tema', label: `Tema: ${theme.name}`, run: () => state.setSetting('appearance.theme', theme.id) })
    for (const tab of state.tabs) {
      for (const leaf of leaves(tab.root)) {
        const session = sessions.get(leaf.id)
        entries.push({
          key: `sess:${leaf.id}`, type: 'sessão', label: tab.title, hint: session?.cwd,
          run() {
            state.selectTab(tab.id)
            state.focusPane(leaf.id)
          },
        })
      }
    }
    return entries
  }, [state.workflows, state.notebooks, state.prompts, state.envCollections, state.profiles, state.tabConfigs, state.themes, state.tabs, state.keybindings])
}

function ListOverlay({ placeholder, entries, onClose, testId }: { placeholder: string; entries: Entry[]; onClose(): void; testId: string }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const filtered = useMemo(() => fuzzyFilter(query, entries, (entry) => `${entry.label} ${entry.hint ?? ''}`).slice(0, 80), [query, entries])
  const run = (entry: Entry | undefined) => {
    if (!entry) return
    onClose()
    entry.run()
  }
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" data-testid={testId} onMouseDown={(event) => event.stopPropagation()}>
        <input
          autoFocus placeholder={placeholder} value={query}
          onChange={(event) => { setQuery(event.target.value); setIndex(0) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'Enter') run(filtered[index])
            if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(Math.min(filtered.length - 1, index + 1)) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(0, index - 1)) }
          }}
        />
        <div className="palette-list" ref={list}>
          {filtered.map((entry, i) => (
            <div key={entry.key} className={i === index ? 'palette-item selected' : 'palette-item'} onMouseEnter={() => setIndex(i)} onClick={() => run(entry)}>
              <span className="palette-type">{entry.type}</span>
              <span className="palette-label">{entry.label}</span>
              {entry.hint && <span className="palette-hint">{entry.hint}</span>}
            </div>
          ))}
          {filtered.length === 0 && <p className="muted palette-empty">Nada encontrado.</p>}
        </div>
      </div>
    </div>
  )
}

function CommandSearch({ onClose }: { onClose(): void }) {
  const fillInput = useApp((state) => state.fillInput)
  const entries = useMemo(() => {
    const seen = new Set<string>()
    const out: Entry[] = []
    for (let i = history.length - 1; i >= 0 && out.length < 3000; i--) {
      const { command, cwd } = history[i]
      if (seen.has(command)) continue
      seen.add(command)
      out.push({ key: `${i}`, type: 'hist', label: command, hint: cwd, run: () => fillInput(command) })
    }
    return out
  }, [fillInput])
  return <ListOverlay placeholder="Buscar no histórico" entries={entries} onClose={onClose} testId="command-search" />
}

function ParamField({ param, value, onChange, autoFocus }: { param: ParamRequest; value: string; onChange(value: string): void; autoFocus: boolean }) {
  const [options, setOptions] = useState(param.options ?? [])
  useEffect(() => {
    if (!param.dynamic) return
    const session = useApp.getState().activeSession()
    if (!session?.running && session?.ready) {
      void session.runForAgent(param.dynamic).then((output) => {
        setOptions(output.split('\n').slice(1).map((line) => line.trim()).filter(Boolean))
      })
    }
  }, [param.dynamic])
  const list = `options-${param.name}`
  return (
    <label className="param">
      <span>{param.name}</span>
      {param.description && <small className="muted">{param.description}</small>}
      <input autoFocus={autoFocus} list={list} value={value} onChange={(event) => onChange(event.target.value)} />
      <datalist id={list}>{options.map((option) => <option key={option} value={option} />)}</datalist>
    </label>
  )
}

function ParamDialog({ title, params, onSubmit, onClose }: { title: string; params: ParamRequest[]; onSubmit(values: Record<string, string>): void; onClose(): void }) {
  const [values, setValues] = useState(() => Object.fromEntries(params.map((param) => [param.name, param.default ?? ''])))
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog" data-testid="param-dialog" onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
        onSubmit={(event) => {
          event.preventDefault()
          onClose()
          onSubmit(values)
        }}
      >
        <h2>{title}</h2>
        {params.map((param, index) => (
          <ParamField
            key={param.name} param={param} value={values[param.name]} autoFocus={index === 0}
            onChange={(value) => setValues({ ...values, [param.name]: value })}
          />
        ))}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary">Continuar</button>
        </div>
      </form>
    </div>
  )
}

function Palette({ onClose }: { onClose(): void }) {
  const entries = useEntries()
  return <ListOverlay placeholder="Digite um comando, workflow, tema ou sessão" entries={entries} onClose={onClose} testId="palette" />
}

export function Overlays() {
  const overlay = useApp((state) => state.overlay)
  const openOverlay = useApp((state) => state.openOverlay)
  const close = () => openOverlay(null)
  if (!overlay) return null
  if (overlay.kind === 'palette') return <Palette onClose={close} />
  if (overlay.kind === 'commandSearch') return <CommandSearch onClose={close} />
  if (overlay.kind === 'settings') return <SettingsOverlay onClose={close} />
  return <ParamDialog title={overlay.title} params={overlay.params} onSubmit={overlay.onSubmit} onClose={close} />
}

