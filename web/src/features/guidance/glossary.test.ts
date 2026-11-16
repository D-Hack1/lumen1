// Owner: Abhinav — glossary binding: tolerant parsing of glossary.json, merge over the spec fallback, id/label lookup.
import { describe, expect, it } from 'vitest';
import { buildGlossary, lookup, parseGlossaryFile } from './glossary';

describe('glossary', () => {
  it('empty glossary.json ({} today) → interim spec entries, marked pending', () => {
    const g = buildGlossary({});
    expect(g.fromFile).toBe(0);
    const e = lookup(g, 'Sun elevation')!;
    expect(e.id).toBe('sun_elevation');
    expect(e.formula).toMatch(/local horizontal/);
    expect(e.pending).toBe(true);
    expect(e.anchor).toBe('gloss-sun_elevation');
  });

  it('resolves ids and the visible labels teammates pass as `term`', () => {
    const g = buildGlossary(null);
    // labels used today by AnswerStrip / MetricDeck / Definitions popover
    for (const [term, id] of [
      ['Sun now', 'sun_available'],
      ['Window sunlit', 'window_sunlit'],
      ['Window link', 'window_link'],
      ['Earth now', 'earth_link'],
      ['Clearance / disk', 'sun_clearance'],
      ['Earth el / margin', 'dte_margin'],
      ['Longest night', 'longest_night'],
      ['PSR distance', 'psr_distance'],
      ['min_sun_elevation_ops', 'min_sun_elevation_ops'],
      ['Time in sunlight', 'window_sunlit'], // Educator label
    ])
      expect(lookup(g, term)?.id, term).toBe(id);
    expect(lookup(g, 'no such thing')).toBeNull();
  });

  it('accepts array, {entries}, and map shapes with field aliases', () => {
    const a = parseGlossaryFile([{ id: 'x', term: 'Ex', definition: 'plain' }]);
    expect(a[0]).toMatchObject({ id: 'x', label: 'Ex', impact: 'plain', anchor: 'gloss-x', pending: false });
    const b = parseGlossaryFile({
      version: 1,
      entries: [{ key: 'y', label: 'Why', impact: 'i', source_citation: 's', uncertainty: '0.1°' }],
    });
    expect(b[0]).toMatchObject({ id: 'y', label: 'Why', source: 's', sigma: '0.1°' });
    const c = parseGlossaryFile({ z: { term: 'Zed', formula: 'f', anchor: 'meth-z' } });
    expect(c[0]).toMatchObject({ id: 'z', formula: 'f', anchor: 'meth-z' });
    expect(parseGlossaryFile('nonsense')).toEqual([]);
  });

  it('file entries replace the interim text but keep its label aliases', () => {
    const g = buildGlossary({
      version: 1,
      entries: [
        { id: 'sun_elevation', term: 'Sun elevation', formula: 'F', impact: 'I', source: 'Gowri', sigma: '±0.01°' },
      ],
    });
    expect(g.fromFile).toBe(1);
    const e = lookup(g, 'Sun el')!; // alias from the fallback
    expect(e).toMatchObject({ formula: 'F', impact: 'I', source: 'Gowri', sigma: '±0.01°', pending: false });
  });
});
