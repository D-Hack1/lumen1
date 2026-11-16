// Owner: Abhinav — unit tests for buses, frame bus, scenario store and URL sync.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBus, crosshairBus } from './buses';
import { frameBus } from './frameBus';
import { DEFAULT_SCENARIO, DEFINITIONS_PRESETS, pickScenario, useScenario } from './scenarioStore';
import { decodeScenario, encodeScenario } from './urlSync';
import { pickCols, pickDensity, rightColumnTabs } from '../ui/tokens';

beforeEach(() => useScenario.getState().reset());

describe('transient bus + frame bus', () => {
  it('coalesces many writes into one notify per frame with the latest value', () => {
    const bus = createBus('t', { x: 0 });
    const seen: number[] = [];
    bus.subscribe((v) => seen.push(v.x));
    for (let i = 1; i <= 600; i++) bus.set({ x: i });
    expect(seen).toEqual([]); // nothing synchronous
    frameBus.flushNow();
    expect(seen).toEqual([600]);
    frameBus.flushNow();
    expect(seen).toEqual([600]); // no change → no notify
  });

  it('does not notify when a write changes nothing', () => {
    const bus = createBus('t', { x: 1 });
    const fn = vi.fn();
    bus.subscribe(fn);
    bus.set({ x: 1 });
    frameBus.flushNow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs loops every frame until unsubscribed', () => {
    const fn = vi.fn();
    const stop = frameBus.loop(fn);
    frameBus.flushNow();
    frameBus.flushNow();
    stop();
    frameBus.flushNow();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('scenario store', () => {
  it('has every PLAN §6 + D-11 field', () => {
    const keys = Object.keys(pickScenario(useScenario.getState()));
    for (const k of [
      'view',
      'persona',
      'site',
      'landingUtc',
      'durationDays',
      'scrubUtc',
      'heightM',
      'panelPreset',
      'yawDeg',
      'tilt',
      'definitions',
      'definitionsPreset',
      'profile',
      'weights',
      'compareRows',
      'layers',
      'analysisTab',
      'compareTab',
    ])
      expect(keys).toContain(k);
    expect(useScenario.getState().definitions).toHaveProperty('minSunElevationOps', 0);
  });

  it('ISRO preset sets minSunElevationOps = 6; editing makes it custom; matching edit restores preset id', () => {
    const s = useScenario.getState();
    s.applyDefinitionsPreset('isroVikramOps');
    expect(useScenario.getState().definitions.minSunElevationOps).toBe(6);
    expect(useScenario.getState().definitionsPreset).toBe('isroVikramOps');
    s.setDefinitions({ earthMarginDeg: 2 });
    expect(useScenario.getState().definitionsPreset).toBe('custom');
    s.setDefinitions({ earthMarginDeg: DEFINITIONS_PRESETS.isroVikramOps.earthMarginDeg });
    expect(useScenario.getState().definitionsPreset).toBe('isroVikramOps');
  });

  it('compare rows: max 4, baseline kept on remove', () => {
    const s = useScenario.getState();
    expect(['A', 'B', 'C', 'D'].map(() => s.addCompareRow())).toEqual(['A', 'B', 'C', 'D']);
    expect(s.addCompareRow()).toBeNull();
    expect(useScenario.getState().compareRows[0].baseline).toBe(true);
    s.removeCompareRow('A');
    expect(useScenario.getState().compareRows.find((r) => r.baseline)?.id).toBe('B');
  });

  it('commitScrub moves the live crosshair', () => {
    useScenario.getState().commitScrub(123456);
    expect(crosshairBus.get().tScrub).toBe(123456);
    expect(useScenario.getState().scrubUtc).toBe(123456);
  });
});

describe('url sync', () => {
  it('round-trips the full scenario', () => {
    const s = useScenario.getState();
    s.setView('compare');
    s.setPersona('educator');
    s.applyDefinitionsPreset('isroVikramOps');
    s.addCompareRow();
    s.setSlip(9);
    const token = encodeScenario(useScenario.getState());
    const back = decodeScenario(token)!;
    expect(back).toEqual(pickScenario(useScenario.getState()));
  });

  it('ignores unknown fields and drops wrong-shaped ones', () => {
    const raw = {
      view: 'nope',
      persona: 'educator',
      foo: 1,
      durationDays: 30,
      tilt: { magnitudeDeg: 'x', directionDeg: 5 },
    };
    const token = `1.${btoa(JSON.stringify(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const out = decodeScenario(token)!;
    expect(out).not.toHaveProperty('foo');
    expect(out).not.toHaveProperty('view');
    expect(out.persona).toBe('educator');
    expect(out.durationDays).toBe(30);
    expect(out.tilt).toEqual({ magnitudeDeg: DEFAULT_SCENARIO.tilt.magnitudeDeg, directionDeg: 5 });
  });

  it('rejects other versions and garbage', () => {
    expect(decodeScenario('2.e30')).toBeNull();
    expect(decodeScenario('garbage')).toBeNull();
  });
});

describe('density', () => {
  it('maps the five test viewports', () => {
    const v = (w: number, h: number) => [pickDensity(w, h), pickCols(w), rightColumnTabs(w, h)];
    expect(v(1920, 960)).toEqual(['d1', 'c1', false]);
    expect(v(1536, 754)).toEqual(['d2', 'c2', false]);
    expect(v(1440, 810)).toEqual(['d2', 'c3', false]);
    expect(v(1280, 720)).toEqual(['d4', 'c4', true]);
    expect(v(1280, 640)).toEqual(['d4', 'c4', true]);
  });
});
