import type { MapPoint, CourseLayout, LayoutElementPosition, LayoutDefaults, MapBorder } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { MARGIN, PAGE_SIZES, mmToMap } from '../lib/pdfExport'
import { controlsById } from '../lib/courseUtils'

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

export function createLayoutSlice(set: SetState, get: GetState, h: StoreHelpers) {
  return {
    enterLayoutMode: (courseId: string) => {
      const state = get()
      const project = state.project
      if (!project) return

      const course = project.courses.find(c => c.id === courseId)
      if (!course) return

      if (!course.layout) {
        h.mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (c) c.layout = defaultLayout(courseId, get)
        })
      }

      set(state => ({
        editor: {
          ...state.editor,
          layoutMode: true,
          layoutCourseId: courseId,
          selectedCourseId: courseId,
          selectedControlId: null,
          selectedOverlayId: null,
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
        },
      }))
    },

    updateCourseLayout: (courseId: string, updates: Partial<CourseLayout>) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const prev = {
          pageSize: course.layout.pageSize,
          orientation: course.layout.orientation,
        }
        Object.assign(course.layout, updates)
        if (course.layout.mapBorder && (updates.pageSize != null || updates.orientation != null)) {
          course.layout.mapBorder = adjustMapBorderForLayoutChange(
            course.layout.mapBorder,
            prev,
            { pageSize: course.layout.pageSize, orientation: course.layout.orientation },
          )
        }
      })
    },

    moveCourseLayout: (courseId: string, updates: Partial<CourseLayout>) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        Object.assign(course.layout, updates)
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

        for (const course of p.courses) {
          if (!course.layout) continue
          const pageSizeChanged = updates.pageSize != null && course.layout.pageSize === prev.pageSize
          const orientationChanged = updates.orientation != null && course.layout.orientation === prev.orientation

          if (pageSizeChanged) course.layout.pageSize = updates.pageSize!
          if (orientationChanged) course.layout.orientation = updates.orientation!
          if (updates.printScale != null && course.layout.printScale === prev.printScale) {
            course.layout.printScale = updates.printScale
          }

          if ('mapBorder' in updates) {
            const cb = course.layout.mapBorder
            const matchesOld = (!cb && !prevBorder) ||
              (cb && prevBorder && cb.x === prevBorder.x && cb.y === prevBorder.y &&
               cb.color === prevBorder.color && cb.strokeWidth === prevBorder.strokeWidth)
            if (matchesOld) {
              const nb = p.layoutDefaults.mapBorder
              if (nb) {
                course.layout.mapBorder = { ...nb }
              } else {
                course.layout.mapBorder = undefined
              }
            }
          }

          if ((pageSizeChanged || orientationChanged) && course.layout.mapBorder && !('mapBorder' in updates)) {
            course.layout.mapBorder = adjustMapBorderForLayoutChange(
              course.layout.mapBorder,
              { pageSize: prev.pageSize, orientation: prev.orientation },
              { pageSize: course.layout.pageSize, orientation: course.layout.orientation },
            )
          }
        }
      })
    },

    ensureAllCourseLayouts: () => {
      const project = get().project
      if (!project) return
      const needsLayout = project.courses.some(c => !c.layout)
      if (!needsLayout) return
      h.mutateProject(p => {
        for (const course of p.courses) {
          if (!course.layout) {
            course.layout = defaultLayout(course.id, get)
          }
        }
      })
    },

    beginLayoutDrag: () => h.pushUndoSnapshot(),

    setLayoutMapCenter: (courseId: string, center: MapPoint) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const dx = center.x - course.layout.mapCenter.x
        const dy = center.y - course.layout.mapCenter.y
        course.layout.mapCenter = center
        if (course.layout.overlayPositions) {
          // New object reference so the memoized OverlaysLayer re-renders.
          const shifted: Record<string, MapPoint> = {}
          for (const id of Object.keys(course.layout.overlayPositions)) {
            const pos = course.layout.overlayPositions[id]
            shifted[id] = { x: pos.x + dx, y: pos.y + dy }
          }
          course.layout.overlayPositions = shifted
        }
      })
    },

    updateLayoutElement: (courseId: string, element: string, pos: Partial<LayoutElementPosition>) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        if (element === 'clueSheet') {
          Object.assign(course.layout.clueSheet, pos)
        } else if (element.startsWith('clueSheetPart:')) {
          const idx = parseInt(element.split(':')[1])
          if (course.layout.clueSheetParts?.[idx]) {
            Object.assign(course.layout.clueSheetParts[idx], pos)
          }
        } else if (element.startsWith('overlay:') && pos.x != null && pos.y != null) {
          const overlayId = element.slice('overlay:'.length)
          const layout = course.layout
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

    addClueSheetBreak: (courseId: string, controlIndex: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        const breaks = course.layout.clueSheetBreaks ?? []
        if (breaks.includes(controlIndex)) return
        const newBreaks = [...breaks, controlIndex].sort((a, b) => a - b)
        const insertPos = newBreaks.indexOf(controlIndex)
        const parts = course.layout.clueSheetParts ?? []
        const newParts = [...parts]
        newParts.splice(insertPos, 0, {
          x: course.layout.clueSheet.x + 60,
          y: course.layout.clueSheet.y,
          visible: true,
        })
        course.layout.clueSheetBreaks = newBreaks
        course.layout.clueSheetParts = newParts
      })
    },

    removeClueSheetBreak: (courseId: string, breakIndex: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout?.clueSheetBreaks) return
        const breaks = [...course.layout.clueSheetBreaks]
        breaks.splice(breakIndex, 1)
        const parts = [...(course.layout.clueSheetParts ?? [])]
        parts.splice(breakIndex, 1)
        course.layout.clueSheetBreaks = breaks.length > 0 ? breaks : undefined
        course.layout.clueSheetParts = parts.length > 0 ? parts : undefined
      })
    },

    setLayoutOverlayPosition: (courseId: string, overlayId: string, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.layout) return
        // New object reference so the memoized OverlaysLayer re-renders.
        course.layout.overlayPositions = { ...course.layout.overlayPositions, [overlayId]: position }
      })
    },
  }
}
