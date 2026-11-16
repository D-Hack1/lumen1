// Owner: Nived
import { describe, expect, it } from 'vitest';
import { FORCED_ANSWER_STATES } from '../../mocks/forced';
import { deriveAnswerState, type AnswerFacts } from '../answerState';
import { fmtBounded, fmtSpan, fmtUntil } from '../format';

const ev = (t: number, grazing = false) => ({ type: 'sunset' as const, t, dtMs: 5 * 3_600_000, grazing, grazingReason: grazing ? ('rate' as const) : null, dtMethod: 'fast' as const });
const base: AnswerFacts = {
  tScrub: 1_000_000, sunElevDeg: 1.2, sunDiskPct: 100, sunUp: true, opsMinElevDeg: null, sunNext: ev(2_000_000), darkSinceMs: null, opsResumeT: null,
  earthElevDeg: 5, earthVisible: true, linkUp: true, dsnAware: true, earthNext: ev(3_000_000), linkResumeT: null,
  windowSunlitPct: { value: 60, lo: 55, hi: 65 }, windowLinkPct: { value: 40, lo: 35, hi: 45 },
};

describe('D-14 answer states', () => {
  it('Sun cell', () => {
    expect(deriveAnswerState(base).sun.state).toBe('sunsetIn');
    expect(deriveAnswerState({ ...base, sunNext: null }).sun.state).toBe('staysUpPastEnd');
    const dark = deriveAnswerState({ ...base, sunUp: false, darkSinceMs: 400_000, sunNext: ev(9e6) });
    expect(dark.sun.state).toBe('sunriseIn');
    expect(dark.sun.darkForMs).toBe(600_000);
    expect(deriveAnswerState({ ...base, sunUp: false, sunNext: null }).sun.state).toBe('noSunriseBeforeEnd');
    expect(deriveAnswerState({ ...base, opsMinElevDeg: 6 }).sun.state).toBe('belowOpsElevation');
    expect(deriveAnswerState({ ...base, opsMinElevDeg: 0 }).sun.state).toBe('sunsetIn'); // 0 = off
    expect(deriveAnswerState({ ...base, sunNext: ev(2e6, true) }).sun.grazing).toBe(true);
  });
  it('Earth cell', () => {
    expect(deriveAnswerState(base).earth.state).toBe('earthsetIn');
    expect(deriveAnswerState({ ...base, earthVisible: false, linkUp: false }).earth.state).toBe('earthriseIn');
    expect(deriveAnswerState({ ...base, linkUp: false }).earth.state).toBe('linkResumesDsn');
    expect(deriveAnswerState({ ...base, linkUp: false, dsnAware: false }).earth.state).toBe('earthsetIn');
  });
  it('has a forced fixture for each of the 9 states', () => {
    expect(Object.keys(FORCED_ANSWER_STATES)).toEqual(['sunsetIn', 'sunriseIn', 'noSunriseBeforeEnd', 'staysUpPastEnd', 'earthsetIn', 'earthriseIn', 'linkResumesDsn', 'grazing', 'belowOpsElevation']);
  });
});

describe('format', () => {
  it('spans, ± and ranges', () => {
    expect(fmtSpan(41 * 3_600_000)).toBe('41 h');
    expect(fmtSpan(76 * 3_600_000)).toBe('3 d 4 h');
    expect(fmtUntil(41 * 3_600_000, 5 * 3_600_000)).toBe('41 h ± 5 h');
    expect(fmtUntil(41 * 3_600_000, null)).toBe('41 h');
    expect(fmtUntil(20 * 3_600_000, 8 * 3_600_000, true)).toBe('~12 h–28 h');
    expect(fmtBounded({ value: 62, lo: 55, hi: 68 }, 0, '%')).toBe('62% [55–68%]');
    expect(fmtBounded({ value: 62, lo: 62, hi: 62 }, 0, '%')).toBe('62%');
    expect(fmtBounded({ value: -1.9, lo: -2.1, hi: -1.7 }, 1, '°')).toBe('−1.9° [−2.1–−1.7°]'); // true minus, readable range
  });
});
