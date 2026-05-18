import { useEffect, useRef } from 'react'
import type { LoadedMap } from '../../lib/mapLoader'

interface Props {
  loadedMap: LoadedMap
}

const MAX_CANVAS_DIM = 8192

export function MapCanvasLayer({ loadedMap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { bounds } = loadedMap

  useEffect(() => {
    let cancelled = false
    const img = new Image()

    if (loadedMap.type === 'svg') {
      if (loadedMap.rasterUrl) {
        img.src = loadedMap.rasterUrl
      } else {
        return
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

    return () => { cancelled = true }
  }, [loadedMap, bounds])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: bounds.minX,
        top: bounds.minY,
        width: bounds.width,
        height: bounds.height,
        backgroundColor: 'white',
        pointerEvents: 'none',
      }}
    />
  )
}
