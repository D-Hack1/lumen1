// Owner: Ebin
// "Ask LUMEN" box: press "/" → type → run a command, read an explanation, or see why a number is what it is.
// Three deterministic sources, none of them a language model (so the box says so):
//   1. commands.ts   "go to compare", "show IM-2", "slip 9 days"  → the app's own actions, passed in as `ports`
//   2. why.ts        "why is this ± so big?"                      → a template filled from the current result
//   3. knowledge.ts  any other term/question                      → local search over knowledge.json, with its source
// Nothing here fetches from a network (knowledge.json is a local file in the offline cache) or computes physics.
//
// Key handling (agreed with Abhinav): one window keydown for "/" that ignores inputs/modifiers/repeats and only
// preventDefaults when it opens; Escape closes and is handled in the capture phase so popovers don't take it first.
// Avoids backtick (Perf HUD), S/E/X/T (old jump keys) and arrows outside this box.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ScenarioResult } from '../../engine/types';
import { HELP_EXAMPLES, parseCommand, runCommand, type AskCommand, type AskPorts, type AskSite } from './commands';
import { answerText, intentOf, loadKnowledge, searchKnowledge, type KnowledgeIndex, type KnowledgeKind } from './knowledge';
import { OPEN_EVENT } from './askWhy';
import { detectWhy, explain, explainGeneric, hasTemplate, type Why, type WhyRequest } from './why';
import './ask.css';

export interface AskBoxProps {
  ports: AskPorts;
  sites: readonly AskSite[];
  /** True once the live pages expose a slip state (so "slip 9 days" can act). */
  canSlip: boolean;
  /** Range the live slip state accepts; commands outside it are clamped and the box says so. */
  slipRange?: { min: number; max: number };
  /** The result to explain. Null = nothing to explain yet. */
  result: ScenarioResult | null;
  /** Shown under every explanation when the result is not what the page on screen is showing. */
  resultNote?: string;
  light?: boolean;
  /** Called when the box opens or closes (lets a wrapper start computing the result only while it is open). */
  onOpenChange?: (open: boolean) => void;
}

type Item =
  | { id: string; kind: 'command'; command: AskCommand; label: string }
  | { id: string; kind: 'option'; command: AskCommand; label: string }
  | { id: string; kind: 'note'; text: string }
  | { id: string; kind: 'why'; why: Why }
  | { id: string; kind: 'hit'; title: string; text: string; source: string; tag: string; weak: boolean }
  | { id: string; kind: 'examples' };

const KIND_TAG: Record<KnowledgeKind, string> = {
  term: 'Term',
  validation: 'Validation',
  limitation: 'Limit',
  decision: 'Why we decided',
  howto: 'How to',
  method: 'How it’s calculated',
  concept: 'Background',
  status: 'Status',
};

/** Ordinary-language starting points, by what people tend to want. Shown on an empty box and when nothing matched. */
const QUESTION_EXAMPLES: readonly { label: string; items: readonly string[] }[] = [
  { label: 'Using LUMEN', items: ['how do I compare sites?', 'how do I drop a pin?', 'what does the array height do?'] },
  { label: 'How results are calculated', items: ['how are the results calculated?', 'how is sunlight calculated?', 'how is the link to Earth decided?'] },
  { label: 'Why things are the way they are', items: ['why is the timing uncertain?', 'why does the sun stay so low?', 'why show a ± on everything?'] },
];

/** Clickable example questions grouped by what people want; clicking fills the box. */
function ExampleChips({ onPick, withCommands }: { onPick: (q: string) => void; withCommands?: boolean }) {
  const groups = withCommands ? [{ label: 'Do something', items: HELP_EXAMPLES.filter((e) => !e.includes('?')) }, ...QUESTION_EXAMPLES] : QUESTION_EXAMPLES;
  return (
    <div className="ask__help">
      {groups.map((g) => (
        <div key={g.label} className="ask__group">
          <div className="ask__helplabel">{g.label}</div>
          <div className="ask__chips">
            {g.items.map((ex) => (
              <button key={ex} type="button" className="ask__chip" onClick={() => onPick(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export function AskBox({ ports, sites, canSlip, slipRange, result, resultNote, light, onOpenChange }: AskBoxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [forced, setForced] = useState<WhyRequest | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [index, setIndex] = useState<KnowledgeIndex | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setForced(null);
    setFeedback(null);
    setActive(0);
    returnFocus.current?.focus?.();
  }, []);

  // "/" opens; Escape closes (capture phase, before popovers/tooltips); other widgets can open it with askWhy().
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (open || e.key !== '/' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      returnFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    const onOpen = (e: Event) => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setForced((e as CustomEvent<{ target?: WhyRequest }>).detail?.target ?? null);
      setQuery('');
      setOpen(true);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (!index) void loadKnowledge().then(setIndex);
  }, [open, index]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const knowledge = index?.docs.map((d) => d.entry) ?? [];
    const whyFor = (t: WhyRequest, alreadyShown: ReadonlySet<string> = new Set()): Item => ({
      id: `why:${t}`,
      kind: 'why',
      why: !result ? { target: 'events', title: 'Explanation', context: null, lines: [{ kind: 'value', text: 'There is no result to explain yet.' }], sources: [] } : hasTemplate(t) ? explain(t, result, knowledge.filter((k) => !alreadyShown.has(k.id))) : explainGeneric(t, result),
    });

    if (forced) out.push(whyFor(forced));
    const q = query.trim();
    if (!q) return out;

    const parsed = parseCommand(q, { sites, canSlip, slipMin: slipRange?.min, slipMax: slipRange?.max });
    if (parsed.kind === 'command') out.push({ id: 'cmd', kind: 'command', command: parsed.command, label: parsed.label });
    else if (parsed.kind === 'unavailable') out.push({ id: 'unavail', kind: 'note', text: parsed.reason });
    else if (parsed.kind === 'ambiguous') {
      out.push({ id: 'amb', kind: 'note', text: 'Which one do you mean?' });
      for (const o of parsed.options) out.push({ id: `opt:${o.id}`, kind: 'option', command: { kind: 'site', id: o.id, name: o.name }, label: o.name });
    }

    if (parsed.kind !== 'command') {
      const target = detectWhy(q);
      const hits = index ? searchKnowledge(index, q, 4) : [];
      const toItem = (h: (typeof hits)[number], weak: boolean): Item => ({ id: `hit:${h.entry.id}`, kind: 'hit', title: h.entry.title, text: answerText(h.entry), source: h.entry.source, tag: KIND_TAG[h.entry.kind], weak });
      const strong = hits.filter((h) => h.confidence === 'strong').slice(0, 3);
      const weak = strong.length === 0 ? hits.slice(0, 2) : [];
      // "how is X calculated?" → the written method first, then the live numbers. "why is this ± so big?" → live numbers first.
      // The live numbers come first only when the question is about THIS number ("why is this ± so big?", "my sunlit %");
      // a general question ("how is X calculated?", "why did you choose a ±?") gets the written answer first.
      const aboutThisNumber = /\b(this|these|my|current|currently|now|here)\b/.test(q.toLowerCase());
      const liveFirst = aboutThisNumber && !intentOf(q).method;
      // If the written answer for this metric is already on screen as a card, the live card doesn't repeat it.
      const whyItem = target ? whyFor(target, new Set(strong.map((h) => h.entry.id))) : null;
      if (whyItem && liveFirst) out.push(whyItem);
      out.push(...strong.map((h) => toItem(h, false)));
      if (whyItem && !liveFirst) out.push(whyItem);
      if (weak.length > 0 && !whyItem) {
        out.push({ id: 'weak', kind: 'note', text: 'Closest I have — I’m not sure these answer your question:' });
        out.push(...weak.map((h) => toItem(h, true)));
      }
      const answered = out.some((i) => i.kind === 'hit' || i.kind === 'why');
      if (!answered && parsed.kind === 'none') {
        out.push({ id: 'none', kind: 'note', text: index ? 'I don’t have an answer for that. I can help with using LUMEN, how the results are calculated, and why things were decided — and only from what is written down in LUMEN. Try asking one of these:' : 'Loading what I know…' });
        if (index) out.push({ id: 'examples', kind: 'examples' });
      }
    }
    return out;
  }, [query, forced, sites, canSlip, slipRange, result, index]);

  const runnable = items.filter((i) => i.kind === 'command' || i.kind === 'option');
  useEffect(() => setActive(0), [query, forced]);

  const run = (cmd: AskCommand) => {
    const r = runCommand(cmd, ports);
    setFeedback(r.message);
    if (r.ok && cmd.kind !== 'help') window.setTimeout(close, 700);
  };

  if (!open) return null;

  // aria-modal only hides the rest of the page from assistive tech; keyboard focus must be kept inside too.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // One short sentence for screen readers when the results change (the visible list is also aria-live, but a card of
  // text is a poor announcement).
  const announcement = !query.trim() ? '' : runnable.length > 0 ? `${runnable.length} action${runnable.length > 1 ? 's' : ''} available. Press Enter to run the first.` : `${items.filter((i) => i.kind === 'hit' || i.kind === 'why').length} answer${items.filter((i) => i.kind === 'hit' || i.kind === 'why').length === 1 ? '' : 's'} shown.`;

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && runnable.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % runnable.length);
    } else if (e.key === 'ArrowUp' && runnable.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + runnable.length) % runnable.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = runnable[active];
      if (pick && (pick.kind === 'command' || pick.kind === 'option')) run(pick.command);
    }
  };

  return (
    <div className={`ask ${light ? 'lm-theme-light' : 'lm-theme-dark'}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={panel} className="ask__panel" role="dialog" aria-modal="true" aria-label="Ask LUMEN" onKeyDown={trapTab}>
        <div className="ask__head">
          <span className="ask__title">Ask LUMEN</span>
          <span className="ask__sub">commands and explanations · works offline · search and templates, not a chatbot</span>
          <kbd className="ask__esc">Esc</kbd>
        </div>
        <input
          ref={input}
          className="ask__input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFeedback(null);
          }}
          onKeyDown={onInputKey}
          placeholder="go to compare · show IM-2 · slip 9 days · why is this ± so big?"
          aria-label="Ask LUMEN"
          aria-controls={listId}
          aria-activedescendant={runnable[active] ? `${listId}-${runnable[active].id}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="ask__sr" role="status" aria-live="polite">
          {announcement}
        </div>
        <div className="ask__list" id={listId} role="listbox" aria-label="Results">
          {feedback && <div className="ask__feedback">{feedback}</div>}
          {items.length === 0 && !query.trim() && <ExampleChips onPick={setQuery} withCommands />}
          {items.map((it) => {
            if (it.kind === 'examples') return <ExampleChips key={it.id} onPick={setQuery} />;
            if (it.kind === 'command' || it.kind === 'option') {
              const isActive = runnable[active]?.id === it.id;
              return (
                <button key={it.id} id={`${listId}-${it.id}`} type="button" role="option" aria-selected={isActive} className={`ask__row ask__row--cmd${isActive ? ' is-active' : ''}`} onClick={() => run(it.command)}>
                  <span className="ask__enter" aria-hidden="true">↵</span>
                  {it.label}
                </button>
              );
            }
            if (it.kind === 'note') return <div key={it.id} className="ask__note">{it.text}</div>;
            if (it.kind === 'hit')
              return (
                <div key={it.id} className={`ask__card${it.weak ? ' ask__card--weak' : ''}`}>
                  <div className="ask__cardhead">
                    <span className="ask__tag">{it.tag}</span>
                    <span className="ask__cardtitle">{it.title}</span>
                  </div>
                  <p className="ask__text">{it.text}</p>
                  <div className="ask__src">Source: {it.source}</div>
                </div>
              );
            return (
              <div key={it.id} className="ask__card ask__card--why">
                <div className="ask__cardhead">
                  <span className="ask__tag">Why this number</span>
                  <span className="ask__cardtitle">{it.why.title}</span>
                </div>
                {it.why.context && <div className="ask__ctx">{it.why.context}</div>}
                {it.why.lines.map((l, i) => (
                  <p key={i} className={`ask__text ask__text--${l.kind}`}>
                    {l.text}
                  </p>
                ))}
                {resultNote && <p className="ask__text ask__text--basis">{resultNote}</p>}
                {it.why.sources.length > 0 && <div className="ask__src">From: {it.why.sources.join(' · ')}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
