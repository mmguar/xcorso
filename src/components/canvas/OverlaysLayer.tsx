import { memo } from 'react'
import type { ScaleBar, TextLabel, ImageOverlay, MapConfig, MapPoint } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'
import { formatScaleBarDistance, scaleBarLayoutMm } from '../../lib/distance'
import { measureTextWidth } from '../../lib/textMeasure'

interface Props {
  scaleBars: ScaleBar[]
  textLabels: TextLabel[]
  imageOverlays: ImageOverlay[]
  map: MapConfig
  selectedOverlayId: string | null
  positionOverrides?: Record<string, MapPoint>
  printScaleOverride?: number
}

function ScaleBarSvg({ sb, map, selected, printScaleOverride }: { sb: ScaleBar; map: MapConfig; selected: boolean; printScaleOverride?: number }) {
  const baseUpm = unitsPerMm(map)
  const upm = printScaleOverride ? baseUpm * printScaleOverride / map.scale : baseUpm
  /** Bar is always drawn for the effective print scale — printed distances must
   * match the page. (sb.scale is legacy data and no longer read.) */
  const scaleDen = printScaleOverride ?? map.scale
  const scaleStr = `1:${Math.round(scaleDen)}`

  const lay = scaleBarLayoutMm(sb, scaleDen)
  const segRealM = sb.fixedCmSegments ? scaleDen / 100 : sb.segmentLengthM
  const segUnits = lay.segMm * upm
  const barH = lay.barH * upm, textH = lay.textH * upm, pad = lay.pad * upm
  const strokeW = lay.strokeW * upm, tickH = lay.tickH * upm
  const boxW = lay.boxW * upm, boxH = lay.boxH * upm

  const { x, y } = sb.position
  const barX = x + pad
  const barY = y + pad + textH + tickH

  // Format distance label
  return (
    <g>
      {/* Background */}
      <rect
        x={x} y={y} width={boxW} height={boxH}
        fill="white" opacity={sb.bgAlpha}
        rx={0.5 * upm}
      />

      {/* Selection indicator */}
      {selected && (
        <rect
          x={x - strokeW * 2} y={y - strokeW * 2}
          width={boxW + strokeW * 4} height={boxH + strokeW * 4}
          fill="none" stroke="#ea580c" strokeWidth={strokeW * 2}
          strokeDasharray={`${upm * 1} ${upm * 0.5}`}
          rx={0.8 * upm}
        />
      )}

      {/* Alternating segments */}
      {Array.from({ length: sb.segments }, (_, i) => (
        <rect
          key={i}
          x={barX + i * segUnits} y={barY}
          width={segUnits} height={barH}
          fill={i % 2 === 0 ? '#000000' : '#ffffff'}
          stroke="#000000" strokeWidth={strokeW}
        />
      ))}

      {/* Tick marks and labels at segment boundaries */}
      {Array.from({ length: sb.segments + 1 }, (_, i) => {
        const tx = barX + i * segUnits
        const showLabel = i === 0 || i === 1 || i === sb.segments
        return (
          <g key={i}>
            <line
              x1={tx} y1={barY - tickH} x2={tx} y2={barY}
              stroke="#000000" strokeWidth={strokeW}
            />
            {showLabel && (
              <text
                x={tx}
                y={barY - tickH - textH * 0.15}
                textAnchor="middle"
                fontSize={textH * 0.7}
                fontFamily="Arial, sans-serif"
                fill="#000000"
              >
                {formatScaleBarDistance(i * segRealM)}
              </text>
            )}
          </g>
        )
      })}

      {/* Scale text */}
      <text
        x={x + boxW / 2}
        y={barY + barH + textH + pad * 0.3}
        textAnchor="middle"
        fontSize={textH * 0.8}
        fontFamily="Arial, sans-serif"
        fill="#000000"
      >
        {scaleStr}
      </text>
    </g>
  )
}

function TextLabelSvg({ tl, map, selected, printScaleOverride }: { tl: TextLabel; map: MapConfig; selected: boolean; printScaleOverride?: number }) {
  const baseUpm = unitsPerMm(map)
  // Text labels are a fixed size in mm on the printed page (like scale bars), so
  // when a print-scale override is active the on-screen size must track it too —
  // otherwise the editor shows a different size than the exported PDF.
  const upm = printScaleOverride ? baseUpm * printScaleOverride / map.scale : baseUpm
  const fontSize = tl.fontSizeMm * upm
  const strokeW = 0.2 * upm

  const lines = tl.text.split('\n')
  const lineHeight = fontSize * 1.25
  const maxLineW = Math.max(...lines.map(l => measureTextWidth(l, fontSize)))
  const blockH = lineHeight * lines.length
  const pad = 0.15 * fontSize
  const bgX = tl.position.x - pad
  const bgY = tl.position.y - fontSize - pad
  const bgW = maxLineW + pad * 2
  const bgH = blockH + pad * 2

  return (
    <g>
      {tl.bgAlpha > 0 && (
        <rect
          x={bgX} y={bgY} width={bgW} height={bgH}
          fill="white" opacity={tl.bgAlpha}
          rx={0.15 * fontSize}
        />
      )}
      {selected && (
        <rect
          x={bgX - strokeW * 2} y={bgY - strokeW * 2}
          width={bgW + strokeW * 4} height={bgH + strokeW * 4}
          fill="none" stroke="#ea580c" strokeWidth={strokeW * 2}
          strokeDasharray={`${upm * 1} ${upm * 0.5}`}
          rx={0.3 * upm}
        />
      )}
      <text
        x={tl.position.x}
        y={tl.position.y}
        fontSize={fontSize}
        fontFamily="Arial, sans-serif"
        fill={tl.color}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={tl.position.x} dy={i === 0 ? 0 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}

function ImageOverlaySvg({ img, map, selected, printScaleOverride }: { img: ImageOverlay; map: MapConfig; selected: boolean; printScaleOverride?: number }) {
  const baseUpm = unitsPerMm(map)
  const upm = printScaleOverride ? baseUpm * printScaleOverride / map.scale : baseUpm
  const strokeW = 0.2 * upm
  const w = img.widthMm * upm
  const h = img.heightMm * upm
  const { x, y } = img.position
  const handleSize = 3 * upm

  return (
    <g>
      <image
        x={x} y={y} width={w} height={h}
        href={img.dataUrl}
        preserveAspectRatio="none"
      />
      {selected && (
        <>
          <rect
            x={x - strokeW * 2} y={y - strokeW * 2}
            width={w + strokeW * 4} height={h + strokeW * 4}
            fill="none" stroke="#ea580c" strokeWidth={strokeW * 2}
            strokeDasharray={`${upm * 1} ${upm * 0.5}`}
          />
          <rect
            x={x + w - handleSize / 2} y={y + h - handleSize / 2}
            width={handleSize} height={handleSize}
            fill="#ea580c" stroke="white" strokeWidth={strokeW}
          />
        </>
      )}
    </g>
  )
}

export const OverlaysLayer = memo(function OverlaysLayer({ scaleBars, textLabels, imageOverlays, map, selectedOverlayId, positionOverrides, printScaleOverride }: Props) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      {scaleBars.map(sb => {
        const override = positionOverrides?.[sb.id]
        const effectiveSb = override ? { ...sb, position: override } : sb
        return (
          <ScaleBarSvg
            key={sb.id}
            sb={effectiveSb}
            map={map}
            selected={sb.id === selectedOverlayId}
            printScaleOverride={printScaleOverride}
          />
        )
      })}
      {textLabels.map(tl => {
        const override = positionOverrides?.[tl.id]
        const effectiveTl = override ? { ...tl, position: override } : tl
        return (
          <TextLabelSvg
            key={tl.id}
            tl={effectiveTl}
            map={map}
            selected={tl.id === selectedOverlayId}
            printScaleOverride={printScaleOverride}
          />
        )
      })}
      {imageOverlays.map(img => {
        const override = positionOverrides?.[img.id]
        const effectiveImg = override ? { ...img, position: override } : img
        return (
          <ImageOverlaySvg
            key={img.id}
            img={effectiveImg}
            map={map}
            selected={img.id === selectedOverlayId}
            printScaleOverride={printScaleOverride}
          />
        )
      })}
    </g>
  )
})
