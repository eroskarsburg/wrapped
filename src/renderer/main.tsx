import '@xterm/xterm/css/xterm.css'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { themeTokens } from '../shared/themes'
import type { Theme } from '../shared/types'
import { installKeybindings } from './actions'
import { AgentPanel } from './features/Agent'
import { Overlays } from './features/Overlays'
import { Workspace } from './features/Panes'
import { HorizontalTabs, Rail, Sidebar } from './features/Sidebar'
import { api, onEvent } from './rpc'
import { sessions, useApp } from './state/store'
import './styles.css'
import { ensureConfiguredFont } from './webFonts'

function applyTheme(theme: Theme, opacity: number): void {
  const root = document.documentElement.style
  const alpha = Math.round((opacity / 100) * 255).toString(16).padStart(2, '0')
  for (const [name, value] of Object.entries(themeTokens(theme))) root.setProperty(name, value)
  root.setProperty('--bg-alpha', `${theme.background}${alpha}`)
  document.body.dataset.scheme = theme.details === 'darker' ? 'dark' : 'light'
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
    // Without a backdrop the main process fades the whole window instead.
    applyTheme(theme, settings.appearance.backdrop === 'none' ? 100 : settings.appearance.windowOpacity)
    const root = document.documentElement.style
    root.setProperty('--font-mono', settings.appearance.fontFamily)
    root.setProperty('--font-size', `${settings.appearance.fontSize}px`)
    root.setProperty('--line-height', String(settings.appearance.lineHeight))
    root.setProperty('--ligatures', settings.appearance.ligatures ? 'normal' : 'none')
    void api.setZoom(settings.appearance.zoom)
    for (const session of sessions.values()) session.applyAppearance(themeForPane(session.profile))
    let cancelled = false
    // A downloaded font arrives after the terminals measured their cells with the fallback.
    void ensureConfiguredFont(settings.appearance.fontFamily, settings.appearance.fontWeight).then((loaded) => {
      if (loaded && !cancelled) for (const session of sessions.values()) session.refreshFont(themeForPane(session.profile))
    }).catch(() => undefined)
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
  const settingsError = useApp((state) => state.settingsError)
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
      {settingsError && (
        <div className="config-error" role="alert" data-testid="settings-error">
          O settings.toml tem um erro e está sendo ignorado: {settingsError}. Ao salvar uma configuração aqui, o arquivo
          atual é guardado como settings.toml.broken-*.
        </div>
      )}
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
