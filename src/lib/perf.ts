import { useRef, Profiler, createElement } from 'react'
import type { ProfilerOnRenderCallback, ReactNode } from 'react'

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

// ── Profiler wrapper ───────────────────────────────────────────────────────

const slowRenders = new Map<string, { count: number; totalMs: number; maxMs: number }>()

const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  if (!ENABLED) return

  const entry = slowRenders.get(id) ?? { count: 0, totalMs: 0, maxMs: 0 }
  entry.count++
  entry.totalMs += actualDuration
  if (actualDuration > entry.maxMs) entry.maxMs = actualDuration

  if (actualDuration > 2) {
    console.log(`[perf] ${id} render: ${actualDuration.toFixed(1)}ms`)
  }

  slowRenders.set(id, entry)
}

export function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
  if (!ENABLED) return children
  return createElement(Profiler, { id, onRender }, children)
}

// ── Zustand middleware ─────────────────────────────────────────────────────

let lastMutationTime = 0

export function logMutation(name: string) {
  if (!ENABLED) return
  const now = performance.now()
  const delta = lastMutationTime ? now - lastMutationTime : 0
  lastMutationTime = now
  if (delta < 50) {
    console.log(`[perf] mutation "${name}" (${delta.toFixed(1)}ms since last)`)
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

export function perfReport() {
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

  console.log('--- Slow render profiles ---')
  const profileSorted = [...slowRenders.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)
  for (const [id, stats] of profileSorted) {
    console.log(`  ${id}: ${stats.count} renders, total ${stats.totalMs.toFixed(0)}ms, max ${stats.maxMs.toFixed(1)}ms, avg ${(stats.totalMs / stats.count).toFixed(1)}ms`)
  }

  console.groupEnd()
}

if (ENABLED) {
  (window as any).__perfReport = perfReport
  console.log('[perf] Profiling enabled. Call __perfReport() in console for stats.')
}
