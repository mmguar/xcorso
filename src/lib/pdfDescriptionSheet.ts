import { jsPDF } from 'jspdf'
import type { Course, Control, ControlDescription, FinishType } from '../types'
import { getSymbol, columnFields } from './iofSymbols'
import type { SymbolDef, IofColumn } from './iofSymbols'
import { defaultControlLabel } from './courseUtils'

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

function fmtDist(m: number): string {
  const rounded = Math.round(m / 10) * 10
  if (rounded < 1000) return `${rounded} m`
  return `${(rounded / 1000).toFixed(1)} km`
}

function maxControlRows(pageH: number): number {
  const headerH = CELL + COL_HEADER_H
  return Math.floor((pageH - MARGIN_TOP - MARGIN_BOTTOM - headerH) / CELL)
}

export function descriptionSheetPageCount(
  course: Course,
  controls: Control[],
  pageH: number,
  trailingFlip?: boolean,
): number {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const count = course.controls.filter(cc => controlMap.has(cc.controlId)).length + (trailingFlip ? 1 : 0)
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
  const result: PathCmd[] = []
  const tokens = d.match(/[MLCHVZmlchvz]|[-+]?(?:\d+\.?\d*|\.\d+)/g)
  if (!tokens) return result

  let x = 0, y = 0
  let cmd = ''
  let nums: number[] = []

  function flush() {
    if (!cmd) return
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    const argsPerCmd = C === 'H' || C === 'V' ? 1 : C === 'Z' ? 0 : C === 'C' ? 6 : 2

    if (argsPerCmd === 0) {
      result.push({ cmd: 'Z', args: [] })
      return
    }

    for (let i = 0; i + argsPerCmd <= nums.length; i += argsPerCmd) {
      const chunk = nums.slice(i, i + argsPerCmd)
      switch (C) {
        case 'M': {
          const ax = rel ? x + chunk[0] : chunk[0]
          const ay = rel ? y + chunk[1] : chunk[1]
          x = ax; y = ay
          result.push({ cmd: i === 0 ? 'M' : 'L', args: [ax, ay] })
          break
        }
        case 'L': {
          x = rel ? x + chunk[0] : chunk[0]
          y = rel ? y + chunk[1] : chunk[1]
          result.push({ cmd: 'L', args: [x, y] })
          break
        }
        case 'H': {
          x = rel ? x + chunk[0] : chunk[0]
          result.push({ cmd: 'L', args: [x, y] })
          break
        }
        case 'V': {
          y = rel ? y + chunk[0] : chunk[0]
          result.push({ cmd: 'L', args: [x, y] })
          break
        }
        case 'C': {
          const args = rel
            ? [x + chunk[0], y + chunk[1], x + chunk[2], y + chunk[3], x + chunk[4], y + chunk[5]]
            : chunk
          x = args[4]; y = args[5]
          result.push({ cmd: 'C', args })
          break
        }
      }
    }
  }

  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      flush()
      cmd = t
      nums = []
    } else {
      nums.push(parseFloat(t))
    }
  }
  flush()
  return result
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

// ── Draw dimension text in a cell ───────────────────────────────────────────

function drawDimensionText(doc: jsPDF, text: string, cx: number, cy: number) {
  doc.setFont('helvetica', 'bold')
  const fontSize = text.length > 5 ? 4.5 : 5.5
  doc.setFontSize(fontSize)
  doc.setTextColor(0, 0, 0)
  doc.text(text, cx, cy + fontSize * 0.12, { align: 'center' })
}

// ── Text description helpers ────────────────────────────────────────────────

const DESC_FONT_SIZE = 7
const DESC_PADDING = 1.5
// Approximate average character width for helvetica normal at 7pt (mm)
const CHAR_W_ESTIMATE = 1.25

function buildDescriptionText(desc: ControlDescription): string {
  return COL_IDS
    .map(col => {
      const value = desc[columnFields[col]]
      if (!value) return null
      const sym = getSymbol(value)
      return sym ? sym.name : value
    })
    .filter(Boolean)
    .join(', ')
}

function estimateDescColumnWidth(course: Course, controls: Control[]): number {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const defaultW = (COLS - 2) * CELL
  let maxW = 0
  for (const cc of course.controls) {
    const ctrl = controlMap.get(cc.controlId)
    if (!ctrl) continue
    const text = buildDescriptionText(ctrl.description ?? {})
    if (!text) continue
    // Width needed for 2 lines: half the text length (ceil), times char width
    const halfLen = Math.ceil(text.length / 2)
    const needed = halfLen * CHAR_W_ESTIMATE + DESC_PADDING * 2
    if (needed > maxW) maxW = needed
  }
  return Math.max(defaultW, maxW)
}

function drawMergedDescriptionText(doc: jsPDF, text: string, x: number, y: number, w: number, h: number) {
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(DESC_FONT_SIZE)
  const maxW = w - DESC_PADDING * 2
  const lines = doc.splitTextToSize(text, maxW) as string[]
  const lineH = DESC_FONT_SIZE * 0.38
  const blockH = lines.length * lineH
  const cy = y + h / 2
  const startY = cy - blockH / 2 + lineH * 0.7
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], x + DESC_PADDING, startY + i * lineH)
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

// ── Draw IOF finish row (16.1/16.2/16.3) ───────────────────────────────────

function drawFinishIofRow(
  doc: jsPDF,
  gridX: number,
  y: number,
  finishType: FinishType,
  distM?: number,
) {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(LINE_W)
  doc.rect(gridX, y, GRID_W, CELL, 'S')

  const cy = y + CELL / 2
  const circleX = gridX + CELL * 0.55
  const finishCx = gridX + GRID_W - CELL * 0.55
  const midX = gridX + GRID_W / 2
  const circleR = CELL * 0.28
  const finishRInner = CELL * 0.18
  const sw = 0.2

  const chevronW = CELL * 0.14
  const chevronH = circleR
  const hasLines = finishType !== 'navigate'

  doc.setLineWidth(sw)
  doc.setDrawColor(0, 0, 0)

  // Last control circle
  doc.circle(circleX, cy, circleR, 'S')

  // Finish double circle
  doc.circle(finishCx, cy, circleR, 'S')
  doc.circle(finishCx, cy, finishRInner, 'S')

  function drawChevron(tipX: number, dir: '<' | '>') {
    doc.setLineWidth(sw)
    doc.setLineCap(1)
    const backX = dir === '<' ? tipX + chevronW : tipX - chevronW
    doc.line(backX, cy - chevronH, tipX, cy)
    doc.line(tipX, cy, backX, cy + chevronH)
  }

  const contentLeft = circleX + circleR + 0.5
  const contentRight = finishCx - circleR - 0.5

  // Left chevron < (navigate only)
  if (finishType === 'navigate') {
    drawChevron(contentLeft, '<')
  }

  // Right chevron > (always)
  drawChevron(contentRight, '>')

  // Distance text
  if (distM != null) {
    doc.setFontSize(5.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    doc.text(fmtDist(distM), midX, cy + 0.8, { align: 'center' })
  }

  // Dashes (taped: 3+3, funnel: [space]+>+2 on left / 3 on right, navigate: none)
  if (hasLines) {
    const leftDashCount = 3
    const rightDashCount = 3
    const dashGapRatio = 1.8
    const textHalfW = distM != null ? CELL * 0.55 : 0

    const leftStart = contentLeft
    const leftEnd = midX - textHalfW - 0.3
    const leftTotal = leftEnd - leftStart
    const leftDashLen = leftTotal / (leftDashCount + (leftDashCount - 1) / dashGapRatio)
    const leftGapLen = leftDashLen / dashGapRatio

    doc.setLineWidth(sw)
    doc.setLineCap(1)

    if (finishType === 'funnel') {
      const dash1X = leftStart + leftDashLen + leftGapLen
      const tipX = dash1X
      const backX = tipX - chevronW
      doc.setLineCap(1)
      doc.line(backX, cy - chevronH, tipX, cy)
      doc.line(tipX, cy, backX, cy + chevronH)
    }

    const leftSkip = finishType === 'funnel' ? 1 : 0
    for (let i = leftSkip; i < leftDashCount; i++) {
      const x1 = leftStart + i * (leftDashLen + leftGapLen)
      doc.line(x1, cy, x1 + leftDashLen, cy)
    }

    const rightStart = midX + textHalfW + 0.3
    const rightEnd = contentRight - chevronW - 0.3
    const rightTotal = rightEnd - rightStart
    const rightDashLen = rightTotal / (rightDashCount + (rightDashCount - 1) / dashGapRatio)
    const rightGapLen = rightDashLen / dashGapRatio

    for (let i = 0; i < rightDashCount; i++) {
      const x1 = rightStart + i * (rightDashLen + rightGapLen)
      doc.line(x1, cy, x1 + rightDashLen, cy)
    }
  }
}

// ── Draw IOF map flip row (15.3) ──────────────────────────────────────────

function drawFlipRow(doc: jsPDF, gridX: number, y: number, gridW: number) {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(LINE_W)
  doc.rect(gridX, y, gridW, CELL, 'S')

  const cx = gridX + gridW / 2
  const cy = y + CELL / 2

  // Scale the IOF flip symbol SVG to fit inside the row
  // Original viewBox: -82,-18 to 156,52 → width=238, height=70
  const svgW = 238
  const svgH = 70
  const svgCx = -82 + svgW / 2  // 37
  const svgCy = -18 + svgH / 2  // 17

  const maxH = CELL * 0.75
  const maxW = gridW * 0.35
  const s = Math.min(maxW / svgW, maxH / svgH)

  function tx(svgX: number): number { return cx + (svgX - svgCx) * s }
  function ty(svgY: number): number { return cy + (svgY - svgCy) * s }

  // Rectangle (map outline)
  const sw = 3.22857 * s
  doc.setLineWidth(Math.max(sw, 0.15))
  doc.rect(tx(-80.36), ty(-17.21), 134.92 * s, 66.97 * s, 'S')

  // Curved arrow (filled)
  doc.setFillColor(0, 0, 0)
  doc.moveTo(tx(49.30), ty(11.02))
  doc.lineTo(tx(49.30), ty(17.92))
  doc.lineTo(tx(8.27), ty(2.82))
  doc.lineTo(tx(49.96), ty(-14.91))
  doc.lineTo(tx(49.96), ty(-6.38))
  doc.curveTo(tx(65.39), ty(-8.86), tx(83.21), ty(-4.49), tx(93.95), ty(13.97))
  doc.curveTo(tx(98.97), ty(26.39), tx(89.35), ty(35.01), tx(77.62), ty(40.72))
  doc.curveTo(tx(69.52), ty(44.67), tx(60.72), ty(49.00), tx(54.56), ty(49.75))
  doc.curveTo(tx(64.53), ty(43.02), tx(82.36), ty(37.72), tx(77.53), ty(24.48))
  doc.curveTo(tx(73.27), ty(16.67), tx(68.17), ty(9.39), tx(49.30), ty(11.02))
  doc.close()
  doc.fill()
}

// ── Size calculation ────────────────────────────────────────────────────────

export function descriptionSheetSize(
  course: Course,
  controls: Control[],
  trailingFlip?: boolean,
): { width: number; height: number } {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const rowCount = course.controls.filter(cc => controlMap.has(cc.controlId)).length + (trailingFlip ? 1 : 0)
  if (rowCount === 0) return { width: 0, height: 0 }
  const height = CELL + COL_HEADER_H + rowCount * CELL
  const width = course.textDescriptions
    ? 2 * CELL + estimateDescColumnWidth(course, controls)
    : GRID_W
  return { width, height }
}

export function descriptionSheetPartSizes(
  course: Course,
  controls: Control[],
  breaks: number[],
  trailingFlip?: boolean,
): Array<{ width: number; height: number }> {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const resolved = course.controls.filter(cc => controlMap.has(cc.controlId))
  if (resolved.length === 0) return [{ width: 0, height: 0 }]

  const width = course.textDescriptions
    ? 2 * CELL + estimateDescColumnWidth(course, controls)
    : GRID_W

  const sortedBreaks = [...breaks].sort((a, b) => a - b)
  const boundaries = [0, ...sortedBreaks, resolved.length]
  const sizes: Array<{ width: number; height: number }> = []

  for (let p = 0; p < boundaries.length - 1; p++) {
    const start = boundaries[p]
    const end = boundaries[p + 1]
    let rowCount = end - start
    if (p === boundaries.length - 2 && trailingFlip) rowCount++
    const headerH = p === 0 ? CELL + COL_HEADER_H : COL_HEADER_H
    sizes.push({ width, height: headerH + rowCount * CELL })
  }

  return sizes
}

// ── Draw overlay on existing page ───────────────────────────────────────────

export function drawDescriptionSheetOverlay(
  doc: jsPDF,
  course: Course,
  controls: Control[],
  mapScale: number,
  originX: number,
  originY: number,
  distanceM?: number,
  textDescriptions?: boolean,
  legDistances?: number[],
  trailingFlip?: boolean,
) {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const resolved = course.controls
    .map(cc => controlMap.get(cc.controlId))
    .filter((c): c is Control => c != null)

  if (resolved.length === 0) return

  const { width, height } = descriptionSheetSize(course, controls, trailingFlip)
  const descW = width - 2 * CELL

  // White background
  doc.setFillColor(255, 255, 255)
  doc.rect(originX, originY, width, height, 'F')

  const gridX = originX
  let y = originY
  let seq = 0

  // Course header
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(LINE_W)
  doc.rect(gridX, y, width, CELL, 'S')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  let label = course.name
  if (mapScale > 0) label += `    1:${mapScale.toLocaleString()}`
  if (distanceM && distanceM > 0) label += `    ${fmtDist(distanceM)}`
  if (course.climb != null && course.climb > 0) label += `    ${course.climb} m↑`
  doc.text(label, gridX + width / 2, y + CELL / 2 + 1, { align: 'center' })
  y += CELL

  // Column headers
  doc.setFontSize(5.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(LINE_W)
  if (textDescriptions) {
    doc.rect(gridX, y, CELL, COL_HEADER_H, 'S')
    doc.text('#', gridX + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    doc.rect(gridX + CELL, y, CELL, COL_HEADER_H, 'S')
    doc.text('Code', gridX + CELL + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    doc.rect(gridX + 2 * CELL, y, descW, COL_HEADER_H, 'S')
    doc.text('Description', gridX + 2 * CELL + descW / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
  } else {
    const headers = ['#', 'Code', 'C', 'D', 'E', 'F', 'G', 'H']
    for (let c = 0; c < COLS; c++) {
      const cx = gridX + c * CELL
      doc.rect(cx, y, CELL, COL_HEADER_H, 'S')
      doc.text(headers[c], cx + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    }
  }
  y += COL_HEADER_H

  // Separate finish from other controls
  const nonFinish = resolved.filter(c => c.type !== 'finish')
  const finish = resolved.find(c => c.type === 'finish')
  const finishIdx = resolved.findIndex(c => c.type === 'finish')

  // Control rows (non-finish)
  for (const ctrl of nonFinish) {
    if (ctrl.type === 'control') seq++
    const desc = ctrl.description ?? {}

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)

    // Columns A and B always separate
    doc.rect(gridX, y, CELL, CELL, 'S')
    doc.rect(gridX + CELL, y, CELL, CELL, 'S')

    const aCx = gridX + CELL / 2
    const aCy = y + CELL / 2
    if (ctrl.type === 'start') {
      drawStartSymbol(doc, aCx, aCy)
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
    const code = defaultControlLabel(ctrl)
    doc.text(code, bCx, bCy + 1, { align: 'center' })

    if (textDescriptions) {
      doc.rect(gridX + 2 * CELL, y, descW, CELL, 'S')
      const text = buildDescriptionText(desc)
      if (text) drawMergedDescriptionText(doc, text, gridX + 2 * CELL, y, descW, CELL)
    } else {
      for (let ci = 0; ci < COL_IDS.length; ci++) {
        doc.setLineWidth(LINE_W)
        doc.rect(gridX + (ci + 2) * CELL, y, CELL, CELL, 'S')
        const colId = COL_IDS[ci]
        const field = columnFields[colId]
        const symCode = (desc as any)[field]
        if (!symCode) continue
        const cellCx = gridX + (ci + 2) * CELL + CELL / 2
        const cellCy = y + CELL / 2
        const sym = getSymbol(symCode)
        if (sym) {
          drawIofSymbol(doc, sym, cellCx, cellCy)
        } else {
          drawDimensionText(doc, symCode, cellCx, cellCy)
        }
      }
    }

    y += CELL
  }

  // Finish row (IOF 16.1/16.2/16.3)
  if (finish) {
    const finishLegDist = finishIdx > 0 && legDistances ? legDistances[finishIdx - 1] : undefined
    drawFinishIofRow(doc, gridX, y, course.finishType ?? 'navigate', finishLegDist)
    y += CELL
  }

  if (trailingFlip) {
    drawFlipRow(doc, gridX, y, width)
  }
}

export function drawDescriptionSheetOverlayPart(
  doc: jsPDF,
  course: Course,
  controls: Control[],
  mapScale: number,
  originX: number,
  originY: number,
  partIndex: number,
  breaks: number[],
  distanceM?: number,
  textDescriptions?: boolean,
  legDistances?: number[],
  trailingFlip?: boolean,
) {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const resolved = course.controls
    .map(cc => controlMap.get(cc.controlId))
    .filter((c): c is Control => c != null)

  if (resolved.length === 0) return

  const sortedBreaks = [...breaks].sort((a, b) => a - b)
  const boundaries = [0, ...sortedBreaks, resolved.length]
  const start = boundaries[partIndex] ?? 0
  const end = boundaries[partIndex + 1] ?? resolved.length
  const partControls = resolved.slice(start, end)
  if (partControls.length === 0) return

  const isFirstPart = partIndex === 0
  const isLastPart = partIndex === boundaries.length - 2

  const fullWidth = course.textDescriptions
    ? 2 * CELL + estimateDescColumnWidth(course, controls)
    : GRID_W
  const descW = fullWidth - 2 * CELL

  const nonFinish = partControls.filter(c => c.type !== 'finish')
  const finish = partControls.find(c => c.type === 'finish')

  const rowCount = partControls.length + (isLastPart && trailingFlip ? 1 : 0)
  const headerH = isFirstPart ? CELL + COL_HEADER_H : COL_HEADER_H
  const height = headerH + rowCount * CELL

  doc.setFillColor(255, 255, 255)
  doc.rect(originX, originY, fullWidth, height, 'F')

  const gridX = originX
  let y = originY

  if (isFirstPart) {
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)
    doc.rect(gridX, y, fullWidth, CELL, 'S')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 0, 0)
    let label = course.name
    if (mapScale > 0) label += `    1:${mapScale.toLocaleString()}`
    if (distanceM && distanceM > 0) label += `    ${fmtDist(distanceM)}`
    if (course.climb != null && course.climb > 0) label += `    ${course.climb} m↑`
    doc.text(label, gridX + fullWidth / 2, y + CELL / 2 + 1, { align: 'center' })
    y += CELL
  }

  // Column headers
  doc.setFontSize(5.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 120, 120)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(LINE_W)
  if (textDescriptions) {
    doc.rect(gridX, y, CELL, COL_HEADER_H, 'S')
    doc.text('#', gridX + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    doc.rect(gridX + CELL, y, CELL, COL_HEADER_H, 'S')
    doc.text('Code', gridX + CELL + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    doc.rect(gridX + 2 * CELL, y, descW, COL_HEADER_H, 'S')
    doc.text('Description', gridX + 2 * CELL + descW / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
  } else {
    const headers = ['#', 'Code', 'C', 'D', 'E', 'F', 'G', 'H']
    for (let c = 0; c < COLS; c++) {
      const cx = gridX + c * CELL
      doc.rect(cx, y, CELL, COL_HEADER_H, 'S')
      doc.text(headers[c], cx + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    }
  }
  y += COL_HEADER_H

  // Compute sequence offset: count 'control' type entries before this part
  let seq = 0
  for (let i = 0; i < start; i++) {
    if (resolved[i].type === 'control') seq++
  }

  // Compute finish index for leg distance lookup
  const globalFinishIdx = resolved.findIndex(c => c.type === 'finish')

  for (const ctrl of nonFinish) {
    if (ctrl.type === 'control') seq++
    const desc = ctrl.description ?? {}

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)
    doc.rect(gridX, y, CELL, CELL, 'S')
    doc.rect(gridX + CELL, y, CELL, CELL, 'S')

    const aCx = gridX + CELL / 2
    const aCy = y + CELL / 2
    if (ctrl.type === 'start') {
      drawStartSymbol(doc, aCx, aCy)
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
    const code = defaultControlLabel(ctrl)
    doc.text(code, bCx, bCy + 1, { align: 'center' })

    if (textDescriptions) {
      doc.rect(gridX + 2 * CELL, y, descW, CELL, 'S')
      const text = buildDescriptionText(desc)
      if (text) drawMergedDescriptionText(doc, text, gridX + 2 * CELL, y, descW, CELL)
    } else {
      for (let ci = 0; ci < COL_IDS.length; ci++) {
        doc.setLineWidth(LINE_W)
        doc.rect(gridX + (ci + 2) * CELL, y, CELL, CELL, 'S')
        const colId = COL_IDS[ci]
        const field = columnFields[colId]
        const symCode = (desc as any)[field]
        if (!symCode) continue
        const cellCx = gridX + (ci + 2) * CELL + CELL / 2
        const cellCy = y + CELL / 2
        const sym = getSymbol(symCode)
        if (sym) {
          drawIofSymbol(doc, sym, cellCx, cellCy)
        } else {
          drawDimensionText(doc, symCode, cellCx, cellCy)
        }
      }
    }

    y += CELL
  }

  if (finish) {
    const finishLegDist = globalFinishIdx > 0 && legDistances ? legDistances[globalFinishIdx - 1] : undefined
    drawFinishIofRow(doc, gridX, y, course.finishType ?? 'navigate', finishLegDist)
    y += CELL
  }

  if (isLastPart && trailingFlip) {
    drawFlipRow(doc, gridX, y, fullWidth)
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
  distanceM?: number,
  textDescriptions?: boolean,
  legDistances?: number[],
  trailingFlip?: boolean,
) {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const resolved = course.controls
    .map(cc => controlMap.get(cc.controlId))
    .filter((c): c is Control => c != null)

  if (resolved.length === 0) return

  const { width: gridW } = descriptionSheetSize(course, controls)
  const descW = gridW - 2 * CELL
  const gridX = (pageW - gridW) / 2
  const maxRows = maxControlRows(pageH)

  let y = MARGIN_TOP
  let seq = 0
  let rowOnPage = 0

  function drawHeader() {
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)
    doc.rect(gridX, y, gridW, CELL, 'S')

    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 0, 0)
    let label = course.name
    if (mapScale > 0) label += `    1:${mapScale.toLocaleString()}`
    if (distanceM && distanceM > 0) label += `    ${fmtDist(distanceM)}`
    if (course.climb != null && course.climb > 0) label += `    ${course.climb} m↑`
    doc.text(label, gridX + gridW / 2, y + CELL / 2 + 1, { align: 'center' })

    y += CELL
  }

  function drawColumnHeaders() {
    doc.setFontSize(5.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 120, 120)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)

    if (textDescriptions) {
      doc.rect(gridX, y, CELL, COL_HEADER_H, 'S')
      doc.text('#', gridX + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
      doc.rect(gridX + CELL, y, CELL, COL_HEADER_H, 'S')
      doc.text('Code', gridX + CELL + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
      doc.rect(gridX + 2 * CELL, y, descW, COL_HEADER_H, 'S')
      doc.text('Description', gridX + 2 * CELL + descW / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
    } else {
      const headers = ['#', 'Code', 'C', 'D', 'E', 'F', 'G', 'H']
      for (let c = 0; c < COLS; c++) {
        const cx = gridX + c * CELL
        doc.rect(cx, y, CELL, COL_HEADER_H, 'S')
        doc.text(headers[c], cx + CELL / 2, y + COL_HEADER_H * 0.58, { align: 'center' })
      }
    }
    y += COL_HEADER_H
  }

  function startPage() {
    y = MARGIN_TOP
    rowOnPage = 0
    drawHeader()
    drawColumnHeaders()
  }

  const nonFinish = resolved.filter(c => c.type !== 'finish')
  const finish = resolved.find(c => c.type === 'finish')
  const finishIdx = resolved.findIndex(c => c.type === 'finish')

  startPage()

  for (const ctrl of nonFinish) {
    if (rowOnPage >= maxRows) {
      doc.addPage([pageW, pageH], pageW > pageH ? 'l' : 'p')
      startPage()
    }

    if (ctrl.type === 'control') seq++
    const desc: ControlDescription = ctrl.description ?? {}

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(LINE_W)

    // Columns A and B always separate
    doc.rect(gridX, y, CELL, CELL, 'S')
    doc.rect(gridX + CELL, y, CELL, CELL, 'S')

    // Column A: sequence / start
    const aCx = gridX + CELL / 2
    const aCy = y + CELL / 2
    if (ctrl.type === 'start') {
      drawStartSymbol(doc, aCx, aCy)
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
    const code = defaultControlLabel(ctrl)
    doc.text(code, bCx, bCy + 1, { align: 'center' })

    if (textDescriptions) {
      doc.rect(gridX + 2 * CELL, y, descW, CELL, 'S')
      const text = buildDescriptionText(desc)
      if (text) drawMergedDescriptionText(doc, text, gridX + 2 * CELL, y, descW, CELL)
    } else {
      for (let ci = 0; ci < COL_IDS.length; ci++) {
        doc.setLineWidth(LINE_W)
        doc.rect(gridX + (ci + 2) * CELL, y, CELL, CELL, 'S')
        const colId = COL_IDS[ci]
        const field = columnFields[colId]
        const symCode = desc[field]
        if (!symCode) continue

        const cellCx = gridX + (ci + 2) * CELL + CELL / 2
        const cellCy = y + CELL / 2
        const sym = getSymbol(symCode)
        if (sym) {
          drawIofSymbol(doc, sym, cellCx, cellCy)
        } else {
          drawDimensionText(doc, symCode, cellCx, cellCy)
        }
      }
    }

    y += CELL
    rowOnPage++
  }

  // Finish row (IOF 16.1/16.2/16.3)
  if (finish) {
    if (rowOnPage >= maxRows) {
      doc.addPage([pageW, pageH], pageW > pageH ? 'l' : 'p')
      startPage()
    }
    const finishLegDist = finishIdx > 0 && legDistances ? legDistances[finishIdx - 1] : undefined
    drawFinishIofRow(doc, gridX, y, course.finishType ?? 'navigate', finishLegDist)
    y += CELL
    rowOnPage++
  }

  if (trailingFlip) {
    if (rowOnPage >= maxRows) {
      doc.addPage([pageW, pageH], pageW > pageH ? 'l' : 'p')
      startPage()
    }
    drawFlipRow(doc, gridX, y, gridW)
  }
}
