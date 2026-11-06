import { closeBrackets } from '@codemirror/autocomplete'
import { defaultKeymap, history as cmHistory, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import { useEffect, useRef, useState } from 'react'
import { looksLikeNaturalLanguage, tokenize } from '../../shared/logic'
import type { Completion } from '../../shared/types'
import { api } from '../rpc'
import { history, knownCommands, useApp } from '../state/store'
import type { PaneSession } from '../terminal/PaneSession'
import { PromptChips } from './PromptChips'

// --- Ghost text -----------------------------------------------------------------------------

const setGhost = StateEffect.define<string>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: GhostWidget) {
    return other.text === this.text
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'ghost'
    span.textContent = this.text
    return span
  }
}

const ghostField = StateField.define<string>({
  create: () => '',
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setGhost)) return effect.value
    return transaction.docChanged ? '' : value
  },
  provide: (field) =>
    EditorView.decorations.compute([field, 'doc'], (state) => {
      const text = state.field(field)
      if (!text) return Decoration.none
      return Decoration.set([Decoration.widget({ widget: new GhostWidget(text), side: 1 }).range(state.doc.length)])
    }),
})

function suggestFromHistory(prefix: string, cwd: string | undefined): string {
  if (!prefix.trim()) return ''
  let fallback = ''
  for (let i = history.length - 1; i >= 0; i--) {
    const { command, cwd: entryCwd } = history[i]
    if (command.length > prefix.length && command.startsWith(prefix)) {
      if (entryCwd === cwd) return command.slice(prefix.length)
      fallback ||= command.slice(prefix.length)
    }
  }
  return fallback
}

// --- Highlighting ---------------------------------------------------------------------------

function isKnownCommand(word: string, aliases: Record<string, string> | undefined): boolean {
  if (word.includes('/') || word.includes('\\') || word.startsWith('.') || word.startsWith('$') || word.startsWith('&')) return true
  const bare = word.replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
  return knownCommands.has(bare) || knownCommands.has(bare.toLowerCase()) || !!aliases?.[bare]
}

function highlighter(session: PaneSession) {
  const build = (view: EditorView): DecorationSet => {
    const { input } = useApp.getState().settings
    const builder = new RangeSetBuilder<Decoration>()
    if (!input.syntaxHighlighting && !input.errorUnderline) return builder.finish()
    let offset = 0
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const line = view.state.doc.line(n)
      for (const token of tokenize(line.text)) {
        const unknown = token.type === 'command' && input.errorUnderline && knownCommands.size > 0 && !isKnownCommand(token.text, session.meta.aliases)
        const classes = [input.syntaxHighlighting && `tok-${token.type}`, unknown && 'tok-error'].filter(Boolean).join(' ')
        if (classes) builder.add(offset + token.from, offset + token.to, Decoration.mark({ class: classes }))
      }
      offset += line.length + 1
    }
    return builder.finish()
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = build(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

const inspector = hoverTooltip(async (view, position) => {
  if (!useApp.getState().settings.input.commandInspector) return null
  const line = view.state.doc.lineAt(position)
  const info = await api.describeToken(line.text, position - line.from)
  if (!info?.description) return null
  return {
    pos: line.from + info.from,
    end: line.from + info.to,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'inspector'
      const title = document.createElement('strong')
      title.textContent = info.name
      const body = document.createElement('p')
      body.textContent = info.description ?? ''
      dom.append(title, body)
      return { dom }
    },
  }
})

// --- Component ------------------------------------------------------------------------------

interface Popup {
  from: number
  items: Completion[]
  index: number
}

export function InputEditor({ session, active, disabled }: { session: PaneSession; active: boolean; disabled: boolean }) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const [popup, setPopupState] = useState<Popup | null>(null)
  const [agentHint, setAgentHint] = useState(false)
  const historyCursor = useRef<number | null>(null)
  const draft = useRef('')
  const requestId = useRef(0)
  const vimCompartment = useRef(new Compartment())
  const bracketCompartment = useRef(new Compartment())
  const vimEnabled = useApp((state) => state.settings.input.vim)
  const brackets = useApp((state) => state.settings.input.closeBrackets)
  const inputDraft = useApp((state) => state.inputDraft)
  const agentEnabled = useApp((state) => state.settings.agent.enabled)

  const setPopup = (value: Popup | null) => {
    popupRef.current = value
    setPopupState(value)
  }

  const setText = (text: string) => {
    const editor = view.current
    if (!editor) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, selection: { anchor: text.length } })
  }

  const openCompletions = async (typing: boolean) => {
    const editor = view.current
    if (!editor) return
    const id = ++requestId.current
    const position = editor.state.selection.main.head
    const line = editor.state.doc.lineAt(position)
    const result = await api.completions(line.text, position - line.from, session.cwd)
    if (id !== requestId.current || !view.current) return
    if (!result.items.length) {
      setPopup(null)
      return
    }
    const from = line.from + result.from
    if (!typing && result.items.length === 1) {
      accept({ from, items: result.items, index: 0 })
      return
    }
    setPopup({ from, items: result.items, index: 0 })
  }

  const accept = (state: Popup) => {
    const editor = view.current
    const item = state.items[state.index]
    if (!editor || !item) return
    const insert = item.insert ?? item.label
    const suffix = item.kind === 'folder' ? '' : ' '
    editor.dispatch({
      changes: { from: state.from, to: editor.state.selection.main.head, insert: insert + suffix },
      selection: { anchor: state.from + insert.length + suffix.length },
    })
    setPopup(null)
  }

  const submit = () => {
    const editor = view.current
    if (!editor) return
    const command = editor.state.doc.toString()
    if (!command.trim() || !session.ready) return
    setText('')
    setPopup(null)
    historyCursor.current = null
    useApp.getState().submitToPanes(session, command)
  }

  const walkHistory = (delta: number): boolean => {
    const editor = view.current
    if (!editor) return false
    const onEdge = delta < 0
      ? editor.state.doc.lineAt(editor.state.selection.main.head).number === 1
      : editor.state.doc.lineAt(editor.state.selection.main.head).number === editor.state.doc.lines
    if (!onEdge) return false
    if (historyCursor.current === null) {
      if (delta > 0) return false
      draft.current = editor.state.doc.toString()
      historyCursor.current = history.length
    }
    const next = historyCursor.current + delta
    if (next >= history.length) {
      historyCursor.current = null
      setText(draft.current)
      return true
    }
    if (next < 0) return true
    historyCursor.current = next
    setText(history[next].command)
    return true
  }

  const expandAlias = (editor: EditorView): boolean => {
    if (!useApp.getState().settings.input.aliasExpansion) return false
    const text = editor.state.doc.toString()
    const position = editor.state.selection.main.head
    const first = tokenize(text)[0]
    if (!first || first.type !== 'command' || position !== first.to) return false
    const expansion = session.meta.aliases?.[first.text]
    if (!expansion || expansion === first.text) return false
    editor.dispatch({ changes: { from: first.from, to: first.to, insert: `${expansion} ` }, selection: { anchor: first.from + expansion.length + 1 } })
    return true
  }

  useEffect(() => {
    const settings = useApp.getState().settings.input
    const keys = Prec.highest(keymap.of([
      {
        key: 'Enter',
        run() {
          const current = popupRef.current
          if (current) accept(current)
          else submit()
          return true
        },
      },
      {
        key: 'Mod-Enter',
        run(editor) {
          const text = editor.state.doc.toString()
          if (!text.trim() || !useApp.getState().settings.agent.enabled) return false
          useApp.getState().sendToAgent(text)
          setText('')
          return true
        },
      },
      { key: 'Shift-Enter', run: (editor) => { editor.dispatch(editor.state.replaceSelection('\n')); return true } },
      {
        key: 'Tab',
        run() {
          const current = popupRef.current
          if (current) accept(current)
          else void openCompletions(false)
          return true
        },
      },
      { key: 'Ctrl-Space', run: () => { void openCompletions(true); return true } },
      {
        key: 'Escape',
        run() {
          if (popupRef.current) {
            setPopup(null)
            return true
          }
          return false
        },
      },
      {
        key: 'ArrowUp',
        run() {
          const current = popupRef.current
          if (current) {
            setPopup({ ...current, index: (current.index - 1 + current.items.length) % current.items.length })
            return true
          }
          return walkHistory(-1)
        },
      },
      {
        key: 'ArrowDown',
        run() {
          const current = popupRef.current
          if (current) {
            setPopup({ ...current, index: (current.index + 1) % current.items.length })
            return true
          }
          return walkHistory(1)
        },
      },
      {
        key: 'ArrowRight',
        run(editor) {
          const ghost = editor.state.field(ghostField)
          if (!ghost || editor.state.selection.main.head !== editor.state.doc.length) return false
          const end = editor.state.doc.length
          editor.dispatch({ changes: { from: end, insert: ghost }, selection: { anchor: end + ghost.length } })
          return true
        },
      },
      {
        key: 'Alt-ArrowRight',
        run(editor) {
          const ghost = editor.state.field(ghostField)
          if (!ghost) return false
          const word = /^\s*\S+/.exec(ghost)?.[0] ?? ghost
          const end = editor.state.doc.length
          editor.dispatch({ changes: { from: end, insert: word }, selection: { anchor: end + word.length } })
          return true
        },
      },
      { key: 'Space', run: expandAlias },
    ]))

    const listener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      const text = update.state.doc.toString()
      const { input, agent } = useApp.getState().settings
      const ghost = input.autosuggestions ? suggestFromHistory(text, session.cwd) : ''
      if (ghost) queueMicrotask(() => view.current?.dispatch({ effects: setGhost.of(ghost) }))
      setAgentHint(agent.enabled && agent.naturalLanguageDetection && looksLikeNaturalLanguage(text, (word) => isKnownCommand(word, session.meta.aliases)))
      if (popupRef.current || input.completionsWhileTyping) {
        if (text.trim()) void openCompletions(true)
        else setPopup(null)
      }
    })

    const editor = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        extensions: [
          keys,
          vimCompartment.current.of(settings.vim ? vim() : []),
          bracketCompartment.current.of(settings.closeBrackets ? closeBrackets() : []),
          cmHistory(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          ghostField,
          highlighter(session),
          inspector,
          listener,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Input do terminal', 'data-testid': 'input' }),
        ],
      }),
    })
    view.current = editor
    if (active) editor.focus()
    return () => {
      editor.destroy()
      view.current = null
    }
  }, [session])

  useEffect(() => {
    if (active) view.current?.focus()
  }, [active])

  useEffect(() => {
    view.current?.dispatch({ effects: vimCompartment.current.reconfigure(vimEnabled ? vim() : []) })
  }, [vimEnabled])

  useEffect(() => {
    view.current?.dispatch({ effects: bracketCompartment.current.reconfigure(brackets ? closeBrackets() : []) })
  }, [brackets])

  useEffect(() => {
    if (!inputDraft || inputDraft.paneId !== session.id) return
    setText(inputDraft.text)
    view.current?.focus()
  }, [inputDraft?.id])

  return (
    <div className={disabled ? 'input-editor waiting' : 'input-editor'} data-testid="input-editor">
      <PromptChips session={session} />
      {popup && (
        <div className="completions">
          {popup.items.slice(0, 40).map((item, index) => (
            <div
              key={`${item.kind}-${item.label}`}
              className={index === popup.index ? 'completion selected' : 'completion'}
              onMouseDown={(event) => {
                event.preventDefault()
                accept({ ...popup, index })
              }}
            >
              <span className={`completion-kind kind-${item.kind}`}>{kindLabel[item.kind]}</span>
              <span className="completion-label">{item.label}</span>
              {item.description && <span className="completion-description">{item.description}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="editor-host" ref={parent} />
      {agentHint && agentEnabled && <div className="agent-hint">Parece linguagem natural. <kbd>Ctrl+Enter</kbd> envia ao agente.</div>}
    </div>
  )
}

const kindLabel: Record<Completion['kind'], string> = {
  subcommand: 'sub', option: 'opt', arg: 'arg', file: 'arq', folder: 'dir', history: 'hist', command: 'cmd',
}
