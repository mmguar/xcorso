import type { MapPoint, CourseLayout, LayoutElementPosition, LayoutDefaults } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { MARGIN, PAGE_SIZES, mmToMap } from '../lib/pdfExport'

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
    const controlMap = new Map(project.controls.map(c => [c.id, c]))
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

  return {
    pageSize: defaults.pageSize,
    orientation: defaults.orientation,
    printScale: defaults.printScale,
    mapCenter: center,
    clueSheet: { x: MARGIN, y: MARGIN, visible: false },
    included: true,
  }
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
        if (course?.layout) Object.assign(course.layout, updates)
      })
    },

    updateLayoutDefaults: (updates: Partial<LayoutDefaults>) => {
      const oldDefaults = getLayoutDefaults(get)
      h.mutateProject(p => {
        if (!p.layoutDefaults) {
          p.layoutDefaults = { ...oldDefaults }
        }
        const prev = { ...p.layoutDefaults }
        Object.assign(p.layoutDefaults, updates)
        for (const course of p.courses) {
          if (!course.layout) continue
          if (updates.pageSize != null && course.layout.pageSize === prev.pageSize) {
            course.layout.pageSize = updates.pageSize
          }
          if (updates.orientation != null && course.layout.orientation === prev.orientation) {
            course.layout.orientation = updates.orientation
          }
          if (updates.printScale != null && course.layout.printScale === prev.printScale) {
            course.layout.printScale = updates.printScale
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
        if (course?.layout) course.layout.mapCenter = center
      })
    },

    updateLayoutElement: (courseId: string, element: string, pos: Partial<LayoutElementPosition>) => {
      h.mutateProject(p => {
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
          if (!layout.overlayPositions) layout.overlayPositions = {}
          layout.overlayPositions[overlayId] = mapPos
        }
      })
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
        if (!course.layout.overlayPositions) course.layout.overlayPositions = {}
        course.layout.overlayPositions[overlayId] = position
      })
    },
  }
}
