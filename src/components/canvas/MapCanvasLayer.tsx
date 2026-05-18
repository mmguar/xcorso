import { useEffect, useRef } from 'react'
import type { LoadedMap } from '../../lib/mapLoader'

interface Props {
  loadedMap: LoadedMap
  useRaster: boolean
}

const MAX_CANVAS_DIM = 8192

export function MapCanvasLayer({ loadedMap, useRaster }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { bounds } = loadedMap

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    let blobUrl: string | undefined

    if (loadedMap.type === 'svg') {
      if (useRaster && loadedMap.rasterUrl) {
        img.src = loadedMap.rasterUrl
      } else {
        const svgEl = loadedMap.content as SVGElement
        const clone = svgEl.cloneNode(true) as SVGElement
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        clone.setAttribute('width', String(bounds.width))
        clone.setAttribute('height', String(bounds.height))
        const xml = new XMLSerializer().serializeToString(clone)
        blobUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
        img.src = blobUrl
      }
    } else {
      img.src = loadedMap.content as string
    }

    img.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return

      const scale = Math.min(1, MAX_CANVAS_DIM / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))

      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    }

    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [loadedMap, useRaster, bounds])

  return (
    <>
      <div style={{
        position: 'absolute',
        left: bounds.minX,
        top: bounds.minY,
        width: bounds.width,
        height: bounds.height,
        backgroundColor: 'white',
        pointerEvents: 'none',
      }} />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: bounds.minX,
          top: bounds.minY,
          width: bounds.width,
          height: bounds.height,
          pointerEvents: 'none',
        }}
      />
    </>
  )
}
