// Measures rendered text width for the on-canvas overlay text labels, so the
// white background box matches the actual glyphs instead of a per-character
// estimate. Font must stay in sync with OverlaysLayer's TextLabelSvg.
let ctx: CanvasRenderingContext2D | null = null

const REF_PX = 100

/** Width of `text` when rendered at `fontSize` (any unit — result is in the same unit). */
export function measureTextWidth(text: string, fontSize: number): number {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * fontSize * 0.48 // ponytail: estimate fallback, canvas 2D always exists in practice
  ctx.font = `${REF_PX}px Arial, sans-serif`
  return (ctx.measureText(text).width / REF_PX) * fontSize
}
