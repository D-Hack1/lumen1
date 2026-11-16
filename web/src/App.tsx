// Owner: Abhinav
// Root app: viewport-locked shell = Mission Bar + active view + toasts.
// View switch (§1.4, emil): ≤ 150 ms opacity crossfade, no slide. The incoming view fades in over motion.durView
// (150 ms); the outgoing view stays stacked in the same grid cell, inert and pointer-transparent, and fades out over
// motion.durFast (120 ms, exit ≤ enter), then unmounts. Opacity only, so no layout change and no scroll. A switch
// mid-fade drops the older leaving view at once (interruptible). Reduced motion → 80 ms (CSS vars).
import { useEffect, useRef, useState } from 'react';
import { MissionBar } from './app/MissionBar';
import { CockpitView } from './app/views/CockpitView';
import { CompareView } from './app/views/CompareView';
import { MethodologyView } from './app/views/MethodologyView';
import { useScenario, type ViewId } from './state/scenarioStore';
import { ToastViewport } from './ui/Toast';
import { motion } from './ui/tokens';

function renderView(v: ViewId) {
  if (v === 'cockpit') return <CockpitView />;
  if (v === 'compare') return <CompareView />;
  return <MethodologyView />;
}

export function App() {
  const view = useScenario((s) => s.view);
  const [leaving, setLeaving] = useState<ViewId | null>(null);
  const [shown, setShown] = useState(view);
  const timer = useRef<number | undefined>(undefined);

  if (shown !== view) {
    // "Previous render" pattern (state, not a ref — idempotent under StrictMode's double render): the previous view
    // becomes the leaving layer in this same commit, so there is never a blank frame.
    setShown(view);
    setLeaving(shown);
  }
  useEffect(() => {
    if (!leaving) return;
    // Safety net if animationend never fires (hidden tab, reduced-motion override).
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLeaving(null), motion.durFast + 80);
    return () => window.clearTimeout(timer.current);
  }, [leaving]);

  return (
    <div className="app-root" data-view={view}>
      <MissionBar />
      <div className="app-stage">
        {leaving && leaving !== view && (
          <main
            className="app-view app-view--leaving"
            key={leaving /* same key as when it was active → React keeps the instance, no remount */}
            aria-hidden="true"
            {...({ inert: '' } as Record<string, string>)}
            onAnimationEnd={(e) => e.target === e.currentTarget && setLeaving(null)}
          >
            {renderView(leaving)}
          </main>
        )}
        <main className="app-view" key={view} aria-label={view} data-active-view={view}>
          {renderView(view)}
        </main>
      </div>
      <ToastViewport />
    </div>
  );
}
