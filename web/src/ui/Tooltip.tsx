// Owner: Abhinav
// Tooltip — short text hint on a control (jump targets, verdict meaning). For glossary-backed "?" badges use
// InfoBadge. Timing (§1.4): 300 ms open delay, 100 ms fade, 0 ms while moving between tooltips (warm window).
// Opacity only; no transform, no layout motion. Position is computed once per open (human speed, not hot path).
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

import { motion } from './tokens';

/** useLayoutEffect in the browser, useEffect under SSR (unit tests) — avoids the server warning. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

let warmUntil = 0;

type TriggerProps = {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
};

export interface TooltipProps {
  content: string;
  /** Preferred side; flips when there is no room. */
  side?: 'top' | 'bottom';
  children: ReactElement<TriggerProps>;
}

export function Tooltip({ content, side = 'bottom', children }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const show = useCallback((el: HTMLElement) => {
    anchor.current = el;
    window.clearTimeout(timer.current);
    const delay = performance.now() < warmUntil ? 0 : motion.delayTooltip;
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen((was) => {
      if (was) warmUntil = performance.now() + 500;
      return false;
    });
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useIsoLayoutEffect(() => {
    const a = anchor.current;
    const el = tip.current;
    if (!open || !a || !el) return;
    const b = a.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const roomBelow = b.bottom + 6 + r.height <= window.innerHeight - 4;
    const roomAbove = b.top - 6 - r.height >= 4;
    const below = side === 'bottom' ? roomBelow || !roomAbove : !roomAbove && roomBelow;
    const top = below ? b.bottom + 6 : b.top - r.height - 6;
    const left = Math.min(Math.max(4, b.left + b.width / 2 - r.width / 2), window.innerWidth - r.width - 4);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [open, side, content]);

  const p = children.props;
  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : p['aria-describedby'],
    onPointerEnter: (e) => {
      p.onPointerEnter?.(e);
      show(e.currentTarget);
    },
    onPointerLeave: (e) => {
      p.onPointerLeave?.(e);
      hide();
    },
    onFocus: (e) => {
      p.onFocus?.(e);
      show(e.currentTarget);
    },
    onBlur: (e) => {
      p.onBlur?.(e);
      hide();
    },
    onKeyDown: (e) => {
      p.onKeyDown?.(e);
      if (e.key === 'Escape') hide();
    },
  });

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div ref={tip} id={id} role="tooltip" className="ui-tooltip ui-tooltip--text">
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
