### Bugs
- [ ] ocad2geojson fence rendering
- [ ] in pdf export interaace print scale can become a NaN and fail. Also why does it suggest 1:2? 
### Features

### Improvements
- [ ] we need to make sure that the finish line on the clue sheet has bigger controls symbols and the funnel one has a space before the funnel to match the standard
- [ ] fix the fact that the dropdown is the way to select courses
- [x] show the crosshair in controls
- [ ] we should be able to choose page size for each course and it should be saved.
- [ ] we should have a print preview mode where we can move around the clue sheet, scale, other text, course-by-course.
- [ ] we maybe should have a way not to print whole page but to have a little border

### Tech debt
- [x] ISOM symbol sizes now derived from scaleMeasurement via shared `unitsPerMm()` — no more hardcoded px approximations
