import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import {
  checkFit, checkTiling, canExportPdf, PAGE_SIZES, MARGIN,
  suggestFitScale, coursePreviewMm, ALL_CONTROLS_ID, exportCoursePdf,
  submapPreviewId, parseSubmapPreviewId,
} from '../lib/pdfExport'
import { computeSubmaps } from '../lib/courseUtils'
import type { PdfExportOptions, DescMode } from '../lib/pdfExport'
import { descriptionSheetPageCount, descriptionSheetSize } from '../lib/pdfDescriptionSheet'
import { downloadBlob } from '../lib/projectFile'

export function usePdfExportState(onClose: () => void) {
  const project = useStore(s => s.project!)
  const loadedMap = useStore(s => s.loadedMap)

  const [pageSize, setPageSize] = useState('a4')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [printScale, setPrintScale] = useState(project.map.scale)
  const [scaleInput, setScaleInput] = useState(String(project.map.scale))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(project.courses.map(c => c.id)),
  )
  const [allControls, setAllControls] = useState(false)
  const [descModes, setDescModes] = useState<Record<string, DescMode>>(() => {
    const modes: Record<string, DescMode> = {}
    for (const c of project.courses) {
      if (c.layout?.clueSheet.visible) modes[c.id] = 'on-map'
    }
    return modes
  })
  const [scaleOverrides, setScaleOverrides] = useState<Record<string, number>>(() => {
    const overrides: Record<string, number> = {}
    for (const c of project.courses) {
      if (c.layout) overrides[c.id] = c.layout.printScale
    }
    return overrides
  })
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({})
  const [sheetPositions, setSheetPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const pos: Record<string, { x: number; y: number }> = {}
    for (const c of project.courses) {
      if (c.layout?.clueSheet.visible) {
        pos[c.id] = { x: c.layout.clueSheet.x, y: c.layout.clueSheet.y }
      }
    }
    return pos
  })
  const [tiling, setTiling] = useState(false)
  const [previewCourseId, setPreviewCourseId] = useState<string | null>(null)
  const [submapLocks, setSubmapLocks] = useState<Record<string, boolean>>({})
  const [mapOpacity, setMapOpacity] = useState(1)
  const [mapRendering, setMapRendering] = useState<'vector' | 'raster'>(
    loadedMap?.type === 'svg' ? 'raster' : 'vector',
  )
  const [rasterDpi, setRasterDpi] = useState(300)
  const [exporting, setExporting] = useState(false)

  const options: PdfExportOptions = {
    pageSize,
    orientation,
    printScale,
    scaleOverrides,
    courseIds: [...selectedIds],
    allControls,
    descModes,
    offsets,
    sheetPositions,
    tiling,
    mapOpacity,
    mapRendering: loadedMap?.type === 'svg' ? mapRendering : undefined,
    rasterDpi: mapRendering === 'raster' ? rasterDpi : undefined,
  }

  const base = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4
  const pw = orientation === 'landscape' ? base.h : base.w
  const ph = orientation === 'landscape' ? base.w : base.h
  const printableW = pw - 2 * MARGIN
  const printableH = ph - 2 * MARGIN

  const fitScale = suggestFitScale(project, [...selectedIds], pageSize, orientation, allControls)
  const fitInfo = checkFit(project, options)
  const tileInfo = checkTiling(project, options)
  const hasSelection = selectedIds.size > 0 || allControls
  const anyOverflow = fitInfo.some(f => !f.fits)
  const descPages = project.courses
    .filter(c => selectedIds.has(c.id) && descModes[c.id] === 'separate')
    .reduce((sum, c) => sum + descriptionSheetPageCount(c, project.controls, ph), 0)
  const totalPages = (tiling
    ? tileInfo.reduce((sum, t) => sum + t.totalPages, 0)
    : fitInfo.length) + descPages
  const scalable = canExportPdf(project.map)

  const previewIds = useMemo(() => {
    const ids: string[] = []
    if (allControls) ids.push(ALL_CONTROLS_ID)
    for (const c of project.courses.filter(c => selectedIds.has(c.id))) {
      const subs = computeSubmaps(c, project.controls)
      if (subs.length > 1) {
        for (const s of subs) ids.push(submapPreviewId(c.id, s.index))
      } else {
        ids.push(c.id)
      }
    }
    return ids
  }, [project, selectedIds, allControls])
  const activePreviewId = previewCourseId && previewIds.includes(previewCourseId)
    ? previewCourseId
    : previewIds[0] ?? null
  const activeScale = activePreviewId
    ? scaleOverrides[activePreviewId] ?? printScale
    : printScale

  const activeRealCourseId = activePreviewId && activePreviewId !== ALL_CONTROLS_ID
    ? (parseSubmapPreviewId(activePreviewId)?.courseId ?? activePreviewId)
    : null
  const activeLayout = activeRealCourseId
    ? project.courses.find(c => c.id === activeRealCourseId)?.layout
    : undefined
  const activePageBase = activeLayout ? (PAGE_SIZES[activeLayout.pageSize] ?? PAGE_SIZES.a4) : null
  const activePw = activePageBase
    ? (activeLayout!.orientation === 'landscape' ? activePageBase.h : activePageBase.w)
    : pw
  const activePh = activePageBase
    ? (activeLayout!.orientation === 'landscape' ? activePageBase.w : activePageBase.h)
    : ph
  const activePrintableW = activePw - 2 * MARGIN
  const activePrintableH = activePh - 2 * MARGIN

  const activeParsed = activePreviewId ? parseSubmapPreviewId(activePreviewId) : null
  const activeLocked = activeParsed ? isSubmapLocked(activeParsed.courseId) : false

  const preview = activePreviewId
    ? coursePreviewMm(project, activePreviewId, activeScale, activeLocked)
    : null

  const activeOffset = activePreviewId ? offsets[activePreviewId] ?? { x: 0, y: 0 } : { x: 0, y: 0 }
  const hasOffset = activeOffset.x !== 0 || activeOffset.y !== 0

  const activeDescKey = activeRealCourseId ?? activePreviewId
  const previewCourse = activePreviewId && activePreviewId !== ALL_CONTROLS_ID && activeDescKey && descModes[activeDescKey] === 'on-map'
    ? project.courses.find(c => c.id === activeRealCourseId)
    : null
  const sheetSize = previewCourse
    ? descriptionSheetSize(previewCourse, project.controls)
    : null
  const activeSheetPos = activePreviewId ? sheetPositions[activePreviewId] ?? { x: MARGIN, y: MARGIN } : { x: MARGIN, y: MARGIN }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  async function handleExport() {
    setExporting(true)
    try {
      const blob = await exportCoursePdf(project, options, loadedMap)
      downloadBlob(blob, `${project.meta.name.replace(/\s+/g, '_')}_courses.pdf`)
      onClose()
    } finally {
      setExporting(false)
    }
  }

  function toggleCourse(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(project.courses.map(c => c.id)))
  }

  function selectNone() {
    setSelectedIds(new Set())
  }

  function isSubmapLocked(courseId: string): boolean {
    return submapLocks[courseId] !== false
  }

  function toggleSubmapLock(courseId: string) {
    setSubmapLocks(prev => ({ ...prev, [courseId]: prev[courseId] === false }))
  }

  function siblingSubmapIds(id: string): string[] {
    const parsed = parseSubmapPreviewId(id)
    if (!parsed) return []
    return previewIds.filter(pid => {
      const p = parseSubmapPreviewId(pid)
      return p && p.courseId === parsed.courseId && pid !== id
    })
  }

  function resetOffset() {
    if (!activePreviewId) return
    const parsed = parseSubmapPreviewId(activePreviewId)
    if (parsed && isSubmapLocked(parsed.courseId)) {
      setOffsets(prev => {
        const next = { ...prev }
        delete next[activePreviewId]
        for (const sib of siblingSubmapIds(activePreviewId)) delete next[sib]
        return next
      })
    } else {
      setOffsets(prev => {
        const next = { ...prev }
        delete next[activePreviewId]
        return next
      })
    }
  }

  function setActiveOffset(x: number, y: number) {
    if (!activePreviewId) return
    const parsed = parseSubmapPreviewId(activePreviewId)
    if (parsed && isSubmapLocked(parsed.courseId)) {
      setOffsets(o => {
        const next = { ...o, [activePreviewId]: { x, y } }
        for (const sib of siblingSubmapIds(activePreviewId)) {
          next[sib] = { x, y }
        }
        return next
      })
    } else {
      setOffsets(prev => ({ ...prev, [activePreviewId]: { x, y } }))
    }
  }

  function setActiveSheetPos(x: number, y: number) {
    if (!activePreviewId) return
    setSheetPositions(prev => ({ ...prev, [activePreviewId]: { x, y } }))
  }

  function setActiveScaleOverride(value: string) {
    if (!activePreviewId) return
    const parsed = parseSubmapPreviewId(activePreviewId)
    const locked = parsed && isSubmapLocked(parsed.courseId)
    if (value === '') {
      setScaleOverrides(prev => {
        const next = { ...prev }
        delete next[activePreviewId]
        if (locked) for (const sib of siblingSubmapIds(activePreviewId)) delete next[sib]
        return next
      })
    } else {
      const v = parseInt(value)
      if (!isNaN(v) && v > 0) {
        setScaleOverrides(prev => {
          const next = { ...prev, [activePreviewId]: v }
          if (locked) for (const sib of siblingSubmapIds(activePreviewId)) next[sib] = v
          return next
        })
      }
    }
  }

  function resetActiveScaleOverride() {
    if (!activePreviewId) return
    const parsed = parseSubmapPreviewId(activePreviewId)
    const locked = parsed && isSubmapLocked(parsed.courseId)
    setScaleOverrides(prev => {
      const next = { ...prev }
      delete next[activePreviewId]
      if (locked) for (const sib of siblingSubmapIds(activePreviewId)) delete next[sib]
      return next
    })
  }

  function blurActiveScaleOverride(value: string) {
    if (!activePreviewId) return
    if (value === '') return
    const v = parseInt(value)
    if (isNaN(v) || v <= 0) resetActiveScaleOverride()
  }

  function setAllDescModes(mode: DescMode) {
    const next: Record<string, DescMode> = { ...descModes }
    for (const id of selectedIds) next[id] = mode
    setDescModes(next)
  }

  function handleScaleBlur() {
    const v = parseInt(scaleInput)
    if (!isNaN(v) && v > 0) { setPrintScale(v); setScaleInput(String(v)) }
    else setScaleInput(String(printScale))
  }

  function resetScale() {
    setPrintScale(project.map.scale)
    setScaleInput(String(project.map.scale))
  }

  function applyFitScale() {
    if (!fitScale) return
    setPrintScale(fitScale)
    setScaleInput(String(fitScale))
  }

  return {
    project,
    loadedMap,

    // Page config
    pageSize, setPageSize,
    orientation, setOrientation,
    printScale, scaleInput, setScaleInput,
    handleScaleBlur, resetScale, applyFitScale,

    // Selection
    selectedIds, allControls, setAllControls,
    toggleCourse, selectAll, selectNone,

    // Description modes
    descModes, setDescModes, setAllDescModes,

    // Scale overrides
    scaleOverrides, setActiveScaleOverride, resetActiveScaleOverride, blurActiveScaleOverride,

    // Offsets & positioning
    offsets, activeOffset, hasOffset, resetOffset, setActiveOffset,
    sheetPositions, activeSheetPos, setActiveSheetPos,
    sheetSize,

    // Map
    mapOpacity, setMapOpacity,
    mapRendering, setMapRendering,
    rasterDpi, setRasterDpi,
    isSvgMap: loadedMap?.type === 'svg',

    // Tiling
    tiling, setTiling,

    // Preview
    previewIds, activePreviewId, setPreviewCourseId,
    activeScale, preview,
    isSubmapLocked, toggleSubmapLock,

    // Derived
    pw, ph, printableW, printableH,
    activePw, activePh, activePrintableW, activePrintableH,
    activeLayout,
    fitScale, fitInfo, tileInfo,
    hasSelection, anyOverflow, totalPages, scalable,

    // Actions
    exporting, handleExport,
  }
}
