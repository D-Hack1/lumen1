// Owner: Abhinav
// UI kit component: Accordion — a header bar that opens its body as an OVERLAY anchored to the header (never pushes
// the layout, so it can never create page scroll). Used by the Cockpit "Profile & Battery" slot (48/40/36 px header).
// Motion (§1.2, emil rules): transform + opacity only — the panel rises 8 px + fades in over 180 ms (motion.durBase),
// exits in 120 ms (exit ≤ enter), strong ease-out, no overshoot. Interruptible: each change starts from the current
// animated frame. Reduced motion → 80 ms opacity only. Esc closes (focus returns to the header); pointer-down outside
// the header and panel closes. Rendered in a portal because the slot clips (overflow: hidden). No blur, no big shadow
// (it sits over the Touchdown Pad canvas): surface colour + 1 px hairline.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from './tokens';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const SHIFT_PX = 8;

export interface AccordionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Header content (inside the toggle button). Keep it to one line: the header has a fixed slot height. */
  header: ReactNode;
  /** Accessible name of the overlay region. */
  label: string;
  /** Open upwards (header at the bottom of a column, the default) or downwards. */
  side?: 'top' | 'bottom';
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}

function currentFrame(el: HTMLElement): { o: number; y: number } {
  const cs = getComputedStyle(el);
  const o = Number.parseFloat(cs.opacity);
  const m = /matrix\(([^)]+)\)/.exec(cs.transform);
  const y = m ? Number.parseFloat(m[1].split(',')[5]) : 0;
  return { o: Number.isFinite(o) ? o : 1, y: Number.isFinite(y) ? y : 0 };
}

export function Accordion({
  open,
  onOpenChange,
  header,
  label,
  side = 'top',
  className,
  panelClassName,
  children,
}: AccordionProps) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const panelId = useId();
  const [mounted, setMounted] = useState(open);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;

  if (open && !mounted) setMounted(true);

  // Place the overlay over the column, edge-aligned with the header, above (or below) it. On open + resize only.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = btn.current?.getBoundingClientRect();
      const el = panel.current;
      if (!a || !el) return;
      el.style.left = `${Math.round(a.left)}px`;
      el.style.width = `${Math.round(a.width)}px`;
      if (side === 'top') {
        el.style.top = '';
        el.style.bottom = `${Math.round(window.innerHeight - a.top + 4)}px`;
        el.style.maxHeight = `${Math.max(120, Math.round(a.top - 8))}px`;
      } else {
        el.style.bottom = '';
        el.style.top = `${Math.round(a.bottom + 4)}px`;
        el.style.maxHeight = `${Math.max(120, Math.round(window.innerHeight - a.bottom - 8))}px`;
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, mounted, side]);

  useIsoLayoutEffect(() => {
    const el = panel.current;
    if (!el || typeof el.animate !== 'function') {
      if (!open) setMounted(false);
      return;
    }
    const rm = reduced();
    const dy = rm ? 0 : side === 'top' ? SHIFT_PX : -SHIFT_PX;
    const closed = { o: 0, y: dy };
    const from = anim.current ? currentFrame(el) : open ? closed : { o: 1, y: 0 };
    anim.current?.cancel();
    const to = open ? { o: 1, y: 0 } : closed;
    const a = el.animate(
      [
        { opacity: from.o, transform: `translateY(${rm ? 0 : from.y}px)` },
        { opacity: to.o, transform: `translateY(${to.y}px)` },
      ],
      { duration: rm ? motion.durReduced : open ? motion.durBase : motion.durFast, easing: motion.easeOut, fill: 'forwards' },
    );
    anim.current = a;
    a.onfinish = () => {
      if (anim.current !== a) return;
      anim.current = null;
      if (!open) setMounted(false);
      else a.cancel();
    };
  }, [open, mounted, side]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      change.current(false);
      btn.current?.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      // Popovers/tooltips opened from inside the panel live in their own portals — don't treat them as outside.
      if ((t as Element).closest?.('.ui-popover, .ui-tooltip')) return;
      change.current(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  return (
    <div className={['ui-acc', className].filter(Boolean).join(' ')} data-open={open || undefined}>
      <button
        ref={btn}
        type="button"
        className="ui-acc__head"
        aria-expanded={open}
        aria-controls={mounted ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <span className="ui-acc__head-body">{header}</span>
        <span className="ui-acc__caret" aria-hidden="true">
          {side === 'top' ? '▴' : '▾'}
        </span>
      </button>
      {mounted &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="region"
            aria-label={label}
            data-open={open || undefined}
            data-side={side}
            className={['ui-acc__panel', panelClassName].filter(Boolean).join(' ')}
            {...((!open ? { inert: '' } : {}) as Record<string, string>)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
