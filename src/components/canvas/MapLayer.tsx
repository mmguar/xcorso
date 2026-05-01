/**
 * Renders the base map inside the SVG viewport.
 * OCAD → inline SVG element via foreignObject trick or direct g-embed.
 * Bitmap / PDF → <image> element.
 */

import { useEffect, useRef } from 'react'
import type { LoadedMap } from '../../lib/mapLoader'

interface Props {
  loadedMap: LoadedMap
}

export function MapLayer({ loadedMap }: Props) {
  const gRef = useRef<SVGGElement>(null)

  useEffect(() => {
    if (loadedMap.type !== 'svg') return
    const g = gRef.current
    if (!g) return
    // Clear previous content
    while (g.firstChild) g.removeChild(g.firstChild)
    const svgEl = loadedMap.content as SVGElement
    // Move all children from the ocad SVG into our g element
    // We want to inherit the coordinate space (viewBox is already applied by parent)
    const children = Array.from(svgEl.childNodes)
    children.forEach(child => g.appendChild(child.cloneNode(true)))
  }, [loadedMap])

  const { bounds } = loadedMap

  if (loadedMap.type === 'svg') {
    return (
      <g style={{ pointerEvents: 'none' }}>
        <rect
          x={bounds.minX} y={bounds.minY}
          width={bounds.width} height={bounds.height}
          fill="white"
        />
        <g ref={gRef} fill="transparent" />
      </g>
    )
  }

  return (
    <image
      href={loadedMap.content as string}
      x={bounds.minX}
      y={bounds.minY}
      width={bounds.width}
      height={bounds.height}
      preserveAspectRatio="none"
      style={{ pointerEvents: 'none' }}
    />
  )
}
