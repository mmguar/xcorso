import { useEffect, useRef, useState } from 'react'
import { Save, FileDown, Map, ImageUp, Pencil, ChevronDown, Home, Plus, Cloud, CloudOff, RefreshCw, AlertTriangle, LogOut, LogIn } from 'lucide-react'
import { useStore } from '../../store'
import { saveProjectFile, downloadBlob } from '../../lib/projectFile'
import { exportIofXml } from '../../lib/iofExport'
import { listProjects } from '../../lib/persistence'
import type { ProjectSummary } from '../../lib/persistence'
import { logout as cloudLogout } from '../../lib/sync'
import { SPEC_LABELS } from '../../lib/symbolSpec'
import type { EventSpec, MapType } from '../../types'

const MAP_EXTENSIONS = new Set(['ocd', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'])

interface Props { onGoHome: () => void; onLogin: () => void }

export function Header({ onGoHome, onLogin }: Props) {
  const project = useStore(s => s.project!)
  const projectId = useStore(s => s.projectId)
  const mapFileData = useStore(s => s.mapFileData)
  const updateProjectName = useStore(s => s.updateProjectName)
  const updateProjectSpec = useStore(s => s.updateProjectSpec)
  const switchProject = useStore(s => s.switchProject)
  const cloudUser = useStore(s => s.cloudUser)
  const syncStatus = useStore(s => s.syncStatus)
  const syncProject = useStore(s => s.syncProject)
  const setCloudUser = useStore(s => s.setCloudUser)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(project.meta.name)
  const replaceMapFile = useStore(s => s.replaceMapFile)
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const mapInputRef = useRef<HTMLInputElement>(null)

  // Project switcher dropdown
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [otherProjects, setOtherProjects] = useState<ProjectSummary[]>([])
  const switcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!switcherOpen) return
    listProjects().then(all => setOtherProjects(all.filter(p => p.id !== projectId)))
    function handleClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [switcherOpen, projectId])

  useEffect(() => {
    if (!exportOpen) return
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [exportOpen])

  async function handleSaveProject() {
    const blob = await saveProjectFile(project, mapFileData)
    downloadBlob(blob, `${project.meta.name.replace(/\s+/g, '_')}.oco`)
  }

  function handleExportIof() {
    const xml = exportIofXml(project)
    const blob = new Blob([xml], { type: 'application/xml' })
    downloadBlob(blob, `${project.meta.name.replace(/\s+/g, '_')}_iof3.xml`)
    setExportOpen(false)
  }

  async function handleReplaceMap(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!MAP_EXTENSIONS.has(ext)) return
    const data = await file.arrayBuffer()
    const type: MapType = ext === 'ocd' ? 'ocad' : ext === 'pdf' ? 'pdf' : 'bitmap'
    replaceMapFile(file.name, type, data)
  }

  async function handleSwitchTo(id: string) {
    setSwitcherOpen(false)
    await switchProject(id)
  }

  return (
    <header className="flex items-center gap-3 px-4 h-12 bg-white border-b border-gray-200 z-40 shrink-0 relative">
      <button
        onClick={onGoHome}
        className="flex items-center gap-2 text-orange-700 hover:text-orange-900 transition-colors"
        title="Back to home"
      >
        <Map size={20} />
        <span className="font-semibold text-sm hidden sm:inline">xcorso</span>
      </button>

      <div className="w-px h-5 bg-gray-200" />

      {/* Project name + switcher */}
      <div className="relative" ref={switcherRef}>
        <div className="flex items-center gap-0.5">
          {editingName ? (
            <input
              autoFocus
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={() => { updateProjectName(nameVal); setEditingName(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { updateProjectName(nameVal); setEditingName(false) } }}
              className="text-sm font-medium border-b border-orange-400 focus:outline-none bg-transparent w-48"
            />
          ) : (
            <span
              className="edit-icon-group text-sm font-medium cursor-pointer hover:text-orange-700 transition-colors flex items-center gap-1"
              onClick={() => { setNameVal(project.meta.name); setEditingName(true) }}
              title="Click to rename"
            >
              {project.meta.name}
              <Pencil size={12} className="edit-icon shrink-0" />
            </span>
          )}
          <button
            onClick={() => setSwitcherOpen(o => !o)}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Switch project"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        {switcherOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
            {otherProjects.map(p => (
              <button
                key={p.id}
                onClick={() => handleSwitchTo(p.id)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
              >
                <div className="text-sm font-medium text-gray-800 truncate">{p.name}</div>
                <div className="text-[10px] text-gray-400">{new Date(p.updatedAt).toLocaleDateString()}</div>
              </button>
            ))}
            {otherProjects.length > 0 && <div className="border-t border-gray-100 my-1" />}
            <button
              onClick={() => { setSwitcherOpen(false); onGoHome() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Home size={14} />
              <span>Home</span>
            </button>
            <button
              onClick={() => { setSwitcherOpen(false); onGoHome() }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Plus size={14} />
              <span>New project</span>
            </button>
          </div>
        )}
      </div>

      <select
        value={project.spec ?? 'isom-2017'}
        onChange={e => updateProjectSpec(e.target.value as EventSpec)}
        className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
        title="Event specification"
      >
        {(Object.entries(SPEC_LABELS) as [EventSpec, string][]).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      <div className="flex items-center gap-2 md:ml-auto">
        {/* Cloud sync */}
        {cloudUser ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => syncProject()}
              disabled={syncStatus === 'syncing'}
              className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
              title={`Signed in as ${cloudUser.email}`}
            >
              {syncStatus === 'syncing' ? <RefreshCw size={14} className="animate-spin" /> :
               syncStatus === 'synced' ? <Cloud size={14} className="text-green-500" /> :
               syncStatus === 'error' ? <AlertTriangle size={14} className="text-red-400" /> :
               syncStatus === 'offline' ? <CloudOff size={14} className="text-gray-400" /> :
               <Cloud size={14} />}
              <span className="hidden sm:inline">
                {syncStatus === 'syncing' ? 'Syncing' :
                 syncStatus === 'synced' ? 'Synced' :
                 syncStatus === 'error' ? 'Sync error' :
                 syncStatus === 'offline' ? 'Offline' : 'Sync'}
              </span>
            </button>
            <button
              onClick={() => { cloudLogout(); setCloudUser(null) }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={onLogin}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1.5 transition-colors"
            title="Sign in to sync across devices"
          >
            <LogIn size={14} />
            <span className="hidden sm:inline">Sign in</span>
          </button>
        )}

        {/* Save .oco */}
        <button
          onClick={handleSaveProject}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-1.5 transition-colors"
          title="Save project as .oco"
        >
          <Save size={14} />
          <span className="hidden sm:inline">Save .oco</span>
        </button>

        {/* Replace map */}
        <button
          onClick={() => mapInputRef.current?.click()}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-1.5 transition-colors"
          title="Replace map file (keeps controls in place)"
        >
          <ImageUp size={14} />
          <span className="hidden sm:inline">Replace map</span>
        </button>
        <input
          ref={mapInputRef}
          type="file"
          accept=".ocd,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.webp"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleReplaceMap(f); e.target.value = '' }}
        />

        {/* Export */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={handleExportIof}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            <FileDown size={14} />
            <span className="hidden sm:inline">Export IOF</span>
          </button>
        </div>
      </div>
    </header>
  )
}
