// Owner: Nived
// Seam: <AnswerStrip result={...}/> and <MetricDeck result={...}/> rendered to HTML (public props only).
// Rule from the UI critique (B3/B4): a panel is never silently blank. Error -> the engine's message; loading -> says so;
// a verdict that is not GO/MARGINAL explains itself in plain sentences.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ScenarioResult } from '../../engine/types';
import { AnswerStrip } from './AnswerStrip';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const base: ScenarioResult = { status: 'loading', error: null, meta: null, verdict: 'PENDING', verdictReasons: [], viability: null, answer: null, events: [], windows: [], series: null, metrics: null };
const error = (msg: string): ScenarioResult => ({ ...base, status: 'error', error: msg });

describe('AnswerStrip is never silently blank', () => {
  it('shows the engine error message, as an alert', () => {
    const html = renderToStaticMarkup(<AnswerStrip result={error('The ephemeris covers 2023-01-01 to 2030-12-31; this window is outside it.')} />);
    expect(text(html)).toContain('this window is outside it');
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Can’t compute this scenario'); // a title, not just the raw message
  });
  it('says it is calculating while loading (and is marked busy)', () => {
    const html = renderToStaticMarkup(<AnswerStrip result={base} />);
    expect(text(html)).toContain('Calculating');
    expect(html).toContain('aria-busy="true"');
  });
  it('an unknown error with no message still says something useful, not nothing', () => {
    const html = renderToStaticMarkup(<AnswerStrip result={{ ...base, status: 'error', error: null }} />);
    expect(text(html).trim().length).toBeGreaterThan(10);
  });
});
