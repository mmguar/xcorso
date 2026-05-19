# xcorso

A web-based orienteering course planner. Designed as a lightweight static website, it runs on any device with a modern browser, desktop or touch. It currently does not replace all complex workflows in [Condes](https://condes.net) and [Purple Pen](https://purplepen.golde.org/), but it can be used to design most orienteering events.

## What it does

- **Load maps** — OCAD files (via [ocad2geojson](https://github.com/perliedman/ocad2geojson)), bitmap images (PNG/JPG), and PDF maps
- **Place controls** — standard orienteering controls, easy to place and move
- **Build courses** — linear courses with automatic leg drawing and distance calculation, and Score-O (no legs, point values)
- **Race classes** — assign classes (e.g. "Men Elite", "Women A") to courses for IOF XML export
- **Control descriptions** — IOF 2018 standard pictographic symbols, with optional text descriptions. Place the clue sheet as a separate page or overlaid on the map
- **Annotations** — forbidden routes, crossing points, and out-of-bounds areas
- **Overlays** — placeable scale bars and text labels on the map
- **Cosmetic course modifications** — hide parts of the control marker or bend legs to avoid covering features. Change the appearance of control symbols.
- **Symbol specs** — ISOM 2017-2 (forest) and ISSprOM 2019 (sprint), selectable per project or per course, with spec-correct symbol dimensions
- **Export** — IOF XML v3 with class assignments (opens in Condes/Purple Pen), PDF with print preview dialog (page size, orientation, print scale, description sheet placement, tiling), and `.oco` project save/load (ZIP archive)

### Additional Features

- Show a rasterized version of the map or the fullly rendered vectorial image (HD)
- Drag controls and labels to reposition them, can be course-specific
- Set saturation of the map both while editing and for printing
- Right-click a control on the map to remove its last occurrence from the course
- Drag-to-reorder controls in the course editor panel (clue sheet view)
- Butterfly loops
- Automatically suggest a scale for printing
- Tiled PDF export when map extends beyond page

## Development roadmap

### Pre-release — 

- [x] Map loading (OCAD, bitmap, PDF)
- [x] Control placement (start, finish, control) with drag-to-move
- [x] Forbidden routes, crossing points, out-of-bounds areas
- [x] Scale measurement tool
- [x] .oco project save/load
- [x] Linear + Score-O  course creation with leg drawing and distance calculation
- [x] IOF XML v3 export (with class-course assignments)
- [x] Race classes — assign classes to courses
- [x] All-controls view (controls only, no legs) with PDF export support
- [x] Control descriptions — IOF 2018 pictographic symbols, full grid editor and PDF export
- [x] Map saturation slider (default 50%)
- [x] Butterfly loop variations (define loops, generate permutations, export per-variation)
- [x] Per-course text descriptions option for clue sheets
- [x] Finish type selector (taped / funnel / navigate)
- [x] Circle gaps, leg gaps and bend points
- [x] Scale bars and text labels (map overlays)
- [x] Appearance panel (control size, line width, colour, outline)
- [x] ISOM 2017-2 / ISSprOM 2019 symbol spec support
- [x] PDF export dialog with print preview, page size selection, and tiling

### Current roadmap

- [ ] Harden IOF XML export
- [ ] Fix some render errors 
- [ ] Fix rendering of some clue sheet modifiers
- [ ] Additional loop types
- [ ] KML/GPX export
- [ ] CMYK/offset printing 
- [ ] Better handling of e-punch stations numbers

### Currently out of scope

- Ski-O/MTB-O/Trail-O

## Comments/complaints/suggestions

I take them all! You can email me at matteo.guareschi@gmail.com, you can open an issue on github, or you write your code and create a PR.

Obviously the project is fairly vibe-coded, but I am trying to keep it manageable and with some level of standards. Trying to!



## Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Deploy | Cloudflare Pages (Wrangler) |
| State | Zustand (sliced store, undo/redo via project snapshots) |
| Styling | Tailwind CSS 4 |
| Rendering | Hybrid — pre-rasterized canvas base map with SVG course overlay, GPU-composited pan/zoom |
| Map parsing | `ocad2geojson` for OCAD, PDF.js for PDF, native `<image>` for bitmaps |
| PDF export | jsPDF + svg2pdf.js for course maps, jsPDF for description sheets |
| Project file | `.oco` — ZIP archive (JSZip) containing `project.json` + optional embedded map |
| Icons | Lucide React |
| Drag & drop | dnd-kit |

## Project structure

```
src/
├── types/index.ts                # All TypeScript interfaces (Control, Course, Project, etc.)
├── store/
│   ├── index.ts                  # Zustand store — composes slices, undo/redo
│   ├── types.ts                  # Store slice types
│   ├── controlsSlice.ts          # Control mutations
│   ├── coursesSlice.ts           # Course mutations
│   ├── annotationsSlice.ts       # Annotation mutations
│   ├── gapsSlice.ts              # Circle gap & leg gap mutations
│   ├── legsSlice.ts              # Leg bend-point mutations
│   └── overlaysSlice.ts          # Scale bar & text label mutations
├── lib/
│   ├── mapLoader.ts              # Loads OCAD/bitmap/PDF into renderable format
│   ├── distance.ts               # Course distance calculation (per-leg and total)
│   ├── courseUtils.ts             # Label formatting, sequence maps, variation resolution
│   ├── geometry.ts               # Shared geometry helpers (path walking, polyline clipping)
│   ├── symbolSpec.ts             # ISOM 2017-2 / ISSprOM 2019 symbol dimensions
│   ├── iofExport.ts              # IOF XML v3 export (with class assignments + variations)
│   ├── iofSymbols.ts             # IOF 2018 control description symbol catalog (~175 symbols)
│   ├── pdfExport.ts              # PDF map export (tiling, overlays, description sheet embed)
│   ├── pdfDescriptionSheet.ts    # Standalone IOF control description sheet PDF
│   ├── projectFile.ts            # .oco ZIP save/load
│   ├── persistence.ts            # Browser persistence utilities
│   └── perf.ts                   # Performance measurement helpers
├── components/
│   ├── WelcomeScreen.tsx         # Landing page — new project / open file
│   ├── AboutPage.tsx             # About page
│   ├── EditorScreen.tsx          # Main editor layout (header + canvas + sidebar)
│   ├── ControlDescriptionGrid.tsx # IOF control description grid with symbol picker
│   ├── IofSymbolIcon.tsx         # SVG renderer for IOF symbols
│   ├── ScaleInputDialog.tsx      # Modal dialog for scale measurement input
│   ├── PdfExportDialog.tsx       # PDF export settings + print preview
│   ├── usePdfExportState.ts      # PDF export dialog state hook
│   ├── ui/
│   │   ├── Header.tsx            # Top bar — project name, save, export
│   │   ├── Toolbar.tsx           # Floating bottom toolbar (tool select / course mode banner)
│   │   └── SidePanel.tsx         # Right sidebar (desktop) / bottom sheet (mobile)
│   ├── panels/
│   │   ├── ControlsPanel.tsx     # Controls list — edit codes/labels/points, or add to course
│   │   ├── CoursesPanel.tsx      # Course list + course editor (reorder, distances, settings)
│   │   ├── AppearancePanel.tsx   # Control size, line width, colour, outline settings
│   │   └── OverlaySettingsPanel.tsx # Scale bar & text label properties editor
│   └── canvas/
│       ├── MapCanvas.tsx         # Main canvas — pointer events, pan/zoom, hit testing
│       ├── MapCanvasLayer.tsx    # Pre-rasterized canvas base layer for GPU pan/zoom
│       ├── MapLayer.tsx          # Renders the map (OCAD SVG / bitmap / PDF)
│       ├── ControlsLayer.tsx     # Renders control symbols (triangles, circles, labels)
│       ├── LegsLayer.tsx         # Draws lines between consecutive course controls
│       ├── AnnotationsLayer.tsx  # Forbidden routes, crossing points, out-of-bounds
│       ├── OverlaysLayer.tsx     # Scale bars and text labels
│       ├── FpsCounter.tsx        # Dev-only FPS counter
│       ├── hitTesting.ts         # Click target resolution for controls/annotations/overlays
│       └── toolHandlers.ts       # Per-tool pointer event logic
```

## Data model

The core data lives in a single `Project` object:

- **Controls** — each has an `id`, `type` (start/finish/control), `code` (number), optional `label`, `points`, `description` (IOF pictographic), `gaps` (angular gaps in the circle/triangle/finish symbol), and a `position` in map coordinates
- **Courses** — ordered list of `CourseControl` references (each with optional `legGaps`, `legBendPoints`, `labelOffset`); each course has a `type` (linear/score), `color`, `finishType` (taped/funnel/navigate), optional `loops` and `variations` for butterfly courses, and optional `showPoints`/`textDescriptions` toggles
- **Classes** — race classes assigned to courses (e.g. "Men Elite" → "Course 1"), exported as `ClassCourseAssignment` in IOF XML
- **Annotations** — forbidden routes (polylines), crossing points, and out-of-bounds areas
- **Overlays** — scale bars and text labels, positioned in map coordinates
- **Map config** — filename, type, scale, dimensions, storage mode (embedded in ZIP or external reference)
- **Appearance** — control scale, line width, colour override, outline settings (editor-only, not serialized)

Coordinates are map-native: OCAD world units for `.ocd` files, pixels for bitmaps, PDF points for PDFs. Distances are computed from straight-line control-to-control distance scaled by the map's scale denominator, rounded to the nearest 10 m.

- 

## Browser support

| Browser | Minimum version |
|---------|----------------|
| Safari / iOS Safari | 15.4 (Mar 2022) |
| Chrome / Edge | 119 (Nov 2023) |
| Firefox | 121 (Dec 2023) |

On iPad, this covers 5th generation (2017) and newer.

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Load an OCAD file, bitmap, or PDF to get started.
