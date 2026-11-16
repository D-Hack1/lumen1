// Owner: Nived
// Seam: selectForStage2(candidates, profile, windowHours, { topN, maxTotal }) -> ScanCandidate[]   (R3 delta D-15)
//   "Stage 2 refines (a) the top 10 and (b) every candidate whose nominal metric lies within 10% of any hard profile threshold:
//    these are the ones whose verdict can flip." Expected selections are worked out by hand below.
import { describe, expect, it } from 'vitest';
import { selectForStage2 } from '../compare/stage2';
import type { ScanCandidate } from '../types';

const b = (v: number) => ({ value: v, lo: null, hi: null });
const cand = (id: string, viability: number, sunlit: number, linkPct: number, night: number): ScanCandidate => ({
  siteId: id, landingUtc: 0, viabilityIndex: viability, verdict: 'PENDING', provisional: true, boundsStatus: 'nominal',
  sunlitPct: b(sunlit), linkPct: b(linkPct), longestNightH: b(night),
});

// Profile: sunlit >= 40 %, link >= 100 h in a 336 h window (29.76 %), longest night <= 96 h.  Window = 14 d = 336 h.
const profile = { minSunlitPct: 40, minLinkHours: 100, maxLongestNightH: 96, maxPadSlopeDeg: 10 };
const W = 336;
const ids = (xs: ScanCandidate[]) => xs.map((c) => c.siteId);

// Hand-worked "closeness" = |value - limit| / |limit|, and "near" = closeness <= 0.10 (inclusive):
//   far1   sunlit 90, link 90 % = 302.4 h, night 10  : none near                                (viability 95)
//   far2   sunlit 60, link 90 %,           night 50  : none near                                (viability 90)
//   linkN  sunlit 60, link 31 % = 104.16 h vs 100    : |4.16|/100  = 0.0416 near                (viability 30)
//   sunN   sunlit 42 vs 40                           : |2|/40      = 0.05   near                (viability 20)
//   nightN sunlit 60, night 90 vs 96                 : |6|/96      = 0.0625 near                (viability 40)
//   edge   sunlit 44 vs 40                           : |4|/40      = 0.10   near (inclusive)    (viability 10)
//   justOut sunlit 44.1 vs 40                        : 0.1025 NOT near                          (viability 5)
const far1 = cand('far1', 95, 90, 90, 10);
const far2 = cand('far2', 90, 60, 90, 50);
const linkN = cand('linkN', 30, 60, 31, 50);
const sunN = cand('sunN', 20, 42, 90, 10);
const nightN = cand('nightN', 40, 60, 90, 90);
const edge = cand('edge', 10, 44, 90, 10);
const justOut = cand('justOut', 5, 44.1, 90, 10);
const all = [justOut, edge, sunN, linkN, nightN, far2, far1]; // deliberately unsorted

describe('selectForStage2', () => {
  it('takes the top N by viability, then every near-threshold candidate, most flip-able (closest) first', () => {
    const sel = selectForStage2(all, profile, W, { topN: 2, maxTotal: 50 });
    expect(ids(sel)).toEqual(['far1', 'far2', 'linkN', 'sunN', 'nightN', 'edge']);
  });
  it('excludes candidates that are comfortably away from every threshold (justOut at 10.25% is out)', () => {
    expect(ids(selectForStage2(all, profile, W, { topN: 2, maxTotal: 50 }))).not.toContain('justOut');
  });
  it('does not list a candidate twice when it is both in the top N and near a threshold', () => {
    const sel = selectForStage2(all, profile, W, { topN: 5, maxTotal: 50 }); // top 5 by viability: far1, far2, nightN, linkN, sunN
    expect(ids(sel)).toEqual(['far1', 'far2', 'nightN', 'linkN', 'sunN', 'edge']);
    expect(new Set(ids(sel)).size).toBe(sel.length);
  });
  it('caps the total (top N always first, then the closest near-threshold ones until the cap)', () => {
    expect(ids(selectForStage2(all, profile, W, { topN: 2, maxTotal: 4 }))).toEqual(['far1', 'far2', 'linkN', 'sunN']);
  });
  it('with nothing near a threshold, it is just the top N', () => {
    expect(ids(selectForStage2([far1, far2, justOut], profile, W, { topN: 1, maxTotal: 50 }))).toEqual(['far1']);
  });
  it('a candidate with a missing metric is judged on the metrics it has, and never crashes', () => {
    const noLink: ScanCandidate = { ...far2, siteId: 'noLink', viability: 1 } as unknown as ScanCandidate;
    const partial = { ...sunN, siteId: 'partial', linkPct: { value: null, lo: null, hi: null } };
    expect(ids(selectForStage2([far1, partial, noLink as ScanCandidate], profile, W, { topN: 1, maxTotal: 10 }))).toContain('partial');
  });
});
