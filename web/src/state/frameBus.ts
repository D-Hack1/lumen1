// Owner: Abhinav
// Frame bus — the ONE shared requestAnimationFrame loop (FRONTEND_BUILD_GUIDE §1.3 rule 3).
// Pointer handlers only record the latest value (via a transient bus); drawing happens here, once per frame.
//
//   frameBus.schedule(fn)   one-shot task for the next frame (deduplicated by function identity)
//   frameBus.loop(fn)       per-frame callback while registered (playback, continuous overlays) → unsubscribe
//
// Order inside a frame: one-shot tasks (bus flushes → overlay draws) in scheduling order, then loops.

export type FrameLoop = (now: number, dtMs: number) => void;

export interface FrameStats {
  frames: number;
  /** Wall time spent inside the last frame's callbacks (ms). */
  lastWorkMs: number;
  /** Max callback time seen since reset (ms). */
  maxWorkMs: number;
}

const tasks = new Set<() => void>();
const loops = new Set<FrameLoop>();
const stats: FrameStats = { frames: 0, lastWorkMs: 0, maxWorkMs: 0 };

let handle: number | null = null;
let lastNow = 0;

const raf: (cb: (t: number) => void) => number =
  typeof requestAnimationFrame !== 'undefined'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;

function run(now: number) {
  handle = null;
  const t0 = performance.now();
  const dt = lastNow ? now - lastNow : 16.7;
  lastNow = now;

  // Snapshot so tasks scheduled during this frame run next frame (no starvation loops).
  const batch = Array.from(tasks);
  tasks.clear();
  for (const fn of batch) {
    try {
      fn();
    } catch (e) {
      console.error('[frameBus] task failed', e);
    }
  }
  for (const fn of loops) {
    try {
      fn(now, dt);
    } catch (e) {
      console.error('[frameBus] loop failed', e);
    }
  }

  const work = performance.now() - t0;
  stats.frames++;
  stats.lastWorkMs = work;
  if (work > stats.maxWorkMs) stats.maxWorkMs = work;

  if (loops.size > 0 || tasks.size > 0) request();
  else lastNow = 0;
}

function request() {
  if (handle == null) handle = raf(run);
}

export const frameBus = {
  schedule(fn: () => void): void {
    tasks.add(fn);
    request();
  },
  loop(fn: FrameLoop): () => void {
    loops.add(fn);
    request();
    return () => {
      loops.delete(fn);
    };
  },
  /** Run pending work synchronously (tests, and flushing before a screenshot). */
  flushNow(): void {
    if (handle != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(handle);
    run(performance.now());
  },
  stats(): Readonly<FrameStats> {
    return stats;
  },
  resetStats(): void {
    stats.frames = 0;
    stats.lastWorkMs = 0;
    stats.maxWorkMs = 0;
  },
};
