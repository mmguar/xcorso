/**
 * Main editor screen — loads the map and renders the full editing UI.
 */

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { loadMap } from '../lib/mapLoader'
import { MapCanvas } from './canvas/MapCanvas'
import { Header } from './ui/Header'
import { SidePanel } from './ui/SidePanel'
import { Toolbar } from './ui/Toolbar'

export function EditorScreen() {
  const project = useStore(s => s.project!)
  const mapFileData = useStore(s => s.mapFileData)
  const loadedMap = useStore(s => s.loadedMap)
  const setLoadedMap = useStore(s => s.setLoadedMap)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mapFileData && project.map.storage.mode === 'reference') {
      setError('Map file not loaded. Open the .oco file from the same folder as your map.')
      return
    }
    if (!mapFileData) {
      setError('No map data available.')
      return
    }
    loadMap(mapFileData, project.map.filename)
      .then(setLoadedMap)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [mapFileData, project.map.filename, setLoadedMap])

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-8 text-center">
        <p className="text-red-500 font-medium">Map loading error</p>
        <p className="text-gray-500 text-sm max-w-sm">{error}</p>
      </div>
    )
  }

  if (!loadedMap) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Loading map…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 relative overflow-hidden">
          <MapCanvas loadedMap={loadedMap} />
          <Toolbar />
        </div>
        <SidePanel />
      </div>
    </div>
  )
}
