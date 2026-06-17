import { useEffect, useState } from 'react'
import './index.css'
import { useStore } from './store'
import { WelcomeScreen } from './components/WelcomeScreen'
import { EditorScreen } from './components/EditorScreen'
import { AboutPage } from './components/AboutPage'
import { LoginModal } from './components/LoginModal'
import { ConflictModal } from './components/ConflictModal'
import { getActiveId, loadProject as loadPersistedProject } from './lib/persistence'
import { fetchUser } from './lib/sync'

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
    <>
      <EditorScreen onGoHome={() => setScreen('home')} onLogin={() => setShowLogin(true)} />
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {syncConflict && <ConflictModal />}
    </>
  )
}
