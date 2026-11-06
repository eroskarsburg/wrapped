import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { templateParams, renderTemplate } from '../../shared/logic'
import type { PaneLeaf } from '../../shared/types'
import { api } from '../rpc'
import { useApp } from '../state/store'
import { Icon } from './icons'

function PaneHeader({ title, onClose, children }: { title: string; onClose(): void; children?: ReactNode }) {
  return (
    <div className="pane-header">
      <span className="pane-title" title={title}>{title.split(/[\\/]/).pop()}</span>
      <div className="pane-tools">
        {children}
        <button title="Fechar pane" onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
    </div>
  )
}

function useFile(path: string | undefined) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!path) return
    setError('')
    api.readText(path).then(setText).catch((e: Error) => setError(e.message))
  }, [path])
  return { text, error, setText }
}

export function EditorPane({ leaf, onClose }: { leaf: PaneLeaf; onClose(): void }) {
  const { text, error } = useFile(leaf.file)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [dirty, setDirty] = useState(false)
  const save = () => {
    if (!view.current || !leaf.file) return true
    void api.writeText(leaf.file, view.current.state.doc.toString()).then(() => setDirty(false))
    return true
  }
  useEffect(() => {
    if (text === null || !host.current) return
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(), cmHistory(),
          keymap.of([{ key: 'Mod-s', run: save }, ...defaultKeymap, ...historyKeymap]),
          /\.md$/i.test(leaf.file ?? '') ? markdown() : [],
          EditorView.updateListener.of((update) => update.docChanged && setDirty(true)),
        ],
      }),
    })
    view.current = editor
    return () => editor.destroy()
  }, [text])
  return (
    <div className="code-pane">
      <PaneHeader title={`${leaf.file ?? ''}${dirty ? ' •' : ''}`} onClose={onClose}>
        <button onClick={save} disabled={!dirty}>Salvar</button>
      </PaneHeader>
      {error ? <p className="pane-error">{error}</p> : <div className="code-host" ref={host} />}
    </div>
  )
}

const renderMarkdown = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false }) as string)

export function MarkdownPane({ leaf, onClose }: { leaf: PaneLeaf; onClose(): void }) {
  const { text, error } = useFile(leaf.file)
  const html = useMemo(() => renderMarkdown(text ?? ''), [text])
  return (
    <div className="code-pane">
      <PaneHeader title={leaf.file ?? ''} onClose={onClose} />
      {error ? <p className="pane-error">{error}</p> : <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}

function runInTerminal(command: string): void {
  const state = useApp.getState()
  const params = templateParams(command)
  const run = (values: Record<string, string>) => {
    const session = state.activeSession()
    const text = renderTemplate(command, values)
    if (session) state.submitToPanes(session, text)
    else state.newTab(undefined, undefined, [text])
  }
  if (params.length) {
    state.openOverlay({ kind: 'params', title: 'Parâmetros do comando', params: params.map((name) => ({ name })), onSubmit: run })
  } else {
    run({})
  }
}

/** Markdown document whose shell fences have a run button. */
export function NotebookPane({ leaf, onClose }: { leaf: PaneLeaf; onClose(): void }) {
  const { text, error, setText } = useFile(leaf.file)
  const [editing, setEditing] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(text ?? ''), [text])

  useEffect(() => {
    if (editing || !body.current) return
    for (const code of body.current.querySelectorAll<HTMLElement>('pre > code')) {
      if (!/language-(?:shell|bash|sh|powershell|pwsh|console)/.test(code.className)) continue
      const pre = code.parentElement!
      if (pre.querySelector('button')) continue
      const button = document.createElement('button')
      button.className = 'run-cell'
      button.textContent = '▶ Executar'
      button.onclick = () => runInTerminal(code.textContent ?? '')
      pre.prepend(button)
    }
  }, [html, editing])

  return (
    <div className="code-pane">
      <PaneHeader title={leaf.file ?? ''} onClose={onClose}>
        <button onClick={() => {
          if (editing && leaf.file) void api.writeText(leaf.file, text ?? '')
          setEditing(!editing)
        }}>{editing ? 'Ver' : 'Editar'}</button>
      </PaneHeader>
      {error && <p className="pane-error">{error}</p>}
      {editing
        ? <textarea className="notebook-editor" value={text ?? ''} onChange={(event) => setText(event.target.value)} />
        : <div className="markdown" ref={body} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
}

export function DiffPane({ leaf, onClose }: { leaf: PaneLeaf; onClose(): void }) {
  const [diff, setDiff] = useState('')
  const refresh = () => {
    if (leaf.cwd) void api.gitDiff(leaf.cwd, leaf.file).then(setDiff)
  }
  useEffect(refresh, [leaf.cwd, leaf.file])
  return (
    <div className="code-pane">
      <PaneHeader title={leaf.file ?? 'Alterações'} onClose={onClose}>
        <button onClick={refresh}>Atualizar</button>
      </PaneHeader>
      <div className="diff">
        {diff ? diff.split('\n').map((line, index) => (
          <div key={index} className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : ''}>{line || ' '}</div>
        )) : <p className="muted">Sem alterações.</p>}
      </div>
    </div>
  )
}
