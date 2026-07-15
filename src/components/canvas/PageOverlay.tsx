import type { SubmapLayout, MapConfig, Viewport, Course, Control } from '../../types'
import { useStore } from '../../store'
import { PAGE_SIZES, MARGIN, mmToMap } from '../../lib/pdfExport'
import { descriptionSheetSize, descriptionSheetPartSizes } from '../../lib/pdfDescriptionSheet'

interface Props {
  layout: SubmapLayout
  map: MapConfig
  viewport: Viewport
  canvasW: number
  canvasH: number
  course: Course
  controls: Control[]
  cellSize?: number
  trailingFlip?: boolean
}

function mapToScreen(mapPt: { x: number; y: number }, vp: Viewport) {
  return { x: mapPt.x * vp.scale + vp.x, y: mapPt.y * vp.scale + vp.y }
}

export function PageOverlay({ layout, map, viewport, canvasW, canvasH, course, controls, cellSize, trailingFlip }: Props) {
  // Transient drag position (clue sheet / border) — written per-frame by the
  // MapCanvas drag handlers and committed to the project on pointerup, so only
  // this component re-renders while dragging.
  const dragPreview = useStore(s => s.editor.layoutDragPreview)

  const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
  const pageW = layout.orientation === 'landscape' ? base.h : base.w
  const pageH = layout.orientation === 'landscape' ? base.w : base.h

  const halfW = mmToMap({ x: pageW / 2, y: 0 }, map, layout.printScale).x
  const halfH = mmToMap({ x: 0, y: pageH / 2 }, map, layout.printScale).y

  const tl = mapToScreen(
    { x: layout.mapCenter.x - halfW, y: layout.mapCenter.y - halfH },
    viewport,
  )
  const br = mapToScreen(
    { x: layout.mapCenter.x + halfW, y: layout.mapCenter.y + halfH },
    viewport,
  )

  const rx = tl.x
  const ry = tl.y
  const rw = br.x - tl.x
  const rh = br.y - tl.y

  const mmToPx = rw / pageW

  function elementScreenPos(el: { x: number; y: number }, key: string) {
    const p = dragPreview?.type === 'element' && dragPreview.key === key ? dragPreview : el
    return { x: rx + p.x * mmToPx, y: ry + p.y * mmToPx }
  }

  const marginPx = MARGIN * mmToPx
  const printableX = rx + marginPx
  const printableY = ry + marginPx
  const printableW = rw - 2 * marginPx
  const printableH = rh - 2 * marginPx

  const border = layout.mapBorder && dragPreview?.type === 'border'
    ? { ...layout.mapBorder, x: dragPreview.x, y: dragPreview.y, width: dragPreview.width, height: dragPreview.height }
    : layout.mapBorder

  // Border rect in screen pixels (uses stored rect or falls back to printable area)
  const bx = border ? rx + border.x * mmToPx : printableX
  const by = border ? ry + border.y * mmToPx : printableY
  const bw = border ? border.width * mmToPx : printableW
  const bh = border ? border.height * mmToPx : printableH

  const HANDLE_R = 6

  // Masks overshoot the canvas by far: MapCanvas.syncTransform scales this
  // overlay transiently during layout-mode zoom, and the overhang keeps the
  // mask edges outside the (overflow-hidden) canvas while it does.
  const M = 8 * Math.max(canvasW, canvasH)

  return (
    <svg
      width={canvasW}
      height={canvasH}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      {/* Dark mask — four rects around the page */}
      <rect x={-M} y={-M} width={2 * M} height={M + ry} fill="black" opacity={0.35} />
      <rect x={-M} y={ry} width={M + rx} height={rh} fill="black" opacity={0.35} />
      <rect x={rx + rw} y={ry} width={M - rx - rw} height={rh} fill="black" opacity={0.35} />
      <rect x={-M} y={ry + rh} width={2 * M} height={M - ry - rh} fill="black" opacity={0.35} />

      {/* Page border */}
      <rect
        x={rx} y={ry} width={rw} height={rh}
        fill="none" stroke="#d1d5db" strokeWidth={1}
      />

      {border ? (
        <>
          {/* Grey mask between page edge and border rect — four strips (draggable to reposition border) */}
          {/* Top strip */}
          <rect x={rx} y={ry} width={rw} height={by - ry} fill="white" opacity={0.7} />
          {/* Bottom strip */}
          <rect x={rx} y={by + bh} width={rw} height={(ry + rh) - (by + bh)} fill="white" opacity={0.7} />
          {/* Left strip */}
          <rect x={rx} y={by} width={bx - rx} height={bh} fill="white" opacity={0.7} />
          {/* Right strip */}
          <rect x={bx + bw} y={by} width={(rx + rw) - (bx + bw)} height={bh} fill="white" opacity={0.7} />
          {/* Border line */}
          <rect
            x={bx} y={by} width={bw} height={bh}
            fill="none" stroke={border.color} strokeWidth={Math.max(1, border.strokeWidth * mmToPx)}
          />
        </>
      ) : (
        <rect
          x={printableX} y={printableY} width={printableW} height={printableH}
          fill="none" stroke="#ea580c" strokeWidth={1} strokeDasharray="6 3" opacity={0.5}
        />
      )}

      {/* Clue sheet indicators */}
      {layout.clueSheet.visible && (() => {
        const breaks = layout.clueSheetBreaks
        if (breaks && breaks.length > 0) {
          const sizes = descriptionSheetPartSizes(course, controls, breaks, trailingFlip, cellSize)
          const positions = [layout.clueSheet, ...(layout.clueSheetParts ?? [])]
          return sizes.map((size, i) => {
            const elPos = positions[i] ?? layout.clueSheet
            const key = i === 0 ? 'clueSheet' : `clueSheetPart:${i - 1}`
            const pos = elementScreenPos(elPos, key)
            const w = size.width * mmToPx
            const h = size.height * mmToPx
            return (
              <g key={i}>
                <rect
                  x={pos.x} y={pos.y} width={w} height={h}
                  fill="white" fillOpacity={0.85}
                  stroke="#ea580c" strokeWidth={1.5} rx={2}
                />
                <text
                  x={pos.x + w / 2} y={pos.y + h / 2 + 3}
                  textAnchor="middle" fontSize={11} fill="#ea580c" opacity={0.8}
                  style={{ userSelect: 'none' }}
                >
                  Clue Sheet {i + 1}/{sizes.length}
                </text>
              </g>
            )
          })
        }
        const pos = elementScreenPos(layout.clueSheet, 'clueSheet')
        const sheet = descriptionSheetSize(course, controls, trailingFlip, cellSize)
        const w = sheet.width * mmToPx
        const h = sheet.height * mmToPx
        return (
          <g>
            <rect
              x={pos.x} y={pos.y} width={w} height={h}
              fill="white" fillOpacity={0.85}
              stroke="#ea580c" strokeWidth={1.5} rx={2}
            />
            <text
              x={pos.x + w / 2} y={pos.y + h / 2 + 3}
              textAnchor="middle" fontSize={11} fill="#ea580c" opacity={0.8}
              style={{ userSelect: 'none' }}
            >
              Clue Sheet
            </text>
          </g>
        )
      })()}

      {/* Border resize handle — rendered last so it sits above the clue sheet,
          matching the hit-test priority in MapCanvas (handle is tested first). */}
      {border && (
        <circle
          cx={bx + bw} cy={by + bh} r={HANDLE_R}
          fill="white" stroke={border.color} strokeWidth={2}
          style={{ cursor: 'nwse-resize' }}
        />
      )}
    </svg>
  )
}
