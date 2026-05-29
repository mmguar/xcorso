# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

Never test anything in browser using playwright, let the user test.

## Commands

- `npm run dev` — start Vite dev server (http://localhost:5173)
- `npm run build` — type-check (`tsc -b`) then build for production
- `npx tsc -b --noEmit` — type-check only (no test suite exists yet)
- `npm run lint` — ESLint

## What this is

xcorso is a web-based orienteering course planner — a helper tool alongside Condes and Purple Pen. It loads OCAD, bitmap, or PDF maps and lets users place controls, build courses, and export IOF XML v3. Target platforms are desktop browsers and iPad (full touch).

## Architecture

**Single Zustand store** (`src/store/index.ts`) owns all state. The `Project` object (types, controls, courses, annotations, map config) is the serializable core. Undo/redo works by snapshotting the entire `Project` via `structuredClone` before each mutation. Editor-only state (active tool, selection, viewport, pending annotation points) lives alongside but is not undoable.

**Coordinate systems vary by map type.** OCAD files use world units (1 unit = 1/100 mm on paper). Bitmaps use pixels. PDFs use PDF points. All control positions, annotation points, and distance calculations must respect `project.map.type`. The `MapConfig.scale` field stores the denominator (10000 = 1:10000). For bitmap/PDF, accurate distance requires a `scaleMeasurement` (two calibration points + real-world distance).

**Rendering is pure SVG.** `MapCanvas` owns the viewport (pan/zoom) and all pointer/touch/wheel event handling via native listeners in a single `useLayoutEffect` with `[]` deps. It reads store actions once (Zustand action refs are stable) and reads live state via `useStore.getState()` inside handlers to avoid stale closures. The layer stack (both canvas and PDF): MapLayer (base map) → AnnotationsLayer (forbidden routes, crossing points) → Course (legs + controls + labels) → Border (page margins mask) → Overlays (scale bars, text labels, images — always visible above border).

**ISOM 2017-2 symbol sizing** is duplicated across canvas layer files. Control circle radius: 300 OCAD units / 12 px. Stroke width: 60 OCAD units / 2.5 px. These constants must stay consistent between `ControlsLayer.tsx`, `LegsLayer.tsx`, and `AnnotationsLayer.tsx`.

**Export lives in `src/lib/`.** `iofExport.ts` builds IOF XML v3 via string concatenation (the `tag()` helper escapes attribute values automatically — do not pre-escape values passed to it). `projectFile.ts` handles `.oco` ZIP archives via JSZip.

## Key constraints

- `ocad2geojson` is a Node.js library used in-browser. Vite polyfills `Buffer` via the `buffer` package and aliases `global` to `globalThis`. The polyfill is loaded in `main.tsx` before anything else.
- `pdfjs-dist` is excluded from Vite's `optimizeDeps` and its worker is loaded via URL constructor at runtime.
- The app targets iPad with full touch support. Avoid `window.prompt()`, `window.confirm()`, or other blocking browser dialogs — they behave poorly on mobile.
