import type { MapPoint } from '../types'
import { legKey } from '../lib/distance'
import type { SetState, GetState, StoreHelpers } from './types'

/**
 * CRUD on `project.measuredLegs` — the shared, per-leg route polylines used only
 * for measuring actual course length. Keyed by `${fromControlId}__${toControlId}`.
 * Values are the intermediate waypoints (control centres are the implicit endpoints).
 */
export function createMeasureSlice(_set: SetState, _get: GetState, h: StoreHelpers) {
  return {
    addMeasurePoint: (fromControlId: string, toControlId: string, point: MapPoint, index?: number) => {
      h.mutateProject(p => {
        if (!p.measuredLegs) p.measuredLegs = {}
        const key = legKey(fromControlId, toControlId)
        const pts = p.measuredLegs[key] ? [...p.measuredLegs[key]] : []
        if (index !== undefined) pts.splice(index, 0, point)
        else pts.push(point)
        p.measuredLegs[key] = pts
      }, 'Add measure point')
    },

    beginMoveMeasurePoint: () => h.pushUndoSnapshot('Move measure point'),

    moveMeasurePoint: (fromControlId: string, toControlId: string, index: number, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const key = legKey(fromControlId, toControlId)
        const pts = p.measuredLegs?.[key]
        if (!pts?.[index]) return
        p.measuredLegs = {
          ...p.measuredLegs,
          [key]: pts.map((pt, j) => (j === index ? position : pt)),
        }
      })
    },

    removeMeasurePoint: (fromControlId: string, toControlId: string, index: number) => {
      h.mutateProject(p => {
        const key = legKey(fromControlId, toControlId)
        const pts = p.measuredLegs?.[key]
        if (!pts) return
        const next = pts.filter((_, j) => j !== index)
        if (next.length === 0) delete p.measuredLegs![key]
        else p.measuredLegs![key] = next
      }, 'Remove measure point')
    },

    clearMeasureLeg: (fromControlId: string, toControlId: string) => {
      h.mutateProject(p => {
        if (p.measuredLegs) delete p.measuredLegs[legKey(fromControlId, toControlId)]
      }, 'Clear measured leg')
    },
  }
}
