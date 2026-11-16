// Owner: Nived
// Seams: verdictLines(verdict, reasons, t) (pure) and <MetricDeck result={...}/> rendered to HTML.
// UI critique B3: the verdict must explain itself; B4: no silent blank panel.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mockScenarioResult } from '../../mocks/mockResult';
import { getCopy } from '../../state/copy';
import type { ScenarioResult } from '../../engine/types';
import { MetricDeck } from './MetricDeck';
import { verdictLines } from './verdictLines';

const planner = (k: string) => getCopy(k, 'planner');
const educator = (k: string) => getCopy(k, 'educator');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const ready = (over: Partial<ScenarioResult>): ScenarioResult => ({ ...mockScenarioResult(null), ...over });

describe('verdictLines (pure)', () => {
  it('gives a plain headline for every verdict, in both personas', () => {
    expect(verdictLines('PENDING', [], planner).headline).toBe('Needs terrain data');
    expect(verdictLines('PENDING', [], educator).headline).toBe('We can’t be sure yet');
    expect(verdictLines('GO', [], planner).headline).toBe('Meets the profile');
    expect(verdictLines('MARGINAL', [], planner).headline).toBe('Borderline');
    expect(verdictLines('NO-GO', [], planner).headline).toBe('Does not meet the profile');
  });
  it('keeps the reasons in order and caps the list at 4, summarising the rest', () => {
    const r = ['a.', 'b.', 'c.', 'd.', 'e.', 'f.'];
    const { lines } = verdictLines('NO-GO', r, planner);
    expect(lines).toEqual(['a.', 'b.', 'c.', 'd.', '+2 more']);
    expect(verdictLines('NO-GO', ['a.', 'b.'], planner).lines).toEqual(['a.', 'b.']);
    expect(verdictLines('GO', [], planner).lines).toEqual([]);
  });
  it('drops blank reasons', () => {
    expect(verdictLines('NO-GO', ['a.', '  ', ''], planner).lines).toEqual(['a.']);
  });
});

describe('MetricDeck states and verdict reasons', () => {
  it('error: shows the engine message', () => {
    const html = renderToStaticMarkup(<MetricDeck result={ready({ status: 'error', error: 'outside the ephemeris', metrics: null, answer: null })} />);
    expect(text(html)).toContain('outside the ephemeris');
    expect(html).toContain('role="alert"');
  });
  it('loading: says calculating', () => {
    const html = renderToStaticMarkup(<MetricDeck result={ready({ status: 'loading', metrics: null })} />);
    expect(text(html)).toContain('Calculating');
  });
  it('a non-GO verdict lists its reasons under the numbers', () => {
    const html = renderToStaticMarkup(
      <MetricDeck result={ready({ verdict: 'NO-GO', verdictReasons: ['Sunlit time 38.0% is below the minimum (40%).', 'Longest night 102.0 h is above the maximum (96 h).'] })} />,
    );
    const t = text(html);
    expect(t).toContain('Does not meet the profile');
    expect(t).toContain('Sunlit time 38.0% is below the minimum (40%).');
    expect(t).toContain('Longest night 102.0 h is above the maximum (96 h).');
  });
  it('PENDING says what is missing, in plain words', () => {
    const html = renderToStaticMarkup(<MetricDeck result={ready({ verdict: 'PENDING', verdictReasons: ['Sunlit time is a smooth-sphere estimate; terrain data is needed to determine pass or fail.'] })} />);
    expect(text(html)).toContain('Needs terrain data');
    expect(text(html)).toContain('terrain data is needed to determine pass or fail');
  });
  it('a GO verdict shows the headline but no empty reasons list', () => {
    const html = renderToStaticMarkup(<MetricDeck result={ready({ verdict: 'GO', verdictReasons: [] })} />);
    expect(text(html)).toContain('Meets the profile');
    expect(html).not.toContain('metric-deck__reasons');
  });
});
