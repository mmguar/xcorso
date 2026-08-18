// ISOM 2017-2 symbol number → IOF 2018 control description code (column D).
// Keyed by OCAD symbol number ÷ 1000 (e.g. 204 → Boulder → IOF '2.4').
// Only symbols that are plausible control features — contours, layout, text,
// and purely decorative symbols are intentionally excluded.

export interface IsomMapping {
  code: string            // IOF description code (matches iofSymbols.ts)
  kind: 'point' | 'line' | 'area'
}

const TABLE: Record<number, IsomMapping> = {
  // Landforms 1xx
  104: { code: '1.3', kind: 'line' },    // Earth bank
  105: { code: '1.6', kind: 'line' },    // Earth wall
  106: { code: '1.7', kind: 'line' },    // Erosion gully / ruined stairway
  107: { code: '1.8', kind: 'point' },   // Small erosion gully
  109: { code: '1.10', kind: 'point' },  // Knoll
  110: { code: '1.11', kind: 'point' },  // Saddle (pass) — rarely a feature but valid
  111: { code: '1.12', kind: 'area' },   // Depression
  112: { code: '1.13', kind: 'point' },  // Small depression
  113: { code: '1.14', kind: 'point' },  // Pit
  114: { code: '1.15', kind: 'area' },   // Broken ground
  115: { code: '1.16', kind: 'point' },  // Ant hill (termite mound)

  // Rock & boulders 2xx
  201: { code: '2.1', kind: 'line' },    // Impassable cliff
  202: { code: '2.1', kind: 'line' },    // Cliff
  203: { code: '2.2', kind: 'point' },   // Rock pillar
  204: { code: '2.4', kind: 'point' },   // Boulder
  205: { code: '2.5', kind: 'area' },    // Boulder field
  206: { code: '2.6', kind: 'point' },   // Boulder cluster
  207: { code: '2.7', kind: 'area' },    // Stony ground (slow run)
  208: { code: '2.7', kind: 'area' },    // Stony ground (walk)
  209: { code: '2.8', kind: 'area' },    // Bare rock
  210: { code: '2.9', kind: 'line' },    // Narrow passage between cliffs/boulders
  211: { code: '2.3', kind: 'point' },   // Cave

  // Water 3xx
  301: { code: '3.1', kind: 'area' },    // Uncrossable body of water / Lake
  302: { code: '3.1', kind: 'area' },    // Shallow body of water
  303: { code: '3.3', kind: 'point' },   // Water hole
  304: { code: '3.4', kind: 'line' },    // Crossable watercourse
  305: { code: '3.4', kind: 'line' },    // Small crossable watercourse
  306: { code: '3.5', kind: 'line' },    // Minor/seasonal watercourse
  307: { code: '3.7', kind: 'area' },    // Uncrossable marsh
  308: { code: '3.7', kind: 'area' },    // Marsh
  309: { code: '3.6', kind: 'line' },    // Narrow marsh
  310: { code: '3.8', kind: 'area' },    // Indistinct marsh (firm ground)
  311: { code: '3.10', kind: 'point' },  // Spring
  312: { code: '3.9', kind: 'point' },   // Prominent water feature (well / fountain)
  313: { code: '3.5', kind: 'line' },    // Ditch

  // Vegetation 4xx
  401: { code: '4.1', kind: 'area' },    // Open land
  402: { code: '4.2', kind: 'area' },    // Open land with scattered trees
  403: { code: '4.3', kind: 'line' },    // Rough open land
  404: { code: '4.3', kind: 'area' },    // Rough open land with scattered trees
  405: { code: '4.5', kind: 'area' },    // Forest — run (medium green)
  406: { code: '4.5', kind: 'area' },    // Vegetation — slow run
  407: { code: '4.5', kind: 'area' },    // Vegetation — walk (dark green)
  408: { code: '4.5', kind: 'area' },    // Vegetation — fight
  409: { code: '4.5', kind: 'area' },    // Impassable vegetation
  410: { code: '4.4', kind: 'area' },    // Cultivated land (clearing)
  411: { code: '4.7', kind: 'line' },    // Distinct vegetation boundary
  412: { code: '4.7', kind: 'line' },    // Indistinct vegetation boundary
  416: { code: '4.5', kind: 'line' },    // Distinct cultivation boundary
  417: { code: '4.8', kind: 'area' },    // Copse / prominent large tree
  418: { code: '4.9', kind: 'point' },   // Prominent tree / bush
  419: { code: '4.10', kind: 'point' },  // Root stock / tree stump

  // Man-made 5xx
  501: { code: '5.1', kind: 'line' },    // Paved area / wide road
  502: { code: '5.1', kind: 'line' },    // Road
  503: { code: '5.2', kind: 'line' },    // Vehicle track
  504: { code: '5.2', kind: 'line' },    // Footpath
  505: { code: '5.2', kind: 'line' },    // Small footpath
  506: { code: '5.3', kind: 'line' },    // Ride / less distinct path
  507: { code: '5.4', kind: 'point' },   // Bridge
  508: { code: '5.4', kind: 'point' },   // Footbridge
  509: { code: '5.5', kind: 'line' },    // Power line / cable
  510: { code: '5.6', kind: 'point' },   // Power line pylon
  511: { code: '5.7', kind: 'line' },    // Tunnel
  512: { code: '5.11', kind: 'line' },   // Fence
  513: { code: '5.11', kind: 'line' },   // Ruined fence
  515: { code: '5.10', kind: 'line' },   // Stone wall
  516: { code: '5.10', kind: 'line' },   // Ruined stone wall
  518: { code: '5.12', kind: 'point' },  // Crossing point
  519: { code: '5.1', kind: 'area' },    // Paved area (area symbol)
  520: { code: '5.14', kind: 'area' },   // Building
  521: { code: '5.14', kind: 'area' },   // Canopy / Settlement
  522: { code: '5.14', kind: 'area' },   // Ruin
  523: { code: '5.15', kind: 'point' },  // High tower
  524: { code: '5.15', kind: 'point' },  // Small tower
  525: { code: '5.16', kind: 'point' },  // Cairn / pillar
  526: { code: '5.17', kind: 'point' },  // Fodder rack / feeding station
  527: { code: '5.18', kind: 'point' },  // Prominent man-made feature
  528: { code: '5.18', kind: 'point' },  // Prominent man-made feature (line)
  529: { code: '5.19', kind: 'point' },  // Stairway
  530: { code: '5.1', kind: 'area' },    // Paved area (wide)
  531: { code: '5.23', kind: 'point' },  // Statue / monument
  532: { code: '5.14', kind: 'area' },   // Building — pass through

  // Special objects 6xx
  601: { code: '5.20', kind: 'point' },  // Prominent man-made feature (X)
}

export function lookupIsom(ocadSym: number): IsomMapping | undefined {
  return TABLE[Math.floor(ocadSym / 1000)]
}

export function isControlFeatureSym(ocadSym: number): boolean {
  return Math.floor(ocadSym / 1000) in TABLE
}
