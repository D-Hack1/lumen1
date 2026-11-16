// Owner: Abhinav
// Transient buses — vanilla subscribe/notify stores with NO React binding (FRONTEND_BUILD_GUIDE §2, §1.3).
// Written at pointer/drag rate; subscribers are notified at most once per frame, inside the frame bus,
// and must draw imperatively (Canvas draw, or ref attribute/textContent writes). Never call setState from
// a bus subscriber.
//
//   crosshairBus  { tHover, tScrub, source }       — shared crosshair (PLAN §8.12)
//   slipBus       { slipDays, dragging, rowId }    — Slip drag (live), committed via store.setSlip / setRowSlip
//   padDragBus    { tiltMagDeg, tiltDirDeg, yawDeg, dragging } — Touchdown Pad drags, committed via store
//   siteHoverBus  { siteId }                       — site-card hover → map pin pulse (Phase 3)
import { frameBus } from './frameBus';

export type Listener<T> = (value: Readonly<T>) => void;

export interface TransientBus<T extends object> {
  /** Latest value (same object every call — read fields, don't keep references across frames). */
  get(): Readonly<T>;
  /** Record the latest value. Cheap: copies fields and schedules one notify on the next frame. */
  set(patch: Partial<T>): void;
  /** Subscribe; returns unsubscribe. Called inside the frame bus, at most once per frame. */
  subscribe(fn: Listener<T>): () => void;
  /** Reset to the initial value (and notify). */
  reset(): void;
}

export function createBus<T extends object>(name: string, initial: T): TransientBus<T> {
  const value = { ...initial } as T;
  const listeners = new Set<Listener<T>>();
  let dirty = false;

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    for (const fn of listeners) {
      try {
        fn(value);
      } catch (e) {
        console.error(`[${name}] subscriber failed`, e);
      }
    }
  };

  const set = (patch: Partial<T>) => {
    let changed = false;
    for (const k in patch) {
      const v = patch[k] as T[typeof k];
      if (value[k] !== v) {
        value[k] = v;
        changed = true;
      }
    }
    if (changed && !dirty) {
      dirty = true;
      frameBus.schedule(flush);
    }
  };

  return {
    get: () => value,
    set,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    reset: () => set(initial),
  };
}

// ---------- the three buses ----------

export interface CrosshairValue {
  /** Hover time, epoch ms UTC; null = no hover. */
  tHover: number | null;
  /** Live scrub time, epoch ms UTC (committed to the store via scenario.commitScrub at human speed). */
  tScrub: number;
  /** Which component wrote last (lets a chart skip re-drawing its own echo). */
  source: string | null;
}

export interface SlipValue {
  slipDays: number;
  dragging: boolean;
  /** Compare view, "selected row" mode: the row being slipped (its own slip). null = global slip (every row + Cockpit). */
  rowId: 'A' | 'B' | 'C' | 'D' | null;
}

export interface PadDragValue {
  tiltMagDeg: number;
  tiltDirDeg: number;
  yawDeg: number;
  dragging: boolean;
}

export const crosshairBus = createBus<CrosshairValue>('crosshairBus', { tHover: null, tScrub: 0, source: null });
export const slipBus = createBus<SlipValue>('slipBus', { slipDays: 0, dragging: false, rowId: null });
export const padDragBus = createBus<PadDragValue>('padDragBus', {
  tiltMagDeg: 0,
  tiltDirDeg: 0,
  yawDeg: 0,
  dragging: false,
});

/** Site Explorer card hover → map pin pulse (FRONTEND_BUILD_GUIDE §1.4: CSS opacity only). `siteId` null = none.
 *  The Basemap (or the sidebar's interim pin-pulse binding) subscribes and toggles a class — never React state. */
export interface SiteHoverValue {
  siteId: string | null;
}
export const siteHoverBus = createBus<SiteHoverValue>('siteHoverBus', { siteId: null });
