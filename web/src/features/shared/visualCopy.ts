// Owner: Ebin
// Persona-aware wording for Ebin's visuals (Ribbon, Horizon Lens, Barcode). Same rule as the app copy (state/copy.ts):
// Planner = precise, Educator = plain words + rounded numbers. Kept here (not in content/personaCopy.ts, which is
// Abhinav's) so the visuals own their labels; if the team prefers one table, these keys can move over unchanged.
// Draw callbacks run in the frame bus and can't use hooks: they call `visualCopy()` which reads the persona at draw
// time, and the components put `persona` into `staticKey` so a persona switch repaints.
import { getScenario, useScenario, type Persona } from '../../state/scenarioStore';

type Table = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

const planner: Table = {
  'ribbon.vtag': 'V ×{n} · not to scale',
  'ribbon.noMask': 'no terrain mask (Tier C / smooth-sphere estimate)',
  'ribbon.sun': 'Sun',
  'ribbon.earth': 'Earth',
  'lens.scale': 'true scale · clipped by terrain',
  'lens.sunDisk': 'Sun disk {pct}% (engine) · drawn {drawn}%',
  'lens.earthDisk': 'Earth disk {pct}% (engine) · drawn {drawn}%',
  'barcode.sun': 'Sun',
  'barcode.earth': 'Earth only',
  'barcode.both': 'Sun + Earth',
  'barcode.blocked': 'Blocked',
  'barcode.day': 'd{n}',
  'barcode.aria': 'Survival barcode: Sun and Earth availability by day since landing',
  'disp.within': '{pct}% of spots < {tol}°',
  'disp.axis': 'slope at candidate spots',
  'twin.label': 'Earth twin: Sun path at this latitude today (educational approximation)',
  'twin.toggle': 'Earth twin',
};

const educator: Table = {
  'ribbon.vtag': 'Heights stretched ×{n} so hills are easy to see',
  'ribbon.noMask': 'No hill data here — shown as a flat Moon',
  'ribbon.sun': 'Sun',
  'ribbon.earth': 'Earth',
  'lens.scale': 'real size · hills hide part of it',
  'lens.sunDisk': 'About {pct}% of the Sun is showing',
  'lens.earthDisk': 'About {pct}% of the Earth is showing',
  'barcode.sun': 'Sunlight',
  'barcode.earth': 'Earth in view, no Sun',
  'barcode.both': 'Sun and Earth',
  'barcode.blocked': 'Dark and cut off',
  'barcode.day': 'Day {n}',
  'barcode.aria': 'Each bar shows, day by day after landing, whether the Sun and the Earth can be seen',
  'disp.within': 'About {pct}% of possible spots are under {tol}° (gentle enough)',
  'disp.axis': 'how steep each possible spot is',
  'twin.label': 'On Earth, at this latitude, the Sun would follow this path in one day',
  'twin.toggle': 'Compare with Earth',
};

export interface VisualCopy {
  persona: Persona;
  t(key: string, vars?: Record<string, string | number>): string;
  /** Educator rounds percentages to the nearest 5; Planner keeps whole-number precision. */
  pct(n: number): string;
}

export function makeVisualCopy(persona: Persona): VisualCopy {
  const tbl = persona === 'educator' ? educator : planner;
  return {
    persona,
    t: (key, vars = {}) => fill(tbl[key] ?? planner[key] ?? key, vars),
    pct: (n) => (persona === 'educator' ? String(Math.round(n / 5) * 5) : n.toFixed(0)),
  };
}

/** For draw callbacks (frame bus): reads the persona now. */
export const visualCopy = (): VisualCopy => makeVisualCopy(getScenario().persona);

/** For React render paths: re-renders on persona change. */
export function useVisualCopy(): VisualCopy {
  return makeVisualCopy(useScenario((s) => s.persona));
}
