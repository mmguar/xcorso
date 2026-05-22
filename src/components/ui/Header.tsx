import { useEffect, useRef, useState } from 'react'
import { Save, FileDown, Map, ImageUp } from 'lucide-react'
import { useStore } from '../../store'
import { saveProjectFile, downloadBlob } from '../../lib/projectFile'
import { exportIofXml } from '../../lib/iofExport'
import { SPEC_LABELS } from '../../lib/symbolSpec'
import { PdfExportDialog } from '../PdfExportDialog'
import type { EventSpec, MapType } from '../../types'

const MAP_EXTENSIONS = new Set(['ocd', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'])

interface Props { onGoHome: () => void }

export function Header({ onGoHome }: Props) {
  const project = useStore(s => s.project!)
  const mapFileData = useStore(s => s.mapFileData)
  const updateProjectName = useStore(s => s.updateProjectName)
  const updateProjectSpec = useStore(s => s.updateProjectSpec)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(project.meta.name)
  const replaceMapFile = useStore(s => s.replaceMapFile)
  const [exportOpen, setExportOpen] = useState(false)
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const mapInputRef = useRef<HTMLInputElement>(null)

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

      {/* Project name */}
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
          className="text-sm font-medium cursor-pointer hover:text-orange-700 transition-colors"
          onDoubleClick={() => { setNameVal(project.meta.name); setEditingName(true) }}
          title="Double-click to rename"
        >
          {project.meta.name}
        </span>
      )}

      <select
        value={project.spec ?? 'isom-2017'}
        onChange={e => updateProjectSpec(e.target.value as EventSpec)}
        className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-400 hidden sm:block"
        title="Event specification"
      >
        {(Object.entries(SPEC_LABELS) as [EventSpec, string][]).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      <div className="flex items-center gap-2 md:ml-auto">
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
          accept=".ocd,.pdf,image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleReplaceMap(f); e.target.value = '' }}
        />

        {/* Export */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            <FileDown size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-40 overflow-hidden">
              <button
                onClick={handleExportIof}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
              >
                IOF XML v3 (.xml)
              </button>
              <button
                onClick={() => { setPdfDialogOpen(true); setExportOpen(false) }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
              >
                Course PDF overlay
              </button>
            </div>
          )}
        </div>
      </div>
      {pdfDialogOpen && <PdfExportDialog onClose={() => setPdfDialogOpen(false)} />}
    </header>
  )
}
