// Owner: Ebin
// "Explain": a deterministic search over web/public/content/knowledge.json (built by web/scripts/build-knowledge.mjs from
// the glossary, the validation report, the plan's decision log and docs/ask_help.md).
// No language model and no network. It can only return text already in the knowledge file, with its source, so it cannot
// invent an answer. What makes it feel like it understands ordinary questions is plain, inspectable machinery:
//   • BM25 ranking over title / tags / body, with a bonus when a query word is IN an entry's title or tags
//   • intent: "how do I…" prefers how-tos, "how is … calculated" prefers methods, "why did we…" prefers decisions
//   • a short synonym list (people say "delay", the file says "slip") and one-typo tolerance on longer words
//   • confidence: strong matches are answers; weak ones are shown as "closest I have", never as an answer
// When nothing matches, the box says so and offers examples — it never guesses.
import { withinOneEdit } from './commands';

export type KnowledgeKind = 'term' | 'validation' | 'limitation' | 'decision' | 'howto' | 'method' | 'concept' | 'status';

export interface KnowledgeEntry {
  id: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  body: string;
  source: string;
  anchor?: string;
  /** MetricSet keys this entry explains (from the glossary's related_metric_ids). */
  metrics?: string[];
  /** Extra words people might use for this entry (searched, and weighted above the body). */
  tags?: string[];
}

export type Confidence = 'strong' | 'weak';
export interface KnowledgeHit {
  entry: KnowledgeEntry;
  score: number;
  confidence: Confidence;
}

export interface Intent {
  howto: boolean;
  method: boolean;
  decision: boolean;
  /** "what is X" — wants a definition, not a decision record. */
  define: boolean;
}

/** What kind of answer the question is asking for, from its wording. */
export function intentOf(query: string): Intent {
  const q = query.toLowerCase();
  return {
    howto: /\b(how (do|can|could|would|should|to) (i|we|you|one)|how to|where (do|can|is|are)|can i|button|navigate|click|open|switch|select|choose|change|find|use|using|help)\b/.test(q),
    method: /(calculat|comput|formula|work(s|ed)? out|derive|method|algorithm|how (is|are|was|does|do) .*(determin|measur|decid|work|come))/.test(q),
    define: /^(what|who)( is| are| does| do)?\b|\bwhat('s| is| are) (a|an|the)?\b/.test(q) && !/\bwhat (do|does|can) (i|we|you)\b/.test(q),
    decision: /\b(why (did|do|does|is|are|was|were|would)|decid|chosen|choice|reason|rationale|trade.?off|affect|impact|influence|matter|difference)\b/.test(q),
  };
}

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'its', 'this', 'that', 'these', 'those',
  'what', 'why', 'how', 'does', 'do', 'did', 'so', 'me', 'my', 'about', 'mean', 'means', 'explain', 'tell', 'with', 'than', 'big', 'large', 'small',
  'much', 'can', 'could', 'would', 'should', 'i', 'you', 'we', 'your', 'our', 'us', 'there', 'any', 'some', 'get', 'got', 'want', 'need', 'please',
  'calculated', 'calculate', 'computed', 'compute', 'work', 'works', 'worked', 'thing', 'things', 'all', 'just', 'really', 'actually', 'show',
  'who', 'whom', 'whose', 'which', 'when', 'where',
]);

/** What people type → the words the knowledge file actually uses. Short on purpose, so it stays reviewable. */
const SYNONYMS: Record<string, string[]> = {
  '±': ['uncertainty', 'plus', 'minus'],
  plusminus: ['uncertainty'],
  error: ['uncertainty'],
  errors: ['uncertainty'],
  margin: ['uncertainty', 'margin'],
  sigma: ['uncertainty'],
  σ: ['uncertainty'],
  confidence: ['uncertainty'],
  accurate: ['uncertainty', 'validation', 'real'],
  accuracy: ['validation', 'uncertainty'],
  precise: ['uncertainty'],
  sunset: ['sun', 'clearance', 'uncertainty', 'event'],
  sunrise: ['sun', 'clearance', 'event'],
  shadow: ['shadow', 'night', 'dark'],
  dark: ['night'],
  darkness: ['night'],
  skimming: ['grazing'],
  graze: ['grazing'],
  light: ['sun', 'sunlit'],
  sunlight: ['sunlit', 'sun'],
  radio: ['dsn', 'link', 'contact'],
  comms: ['dsn', 'link', 'contact'],
  communication: ['dsn', 'link', 'contact'],
  communications: ['dsn', 'link', 'contact'],
  antenna: ['dsn', 'link'],
  tilt: ['slope', 'tilt'],
  panel: ['array', 'cosine', 'power'],
  panels: ['array', 'cosine', 'power'],
  solar: ['sun', 'array', 'power'],
  battery: ['night', 'power', 'soc'],
  crater: ['psr'],
  ice: ['psr'],
  tier: ['fidelity', 'tier'],
  correct: ['validation'],
  verify: ['validation'],
  validated: ['validation'],
  trust: ['validation', 'uncertainty', 'fidelity'],
  fake: ['sample', 'real'],
  real: ['sample', 'status', 'real'],
  // delay / slip / schedule
  delay: ['slip'],
  postpone: ['slip'],
  later: ['slip'],
  launch: ['slip', 'landing'],
  // interface
  pin: ['coordinates', 'pin'],
  location: ['coordinates', 'site'],
  place: ['site', 'coordinates'],
  latitude: ['coordinates'],
  longitude: ['coordinates'],
  spin: ['rotate'],
  drag: ['rotate', 'drag'],
  zoom: ['zoom', 'orbit'],
  globe: ['orbit', 'moon'],
  theme: ['theme', 'light', 'dark'],
  versus: ['compare'],
  difference: ['compare'],
  height: ['mast', 'height'],
  array: ['mast', 'array'],
  clock: ['time', 'scrub'],
  date: ['time'],
  menu: ['navigate', 'pages'],
  button: ['howto'],
  shortcut: ['keyboard', 'ask'],
};

/** lower-case, split on non-letters (keeping ±/σ), drop stop words, strip a plural "s". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}±]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((t) => !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export interface WeightedToken {
  term: string;
  weight: number;
}

export function expandQuery(query: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(query)) {
    out.push(t);
    for (const s of SYNONYMS[t] ?? []) out.push(s);
  }
  return out;
}

interface Indexed {
  entry: KnowledgeEntry;
  title: Map<string, number>;
  tags: Map<string, number>;
  body: Map<string, number>;
  len: number;
}

const counts = (tokens: string[]) => {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};

export interface KnowledgeIndex {
  docs: Indexed[];
  df: Map<string, number>;
  vocab: string[];
  avgLen: number;
}

export function buildIndex(entries: readonly KnowledgeEntry[]): KnowledgeIndex {
  const docs: Indexed[] = entries.map((entry) => {
    const title = tokenize(entry.title);
    const tags = tokenize((entry.tags ?? []).join(' '));
    const body = tokenize(`${entry.summary} ${entry.body}`);
    return { entry, title: counts(title), tags: counts(tags), body: counts(body), len: title.length + tags.length + body.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set([...d.title.keys(), ...d.tags.keys(), ...d.body.keys()])) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length);
  return { docs, df, vocab: [...df.keys()], avgLen };
}

const K1 = 1.4;
const B = 0.7;
const TITLE_BOOST = 3;
const TAG_BOOST = 2;
/** A query word that IS a word of the entry's title/tags is the strongest signal there is ("uncertainty" → the Uncertainty term). */
const TITLE_MATCH_BONUS = 1.5;
const TAG_MATCH_BONUS = 0.8;
const INTENT_BOOST = 1.4;
const DEFINE_BOOST = 1.25;
const FUZZY_WEIGHT = 0.6;
/** Below this nothing is shown. Between this and STRONG_SCORE it is shown only as "closest I have". */
export const MIN_SCORE = 1.5;
export const STRONG_SCORE = 4.0;

/** Query terms with weights: the words themselves (1), their synonyms (0.8), and one-typo corrections of unknown longer words (0.6). */
export function queryTerms(index: KnowledgeIndex, query: string): WeightedToken[] {
  const terms = new Map<string, number>();
  const put = (term: string, weight: number) => terms.set(term, Math.max(terms.get(term) ?? 0, weight));
  for (const t of tokenize(query)) {
    put(t, 1);
    for (const s of SYNONYMS[t] ?? []) put(s, 0.8);
    if (t.length >= 5 && !index.df.has(t) && !SYNONYMS[t]) {
      for (const v of index.vocab) if (v.length >= 5 && withinOneEdit(t, v)) put(v, FUZZY_WEIGHT);
    }
  }
  return [...terms].map(([term, weight]) => ({ term, weight }));
}

const KIND_FOR: Record<keyof Intent, readonly KnowledgeKind[]> = {
  howto: ['howto'],
  method: ['method', 'term'],
  decision: ['decision', 'concept'],
  define: ['term', 'concept'],
};

export function searchKnowledge(index: KnowledgeIndex, query: string, limit = 3): KnowledgeHit[] {
  const q = queryTerms(index, query);
  if (q.length === 0) return [];
  const intent = intentOf(query);
  const N = index.docs.length;
  const hits: KnowledgeHit[] = [];
  for (const d of index.docs) {
    let score = 0;
    for (const { term: t, weight } of q) {
      const tf = (d.title.get(t) ?? 0) * TITLE_BOOST + (d.tags.get(t) ?? 0) * TAG_BOOST + (d.body.get(t) ?? 0);
      if (!tf) continue;
      const n = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      let s = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.len) / index.avgLen)));
      if (d.title.has(t)) s += TITLE_MATCH_BONUS;
      else if (d.tags.has(t)) s += TAG_MATCH_BONUS;
      score += s * weight;
    }
    if (score <= 0) continue;
    for (const key of ['howto', 'method', 'decision', 'define'] as const) {
      if (intent[key] && KIND_FOR[key].includes(d.entry.kind)) score *= key === 'define' ? DEFINE_BOOST : INTENT_BOOST;
    }
    if (score >= MIN_SCORE) hits.push({ entry: d.entry, score, confidence: score >= STRONG_SCORE ? 'strong' : 'weak' });
  }
  return hits.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, limit);
}

/** The words to show for a hit: the whole answer for written help, a short snippet for glossary/validation text. */
export function answerText(entry: KnowledgeEntry): string {
  return entry.kind === 'term' || entry.kind === 'validation' || entry.kind === 'limitation' ? snippet(entry) : entry.body.trim();
}

/** First sentence-ish chunk, for a compact answer card. */
export function snippet(entry: KnowledgeEntry, max = 220): string {
  const s = entry.summary.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return `${stop > 80 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '')}…`;
}

// ---- loading (once per page; the file is part of the offline cache)
let cached: Promise<KnowledgeIndex | null> | null = null;

export function loadKnowledge(): Promise<KnowledgeIndex | null> {
  cached ??= (async () => {
    try {
      const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
      const r = await fetch(`${b.replace(/\/$/, '')}/content/knowledge.json`);
      if (!r.ok) return null;
      const j = (await r.json()) as { entries?: KnowledgeEntry[] };
      return j.entries?.length ? buildIndex(j.entries) : null;
    } catch {
      return null;
    }
  })();
  return cached;
}
