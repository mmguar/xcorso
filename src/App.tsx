import * as Sentry from '@sentry/react'
import { Component, useEffect, useState } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import './index.css'
import { useStore } from './store'
import { WelcomeScreen } from './components/WelcomeScreen'
import { EditorScreen } from './components/EditorScreen'
import { AboutPage } from './components/AboutPage'
import { LoginModal } from './components/LoginModal'
import { ConflictModal } from './components/ConflictModal'
import { getActiveId, loadProject as loadPersistedProject } from './lib/persistence'
import { fetchUser } from './lib/sync'

class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { Sentry.captureException(error, { extra: { componentStack: info.componentStack } }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-8 text-center">
        <p className="text-red-500 font-medium">Something went wrong</p>
        <p className="text-gray-500 text-sm max-w-sm">{this.state.error.message}</p>
        <button
          className="mt-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          onClick={() => { this.setState({ error: null }); this.props.onReset() }}
        >
          Back to home
        </button>
      </div>
    )
  }
}

type Screen = 'home' | 'editor' | 'about'

export default function App() {
  const project = useStore(s => s.project)
  const loadProject = useStore(s => s.loadProject)
  const setCloudUser = useStore(s => s.setCloudUser)
  const syncConflict = useStore(s => s.syncConflict)
  const [screen, setScreen] = useState<Screen>('home')
  const [restoring, setRestoring] = useState(true)
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    getActiveId().then(async id => {
      if (!id) return
      const saved = await loadPersistedProject(id)
      if (saved?.project) {
        loadProject(saved.project, saved.mapFileData, id)
        setScreen('editor')
      }
    }).finally(() => setRestoring(false))

    // Check if already signed in (cookie-based)
    fetchUser().then(u => { if (u) setCloudUser(u) })
  }, [loadProject, setCloudUser])

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const { project, syncStatus } = useStore.getState()
      if (project && syncStatus !== 'synced') {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  if (restoring) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-8 h-8 border-3 border-orange-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (screen === 'about') {
    return <AboutPage onBack={() => setScreen('home')} />
  }

  if (!project || screen !== 'editor') {
    return (
      <>
        <WelcomeScreen onProjectLoaded={() => setScreen('editor')} onAbout={() => setScreen('about')} onLogin={() => setShowLogin(true)} />
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </>
    )
  }

  return (
    <ErrorBoundary onReset={() => setScreen('home')}>
      <EditorScreen onGoHome={() => setScreen('home')} onLogin={() => setShowLogin(true)} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {syncConflict && <ConflictModal />}
    </ErrorBoundary>
  )
}
