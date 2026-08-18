import { useRef, useState } from 'react'

interface Props {
  value: number
  onCommit: (v: number) => void
  /** Parse user text; return null to reject (the input reverts to the current
   *  value). Default accepts positive integers — right for "1:x" scale inputs. */
  parse?: (text: string) => number | null
  format?: (v: number) => string
  disabled?: boolean
  inputMode?: 'numeric' | 'decimal'
  className?: string
}

function parsePositiveInt(text: string): number | null {
  const v = parseInt(text)
  return v > 0 && isFinite(v) ? v : null
}

/** Text input that keeps its own draft and commits on blur/Enter — invalid or
 *  unchanged input reverts to the formatted external value. */
export function NumericInput({ value, onCommit, parse = parsePositiveInt, format = String, disabled, inputMode = 'numeric', className }: Props) {
  const [text, setText] = useState(format(value))
  const prev = useRef(value)
  if (value !== prev.current) { // eslint-disable-line react-hooks/refs -- sync prop→state
    prev.current = value // eslint-disable-line react-hooks/refs
    setText(format(value))
  }
  function commit() {
    const v = parse(text)
    if (v != null && format(v) !== format(value)) onCommit(v)
    else setText(format(value))
  }
  return (
    <input
      type="text"
      inputMode={inputMode}
      value={text}
      disabled={disabled}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={className}
    />
  )
}
