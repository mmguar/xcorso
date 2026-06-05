// Spot-ink "overprint simulation" for OCAD maps.
//
// Real orienteering maps are printed with spot inks that *overprint*: where two
// inks overlap, the colours multiply (darken) instead of the upper ink knocking
// out the lower one. The browser default for SVG is knockout, so this bakes the
// multiply behaviour into a cloned map SVG before it is rasterised:
//   • a white "paper" rect at the very bottom, and
//   • mix-blend-mode:multiply on every drawn map layer.
//
// This is an RGB-space approximation (not true CMYK ink mixing). One visible
// consequence is that white map elements (e.g. road casings) drop out — which is
// exactly what happens with real overprint, since white is just unprinted paper.

const SVGNS = 'http://www.w3.org/2000/svg'

export interface OverprintViewBox {
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * Mutates a *cloned* OCAD SVG in place so it rasterises with overprint blending.
 * Pass a clone — never the live map SVG.
 */
export function applyMapOverprint(svgClone: SVGElement, viewBox: OverprintViewBox): void {
  // The drawn layers live inside one or more top-level <g> groups (ocad2geojson
  // emits a single group); fall back to the svg root if there is none.
  const groups = Array.from(svgClone.children).filter(
    (c): c is SVGElement => c instanceof SVGElement && c.tagName.toLowerCase() === 'g',
  )
  const layerParents: Element[] = groups.length > 0 ? groups : [svgClone]
  for (const parent of layerParents) {
    for (const layer of Array.from(parent.children)) {
      appendStyle(layer, 'mix-blend-mode:multiply')
    }
  }

  // White paper backdrop, in root viewBox space so it is unaffected by any
  // transform on the inner group. Inserted last so it is the bottom-most child
  // and never picks up the multiply style applied above.
  const paper = document.createElementNS(SVGNS, 'rect')
  paper.setAttribute('x', String(viewBox.minX))
  paper.setAttribute('y', String(viewBox.minY))
  paper.setAttribute('width', String(viewBox.width))
  paper.setAttribute('height', String(viewBox.height))
  paper.setAttribute('fill', '#ffffff')
  svgClone.insertBefore(paper, svgClone.firstChild)
}

function appendStyle(el: Element, decl: string): void {
  const prev = el.getAttribute('style')
  el.setAttribute('style', prev ? `${prev};${decl}` : decl)
}
