import type { MapGeoref } from '../types'

const a = 6378137.0
const f = 1 / 298.257223563
const b = a * (1 - f)
const k0 = 0.9996

const n = (a - b) / (a + b)
const n2 = n * n
const n3 = n2 * n
const n4 = n2 * n2

const A0 = a / (1 + n) * (1 + n2 / 4 + n4 / 64)

const beta1 = n / 2 - 2 * n2 / 3 + 37 * n3 / 96
const beta2 = n2 / 48 + n3 / 15
const beta3 = 17 * n3 / 480

const delta1 = 2 * n - 2 * n2 / 3 - 2 * n3
const delta2 = 7 * n2 / 3 - 8 * n3 / 5
const delta3 = 56 * n3 / 15

function utmToLatLng(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: 'N' | 'S',
): { lat: number; lng: number } {
  const x = easting - 500000.0
  const y = hemisphere === 'S' ? northing - 10000000.0 : northing

  const xi = y / (k0 * A0)
  const eta = x / (k0 * A0)

  const xiP = xi
    - beta1 * Math.sin(2 * xi) * Math.cosh(2 * eta)
    - beta2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
    - beta3 * Math.sin(6 * xi) * Math.cosh(6 * eta)

  const etaP = eta
    - beta1 * Math.cos(2 * xi) * Math.sinh(2 * eta)
    - beta2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
    - beta3 * Math.cos(6 * xi) * Math.sinh(6 * eta)

  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP))

  const lat = chi
    + delta1 * Math.sin(2 * chi)
    + delta2 * Math.sin(4 * chi)
    + delta3 * Math.sin(6 * chi)

  const lng0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180
  const lng = lng0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP))

  return { lat: lat * 180 / Math.PI, lng: lng * 180 / Math.PI }
}

export function ocadToLatLng(
  ocadXmm: number,
  ocadYmm: number,
  scale: number,
  georef: MapGeoref,
): { lat: number; lng: number } {
  // OCAD paper is rotated by angleDeg from grid north; undo to get grid-aligned offsets
  const rad = georef.angleDeg * Math.PI / 180
  const gridXmm = ocadXmm * Math.cos(rad) + ocadYmm * Math.sin(rad)
  const gridYmm = -ocadXmm * Math.sin(rad) + ocadYmm * Math.cos(rad)

  const utmE = georef.easting + gridXmm * scale / 1000
  const utmN = georef.northing + gridYmm * scale / 1000
  return utmToLatLng(utmE, utmN, georef.utmZone, georef.hemisphere)
}
