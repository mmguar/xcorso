import { useEffect, useState, useCallback } from 'react'
import { useStore } from '../store'
import { useRenderTracker } from '../lib/perf'
import { loadMap } from '../lib/mapLoader'
import { MapCanvas } from './canvas/MapCanvas'
import { Header } from './ui/Header'
import { SidePanel } from './ui/SidePanel'
import { Toolbar } from './ui/Toolbar'
import { OverlaySettingsPanel, AnnotationSettingsPanel } from './panels/OverlaySettingsPanel'
import { OnboardingTour } from './OnboardingTour'

const shortcuts: [string, string][] = [
  ['V', 'Select / Pan'],
  ['S', 'Place Start'],
  ['F', 'Place Finish'],
  ['C', 'Place Control'],
  ['G', 'Gap Tool'],
  ['D', 'Delete Tool'],
  ['M', 'Measure Scale'],
  ['B', 'Forbidden Route'],
  ['P', 'Crossing Point'],
  ['O', 'Out of Bounds'],
  ['K', 'Scale Bar'],
  ['T', 'Text'],
  ['N', 'North Arrow'],
  ['I', 'Image'],
  ['⌘Z', 'Undo'],
  ['⌘Y', 'Redo'],
  ['Del', 'Delete Selected'],
  ['Esc', 'Deselect / Exit'],
  ['?', 'This help'],
]

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-80" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Keyboard shortcuts</h3>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {shortcuts.map(([key, label]) => (
            <div key={key} className="contents">
              <kbd className="text-[11px] font-mono bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 text-center min-w-[2rem]">{key}</kbd>
              <span className="text-xs text-gray-600 py-0.5">{label}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-3">In course mode: <strong>G</strong> gap, <strong>B</strong> bend</p>
      </div>
    </div>
  )
}

interface Props { onGoHome: () => void; onLogin: () => void }

export function EditorScreen({ onGoHome, onLogin }: Props) {
  useRenderTracker('EditorScreen')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const closeShortcuts = useCallback(() => setShowShortcuts(false), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '?') setShowShortcuts(s => !s)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
        <div className="flex-1 relative overflow-hidden canvas-area">
          <MapCanvas loadedMap={loadedMap} />
          <Toolbar />
          <OverlaySettingsPanel />
          <AnnotationSettingsPanel />
        </div>
        <SidePanel />
      </div>
      {showShortcuts && <ShortcutsOverlay onClose={closeShortcuts} />}
      <OnboardingTour />
    </div>
  )
}
