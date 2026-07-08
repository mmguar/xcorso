import type { MapPoint, CourseLayout, SubmapLayout, LayoutElementPosition, LayoutDefaults, MapBorder, Course, Control, CourseControl, MapConfig } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { MARGIN, PAGE_SIZES, mmToMap } from '../lib/pdfExport'
import { controlsById, computeSubmaps, submapLayoutView } from '../lib/courseUtils'

/** Swap border dimensions (and margins) when page orientation changes. */
function flipMapBorder(border: MapBorder): MapBorder {
  return {
    ...border,
    x: border.y,
    y: border.x,
    width: border.height,
    height: border.width,
  }
}

function pageDimensions(pageSize: CourseLayout['pageSize'], orientation: CourseLayout['orientation']) {
  const base = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4
  return {
    w: orientation === 'landscape' ? base.h : base.w,
    h: orientation === 'landscape' ? base.w : base.h,
  }
}

function resizeMapBorderToPage(border: MapBorder, pageSize: CourseLayout['pageSize'], orientation: CourseLayout['orientation']): MapBorder {
  const { w: pw, h: ph } = pageDimensions(pageSize, orientation)
  const rightMargin = pw - border.x - border.width > 0 ? pw - border.x - border.width : border.x
  const bottomMargin = ph - border.y - border.height > 0 ? ph - border.y - border.height : border.y
  return {
    ...border,
    width: Math.max(20, pw - border.x - rightMargin),
    height: Math.max(20, ph - border.y - bottomMargin),
  }
}

function adjustMapBorderForLayoutChange(
  border: MapBorder,
  prev: { pageSize: CourseLayout['pageSize']; orientation: CourseLayout['orientation'] },
  next: { pageSize: CourseLayout['pageSize']; orientation: CourseLayout['orientation'] },
): MapBorder {
  const orientChanged = prev.orientation !== next.orientation
  const pageChanged = prev.pageSize !== next.pageSize
  if (orientChanged && !pageChanged) return flipMapBorder(border)
  if (orientChanged && pageChanged) return resizeMapBorderToPage(flipMapBorder(border), next.pageSize, next.orientation)
  if (pageChanged) return resizeMapBorderToPage(border, next.pageSize, next.orientation)
  return border
}

export function getLayoutDefaults(get: GetState): LayoutDefaults {
  const project = get().project!
  return project.layoutDefaults ?? {
    pageSize: 'a4',
    orientation: 'portrait',
    printScale: project.map.scale,
    mapOpacity: 1,
    mapRendering: 'raster',
    rasterDpi: 300,
  }
}

function defaultLayout(courseId: string, get: GetState): CourseLayout {
  const state = get()
  const project = state.project!
  const map = project.map
  const course = project.courses.find(c => c.id === courseId)
  const defaults = getLayoutDefaults(get)

  let center: MapPoint = { x: map.width / 2, y: map.height / 2 }
  if (course) {
    const controlMap = controlsById(project.controls)
    const positions = course.controls
      .map(cc => controlMap.get(cc.controlId))
      .filter(Boolean)
      .map(c => c!.position)
    if (positions.length > 0) {
      const xs = positions.map(p => p.x)
      const ys = positions.map(p => p.y)
      center = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      }
    }
  }

  const layout: CourseLayout = {
    pageSize: defaults.pageSize,
    orientation: defaults.orientation,
    printScale: defaults.printScale,
    mapCenter: center,
    clueSheet: { x: MARGIN, y: MARGIN, visible: false },
    included: true,
  }
  if (defaults.mapBorder) {
    layout.mapBorder = { ...defaults.mapBorder }
  }
  return layout
}

/** Centroid of a submap's control positions, falling back to the map centre. */
function controlsCenter(controls: CourseControl[], controlMap: Map<string, Control>, map: MapConfig): MapPoint {
  const positions = controls
    .map(cc => controlMap.get(cc.controlId))
    .filter(Boolean)
    .map(c => c!.position)
  if (positions.length === 0) return { x: map.width / 2, y: map.height / 2 }
  const xs = positions.map(p => p.x)
  const ys = positions.map(p => p.y)
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
}

/** Build a fresh SubmapLayout for an additional submap, inheriting page/scale/border from submap 0. */
function makeSubmapLayout(template: SubmapLayout, controls: CourseControl[], controlMap: Map<string, Control>, map: MapConfig): SubmapLayout {
  return {
    pageSize: template.pageSize,
    orientation: template.orientation,
    printScale: template.printScale,
    mapCenter: controlsCenter(controls, controlMap, map),
    clueSheet: { x: MARGIN, y: MARGIN, visible: template.clueSheet.visible },
    mapBorder: template.mapBorder ? { ...template.mapBorder } : undefined,
  }
}

/** True when course.layout.submapLayouts already matches the course's submap count. */
function submapLayoutsInSync(course: Course): boolean {
  if (!course.layout) return true
  const need = computeSubmaps(course).length - 1
  const have = course.layout.submapLayouts?.length ?? 0
  return need === have
}

/**
 * Reconcile course.layout.submapLayouts (entries for submaps 1..N-1) with the
 * course's current submap count. Pads new entries from submap 0's template,
 * trims extras, and clears the array entirely for single-map courses.
 * Mutates the (draft) course in place.
 */
function ensureSubmapLayouts(course: Course, map: MapConfig, controlMap: Map<string, Control>): void {
  if (!course.layout) return
  const submaps = computeSubmaps(course)
  const need = submaps.length - 1
  if (need <= 0) {
    if (course.layout.submapLayouts) course.layout.submapLayouts = undefined
    return
  }
  const existing = course.layout.submapLayouts ?? []
  const next: SubmapLayout[] = []
  for (let i = 1; i <= need; i++) {
    next.push(existing[i - 1] ?? makeSubmapLayout(course.layout, submaps[i].controls, controlMap, map))
  }
  course.layout.submapLayouts = next
}

export function createLayoutSlice(set: SetState, get: GetState, h: StoreHelpers) {
  return {
    enterLayoutMode: (courseId: string) => {
      const state = get()
      const project = state.project
      if (!project) return

      const course = project.courses.find(c => c.id === courseId)
      if (!course) return

      if (!course.layout || !submapLayoutsInSync(course)) {
        h.mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (!c) return
          if (!c.layout) c.layout = defaultLayout(courseId, get)
          ensureSubmapLayouts(c, p.map, controlsById(p.controls))
        }, 'Initialize layout')
      }

      // Layout mode previews the PDF page, so the canvas must show only the
      // active submap's legs/controls — selectedSubmapIndex drives that
      // filtering in LegsLayer/ControlsLayer and stays in sync below.
      const hasSubmaps = computeSubmaps(course).length > 1
      set(state => ({
        editor: {
          ...state.editor,
          layoutMode: true,
          layoutCourseId: courseId,
          layoutSubmapIndex: 0,
          selectedSubmapIndex: hasSubmaps ? 0 : null,
          measureMode: false,
          measureCourseId: null,
          selectedCourseId: courseId,
          courseViewMode: 'single',
          selectedControlId: null,
          selectedOverlayId: null,
          selectedAnnotationId: null,
          activeTool: 'select',
          pendingAnnotationPoints: [],
        },
      }))
    },

    exitLayoutMode: () => {
      set(state => ({
        editor: {
          ...state.editor,
          layoutMode: false,
          layoutCourseId: null,
          layoutSubmapIndex: 0,
          selectedSubmapIndex: null,
        },
      }))
    },

    setLayoutSubmap: (index: number) => {
      set(state => ({
        editor: {
          ...state.editor,
          layoutSubmapIndex: index,
          selectedSubmapIndex: index,
          layoutSnapRequest: state.editor.layoutSnapRequest + 1,
        },
      }))
    },

    updateCourseLayout: (courseId: string, updates: Partial<SubmapLayout & Pick<CourseLayout, 'included' | 'descMode'>>, submapIndex = 0) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        ensureSubmapLayouts(course, p.map, controlsById(p.controls))
        // Course-level fields live on the CourseLayout regardless of submap.
        const { included, descMode, ...submapUpdates } = updates
        if (included !== undefined) course.layout.included = included
        if (descMode !== undefined) {
          course.layout.descMode = descMode
          // Clue sheets are per-submap; mirror the course-level mode onto each.
          const showOnMap = descMode === 'on-map' || descMode === 'both'
          course.layout.clueSheet.visible = showOnMap
          for (const sl of course.layout.submapLayouts ?? []) sl.clueSheet.visible = showOnMap
        }
        const target = submapLayoutView(course.layout, submapIndex)
        if (!target) return
        const prev = { pageSize: target.pageSize, orientation: target.orientation }
        Object.assign(target, submapUpdates)
        if (target.mapBorder && (submapUpdates.pageSize != null || submapUpdates.orientation != null)) {
          target.mapBorder = adjustMapBorderForLayoutChange(
            target.mapBorder,
            prev,
            { pageSize: target.pageSize, orientation: target.orientation },
          )
        }
      }, 'Update layout')
    },

    moveCourseLayout: (courseId: string, updates: Partial<SubmapLayout>, submapIndex = 0) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const target = submapLayoutView(course.layout, submapIndex)
        if (!target) return
        Object.assign(target, updates)
      })
    },

    updateLayoutDefaults: (updates: Partial<LayoutDefaults>) => {
      const oldDefaults = getLayoutDefaults(get)
      h.mutateProject(p => {
        if (!p.layoutDefaults) {
          p.layoutDefaults = { ...oldDefaults }
        }
        const prev = { ...p.layoutDefaults }
        const prevBorder: MapBorder | undefined = prev.mapBorder ? { ...prev.mapBorder } : undefined
        Object.assign(p.layoutDefaults, updates)

        if (p.layoutDefaults.mapBorder && (updates.pageSize != null || updates.orientation != null)) {
          p.layoutDefaults.mapBorder = adjustMapBorderForLayoutChange(
            p.layoutDefaults.mapBorder,
            { pageSize: prev.pageSize, orientation: prev.orientation },
            { pageSize: p.layoutDefaults.pageSize, orientation: p.layoutDefaults.orientation },
          )
        }

        // Cascade page/orientation/scale/border to every submap layout that still
        // matches the old defaults (i.e. hasn't been overridden per submap).
        const cascade = (sl: SubmapLayout) => {
          const pageSizeChanged = updates.pageSize != null && sl.pageSize === prev.pageSize
          const orientationChanged = updates.orientation != null && sl.orientation === prev.orientation

          if (pageSizeChanged) sl.pageSize = updates.pageSize!
          if (orientationChanged) sl.orientation = updates.orientation!
          if (updates.printScale != null && sl.printScale === prev.printScale) {
            sl.printScale = updates.printScale
          }

          if ('mapBorder' in updates) {
            const cb = sl.mapBorder
            const matchesOld = (!cb && !prevBorder) ||
              (cb && prevBorder && cb.x === prevBorder.x && cb.y === prevBorder.y &&
               cb.color === prevBorder.color && cb.strokeWidth === prevBorder.strokeWidth)
            if (matchesOld) {
              const nb = p.layoutDefaults!.mapBorder
              sl.mapBorder = nb ? { ...nb } : undefined
            }
          }

          if ((pageSizeChanged || orientationChanged) && sl.mapBorder && !('mapBorder' in updates)) {
            sl.mapBorder = adjustMapBorderForLayoutChange(
              sl.mapBorder,
              { pageSize: prev.pageSize, orientation: prev.orientation },
              { pageSize: sl.pageSize, orientation: sl.orientation },
            )
          }
        }

        for (const course of p.courses) {
          if (!course.layout) continue
          cascade(course.layout)
          for (const sl of course.layout.submapLayouts ?? []) cascade(sl)
        }
      }, 'Update layout defaults')
    },

    ensureAllCourseLayouts: () => {
      const project = get().project
      if (!project) return
      const needsWork = project.courses.some(c => !c.layout || !submapLayoutsInSync(c))
      if (!needsWork) return
      h.mutateProject(p => {
        const controlMap = controlsById(p.controls)
        for (const course of p.courses) {
          if (!course.layout) {
            course.layout = defaultLayout(course.id, get)
          }
          ensureSubmapLayouts(course, p.map, controlMap)
        }
      }, 'Initialize layouts')
    },

    beginLayoutDrag: () => h.pushUndoSnapshot('Move layout element'),

    setLayoutMapCenter: (courseId: string, center: MapPoint, submapIndex = 0) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const layout = submapLayoutView(course.layout, submapIndex)
        if (!layout) return
        const dx = center.x - layout.mapCenter.x
        const dy = center.y - layout.mapCenter.y
        layout.mapCenter = center
        if (layout.overlayPositions) {
          // New object reference so the memoized OverlaysLayer re-renders.
          const shifted: Record<string, MapPoint> = {}
          for (const id of Object.keys(layout.overlayPositions)) {
            const pos = layout.overlayPositions[id]
            shifted[id] = { x: pos.x + dx, y: pos.y + dy }
          }
          layout.overlayPositions = shifted
        }
      })
    },

    updateLayoutElement: (courseId: string, element: string, pos: Partial<LayoutElementPosition>, submapIndex = 0) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const layout = submapLayoutView(course.layout, submapIndex)
        if (!layout) return
        if (element === 'clueSheet') {
          Object.assign(layout.clueSheet, pos)
        } else if (element.startsWith('clueSheetPart:')) {
          const idx = parseInt(element.split(':')[1])
          if (layout.clueSheetParts?.[idx]) {
            Object.assign(layout.clueSheetParts[idx], pos)
          }
        } else if (element.startsWith('overlay:') && pos.x != null && pos.y != null) {
          const overlayId = element.slice('overlay:'.length)
          const map = p.map
          const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
          const pw = layout.orientation === 'landscape' ? base.h : base.w
          const ph = layout.orientation === 'landscape' ? base.w : base.h
          const hwMap = mmToMap({ x: pw / 2, y: 0 }, map, layout.printScale).x
          const hhMap = mmToMap({ x: 0, y: ph / 2 }, map, layout.printScale).y
          const mapPerMm = (hwMap * 2) / pw
          const mapPos: MapPoint = {
            x: (layout.mapCenter.x - hwMap) + pos.x * mapPerMm,
            y: (layout.mapCenter.y - hhMap) + pos.y * mapPerMm,
          }
          // New object reference so the memoized OverlaysLayer re-renders.
          layout.overlayPositions = { ...layout.overlayPositions, [overlayId]: mapPos }
        }
      })
    },

    requestLayoutSnap: () => {
      set(s => ({ editor: { ...s.editor, layoutSnapRequest: s.editor.layoutSnapRequest + 1 } }))
    },

    addClueSheetBreak: (courseId: string, controlIndex: number, submapIndex = 0) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const layout = submapLayoutView(course.layout, submapIndex)
        if (!layout) return
        const breaks = layout.clueSheetBreaks ?? []
        if (breaks.includes(controlIndex)) return
        const newBreaks = [...breaks, controlIndex].sort((a, b) => a - b)
        const insertPos = newBreaks.indexOf(controlIndex)
        const parts = layout.clueSheetParts ?? []
        const newParts = [...parts]
        newParts.splice(insertPos, 0, {
          x: layout.clueSheet.x + 60,
          y: layout.clueSheet.y,
          visible: true,
        })
        layout.clueSheetBreaks = newBreaks
        layout.clueSheetParts = newParts
      }, 'Add clue sheet break')
    },

    removeClueSheetBreak: (courseId: string, breakIndex: number, submapIndex = 0) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const layout = submapLayoutView(course.layout, submapIndex)
        if (!layout?.clueSheetBreaks) return
        const breaks = [...layout.clueSheetBreaks]
        breaks.splice(breakIndex, 1)
        const parts = [...(layout.clueSheetParts ?? [])]
        parts.splice(breakIndex, 1)
        layout.clueSheetBreaks = breaks.length > 0 ? breaks : undefined
        layout.clueSheetParts = parts.length > 0 ? parts : undefined
      }, 'Remove clue sheet break')
    },

    setLayoutOverlayPosition: (courseId: string, overlayId: string, position: MapPoint, submapIndex = 0) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const layout = submapLayoutView(course.layout, submapIndex)
        if (!layout) return
        // New object reference so the memoized OverlaysLayer re-renders.
        layout.overlayPositions = { ...layout.overlayPositions, [overlayId]: position }
      })
    },
  }
}
