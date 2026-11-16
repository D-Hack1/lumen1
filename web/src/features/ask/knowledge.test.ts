import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex, expandQuery, searchKnowledge, snippet, tokenize, type KnowledgeEntry } from './knowledge';

const real: KnowledgeEntry[] = JSON.parse(readFileSync(resolve(__dirname, '../../../public/content/knowledge.json'), 'utf8')).entries;
const idx = buildIndex(real);
const top = (q: string) => searchKnowledge(idx, q, 3).map((h) => h.entry.id);

describe('tokenize / expandQuery', () => {
  it('drops stop words, strips plurals, keeps ± and σ', () => {
    expect(tokenize('Why is this ± so big?')).toEqual(['±']);
    expect(tokenize('The panels')).toEqual(['panel']);
    expect(expandQuery('why is this ± so big?')).toContain('uncertainty');
  });
});

describe('the built knowledge file', () => {
  it('has terms, validation, decisions, how-tos, methods and concepts, and no Shackleton', () => {
    const kinds = new Set(real.map((e) => e.kind));
    for (const k of ['term', 'validation', 'decision', 'howto', 'method', 'concept']) expect(kinds.has(k as never)).toBe(true);
    expect(JSON.stringify(real)).not.toMatch(/shackleton/i);
    for (const e of real) expect(e.source).toBeTruthy();
  });
});

describe('search over the real file', () => {
  it('"why is this ± so big?" finds the uncertainty explanations', () => {
    const t = top('why is this ± so big?');
    expect(t.some((id) => id === 'term:uncertainty' || id === 'decision:R2-7' || id.startsWith('help:how-is-the-') || id.startsWith('help:why-does-lumen-show'))).toBe(true);
  });
  it('finds terms by name and by plain words', () => {
    expect(top('what is libration')[0]).toBe('term:libration');
    expect(top('grazing')[0]).toBe('term:grazing-event');
    expect(top('how long is the longest dark night')).toContain('term:longest-night');
  });
  it('finds the decision behind a feature (why did we build it)', () => {
    expect(top('why a windows table')).toContain('decision:R2-8');
    expect(top('why is sun elevation the hero')).toContain('decision:R2-6');
  });
  it('finds validation results', () => expect(top('how was the ephemeris validated')).toContain('validation:g2-hourly-ephemeris-hermite-validation'));
  it('returns nothing for text it has no knowledge of', () => {
    expect(top('banana smoothie recipe')).toEqual([]);
    expect(searchKnowledge(idx, '')).toEqual([]);
  });
  it('is deterministic', () => expect(top('uncertainty')).toEqual(top('uncertainty')));
});

describe('snippet', () => {
  it('keeps short summaries whole and cuts long ones on a boundary', () => {
    const short = real.find((e) => e.summary.length < 200)!;
    expect(snippet(short)).toBe(short.summary.trim());
    const long = { ...real[0], summary: `${'Word '.repeat(80)}end.` };
    expect(snippet(long).length).toBeLessThanOrEqual(222);
    expect(snippet(long).endsWith('…')).toBe(true);
  });
});
