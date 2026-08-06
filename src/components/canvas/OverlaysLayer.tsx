import { memo } from 'react'
import type { ScaleBar, TextLabel, ImageOverlay, MapConfig, MapPoint } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'
import { scaleBarLayoutMm } from '../../lib/distance'
import { measureTextWidth } from '../../lib/textMeasure'
import { renderScaleBar, renderTextLabel, renderImageOverlay } from '../../lib/courseRenderer'

interface Props {
  scaleBars: ScaleBar[]
  textLabels: TextLabel[]
  imageOverlays: ImageOverlay[]
  map: MapConfig
  selectedOverlayId: string | null
  positionOverrides?: Record<string, MapPoint>
  printScaleOverride?: number
}

function effectiveUpm(map: MapConfig, printScaleOverride?: number): number {
  const base = unitsPerMm(map)
  return printScaleOverride ? base * printScaleOverride / map.scale : base
}

function ScaleBarChrome({ sb, map, printScaleOverride }: { sb: ScaleBar; map: MapConfig; printScaleOverride?: number }) {
  const upm = effectiveUpm(map, printScaleOverride)
  const scaleDen = printScaleOverride ?? map.scale
  const lay = scaleBarLayoutMm(sb, scaleDen)
  const strokeW = lay.strokeW * upm
  return (
    <rect
      x={sb.position.x - strokeW * 2} y={sb.position.y - strokeW * 2}
      width={lay.boxW * upm + strokeW * 4} height={lay.boxH * upm + strokeW * 4}
      fill="none" stroke="#ea580c" strokeWidth={strokeW * 2}
      strokeDasharray={`${upm * 1} ${upm * 0.5}`}
      rx={0.8 * upm}
    />
  )
}

function TextLabelChrome({ tl, map, printScaleOverride }: { tl: TextLabel; map: MapConfig; printScaleOverride?: number }) {
  const upm = effectiveUpm(map, printScaleOverride)
  const fontSize = tl.fontSizeMm * upm
  const strokeW = 0.2 * upm
  const lines = tl.text.split('\n')
  const lineHeight = fontSize * 1.25
  const maxLineW = Math.max(...lines.map(l => measureTextWidth(l, fontSize)))
  const blockH = lineHeight * lines.length
  const pad = 0.15 * fontSize
  return (
    <rect
      x={tl.position.x - pad - strokeW * 2} y={tl.position.y - fontSize - pad - strokeW * 2}
      width={maxLineW + pad * 2 + strokeW * 4} height={blockH + pad * 2 + strokeW * 4}
      fill="none" stroke="#ea580c" strokeWidth={strokeW * 2}
      strokeDasharray={`${upm * 1} ${upm * 0.5}`}
      rx={0.3 * upm}
    />
  )
}

function ImageOverlayChrome({ img, map, printScaleOverride }: { img: ImageOverlay; map: MapConfig; printScaleOverride?: number }) {
  const upm = effectiveUpm(map, printScaleOverride)
  const strokeW = 0.2 * upm
  const w = img.widthMm * upm
  const h = img.heightMm * upm
  const handleSize = 3 * upm
  return (
    <>
      <rect
        x={img.position.x - strokeW * 2} y={img.position.y - strokeW * 2}
        width={w + strokeW * 4} height={h + strokeW * 4}
        fill="none" stroke="#ea580c" strokeWidth={strokeW * 2}
        strokeDasharray={`${upm * 1} ${upm * 0.5}`}
      />
      <rect
        x={img.position.x + w - handleSize / 2} y={img.position.y + h - handleSize / 2}
        width={handleSize} height={handleSize}
        fill="#ea580c" stroke="white" strokeWidth={strokeW}
      />
    </>
  )
}

export const OverlaysLayer = memo(function OverlaysLayer({ scaleBars, textLabels, imageOverlays, map, selectedOverlayId, positionOverrides, printScaleOverride }: Props) {
  const scaleDen = printScaleOverride ?? map.scale
  const upm = effectiveUpm(map, printScaleOverride)

  return (
    <g style={{ pointerEvents: 'none' }}>
      {scaleBars.map(sb => {
        const override = positionOverrides?.[sb.id]
        const effectiveSb = override ? { ...sb, position: override } : sb
        const selected = sb.id === selectedOverlayId
        const svg = renderScaleBar(effectiveSb, scaleDen, upm)
        return (
          <g key={sb.id}>
            <g dangerouslySetInnerHTML={{ __html: svg }} />
            {selected && <ScaleBarChrome sb={effectiveSb} map={map} printScaleOverride={printScaleOverride} />}
          </g>
        )
      })}
      {textLabels.map(tl => {
        const override = positionOverrides?.[tl.id]
        const effectiveTl = override ? { ...tl, position: override } : tl
        const selected = tl.id === selectedOverlayId
        const svg = renderTextLabel(effectiveTl, upm)
        return (
          <g key={tl.id}>
            <g dangerouslySetInnerHTML={{ __html: svg }} />
            {selected && <TextLabelChrome tl={effectiveTl} map={map} printScaleOverride={printScaleOverride} />}
          </g>
        )
      })}
      {imageOverlays.map(img => {
        const override = positionOverrides?.[img.id]
        const effectiveImg = override ? { ...img, position: override } : img
        const selected = img.id === selectedOverlayId
        const svg = renderImageOverlay(effectiveImg, upm)
        return (
          <g key={img.id}>
            <g dangerouslySetInnerHTML={{ __html: svg }} />
            {selected && <ImageOverlayChrome img={effectiveImg} map={map} printScaleOverride={printScaleOverride} />}
          </g>
        )
      })}
    </g>
  )
})
