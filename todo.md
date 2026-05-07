### Features
- [x] Print the "all controls" view (added to PDF export dialog)
- [x] Saturation slider for map (default 50%, bottom-left overlay)
- [x] Course name click focuses/selects the course; chevron only expands/collapses
- [x] Out-of-bounds area drawing tool (ISOM 709, toolbar + PDF export)
- [x] Collapsible right sidebar drawer (auto-collapses when >1/3 of window, opens on course select)
- [x] Drag to move controls in cursor/select mode (start, finish, control)
- [x] Delete tool — click control or annotation to delete, Delete/Backspace key deletes selected control, undo restores
- [x] Theme color changed from purple to orienteering orange
- [x] There should be a feature to add all controls in order to a course
- [x] We should also let users type all the controls they want to add to a course
- [x] the collapsed version of the sidebar has a + option to add a new course, it should show a quick dropdown menu to choose linear or score-o.
- [x] We absolutely need a feature to hide part of a control circle or of a line
- [x] We also need a feature to slightly move a line, for example by adding a second point so it becomes two segments, basically sometimes we don't want the line between controls to be perfectly straight
- [ ] we want to move around control numbers maybe. do not implement yet
- [ ] we want to be able to set the climb for the course and have it shown in the header of the control description sheet
- [ ] we need to update the clue sheet to correctly show the start and finish and its header
- [ ] we want a feature that lets us add a scale bar to the map. The scale bar should be five segments, show the length of one segment and of all five, it should also state the scale. I think the best way would be to show it on a white square and we should be able to set the alpha of the white square (up to totally transparent) 
- [ ] for the pdf export feature, the current preview we have is extremely cool, that's what differentiates xcorso. We should make it be course dependent.for each course selected, we should show a preview and be able to move it around or center it, even show the control sheet in differnt positions.
### Bugs
- [x] All controls view no longer shows legs, just control points
- [x] Zoom out bug — MIN_SCALE now based on initial fit-to-screen scale
- [x] Controls panel alignment — matched text sizes in course mode
- [x] OCAD map partial rendering at far zoom — split map/overlay into separate SVGs so CSS filter applies to screen-sized element
- [x] Saturation slider unusable — pointer capture now skips HTML inputs
- [x] IOF XML v3 does not seem well supported, the files we export do not work in other software
- [x] We are too aggressive on input validation in most textboxes. You can't delete the last character because it would be an invalid value, you can't write a control number that already exists, etc.
### Improvements
- [x] OCAD maps rasterized to PNG for fast pan/zoom, with HD toggle to switch to full-quality SVG
### Tech debt
- [x] ISOM symbol sizes now derived from scaleMeasurement via shared `unitsPerMm()` — no more hardcoded px approximations
