// Owner: Ebin
import { describe, expect, it } from 'vitest';
import { insidePolarMap } from './polarPin';
import { tagFromResult } from './realModel';
import type { ScenarioResult } from '../../engine/types';

const result = (verdict: ScenarioResult['verdict'], tierBadge: string, reasons: string[] = []): ScenarioResult =>
  ({
    status: 'ready',
    error: null,
    meta: { tierBadge } as never,
    verdict,
    verdictReasons: reasons,
    viability: null,
    answer: null,
    events: [],
    windows: [],
    series: null,
    metrics: null,
  }) as ScenarioResult;

describe('polar pin', () => {
  it('the polar map covers 80°S and further south only', () => {
    expect(insidePolarMap(-80)).toBe(true);
    expect(insidePolarMap(-87.9)).toBe(true);
    expect(insidePolarMap(-79.9)).toBe(false);
    expect(insidePolarMap(18.5)).toBe(false);
  });
});

describe('site list tags come from the engine verdict and say why a site is not judged', () => {
  it('no terrain -> "No terrain data"; mask without σ -> "σ unavailable"; plain pending stays "Unconfirmed"', () => {
    expect(tagFromResult(result('PENDING', 'Smooth-Moon horizon · terrain pending')).label).toBe('No terrain data');
    expect(tagFromResult(result('PENDING', 'Terrain mask · σ unavailable')).label).toBe('σ unavailable');
    expect(tagFromResult(result('PENDING', 'Terrain mask · σ Monte-Carlo, 30 clones')).label).toBe('Unconfirmed');
  });
  it('a real verdict keeps its own label, tone and first reason', () => {
    const t = tagFromResult(
      result('NO-GO', 'Terrain mask · σ Monte-Carlo, 30 clones', [
        'Longest night 117.0 h is above the maximum (72 h).',
      ]),
    );
    expect(t).toMatchObject({ label: 'No-go', tone: 'bad', verdict: 'NO-GO' });
    expect(t.reason).toContain('Longest night 117.0 h');
    expect(tagFromResult(result('GO', 'Terrain mask · σ Monte-Carlo, 30 clones')).tone).toBe('good');
  });
});
