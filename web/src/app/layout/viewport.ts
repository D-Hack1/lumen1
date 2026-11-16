// Owner: Abhinav
// Viewport → density attributes on <html> (data-density, data-cols, data-right-tabs). CSS reads the attributes;
// React reads `useViewport()` only where structure changes (right column → tabs). Chosen from viewport size
// only, never user agent (§4). Resize work is coalesced into the frame bus.
import { useSyncExternalStore } from 'react';
import { frameBus } from '../../state/frameBus';
import { pickCols, pickDensity, rightColumnTabs, type Cols, type Density } from '../../ui/tokens';

export interface ViewportState {
  w: number;
  h: number;
  density: Density;
  cols: Cols;
  rightTabs: boolean;
}

function measure(): ViewportState {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { w, h, density: pickDensity(w, h), cols: pickCols(w), rightTabs: rightColumnTabs(w, h) };
}

let state: ViewportState | null = null;
const listeners = new Set<() => void>();

function apply() {
  const next = measure();
  const changed =
    !state || next.density !== state.density || next.cols !== state.cols || next.rightTabs !== state.rightTabs;
  state = next;
  if (!changed) return;
  const root = document.documentElement;
  root.dataset.density = next.density;
  root.dataset.cols = next.cols;
  root.dataset.rightTabs = String(next.rightTabs);
  listeners.forEach((l) => l());
}

/** Call once before first render (sets attributes synchronously, then watches resize). */
export function installViewportWatcher(): void {
  apply();
  window.addEventListener('resize', () => frameBus.schedule(apply));
}

export function useViewport(): ViewportState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state ?? measure(),
  );
}
