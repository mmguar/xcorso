import { useState } from 'react'
import './index.css'
import { useStore } from './store'
import { WelcomeScreen } from './components/WelcomeScreen'
import { EditorScreen } from './components/EditorScreen'

export default function App() {
  const project = useStore(s => s.project)
  const [inEditor, setInEditor] = useState(false)

  if (!project || !inEditor) {
    return <WelcomeScreen onProjectLoaded={() => setInEditor(true)} />
  }

  return <EditorScreen />
}
