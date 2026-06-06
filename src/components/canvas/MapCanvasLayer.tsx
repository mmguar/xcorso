import { useEffect, useRef } from 'react'
import type { LoadedMap } from '../../lib/mapLoader'

interface Props {
  loadedMap: LoadedMap
  onPixelSize?: (w: number, h: number) => void
  /** Overrides the default raster source (e.g. an overprint-simulated render). */
  srcOverride?: string
}

const MAX_CANVAS_DIM = 8192

export function MapCanvasLayer({ loadedMap, onPixelSize, srcOverride }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onPixelSizeRef = useRef(onPixelSize)
  onPixelSizeRef.current = onPixelSize

  useEffect(() => {
    let cancelled = false
    const img = new Image()

    let src: string | undefined
    if (srcOverride) {
      src = srcOverride
    } else if (loadedMap.type === 'svg') {
      src = loadedMap.rasterUrl
    } else {
      src = loadedMap.content as string
    }

    if (!src) return

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
      onPixelSizeRef.current?.(w, h)
    }

    img.onerror = () => {}
    img.src = src

    return () => { cancelled = true }
  }, [loadedMap, srcOverride])

  return (
    <canvas
      ref={canvasRef}
      width={1}
      height={1}
      style={{
        position: 'absolute',
        backgroundColor: 'white',
        pointerEvents: 'none',
      }}
    />
  )
}
