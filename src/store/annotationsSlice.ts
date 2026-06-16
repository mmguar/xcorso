import type { Annotation, AnnotationType, MapPoint } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'

export function createAnnotationsSlice(set: SetState, get: GetState, h: StoreHelpers) {
  return {
    addAnnotationPoint: (point: MapPoint) => {
      set(state => ({
        editor: {
          ...state.editor,
          pendingAnnotationPoints: [...state.editor.pendingAnnotationPoints, point],
        },
      }))
    },

    commitAnnotation: (type: AnnotationType) => {
      const { editor } = get()
      const points = editor.pendingAnnotationPoints
      if (points.length === 0) return
      const annotation: Annotation = { id: crypto.randomUUID(), type, points,
        ...(type === 'north_arrow' ? { color: '#38bdf8' } : {}),
      }
      h.mutateProject(p => { p.annotations.push(annotation) })
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
    },

    cancelAnnotation: () => {
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
    },

    movePendingAnnotationPoint: (index: number, position: MapPoint) => {
      set(state => {
        const pts = [...state.editor.pendingAnnotationPoints]
        if (index >= 0 && index < pts.length) pts[index] = position
        return { editor: { ...state.editor, pendingAnnotationPoints: pts } }
      })
    },

    deleteAnnotation: (id: string) => {
      h.mutateProject(p => { p.annotations = p.annotations.filter(a => a.id !== id) })
      set(state => ({
        editor: { ...state.editor, selectedAnnotationId: state.editor.selectedAnnotationId === id ? null : state.editor.selectedAnnotationId },
      }))
    },

    updateAnnotation: (id: string, updates: Partial<Omit<Annotation, 'id'>>) => {
      h.mutateProject(p => {
        const i = p.annotations.findIndex(a => a.id === id)
        if (i !== -1) p.annotations[i] = { ...p.annotations[i], ...updates }
      })
    },

    beginMoveAnnotation: () => h.pushUndoSnapshot(),

    moveAnnotation: (id: string, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        p.annotations = p.annotations.map(a => {
          if (a.id !== id) return a
          if (a.type === 'out_of_bounds' || a.type === 'forbidden_route') {
            const dx = position.x - a.points[0].x
            const dy = position.y - a.points[0].y
            return { ...a, points: a.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy })) }
          }
          return { ...a, points: [position, ...a.points.slice(1)] }
        })
      })
    },

    beginMoveAnnotationVertex: () => h.pushUndoSnapshot(),

    moveAnnotationVertex: (id: string, vertexIndex: number, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        p.annotations = p.annotations.map(a => {
          if (a.id !== id || vertexIndex < 0 || vertexIndex >= a.points.length) return a
          const pts = [...a.points]
          pts[vertexIndex] = position
          return { ...a, points: pts }
        })
      })
    },

    beginRotateAnnotation: () => h.pushUndoSnapshot(),

    rotateAnnotation: (id: string, rotation: number) => {
      h.mutateProjectSilent(p => {
        p.annotations = p.annotations.map(a => a.id === id ? { ...a, rotation } : a)
      })
    },

    beginResizeAnnotation: () => h.pushUndoSnapshot(),

    resizeAnnotation: (id: string, scale: number) => {
      h.mutateProjectSilent(p => {
        p.annotations = p.annotations.map(a => a.id === id ? { ...a, scale } : a)
      })
    },

    beginElongateAnnotation: () => h.pushUndoSnapshot(),

    elongateAnnotation: (id: string, elongation: number) => {
      h.mutateProjectSilent(p => {
        p.annotations = p.annotations.map(a => a.id === id ? { ...a, elongation } : a)
      })
    },

    setSelectedAnnotation: (id: string | null) => {
      set(state => ({ editor: { ...state.editor, selectedAnnotationId: id } }))
    },
  }
}
