import { Fragment, useRef } from 'react'
import type { PaneNode, TabState } from '../../shared/types'
import { useApp } from '../state/store'
import { DiffPane, EditorPane, MarkdownPane, NotebookPane } from './CodePanes'
import { TerminalPane } from './TerminalPane'

function Splitter({ tab, node, index }: { tab: TabState; node: Extract<PaneNode, { type: 'split' }>; index: number }) {
  const resizeSplit = useApp((state) => state.resizeSplit)
  const ref = useRef<HTMLDivElement>(null)
  const startDrag = (event: React.MouseEvent) => {
    event.preventDefault()
    const parent = ref.current?.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const horizontal = node.direction === 'row'
    const total = horizontal ? rect.width : rect.height
    const start = horizontal ? event.clientX : event.clientY
    const initial = [...node.sizes]
    const move = (moveEvent: MouseEvent) => {
      const delta = ((horizontal ? moveEvent.clientX : moveEvent.clientY) - start) / total
      const pair = initial[index] + initial[index + 1]
      const first = Math.min(pair - 0.08, Math.max(0.08, initial[index] + delta))
      const sizes = [...initial]
      sizes[index] = first
      sizes[index + 1] = pair - first
      resizeSplit(tab.id, node.id, sizes)
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }
  return <div ref={ref} className={`splitter ${node.direction}`} onMouseDown={startDrag} />
}

function PaneTree({ node, tab, visible }: { node: PaneNode; tab: TabState; visible: boolean }) {
  const dim = useApp((state) => state.settings.appearance.dimInactivePanes)
  const closePane = useApp((state) => state.closePane)
  const focusPane = useApp((state) => state.focusPane)
  if (node.type === 'split') {
    return (
      <div className={`split ${node.direction}`}>
        {node.children.map((child, index) => (
          <Fragment key={child.id}>
            <div className="split-child" style={{ flexGrow: node.sizes[index], flexBasis: 0 }}>
              <PaneTree node={child} tab={tab} visible={visible} />
            </div>
            {index < node.children.length - 1 && <Splitter tab={tab} node={node} index={index} />}
          </Fragment>
        ))}
      </div>
    )
  }
  const active = tab.activePaneId === node.id
  const multiple = tab.root.type === 'split'
  return (
    <div className={['pane', active && 'active', dim && multiple && !active && 'dimmed', multiple && 'bordered'].filter(Boolean).join(' ')} onMouseDown={() => focusPane(node.id)}>
      {node.kind === 'terminal' && <TerminalPane leaf={node} active={active} visible={visible} />}
      {node.kind === 'editor' && <EditorPane leaf={node} onClose={() => closePane(node.id)} />}
      {node.kind === 'markdown' && <MarkdownPane leaf={node} onClose={() => closePane(node.id)} />}
      {node.kind === 'notebook' && <NotebookPane leaf={node} onClose={() => closePane(node.id)} />}
      {node.kind === 'diff' && <DiffPane leaf={node} onClose={() => closePane(node.id)} />}
    </div>
  )
}

export function Workspace() {
  const tabs = useApp((state) => state.tabs)
  const activeTabId = useApp((state) => state.activeTabId)
  return (
    <div className="workspace">
      {tabs.map((tab) => (
        <div key={tab.id} className="tab-page" style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}>
          <PaneTree node={tab.root} tab={tab} visible={tab.id === activeTabId} />
        </div>
      ))}
    </div>
  )
}
