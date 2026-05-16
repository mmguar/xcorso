/**
 * Renders the base map inside the SVG viewport.
 * OCAD → rasterized image (fast) or inline SVG (full quality).
 * Bitmap / PDF → <image> element.
 */

import { memo, useEffect, useRef } from 'react'
import type { LoadedMap } from '../../lib/mapLoader'

const DANGEROUS_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed'])

function sanitizeSvgNode(el: Element) {
  if (DANGEROUS_TAGS.has(el.tagName.toLowerCase())) {
    el.remove()
    return
  }
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name)
  }
  for (const child of Array.from(el.children)) sanitizeSvgNode(child)
}

interface Props {
  loadedMap: LoadedMap
  useRaster?: boolean
}

export const MapLayer = memo(function MapLayer({ loadedMap, useRaster = true }: Props) {
  const gRef = useRef<SVGGElement>(null)

  useEffect(() => {
    if (loadedMap.type !== 'svg') return
    if (useRaster && loadedMap.rasterUrl) return
    const g = gRef.current
    if (!g) return
    while (g.firstChild) g.removeChild(g.firstChild)
    const svgEl = loadedMap.content as SVGElement
    const children = Array.from(svgEl.childNodes)
    children.forEach(child => {
      const node = child.cloneNode(true)
      if (node instanceof Element) sanitizeSvgNode(node)
      g.appendChild(node)
    })
  }, [loadedMap, useRaster])

  const { bounds } = loadedMap

  if (loadedMap.type === 'svg') {
    if (useRaster && loadedMap.rasterUrl) {
      return (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={bounds.minX} y={bounds.minY}
            width={bounds.width} height={bounds.height}
            fill="white"
          />
          <image
            href={loadedMap.rasterUrl}
            x={bounds.minX} y={bounds.minY}
            width={bounds.width} height={bounds.height}
            preserveAspectRatio="none"
          />
        </g>
      )
    }
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
})
