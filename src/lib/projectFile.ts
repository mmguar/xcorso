/**
 * .oco project file — ZIP archive containing:
 *   project.json   — all course data
 *   map/<filename> — original map file (only when storage.mode === 'embedded')
 */

import JSZip from 'jszip'
import type { Project, MapType } from '../types'

const VALID_MAP_TYPES: MapType[] = ['ocad', 'pdf', 'bitmap']
const VALID_SPECS = ['isom-2017', 'issprm-2019']

function validateProject(raw: unknown): Project {
  if (raw == null || typeof raw !== 'object') throw new Error('project.json is not an object')
  const obj = raw as Record<string, unknown>

  if (typeof obj.version !== 'string') throw new Error('Missing or invalid version')

  if (obj.spec != null && !VALID_SPECS.includes(obj.spec as string)) obj.spec = undefined

  const meta = obj.meta
  if (meta == null || typeof meta !== 'object') throw new Error('Missing meta')
  const m = meta as Record<string, unknown>
  if (typeof m.name !== 'string') throw new Error('Missing meta.name')
  if (typeof m.createdAt !== 'string') m.createdAt = new Date().toISOString()
  if (typeof m.updatedAt !== 'string') m.updatedAt = new Date().toISOString()

  const map = obj.map
  if (map == null || typeof map !== 'object') throw new Error('Missing map config')
  const mc = map as Record<string, unknown>
  if (!VALID_MAP_TYPES.includes(mc.type as MapType)) throw new Error(`Invalid map.type: ${mc.type}`)
  if (typeof mc.filename !== 'string' || mc.filename.length === 0) throw new Error('Missing map.filename')
  if (typeof mc.scale !== 'number' || !isFinite(mc.scale) || mc.scale <= 0) mc.scale = 10000
  if (mc.storage == null || typeof mc.storage !== 'object') mc.storage = { mode: 'embedded' }

  const legacy = mc as Record<string, unknown>
  if (typeof mc.width !== 'number' || !isFinite(mc.width) || mc.width < 0) {
    const sx = legacy.size_x
    mc.width = typeof sx === 'number' && isFinite(sx) && sx >= 0 ? sx : 0
  }
  if (typeof mc.height !== 'number' || !isFinite(mc.height) || mc.height < 0) {
    const sy = legacy.size_y
    mc.height = typeof sy === 'number' && isFinite(sy) && sy >= 0 ? sy : 0
  }

  if (!Array.isArray(obj.controls)) obj.controls = []
  if (!Array.isArray(obj.courses)) obj.courses = []
  if (!Array.isArray(obj.classes)) obj.classes = []
  if (!Array.isArray(obj.annotations)) obj.annotations = []
  if (!Array.isArray(obj.scaleBars)) obj.scaleBars = []
  if (!Array.isArray(obj.textLabels)) obj.textLabels = []

  const mapScale = typeof mc.scale === 'number' && isFinite(mc.scale) && mc.scale > 0 ? mc.scale : 10000
  for (const sb of obj.scaleBars as Record<string, unknown>[]) {
    if (typeof sb.scale !== 'number' || !isFinite(sb.scale) || sb.scale <= 0) sb.scale = mapScale
  }

  for (const c of obj.controls as Record<string, unknown>[]) {
    if (typeof c.id !== 'string') c.id = crypto.randomUUID()
    if (typeof c.code !== 'number' || !isFinite(c.code)) c.code = 0
    const pos = c.position as Record<string, unknown> | undefined
    if (!pos || typeof pos.x !== 'number' || !isFinite(pos.x) || typeof pos.y !== 'number' || !isFinite(pos.y)) {
      c.position = { x: 0, y: 0 }
    }
  }

  return obj as unknown as Project
}

export async function saveProjectFile(
  project: Project,
  mapData: ArrayBuffer | null,
): Promise<Blob> {
  const zip = new JSZip()

  zip.file('project.json', JSON.stringify(project, null, 2))

  if (project.map.storage.mode === 'embedded' && mapData) {
    zip.folder('map')!.file(project.map.filename, mapData)
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export interface LoadedProjectFile {
  project: Project
  mapData: ArrayBuffer | null
}

export async function loadProjectFile(file: File): Promise<LoadedProjectFile> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const projectJson = await zip.file('project.json')?.async('string')
  if (!projectJson) throw new Error('Invalid .oco file: missing project.json')

  const project = validateProject(JSON.parse(projectJson))

  let mapData: ArrayBuffer | null = null
  if (project.map.storage.mode === 'embedded') {
    const mapFile = zip.file(`map/${project.map.filename}`)
    if (mapFile) mapData = await mapFile.async('arraybuffer')
  }

  return { project, mapData }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
