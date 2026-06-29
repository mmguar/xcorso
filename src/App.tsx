import * as Sentry from '@sentry/react'
import { Component, useCallback, useEffect, useState } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import './index.css'
import { useStore } from './store'
import { useT } from './i18n'
import { WelcomeScreen } from './components/WelcomeScreen'
import { EditorScreen } from './components/EditorScreen'
import { AboutPage } from './components/AboutPage'
import { LoginModal } from './components/LoginModal'
import { ConflictModal } from './components/ConflictModal'
import { getActiveId, loadProject as loadPersistedProject } from './lib/persistence'
import { fetchUser } from './lib/sync'

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const t = useT()
  return (
    <div className="flex flex-col h-full items-center justify-center gap-3 p-8 text-center">
      <p className="text-red-500 font-medium">{t('app.error')}</p>
      <p className="text-gray-500 text-sm max-w-sm">{error.message}</p>
      <button className="mt-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors" onClick={onReset}>
        {t('app.backHome')}
      </button>
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { Sentry.captureException(error, { extra: { componentStack: info.componentStack } }) }
  render() {
    if (!this.state.error) return this.props.children
    return <ErrorFallback error={this.state.error} onReset={() => { this.setState({ error: null }); this.props.onReset() }} />
  }
}

type Screen = 'home' | 'editor' | 'about'

function hasUnsyncedChanges(): boolean {
  const { project, syncStatus, cloudUser, projectRevision, loadedRevision } = useStore.getState()
  return !!(project && cloudUser && syncStatus !== 'synced' && projectRevision !== loadedRevision)
}

function UnsavedDialog({ onSync, onDiscard, onCancel }: { onSync: () => void; onDiscard: () => void; onCancel: () => void }) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-5 w-80 flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('unsaved.title')}</h3>
        <p className="text-xs text-gray-500">{t('unsaved.desc')}</p>
        <div className="flex flex-col gap-2">
          <button onClick={onSync} className="px-3 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors">{t('unsaved.sync')}</button>
          <button onClick={onDiscard} className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">{t('unsaved.discard')}</button>
          <button onClick={onCancel} className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors">{t('unsaved.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const project = useStore(s => s.project)
  const loadProject = useStore(s => s.loadProject)
  const setCloudUser = useStore(s => s.setCloudUser)
  const syncConflict = useStore(s => s.syncConflict)
  const [screen, setScreen] = useState<Screen>('home')
  const [restoring, setRestoring] = useState(true)
  const [showLogin, setShowLogin] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  useEffect(() => {
    const projectP = getActiveId().then(async id => {
      if (!id) return
      const saved = await loadPersistedProject(id)
      if (saved?.project) {
        loadProject(saved.project, saved.mapFileData, id)
        setScreen('editor')
      }
    }).finally(() => setRestoring(false))

    const authP = fetchUser().then(u => { if (u) setCloudUser(u) })

    // After both project and auth resolve, check if remote has a newer version
    Promise.all([projectP, authP]).then(() => {
      useStore.getState().checkForRemoteUpdate()
    })
  }, [loadProject, setCloudUser])

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (hasUnsyncedChanges()) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const guardedAction = useCallback((action: () => void) => {
    if (screen === 'editor' && hasUnsyncedChanges()) {
      setPendingAction(() => action)
    } else {
      action()
    }
  }, [screen])

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
      <EditorScreen onGoHome={() => guardedAction(() => setScreen('home'))} onLogin={() => setShowLogin(true)} guardLeave={guardedAction} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {syncConflict && <ConflictModal />}
      {pendingAction && (
        <UnsavedDialog
          onSync={async () => {
            await useStore.getState().syncProject()
            const action = pendingAction
            setPendingAction(null)
            action()
          }}
          onDiscard={() => { const action = pendingAction; setPendingAction(null); action() }}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </ErrorBoundary>
  )
}
