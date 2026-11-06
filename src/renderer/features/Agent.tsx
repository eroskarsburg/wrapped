import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '../../shared/types'
import { api, onEvent } from '../rpc'
import { newId, sessions, useApp } from '../state/store'
import { Icon } from './icons'

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; output?: string; isError?: boolean; pending?: boolean }
  | { kind: 'error'; text: string }

function describeInput(input: unknown): string {
  const record = input as Record<string, unknown>
  return String(record.command ?? record.path ?? record.query ?? JSON.stringify(input))
}

export function AgentPanel() {
  const enabled = useApp((state) => state.settings.agent.enabled)
  const model = useApp((state) => state.settings.agent.model)
  const setSetting = useApp((state) => state.setSetting)
  const toggleAgent = useApp((state) => state.toggleAgent)
  const draft = useApp((state) => state.agentDraft)
  const [conversation, setConversation] = useState(() => newId('agent'))
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (draft) setText((current) => (current ? `${current}\n\n${draft.text}` : draft.text))
  }, [draft?.id])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [items])

  useEffect(() => {
    const offEvents = onEvent('agent', (id: string, event: AgentEvent) => {
      if (id !== conversation) return
      setThinking(event.type === 'thinking')
      setItems((current) => applyEvent(current, event))
      if (event.type === 'done' || event.type === 'error') setBusy(false)
    })
    const offRuns = onEvent('agent:run', (request: { conversationId: string; requestId: string; command: string; paneId?: string }) => {
      if (request.conversationId !== conversation) return
      const session = (request.paneId && sessions.get(request.paneId)) || useApp.getState().activeSession()
      if (!session) {
        void api.agentCommandResult(request.conversationId, request.requestId, 'Nenhum terminal disponível.')
        return
      }
      void session.runForAgent(request.command).then((output) => api.agentCommandResult(request.conversationId, request.requestId, output))
    })
    return () => {
      offEvents()
      offRuns()
    }
  }, [conversation])

  const send = () => {
    if (!text.trim() || busy) return
    const session = useApp.getState().activeSession()
    setItems((current) => [...current, { kind: 'user', text }])
    setBusy(true)
    void api.agentSend(conversation, text, { cwd: session?.cwd, shell: session?.kind, paneId: session?.id })
    setText('')
  }

  const reset = () => {
    void api.agentReset(conversation)
    setConversation(newId('agent'))
    setItems([])
    setBusy(false)
  }

  const respond = (id: string, allowed: boolean) => {
    void api.agentApprove(conversation, id, allowed)
    setItems((current) => current.map((item) => (item.kind === 'tool' && item.id === id ? { ...item, pending: false } : item)))
  }

  if (!enabled) {
    return (
      <aside className="agent" data-testid="agent-panel">
        <header><strong>Agente</strong><button onClick={() => toggleAgent(false)} title="Fechar"><Icon name="close" size={14} /></button></header>
        <div className="agent-off">
          <p>O Agent Mode está desligado.</p>
          <p className="muted">Ele usa a sua própria chave da API Anthropic e pede aprovação antes de executar comandos ou gravar arquivos.</p>
          <button className="primary" onClick={() => setSetting('agent.enabled', true)}>Ativar</button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="agent" data-testid="agent-panel">
      <header>
        <strong>Agente</strong>
        <span className="muted model">{model}</span>
        <button onClick={reset} title="Nova conversa"><Icon name="plus" size={14} /></button>
        <button onClick={() => toggleAgent(false)} title="Fechar"><Icon name="close" size={14} /></button>
      </header>
      <div className="agent-log" ref={scroller}>
        {items.map((item, index) => {
          if (item.kind === 'user') return <div key={index} className="msg user">{item.text}</div>
          if (item.kind === 'error') return <div key={index} className="msg error">{item.text}</div>
          if (item.kind === 'assistant') {
            return <div key={index} className="msg assistant" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(item.text, { async: false }) as string) }} />
          }
          return (
            <div key={item.id} className={item.isError ? 'tool-call failed' : 'tool-call'}>
              <div className="tool-name">{item.name}</div>
              <code>{describeInput(item.input)}</code>
              {item.pending && (
                <div className="approval">
                  <span>Permitir esta ação?</span>
                  <button className="primary" onClick={() => respond(item.id, true)}>Permitir</button>
                  <button onClick={() => respond(item.id, false)}>Recusar</button>
                </div>
              )}
              {item.output && <details><summary>Resultado</summary><pre>{item.output}</pre></details>}
            </div>
          )
        })}
        {busy && <div className="muted agent-status">{thinking ? 'Pensando…' : 'Trabalhando…'}</div>}
      </div>
      <div className="agent-input">
        <textarea
          rows={3} placeholder="Peça algo ao agente (Enter envia, Shift+Enter quebra linha)" value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        {busy
          ? <button onClick={() => void api.agentStop(conversation)}><Icon name="stop" size={14} /> Parar</button>
          : <button className="primary" disabled={!text.trim()} onClick={send}>Enviar</button>}
      </div>
    </aside>
  )
}

function applyEvent(items: Item[], event: AgentEvent): Item[] {
  switch (event.type) {
    case 'text': {
      const last = items.at(-1)
      if (last?.kind === 'assistant') return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
      return [...items, { kind: 'assistant', text: event.text }]
    }
    case 'tool':
      return [...items, { kind: 'tool', id: event.id, name: event.name, input: event.input }]
    case 'approval':
      return items.map((item) => (item.kind === 'tool' && item.id === event.id ? { ...item, pending: true } : item))
    case 'toolResult':
      return items.map((item) => (item.kind === 'tool' && item.id === event.id ? { ...item, output: event.output, isError: event.isError, pending: false } : item))
    case 'error':
      return [...items, { kind: 'error', text: event.message }]
    default:
      return items
  }
}
