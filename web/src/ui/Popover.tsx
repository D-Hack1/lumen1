// Owner: Abhinav
// Popover — anchored panel (verdict → Mission Profile; Definitions ✎).
// Motion (§1.2, emil rules): transform + opacity only, origin-aware scale 0.96 → 1 growing from the anchor point
// (transform-origin = where the anchor meets the panel, also when the panel is clamped), enter 150 ms, exit 120 ms
// (exit ≤ enter), strong ease-out, no overshoot. Interruptible: every change starts from the element's current
// animated opacity/scale, so open–close–open spam reverses smoothly instead of jumping. Reduced motion → 80 ms
// opacity only. Dismiss: Esc (focus returns to the anchor), pointer-down outside, or the caller's close button.
// No backdrop blur and no large shadow (it can sit over live canvases): surface colour + 1 px hairline.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { motion } from './tokens';

/** useLayoutEffect in the browser, useEffect under SSR (unit tests) — avoids the server warning. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement>;
  /** Accessible name of the dialog. */
  label: string;
  /** Horizontal alignment to the anchor: `end` = right edges line up (Mission Bar right side). */
  align?: 'start' | 'end';
  id?: string;
  className?: string;
  /** Other triggers that toggle this popover — pointer-down on them is not an "outside" dismiss. */
  insideRefs?: RefObject<HTMLElement>[];
  children: ReactNode;
}

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function currentFrame(el: HTMLElement): { o: number; s: number } {
  const cs = getComputedStyle(el);
  const o = Number.parseFloat(cs.opacity);
  const m = /matrix\(([^,]+)/.exec(cs.transform);
  return { o: Number.isFinite(o) ? o : 1, s: m ? Number.parseFloat(m[1]) : 1 };
}

export function Popover({
  open,
  onClose,
  anchor,
  label,
  align = 'end',
  id,
  className,
  insideRefs,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const [mounted, setMounted] = useState(open);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  if (open && !mounted) setMounted(true); // mount synchronously on open (render-phase update, no extra frame)

  // Position: below the anchor, aligned to its edge, clamped to the viewport. Once per open + on resize.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = align === 'end' ? a.right - w : a.left;
      const x = Math.round(Math.min(Math.max(4, left), window.innerWidth - w - 4));
      const below = a.bottom + 6 + h <= window.innerHeight - 4 || a.top - 6 - h < 4;
      const y = Math.round(Math.max(4, below ? Math.min(a.bottom + 6, window.innerHeight - h - 4) : a.top - 6 - h));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      // Origin-aware: grow from the anchor's centre on the edge facing it (clamped into the panel).
      const ox = Math.min(Math.max(0, a.left + a.width / 2 - x), w);
      el.style.transformOrigin = `${Math.round(ox)}px ${below ? 'top' : 'bottom'}`;
      el.dataset.side = below ? 'bottom' : 'top';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, mounted, anchor, align]);

  // Enter / exit from the current animated frame.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      if (!open) setMounted(false);
      return;
    }
    const rm = reduced();
    const from0 = { o: 0, s: rm ? 1 : 0.96 };
    const from = anim.current ? currentFrame(el) : open ? from0 : { o: 1, s: 1 };
    anim.current?.cancel();
    const to = open ? { o: 1, s: 1 } : from0;
    const a = el.animate(
      [
        { opacity: from.o, transform: `scale(${rm ? 1 : from.s})` },
        { opacity: to.o, transform: `scale(${to.s})` },
      ],
      {
        duration: rm ? motion.durReduced : open ? motion.durPopover : motion.durFast,
        easing: motion.easeOut,
        fill: 'forwards',
      },
    );
    anim.current = a;
    a.onfinish = () => {
      if (anim.current !== a) return;
      anim.current = null;
      if (!open) setMounted(false);
      else a.cancel(); // settle on the base style (opacity 1, no transform)
    };
  }, [open, mounted]);

  // Focus in on open; Esc and outside pointer-down dismiss.
  useEffect(() => {
    if (!open) return;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current();
      anchor.current?.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      if (insideRefs?.some((r) => r.current?.contains(t))) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, anchor, insideRefs]);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-open={open || undefined}
      className={['ui-popover', className].filter(Boolean).join(' ')}
      // keep it out of the tab order and pointer path while it fades out (React 18 passes `inert` through as a string)
      {...((!open ? { inert: '' } : {}) as Record<string, string>)}
    >
      {children}
    </div>,
    document.body,
  );
}
