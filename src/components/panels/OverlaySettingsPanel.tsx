import { useState, useEffect } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { useStore } from '../../store'
import type { ScaleBar, TextLabel } from '../../types'

function ScaleBarSettings({ sb }: { sb: ScaleBar }) {
  const updateScaleBar = useStore(s => s.updateScaleBar)
  const deleteScaleBar = useStore(s => s.deleteScaleBar)
  const setSelectedOverlay = useStore(s => s.setSelectedOverlay)

  const [segments, setSegments] = useState(String(sb.segments))
  const [scale, setScale] = useState(String(sb.scale))
  const [segLen, setSegLen] = useState(String(sb.segmentLengthM))

  useEffect(() => {
    setSegments(String(sb.segments))
    setScale(String(sb.scale))
    setSegLen(String(sb.segmentLengthM))
  }, [sb.id, sb.segments, sb.scale, sb.segmentLengthM])

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Scale Bar</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { deleteScaleBar(sb.id) }}
            className="text-gray-400 hover:text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => setSelectedOverlay(null)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Scale 1:</span>
        <input
          type="number"
          min={100}
          max={100000}
          value={parseInt(scale)}
          onChange={e => setScale(e.target.value)}
          onBlur={() => {
            const n = parseInt(scale)
            if (!isNaN(n) && n >= 100 && n <= 100000) updateScaleBar(sb.id, { scale: n })
            else setScale(String(sb.scale))
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="flex-1 min-w-0 text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Segments</span>
        <input
          type="number"
          min={1}
          max={10}
          value={segments}
          onChange={e => setSegments(e.target.value)}
          onBlur={() => {
            const n = parseInt(segments)
            if (!isNaN(n) && n >= 1 && n <= 10) updateScaleBar(sb.id, { segments: n })
            else setSegments(String(sb.segments))
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="flex-1 min-w-0 text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Segment (m)</span>
        <input
          type="number"
          min={1}
          value={segLen}
          onChange={e => setSegLen(e.target.value)}
          onBlur={() => {
            const n = parseInt(segLen)
            if (!isNaN(n) && n >= 1) updateScaleBar(sb.id, { segmentLengthM: n })
            else setSegLen(String(sb.segmentLengthM))
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="flex-1 min-w-0 text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Background</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sb.bgAlpha}
          onChange={e => updateScaleBar(sb.id, { bgAlpha: parseFloat(e.target.value) })}
          className="flex-1 min-w-0 h-1 accent-orange-600"
        />
        <span className="text-[10px] text-gray-400 w-8 text-right">
          {Math.round(sb.bgAlpha * 100)}%
        </span>
      </label>
    </div>
  )
}

function TextLabelSettings({ tl }: { tl: TextLabel }) {
  const updateTextLabel = useStore(s => s.updateTextLabel)
  const deleteTextLabel = useStore(s => s.deleteTextLabel)
  const setSelectedOverlay = useStore(s => s.setSelectedOverlay)

  const [text, setText] = useState(tl.text)
  const [fontSize, setFontSize] = useState(String(tl.fontSizeMm))

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Text Label</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { deleteTextLabel(tl.id) }}
            className="text-gray-400 hover:text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => setSelectedOverlay(null)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs text-gray-600">
        <div className="flex items-center justify-between">
          <span>Text</span>
          {text !== tl.text && (
            <button
              onClick={() => { if (text.trim()) updateTextLabel(tl.id, { text: text.trim() }); else setText(tl.text) }}
              className="flex items-center gap-0.5 text-[10px] text-orange-600 hover:text-orange-700 font-medium"
            >
              <Check size={11} />
              Apply
            </button>
          )}
        </div>
        <textarea
          rows={3}
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={() => { if (text.trim()) updateTextLabel(tl.id, { text: text.trim() }); else setText(tl.text) }}
          className="w-full text-xs border rounded px-1.5 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Size (mm)</span>
        <input
          type="number"
          min={0.5}
          max={50}
          step={0.5}
          value={fontSize}
          onChange={e => setFontSize(e.target.value)}
          onBlur={() => {
            const n = parseFloat(fontSize)
            if (!isNaN(n) && n >= 0.5) updateTextLabel(tl.id, { fontSizeMm: n })
            else setFontSize(String(tl.fontSizeMm))
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="flex-1 min-w-0 text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Color</span>
        <input
          type="color"
          value={tl.color}
          onChange={e => updateTextLabel(tl.id, { color: e.target.value })}
          className="w-8 h-6 border rounded cursor-pointer"
        />
        <span className="text-[10px] text-gray-400 font-mono">{tl.color}</span>
      </label>

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Background</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={tl.bgAlpha}
          onChange={e => updateTextLabel(tl.id, { bgAlpha: parseFloat(e.target.value) })}
          className="flex-1 min-w-0 h-1 accent-orange-600"
        />
        <span className="text-[10px] text-gray-400 w-8 text-right">
          {Math.round(tl.bgAlpha * 100)}%
        </span>
      </label>
    </div>
  )
}

export function OverlaySettingsPanel() {
  const selectedOverlayId = useStore(s => s.editor.selectedOverlayId)
  const project = useStore(s => s.project)

  if (!selectedOverlayId || !project) return null

  const sb = project.scaleBars.find(s => s.id === selectedOverlayId)
  const tl = project.textLabels.find(t => t.id === selectedOverlayId)

  if (!sb && !tl) return null

  return (
    <div className="absolute top-2 left-2 z-30 bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-xl px-3 py-2.5 w-56">
      {sb && <ScaleBarSettings key={sb.id} sb={sb} />}
      {tl && <TextLabelSettings key={tl.id} tl={tl} />}
    </div>
  )
}
