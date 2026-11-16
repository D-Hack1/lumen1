// Owner: Abhinav
import { describe, expect, it } from 'vitest';
import { keyRows, lightDirection, tooltipCopy } from './polarCopy';
import type { PolarSample } from './polarTerrain';

const base: PolarSample = {
  px: 1,
  py: 1,
  lat: -85.5,
  lon: -20,
  heightM: -1234,
  alwaysDark: false,
  monthLitPct: 42,
  sunElevationDeg: 3.2,
  sunHorizonDeg: 1.1,
  sunlit: true,
  earthElevationDeg: 4,
  earthHorizonDeg: 6,
  earthVisible: false,
};

describe('polar copy', () => {
  it('formats the coordinate line', () => {
    expect(tooltipCopy(base, 'live', false).coords).toBe('85.50°S 20.0°W · -1.2 km');
  });

  it('calls always-dark ground permanently dark on every layer, only when the switch is on', () => {
    for (const layer of ['live', 'earth', 'month'] as const) {
      expect(tooltipCopy({ ...base, alwaysDark: true }, layer, true).title).toBe('Permanently dark');
      expect(tooltipCopy({ ...base, alwaysDark: true }, layer, false).title).not.toBe('Permanently dark');
    }
    expect(tooltipCopy({ ...base, alwaysDark: true }, 'earth', true).body).toContain('hidden from here right now');
  });

  it('describes sun, earth and month states', () => {
    expect(tooltipCopy(base, 'live', false).title).toBe('Sunlit now');
    expect(tooltipCopy({ ...base, sunlit: false }, 'live', false).title).toBe('In shadow now');
    expect(tooltipCopy(base, 'earth', false).title).toBe('Earth hidden by terrain');
    expect(tooltipCopy(base, 'month', false).title).toBe('42% of the month in sunlight');
    expect(tooltipCopy({ ...base, monthLitPct: 10 }, 'month', false).body).toBe('Mostly dark.');
    expect(tooltipCopy({ ...base, monthLitPct: 80 }, 'month', false).body).toBe('Mostly sunlit.');
  });

  it('adds the violet key row only when always-dark is shown (not on the Earth layer)', () => {
    expect(keyRows('live', true).length).toBe(keyRows('live', false).length + 1);
    expect(keyRows('month', true).length).toBe(keyRows('month', false).length + 1);
    expect(keyRows('earth', true).length).toBe(keyRows('earth', false).length);
  });

  it('names the light direction', () => {
    expect(lightDirection(180)).toBe('180° (S on the map)');
    expect(lightDirection(359)).toBe('359° (N on the map)');
  });
});
