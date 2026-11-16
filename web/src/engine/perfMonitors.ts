// Owner: Nived
// Browser-only monitors behind `window.__lumenPerf.start()` (guide section 2, Perf HUD). Started by the HUD or by an automated test, and
// removed again by stop(): they cost a rAF callback, so they are OFF by default.
//   hover      pointer event on a [data-hotpath] element -> end of the frame that drew the overlay (frameBus loops run after its tasks)
//   slipFrame  rAF frame time while a slip / pad drag is in progress; dragFrames / droppedFrames count them (dropped = > 25 ms,
//              i.e. a whole 60 Hz vsync was skipped; the guide's criterion is < 5 % dropped)
//   longTasks  main-thread tasks > 50 ms (PerformanceObserver 'longtask', Chromium)
import { frameBus } from '../state/frameBus';
import { padDragBus, slipBus } from '../state/buses';
import { perf, type PerfMonitors, type PerfRecorder } from './perf';

/** A frame that took longer than this skipped at least one 60 Hz vsync. */
export const DROPPED_FRAME_MS = 25;

export function createMonitors(rec: PerfRecorder = perf): PerfMonitors {
  let running = false;
  let off: Array<() => void> = [];

  return {
    start() {
      if (running || typeof window === 'undefined') return;
      running = true;
      const onPointer = (e: Event) => {
        const el = e.target instanceof Element ? e.target : null;
        if (el?.closest('[data-hotpath]')) rec.markInput('hover');
      };
      window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
      off.push(() => window.removeEventListener('pointermove', onPointer, { capture: true }));

      off.push(
        frameBus.loop((_now, dt) => {
          rec.frameDone('hover');
          if (slipBus.get().dragging || padDragBus.get().dragging) {
            rec.record('slipFrame', dt);
            rec.inc('dragFrames');
            if (dt > DROPPED_FRAME_MS) rec.inc('droppedFrames');
          }
        }),
      );

      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        const po = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            rec.inc('longTasks');
            rec.record('longTask', entry.duration);
          }
        });
        po.observe({ type: 'longtask', buffered: false });
        off.push(() => po.disconnect());
      }
    },
    stop() {
      running = false;
      off.forEach((f) => f());
      off = [];
    },
  };
}
