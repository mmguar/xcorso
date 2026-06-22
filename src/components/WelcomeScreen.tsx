/**
 * Landing screen: create new project, open .oco, or switch between saved projects.
 */

import { useRef, useState, useEffect } from 'react'
import { Map, FolderOpen, FileUp, Trash2, Cloud, LogIn, LogOut, RefreshCw, Copy } from 'lucide-react'
import { useStore } from '../store'
import { loadProjectFile } from '../lib/projectFile'
import { loadMap } from '../lib/mapLoader'
import { importIofXml } from '../lib/iofImport'
import { listProjects, deleteProject as deletePersistedProject, loadProject as loadPersistedProject, saveProject, setSyncMeta } from '../lib/persistence'
import type { ProjectSummary } from '../lib/persistence'
import { logout as cloudLogout, deleteAccount, fetchCloudProjects, deleteCloudProject, downloadProject, fetchSharedProjects, type SyncMeta, type SharedProject } from '../lib/sync'
import { SPEC_LABELS } from '../lib/symbolSpec'
import type { MapConfig, MapType, EventSpec } from '../types'

interface Props {
  onProjectLoaded: () => void
  onAbout: () => void
  onLogin: () => void
}

type Step = 'landing' | 'new-project'
const MAP_FILE_EXTENSIONS = new Set(['ocd', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'])

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function WelcomeScreen({ onProjectLoaded, onAbout, onLogin }: Props) {
  const [step, setStep] = useState<Step>('landing')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [sharedProjects, setSharedProjects] = useState<SharedProject[]>([])

  const activeProjectId = useStore(s => s.projectId)
  const createProject = useStore(s => s.createProject)
  const loadProject = useStore(s => s.loadProject)
  const switchProject = useStore(s => s.switchProject)
  const cloudUser = useStore(s => s.cloudUser)
  const setCloudUser = useStore(s => s.setCloudUser)

  const openFileRef = useRef<HTMLInputElement>(null)
  const mapFileRef = useRef<HTMLInputElement>(null)
  const iofFileRef = useRef<HTMLInputElement>(null)

  // New project state
  const [projectName, setProjectName] = useState('My Event')
  const [eventSpec, setEventSpec] = useState<EventSpec>('isom-2017')
  const [storageMode, setStorageMode] = useState<'embedded' | 'reference'>('embedded')
  const [mapFile, setMapFile] = useState<File | null>(null)
  const [iofFile, setIofFile] = useState<File | null>(null)

  useEffect(() => {
    loadProjectList()
  }, [cloudUser]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProjectList() {
    const local = await listProjects()
    if (!cloudUser) { setProjects(local); setSharedProjects([]); return }

    setSyncing(true)
    try {
      const [cloud, shared] = await Promise.all([fetchCloudProjects(), fetchSharedProjects()])
      const localCloudIds = new Set(local.map(p => p.sync?.cloudId).filter(Boolean))
      const cloudOnly: ProjectSummary[] = cloud
        .filter(c => !localCloudIds.has(c.id))
        .map(c => ({ id: c.id, name: c.name, updatedAt: c.updatedAt, sync: { cloudId: c.id, syncVersion: c.version, syncedAt: c.updatedAt, mapHash: null } }))
      setProjects([...local, ...cloudOnly].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setSharedProjects(shared)
    } catch {
      setProjects(local)
    } finally {
      setSyncing(false)
    }
  }

  async function handleOpenProject(file: File) {
    setLoading(true); setError(null)
    try {
      const { project, mapData } = await loadProjectFile(file)
      loadProject(project, mapData)
      onProjectLoaded()
    } catch (e) {
      setError(`Failed to open file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleSwitchProject(p: ProjectSummary) {
    setLoading(true); setError(null)
    try {
      const cloudId = p.sync?.cloudId
      const isLocallyAvailable = await loadPersistedProject(p.id)
      if (isLocallyAvailable) {
        await switchProject(p.id)
      } else if (cloudId) {
        const result = await downloadProject(cloudId, null)
        if (!result) throw new Error('Download failed')
        await saveProject(p.id, result.project, result.mapData)
        const sync: SyncMeta = { cloudId, syncVersion: result.version, syncedAt: new Date().toISOString(), mapHash: result.mapHash }
        await setSyncMeta(p.id, sync)
        loadProject(result.project, result.mapData, p.id)
      } else {
        throw new Error('Project not found')
      }
      onProjectLoaded()
    } catch (e) {
      setError(`Failed to open project: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDuplicateProject(p: ProjectSummary) {
    setLoading(true); setError(null)
    try {
      const saved = await loadPersistedProject(p.id)
      if (!saved) throw new Error('Project not found locally')
      const newId = crypto.randomUUID()
      const dup = structuredClone(saved.project)
      dup.meta.name = `${dup.meta.name} (copy)`
      dup.meta.updatedAt = new Date().toISOString()
      await saveProject(newId, dup, saved.mapFileData)
      loadProject(dup, saved.mapFileData, newId)
      onProjectLoaded()
    } catch (e) {
      setError(`Failed to duplicate: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleOpenShared(sp: SharedProject) {
    setLoading(true); setError(null)
    try {
      const result = await downloadProject(sp.projectId, null)
      if (!result) throw new Error('Download failed')
      loadProject(result.project, result.mapData, sp.projectId, sp.role)
      onProjectLoaded()
    } catch (e) {
      setError(`Failed to open shared project: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteProject(id: string) {
    const project = projects.find(p => p.id === id)
    if (project?.sync?.cloudId) {
      await deleteCloudProject(project.sync.cloudId)
    }
    await deletePersistedProject(id)
    setProjects(ps => ps.filter(p => p.id !== id))
    setConfirmDeleteId(null)
  }

  async function handleCreateProject() {
    if (!mapFile) return
    setLoading(true); setError(null)
    try {
      const ext = mapFile.name.split('.').pop()?.toLowerCase() ?? ''
      if (!MAP_FILE_EXTENSIONS.has(ext)) {
        throw new Error('Unsupported map format. Please select an OCAD, PDF, or image file.')
      }

      const data = await mapFile.arrayBuffer()
      const mapType: MapType = ext === 'ocd' ? 'ocad' : ext === 'pdf' ? 'pdf' : 'bitmap'

      // Load a COPY for scale detection — PDF.js transfers the ArrayBuffer to its
      // worker (detaching the original), so we must not pass the original here.
      const loadedMap = await loadMap(data.slice(0), mapFile.name)

      const mapConfig: MapConfig = {
        type: mapType,
        filename: mapFile.name,
        storage: storageMode === 'embedded' ? { mode: 'embedded' } : { mode: 'reference', path: mapFile.name },
        scale: loadedMap.detectedScale ?? 10000,
        width: loadedMap.bounds.width,
        height: loadedMap.bounds.height,
        originX: loadedMap.bounds.minX,
        originY: loadedMap.bounds.minY,
        georef: loadedMap.detectedGeoref ?? undefined,
        scaleSource: loadedMap.detectedScale ? 'ocad' : 'manual',
      }

      createProject(projectName, mapConfig, data, eventSpec)

      if (iofFile) {
        const xml = await iofFile.text()
        const imported = importIofXml(xml, mapConfig)
        const state = useStore.getState()
        loadProject(
          { ...state.project!, controls: imported.controls, courses: imported.courses, classes: imported.classes },
          state.mapFileData,
        )
      }

      onProjectLoaded()
    } catch (e) {
      setError(`Failed to load map: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  if (step === 'landing') {
    return (
      <div className="relative flex flex-col items-center h-dvh bg-gray-50 px-8 gap-8 overflow-y-auto py-16">
        {/* Account */}
        <div className="absolute top-4 right-4">
          {cloudUser ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Cloud size={14} className="text-green-500" />
              <span>{cloudUser.email}</span>
              <button
                onClick={() => { cloudLogout(); setCloudUser(null) }}
                className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                title="Sign out"
              >
                <LogOut size={14} />
              </button>
              {confirmDeleteAccount ? (
                <span className="flex items-center gap-1 ml-1">
                  <button
                    onClick={async () => { await deleteAccount(); setCloudUser(null); setConfirmDeleteAccount(false) }}
                    className="text-xs px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600"
                  >
                    Confirm delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAccount(false)}
                    className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDeleteAccount(true)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-1"
                  title="Delete account and all cloud data"
                >
                  Delete account
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 transition-colors"
            >
              <LogIn size={14} />
              Sign in
            </button>
          )}
        </div>

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

        {/* Saved projects */}
        {(projects.length > 0 || cloudUser) && (
          <div className="w-full max-w-sm flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <h2 className="text-xs font-medium text-gray-400">
                {syncing ? 'Syncing…' : 'Recent projects'}
              </h2>
              {cloudUser && (
                <button
                  onClick={loadProjectList}
                  disabled={syncing}
                  className="p-0.5 rounded text-gray-300 hover:text-orange-500 transition-colors disabled:opacity-40"
                  title="Refresh cloud projects"
                >
                  <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
            {projects.map(p => (
              <div
                key={p.id}
                className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  p.id === activeProjectId
                    ? 'bg-orange-600 text-white shadow-md'
                    : 'bg-white border border-gray-200 hover:border-orange-300 text-gray-800'
                }`}
                onClick={() => handleSwitchProject(p)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm truncate">{p.name}</span>
                    {p.sync && <Cloud size={12} className={p.id === activeProjectId ? 'text-orange-200' : 'text-gray-300'} />}
                  </div>
                  <div className={`text-xs ${p.id === activeProjectId ? 'text-orange-200' : 'text-gray-400'}`}>
                    {timeAgo(p.updatedAt)}
                  </div>
                </div>
                {confirmDeleteId === p.id ? (
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleDeleteProject(p.id)}
                      className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className={`text-xs px-2 py-1 rounded ${
                        p.id === activeProjectId ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-0.5">
                    <button
                      onClick={e => { e.stopPropagation(); handleDuplicateProject(p) }}
                      className={`p-1.5 rounded-lg transition-colors ${
                        p.id === activeProjectId
                          ? 'hover:bg-orange-500 text-orange-200'
                          : 'hover:bg-gray-100 text-gray-300 hover:text-gray-500'
                      }`}
                      title="Duplicate"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(p.id) }}
                      className={`p-1.5 rounded-lg transition-colors ${
                        p.id === activeProjectId
                          ? 'hover:bg-orange-500 text-orange-200'
                          : 'hover:bg-gray-100 text-gray-300 hover:text-red-400'
                      }`}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Shared with me */}
        {sharedProjects.length > 0 && (
          <div className="w-full max-w-sm flex flex-col gap-1.5">
            <h2 className="text-xs font-medium text-gray-400 px-1">Shared with me</h2>
            {sharedProjects.map(sp => (
              <div
                key={sp.projectId}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-white border border-blue-100 hover:border-blue-300 text-gray-800 transition-colors cursor-pointer"
                onClick={() => handleOpenShared(sp)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm truncate">{sp.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-medium">{sp.role}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {sp.ownerEmail} · {timeAgo(sp.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
            <span className="text-xs text-gray-400 text-center">Import a project file</span>
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

        {/* Event specification */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-500">Event type</label>
          <div className="flex gap-3">
            {(['isom-2017', 'issprm-2019'] as const).map(spec => (
              <button
                key={spec}
                onClick={() => setEventSpec(spec)}
                className={`flex-1 border rounded-xl px-3 py-2.5 text-xs text-left transition-colors ${
                  eventSpec === spec
                    ? 'border-orange-400 bg-orange-50 text-orange-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <div className="font-semibold mb-0.5">{SPEC_LABELS[spec]}</div>
                <div className="text-gray-400 leading-relaxed">
                  {spec === 'isom-2017'
                    ? 'Forest orienteering, base scale 1:15000'
                    : 'Sprint orienteering, base scale 1:4000'}
                </div>
              </button>
            ))}
          </div>
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
            accept=".ocd,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.webp"
            className="hidden"
            onChange={e => {
              const selectedFile = e.target.files?.[0] ?? null
              setMapFile(selectedFile)
              setError(null)
            }}
          />
          {mapFile && !mapFile.name.toLowerCase().endsWith('.ocd') && (
            <p className="text-[11px] text-amber-600 mt-1">
              PDF and image maps are saved locally only. Use an OCAD file (.ocd) for cloud sync and sharing.
            </p>
          )}
        </div>

        {/* IOF XML import */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Import courses <span className="font-normal text-gray-400">(optional)</span></label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => iofFileRef.current?.click()}
              className="flex-1 border border-dashed border-gray-200 hover:border-orange-300 rounded-lg px-3 py-2 text-xs text-gray-400 hover:text-orange-600 transition-colors text-left truncate"
            >
              {iofFile ? iofFile.name : 'IOF XML v3 — from Condes, Purple Pen, etc.'}
            </button>
            {iofFile && (
              <button onClick={() => setIofFile(null)} className="text-xs text-gray-400 hover:text-red-400 px-1">Clear</button>
            )}
          </div>
          <input
            ref={iofFileRef}
            type="file" accept=".xml" className="hidden"
            onChange={e => { setIofFile(e.target.files?.[0] ?? null); setError(null) }}
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
