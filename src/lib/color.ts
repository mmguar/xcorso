// Shared hex-colour helpers. Single source of truth for parsing/manipulating
// the `#rrggbb` strings used throughout the UI, canvas, and PDF export.

export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function darkenHex(hex: string, amount = 0.2): string {
  const [r, g, b] = hexToRgb(hex)
  const f = 1 - amount
  return rgbToHex(r * f, g * f, b * f)
}
