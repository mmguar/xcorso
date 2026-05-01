import { useEffect, useState } from 'react'
import './index.css'
import { useStore } from './store'
import { WelcomeScreen } from './components/WelcomeScreen'
import { EditorScreen } from './components/EditorScreen'
import { AboutPage } from './components/AboutPage'
import { loadSession } from './lib/persistence'

type Screen = 'home' | 'editor' | 'about'

export default function App() {
  const project = useStore(s => s.project)
  const loadProject = useStore(s => s.loadProject)
  const [screen, setScreen] = useState<Screen>('home')
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    loadSession().then(saved => {
      if (saved?.project) {
        loadProject(saved.project, saved.mapFileData)
        setScreen('editor')
      }
    }).finally(() => setRestoring(false))
  }, [loadProject])

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
    return <WelcomeScreen onProjectLoaded={() => setScreen('editor')} onAbout={() => setScreen('about')} />
  }

  return <EditorScreen onGoHome={() => setScreen('home')} />
}
