// Owner: Nived
// Server-render the engine-owned panels and assert on the text a user would see. No DOM needed.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FixtureContext } from '../../app/layout/fixture';
import { DeltaCell } from '../compareResults/DeltaTable';
import { FORCED_ANSWER_STATES, WORST_CASE_METRICS } from '../../mocks/forced';
import { getCopy } from '../../state/copy';
import { AnswerStrip } from './AnswerStrip';
import { earthEventText, sunEventText } from './answerText';
import { MetricDeck } from '../metrics/MetricDeck';
import { metricTiles } from '../metrics/metricTiles';

const planner = (k: string) => getCopy(k, 'planner');
const educator = (k: string) => getCopy(k, 'educator');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Answer Strip, D-14 states (Planner copy)', () => {
  const sun = (id: string, days = 14) => sunEventText(FORCED_ANSWER_STATES[id], planner, days);
  const earth = (id: string) => earthEventText(FORCED_ANSWER_STATES[id], planner);

  it('Sun cell', () => {
    expect(sun('sunsetIn')).toBe('Sunset in 41 h ± 5 h');
    expect(sun('sunriseIn')).toBe('Sunrise (Shadow Exit) in 18 h ± 2 h · dark for 31 h so far');
    expect(sun('noSunriseBeforeEnd', 60)).toBe('No sunrise before window end (+60 d) · dark for 31 h so far');
    expect(sun('staysUpPastEnd')).toBe('Stays up past window end');
    expect(sun('belowOpsElevation')).toBe('Below ops elevation (6°) — ops resume in 1 d 6 h'.replace('1 d 6 h', '30 h'));
    expect(sun('grazing')).toBe('Sunset in ~12 h–30 h (grazing)');
  });
  it('Earth cell', () => {
    expect(earth('earthsetIn')).toBe('Earthset in 3 d 4 h ± 6 h');
    expect(earth('earthriseIn')).toBe('Earthrise in 5 d 2 h ± 6 h');
    expect(earth('linkResumesDsn')).toBe('Link resumes in 2 h (DSN)');
    expect(earth('grazing')).toMatch(/Earthset in ~.*\(grazing\)/);
  });
  it('Educator copy changes the wording but keeps the numbers', () => {
    expect(sunEventText(FORCED_ANSWER_STATES.sunsetIn, educator, 14)).toBe('The Sun sets in 41 h ± 5 h');
    expect(sunEventText(FORCED_ANSWER_STATES.noSunriseBeforeEnd, educator, 60)).toContain('+60 days');
  });
  it('renders each state with its data-state attributes, no raw {placeholders} and no missing keys', () => {
    for (const [id, st] of Object.entries(FORCED_ANSWER_STATES)) {
      const html = renderToStaticMarkup(<AnswerStrip state={st} />);
      expect(html).toContain(`data-sun-state="${st.sun.state}"`);
      expect(html).toContain(`data-earth-state="${st.earth.state}"`);
      expect(text(html), id).not.toMatch(/\{\w+\}/);
      expect(text(html), id).not.toMatch(/answer\.[a-z.]+/i); // a missing copy key would show as the key itself
    }
  });
  it('worst-case fixture shows the longest strings, not a placeholder', () => {
    const html = renderToStaticMarkup(
      <FixtureContext.Provider value={{ name: 'worst-case', slots: {}, scenario: { durationDays: 60 } }}>
        <AnswerStrip />
      </FixtureContext.Provider>,
    );
    const t = text(html);
    expect(t).toContain('No sunrise before window end (+60 d)');
    expect(t).toContain('Earthrise in ~');
    expect(t).toContain('(grazing)');
    expect(t).toContain('smooth-sphere estimate');
    expect(html).toContain('grazing — timing poorly constrained'); // full wording in the tooltip
  });
});

describe('Metric Deck', () => {
  it('lists the 8 tiles with ± ranges and the PSR wording', () => {
    const tiles = metricTiles(WORST_CASE_METRICS, planner);
    expect(tiles.map(([k]) => k)).toEqual(['metric.clearance', 'metric.earthEl', 'metric.sunlit', 'metric.link', 'metric.longestNight', 'metric.commGap', 'metric.ops', 'metric.psr']);
    expect(tiles[2][1]).toBe('62% [55–68%]');
    expect(tiles[4][1]).toBe('96 h [80–120 h]');
    expect(tiles[7][1]).toBe('2.4 km · 212° · 0.6 km² (derived)');
  });
  it('hero tile carries a ± and the worst-case fixture renders', () => {
    const html = renderToStaticMarkup(
      <FixtureContext.Provider value={{ name: 'worst-case', slots: {} }}>
        <MetricDeck />
      </FixtureContext.Provider>,
    );
    expect(text(html)).toContain('+1.24°');
    expect(text(html)).toContain('± 0.18°');
    expect(text(html)).toContain('PSR distance');
  });
});

describe('Delta cell', () => {
  it('carries sign and glyph, and inverts good/bad for night length', () => {
    expect(text(renderToStaticMarkup(<DeltaCell metric="sunlitPct" d={{ value: 4, pm: 2 }} />))).toContain('▲ +4% ± 2%');
    const sunBad = renderToStaticMarkup(<DeltaCell metric="sunlitPct" d={{ value: -4, pm: 2 }} />);
    expect(sunBad).toContain('data-tone="bad"');
    expect(renderToStaticMarkup(<DeltaCell metric="longestNightH" d={{ value: -12, pm: 4 }} />)).toContain('data-tone="good"');
    expect(text(renderToStaticMarkup(<DeltaCell metric="longestNightH" d={null} />))).toContain('—');
  });
});
