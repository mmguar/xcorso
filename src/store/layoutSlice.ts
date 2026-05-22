import type { MapPoint, CourseLayout, LayoutElementPosition } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { MARGIN } from '../lib/pdfExport'

function defaultLayout(courseId: string, get: GetState): CourseLayout {
  const state = get()
  const project = state.project!
  const map = project.map
  const course = project.courses.find(c => c.id === courseId)
  const printScale = map.scale

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
    pageSize: 'a4',
    orientation: 'portrait',
    printScale,
    mapCenter: center,
    clueSheet: { x: MARGIN, y: MARGIN, visible: false },
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
          selectedCourseId: null,
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

    beginLayoutDrag: () => h.pushUndoSnapshot(),

    setLayoutMapCenter: (courseId: string, center: MapPoint) => {
      h.mutateProjectSilent(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (course?.layout) course.layout.mapCenter = center
      })
    },

    updateLayoutElement: (courseId: string, element: 'clueSheet', pos: Partial<LayoutElementPosition>) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (course?.layout) Object.assign(course.layout[element], pos)
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
