import { useEffect, useRef, useState } from 'react'
import { Download, FileDown, Map } from 'lucide-react'
import { useStore } from '../../store'
import { saveProjectFile, downloadBlob } from '../../lib/projectFile'
import { exportIofXml } from '../../lib/iofExport'
import { PdfExportDialog } from '../PdfExportDialog'

interface Props { onGoHome: () => void }

export function Header({ onGoHome }: Props) {
  const project = useStore(s => s.project!)
  const mapFileData = useStore(s => s.mapFileData)
  const updateProjectName = useStore(s => s.updateProjectName)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(project.meta.name)
  const mapSaturation = useStore(s => s.editor.mapSaturation)
  const setMapSaturation = useStore(s => s.setMapSaturation)
  const [exportOpen, setExportOpen] = useState(false)
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

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

  return (
    <header className="flex items-center gap-3 px-4 h-12 bg-white border-b border-gray-200 z-10 shrink-0">
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

      {/* Mobile saturation slider */}
      <div className="md:hidden flex items-center gap-1 ml-auto mr-2">
        <span className="text-[10px] text-gray-400 select-none">Map</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={mapSaturation}
          onChange={e => setMapSaturation(parseFloat(e.target.value))}
          className="w-14 h-1 accent-orange-600"
        />
      </div>

      <div className="flex items-center gap-2 md:ml-auto">
        {/* Save .oco */}
        <button
          onClick={handleSaveProject}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-1.5 transition-colors"
          title="Save project as .oco"
        >
          <Download size={14} />
          <span className="hidden sm:inline">Save .oco</span>
        </button>

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
