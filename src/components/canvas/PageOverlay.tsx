import type { CourseLayout, MapConfig, Viewport, Course, Control } from '../../types'
import { PAGE_SIZES, MARGIN, mmToMap } from '../../lib/pdfExport'
import { descriptionSheetSize, descriptionSheetPartSizes } from '../../lib/pdfDescriptionSheet'

interface Props {
  layout: CourseLayout
  map: MapConfig
  viewport: Viewport
  canvasW: number
  canvasH: number
  course: Course
  controls: Control[]
}

function mapToScreen(mapPt: { x: number; y: number }, vp: Viewport) {
  return { x: mapPt.x * vp.scale + vp.x, y: mapPt.y * vp.scale + vp.y }
}

export function PageOverlay({ layout, map, viewport, canvasW, canvasH, course, controls }: Props) {
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

  function elementScreenPos(el: { x: number; y: number }) {
    return { x: rx + el.x * mmToPx, y: ry + el.y * mmToPx }
  }

  const marginPx = MARGIN * mmToPx
  const printableX = rx + marginPx
  const printableY = ry + marginPx
  const printableW = rw - 2 * marginPx
  const printableH = rh - 2 * marginPx

  return (
    <svg
      width={canvasW}
      height={canvasH}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {/* Dark mask — four rects around the page */}
      <rect x={0} y={0} width={canvasW} height={ry} fill="black" opacity={0.35} />
      <rect x={0} y={ry} width={rx} height={rh} fill="black" opacity={0.35} />
      <rect x={rx + rw} y={ry} width={canvasW - rx - rw} height={rh} fill="black" opacity={0.35} />
      <rect x={0} y={ry + rh} width={canvasW} height={canvasH - ry - rh} fill="black" opacity={0.35} />

      {/* Page border */}
      <rect
        x={rx} y={ry} width={rw} height={rh}
        fill="none" stroke="#d1d5db" strokeWidth={1}
      />

      {/* Printable area (inside margins) */}
      <rect
        x={printableX} y={printableY} width={printableW} height={printableH}
        fill="none" stroke="#ea580c" strokeWidth={1} strokeDasharray="6 3" opacity={0.5}
      />

      {/* Clue sheet indicators */}
      {layout.clueSheet.visible && (() => {
        const breaks = layout.clueSheetBreaks
        if (breaks && breaks.length > 0) {
          const sizes = descriptionSheetPartSizes(course, controls, breaks)
          const positions = [layout.clueSheet, ...(layout.clueSheetParts ?? [])]
          return sizes.map((size, i) => {
            const elPos = positions[i] ?? layout.clueSheet
            const pos = elementScreenPos(elPos)
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
        const pos = elementScreenPos(layout.clueSheet)
        const sheet = descriptionSheetSize(course, controls)
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

    </svg>
  )
}
