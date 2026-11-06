import '@xterm/xterm/css/xterm.css'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { mix } from '../shared/themes'
import type { Theme } from '../shared/types'
import { installKeybindings } from './actions'
import { AgentPanel } from './features/Agent'
import { Overlays } from './features/Overlays'
import { Workspace } from './features/Panes'
import { HorizontalTabs, Rail, Sidebar } from './features/Sidebar'
import { api, onEvent } from './rpc'
import { sessions, useApp } from './state/store'
import './styles.css'

function applyTheme(theme: Theme, opacity: number): void {
  const root = document.documentElement.style
  const dark = theme.details === 'darker'
  const toward = dark ? '#ffffff' : '#000000'
  const alpha = Math.round((opacity / 100) * 255).toString(16).padStart(2, '0')
  root.setProperty('--bg', theme.background)
  root.setProperty('--bg-alpha', `${theme.background}${alpha}`)
  root.setProperty('--fg', theme.foreground)
  root.setProperty('--accent', theme.accent)
  root.setProperty('--surface', mix(theme.background, toward, 0.04))
  root.setProperty('--surface-2', mix(theme.background, toward, 0.08))
  root.setProperty('--border', mix(theme.background, toward, 0.13))
  root.setProperty('--muted', mix(theme.foreground, theme.background, 0.42))
  root.setProperty('--on-accent', dark ? '#071311' : '#ffffff')
  const colors = [...Object.values(theme.normal), ...Object.values(theme.bright)]
  colors.forEach((color, index) => root.setProperty(`--ansi-${index}`, color))
  document.body.dataset.scheme = dark ? 'dark' : 'light'
  const gradient = theme.gradient ? `linear-gradient(${theme.gradient.top}, ${theme.gradient.bottom})` : 'none'
  root.setProperty('--app-gradient', gradient)
}

function useAppearance(): void {
  const settings = useApp((state) => state.settings)
  const themes = useApp((state) => state.themes)
  const osDark = useApp((state) => state.osDark)
  const activeTheme = useApp((state) => state.activeTheme)
  const themeForPane = useApp((state) => state.themeForPane)

  useEffect(() => {
    const theme = activeTheme()
    applyTheme(theme, settings.appearance.windowOpacity)
    const root = document.documentElement.style
    root.setProperty('--font-mono', settings.appearance.fontFamily)
    root.setProperty('--font-size', `${settings.appearance.fontSize}px`)
    root.setProperty('--line-height', String(settings.appearance.lineHeight))
    root.setProperty('--ligatures', settings.appearance.ligatures ? 'normal' : 'none')
    void api.setZoom(settings.appearance.zoom)
    for (const session of sessions.values()) session.applyAppearance(themeForPane(session.profile))
    let cancelled = false
    if (theme.backgroundImage) {
      void api.readImage(theme.backgroundImage).then((url) => {
        if (cancelled || !url) return
        root.setProperty('--app-image', `url("${url}")`)
        root.setProperty('--app-image-opacity', String((theme.imageOpacity ?? 30) / 100))
      })
    } else {
      root.setProperty('--app-image', 'none')
    }
    return () => {
      cancelled = true
    }
  }, [settings.appearance, themes, osDark])
}

function App() {
  const loaded = useApp((state) => state.loaded)
  const load = useApp((state) => state.load)
  const reloadConfig = useApp((state) => state.reloadConfig)
  const vertical = useApp((state) => state.settings.appearance.verticalTabs)
  const agentOpen = useApp((state) => state.agentOpen)
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
  useAppearance()

  useEffect(() => {
    void load()
    const removeKeys = installKeybindings()
    const offConfig = onEvent('config-changed', () => void reloadConfig())
    const offOsTheme = onEvent('os-theme', (osDark: boolean) => useApp.setState({ osDark }))
    const persist = () => useApp.getState().persist()
    window.addEventListener('beforeunload', persist)
    return () => {
      removeKeys()
      offConfig()
      offOsTheme()
      window.removeEventListener('beforeunload', persist)
    }
  }, [])

  return (
    <div className="app">
      <div className="app-image" />
      <header className="titlebar">
        {vertical ? <span className="titlebar-name">{activeTab?.title ?? 'Wrapped'}</span> : <HorizontalTabs />}
      </header>
      <div className="app-body">
        <Rail />
        <Sidebar />
        {loaded && <Workspace />}
        {agentOpen && <AgentPanel />}
      </div>
      <Overlays />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
