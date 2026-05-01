### Features
- [x] Print the "all controls" view (added to PDF export dialog)
- [x] Saturation slider for map (default 50%, bottom-left overlay)
- [x] Course name click focuses/selects the course; chevron only expands/collapses
- [x] Out-of-bounds area drawing tool (ISOM 709, toolbar + PDF export)
- [x] Collapsible right sidebar drawer (auto-collapses when >1/3 of window, opens on course select)
- [x] Drag to move controls in cursor/select mode (start, finish, control)
- [x] Delete tool — click control or annotation to delete, Delete/Backspace key deletes selected control, undo restores
- [x] Theme color changed from purple to orienteering orange
### Bugs
- [x] All controls view no longer shows legs, just control points
- [x] Zoom out bug — MIN_SCALE now based on initial fit-to-screen scale
- [x] Controls panel alignment — matched text sizes in course mode
- [x] OCAD map partial rendering at far zoom — split map/overlay into separate SVGs so CSS filter applies to screen-sized element
- [x] Saturation slider unusable — pointer capture now skips HTML inputs
### Improvements
- [x] OCAD maps rasterized to PNG for fast pan/zoom, with HD toggle to switch to full-quality SVG
### Tech debt
- [x] ISOM symbol sizes now derived from scaleMeasurement via shared `unitsPerMm()` — no more hardcoded px approximations
