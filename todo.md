### Features
- [x] Print the "all controls" view (added to PDF export dialog)
- [x] Saturation slider for map (default 50%, bottom-left overlay)
- [x] Course name click focuses/selects the course; chevron only expands/collapses
- [x] Out-of-bounds area drawing tool (ISOM 709, toolbar + PDF export)
- [x] Collapsible right sidebar drawer (auto-collapses when >1/3 of window, opens on course select)
- [ ] A very important feature that is missing is the ability to drag a control, when we are in cursor mode, dragging a control (or start or finish) should move it around, not move the map.
- [ ] We need a delete tool, when I use it, if I click on something we added (a cross hatching, a forbidden crossing, a control) it should delete it. And undo should recreate it.
### Bugs
- [x] All controls view no longer shows legs, just control points
- [x] Zoom out bug — MIN_SCALE now based on initial fit-to-screen scale
- [x] Controls panel alignment — matched text sizes in course mode
- [x] OCAD map partial rendering at far zoom — split map/overlay into separate SVGs so CSS filter applies to screen-sized element
- [x] Saturation slider unusable — pointer capture now skips HTML inputs
### Tech debt
- ISOM symbol sizes for bitmap/PDF maps use hardcoded pixel approximations (~4px/mm) instead of deriving px-per-mm from scaleMeasurement. Affects all symbols (controls, legs, annotations), not just out-of-bounds. OCAD maps and PDF export are correct.
