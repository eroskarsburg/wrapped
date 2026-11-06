import { useEffect, useState, useSyncExternalStore } from 'react'
import type { EnvCollection, FileEntry, GitStatusEntry, KnowledgeKind, SavedPrompt, SearchHit, Workflow } from '../../shared/types'
import { envCommand, launchTabConfig, runPrompt, runWorkflow } from '../actions'
import { api } from '../rpc'
import { leaves, sessions, useApp, type SidebarView } from '../state/store'
import { Icon, type IconName } from './icons'

const TAB_COLORS = ['#f0717b', '#e5c07b', '#7fd88f', '#56d4dd', '#6fa8ff', '#c792ea']

export function Rail() {
  const sidebar = useApp((state) => state.sidebar)
  const setSidebar = useApp((state) => state.setSidebar)
  const toggleAgent = useApp((state) => state.toggleAgent)
  const agentOpen = useApp((state) => state.agentOpen)
  const openOverlay = useApp((state) => state.openOverlay)
  const views: [SidebarView, IconName, string][] = [
    ['tabs', 'tabs', 'Abas'], ['drive', 'drive', 'Drive'], ['files', 'files', 'Arquivos'], ['search', 'search', 'Busca'], ['git', 'git', 'Git'],
  ]
  return (
    <nav className="rail" aria-label="Painéis">
      {views.map(([view, icon, label]) => (
        <button key={view} title={label} data-view={view} className={sidebar === view ? 'on' : ''} onClick={() => setSidebar(view)}>
          <Icon name={icon} size={18} />
        </button>
      ))}
      <div className="rail-space" />
      <button title="Agente" className={agentOpen ? 'on' : ''} onClick={() => toggleAgent()}><Icon name="agent" size={18} /></button>
      <button title="Configurações" onClick={() => openOverlay({ kind: 'settings' })}><Icon name="settings" size={18} /></button>
    </nav>
  )
}

function TabsPanel() {
  const tabs = useApp((state) => state.tabs)
  const activeTabId = useApp((state) => state.activeTabId)
  const selectTab = useApp((state) => state.selectTab)
  const closeTab = useApp((state) => state.closeTab)
  const updateTab = useApp((state) => state.updateTab)
  const moveTab = useApp((state) => state.moveTab)
  const profiles = useApp((state) => state.profiles)
  const newTab = useApp((state) => state.newTab)
  const tabConfigs = useApp((state) => state.tabConfigs)
  useApp((state) => state.sessionTick)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [colorFor, setColorFor] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  return (
    <div className="panel">
      <div className="panel-title">
        <span>Abas</span>
        <button title="Nova aba" data-testid="new-tab-menu" onClick={() => setMenu(!menu)}><Icon name="plus" size={14} /></button>
      </div>
      {menu && (
        <div className="new-menu" onClick={() => setMenu(false)}>
          {profiles.map((profile) => (
            <button key={profile.id} onClick={() => newTab(profile.id)}>
              <span style={{ color: profile.color }}>{profile.icon}</span> {profile.name}
            </button>
          ))}
          {tabConfigs.length > 0 && <div className="menu-label">Layouts</div>}
          {tabConfigs.map(({ config, errors }) => (
            <button key={config.name} disabled={errors.length > 0} title={errors.join('; ')} onClick={() => launchTabConfig(config)}>
              {config.name}
            </button>
          ))}
        </div>
      )}
      <div className="tab-list">
        {tabs.map((tab, index) => {
          const panes = leaves(tab.root)
          const running = panes.some((leaf) => sessions.get(leaf.id)?.running)
          return (
            <div
              key={tab.id} className={tab.id === activeTabId ? 'tab-row active' : 'tab-row'} draggable
              data-testid="tab-row"
              onDragStart={() => setDragging(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragging !== null && dragging !== index) moveTab(dragging, index)
                setDragging(null)
              }}
              onClick={() => selectTab(tab.id)}
              onDoubleClick={() => setRenaming(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                setColorFor(colorFor === tab.id ? null : tab.id)
              }}
            >
              <span className="tab-color" style={{ background: tab.color ?? 'var(--border)' }} />
              {renaming === tab.id ? (
                <input
                  autoFocus defaultValue={tab.title}
                  onBlur={(event) => {
                    updateTab(tab.id, { title: event.target.value, customTitle: true })
                    setRenaming(null)
                  }}
                  onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                />
              ) : <span className="tab-title">{tab.title}</span>}
              {running && <span className="tab-running" title="Comando em execução" />}
              {tab.synced && <span className="tab-sync" title="Input sincronizado"><Icon name="sync" size={12} /></span>}
              {panes.length > 1 && <span className="muted tab-count">{panes.length}</span>}
              <button title="Fechar aba" onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }}><Icon name="close" size={12} /></button>
              {colorFor === tab.id && (
                <div className="color-picker" onClick={(event) => event.stopPropagation()}>
                  {TAB_COLORS.map((color) => (
                    <button key={color} style={{ background: color }} aria-label={color} onClick={() => { updateTab(tab.id, { color }); setColorFor(null) }} />
                  ))}
                  <button aria-label="Sem cor" onClick={() => { updateTab(tab.id, { color: undefined }); setColorFor(null) }}>×</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function HorizontalTabs() {
  const tabs = useApp((state) => state.tabs)
  const activeTabId = useApp((state) => state.activeTabId)
  const selectTab = useApp((state) => state.selectTab)
  const closeTab = useApp((state) => state.closeTab)
  const newTab = useApp((state) => state.newTab)
  return (
    <div className="h-tabs">
      {tabs.map((tab) => (
        <div key={tab.id} className={tab.id === activeTabId ? 'h-tab active' : 'h-tab'} onClick={() => selectTab(tab.id)}>
          <span className="tab-color" style={{ background: tab.color ?? 'var(--border)' }} />
          <span className="tab-title">{tab.title}</span>
          <button onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }}><Icon name="close" size={12} /></button>
        </div>
      ))}
      <button title="Nova aba" onClick={() => newTab()}><Icon name="plus" size={14} /></button>
    </div>
  )
}

function emptyWorkflow(): Workflow {
  return { name: '', command: '', description: '' }
}

function WorkflowForm({ value, onDone }: { value: Workflow; onDone(): void }) {
  const [draft, setDraft] = useState(value)
  return (
    <form className="inline-form" onSubmit={(event) => {
      event.preventDefault()
      void api.saveKnowledge('workflows', draft).then(onDone)
    }}>
      <input required placeholder="Nome" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <textarea required placeholder="Comando, com {{argumentos}}" rows={3} value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
      <input placeholder="Descrição" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      <div className="form-actions">
        <button type="button" onClick={onDone}>Cancelar</button>
        <button type="submit" className="primary">Salvar</button>
      </div>
    </form>
  )
}

function DrivePanel() {
  const workflows = useApp((state) => state.workflows)
  const prompts = useApp((state) => state.prompts)
  const envCollections = useApp((state) => state.envCollections)
  const notebooks = useApp((state) => state.notebooks)
  const splitPane = useApp((state) => state.splitPane)
  const reloadConfig = useApp((state) => state.reloadConfig)
  const activeSession = useApp((state) => state.activeSession)
  const submitToPanes = useApp((state) => state.submitToPanes)
  const [editing, setEditing] = useState<Workflow | null>(null)
  const [query, setQuery] = useState('')
  const matches = (name: string, extra = '') => `${name} ${extra}`.toLowerCase().includes(query.toLowerCase())

  const importKind = (kind: KnowledgeKind | 'notebooks') => void api.importFile(kind).then(reloadConfig)
  const remove = (file?: string) => file && void api.deleteConfigFile(file).then(reloadConfig)

  const newPrompt = () => {
    const name = prompt('Nome do prompt')
    if (name) void api.saveKnowledge('prompts', { name, prompt: 'Descreva o que o agente deve fazer com {{alvo}}' } as SavedPrompt).then(reloadConfig)
  }
  const newEnv = () => {
    const name = prompt('Nome da coleção')
    if (name) void api.saveKnowledge('env', { name, variables: { EXEMPLO: 'valor' } } as EnvCollection).then(reloadConfig)
  }
  const newNotebook = () => {
    const title = prompt('Título do notebook')
    if (title) void api.createNotebook(title).then((file) => { void reloadConfig(); splitPane('row', 'notebook', { file }) })
  }
  const loadEnv = (collection: EnvCollection) => {
    const session = activeSession()
    if (session) submitToPanes(session, envCommand(collection, session.kind))
  }

  return (
    <div className="panel drive">
      <div className="panel-title"><span>Drive</span></div>
      <input className="panel-search" placeholder="Buscar" value={query} onChange={(event) => setQuery(event.target.value)} />
      <section>
        <header><span>Workflows</span><button title="Novo" onClick={() => setEditing(emptyWorkflow())}><Icon name="plus" size={13} /></button><button title="Importar YAML" onClick={() => importKind('workflows')}><Icon name="share" size={13} /></button></header>
        {editing && <WorkflowForm value={editing} onDone={() => { setEditing(null); void reloadConfig() }} />}
        {workflows.filter((w) => matches(w.name, `${w.command} ${w.tags?.join(' ') ?? ''}`)).map((workflow) => (
          <div className="drive-item" key={workflow.file ?? workflow.name} onClick={() => runWorkflow(workflow)} title={workflow.description ?? workflow.command}>
            <span className="drive-name">{workflow.name}</span>
            <code>{workflow.command}</code>
            <div className="item-tools" onClick={(event) => event.stopPropagation()}>
              <button title="Executar" onClick={() => runWorkflow(workflow, 'run')}><Icon name="play" size={12} /></button>
              <button title="Editar" onClick={() => setEditing(workflow)}><Icon name="file" size={12} /></button>
              <button title="Remover" onClick={() => remove(workflow.file)}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        ))}
      </section>
      <section>
        <header><span>Notebooks</span><button title="Novo" onClick={newNotebook}><Icon name="plus" size={13} /></button><button title="Importar Markdown" onClick={() => importKind('notebooks')}><Icon name="share" size={13} /></button></header>
        {notebooks.filter((n) => matches(n.title)).map((notebook) => (
          <div className="drive-item" key={notebook.file} onClick={() => splitPane('row', 'notebook', { file: notebook.file })}>
            <span className="drive-name">{notebook.title}</span>
            <div className="item-tools" onClick={(event) => event.stopPropagation()}>
              <button title="Remover" onClick={() => remove(notebook.file)}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        ))}
      </section>
      <section>
        <header><span>Prompts</span><button title="Novo" onClick={newPrompt}><Icon name="plus" size={13} /></button></header>
        {prompts.filter((p) => matches(p.name, p.prompt)).map((item) => (
          <div className="drive-item" key={item.file ?? item.name} onClick={() => runPrompt(item)} title={item.prompt}>
            <span className="drive-name">{item.name}</span>
            <div className="item-tools" onClick={(event) => event.stopPropagation()}>
              <button title="Remover" onClick={() => remove(item.file)}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        ))}
      </section>
      <section>
        <header><span>Variáveis de ambiente</span><button title="Nova coleção" onClick={newEnv}><Icon name="plus" size={13} /></button></header>
        {envCollections.filter((e) => matches(e.name)).map((collection) => (
          <div className="drive-item" key={collection.file ?? collection.name} onClick={() => loadEnv(collection)} title="Carregar na sessão">
            <span className="drive-name">{collection.name}</span>
            <span className="muted">{Object.keys(collection.variables ?? {}).length} variáveis</span>
            <div className="item-tools" onClick={(event) => event.stopPropagation()}>
              <button title="Exportar .env" onClick={() => void api.exportEnv(collection)}><Icon name="share" size={12} /></button>
              <button title="Remover" onClick={() => remove(collection.file)}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

const noSubscription = () => () => undefined

function useCwd(): string | undefined {
  const session = useApp((state) => state.activeSession())
  return useSyncExternalStore(session?.subscribe ?? noSubscription, () => session?.cwd)
}

function FileNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const openFile = useApp((state) => state.openFile)
  const toggle = () => {
    if (!entry.dir) {
      openFile(entry.path)
      return
    }
    if (!children) void api.listDir(entry.path).then(setChildren).catch(() => setChildren([]))
    setOpen(!open)
  }
  return (
    <>
      <div className="file-row" style={{ paddingLeft: 8 + depth * 12 }} onClick={toggle}>
        <Icon name={entry.dir ? 'folder' : 'file'} size={13} /> <span>{entry.name}</span>
      </div>
      {open && children?.map((child) => <FileNode key={child.path} entry={child} depth={depth + 1} />)}
    </>
  )
}

function FilesPanel() {
  const cwd = useCwd()
  const [entries, setEntries] = useState<FileEntry[]>([])
  useEffect(() => {
    if (cwd) void api.listDir(cwd).then(setEntries).catch(() => setEntries([]))
  }, [cwd])
  return (
    <div className="panel">
      <div className="panel-title"><span>Arquivos</span></div>
      <div className="muted panel-path">{cwd}</div>
      <div className="file-tree">{entries.map((entry) => <FileNode key={entry.path} entry={entry} depth={0} />)}</div>
    </div>
  )
}

function SearchPanel() {
  const cwd = useCwd()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const openFile = useApp((state) => state.openFile)
  useEffect(() => {
    if (!cwd || !query) {
      setHits([])
      return
    }
    const timer = setTimeout(() => void api.searchFiles(cwd, query).then(setHits), 250)
    return () => clearTimeout(timer)
  }, [cwd, query])
  return (
    <div className="panel">
      <div className="panel-title"><span>Busca</span></div>
      <input className="panel-search" placeholder="Buscar nos arquivos" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="search-hits">
        {hits.map((hit) => (
          <div className="search-hit" key={`${hit.path}:${hit.line}`} onClick={() => openFile(hit.path)}>
            <div className="muted">{hit.path.slice((cwd?.length ?? 0) + 1)}:{hit.line}</div>
            <code>{hit.text}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

function GitPanel() {
  const cwd = useCwd()
  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const splitPane = useApp((state) => state.splitPane)
  const refresh = () => {
    if (cwd) void api.gitStatus(cwd).then(setEntries)
  }
  useEffect(refresh, [cwd])
  return (
    <div className="panel">
      <div className="panel-title">
        <span>Alterações</span>
        <button title="Atualizar" onClick={refresh}><Icon name="redo" size={13} /></button>
      </div>
      {entries.length === 0 && <p className="muted panel-path">Nada a revisar.</p>}
      <div className="file-tree">
        {entries.map((entry) => (
          <div className="file-row" key={entry.path} onClick={() => splitPane('row', 'diff', { file: entry.path, cwd })}>
            <span className="git-status">{entry.status}</span> <span>{entry.path}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Sidebar() {
  const sidebar = useApp((state) => state.sidebar)
  const vertical = useApp((state) => state.settings.appearance.verticalTabs)
  if (!sidebar || (sidebar === 'tabs' && !vertical)) return null
  return (
    <aside className="sidebar">
      {sidebar === 'tabs' && <TabsPanel />}
      {sidebar === 'drive' && <DrivePanel />}
      {sidebar === 'files' && <FilesPanel />}
      {sidebar === 'search' && <SearchPanel />}
      {sidebar === 'git' && <GitPanel />}
    </aside>
  )
}
