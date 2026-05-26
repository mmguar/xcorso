import { memo } from 'react'
import type { ScaleBar, TextLabel, MapConfig, MapPoint } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'

interface Props {
  scaleBars: ScaleBar[]
  textLabels: TextLabel[]
  map: MapConfig
  selectedOverlayId: string | null
  positionOverrides?: Record<string, MapPoint>
  printScaleOverride?: number
}

function ScaleBarSvg({ sb, map, selected, printScaleOverride }: { sb: ScaleBar; map: MapConfig; selected: boolean; printScaleOverride?: number }) {
  const baseUpm = unitsPerMm(map)
  const upm = printScaleOverride ? baseUpm * printScaleOverride / map.scale : baseUpm
  /** Bar graphic is drawn for this denominator; falls back to map scale for older projects. */
  const scaleDen = printScaleOverride ?? sb.scale ?? map.scale
  const scaleStr = `1:${Math.round(scaleDen)}`

  // Convert segment real-world metres to map units
  // realMetres -> mm on paper: realM * 1_000_000 / scale (µm) / 1000 = realM * 1000 / scale mm
  const segMmOnPaper = (sb.segmentLengthM * 1000) / scaleDen
  const segUnits = segMmOnPaper * upm
  const totalUnits = segUnits * sb.segments

  const barH = 2.0 * upm       // bar height: 2mm on paper
  const textH = 2.5 * upm      // text size: 2.5mm
  const pad = 3 * upm        // padding
  const strokeW = 0.2 * upm
  const tickH = 0.5 * upm      // small ticks above bar

  // Total dimensions
  const contentW = totalUnits
  const contentH = barH + textH + tickH + pad * 0.5
  const boxW = contentW + pad * 2
  const boxH = contentH + pad * 2 + textH // extra for scale text below

  const { x, y } = sb.position
  const barX = x + pad
  const barY = y + pad + textH + tickH

  // Format distance label
  const fmtDist = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`

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
                {fmtDist(i * sb.segmentLengthM)}
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

function TextLabelSvg({ tl, map, selected }: { tl: TextLabel; map: MapConfig; selected: boolean }) {
  const upm = unitsPerMm(map)
  const fontSize = tl.fontSizeMm * upm
  const strokeW = 0.2 * upm

  const pad = 0.3 * fontSize
  const textW = tl.text.length * fontSize * 0.65
  const textH = fontSize * 1.3
  const bgX = tl.position.x - pad
  const bgY = tl.position.y - fontSize - pad
  const bgW = textW + pad * 2
  const bgH = textH + pad * 2

  return (
    <g>
      {tl.bgAlpha > 0 && (
        <rect
          x={bgX} y={bgY} width={bgW} height={bgH}
          fill="white" opacity={tl.bgAlpha}
          rx={0.2 * fontSize}
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
        {tl.text}
      </text>
    </g>
  )
}

export const OverlaysLayer = memo(function OverlaysLayer({ scaleBars, textLabels, map, selectedOverlayId, positionOverrides, printScaleOverride }: Props) {
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
          />
        )
      })}
    </g>
  )
})
