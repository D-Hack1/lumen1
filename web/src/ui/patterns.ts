// Owner: Abhinav
// Redundant (non-colour) encodings shared by CSS and Canvas: blocked = grey hatch, Earth-only = blue dots.
// Canvas users: create once per (ctx, dpr) and reuse — never per frame.
import { color, pattern } from './tokens';

export type StateEncoding = 'sun' | 'earth' | 'both' | 'blocked';

/** CSS background for a state cell (barcode legend, chips, placeholders). */
export function cssStateFill(state: StateEncoding): string {
  const { hatchSpacingPx: s, hatchWidthPx: w, dotSpacingPx: d, dotRadiusPx: r } = pattern;
  switch (state) {
    case 'sun':
      return color.sun;
    case 'both':
      return color.both;
    case 'earth':
      return `radial-gradient(circle, ${color.earth} ${r}px, transparent ${r + 0.4}px) 0 0 / ${d}px ${d}px, ${color.blockedBg}`;
    case 'blocked':
      return `repeating-linear-gradient(45deg, ${color.blocked} 0 ${w}px, transparent ${w}px ${s}px), ${color.blockedBg}`;
  }
}

function tile(dpr: number, size: number, draw: (c: CanvasRenderingContext2D, n: number) => void) {
  const n = Math.max(1, Math.round(size * dpr));
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  draw(c, n);
  return cv;
}

/** 45° hatch pattern (blocked state, near-zone occluder N⁺ overlay). */
export function createHatchPattern(
  ctx: CanvasRenderingContext2D,
  dpr = 1,
  stroke: string = color.blocked,
  bg: string | null = color.blockedBg,
): CanvasPattern | null {
  const cv = tile(dpr, pattern.hatchSpacingPx, (c, n) => {
    if (bg) {
      c.fillStyle = bg;
      c.fillRect(0, 0, n, n);
    }
    c.strokeStyle = stroke;
    c.lineWidth = pattern.hatchWidthPx * dpr;
    c.beginPath();
    // three segments so the diagonal tiles seamlessly
    c.moveTo(-n, n * 2);
    c.lineTo(n * 2, -n);
    c.moveTo(-n, n);
    c.lineTo(n, -n);
    c.moveTo(0, n * 2);
    c.lineTo(n * 2, 0);
    c.stroke();
  });
  return ctx.createPattern(cv as CanvasImageSource, 'repeat');
}

/** Dot pattern (Earth-only state). */
export function createDotPattern(
  ctx: CanvasRenderingContext2D,
  dpr = 1,
  fill: string = color.earth,
  bg: string | null = color.blockedBg,
): CanvasPattern | null {
  const cv = tile(dpr, pattern.dotSpacingPx, (c, n) => {
    if (bg) {
      c.fillStyle = bg;
      c.fillRect(0, 0, n, n);
    }
    c.fillStyle = fill;
    c.beginPath();
    c.arc(n / 2, n / 2, pattern.dotRadiusPx * dpr, 0, Math.PI * 2);
    c.fill();
  });
  return ctx.createPattern(cv as CanvasImageSource, 'repeat');
}
