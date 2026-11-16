// Owner: Nived
// Scan streaming simulator (D-15 timings): stage 1 (nominal, provisional) lands at ~60 ms; stage 2 (bounded) trickles
// in until ~280 ms, top-10 first. Cancellable. Replaced by the real two-stage worker path later; same call shape.
import type { ScanCandidate, ScanResult } from '../engine/types';

export const STAGE1_MS = 60;
export const STAGE2_END_MS = 280;
export const STAGE2_CHUNKS = 5;

export interface ScanSimHandle {
  cancel(): void;
  done: Promise<ScanResult>;
}

export function simulateScan(nominal: ScanCandidate[], onUpdate: (r: ScanResult) => void): ScanSimHandle {
  const t0 = performance.now();
  const timers: number[] = [];
  let cancelled = false;
  let resolve!: (r: ScanResult) => void;
  const done = new Promise<ScanResult>((r) => (resolve = r));
  const emit = (stage: 1 | 2, candidates: ScanCandidate[], final: boolean) => {
    if (cancelled) return;
    const r: ScanResult = { stage, done: final, candidates, latencyMs: performance.now() - t0 };
    onUpdate(r);
    if (final) resolve(r);
  };
  const rows: ScanCandidate[] = nominal.map((c) => ({ ...c, provisional: true, boundsStatus: 'nominal' }));
  timers.push(window.setTimeout(() => emit(1, rows, false), STAGE1_MS));
  // Stage 2 bounds the top 10 (and any near-threshold candidates); rows swap from "provisional" to "bounded".
  const toBound = Math.min(10, rows.length);
  const step = (STAGE2_END_MS - STAGE1_MS) / STAGE2_CHUNKS;
  for (let k = 1; k <= STAGE2_CHUNKS; k++) {
    timers.push(
      window.setTimeout(() => {
        const upto = Math.ceil((toBound * k) / STAGE2_CHUNKS);
        for (let i = 0; i < upto; i++) rows[i] = { ...rows[i], provisional: false, boundsStatus: 'bounded' };
        emit(2, [...rows], k === STAGE2_CHUNKS);
      }, STAGE1_MS + step * k),
    );
  }
  return {
    cancel: () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    },
    done,
  };
}
