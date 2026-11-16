// Owner: Nived
// Performance recorder behind the Perf HUD and `window.__lumenPerf` (build guide, G8). Pure and clock-injectable so it is testable.
// Percentiles are NEAREST-RANK: the k-th smallest value, k = ceil(p/100 * n). Series keep the most recent `capacity` samples.
export interface Stat {
  n: number;
  mean: number | null;
  max: number | null;
  p50: number | null;
  p95: number | null;
}

export interface PerfSnapshot {
  series: Record<string, Stat>;
  counters: Record<string, number>;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[k - 1];
}

export class PerfRecorder {
  private readonly series = new Map<string, number[]>();
  private counters: Record<string, number> = {};
  private readonly pending = new Map<string, number>();

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly capacity = 2000,
  ) {}

  record(name: string, ms: number): void {
    let xs = this.series.get(name);
    if (!xs) this.series.set(name, (xs = []));
    xs.push(ms);
    if (xs.length > this.capacity) xs.shift();
  }

  stat(name: string): Stat {
    const xs = this.series.get(name) ?? [];
    if (xs.length === 0) return { n: 0, mean: null, max: null, p50: null, p95: null };
    return { n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, max: Math.max(...xs), p50: percentile(xs, 50), p95: percentile(xs, 95) };
  }

  time<T>(name: string, fn: () => T): T {
    const t0 = this.now();
    try {
      return fn();
    } finally {
      this.record(name, this.now() - t0);
    }
  }

  async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = this.now();
    try {
      return await fn();
    } finally {
      this.record(name, this.now() - t0); // a failing call was still a call: it is timed too
    }
  }

  /** An input happened (pointer event, key). Only the OLDEST pending input counts, so coalesced events report their worst latency. */
  markInput(kind: string): void {
    if (!this.pending.has(kind)) this.pending.set(kind, this.now());
  }

  /** The frame that handles inputs of this kind has finished drawing. Records input -> frame latency, if an input was pending. */
  frameDone(kind: string): void {
    const t0 = this.pending.get(kind);
    if (t0 === undefined) return;
    this.pending.delete(kind);
    this.record(kind, this.now() - t0);
  }

  inc(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }

  counter(name: string): number {
    return this.counters[name] ?? 0;
  }

  reset(): void {
    this.series.clear();
    this.pending.clear();
    this.counters = {};
  }

  snapshot(): PerfSnapshot {
    const series: Record<string, Stat> = {};
    for (const name of this.series.keys()) series[name] = this.stat(name);
    return { series, counters: { ...this.counters } };
  }
}

/** The shared recorder used by the app. */
export const perf = new PerfRecorder();

export interface PerfMonitors {
  start(): void;
  stop(): void;
}

export interface LumenPerfApi {
  snapshot(): PerfSnapshot;
  stat(name: string): Stat;
  counter(name: string): number;
  reset(): void;
  start(): void;
  stop(): void;
}

/** Expose the automated-test surface: `window.__lumenPerf` (guide section 2). */
export function installPerf(target: { __lumenPerf?: LumenPerfApi }, recorder: PerfRecorder = perf, monitors: PerfMonitors = { start() {}, stop() {} }): void {
  target.__lumenPerf = {
    snapshot: () => recorder.snapshot(),
    stat: (name) => recorder.stat(name),
    counter: (name) => recorder.counter(name),
    reset: () => recorder.reset(),
    start: () => monitors.start(),
    stop: () => monitors.stop(),
  };
}
