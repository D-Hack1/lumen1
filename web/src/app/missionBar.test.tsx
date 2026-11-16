// Owner: Abhinav — Phase 2 Mission Bar: jumps S/E/X/T (dynamic E), tooltips ±, verdict chip state, persona copy for
// every D-14 Answer Strip state. Driven by Nived's forced-state fixtures (src/mocks/forced.ts).
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { ANSWER_COMMON_KEYS, ANSWER_STATE_COPY, ANSWER_STATE_IDS } from '../content/answerStates';
import { educator, planner } from '../content/personaCopy';
import type { EventRecord } from '../engine/types';
import { earthEventText, sunEventText } from '../features/answer/answerText';
import { FORCED_ANSWER_STATES, WORST_CASE_ANSWER } from '../mocks/forced';
import { getCopy } from '../state/copy';
import { useScenario } from '../state/scenarioStore';
import { earthJumpType, jumpSlotForKey, jumpTooltip, resolveJump, type JumpContext } from './jumps';
import { JumpButtons } from './MissionBar';
import { chipFromResult, forcedChipFromUrl } from './verdict';

const H = 3_600_000;
const P = (k: string) => getCopy(k, 'planner');
const E = (k: string) => getCopy(k, 'educator');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => useScenario.getState().reset());

describe('dynamic E label (R3 D-14)', () => {
  it('reads Earthrise when Earth is down and Earthset when it is up, for every forced state', () => {
    for (const [id, a] of Object.entries(FORCED_ANSWER_STATES)) {
      expect(earthJumpType(a), id).toBe(a.earth.visible ? 'earthset' : 'earthrise');
    }
    expect(earthJumpType(FORCED_ANSWER_STATES.earthriseIn)).toBe('earthrise');
    expect(earthJumpType(FORCED_ANSWER_STATES.earthsetIn)).toBe('earthset');
    expect(earthJumpType(FORCED_ANSWER_STATES.linkResumesDsn)).toBe('earthset'); // Earth up, link down
    expect(earthJumpType(null)).toBe('earthset');
  });

  it('the rendered E button flips label, aria-label and data-event', () => {
    const render = (id: string) =>
      renderToStaticMarkup(<JumpButtons answer={FORCED_ANSWER_STATES[id]} events={[]} keyboard={false} />);
    const up = render('earthsetIn');
    const down = render('earthriseIn');
    expect(up).toContain('data-event="earthset"');
    expect(up).toContain('aria-label="Next Earthset"');
    expect(down).toContain('data-event="earthrise"');
    expect(down).toContain('aria-label="Next Earthrise"');
    expect(text(down)).toContain('Earthrise');
    expect(text(down)).not.toContain('Earthset');
  });
});

describe('jump targets', () => {
  const a = FORCED_ANSWER_STATES.sunsetIn;
  const ev = (type: EventRecord['type'], t: number, dtMs: number | null, grazing = false): EventRecord => ({
    type,
    t,
    dtMs,
    grazing,
    grazingReason: grazing ? 'rate' : null,
    dtMethod: 'fast',
  });
  const events = [
    ev('sunset', a.tScrub + 41 * H, 5 * H),
    ev('shadowExit', a.tScrub + 60 * H, 2 * H),
    ev('sunset', a.tScrub + 90 * H, 9 * H, true),
  ];
  const ctx = (over: Partial<JumpContext> = {}): JumpContext => ({
    answer: a,
    events,
    scrubUtc: a.tScrub,
    landingUtc: a.tScrub - 48 * H,
    jumpTo: () => null,
    ...over,
  });

  it('uses the engine jumpTo value and the matching event ±', () => {
    const j = resolveJump('S', ctx({ jumpTo: (t) => (t === 'sunset' ? a.tScrub + 41 * H : null) }));
    expect(j).toMatchObject({ id: 'sunset', t: a.tScrub + 41 * H, pmMs: 5 * H, grazing: false });
  });

  it('steps past the committed scrub even when the stub jumpTo answers from its own tScrub', () => {
    const stale = () => a.tScrub + 41 * H; // always the first sunset
    const j = resolveJump('S', ctx({ jumpTo: stale, scrubUtc: a.tScrub + 41 * H }));
    expect(j).toMatchObject({ t: a.tScrub + 90 * H, pmMs: 9 * H, grazing: true });
  });

  it('T jumps to touchdown, exact', () => {
    expect(resolveJump('T', ctx())).toMatchObject({ id: 'touchdown', t: a.tScrub - 48 * H, pmMs: null });
  });

  it('is disabled (t = null) when there is no such event before the window ends', () => {
    const j = resolveJump('E', ctx({ events: [] })); // Earth up → earthset; none in the list or on the answer cell
    expect(j.id).toBe('earthset');
    expect(j.t).not.toBeNull(); // the forced answer cell still knows the next earthset
    const none = resolveJump('E', ctx({ events: [], answer: { ...a, earth: { ...a.earth, nextEventT: null } } }));
    expect(none.t).toBeNull();
    const html = renderToStaticMarkup(
      <JumpButtons answer={FORCED_ANSWER_STATES.staysUpPastEnd} events={[]} keyboard={false} />,
    );
    expect(html).toMatch(/data-jump="S"[^>]*aria-disabled="true"/); // Sun stays up: no sunset in the window
  });

  it('falls back to the forced answer cell (fixtures carry no event list) with its ± and grazing', () => {
    const g = FORCED_ANSWER_STATES.grazing;
    const j = resolveJump('S', { ...ctx(), answer: g, events: [], scrubUtc: g.tScrub });
    expect(j).toMatchObject({ t: g.sun.nextEventT, pmMs: g.sun.nextEventPmMs, grazing: true });
  });
});

describe('jump tooltips show target time ±', () => {
  const t0 = Date.UTC(2025, 2, 8, 17, 28, 50);
  it('Planner', () => {
    expect(jumpTooltip({ slot: 'S', id: 'sunset', t: t0, pmMs: 5 * H, grazing: false }, P)).toBe(
      'Next Sunset · 2025-03-08 17:28 UTC ± 5 h · key S',
    );
    expect(jumpTooltip({ slot: 'E', id: 'earthrise', t: t0, pmMs: 6 * H, grazing: true }, P)).toBe(
      'Next Earthrise · 2025-03-08 17:28 UTC ± 6 h (grazing) · key E',
    );
    expect(jumpTooltip({ slot: 'T', id: 'touchdown', t: t0, pmMs: null, grazing: false }, P)).toBe(
      'Touchdown (T0) · 2025-03-08 17:28 UTC · key T',
    );
    expect(jumpTooltip({ slot: 'X', id: 'shadowExit', t: null, pmMs: null, grazing: false }, P)).toBe(
      'Next Shadow Exit · none before window end · key X',
    );
  });
  it('Educator keeps the ± in words', () => {
    expect(jumpTooltip({ slot: 'S', id: 'sunset', t: t0, pmMs: 5 * H, grazing: false }, E)).toBe(
      'Jump to the next sunset — 2025-03-08 17:28 UTC, give or take 5 h (press S)',
    );
  });
});

describe('keyboard S/E/X/T', () => {
  const k = (key: string, over: Record<string, unknown> = {}) =>
    jumpSlotForKey({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null, ...over });
  it('maps keys, ignores modifiers, repeats and text fields', () => {
    expect(['s', 'E', 'x', 't'].map((x) => k(x))).toEqual(['S', 'E', 'X', 'T']);
    expect(k('q')).toBeNull();
    expect(k('s', { ctrlKey: true })).toBeNull();
    expect(k('s', { repeat: true })).toBeNull();
    expect(k('s', { target: { tagName: 'INPUT' } })).toBeNull();
  });
});

describe('verdict chip', () => {
  it('shows the last settled verdict as provisional while recomputing, never a PENDING flash', () => {
    expect(chipFromResult({ status: 'loading', verdict: 'PENDING' }, null)).toEqual({
      verdict: 'PENDING',
      provisional: false,
    });
    expect(chipFromResult({ status: 'loading', verdict: 'PENDING' }, 'GO')).toEqual({
      verdict: 'GO',
      provisional: true,
    });
    expect(chipFromResult({ status: 'ready', verdict: 'NO-GO' }, 'GO')).toEqual({
      verdict: 'NO-GO',
      provisional: false,
    });
  });
  it('can be forced from the URL', () => {
    expect(forcedChipFromUrl('?verdict=marginal&provisional=1')).toEqual({ verdict: 'MARGINAL', provisional: true });
    expect(forcedChipFromUrl('?verdict=no-go')).toEqual({ verdict: 'NO-GO', provisional: false });
    expect(forcedChipFromUrl('?verdict=maybe')).toBeNull();
  });
  it('every verdict and the provisional modifier have Planner + Educator copy (label and .long)', () => {
    for (const v of ['GO', 'MARGINAL', 'NO-GO', 'PENDING', 'provisional']) {
      for (const k of [`verdict.${v}`, `verdict.${v}.long`]) {
        expect(planner[k], k).toBeTruthy();
        expect(educator[k], k).toBeTruthy();
      }
    }
  });
});

describe('copy: all 9 D-14 Answer Strip states, both personas', () => {
  it('the index covers exactly the forced fixtures', () => {
    expect([...ANSWER_STATE_IDS].sort()).toEqual(Object.keys(FORCED_ANSWER_STATES).sort());
  });
  it('every state key has a Planner string and an Educator override that differs', () => {
    for (const id of ANSWER_STATE_IDS) {
      const c = ANSWER_STATE_COPY[id];
      for (const k of [...c.label, ...c.text]) {
        expect(planner[k], `${id}: planner ${k}`).toBeTruthy();
        expect(educator[k], `${id}: educator ${k}`).toBeTruthy();
        expect(educator[k], `${id}: educator ${k} differs`).not.toBe(planner[k]);
      }
    }
    for (const k of ANSWER_COMMON_KEYS) {
      expect(planner[k], k).toBeTruthy();
      expect(educator[k], k).toBeTruthy();
    }
  });
  it('Educator keeps every placeholder of the Planner string (so the ± in {t} is never dropped)', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(educator)) {
      if (planner[k]) expect(ph(educator[k]), k).toEqual(ph(planner[k]));
    }
  });
  it('each forced state reads differently per persona and keeps its numbers', () => {
    for (const [id, a] of Object.entries(FORCED_ANSWER_STATES)) {
      const p = `${sunEventText(a, P, 14)} | ${earthEventText(a, P)}`;
      const e = `${sunEventText(a, E, 14)} | ${earthEventText(a, E)}`;
      expect(e, id).not.toBe(p);
      expect(e, id).not.toMatch(/\{\w+\}/);
      const nums = (s: string) => s.match(/\d+/g) ?? [];
      expect(nums(e), id).toEqual(nums(p));
    }
    expect(sunEventText(WORST_CASE_ANSWER, E, 60)).toContain('+60 days');
  });
  it('jump labels exist in both personas', () => {
    for (const id of ['sunset', 'earthset', 'earthrise', 'shadowExit', 'touchdown']) {
      for (const k of [`mb.jump.${id}`, `mb.jump.${id}.long`]) expect(P(k), k).not.toBe(k);
    }
    for (const k of ['mb.jump.tip', 'mb.jump.tipExact', 'mb.jump.tipGrazing', 'mb.jump.tipNone', 'mb.jump.none']) {
      expect(planner[k], k).toBeTruthy();
      expect(educator[k], k).toBeTruthy();
    }
  });
});

describe('persona switch drives copy through the store', () => {
  // SSR always renders zustand's initial state, so the live re-render is covered in e2e/missionBar.spec.ts.
  it('setPersona changes what the copy layer returns for the active persona', () => {
    const now = () => getCopy('mb.jump.shadowExit.long', useScenario.getState().persona);
    expect(now()).toBe('Next Shadow Exit');
    useScenario.getState().setPersona('educator');
    expect(now()).toBe('Jump to when the Sun comes back');
  });
});
