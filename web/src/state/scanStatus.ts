// Owner: Abhinav
// Scan stage, shared at human rate (stage boundaries only, ≤ ~6 updates per scan). The verdict popover reads it to
// say "provisional" while the Scan list holds stage-1 (nominal) verdicts only (R3 D-15).
//   0 = no scan running/shown · 1 = stage 1 only (provisional) · 2 = stage-2 bounded rows have arrived
// Writer: until Nived's ScanPanel reports its stage directly (`reportScanStage` from its onUpdate — requested),
// CompareView bridges it from the panel's `data-stage` attribute.
import { create } from 'zustand';

export type ScanStage = 0 | 1 | 2;

interface ScanStatus {
  stage: ScanStage;
  done: boolean;
}

export const useScanStatus = create<ScanStatus>()(() => ({ stage: 0, done: false }));

export function reportScanStage(stage: ScanStage, done = false): void {
  const s = useScanStatus.getState();
  if (s.stage !== stage || s.done !== done) useScanStatus.setState({ stage, done });
}

export const useScanStage = () => useScanStatus((s) => s.stage);
