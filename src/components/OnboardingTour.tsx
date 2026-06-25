import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'xcorso_tour_done'

interface Step {
  anchor: string
  text: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  optional?: boolean // skip if anchor not in DOM
}

const STEPS: Step[] = [
  { anchor: 'toolbar', text: 'Pick a tool to place controls: Start (S), Control (C), Finish (F). Click on the map to place them.', position: 'top' },
  { anchor: 'courses-tab', text: 'Create a course here, then add controls by clicking them on the map or typing their code.', position: 'left' },
  { anchor: 'course-controls', text: 'Drag to reorder. Right-click a control to remove it from the course.', position: 'left', optional: true },
  { anchor: 'classes', text: 'Add race classes and assign each one to a course for IOF XML export.', position: 'left', optional: true },
  { anchor: 'layout-tab', text: 'Use the layout tab to format your course for printing.', position: 'left' },
  { anchor: 'export-pdf', text: 'Export your formatted course as a PDF.', position: 'left', optional: true },
  { anchor: 'export-menu', text: 'Export IOF XML here for Condes or Purple Pen.', position: 'bottom' },
]

function findAnchor(anchor: string): Element | null {
  return document.querySelector(`[data-tour="${anchor}"]`)
}

// Find next step with a visible anchor, starting from `from`.
function findNextVisible(from: number): number {
  for (let i = from; i < STEPS.length; i++) {
    if (findAnchor(STEPS[i].anchor) || !STEPS[i].optional) return i
  }
  return STEPS.length // done
}

export function OnboardingTour() {
  const [step, setStep] = useState(() =>
    localStorage.getItem(STORAGE_KEY) ? -1 : findNextVisible(0)
  )
  const [rect, setRect] = useState<DOMRect | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const current = step >= 0 && step < STEPS.length ? STEPS[step] : null

  const updateRect = useCallback(() => {
    if (!current) { setRect(null); return }
    const el = findAnchor(current.anchor)
    if (el) {
      setRect(el.getBoundingClientRect())
    } else if (current.optional) {
      // Anchor not in DOM, skip to next visible — must defer to avoid setState-in-render
      setStep(findNextVisible(step + 1))
    } else {
      setRect(null)
    }
  }, [current, step])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- updateRect measures DOM and sets position state
  useLayoutEffect(updateRect, [updateRect])

  useEffect(() => {
    if (!current) return
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)
    return () => {
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [current, updateRect])

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1')
    setStep(-1)
  }, [])

  const next = useCallback(() => {
    const nextStep = findNextVisible(step + 1)
    if (nextStep >= STEPS.length) { dismiss(); return }
    setStep(nextStep)
  }, [step, dismiss])

  useEffect(() => {
    if (!current) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, dismiss])

  if (!current || !rect) return null

  const pos = current.position ?? 'top'
  const style: React.CSSProperties = {}
  const gap = 10

  if (pos === 'top') {
    style.left = rect.left + rect.width / 2
    style.bottom = window.innerHeight - rect.top + gap
    style.transform = 'translateX(-50%)'
  } else if (pos === 'bottom') {
    style.left = rect.left + rect.width / 2
    style.top = rect.bottom + gap
    style.transform = 'translateX(-50%)'
  } else if (pos === 'left') {
    style.right = window.innerWidth - rect.left + gap
    style.top = rect.top + rect.height / 2
    style.transform = 'translateY(-50%)'
  } else {
    style.left = rect.right + gap
    style.top = rect.top + rect.height / 2
    style.transform = 'translateY(-50%)'
  }

  return (
    <>
      {/* Dimmed overlay with cutout for highlighted element */}
      <div className="fixed inset-0 z-[100]" onClick={dismiss}>
        <svg className="w-full h-full">
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={rect.left - 4} y={rect.top - 4}
                width={rect.width + 8} height={rect.height + 8}
                rx={8} fill="black"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.3)" mask="url(#tour-mask)" />
        </svg>
      </div>
      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-[102] bg-white rounded-xl shadow-xl border border-gray-200 p-3 max-w-xs"
        style={style}
      >
        <p className="text-sm text-gray-700 mb-3">{current.text}</p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">{step + 1} / {STEPS.length}</span>
          <div className="flex gap-2">
            <button onClick={dismiss} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Skip</button>
            <button onClick={next} className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-3 py-1 transition-colors">
              {step === STEPS.length - 1 ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
