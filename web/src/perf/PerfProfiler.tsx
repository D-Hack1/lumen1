// Owner: Nived
// Counts React commits for the whole app (the guide's "zero React commits during a hover run"). A <Profiler> at the root
// calls back once per commit; the cost is one counter increment.
import { Profiler, type ReactNode } from 'react';
import { perf } from '../engine/perf';

export function PerfProfiler({ children }: { children: ReactNode }) {
  return (
    <Profiler id="app" onRender={() => perf.inc('reactCommits')}>
      {children}
    </Profiler>
  );
}
