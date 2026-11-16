// Owner: Abhinav
// The four Lumen pages behind one shell, routed by URL hash (#orbit, #stand-here, #compare, #slip). Theme, selected site,
// array height, clock and compare list are shared, so a choice made on one page carries to the others.
import { Fragment, useEffect, useState } from 'react';
import { useWindowStart } from '../orbit/windowStart';
import { AskLumen } from '../ask';
import { OrbitPage } from '../orbit/OrbitPage';
import { LumenContext, useLumenState } from '../orbit/lumenState';
import { loadRealModel, realModelReady } from '../orbit/realModel';
import { dataMode } from '../../engine/data/source';
import { ComparePage } from './ComparePage';
import { go } from './nav';
import { Shell, type Route } from './Shell';
import { SlipPage } from './SlipPage';
import { MethodologyPage } from '../methodology/MethodologyPage';
import { QuickStartDrawer } from '../guidance/QuickStartDrawer';
import { SurfacePage } from './SurfacePage';
import './pages.css';

const ROUTES: readonly Route[] = ['orbit', 'stand-here', 'compare', 'slip', 'methodology'];
const read = (): Route => {
  const h = window.location.hash.replace('#', '');
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'orbit';
};

type Gate = { state: 'ready' } | { state: 'loading' } | { state: 'error'; message: string };

/** In real-data mode the pages wait for the ephemeris, DSN series and terrain masks; they never fall back to sample numbers. */
function useDataGate(): Gate {
  const needed = dataMode() === 'real';
  const [gate, setGate] = useState<Gate>(needed && !realModelReady() ? { state: 'loading' } : { state: 'ready' });
  useEffect(() => {
    if (!needed || realModelReady()) return;
    let live = true;
    loadRealModel().then(
      () => live && setGate({ state: 'ready' }),
      (e: unknown) => live && setGate({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [needed]);
  return gate;
}

export function PagesApp() {
  const gate = useDataGate();
  if (gate.state !== 'ready') {
    return (
      <div role="status" style={{ padding: 32, color: '#d8d2c4', font: '15px Inter, sans-serif' }}>
        {gate.state === 'loading'
          ? 'Loading real ephemeris and terrain data…'
          : `Could not load the real data: ${gate.message}`}
      </div>
    );
  }
  return <PagesShell />;
}

/** Created only once the data is ready, so the shared state starts from the real site list. */
function PagesShell() {
  const lumen = useLumenState();
  const [route, setRoute] = useState<Route>(read);
  const startUtc = useWindowStart(); // pages remount when the window start changes, so no memoised model keeps the old dates

  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    const names: Record<Route, string> = {
      orbit: 'Orbit',
      'stand-here': 'Stand here',
      compare: 'Compare',
      slip: 'Slip explorer',
      methodology: 'Methodology',
    };
    document.title = `${names[route]} · Lumen`;
  }, [route]);

  return (
    <LumenContext.Provider value={lumen}>
      <Shell route={route} lumen={lumen}>
        <Fragment key={startUtc}>
          {route === 'orbit' && (
            <OrbitPage
              onStandHere={() => go('stand-here')}
              onAddToCompare={(s) => {
                lumen.addPick(s.id);
                go('compare');
              }}
            />
          )}
          {route === 'stand-here' && <SurfacePage />}
          {route === 'compare' && <ComparePage />}
          {route === 'slip' && <SlipPage />}
          {route === 'methodology' && <MethodologyPage />}
        </Fragment>
      </Shell>
      <AskLumen />
      <QuickStartDrawer />
    </LumenContext.Provider>
  );
}
