import { v4 as uuidv4 } from 'uuid'
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
      const annotation: Annotation = { id: uuidv4(), type, points,
        ...(type === 'north_arrow' ? { color: '#38bdf8' } : {}),
      }
      h.mutateProject(p => { p.annotations.push(annotation) })
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
    },

    cancelAnnotation: () => {
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
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
        p.annotations = p.annotations.map(a => a.id === id ? { ...a, points: [position, ...a.points.slice(1)] } : a)
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

    setSelectedAnnotation: (id: string | null) => {
      set(state => ({ editor: { ...state.editor, selectedAnnotationId: id } }))
    },
  }
}
