// Owner: Nived
// FLIP reorder for the Scan list when stage-2 rows arrive (FRONTEND_BUILD_GUIDE: 150 ms, stage-2 arrival only, never during stage 1,
// never under prefers-reduced-motion). First-Last-Invert-Play: measure row tops before and after the reorder, push each surviving row back
// by the difference (no transition), then release it to transition to 0.
import { useLayoutEffect, useRef } from 'react';

export const FLIP_MS = 150;
const MIN_MOVE_PX = 1;

/** For each row present both before and after: how far it must be offset to look unmoved (before - after). Rows that did not move are omitted. */
export function flipDeltas(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(after)) {
    if (!(key in before)) continue;
    const d = before[key] - after[key];
    if (Math.abs(d) >= MIN_MOVE_PX) out[key] = d;
  }
  return out;
}

/** Animate only when stage 2 is showing and the rows present in both lists changed their relative order. */
export function shouldAnimate(stage: 0 | 1 | 2, prevKeys: readonly string[], keys: readonly string[]): boolean {
  if (stage !== 2) return false;
  const now = new Set(keys);
  const before = new Set(prevKeys);
  const a = prevKeys.filter((k) => now.has(k));
  const b = keys.filter((k) => before.has(k));
  return a.some((k, i) => k !== b[i]);
}

/** Put `data-flip-key` on each row; call with the ordered keys and the stage. The container's rows are re-measured every commit. */
export function useFlipReorder(container: React.RefObject<HTMLElement>, keys: readonly string[], stage: 0 | 1 | 2): void {
  const tops = useRef<Record<string, number>>({});
  const prevKeys = useRef<readonly string[]>([]);
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-flip-key]'));
    const after: Record<string, number> = {};
    for (const r of rows) after[r.dataset.flipKey!] = r.offsetTop;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && shouldAnimate(stage, prevKeys.current, keys)) {
      const deltas = flipDeltas(tops.current, after);
      for (const r of rows) {
        const d = deltas[r.dataset.flipKey!];
        if (d === undefined) continue;
        r.style.transition = 'none';
        r.style.transform = `translateY(${d}px)`;
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const r of rows) {
            if (deltas[r.dataset.flipKey!] === undefined) continue;
            r.style.transition = `transform ${FLIP_MS}ms ease-out`;
            r.style.transform = '';
            r.addEventListener('transitionend', () => (r.style.transition = ''), { once: true });
          }
        }),
      );
    }
    tops.current = after;
    prevKeys.current = keys;
  });
}
