// Owner: Nived
// Seam: PerfRecorder (pure; injected clock) and the window.__lumenPerf surface.   Build guide: Perf HUD + window.__lumenPerf; G8.
// Percentile = NEAREST-RANK: the k-th smallest value where k = ceil(p/100 * n). Every expectation below is worked out by hand.
import { describe, expect, it } from 'vitest';
import { installPerf, PerfRecorder, percentile } from '../perf';

describe('percentile (nearest-rank), by hand', () => {
  it('[1..10]: p50 = 5th = 5, p95 = ceil(9.5) = 10th = 10, p100 = 10, p10 = 1st = 1', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile(xs, 100)).toBe(10);
    expect(percentile(xs, 10)).toBe(1);
  });
  it('[10,20,30,40]: p25 = 1st = 10, p50 = 2nd = 20, p95 = ceil(3.8) = 4th = 40', () => {
    const xs = [10, 20, 30, 40];
    expect(percentile(xs, 25)).toBe(10);
    expect(percentile(xs, 50)).toBe(20);
    expect(percentile(xs, 95)).toBe(40);
  });
  it('a single sample is every percentile; an empty set has none', () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('PerfRecorder', () => {
  it('stat: n, mean, max, p50, p95 for [2,4,6,8] = 4 / 5 / 8 / 4 / 8, regardless of insertion order', () => {
    const r = new PerfRecorder();
    for (const v of [8, 2, 6, 4]) r.record('x', v);
    expect(r.stat('x')).toEqual({ n: 4, mean: 5, max: 8, p50: 4, p95: 8 });
  });
  it('an unknown or empty series reports n = 0 and nulls (JSON-safe, no NaN)', () => {
    expect(new PerfRecorder().stat('nothing')).toEqual({ n: 0, mean: null, max: null, p50: null, p95: null });
  });
  it('keeps only the most recent `capacity` samples: capacity 5, record 1..8 => [4..8], n 5, max 8, p50 = 3rd = 6', () => {
    const r = new PerfRecorder(undefined, 5);
    for (let i = 1; i <= 8; i++) r.record('x', i);
    const s = r.stat('x');
    expect([s.n, s.max, s.p50]).toEqual([5, 8, 6]);
  });
  it('time() measures with the injected clock: 100 -> 112.5 is 12.5 ms', () => {
    let now = 100;
    const r = new PerfRecorder(() => now);
    const out = r.time('job', () => {
      now = 112.5;
      return 'result';
    });
    expect(out).toBe('result');
    expect(r.stat('job').p50).toBe(12.5);
  });
  it('timeAsync() measures an awaited promise and still returns its value, even when it rejects', async () => {
    let now = 0;
    const r = new PerfRecorder(() => now);
    expect(await r.timeAsync('a', async () => ((now = 40), 'ok'))).toBe('ok');
    await expect(r.timeAsync('b', async () => ((now = 90), Promise.reject(new Error('boom'))))).rejects.toThrow('boom');
    expect(r.stat('a').p50).toBe(40);
    expect(r.stat('b').n).toBe(1); // the failed call was still timed (50 ms)
    expect(r.stat('b').p50).toBe(50);
  });
  it('input -> frame latency counts from the OLDEST pending input: input@100, input@102, frame@105 => 5 ms; then nothing pending', () => {
    let now = 0;
    const r = new PerfRecorder(() => now);
    now = 100;
    r.markInput('hover');
    now = 102;
    r.markInput('hover');
    now = 105;
    r.frameDone('hover');
    now = 120;
    r.frameDone('hover'); // no input since: must NOT record a bogus 15 ms
    expect(r.stat('hover')).toEqual({ n: 1, mean: 5, max: 5, p50: 5, p95: 5 });
  });
  it('counters increment and appear in the snapshot beside the series', () => {
    const r = new PerfRecorder();
    r.inc('reactCommits');
    r.inc('reactCommits');
    r.inc('longTasks', 3);
    r.record('x', 1);
    const snap = r.snapshot();
    expect(snap.counters).toEqual({ reactCommits: 2, longTasks: 3 });
    expect(snap.series.x.n).toBe(1);
  });
  it('reset() clears series, counters and pending inputs', () => {
    let now = 0;
    const r = new PerfRecorder(() => now);
    r.record('x', 1);
    r.inc('c');
    r.markInput('hover');
    r.reset();
    now = 50;
    r.frameDone('hover');
    expect(r.snapshot()).toEqual({ series: {}, counters: {} });
  });
});

describe('window.__lumenPerf', () => {
  it('exposes the documented surface for automated tests, backed by the recorder', () => {
    const target: Record<string, unknown> = {};
    const r = new PerfRecorder();
    installPerf(target as never, r);
    const api = target.__lumenPerf as { snapshot(): unknown; reset(): void; start(): void; stop(): void; stat(n: string): unknown };
    expect(typeof api.snapshot).toBe('function');
    expect(typeof api.start).toBe('function');
    expect(typeof api.stop).toBe('function');
    r.record('hover', 3);
    expect((api.stat('hover') as { p50: number }).p50).toBe(3);
    api.reset();
    expect((api.stat('hover') as { n: number }).n).toBe(0);
  });
});
