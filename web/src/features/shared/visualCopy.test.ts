import { describe, expect, it } from 'vitest';
import { makeVisualCopy } from './visualCopy';
import { COACH } from './coachAnchors';

describe('visualCopy', () => {
  it('Planner keeps precision, Educator uses plain words and rounds to 5', () => {
    const p = makeVisualCopy('planner');
    const e = makeVisualCopy('educator');
    expect(p.pct(87.6)).toBe('88');
    expect(e.pct(87.6)).toBe('90');
    expect(p.t('lens.sunDisk', { pct: p.pct(88), drawn: p.pct(88) })).toContain('(engine)');
    expect(e.t('lens.sunDisk', { pct: e.pct(88), drawn: e.pct(88) })).toBe('About 90% of the Sun is showing');
    expect(e.t('barcode.earth')).not.toBe(p.t('barcode.earth'));
  });
  it('unknown keys are visible, never blank', () => {
    expect(makeVisualCopy('educator').t('nope.key')).toBe('nope.key');
  });
  it('coach anchor ids are unique', () => {
    const ids = Object.values(COACH);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
