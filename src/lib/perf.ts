/* eslint-disable react-hooks/refs, react-hooks/purity -- intentional: render-time profiling */
import { useRef } from 'react'

const ENABLED = import.meta.env.DEV

// ── Render tracker hook ────────────────────────────────────────────────────

const renderCounts = new Map<string, number>()
const renderTimes = new Map<string, number[]>()

export function useRenderTracker(name: string) {
  const count = useRef(0)
  const lastRender = useRef(performance.now())

  if (!ENABLED) return

  count.current++
  const now = performance.now()
  const delta = now - lastRender.current
  lastRender.current = now

  renderCounts.set(name, count.current)

  if (count.current > 1 && delta < 100) {
    const times = renderTimes.get(name) ?? []
    times.push(delta)
    if (times.length > 50) times.shift()
    renderTimes.set(name, times)
  }

  if (count.current % 10 === 0) {
    console.log(`[perf] ${name}: ${count.current} renders`)
  }
}

// ── structuredClone benchmark ──────────────────────────────────────────────

export function timeClone<T>(label: string, obj: T): T {
  if (!ENABLED) return structuredClone(obj)
  const start = performance.now()
  const result = structuredClone(obj)
  const ms = performance.now() - start
  if (ms > 1) {
    console.log(`[perf] structuredClone(${label}): ${ms.toFixed(1)}ms`)
  }
  return result
}

// ── Console report ─────────────────────────────────────────────────────────

function perfReport() {
  console.group('[perf] Render report')

  console.log('--- Component render counts ---')
  const sorted = [...renderCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [name, count] of sorted) {
    const times = renderTimes.get(name)
    const avgMs = times && times.length > 0
      ? (times.reduce((s, t) => s + t, 0) / times.length).toFixed(1)
      : 'n/a'
    console.log(`  ${name}: ${count} renders (avg interval: ${avgMs}ms)`)
  }

  console.groupEnd()
}

if (ENABLED) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__perfReport = perfReport
  console.log('[perf] Profiling enabled. Call __perfReport() in console for stats.')
}
