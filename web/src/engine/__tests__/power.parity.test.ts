// Owner: Nived
// TS twin of pipeline/lumen_pipeline/reference/power.py (R3 generic power model, G-10). Oracles that are NOT this code:
//   (a) Gowri's own hand-worked tests (pipeline/tests/gowri/test_power.py), ported case for case;
//   (b) fixtures/power_parity.json: 102 seeded cases run through her REAL Python (python3 web/src/mocks/make_power_parity.py).
// Conventions (hers, mirrored): site frame = (east, reference-north, up); azimuth is east of north; positive yaw increases azimuth;
// the off-nominal tilt direction is the azimuth toward which an up-facing panel tilts; attitude = tilt-onto-ground * yaw * off-nominal tilt.
import { describe, expect, it } from 'vitest';
import { AU_KM, SOLAR_CONSTANT_W_M2 } from '../core/constants';
import {
  attitudeMatrix, bestYawDeg, evaluatePowerSeries, flatGroundBaselineW, genericPanelPreset, integrateBatterySoc, orientPanels,
  solarGenerationW, solarIrradianceWM2, type Panel, type PanelPreset, type Vec3,
} from '../core/power';
import fixture from './fixtures/power_parity.json';

const UP: Vec3 = [0, 0, 1];
const PANEL: Panel = { normal: UP, areaM2: 2, efficiency: 0.25 };
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-12) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i]), `[${i}] ${a[i]} vs ${b[i]}`).toBeLessThanOrEqual(tol);
};
const rel = (got: number, want: number, r = 1e-10) => expect(Math.abs(got - want)).toBeLessThanOrEqual(r * Math.max(1, Math.abs(want)));

describe('Gowri hand-worked cases (test_power.py)', () => {
  it('generation applies daylight, darkness and the eclipse fraction', () => {
    const day = solarGenerationW(UP, AU_KM, 1, [PANEL]);
    expect(day).toBeCloseTo(SOLAR_CONSTANT_W_M2 * 0.5, 9);
    expect(solarGenerationW(UP, AU_KM, 0, [PANEL])).toBe(0);
    expect(solarGenerationW(UP, AU_KM, 0.5, [PANEL])).toBeCloseTo(day / 2, 9);
    expect(solarGenerationW([0, 0, -1], AU_KM, 1, [PANEL])).toBe(0);
  });
  it('presets need explicit physics and headings (no defaults)', () => {
    const four = genericPanelPreset('fourSide', { panelAreaM2: 2, efficiency: 0.25 });
    expect(four.length).toBe(4);
    [[0, 1, 0], [1, 0, 0], [0, -1, 0], [-1, 0, 0]].forEach((n, i) => near(four[i].normal, n));
    near(genericPanelPreset('singleHeading', { panelAreaM2: 2, efficiency: 0.25, headingDeg: 90 })[0].normal, [1, 0, 0]);
    near(genericPanelPreset('trackingMast', { panelAreaM2: 2, efficiency: 0.25, trackingAzimuthDeg: 180 })[0].normal, [0, -1, 0]);
    near(genericPanelPreset('horizontalDeck', { panelAreaM2: 2, efficiency: 0.25 })[0].normal, [0, 0, 1]);
    expect(() => genericPanelPreset('singleHeading', { panelAreaM2: 2, efficiency: 0.25 })).toThrow(/headingDeg/);
    expect(() => genericPanelPreset('trackingMast', { panelAreaM2: 2, efficiency: 0.25 })).toThrow(/trackingAzimuthDeg/);
  });
  it('attitude composes ground tilt, yaw and the off-nominal tilt', () => {
    const ground: Vec3 = [0.5, 0, Math.sqrt(0.75)];
    const deck = genericPanelPreset('horizontalDeck', { panelAreaM2: 1, efficiency: 1 });
    near(orientPanels(deck, ground, 0, 0, 0)[0].normal, ground);
    const north = genericPanelPreset('singleHeading', { panelAreaM2: 1, efficiency: 1, headingDeg: 0 });
    near(orientPanels(north, UP, 90, 0, 0)[0].normal, [1, 0, 0]);
    near(orientPanels(deck, UP, 0, 30, 90)[0].normal, [0.5, 0, Math.sqrt(0.75)]);
    expect(bestYawDeg(north, [1, 0, 0], UP, 0, 0)).toBe(90);
  });
  it('the flat-ground baseline uses the same controls without terrain tilt', () => {
    const deck = genericPanelPreset('horizontalDeck', { panelAreaM2: 1, efficiency: 1 });
    expect(flatGroundBaselineW(UP, AU_KM, 1, deck, 0, 0, 0)).toBeCloseTo(SOLAR_CONSTANT_W_M2, 9);
    expect(solarGenerationW(UP, AU_KM, 1, orientPanels(deck, [0.5, 0, Math.sqrt(0.75)], 0, 0, 0))).toBeCloseTo(SOLAR_CONSTANT_W_M2 * Math.sqrt(0.75), 9);
  });
  it('the battery integrates interval energy: charge, discharge, unserved load', () => {
    const c = integrateBatterySoc([0, 3600], [100, 100], [60, 60], { batteryCapacityWh: 200, usableDepthOfDischarge: 0.8, initialSocFraction: 0.5 });
    expect(c.storedEnergyWh[1]).toBeCloseTo(140, 9);
    expect(c.socFraction[1]).toBeCloseTo(0.7, 9);
    const d = integrateBatterySoc([0, 3600, 7200], [0, 0, 0], [60, 60, 60], { batteryCapacityWh: 200, usableDepthOfDischarge: 0.8, initialSocFraction: 0.5 });
    near(d.storedEnergyWh, [100, 40, 40], 1e-9);
    expect(d.unservedLoadWh[2]).toBeCloseTo(60, 9);
  });
  it('the battery reports the full limit and is timestep-consistent for constant power', () => {
    const f = integrateBatterySoc([0, 3600], [100, 100], [0, 0], { batteryCapacityWh: 100, usableDepthOfDischarge: 1, initialSocFraction: 0.8 });
    expect(f.storedEnergyWh[1]).toBe(100);
    expect(f.curtailedGenerationWh[1]).toBeCloseTo(80, 9);
    const r = integrateBatterySoc([0, 1800, 3600], [100, 100, 100], [0, 0, 0], { batteryCapacityWh: 500, usableDepthOfDischarge: 1, initialSocFraction: 0.2 });
    expect(r.socFraction[2]).toBeCloseTo(0.4, 9);
  });
  it('the combined series: generation, eclipse, load and SOC', () => {
    const r = evaluatePowerSeries([0, 3600], [UP, UP], [AU_KM, AU_KM], [1, 0], [PANEL], [10, 10], { batteryCapacityWh: 1000, usableDepthOfDischarge: 1, initialSocFraction: 0.5 });
    near(r.generationW, [680.5, 0], 1e-9);
    near(r.netW, [670.5, -10], 1e-9);
    expect(r.storedEnergyWh[1]).toBeCloseTo(830.25, 9);
  });
});

type C = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const byKind = (k: string) => fixture.cases.filter((c) => c.kind === k) as C[];
const panelsOf = (c: C): Panel[] => c.panels.map((p: C) => ({ normal: p.normal as Vec3, areaM2: p.areaM2, efficiency: p.efficiency }));

describe(`parity with ${fixture.source} (${fixture.cases.length} cases)`, () => {
  it('has the case mix the tests rely on', () => {
    expect(Object.fromEntries(['attitude', 'bestYaw', 'generation', 'battery', 'series'].map((k) => [k, byKind(k).length]))).toEqual({ attitude: 30, bestYaw: 24, generation: 30, battery: 14, series: 4 });
    expect(byKind('attitude').some((c) => c.groundNormal[2] === -1)).toBe(true); // the 180-degree branch
    expect(byKind('attitude').some((c) => c.groundNormal[2] === 1)).toBe(true); // the identity branch
    const b = byKind('battery');
    expect(b.some((c) => c.expected.curtailed_generation_wh.some((x: number) => x > 0))).toBe(true);
    expect(b.some((c) => c.expected.unserved_load_wh.some((x: number) => x > 0))).toBe(true);
  });

  it.each(byKind('attitude').map((c, i) => [i, c] as const))('attitude matrix, preset and oriented panels, case %i', (_i, c) => {
    const m = attitudeMatrix(c.groundNormal, c.yawDeg, c.tiltDeg, c.tiltDirDeg);
    m.forEach((row, r) => near(row, c.matrix[r], 1e-12));
    const panels = genericPanelPreset(c.preset as PanelPreset, c.presetArgs && { panelAreaM2: c.presetArgs.panel_area_m2, efficiency: c.presetArgs.efficiency, headingDeg: c.presetArgs.heading_deg, trackingAzimuthDeg: c.presetArgs.tracking_azimuth_deg });
    panels.forEach((p, k) => near(p.normal, c.panels[k].normal, 1e-12));
    orientPanels(panels, c.groundNormal, c.yawDeg, c.tiltDeg, c.tiltDirDeg).forEach((p, k) => {
      near(p.normal, c.oriented[k].normal, 1e-12);
      expect(p.areaM2).toBe(c.oriented[k].areaM2);
    });
  });

  it.each(byKind('bestYaw').map((c, i) => [i, c] as const))('best yaw (15 degree sweep, first maximum), case %i', (_i, c) => {
    expect(bestYawDeg(panelsOf(c), c.sun, c.groundNormal, c.tiltDeg, c.tiltDirDeg)).toBe(c.expected);
  });

  it.each(byKind('generation').map((c, i) => [i, c] as const))('irradiance, generation and flat-ground baseline, case %i', (_i, c) => {
    rel(solarIrradianceWM2(c.distanceKm), c.expected.irradiance);
    rel(solarGenerationW(c.sun, c.distanceKm, c.diskFraction, orientPanels(panelsOf(c), c.groundNormal, c.yawDeg, c.tiltDeg, c.tiltDirDeg)), c.expected.generationW);
    rel(flatGroundBaselineW(c.sun, c.distanceKm, c.diskFraction, panelsOf(c), c.yawDeg, c.tiltDeg, c.tiltDirDeg), c.expected.flatBaselineW);
  });

  it.each(byKind('battery').map((c, i) => [i, c] as const))('battery SOC integration, case %i', (_i, c) => {
    const r = integrateBatterySoc(c.timesS, c.generationW, c.loadW, { batteryCapacityWh: c.capacityWh, usableDepthOfDischarge: c.dod, initialSocFraction: c.initialSoc });
    near(r.netW, c.expected.net_w, 1e-9);
    near(r.socFraction, c.expected.soc_fraction, 1e-12);
    near(r.storedEnergyWh, c.expected.stored_energy_wh, 1e-9);
    near(r.curtailedGenerationWh, c.expected.curtailed_generation_wh, 1e-9);
    near(r.unservedLoadWh, c.expected.unserved_load_wh, 1e-9);
  });

  it.each(byKind('series').map((c, i) => [i, c] as const))('combined series, case %i', (_i, c) => {
    const r = evaluatePowerSeries(c.timesS, c.suns, c.distancesKm, c.disks, panelsOf(c), c.loadW, { batteryCapacityWh: c.capacityWh, usableDepthOfDischarge: c.dod, initialSocFraction: c.initialSoc });
    near(r.generationW, c.expected.generation_w, 1e-8);
    near(r.netW, c.expected.net_w, 1e-8);
    near(r.socFraction, c.expected.soc_fraction, 1e-12);
    near(r.storedEnergyWh, c.expected.stored_energy_wh, 1e-8);
  });

  it('rejects the same invalid inputs she rejects', () => {
    const E = fixture.errors as C[];
    const run = (e: C) => {
      const a = e.args;
      if (e.fn === 'solarIrradiance') return solarIrradianceWM2(a.distanceKm);
      if (e.fn === 'generation') return solarGenerationW(a.sun, a.distanceKm, a.disk, []);
      if (e.fn === 'preset') return genericPanelPreset(a.preset, { panelAreaM2: 1, efficiency: 0.1 });
      const n = a.timesS.length;
      return integrateBatterySoc(a.timesS, new Array(n).fill(0), new Array(n).fill(0), { batteryCapacityWh: a.capacityWh, usableDepthOfDischarge: a.dod, initialSocFraction: a.initialSoc });
    };
    for (const e of E) expect(() => run(e), JSON.stringify(e)).toThrow(RangeError);
  });
});
