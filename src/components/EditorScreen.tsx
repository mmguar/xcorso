/**
 * Main editor screen — loads the map and renders the full editing UI.
 */

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useRenderTracker } from '../lib/perf'
import { loadMap } from '../lib/mapLoader'
import { MapCanvas } from './canvas/MapCanvas'
import { Header } from './ui/Header'
import { SidePanel } from './ui/SidePanel'
import { Toolbar } from './ui/Toolbar'
import { OverlaySettingsPanel, AnnotationSettingsPanel } from './panels/OverlaySettingsPanel'

interface Props { onGoHome: () => void; onLogin: () => void }

export function EditorScreen({ onGoHome, onLogin }: Props) {
  useRenderTracker('EditorScreen')
  // Select primitives, not the project object — its reference changes on every
  // mutation (including per-pointermove drag updates), which would re-render
  // the entire app shell at pointer-event rate.
  const mapFilename = useStore(s => s.project!.map.filename)
  const mapStorageMode = useStore(s => s.project!.map.storage.mode)
  const mapFileData = useStore(s => s.mapFileData)
  const loadedMap = useStore(s => s.loadedMap)
  const setLoadedMap = useStore(s => s.setLoadedMap)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mapFileData && mapStorageMode === 'reference') {
      setError('Map file not loaded. Open the .oco file from the same folder as your map.')
      return
    }
    if (!mapFileData) {
      setError('No map data available.')
      return
    }
    loadMap(mapFileData, mapFilename)
      .then((map) => {
        setLoadedMap(map)
        const { width, height, minX, minY } = map.bounds
        const proj = useStore.getState().project
        if (proj && (proj.map.width !== width || proj.map.height !== height
            || proj.map.originX !== minX || proj.map.originY !== minY)) {
          useStore.getState().setMapDimensions(width, height, minX, minY)
        }
        if (proj && map.detectedGeoref && !proj.map.georef) {
          useStore.getState().setMapGeoref(map.detectedGeoref)
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [mapFileData, mapFilename, mapStorageMode, setLoadedMap])

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-8 text-center">
        <p className="text-red-500 font-medium">Map loading error</p>
        <p className="text-gray-500 text-sm max-w-sm">{error}</p>
        <button
          className="mt-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          onClick={onGoHome}
        >
          Back to home
        </button>
      </div>
    )
  }

  if (!loadedMap) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-orange-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Loading map…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header onGoHome={onGoHome} onLogin={onLogin} />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 relative overflow-hidden">
          <MapCanvas loadedMap={loadedMap} />
          <Toolbar />
          <OverlaySettingsPanel />
          <AnnotationSettingsPanel />
        </div>
        <SidePanel />
      </div>
    </div>
  )
}
