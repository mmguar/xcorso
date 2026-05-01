import { useEffect, useState } from 'react'
import './index.css'
import { useStore } from './store'
import { WelcomeScreen } from './components/WelcomeScreen'
import { EditorScreen } from './components/EditorScreen'
import { loadSession } from './lib/persistence'

export default function App() {
  const project = useStore(s => s.project)
  const loadProject = useStore(s => s.loadProject)
  const [inEditor, setInEditor] = useState(false)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    loadSession().then(saved => {
      if (saved?.project) {
        loadProject(saved.project, saved.mapFileData)
        setInEditor(true)
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

  if (!project || !inEditor) {
    return <WelcomeScreen onProjectLoaded={() => setInEditor(true)} />
  }

  return <EditorScreen onGoHome={() => setInEditor(false)} />
}
