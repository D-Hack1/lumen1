// Owner: Abhinav
// Crosshair (PLAN §8.12): t_hover (transient) and t_scrub (live on the bus, committed to the store on release).
// `useCrosshair()` returns STABLE functions — it never re-renders the caller. Charts subscribe and draw in the
// frame bus; React components that need t_scrub at human speed read `useScenario(s => s.scrubUtc)`.
import { crosshairBus, type CrosshairValue } from './buses';
import { getScenario } from './scenarioStore';

export { crosshairBus, type CrosshairValue };

export const crosshair = {
  get: crosshairBus.get,
  subscribe: crosshairBus.subscribe,
  /** Pointer-rate. `source` = writer id, e.g. 'barcode'. */
  setHover(t: number | null, source: string | null = null) {
    crosshairBus.set({ tHover: t, source });
  },
  /** Pointer-rate live scrub (dragging the scrub bar). Call `commitScrub` on release. */
  setScrubLive(t: number, source: string | null = null) {
    crosshairBus.set({ tScrub: t, source });
  },
  /** Human-rate: pins t_scrub in the committed store (click, release, jump, keyboard). */
  commitScrub(t: number) {
    getScenario().commitScrub(t);
  },
  /** Esc: clear hover. */
  clear() {
    crosshairBus.set({ tHover: null, source: null });
  },
};

export function useCrosshair() {
  return crosshair;
}
