// Owner: Nived
// Seam: <PerfHud open snapshot/> rendered to HTML. Dev-only overlay (toggle: backtick). G8 budgets from the plan:
// hover < 4 ms, slip frame <= 16.7 ms, scan stage 1 <= 100 ms, first stage 2 <= 300 ms, quick answer < 150 ms, site switch < 100 ms.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PerfSnapshot, Stat } from '../engine/perf';
import { G8_BUDGETS_MS } from './budgets';
import { fmtMs } from './format';
import { PerfHud } from './PerfHud';

const stat = (p50: number, p95: number, n = 10): Stat => ({ n, mean: p50, max: p95, p50, p95 });
const snap = (series: PerfSnapshot['series'], counters: PerfSnapshot['counters'] = {}): PerfSnapshot => ({ series, counters });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('G8 budgets', () => {
  it('are exactly the plan numbers', () => {
    expect(G8_BUDGETS_MS).toEqual({ hover: 4, slipFrame: 16.7, scanStage1: 100, scanFirstStage2: 300, quickAnswer: 150, siteSwitch: 100 });
  });
});

describe('fmtMs', () => {
  it('one decimal below 10 ms, whole numbers from 10 ms, an em dash for nothing', () => {
    expect(fmtMs(2.46)).toBe('2.5 ms');
    expect(fmtMs(9.94)).toBe('9.9 ms');
    expect(fmtMs(12.4)).toBe('12 ms');
    expect(fmtMs(250.6)).toBe('251 ms');
    expect(fmtMs(null)).toBe('—');
  });
});

describe('budgets are shown exactly as the plan states them', () => {
  it('4 ms, 16.7 ms (not 17), 100 ms, 300 ms, 150 ms', () => {
    const t = text(renderToStaticMarkup(<PerfHud open snapshot={snap({})} />));
    for (const b of ['4 ms', '16.7 ms', '100 ms', '300 ms', '150 ms']) expect(t).toContain(b);
    expect(t).not.toContain('17 ms');
  });
});

describe('PerfHud', () => {
  it('renders nothing while closed (it must never take space or attention by default)', () => {
    expect(renderToStaticMarkup(<PerfHud open={false} snapshot={snap({})} />)).toBe('');
  });
  it('shows each G8 metric with n, p50, p95 and its budget', () => {
    const html = renderToStaticMarkup(<PerfHud open snapshot={snap({ hover: stat(1.2, 2.46, 600) })} />);
    const t = text(html);
    expect(t).toContain('hover');
    expect(t).toContain('600'); // sample count
    expect(t).toContain('1.2 ms');
    expect(t).toContain('2.5 ms'); // p95
    expect(t).toContain('4 ms'); // budget
  });
  it('marks a row "over" when p95 exceeds its budget, "ok" when it does not, and "none" with no data', () => {
    const html = renderToStaticMarkup(
      <PerfHud open snapshot={snap({ scanStage1: stat(60, 120), hover: stat(1, 2), quickAnswer: stat(0, 0, 0) })} />,
    );
    expect(html).toMatch(/data-metric="scanStage1"[^>]*data-status="over"/);
    expect(html).toMatch(/data-metric="hover"[^>]*data-status="ok"/);
    expect(html).toMatch(/data-metric="quickAnswer"[^>]*data-status="none"/);
  });
  it('a budget is a ceiling, not a target: p95 exactly at the budget is still ok (hover 4.0 vs 4)', () => {
    expect(renderToStaticMarkup(<PerfHud open snapshot={snap({ hover: stat(3, 4) })} />)).toMatch(/data-metric="hover"[^>]*data-status="ok"/);
    expect(renderToStaticMarkup(<PerfHud open snapshot={snap({ hover: stat(3, 4.01) })} />)).toMatch(/data-metric="hover"[^>]*data-status="over"/);
  });
  it('shows the counters that matter for the hot path: React commits and long tasks', () => {
    const t = text(renderToStaticMarkup(<PerfHud open snapshot={snap({}, { reactCommits: 3, longTasks: 1 })} />));
    expect(t).toContain('React commits');
    expect(t).toContain('3');
    expect(t).toContain('Long tasks');
    expect(t).toContain('1');
  });
  it('shows the worker job time (informational, no budget)', () => {
    const t = text(renderToStaticMarkup(<PerfHud open snapshot={snap({ workerJob: stat(40, 70, 5) })} />));
    expect(t).toContain('worker job');
    expect(t).toContain('70 ms');
  });
});
