// Owner: Nived
import type { LumenPerfApi } from '../engine/perf';

declare global {
  interface Window {
    __lumenPerf?: LumenPerfApi;
  }
}

export {};
