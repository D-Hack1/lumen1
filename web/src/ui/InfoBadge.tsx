// Owner: Abhinav
// InfoBadge — the "?" on every technical metric/control (PLAN §8.10): Formula · Impact · Source & σ · Learn more →.
// Timing (§1.4): 300 ms open delay, 100 ms fade (CSS), 0 ms when moving between badges (warm window). Click or
// Enter opens at once and pins the tip until Esc / pointer-down outside. A 120 ms close grace lets the pointer
// travel from the badge into the tip to reach "Learn more →".
//
// Glossary binding: teammates only pass `term` (a glossary id OR the visible label — both resolve). The resolver is
// installed once at boot by features/guidance/InfoBadgeBinding (`installGlossaryBinding`), so the kit never fetches
// data itself and every existing badge is bound without touching the caller. Explicit props win over the glossary.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCopyFn } from '../state/copy';
import { motion } from './tokens';

/** What a badge shows. Produced by the glossary binding (or passed explicitly). */
export interface InfoBadgeContent {
  label: ReactNode;
  formula?: ReactNode;
  impact?: ReactNode;
  /** Source line; σ is appended after " · σ " when present. */
  source?: ReactNode;
  sigma?: ReactNode;
  /** Methodology anchor id for "Learn more →". */
  anchor?: string;
  /** True when the entry is a placeholder (glossary not delivered / key unknown). */
  pending?: boolean;
}

export interface InfoBadgeBinding {
  resolve(term: string): InfoBadgeContent | null;
  learnMore(anchor: string): void;
}

let binding: InfoBadgeBinding | null = null;
/** Install the glossary resolver (features/guidance). Pass null to remove (tests). */
export function setInfoBadgeBinding(b: InfoBadgeBinding | null): void {
  binding = b;
}

export interface InfoBadgeProps {
  /** Glossary id or visible label (e.g. "sun_elevation" or "Sun elevation"). Shown as the title if unbound. */
  term: string;
  label?: ReactNode;
  formula?: ReactNode;
  impact?: ReactNode;
  source?: ReactNode;
  onLearnMore?: () => void;
}

const CLOSE_GRACE_MS = 120;
let warmUntil = 0; // moving between badges within this window opens instantly
const WARM_MS = 500;
/** The badge whose tip is open (only one at a time): opening another closes it at once, no grace overlap. */
let activeClose: (() => void) | null = null;

/** For tests: forget the warm window. */
export function resetInfoBadgeWarmth(): void {
  warmUntil = 0;
}

export function InfoBadge({ term, label, formula, impact, source, onLearnMore }: InfoBadgeProps) {
  const t = useCopyFn();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const [open, setOpenState] = useState(false);
  const [pinned, setPinned] = useState(false);
  const openRef = useRef(false); // synchronous mirror: warm-window decisions can't wait for a render
  const closeSelf = useRef<() => void>(() => {});
  const setOpen = useCallback((v: boolean) => {
    if (v && activeClose && activeClose !== closeSelf.current) activeClose();
    if (v) activeClose = closeSelf.current;
    else if (activeClose === closeSelf.current) activeClose = null;
    openRef.current = v;
    setOpenState(v);
  }, []);

  const clear = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const show = useCallback(() => {
    clear();
    const delay = performance.now() < warmUntil ? 0 : motion.delayTooltip;
    if (delay === 0) setOpen(true);
    else openTimer.current = window.setTimeout(() => setOpen(true), delay);
  }, [setOpen]);
  const close = useCallback(() => {
    clear();
    if (openRef.current) warmUntil = performance.now() + WARM_MS;
    setOpen(false);
    setPinned(false);
  }, [setOpen]);
  closeSelf.current = close;
  const scheduleClose = useCallback(() => {
    window.clearTimeout(openTimer.current);
    if (pinned) return;
    // Warm now (synchronously) so the next badge entered within the grace opens at 0 ms.
    if (openRef.current) warmUntil = performance.now() + WARM_MS;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(close, CLOSE_GRACE_MS);
  }, [pinned, close]);

  useEffect(
    () => () => {
      clear();
      if (activeClose === closeSelf.current) activeClose = null;
    },
    [],
  );

  // Pinned: Esc or pointer-down outside closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !tip.current?.contains(t)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, close]);

  // Position once on open (human speed); flip below if there is no room above.
  useLayoutEffect(() => {
    if (!open || !btn.current || !tip.current) return;
    const b = btn.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const above = b.top - t.height - 6 >= 4;
    const top = above ? b.top - t.height - 6 : Math.min(b.bottom + 6, window.innerHeight - t.height - 4);
    const left = Math.min(Math.max(4, b.left + b.width / 2 - t.width / 2), window.innerWidth - t.width - 4);
    tip.current.style.left = `${Math.round(left)}px`;
    tip.current.style.top = `${Math.round(Math.max(4, top))}px`;
    tip.current.style.transformOrigin = above ? 'bottom center' : 'top center';
  }, [open]);

  // Resolve at render while open (cheap lookup) — glossary arriving later is picked up on the next open.
  const bound = open && binding ? binding.resolve(term) : null;
  const c: InfoBadgeContent = {
    label: label ?? bound?.label ?? term,
    formula: formula ?? bound?.formula,
    impact: impact ?? bound?.impact,
    source: source ?? bound?.source,
    sigma: source ? undefined : bound?.sigma,
    anchor: bound?.anchor,
    pending: !formula && !impact && !source && (bound ? bound.pending : true),
  };
  const learnMore = onLearnMore ?? (c.anchor && binding ? () => binding!.learnMore(c.anchor!) : undefined);
  const name = typeof label === 'string' ? label : term;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="ui-info"
        aria-label={`${t('gloss.about')} ${name}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        data-term={term}
        onPointerEnter={show}
        onPointerLeave={scheduleClose}
        onFocus={show}
        onBlur={(e) => {
          if (!tip.current?.contains(e.relatedTarget as Node)) scheduleClose();
        }}
        onClick={(e) => {
          e.stopPropagation(); // a badge inside a clickable card must not select the card
          clear();
          setOpen(true);
          setPinned(true);
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="ui-tooltip"
            data-pending={c.pending || undefined}
            onPointerEnter={() => window.clearTimeout(closeTimer.current)}
            onPointerLeave={scheduleClose}
          >
            <div className="ui-tooltip__title">{c.label}</div>
            {c.formula && (
              <div className="ui-tooltip__row">
                <span>{t('gloss.formula')}</span>
                <span className="num">{c.formula}</span>
              </div>
            )}
            {c.impact && (
              <div className="ui-tooltip__row">
                <span>{t('gloss.impact')}</span>
                <span>{c.impact}</span>
              </div>
            )}
            {(c.source || c.sigma) && (
              <div className="ui-tooltip__row">
                <span>{t('gloss.source')}</span>
                <span>
                  {c.source}
                  {c.sigma && (
                    <>
                      {c.source ? ' · ' : ''}σ <span className="num">{c.sigma}</span>
                    </>
                  )}
                </span>
              </div>
            )}
            {learnMore && (
              <button
                type="button"
                className="ui-tooltip__more"
                onClick={() => {
                  close();
                  learnMore();
                }}
              >
                {t('gloss.learnMore')}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
