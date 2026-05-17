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
      const annotation: Annotation = { id: uuidv4(), type, points }
      h.mutateProject(p => { p.annotations.push(annotation) })
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
    },

    cancelAnnotation: () => {
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
    },

    deleteAnnotation: (id: string) => {
      h.mutateProject(p => { p.annotations = p.annotations.filter(a => a.id !== id) })
    },
  }
}
