// Owner: Abhinav
// Design tokens — the single source of truth. CSS custom properties are generated from this file at startup
// (installTokens), so Canvas/SVG code (Ebin, Nived) and CSS read identical values.
//
// Rules (FRONTEND_BUILD_GUIDE §1.2): chrome stays neutral; hue is reserved for data encodings. No blur, no layered
// shadows, no glow — elevation is surface colour + 1 px hairline. All numerals tabular monospace.

// ---------- colour ----------
export const color = {
  // surfaces (dark ops console), low → high elevation
  bg: '#0a0d12',
  surface1: '#10151d', // panels
  surface2: '#161c26', // cards, raised rows
  surface3: '#1e2632', // controls, hover
  surface4: '#28313f', // pressed / selected control
  hairline: '#232c39',
  hairlineStrong: '#344053',

  // text (contrast vs surface1 ≥ 4.5:1 for all three)
  text: '#e6ebf2',
  textMuted: '#a6b0c0',
  textFaint: '#8a95a8',
  textOnAccent: '#0a0d12',

  // neutral accent for selection / focus (not a data colour)
  accent: '#d4dbe6',
  focus: '#f2f5fa',

  // ---- data encodings (PLAN §8.1 #8; always paired with pattern or shape) ----
  sun: '#f5a524', // Sun amber — solid fill
  sunSoft: 'rgba(245, 165, 36, 0.18)',
  earth: '#4c9aff', // Earth blue — Earth-only state uses blue DOTS
  earthSoft: 'rgba(76, 154, 255, 0.18)',
  both: '#2ec4b6', // Sun + Earth teal
  bothSoft: 'rgba(46, 196, 182, 0.18)',
  blocked: '#5c667a', // blocked/none — grey HATCH
  blockedBg: '#1b212b',

  // terrain + uncertainty (Ribbon, Lens, curves)
  terrain: '#2a3240',
  terrainEdge: '#4a5568',
  sigmaBand: 'rgba(230, 235, 242, 0.12)',
  nearZone: 'rgba(230, 235, 242, 0.35)', // N⁺ hatch stroke

  // verdict (always with icon + text)
  go: '#3fb950',
  marginal: '#d8b23a',
  nogo: '#f0605a',
  pending: '#8a95a8',

  // Compare scenario tags A–D (always shown with the row letter; hues kept clear of Sun/Earth/both/verdict)
  rowA: '#a48bff', // violet
  rowB: '#ef7ac8', // pink
  rowC: '#c6cfdb', // pale steel
  rowD: '#c49a6c', // bronze
} as const;

/** Hatch / dot pattern geometry shared by CSS and Canvas (see ui/patterns.ts). */
export const pattern = {
  hatchSpacingPx: 6,
  hatchWidthPx: 1.5,
  hatchAngleDeg: 45,
  dotSpacingPx: 6,
  dotRadiusPx: 1.4,
} as const;

// ---------- typography ----------
export const font = {
  sans: '"IBM Plex Sans", "Plex Sans Fallback", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", "Plex Mono Fallback", ui-monospace, "Cascadia Mono", Consolas, monospace',
} as const;

/** Type scale in px at density d1. Presenter density multiplies by `typeScale` (×0.9). */
export const type = {
  '2xs': 10,
  xs: 11,
  sm: 12,
  md: 13,
  lg: 15,
  xl: 18,
  '2xl': 24,
  hero: 32,
} as const;
export type TypeStep = keyof typeof type;

export const weight = { regular: 400, medium: 500, semibold: 600 } as const;
export const lineHeight = { tight: 1.15, snug: 1.3, body: 1.45 } as const;

// ---------- spacing / radii ----------
export const space = { 0: 0, 1: 2, 2: 4, 3: 6, 4: 8, 5: 12, 6: 16, 7: 20, 8: 24 } as const;
export const radius = { sm: 2, md: 4, lg: 6, pill: 999 } as const;

// ---------- motion (emil-kowalski tokens only; §1.2) ----------
// Transform + opacity only. No overshoot. Exit ≤ enter. Reduced motion → ≤ 80 ms opacity.
export const motion = {
  durFast: 120, // press, chip, verdict crossfade, layer opacity
  durBase: 180, // segmented thumb, tab indicator, inset open
  durPopover: 150, // popover enter (Definitions ✎, verdict); exit uses durFast (exit ≤ enter)
  durDrawer: 260, // Quick-Start drawer
  durView: 150, // view crossfade (≤ 150 ms)
  durRow: 160, // compare row add/remove
  durSpotlight: 220, // coachmark spotlight move
  durTooltip: 100, // tooltip fade
  delayTooltip: 300, // tooltip open delay (0 when moving between badges)
  staggerCard: 40, // max per-card stagger
  durReduced: 80,
  easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)', // strong ease-out (popover, toast, thumbs)
  easeDrawer: 'cubic-bezier(0.32, 0.72, 0, 1)', // drawer curve
  easeLinear: 'linear', // playback only
} as const;

// ---------- density + slot budgets (§4) ----------
export type Density = 'd1' | 'd2' | 'd4';
export type Cols = 'c1' | 'c2' | 'c3' | 'c4';

/** Cockpit centre-column slot heights (px). `ribbonMin` is a floor; the Ribbon takes the remaining height. */
export const slotBudget = {
  d1: {
    missionBar: 56,
    answer: 92,
    definitions: 28,
    ribbonMin: 330,
    analysis: 170,
    barcode: 64,
    slip: 40,
    gutter: 8,
    pad: 8,
  },
  d2: {
    missionBar: 52,
    answer: 80,
    definitions: 26,
    ribbonMin: 280,
    analysis: 150,
    barcode: 56,
    slip: 38,
    gutter: 8,
    pad: 8,
  },
  d4: {
    missionBar: 48,
    answer: 72,
    definitions: 24,
    ribbonMin: 220,
    analysis: 130,
    barcode: 48,
    slip: 36,
    gutter: 6,
    pad: 6,
  },
} as const satisfies Record<Density, Record<string, number>>;

/** Side-column slots (px). Map is square. Right column at c4 becomes tabs [Metrics | Touchdown]. */
export const sideBudget = {
  d1: {
    search: 92,
    map: 320,
    metricDeck: 300,
    accordionHeader: 48,
    rightTabs: 30,
    compareRows: 264,
    deltaTable: 172,
    compareTabs: 28,
    compareWindows: 300,
  },
  d2: {
    search: 92,
    map: 290,
    metricDeck: 262,
    accordionHeader: 40,
    rightTabs: 28,
    compareRows: 236,
    deltaTable: 150,
    compareTabs: 26,
    compareWindows: 250,
  },
  d4: {
    search: 84,
    map: 240,
    metricDeck: 230,
    accordionHeader: 36,
    rightTabs: 28,
    compareRows: 208,
    deltaTable: 128,
    compareTabs: 24,
    compareWindows: 200,
  },
} as const satisfies Record<Density, Record<string, number>>;

/** Column widths (px) — nominal widths include gutters; the centre column takes the remainder. */
export const colBudget = {
  c1: { left: 400, centre: 960, right: 520 },
  c2: { left: 340, centre: 800, right: 396 },
  c3: { left: 340, centre: 740, right: 360 },
  c4: { left: 300, centre: 660, right: 320 },
} as const satisfies Record<Cols, { left: number; centre: number; right: number }>;

export const typeScale: Record<Density, number> = { d1: 1, d2: 1, d4: 0.9 };

/** Density is chosen from viewport size only (never user agent). */
export function pickDensity(w: number, h: number): Density {
  if (w >= 1880 && h >= 900) return 'd1';
  if (w >= 1400 && h >= 740) return 'd2';
  return 'd4';
}
export function pickCols(w: number): Cols {
  if (w >= 1880) return 'c1';
  if (w >= 1500) return 'c2';
  if (w >= 1400) return 'c3';
  return 'c4';
}
/** Right column switches to tabs [Metrics | Touchdown] on projector widths or windowed projector heights (V4/V4b). */
export function rightColumnTabs(w: number, h: number): boolean {
  return w < 1400 || h < 700;
}

// ---------- CSS generation ----------
// camelCase → kebab; digits stay attached (surface2 → surface2, textOnAccent → text-on-accent). Splitting digits
// (`surface-2`) silently broke every var(--c-surface1…4) reference until Phase 3 — tokens.test.ts and cssVars.test.ts guard it now.
export const kebab = (s: string) => s.replace(/[A-Z]+/g, (m) => '-' + m.toLowerCase()).replace(/^-/, '');
const px = (n: number) => `${n}px`;

export function buildTokenCss(): string {
  const root: string[] = [];
  for (const [k, v] of Object.entries(color)) root.push(`--c-${kebab(k)}: ${v};`);
  root.push(`--font-sans: ${font.sans};`, `--font-mono: ${font.mono};`);
  for (const [k, v] of Object.entries(type)) root.push(`--fs-${k}: calc(${v}px * var(--type-scale, 1));`);
  for (const [k, v] of Object.entries(weight)) root.push(`--fw-${k}: ${v};`);
  for (const [k, v] of Object.entries(lineHeight)) root.push(`--lh-${k}: ${v};`);
  for (const [k, v] of Object.entries(space)) root.push(`--sp-${k}: ${px(v)};`);
  for (const [k, v] of Object.entries(radius)) root.push(`--r-${k}: ${px(v)};`);
  for (const [k, v] of Object.entries(motion)) root.push(`--${kebab(k)}: ${typeof v === 'number' ? `${v}ms` : v};`);
  for (const [k, v] of Object.entries(pattern)) root.push(`--${kebab(k)}: ${typeof v === 'number' ? v : v};`);

  const blocks = [`:root{${root.join('')}}`];
  for (const d of Object.keys(slotBudget) as Density[]) {
    const vars = [`--type-scale: ${typeScale[d]};`];
    for (const [k, v] of Object.entries(slotBudget[d])) vars.push(`--slot-${kebab(k)}: ${px(v)};`);
    for (const [k, v] of Object.entries(sideBudget[d])) vars.push(`--slot-${kebab(k)}: ${px(v)};`);
    blocks.push(`:root[data-density="${d}"]{${vars.join('')}}`);
  }
  for (const c of Object.keys(colBudget) as Cols[]) {
    const { left, right } = colBudget[c];
    blocks.push(`:root[data-cols="${c}"]{--col-left: ${px(left)}; --col-right: ${px(right)};}`);
  }
  return blocks.join('\n');
}

/** Inject the generated CSS variables once, before first render. */
export function installTokens(doc: Document = document): void {
  if (doc.getElementById('lumen-tokens')) return;
  const el = doc.createElement('style');
  el.id = 'lumen-tokens';
  el.textContent = buildTokenCss();
  doc.head.prepend(el);
}
