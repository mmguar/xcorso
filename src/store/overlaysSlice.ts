import type { MapPoint, ScaleBar, TextLabel, ImageOverlay } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'

export function createOverlaysSlice(set: SetState, _get: GetState, h: StoreHelpers) {
  return {
    addScaleBar: (position: MapPoint, scale: number): ScaleBar => {
      const sb: ScaleBar = {
        id: crypto.randomUUID(), position, segments: 3, segmentLengthM: 100, bgAlpha: 0.8, scale,
      }
      h.mutateProject(p => { p.scaleBars.push(sb) })
      set(state => ({ editor: { ...state.editor, selectedOverlayId: sb.id } }))
      return sb
    },

    updateScaleBar: (id: string, updates: Partial<Omit<ScaleBar, 'id'>>) => {
      h.mutateProject(p => {
        const i = p.scaleBars.findIndex(s => s.id === id)
        if (i !== -1) p.scaleBars[i] = { ...p.scaleBars[i], ...updates }
      })
    },

    deleteScaleBar: (id: string) => {
      h.mutateProject(p => { p.scaleBars = p.scaleBars.filter(s => s.id !== id) })
      set(state => ({
        editor: { ...state.editor, selectedOverlayId: state.editor.selectedOverlayId === id ? null : state.editor.selectedOverlayId },
      }))
    },

    beginMoveOverlay: () => h.pushUndoSnapshot(),

    moveScaleBar: (id: string, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const i = p.scaleBars.findIndex(s => s.id === id)
        if (i === -1) return
        p.scaleBars = p.scaleBars.map((s, j) => (j === i ? { ...s, position } : s))
      })
    },

    addTextLabel: (position: MapPoint): TextLabel => {
      const tl: TextLabel = {
        id: crypto.randomUUID(), position, text: 'Text', fontSizeMm: 4, color: '#000000', bgAlpha: 0,
      }
      h.mutateProject(p => { p.textLabels.push(tl) })
      set(state => ({ editor: { ...state.editor, selectedOverlayId: tl.id } }))
      return tl
    },

    updateTextLabel: (id: string, updates: Partial<Omit<TextLabel, 'id'>>) => {
      h.mutateProject(p => {
        const i = p.textLabels.findIndex(t => t.id === id)
        if (i !== -1) p.textLabels[i] = { ...p.textLabels[i], ...updates }
      })
    },

    deleteTextLabel: (id: string) => {
      h.mutateProject(p => { p.textLabels = p.textLabels.filter(t => t.id !== id) })
      set(state => ({
        editor: { ...state.editor, selectedOverlayId: state.editor.selectedOverlayId === id ? null : state.editor.selectedOverlayId },
      }))
    },

    moveTextLabel: (id: string, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const i = p.textLabels.findIndex(t => t.id === id)
        if (i === -1) return
        p.textLabels = p.textLabels.map((t, j) => (j === i ? { ...t, position } : t))
      })
    },

    addImageOverlay: (position: MapPoint, dataUrl: string, filename: string, naturalWidth: number, naturalHeight: number): ImageOverlay => {
      const defaultWidthMm = 30
      const aspect = naturalHeight / naturalWidth
      const img: ImageOverlay = {
        id: crypto.randomUUID(), position, widthMm: defaultWidthMm, heightMm: defaultWidthMm * aspect,
        dataUrl, filename, bgAlpha: 0,
      }
      h.mutateProject(p => { p.imageOverlays.push(img) })
      set(state => ({ editor: { ...state.editor, selectedOverlayId: img.id, pendingImage: null } }))
      return img
    },

    updateImageOverlay: (id: string, updates: Partial<Omit<ImageOverlay, 'id'>>) => {
      h.mutateProject(p => {
        const i = p.imageOverlays.findIndex(o => o.id === id)
        if (i !== -1) p.imageOverlays[i] = { ...p.imageOverlays[i], ...updates }
      })
    },

    deleteImageOverlay: (id: string) => {
      h.mutateProject(p => { p.imageOverlays = p.imageOverlays.filter(o => o.id !== id) })
      set(state => ({
        editor: { ...state.editor, selectedOverlayId: state.editor.selectedOverlayId === id ? null : state.editor.selectedOverlayId },
      }))
    },

    moveImageOverlay: (id: string, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const i = p.imageOverlays.findIndex(o => o.id === id)
        if (i === -1) return
        p.imageOverlays = p.imageOverlays.map((o, j) => (j === i ? { ...o, position } : o))
      })
    },

    resizeImageOverlay: (id: string, widthMm: number, heightMm: number) => {
      h.mutateProjectSilent(p => {
        const i = p.imageOverlays.findIndex(o => o.id === id)
        if (i === -1) return
        p.imageOverlays = p.imageOverlays.map((o, j) => (j === i ? { ...o, widthMm, heightMm } : o))
      })
    },

    setPendingImage: (data: { dataUrl: string; filename: string; naturalWidth: number; naturalHeight: number } | null) => {
      set(state => ({ editor: { ...state.editor, pendingImage: data } }))
    },
  }
}
