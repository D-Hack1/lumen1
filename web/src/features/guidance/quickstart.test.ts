import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCard, type QuickStartCard } from './quickstart';

const file = JSON.parse(readFileSync(resolve(__dirname, '../../../public/content/quickstart.json'), 'utf8')) as { cards: QuickStartCard[] };
const cards = file.cards;
const REAL = ['im2_athena', 'cy3_shiv_shakti', 'shackleton_ridge', 'blue_ghost_m1'];
const SAMPLE = ['im2', 'shack', 'malapert', 'haworth'];

describe('quickstart.json', () => {
  it('has four cards, each with a title, steps, a local image, alt text and a credit', () => {
    expect(cards).toHaveLength(4);
    for (const c of cards) {
      expect(c.title && c.blurb && c.alt && c.credit && c.license).toBeTruthy();
      expect(c.steps.length).toBeGreaterThanOrEqual(2);
      expect(c.image.startsWith('content/')).toBe(true); // local file, works offline
      expect(c.image).not.toMatch(/^https?:/);
    }
  });
  it('every image file exists in public/', () => {
    for (const c of cards) expect(() => readFileSync(resolve(__dirname, '../../../public', c.image)), c.image).not.toThrow();
  });
  it('never mentions Shackleton (its coordinates are under review) or a logo', () => {
    expect(JSON.stringify(cards)).not.toMatch(/shackleton|logo|insignia/i);
  });
  it('card ids are unique', () => expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length));
});

describe('resolveCard', () => {
  const by = (id: string) => cards.find((c) => c.id === id)!;
  it('real-data build: selects the real id', () => {
    expect(resolveCard(by('slip-9'), REAL)).toMatchObject({ route: 'slip', siteId: 'im2_athena', slipDays: 9, mastM: 2 });
  });
  it('sample build: falls back to the sample id', () => {
    expect(resolveCard(by('slip-9'), SAMPLE)).toMatchObject({ siteId: 'im2' });
  });
  it('Compare picks every candidate that exists, skipping the ones that do not', () => {
    expect(resolveCard(by('pole-vs-equator'), REAL).pickIds).toEqual(['im2_athena', 'cy3_shiv_shakti', 'blue_ghost_m1']);
    expect(resolveCard(by('pole-vs-equator'), SAMPLE).pickIds).toEqual([]); // none of those exist in sample mode → nothing is picked, no crash
  });
  it('non-Compare cards never pick', () => expect(resolveCard(by('sun-at-im2'), REAL).pickIds).toEqual([]));
  it('no matching site → siteId null (the route still opens)', () => expect(resolveCard(by('sun-at-im2'), ['nowhere'])).toMatchObject({ siteId: null, route: 'stand-here' }));
});
