// Owner: Ebin
// Coachmark anchor ids on Ebin's visuals (guide Phase 5: "every tour starts on the Ribbon and Answer Strip").
// Abhinav's tour engine targets them with `[data-coach="<id>"]` — stable ids, never reordered by layout. Canvas
// things (Sun/Earth markers, the horizon, the crosshair) get a 1×1 invisible, pointer-transparent DOM anchor that
// follows the drawn element, repositioned from the same frame-bus draw (no React state), so a spotlight can point at it.
export const COACH = {
  ribbon: 'ribbon',
  ribbonPanorama: 'ribbon-panorama',
  ribbonSunMarker: 'ribbon-sun-marker',
  ribbonEarthMarker: 'ribbon-earth-marker',
  ribbonHorizon: 'ribbon-horizon',
  ribbonLens: 'ribbon-lens',
  ribbonTransport: 'ribbon-transport',
  barcode: 'barcode',
  barcodeCrosshair: 'barcode-crosshair',
  barcodeLegend: 'barcode-legend',
} as const;

export type CoachId = (typeof COACH)[keyof typeof COACH];

/** Spread onto an element: `<div {...coachAnchor(COACH.ribbon)}>`. */
export const coachAnchor = (id: CoachId) => ({ 'data-coach': id }) as const;

/** Style for a point anchor that sits inside a `position: relative` box and is moved via `el.style.transform`. */
export const POINT_ANCHOR_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  pointerEvents: 'none',
  opacity: 0,
} as const;

/**
 * Move a point anchor (frame-bus safe: one style write). Pass `bounds` to keep it inside its box — a body that is
 * off-chart (e.g. Earth far above the plotted elevation range) then anchors to the nearest edge, so a coachmark
 * spotlight never points at nothing.
 */
export function placeAnchor(el: HTMLElement | null, x: number, y: number, bounds?: { w: number; h: number }): void {
  if (!el) return;
  const cx = bounds ? Math.max(0, Math.min(bounds.w, x)) : x;
  const cy = bounds ? Math.max(0, Math.min(bounds.h, y)) : y;
  el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
}
