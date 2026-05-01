# xcorso

A web-based orienteering course planner. Designed as a lightweight helper tool that sits alongside [Condes](https://condes.net) and [Purple Pen](https://purplepen.golde.org/) in a course-setting workflow — not a replacement, but a fast way to sketch courses on any device with a browser.

Works on desktop and iPad (full touch support with pan/zoom).

## What it does

- **Load maps** — OCAD files (via [ocad2geojson](https://github.com/perliedman/ocad2geojson)), bitmap images (PNG/JPG), and PDF maps
- **Place controls** — start (triangle), finish (double circle), and numbered controls, all draggable
- **Build courses** — linear courses with automatic leg drawing and distance calculation, and Score-O (no legs, point values)
- **Annotations** — forbidden routes (polylines) and crossing points
- **Scale** — reads scale from OCAD files or lets you measure two points and enter the real-world distance
- **Control descriptions** — IOF 2018 standard pictographic symbols, editable per-control grid with all columns (C–H)
- **Race classes** — assign classes (e.g. "Men Elite", "Women A") to courses for IOF XML export
- **All-controls view** — see every control at once (no legs), also printable via PDF export
- **Map saturation** — slider to reduce map colour saturation (default 50%) so course overlays stand out
- **Export** — IOF XML v3 with class assignments (opens in Condes/Purple Pen), PDF (per-course and all-controls), and `.oco` project save/load (ZIP archive)

### Course editing features

- Start is always first, finish is always last; one of each per course
- Controls show course-specific sequence numbers on the map (linear courses)
- Points can be assigned to controls globally; each course has a "Show points" toggle
- Starts/finishes are auto-numbered (S1, S2, F1, F2) with editable labels
- Right-click a control on the map to remove its last occurrence from the course
- Drag-to-reorder controls in the course editor panel

## Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| State | Zustand (single store, undo/redo via project snapshots) |
| Styling | Tailwind CSS |
| Rendering | SVG (map + course overlay in one `<svg>`) |
| Map parsing | `ocad2geojson` for OCAD, PDF.js for PDF, native `<image>` for bitmaps |
| Project file | `.oco` — ZIP archive (JSZip) containing `project.json` + optional embedded map |
| Icons | Lucide React |

## Project structure

```
src/
├── types/index.ts              # All TypeScript interfaces (Control, Course, Project, etc.)
├── store/index.ts              # Zustand store — state + all mutations + undo/redo
├── lib/
│   ├── mapLoader.ts            # Loads OCAD/bitmap/PDF into renderable format
│   ├── distance.ts             # Course distance calculation (per-leg and total)
│   ├── iofExport.ts            # IOF XML v3 export (with class assignments)
│   ├── iofSymbols.ts           # IOF 2018 control description symbol catalog (~175 symbols)
│   └── projectFile.ts          # .oco ZIP save/load
├── hooks/
│   └── useViewport.ts          # Viewport state hook
├── components/
│   ├── WelcomeScreen.tsx       # Landing page — new project / open file
│   ├── EditorScreen.tsx        # Main editor layout (header + canvas + sidebar)
│   ├── ControlDescriptionGrid.tsx # IOF control description grid with symbol picker
│   ├── IofSymbolIcon.tsx       # SVG renderer for IOF symbols
│   ├── ScaleInputDialog.tsx    # Modal dialog for scale measurement input
│   ├── ui/
│   │   ├── Header.tsx          # Top bar — project name, save, export
│   │   ├── Toolbar.tsx         # Floating bottom toolbar (tool select / course mode banner)
│   │   └── SidePanel.tsx       # Right sidebar (desktop) / bottom sheet (mobile)
│   ├── panels/
│   │   ├── ControlsPanel.tsx   # Controls list — edit codes/labels/points, or add to course
│   │   └── CoursesPanel.tsx    # Course list + course editor (reorder, distances, settings)
│   └── canvas/
│       ├── MapCanvas.tsx       # Main canvas — pointer events, pan/zoom, hit testing
│       ├── MapLayer.tsx        # Renders the map (OCAD SVG / bitmap / PDF)
│       ├── ControlsLayer.tsx   # Renders control symbols (triangles, circles, labels)
│       ├── LegsLayer.tsx       # Draws lines between consecutive course controls
│       └── AnnotationsLayer.tsx # Forbidden routes, crossing points
```

## Data model

The core data lives in a single `Project` object:

- **Controls** — each has an `id`, `type` (start/finish/control), `code` (number), optional `label`, `points`, `description` (IOF pictographic), and a `position` in map coordinates
- **Courses** — ordered list of `CourseControl` references; each course has a `type` (linear/score), `color`, and optional `showPoints` toggle
- **Classes** — race classes assigned to courses (e.g. "Men Elite" → "Course 1"), exported as `ClassCourseAssignment` in IOF XML
- **Annotations** — forbidden routes (polylines) and crossing points
- **Map config** — filename, type, scale, storage mode (embedded in ZIP or external reference)

Coordinates are map-native: OCAD world units for `.ocd` files, pixels for bitmaps, PDF points for PDFs. Distances are computed from straight-line control-to-control distance scaled by the map's scale denominator.

## Development roadmap

### Phase 1 — Map & controls (done)

- [x] Map loading (OCAD, bitmap, PDF)
- [x] Control placement (start, finish, control) with drag-to-move
- [x] Forbidden routes and crossing points
- [x] Scale measurement tool
- [x] .oco project save/load

### Phase 2 — Courses & export (done)

- [x] Linear course creation with leg drawing and distance calculation
- [x] Score-O courses (no legs, per-control point values)
- [x] Course editing mode (click to add, right-click to remove, drag to reorder)
- [x] IOF XML v3 export (with class-course assignments)
- [x] Start/finish ordering and uniqueness per course
- [x] Course-specific control numbering on map
- [x] Global control points with per-course "Show points" toggle
- [x] Editable start/finish labels
- [x] Race classes — assign classes to courses
- [x] All-controls view (controls only, no legs) with PDF export support
- [x] Control descriptions — IOF 2018 pictographic symbols, full grid editor
- [x] Scale measurement modal dialog (iPad-compatible, replaces browser prompt)
- [x] Map saturation slider (default 50%)

### Phase 3 — Advanced features (not started)

- [ ] Relay / fork course variations (data model has `branchId` placeholder)
- [ ] Control description sheet print/export
- [ ] KML/GPX export

### Out of scope

Cloud storage, Ski-O/MTB-O/Trail-O, climb calculation, CMYK/offset printing.

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
# xcorso
