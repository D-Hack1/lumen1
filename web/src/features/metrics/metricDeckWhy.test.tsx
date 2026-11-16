// Owner: Nived
// The optional "Why?" hook on the Metric Deck (for Ask LUMEN): absent by default (markup unchanged), one button per tile plus the hero when given.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mockScenarioResult } from '../../mocks/mockResult';
import { getCopy } from '../../state/copy';
import { MetricDeck } from './MetricDeck';
import { TILE_METRIC, metricTiles } from './metricTiles';

const result = mockScenarioResult(null);

describe('MetricDeck onWhy', () => {
  it('renders no "Why?" button, and the same markup as before, when onWhy is not given', () => {
    const html = renderToStaticMarkup(<MetricDeck result={result} />);
    expect(html).not.toContain('metric-deck__why');
  });

  it('renders one button for the hero and one per tile when onWhy is given', () => {
    const html = renderToStaticMarkup(<MetricDeck result={result} onWhy={() => undefined} />);
    expect((html.match(/metric-deck__why/g) ?? []).length).toBe(9);
    expect(html).toContain('type="button"');
  });

  it('every tile maps to a real MetricSet field', () => {
    const keys = metricTiles(result.metrics!, (k) => getCopy(k, 'planner')).map(([k]) => k);
    expect(keys.length).toBe(8);
    for (const k of keys) expect(Object.keys(result.metrics!)).toContain(TILE_METRIC[k]);
  });
});
