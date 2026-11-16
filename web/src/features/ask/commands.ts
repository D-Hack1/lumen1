// Owner: Ebin
// "Ask LUMEN" command parser — rules, not a language model. Turns a typed line into ONE of the app's existing actions
// (go to a page, pick a site, slip N days) or says plainly that it didn't understand. Pure and deterministic: the same
// text always gives the same result, so every supported phrase can be listed, tested and shown in the help.
//
// Supported phrases (also what `HELP_EXAMPLES` shows):
//   go to compare · show the orbit · open slip explorer · stand here
//   show IM-2 · malapert · select haworth          (a site, by name, short name or a part of it; one typo is forgiven)
//   slip 9 days · slip +9 · delay 3 d · slip back 2 days · slip 0 / reset slip
//   help
// Anything else is NOT a command; the box then tries the knowledge search ("explain") instead.

export type AskRoute = 'orbit' | 'stand-here' | 'compare' | 'slip' | 'methodology';

export interface AskSite {
  id: string;
  name: string;
  short?: string;
  /** Extra things people might type ("athena", "mons mouton"). */
  aliases?: readonly string[];
}

export interface AskContext {
  sites: readonly AskSite[];
  /** False until the live pages expose a slip state — then "slip 9 days" answers honestly that it can't act yet. */
  canSlip: boolean;
  /** The range the live slip state accepts (the Slip explorer is 0…27 d). Defaults to ±30 d. Out-of-range input is clamped AND SAID. */
  slipMin?: number;
  slipMax?: number;
}

export type AskCommand =
  | { kind: 'go'; route: AskRoute }
  | { kind: 'site'; id: string; name: string }
  | { kind: 'slip'; days: number; clamped: boolean }
  | { kind: 'help' };

export type ParseResult =
  | { kind: 'command'; command: AskCommand; label: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ambiguous'; options: { id: string; name: string }[] }
  | { kind: 'none' };

export const HELP_EXAMPLES: readonly string[] = ['go to compare', 'show IM-2', 'slip 9 days', 'slip back 2 days', 'stand here', 'why is this ± so big?'];

export const SLIP_LIMIT_DAYS = 30;

const ROUTE_LABEL: Record<AskRoute, string> = { orbit: 'Orbit', 'stand-here': 'Stand here', compare: 'Compare', slip: 'Slip explorer', methodology: 'Methodology' };

// Longest alias first so "slip explorer" is not swallowed by "slip".
const ROUTE_ALIASES: readonly [AskRoute, readonly string[]][] = [
  ['methodology', ['methodology', 'validation report', 'validation page', 'validation', 'glossary']],
  ['slip', ['slip explorer', 'slip page', 'what if we slip', 'slip view']],
  ['stand-here', ['stand here', 'standing here', 'surface view', 'surface', 'horizon', 'skyline', 'panorama']],
  ['compare', ['compare sites', 'compare', 'comparison']],
  ['orbit', ['orbit', 'whole moon', 'the moon', 'moon', 'globe', 'south pole', 'map']],
];

const VERBS = ['go to', 'take me to', 'switch to', 'navigate to', 'open', 'show me', 'show', 'view', 'select', 'pick', 'choose', 'stand at', 'stand on', 'visit', 'load'];
const STOP = new Set(['the', 'a', 'an', 'site', 'page', 'view', 'to', 'me', 'please', 'of', 'at', 'on', 'in', 'for']);

/** lower-case, keep letters/digits/+/-; "IM-2" → "im2", "Chang'e-6" → "change6". */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9+\- ]/g, ' ')
    .replace(/(?<=[a-z])-(?=\d)/g, '') // im-2 → im2
    .replace(/\s+/g, ' ')
    .trim();
}

/** Edit distance ≤ 1 (substitution, insertion or deletion) — forgives one typo in a name. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function stripVerbs(text: string): string {
  let t = ` ${text} `;
  for (const v of VERBS) t = t.replace(new RegExp(`\\b${v}\\b`, 'g'), ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function siteTokens(s: AskSite): Set<string> {
  const toks = new Set<string>();
  for (const src of [s.name, s.short ?? '', s.id, ...(s.aliases ?? [])]) {
    const n = normalise(src);
    if (n) toks.add(n);
    for (const t of n.split(' ')) if (t.length >= 2 && !STOP.has(t)) toks.add(t);
  }
  return toks;
}

/** Sites matching the words left after removing verbs/stop words. Exact token hits beat one-typo hits. */
export function matchSites(query: string, sites: readonly AskSite[]): AskSite[] {
  const words = stripVerbs(normalise(query))
    .split(' ')
    .filter((w) => w && !STOP.has(w));
  if (words.length === 0) return [];
  const joined = words.join(' ');
  const exact: AskSite[] = [];
  const fuzzy: AskSite[] = [];
  for (const s of sites) {
    const toks = siteTokens(s);
    if (toks.has(joined) || words.every((w) => toks.has(w))) exact.push(s);
    else if (words.every((w) => [...toks].some((t) => (w.length >= 5 && t.length >= 5 ? withinOneEdit(w, t) : false)))) fuzzy.push(s);
  }
  return exact.length ? exact : fuzzy;
}

/** Verbs that mean "change the landing date". Weak verbs need an explicit "N days" so ordinary phrases aren't misread. */
const SLIP_STRONG = /\b(slip|slipping|delay|delayed|postpone|defer)\b/;
const SLIP_WEAK = /\b(move|shift|push|pushed|land|landing|launch|launching|go)\b/;

function parseSlip(text: string, min: number, max: number): { days: number; clamped: boolean } | 'reset' | null {
  const strong = SLIP_STRONG.test(text);
  const weak = SLIP_WEAK.test(text);
  if (!strong && !weak) return null;
  if (strong && /\b(reset|clear|no slip|on time|zero)\b/.test(text)) return 'reset';
  const m = text.match(/([+-]?)\s*(\d{1,3})\s*(d\b|day|days)?/);
  if (!m) return null;
  if (!strong && !m[3]) return null; // "move 2" alone is not a slip; "move 2 days" is
  let days = parseInt(m[2], 10);
  // Direction. "push back 2 days" means DELAY in everyday speech; "slip/move back" and "earlier" mean sooner.
  const later = /\b(later|forward|front|ahead|after|delay|delayed|postpone|defer|push|pushed)\b/.test(text);
  const sooner = /\b(earlier|sooner|before|backward|backwards|back)\b/.test(text) && !/\bpush(ed)? back\b/.test(text) && !/\blater\b/.test(text);
  if (m[1] === '-' || (sooner && !later)) days = -days;
  const clampedDays = Math.max(min, Math.min(max, days));
  return { days: clampedDays, clamped: clampedDays !== days };
}

function parseRoute(text: string): AskRoute | null {
  const t = ` ${stripVerbs(text)} `;
  for (const [route, aliases] of ROUTE_ALIASES) {
    for (const a of aliases) if (t.includes(` ${a} `)) return route;
  }
  return null;
}

export function parseCommand(input: string, ctx: AskContext): ParseResult {
  const text = normalise(input);
  if (!text) return { kind: 'none' };

  // Only a bare request for help. ("how do i …" is a QUESTION about the interface — it goes to the knowledge search.)
  if (/^(help|\?|what can you do|what can i (say|ask|type)|commands)\s*$/.test(text)) return { kind: 'command', command: { kind: 'help' }, label: 'Show what I can do' };

  // A question is never a command: "how do I compare sites?", "what is the slip explorer?", "how many days can I slip?"
  // mention page/site words but want an EXPLANATION. Commands are imperatives ("go to compare", "slip 9 days", "show IM-2").
  if (/^(how|what|why|where|who|which|when|is|are|can|could|does|do|did|should|would|will)\b/.test(text)) return { kind: 'none' };

  const slipMin = ctx.slipMin ?? -SLIP_LIMIT_DAYS;
  const slipMax = ctx.slipMax ?? SLIP_LIMIT_DAYS;
  const slip = parseSlip(text, slipMin, slipMax);
  if (slip) {
    if (!ctx.canSlip) return { kind: 'unavailable', reason: 'Slip can’t be set from here yet — open the Slip explorer page and use its slider.' };
    const days = slip === 'reset' ? 0 : slip.days;
    const clamped = slip === 'reset' ? false : slip.clamped;
    const sign = days > 0 ? '+' : '';
    const label = clamped ? `Slip ${sign}${days} d (allowed: ${slipMin} to ${slipMax} d)` : days === 0 ? 'Reset slip to on time' : `Slip ${sign}${days} d`;
    return { kind: 'command', command: { kind: 'slip', days, clamped }, label };
  }

  // A bare number-free "slip" / "slip explorer" is the page, handled by parseRoute below.
  const route = parseRoute(text);
  const hits = matchSites(text, ctx.sites);
  // "compare im-2": a site name wins over a route word only when the route word is not the whole request.
  if (route && hits.length === 0) return { kind: 'command', command: { kind: 'go', route }, label: `Go to ${ROUTE_LABEL[route]}` };

  if (hits.length === 1) return { kind: 'command', command: { kind: 'site', id: hits[0].id, name: hits[0].name }, label: `Select ${hits[0].name}` };
  if (hits.length > 1) return { kind: 'ambiguous', options: hits.slice(0, 5).map((s) => ({ id: s.id, name: s.name })) };
  return { kind: 'none' };
}

/** What the box can actually do right now (ports are the app's own actions; nothing here computes anything). */
export interface AskPorts {
  go(route: AskRoute): void;
  selectSite(id: string): void;
  /** Present only once the live pages expose slip state. */
  setSlip?(days: number): void;
}

export function runCommand(cmd: AskCommand, ports: AskPorts): { ok: boolean; message: string } {
  switch (cmd.kind) {
    case 'go':
      ports.go(cmd.route);
      return { ok: true, message: `Opened ${ROUTE_LABEL[cmd.route]}.` };
    case 'site':
      ports.selectSite(cmd.id);
      return { ok: true, message: `Selected ${cmd.name}.` };
    case 'slip':
      if (!ports.setSlip) return { ok: false, message: 'Slip can’t be set from here yet.' };
      ports.setSlip(cmd.days);
      return { ok: true, message: cmd.days === 0 ? 'Slip reset to on time.' : `Slip set to ${cmd.days > 0 ? '+' : ''}${cmd.days} d.` };
    case 'help':
      return { ok: true, message: `Try: ${HELP_EXAMPLES.join(' · ')}` };
  }
}
