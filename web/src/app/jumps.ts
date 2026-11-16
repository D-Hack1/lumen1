// Owner: Abhinav
// Mission Bar jumps S / E / X / T — pure helpers (no React, no physics). The engine owns event times:
// targets come from Nived's `jumpTo(eventType)`; ± and grazing come from the matching `EventRecord`.
//
// E is dynamic (R3 D-14): "Next Earthrise" when Earth is down, "Next Earthset" when it is up — read from the
// engine's answer state (`answer.earth.visible`), never computed here.
import { fill, fmtSpan } from '../engine/format';
import type { AnswerState, EventRecord, EventType } from '../engine/types';
import { formatUtc } from './time';

export type JumpSlot = 'S' | 'E' | 'X' | 'T';
export type JumpId = EventType | 'touchdown';

export interface JumpTarget {
  slot: JumpSlot;
  id: JumpId;
  /** Epoch ms UTC, or null when there is no such event before the window ends (button disabled). */
  t: number | null;
  pmMs: number | null;
  grazing: boolean;
}

export const JUMP_SLOTS: JumpSlot[] = ['S', 'E', 'X', 'T'];

/** E button event type from the engine answer state. Unknown (no result yet) → Earthset, the D-14 default. */
export function earthJumpType(answer: Pick<AnswerState, 'earth'> | null | undefined): 'earthset' | 'earthrise' {
  return answer && !answer.earth.visible ? 'earthrise' : 'earthset';
}

export function jumpIdFor(slot: JumpSlot, answer: Pick<AnswerState, 'earth'> | null | undefined): JumpId {
  switch (slot) {
    case 'S':
      return 'sunset';
    case 'E':
      return earthJumpType(answer);
    case 'X':
      return 'shadowExit';
    case 'T':
      return 'touchdown';
  }
}

/** Which answer cell state announces this event as the next one (used when the event list cannot answer). */
const CELL_FOR: Record<EventType, { cell: 'sun' | 'earth'; state: string }> = {
  sunset: { cell: 'sun', state: 'sunsetIn' },
  shadowExit: { cell: 'sun', state: 'sunriseIn' },
  earthset: { cell: 'earth', state: 'earthsetIn' },
  earthrise: { cell: 'earth', state: 'earthriseIn' },
};

export interface JumpContext {
  answer: AnswerState | null;
  events: EventRecord[];
  /** Committed scrub time (`scrubUtc`). */
  scrubUtc: number;
  landingUtc: number;
  /** Nived's `jumpTo` (injected so tests can pass a fake). */
  jumpTo: (type: EventType) => number | null;
}

export function resolveJump(slot: JumpSlot, ctx: JumpContext): JumpTarget {
  const id = jumpIdFor(slot, ctx.answer);
  if (id === 'touchdown') return { slot, id, t: ctx.landingUtc, pmMs: null, grazing: false };

  let t = ctx.jumpTo(id);
  // Shim until jumpTo reads the committed scrub: the Phase 1 stub measures "next" from the result's own tScrub, so
  // a second press would land on the same event. Take the first engine event after the committed scrub instead.
  if (t == null || t <= ctx.scrubUtc) t = ctx.events.find((e) => e.type === id && e.t > ctx.scrubUtc)?.t ?? null;
  let rec = t == null ? undefined : ctx.events.find((e) => e.type === id && e.t === t);

  // Forced-state fixtures carry the next event on the answer cell only (no event list): use it when it is this type.
  if (t == null && ctx.answer) {
    const c = CELL_FOR[id];
    const a = ctx.answer[c.cell];
    if (a.state === c.state && a.nextEventT != null && a.nextEventT > ctx.scrubUtc) {
      t = a.nextEventT;
      rec = undefined;
      return { slot, id, t, pmMs: a.nextEventPmMs, grazing: a.grazing };
    }
  }
  return { slot, id, t, pmMs: rec?.dtMs ?? null, grazing: rec?.grazing ?? false };
}

/** Minute-precision UTC for tooltips (seconds would be false precision next to a ± of hours). */
export const formatJumpTime = (t: number): string => formatUtc(t).slice(0, 16);

/** Tooltip text: label, target UTC and ± (or "(grazing)"), and the shortcut key. Copy decides the wording. */
export function jumpTooltip(j: JumpTarget, t: (key: string) => string): string {
  const label = t(`mb.jump.${j.id}.long`);
  if (j.t == null) return fill(t('mb.jump.tipNone'), { label, key: j.slot });
  const time = formatJumpTime(j.t);
  if (j.pmMs == null || j.pmMs <= 0) return fill(t('mb.jump.tipExact'), { label, time, key: j.slot });
  return fill(t(j.grazing ? 'mb.jump.tipGrazing' : 'mb.jump.tip'), { label, time, pm: fmtSpan(j.pmMs), key: j.slot });
}

/** Keyboard: S/E/X/T without modifiers, not while typing in a field, not on auto-repeat. */
export function jumpSlotForKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}): JumpSlot | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null;
  const el = e.target as (HTMLElement & { isContentEditable?: boolean }) | null;
  const tag = el?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return null;
  const k = e.key.toUpperCase();
  return (JUMP_SLOTS as string[]).includes(k) ? (k as JumpSlot) : null;
}
