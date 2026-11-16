# visuals.md

_Owner: Ebin_

Colour/pattern encoding, axis conventions, chart interaction rules.

## Persona variants (Phase 5)
Planner = precise, Educator = plain words + rounded numbers. Wording lives in `web/src/features/shared/visualCopy.ts`
(`useVisualCopy()` in render, `visualCopy()` inside draw callbacks; put `persona` in `staticKey` so a switch repaints).
- Ribbon: V-exaggeration tag becomes "Heights stretched ×N so hills are easy to see"; Educator draws "Sun" / "Earth" text on the markers.
- Lens: Planner shows the V-6 check ("Sun disk 88% (engine) · drawn 88%"); Educator shows "About 90% of the Sun is showing" (rounded to 5).
- Barcode: legend + day ticks ("Earth only" → "Earth in view, no Sun", "d14" → "Day 14"); states are always pattern + colour.

## Coachmark anchors
Stable `data-coach` ids for the tour engine (`web/src/features/shared/coachAnchors.ts`, `COACH`):
`ribbon`, `ribbon-panorama`, `ribbon-sun-marker`, `ribbon-earth-marker`, `ribbon-horizon`, `ribbon-lens`, `ribbon-transport`,
`barcode`, `barcode-crosshair`, `barcode-legend`. Marker/horizon/crosshair ids are 1×1 invisible point anchors that follow the
drawn element (moved from the frame-bus draw, clamped to their box), so a spotlight can target things drawn on canvas.
Target with `document.querySelector('[data-coach="ribbon-sun-marker"]')`.
