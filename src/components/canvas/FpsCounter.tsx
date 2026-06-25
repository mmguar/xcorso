import { useEffect, useRef, useState } from 'react'

export function FpsCounter() {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const lastTime = useRef(0)
  const rafId = useRef(0)

  useEffect(() => {
    function tick() {
      frames.current++
      const now = performance.now()
      if (now - lastTime.current >= 1000) {
        setFps(frames.current)
        frames.current = 0
        lastTime.current = now
      }
      rafId.current = requestAnimationFrame(tick)
    }
    rafId.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId.current)
  }, [])

  return (
    <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs font-mono px-2 py-0.5 rounded pointer-events-none select-none z-50">
      {fps} fps
    </div>
  )
}
