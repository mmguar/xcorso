import type { SymbolDef } from '../lib/iofSymbols'
import { getSymbol } from '../lib/iofSymbols'

interface Props {
  code: string
  size?: number
  className?: string
}

export function IofSymbolIcon({ code, size = 24, className }: Props) {
  const sym = getSymbol(code)
  if (!sym) return <span className={className} style={{ width: size, height: size, display: 'inline-block' }} />
  return <SymbolSvg sym={sym} size={size} className={className} />
}

export function SymbolSvg({ sym, size = 24, className }: { sym: SymbolDef; size?: number; className?: string }) {
  return (
    <svg
      viewBox="-100 -100 200 200"
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      {sym.fills?.map((d, i) => (
        <path key={`f${i}`} d={d} fill="black" stroke="black" strokeWidth={1} />
      ))}
      {sym.paths?.map((d, i) => (
        <path key={`p${i}`} d={d} fill="none" stroke="black" strokeWidth={12.5} strokeLinejoin="miter" strokeLinecap="round" />
      ))}
      {sym.circles?.map(([cx, cy, r], i) => (
        <circle key={`c${i}`} cx={cx} cy={cy} r={r} fill="none" stroke="black" strokeWidth={10} />
      ))}
      {sym.filledCircles?.map(([cx, cy, r], i) => (
        <circle key={`fc${i}`} cx={cx} cy={cy} r={r} fill="black" />
      ))}
      {sym.lines?.map(([x1, y1, x2, y2], i) => (
        <line key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="black" strokeWidth={12.5} strokeLinecap="round" />
      ))}
    </svg>
  )
}
