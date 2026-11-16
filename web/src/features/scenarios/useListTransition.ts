// Owner: Abhinav
// Row add/remove transition for the Compare scenario rows (§1.4: "Row add/remove 160 ms").
// emil rules: transform + opacity only; enter = fade + 4 px rise over motion.durRow (160 ms); exit = fade out over
// ≤ 160 ms, then the row is dropped and the rows below slide up with a FLIP translateY (same 160 ms). Interruptible:
// re-adding a row id while it is leaving cancels the exit from its current opacity. Reduced motion → 80 ms opacity,
// no movement. The first paint never animates. Low-frequency list (human clicks), never on the Fast Lane.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from '../../ui/tokens';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export interface ListItem<T> {
  key: string;
  item: T;
  leaving: boolean;
}

/** Merge the new list with rows that are still fading out (kept at their previous index). */
function merge<T>(prev: ListItem<T>[], next: { key: string; item: T }[]): ListItem<T>[] {
  const nextKeys = new Set(next.map((n) => n.key));
  const out: ListItem<T>[] = next.map((n) => ({ ...n, leaving: false }));
  prev.forEach((p, i) => {
    if (nextKeys.has(p.key)) return;
    out.splice(Math.min(i, out.length), 0, { ...p, leaving: true });
  });
  return out;
}

export function useListTransition<T>(items: T[], keyOf: (t: T) => string) {
  const next = items.map((item) => ({ key: keyOf(item), item }));
  const sig = next.map((n) => n.key).join('|');
  const [list, setList] = useState<ListItem<T>[]>(() => next.map((n) => ({ ...n, leaving: false })));
  const nodes = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  const anims = useRef(new Map<string, Animation>());
  const mountedOnce = useRef(false);
  const entering = useRef(new Set<string>());

  // Keep item payloads fresh every render; structural changes (keys) go through merge().
  const latest = useRef(next);
  latest.current = next;
  useEffect(() => {
    setList((prev) => {
      const prevKeys = new Set(prev.filter((p) => !p.leaving).map((p) => p.key));
      for (const n of latest.current) if (!prevKeys.has(n.key) && mountedOnce.current) entering.current.add(n.key);
      return merge(prev, latest.current);
    });
  }, [sig]);
  const view: ListItem<T>[] = list.map((l) => {
    const fresh = next.find((n) => n.key === l.key);
    return fresh ? { key: l.key, item: fresh.item, leaving: false } : l;
  });

  const drop = useCallback((key: string) => setList((ls) => ls.filter((l) => !(l.key === key && l.leaving))), []);

  // Animate: enter / exit per row, FLIP for rows whose position changed.
  useIsoLayoutEffect(() => {
    const rm = reduced();
    const dur = rm ? motion.durReduced : motion.durRow;
    for (const l of list) {
      const el = nodes.current.get(l.key);
      if (!el || typeof el.animate !== 'function') {
        if (l.leaving) drop(l.key);
        continue;
      }
      const running = anims.current.get(l.key);
      const top = el.offsetTop;
      const before = tops.current.get(l.key);
      if (l.leaving && el.dataset.exiting !== '1') {
        el.dataset.exiting = '1';
        const from = running ? Number.parseFloat(getComputedStyle(el).opacity) : 1;
        running?.cancel();
        const a = el.animate([{ opacity: from }, { opacity: 0 }], { duration: dur, easing: motion.easeOut, fill: 'forwards' });
        anims.current.set(l.key, a);
        a.onfinish = () => {
          if (anims.current.get(l.key) !== a) return;
          anims.current.delete(l.key);
          drop(l.key);
        };
      } else if (!l.leaving && el.dataset.exiting === '1') {
        // re-added mid-exit: reverse from the current opacity
        delete el.dataset.exiting;
        const from = Number.parseFloat(getComputedStyle(el).opacity);
        running?.cancel();
        const a = el.animate([{ opacity: from }, { opacity: 1 }], { duration: dur, easing: motion.easeOut });
        anims.current.set(l.key, a);
      } else if (!l.leaving && entering.current.has(l.key)) {
        entering.current.delete(l.key);
        const a = el.animate(
          [
            { opacity: 0, transform: `translateY(${rm ? 0 : -4}px)` },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: dur, easing: motion.easeOut },
        );
        anims.current.set(l.key, a);
      } else if (!l.leaving && before != null && Math.abs(before - top) > 0.5 && !rm) {
        // FLIP: slide from the old position (transform only); interrupts any running slide from its current offset
        const cs = getComputedStyle(el).transform;
        const m = /matrix\(([^)]+)\)/.exec(cs);
        const cur = running && m ? Number.parseFloat(m[1].split(',')[5]) : 0;
        running?.cancel();
        const a = el.animate([{ transform: `translateY(${before - top + cur}px)` }, { transform: 'translateY(0)' }], {
          duration: dur,
          easing: motion.easeOut,
        });
        anims.current.set(l.key, a);
      }
      tops.current.set(l.key, top);
    }
    for (const k of [...tops.current.keys()]) if (!list.some((l) => l.key === k)) tops.current.delete(k);
    mountedOnce.current = true;
  }, [list, drop]);

  const ref = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(key, el);
      else nodes.current.delete(key);
    },
    [],
  );

  return { list: view, ref };
}
