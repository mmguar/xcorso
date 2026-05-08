import { jsPDF } from 'jspdf'
import type { Course, Control, ControlDescription } from '../types'
import { getSymbol, columnFields } from './iofSymbols'
import type { SymbolDef, IofColumn } from './iofSymbols'

const CELL = 7
const COLS = 8
const GRID_W = COLS * CELL
const LINE_W = 0.25
const MARGIN_TOP = 15
const MARGIN_BOTTOM = 15

const COL_IDS: IofColumn[] = ['C', 'D', 'E', 'F', 'G', 'H']

// Stroke widths scaled from SVG viewBox (200 units) to cell size
const PATH_SW = (12.5 / 200) * CELL
const CIRCLE_SW = (10 / 200) * CELL
const FILL_SW = (1 / 200) * CELL
const INSET = 0.82
const COL_HEADER_H = CELL * 0.6

function maxControlRows(pageH: number): number {
  const headerH = CELL + COL_HEADER_H
  return Math.floor((pageH - MARGIN_TOP - MARGIN_BOTTOM - headerH) / CELL)
}

export function descriptionSheetPageCount(
  course: Course,
  controls: Control[],
  pageH: number,
): number {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const count = course.controls.filter(cc => controlMap.has(cc.controlId)).length
  if (count === 0) return 0
  const rows = maxControlRows(pageH)
  if (rows <= 0) return 1
  return Math.ceil(count / rows)
}

// ── SVG path parser (handles M, L, C, Z only) ──────────────────────────────

interface PathCmd {
  cmd: string
  args: number[]
}

function parseSvgPath(d: string): PathCmd[] {
  const cmds: PathCmd[] = []
  const tokens = d.match(/[MLCZ]|[-+]?(?:\d+\.?\d*|\.\d+)/g)
  if (!tokens) return cmds

  let cur = ''
  let args: number[] = []

  for (const t of tokens) {
    if (/^[MLCZ]$/.test(t)) {
      if (cur) cmds.push({ cmd: cur, args })
      cur = t
      args = []
    } else {
      args.push(parseFloat(t))
    }
  }
  if (cur) cmds.push({ cmd: cur, args })
  return cmds
}

// ── Draw one IOF symbol into a cell ─────────────────────────────────────────

function sv(svgVal: number, center: number): number {
  return center + (svgVal / 100) * (CELL / 2) * INSET
}

function drawIofSymbol(doc: jsPDF, sym: SymbolDef, cx: number, cy: number) {
  doc.setDrawColor(0, 0, 0)
  doc.setFillColor(0, 0, 0)

  // Filled paths
  if (sym.fills) {
    for (const d of sym.fills) {
      doc.setLineWidth(FILL_SW)
      const cmds = parseSvgPath(d)
      for (const c of cmds) {
        switch (c.cmd) {
          case 'M': doc.moveTo(sv(c.args[0], cx), sv(c.args[1], cy)); break
          case 'L': doc.lineTo(sv(c.args[0], cx), sv(c.args[1], cy)); break
          case 'C': doc.curveTo(
            sv(c.args[0], cx), sv(c.args[1], cy),
            sv(c.args[2], cx), sv(c.args[3], cy),
            sv(c.args[4], cx), sv(c.args[5], cy),
          ); break
          case 'Z': doc.close(); break
        }
      }
      doc.fill()
    }
  }

  // Stroked paths
  if (sym.paths) {
    doc.setLineWidth(PATH_SW)
    doc.setLineCap(1)
    doc.setLineJoin(1)
    for (const d of sym.paths) {
      const cmds = parseSvgPath(d)
      for (const c of cmds) {
        switch (c.cmd) {
          case 'M': doc.moveTo(sv(c.args[0], cx), sv(c.args[1], cy)); break
          case 'L': doc.lineTo(sv(c.args[0], cx), sv(c.args[1], cy)); break
          case 'C': doc.curveTo(
            sv(c.args[0], cx), sv(c.args[1], cy),
            sv(c.args[2], cx), sv(c.args[3], cy),
            sv(c.args[4], cx), sv(c.args[5], cy),
          ); break
          case 'Z': doc.close(); break
        }
      }
      doc.stroke()
    }
  }

  // Stroked circles
  if (sym.circles) {
    doc.setLineWidth(CIRCLE_SW)
    for (const [scx, scy, sr] of sym.circles) {
      doc.circle(sv(scx, cx), sv(scy, cy), sr / 100 * (CELL / 2) * INSET, 'S')
    }
  }

  // Filled circles
  if (sym.filledCircles) {
    for (const [scx, scy, sr] of sym.filledCircles) {
      doc.circle(sv(scx, cx), sv(scy, cy), sr / 100 * (CELL / 2) * INSET, 'F')
    }
  }

  // Lines
  if (sym.lines) {
    doc.setLineWidth(PATH_SW)
    doc.setLineCap(1)
    for (const [x1, y1, x2, y2] of sym.lines) {
      doc.line(sv(x1, cx), sv(y1, cy), sv(x2, cx), sv(y2, cy))
    }
  }
}

// ── Draw a small start triangle in column A ─────────────────────────────────

function drawStartSymbol(doc: jsPDF, cx: number, cy: number) {
  const s = CELL * 0.3
  const h = s * Math.sqrt(3) / 2
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)
  doc.moveTo(cx, cy - h * 0.6)
  doc.lineTo(cx + s / 2, cy + h * 0.4)
  doc.lineTo(cx - s / 2, cy + h * 0.4)
  doc.lineTo(cx, cy - h * 0.6)
  doc.stroke()
}

// ── Draw a small finish double-circle in column A ───────────────────────────

function drawFinishSymbol(doc: jsPDF, cx: number, cy: number) {
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)
  doc.circle(cx, cy, CELL * 0.25, 'S')
  doc.circle(cx, cy, CELL * 0.17, 'S')
}

// ── Size calculation ────────────────────────────────────────────────────────

export function descriptionSheetSize(
  course: Course,
  controls: Control[],
): { width: number; height: number } {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const rowCount = course.controls.filter(cc => controlMap.has(cc.controlId)).length
  if (rowCount === 0) return { width: 0, height: 0 }
  const height = CELL + COL_HEADER_H + rowCount * CELL
  return { width: GRID_W, height }
}

// ── Draw overlay on existing page ───────────────────────────────────────────

export function drawDescriptionSheetOverlay(
  doc: jsPDF,
  course: Course,
  controls: Control[],
  mapScale: number,
  originX: number,
  originY: number,
) {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const resolved = course.controls
    .map(cc => controlMap.get(cc.controlId))
    .filter((c): c is Control => c != null)

  if (resolved.length === 0) return

  const { width, height } = descriptionSheetSize(course, controls)

  // White background
  doc.setFillColor(255, 255, 255)
  doc.rect(originX, originY, width, height, 'F')

  const gridX = originX
  let y = originY
  let seq = 0

  // Course header
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(LINE_W)
  doc.rect(gridX, y, GRID_W, CELL, 'S')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  let label = course.name
  if (mapScale > 0) label += `    1:${mapScale.toLocaleString()}`
  if (course.climb != null && course.climb > 0) label += `    ${course.climb} m↑`
  doc.text(label, gridX + GRID_W / 2, y + CELL / 2 + 1, { align: 'center' })
  y += CELL

  // Column headers
  const headers = ['#', 'Code', 'C', 'D', 'E', 'F', 'G', 'H']
  doc.setFontSize(5.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(LINE_W)
  for (let c = 0; c < COLS; c++) {
    const cx = gridX + c * CELL
    doc.rect(cx, y, CELL, COL_HEADER_H, 'S')
    doc.text(headers[c], cx + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
  }
  y += COL_HEADER_H

  // Control rows
  for (const ctrl of resolved) {
    if (ctrl.type === 'control') seq++
    const desc = ctrl.description ?? {}

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)
    for (let c = 0; c < COLS; c++) {
      doc.rect(gridX + c * CELL, y, CELL, CELL, 'S')
    }

    const aCx = gridX + CELL / 2
    const aCy = y + CELL / 2
    if (ctrl.type === 'start') {
      drawStartSymbol(doc, aCx, aCy)
    } else if (ctrl.type === 'finish') {
      drawFinishSymbol(doc, aCx, aCy)
    } else {
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(0, 0, 0)
      doc.text(String(seq), aCx, aCy + 1.2, { align: 'center' })
    }

    const bCx = gridX + CELL + CELL / 2
    const bCy = y + CELL / 2
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    const code = ctrl.label ?? (ctrl.type === 'start' ? `S${ctrl.code}`
      : ctrl.type === 'finish' ? `F${ctrl.code}` : String(ctrl.code))
    doc.text(code, bCx, bCy + 1, { align: 'center' })

    for (let ci = 0; ci < COL_IDS.length; ci++) {
      const colId = COL_IDS[ci]
      const field = columnFields[colId]
      const symCode = (desc as any)[field]
      if (!symCode) continue
      const sym = getSymbol(symCode)
      if (!sym) continue
      const cellCx = gridX + (ci + 2) * CELL + CELL / 2
      const cellCy = y + CELL / 2
      drawIofSymbol(doc, sym, cellCx, cellCy)
    }

    y += CELL
  }
}

// ── Main export (separate pages) ────────────────────────────────────────────

export function drawDescriptionSheet(
  doc: jsPDF,
  course: Course,
  controls: Control[],
  mapScale: number,
  pageW: number,
  pageH: number,
) {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const resolved = course.controls
    .map(cc => controlMap.get(cc.controlId))
    .filter((c): c is Control => c != null)

  if (resolved.length === 0) return

  const gridX = (pageW - GRID_W) / 2
  const maxRows = maxControlRows(pageH)

  let y = MARGIN_TOP
  let seq = 0
  let rowOnPage = 0

  function drawHeader() {
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)
    doc.rect(gridX, y, GRID_W, CELL, 'S')

    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 0, 0)
    let label = course.name
    if (mapScale > 0) label += `    1:${mapScale.toLocaleString()}`
    if (course.climb != null && course.climb > 0) label += `    ${course.climb} m↑`
    doc.text(label, pageW / 2, y + CELL / 2 + 1, { align: 'center' })

    y += CELL
  }

  function drawColumnHeaders() {
    const headers = ['#', 'Code', 'C', 'D', 'E', 'F', 'G', 'H']
    doc.setFontSize(5.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 120, 120)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)

    for (let c = 0; c < COLS; c++) {
      const cx = gridX + c * CELL
      doc.rect(cx, y, CELL, COL_HEADER_H, 'S')
      doc.text(headers[c], cx + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    }
    y += COL_HEADER_H
  }

  function startPage() {
    y = MARGIN_TOP
    rowOnPage = 0
    drawHeader()
    drawColumnHeaders()
  }

  startPage()

  for (const ctrl of resolved) {
    if (rowOnPage >= maxRows) {
      doc.addPage([pageW, pageH], pageW > pageH ? 'l' : 'p')
      startPage()
    }

    if (ctrl.type === 'control') seq++
    const desc: ControlDescription = ctrl.description ?? {}

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)

    // Draw all cell borders for this row
    for (let c = 0; c < COLS; c++) {
      doc.rect(gridX + c * CELL, y, CELL, CELL, 'S')
    }

    // Column A: sequence / start / finish
    const aCx = gridX + CELL / 2
    const aCy = y + CELL / 2
    if (ctrl.type === 'start') {
      drawStartSymbol(doc, aCx, aCy)
    } else if (ctrl.type === 'finish') {
      drawFinishSymbol(doc, aCx, aCy)
    } else {
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(0, 0, 0)
      doc.text(String(seq), aCx, aCy + 1.2, { align: 'center' })
    }

    // Column B: control code
    const bCx = gridX + CELL + CELL / 2
    const bCy = y + CELL / 2
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    const code = ctrl.label ?? (ctrl.type === 'start' ? `S${ctrl.code}`
      : ctrl.type === 'finish' ? `F${ctrl.code}` : String(ctrl.code))
    doc.text(code, bCx, bCy + 1, { align: 'center' })

    // Columns C-H: IOF symbols
    for (let ci = 0; ci < COL_IDS.length; ci++) {
      const colId = COL_IDS[ci]
      const field = columnFields[colId]
      const symCode = desc[field]
      if (!symCode) continue

      const sym = getSymbol(symCode)
      if (!sym) continue

      const cellCx = gridX + (ci + 2) * CELL + CELL / 2
      const cellCy = y + CELL / 2
      drawIofSymbol(doc, sym, cellCx, cellCy)
    }

    y += CELL
    rowOnPage++
  }
}
