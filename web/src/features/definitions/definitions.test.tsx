// Owner: Abhinav — Definitions Bar text, the ISRO preset (R3 D-10), and the Phase 3 exit check against Nived's mock
// fixtures: "ISRO preset changes the Answer Strip to the ops-elevation state in the CY-3 fixture".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { SiteRecord } from '../../engine/types';
import { AnswerStrip } from '../answer/AnswerStrip';
import { mockScenarioResult } from '../../mocks/mockResult';
import { getCopy } from '../../state/copy';
import { DEFAULT_DEFINITIONS, useScenario } from '../../state/scenarioStore';
import { definitionsLine, linkRuleText, sunRuleText } from './definitionsText';

const planner = (k: string) => getCopy(k, 'planner');
const educator = (k: string) => getCopy(k, 'educator');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

afterEach(() => useScenario.getState().reset());

describe('Definitions Bar text', () => {
  it('default rules read exactly like PLAN §8.3', () => {
    expect(definitionsLine(DEFAULT_DEFINITIONS, 2, planner)).toBe(
      'Sun available = ≥50% disk above terrain @2 m · Link = Earth ≥1° above terrain + DSN ≥10°',
    );
  });
  it('states the ops elevation, DTE disk (when not 50%) and DSN-off cases', () => {
    const d = { ...DEFAULT_DEFINITIONS, minSunElevationOps: 6, dteDiskThresholdPct: 75, dsnMode: 'off' as const };
    expect(sunRuleText(d, 5, planner)).toBe('Sun available = ≥50% disk above terrain + elevation ≥6° @5 m');
    expect(linkRuleText(d, planner)).toBe('Link = Earth ≥1° above terrain (≥75% disk) (DSN not applied)');
    expect(sunRuleText({ ...d, minSunElevationOps: 2.5 }, 1, planner)).toContain('≥2.5°');
  });
  it('Educator gets plain language with the same numbers', () => {
    const line = definitionsLine({ ...DEFAULT_DEFINITIONS, minSunElevationOps: 6 }, 2, educator);
    expect(line).toBe(
      'The Sun counts as “up” when at least 50% of it clears the terrain and it is at least 6° high, seen from 2 m · ' +
        'Radio contact needs Earth at least 1° above the terrain and a big dish on Earth seeing the Moon above 10°',
    );
    expect(line).not.toMatch(/[≥@]/);
  });
});

describe('ISRO Vikram ops preset (R3 D-10)', () => {
  it('one click sets definitionsPreset and minSunElevationOps = 6; reset restores defaults', () => {
    const s = useScenario.getState();
    s.applyDefinitionsPreset('isroVikramOps');
    expect(useScenario.getState().definitionsPreset).toBe('isroVikramOps');
    expect(useScenario.getState().definitions.minSunElevationOps).toBe(6);
    s.applyDefinitionsPreset('default');
    expect(useScenario.getState().definitions).toEqual(DEFAULT_DEFINITIONS);
    expect(useScenario.getState().definitionsPreset).toBe('default');
  });
  it('editing a field after the preset marks the rules custom (chip shows "Custom rules")', () => {
    const s = useScenario.getState();
    s.applyDefinitionsPreset('isroVikramOps');
    s.setDefinitions({ earthMarginDeg: 2 });
    expect(useScenario.getState().definitionsPreset).toBe('custom');
  });
});

describe('Phase 3 exit: CY-3 mock fixture + ISRO preset → Answer Strip "Below ops elevation (6°)"', () => {
  // Nived's mock CY-3 record (public/data-mock/catalog/sites.json) fed to Nived's mock generator exactly as the
  // result store would, with minSunElevationOps taken from the store after the preset click.
  const raw = JSON.parse(readFileSync(join(__dirname, '../../../public/data-mock/catalog/sites.json'), 'utf8')) as {
    sites: Array<{ id: string; tier: SiteRecord['tier'] }>;
  };
  const cy3 = raw.sites.find((s) => s.id === 'cy3_shiv_shakti')!;
  const site = {
    id: cy3.id,
    tier: cy3.tier,
    nearFieldResM: 20,
    sigmaSource: 'default',
    psr: null,
    padSlopeDeg: 4,
    mock: true,
  };
  const T0 = Date.parse('2023-08-23T12:33:00Z');
  const scrub = T0 + 2 * 86_400_000; // mock Sun is up and below 6° here

  const answerFor = () => {
    const ops = useScenario.getState().definitions.minSunElevationOps;
    return mockScenarioResult(site, T0, 14, scrub, 0, ops).answer!;
  };

  it('default rules: a normal Sun state', () => {
    useScenario.getState().selectSite('cy3_shiv_shakti');
    const a = answerFor();
    expect(a.sun.up).toBe(true);
    expect(a.sun.state).not.toBe('belowOpsElevation');
  });

  it('ISRO preset: belowOpsElevation, and the Answer Strip text says "Below ops elevation (6°)"', () => {
    useScenario.getState().selectSite('cy3_shiv_shakti');
    useScenario.getState().applyDefinitionsPreset('isroVikramOps');
    const a = answerFor();
    expect(a.sun.state).toBe('belowOpsElevation');
    expect(a.sun.opsMinElevDeg).toBe(6);
    const markup = renderToStaticMarkup(<AnswerStrip state={a} />);
    expect(markup).toContain('data-sun-state="belowOpsElevation"');
    expect(text(markup)).toContain('Below ops elevation (6°)');
  });
});
