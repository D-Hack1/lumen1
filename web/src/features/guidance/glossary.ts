// Owner: Abhinav
// Glossary model (pure, unit-tested): normalise glossary.json in whatever shape it ships, merge it over the interim
// spec-derived entries (content/glossaryFallback.ts) and look terms up by id OR visible label.
//
// Accepted glossary.json shapes (contracts/data_glossary.md is a one-line draft, so be tolerant):
//   [ entry, … ]  ·  { version, entries|terms|glossary: [ entry, … ] }  ·  { "<id>": entry, … }
// Entry fields (first match wins):
//   id|key · term|label|name · formula · impact|plain|plain_english|definition · source|source_citation|provenance
//   sigma|uncertainty · units · anchor|learn_more|methodology_anchor · aliases|labels
import { GLOSSARY_FALLBACK } from '../../content/glossaryFallback';

export interface GlossaryEntry {
  id: string;
  label: string;
  formula?: string;
  impact?: string;
  source?: string;
  sigma?: string;
  units?: string;
  /** Methodology anchor ("Learn more →"): `gloss-<id>` unless the file says otherwise. */
  anchor: string;
  aliases: string[];
  /** true = interim spec text, not yet from glossary.json. */
  pending: boolean;
}

export interface Glossary {
  entries: Map<string, GlossaryEntry>;
  /** normalised id/label/alias → id */
  index: Map<string, string>;
  /** Entries that came from glossary.json. */
  fromFile: number;
}

/** "Sun elevation", "sun_elevation", "SUN-ELEVATION " → "sunelevation". */
export const normKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9%±]+/g, '');

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;

function pick(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return undefined;
}

function rawEntries(json: unknown): Array<Record<string, unknown>> {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (Array.isArray(json)) return json.filter(isObj);
  if (!isObj(json)) return [];
  for (const k of ['entries', 'terms', 'glossary'])
    if (Array.isArray(json[k])) return (json[k] as unknown[]).filter(isObj);
  // map form: { id: entry } (skip header fields)
  return Object.entries(json)
    .filter(([k, v]) => isObj(v) && !['meta', 'header'].includes(k))
    .map(([k, v]) => ({ id: k, ...(v as Record<string, unknown>) }));
}

export function parseGlossaryFile(json: unknown): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const o of rawEntries(json)) {
    const id = pick(o, ['id', 'key']);
    const label = pick(o, ['term', 'label', 'name']) ?? id;
    if (!id || !label) continue;
    const aliasesRaw = o.aliases ?? o.labels;
    out.push({
      id,
      label,
      formula: pick(o, ['formula']),
      impact: pick(o, ['impact', 'plain', 'plain_english', 'definition']),
      source: pick(o, ['source', 'source_citation', 'provenance']),
      sigma: pick(o, ['sigma', 'uncertainty']),
      units: pick(o, ['units', 'unit']),
      anchor: pick(o, ['anchor', 'learn_more', 'methodology_anchor']) ?? `gloss-${id}`,
      aliases: Array.isArray(aliasesRaw) ? aliasesRaw.map(str).filter((x): x is string => !!x) : [],
      pending: false,
    });
  }
  return out;
}

export function buildGlossary(fileJson: unknown = null): Glossary {
  const entries = new Map<string, GlossaryEntry>();
  for (const s of GLOSSARY_FALLBACK)
    entries.set(s.id, { ...s, aliases: s.aliases ?? [], anchor: `gloss-${s.id}`, pending: true });
  const fromFile = parseGlossaryFile(fileJson);
  for (const e of fromFile) {
    const prev = entries.get(e.id);
    entries.set(e.id, { ...e, aliases: [...new Set([...(prev?.aliases ?? []), ...e.aliases])] });
  }
  const index = new Map<string, string>();
  // ids first, then labels, then aliases — an id always wins over another entry's alias
  for (const e of entries.values()) index.set(normKey(e.id), e.id);
  for (const e of entries.values()) if (!index.has(normKey(e.label))) index.set(normKey(e.label), e.id);
  for (const e of entries.values()) for (const a of e.aliases) if (!index.has(normKey(a))) index.set(normKey(a), e.id);
  return { entries, index, fromFile: fromFile.length };
}

export function lookup(g: Glossary, term: string): GlossaryEntry | null {
  const id = g.index.get(normKey(term));
  return id ? (g.entries.get(id) ?? null) : null;
}
