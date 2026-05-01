/**
 * Landing screen: create new project or open existing .oco file.
 */

import { useRef, useState } from 'react'
import { Map, FolderOpen, FileUp, ArrowRight } from 'lucide-react'
import { useStore } from '../store'
import { loadProjectFile } from '../lib/projectFile'
import { loadMap } from '../lib/mapLoader'
import { clearSession } from '../lib/persistence'
import type { MapConfig, MapType } from '../types'

interface Props {
  onProjectLoaded: () => void
  onAbout: () => void
}

type Step = 'landing' | 'new-project'

export function WelcomeScreen({ onProjectLoaded, onAbout }: Props) {
  const [step, setStep] = useState<Step>('landing')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existingProject = useStore(s => s.project)
  const createProject = useStore(s => s.createProject)
  const loadProject = useStore(s => s.loadProject)

  const openFileRef = useRef<HTMLInputElement>(null)
  const mapFileRef = useRef<HTMLInputElement>(null)

  // New project state
  const [projectName, setProjectName] = useState('My Event')
  const [storageMode, setStorageMode] = useState<'embedded' | 'reference'>('embedded')
  const [mapFile, setMapFile] = useState<File | null>(null)

  async function handleOpenProject(file: File) {
    setLoading(true); setError(null)
    try {
      await clearSession()
      const { project, mapData } = await loadProjectFile(file)
      loadProject(project, mapData)
      onProjectLoaded()
    } catch (e) {
      setError(`Failed to open file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateProject() {
    if (!mapFile) return
    setLoading(true); setError(null)
    try {
      const data = await mapFile.arrayBuffer()
      const ext = mapFile.name.split('.').pop()?.toLowerCase() ?? ''
      const mapType: MapType = ext === 'ocd' ? 'ocad' : ext === 'pdf' ? 'pdf' : 'bitmap'

      // Load a COPY for scale detection — PDF.js transfers the ArrayBuffer to its
      // worker (detaching the original), so we must not pass the original here.
      const loadedMap = await loadMap(data.slice(0), mapFile.name)

      const mapConfig: MapConfig = {
        type: mapType,
        filename: mapFile.name,
        storage: storageMode === 'embedded' ? { mode: 'embedded' } : { mode: 'reference', path: mapFile.name },
        scale: loadedMap.detectedScale ?? 10000,
        scaleSource: loadedMap.detectedScale ? 'ocad' : 'manual',
      }

      createProject(projectName, mapConfig, data)

      onProjectLoaded()
    } catch (e) {
      setError(`Failed to load map: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  if (step === 'landing') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8 gap-8">
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Map size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">xcorso</h1>
          <p className="text-gray-500 text-center max-w-sm text-sm">
            Orienteering course planning for desktop and mobile.
            Open an OCAD, PDF, or image map to get started.
          </p>
        </div>

        {existingProject && (
          <button
            onClick={onProjectLoaded}
            className="flex items-center gap-3 w-full max-w-sm p-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl transition-colors shadow-md"
          >
            <ArrowRight size={20} />
            <div className="text-left">
              <div className="font-semibold text-sm">Return to "{existingProject.meta.name}"</div>
              <div className="text-xs text-orange-200">
                {existingProject.controls.length} controls · {existingProject.courses.length} courses
              </div>
            </div>
          </button>
        )}

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
          <button
            onClick={() => setStep('new-project')}
            className="flex-1 flex flex-col items-center gap-2 p-6 bg-white border-2 border-orange-200 hover:border-orange-400 rounded-2xl transition-all cursor-pointer shadow-sm hover:shadow-md"
          >
            <FileUp size={24} className="text-orange-600" />
            <span className="font-semibold text-gray-800">New Project</span>
            <span className="text-xs text-gray-400 text-center">Open a map file and start planning</span>
          </button>

          <button
            onClick={() => openFileRef.current?.click()}
            className="flex-1 flex flex-col items-center gap-2 p-6 bg-white border-2 border-gray-200 hover:border-gray-400 rounded-2xl transition-all cursor-pointer shadow-sm hover:shadow-md"
          >
            <FolderOpen size={24} className="text-gray-600" />
            <span className="font-semibold text-gray-800">Open .oco</span>
            <span className="text-xs text-gray-400 text-center">Resume an existing project</span>
          </button>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}
        {loading && <p className="text-gray-400 text-sm">Loading…</p>}

        <button
          onClick={onAbout}
          className="text-xs text-gray-400 hover:text-orange-600 transition-colors"
        >
          About xcorso
        </button>

        <input
          ref={openFileRef}
          type="file" accept=".oco" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleOpenProject(f) }}
        />
      </div>
    )
  }

  // New project flow
  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col gap-5">
        <h2 className="text-lg font-bold text-gray-900">New Project</h2>

        {/* Project name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Event name</label>
          <input
            type="text" value={projectName}
            onChange={e => setProjectName(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {/* Map file */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Map file</label>
          <button
            onClick={() => mapFileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 hover:border-orange-300 rounded-xl px-4 py-5 text-sm text-gray-400 hover:text-orange-600 transition-colors text-center"
          >
            {mapFile ? (
              <span className="text-gray-700 font-medium">{mapFile.name}</span>
            ) : (
              <>Click to select OCAD (.ocd), PDF, or image file</>
            )}
          </button>
          <input
            ref={mapFileRef}
            type="file"
            accept=".ocd,.pdf,.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.webp"
            className="hidden"
            onChange={e => setMapFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* Storage mode */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-500">Map storage in project file</label>
          <div className="flex gap-3">
            {(['embedded', 'reference'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setStorageMode(mode)}
                className={`flex-1 border rounded-xl px-3 py-2.5 text-xs text-left transition-colors ${
                  storageMode === mode
                    ? 'border-orange-400 bg-orange-50 text-orange-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <div className="font-semibold capitalize mb-0.5">{mode}</div>
                <div className="text-gray-400 leading-relaxed">
                  {mode === 'embedded'
                    ? 'Map file copied into .oco — easy to share & use on mobile'
                    : 'Map stays as a separate file — smaller project file'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => { setStep('landing'); setError(null) }}
            className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleCreateProject}
            disabled={!mapFile || loading}
            className="flex-1 bg-orange-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Loading map…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
