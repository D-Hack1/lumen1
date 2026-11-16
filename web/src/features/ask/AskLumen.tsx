// Owner: Ebin
// The one component to mount: `<AskLumen />` inside <LumenContext.Provider> in features/pages/PagesApp.tsx (already done).
// It wires AskBox to the live pages' own actions and to the SAME engine result the pages show:
//   • go(route)             features/pages/nav.ts
//   • selectSite(id)        LumenContext (live ids: im2, shack, malapert, …)
//   • setSlip(days)         LumenContext (0 … SLIP_MAX)
//   • result                useEngineResult(site, mast) — the very call Stand here makes for its "Numbers for this window"
//                           panel, so "Why this number?" explains exactly the numbers on screen (same site, array height,
//                           30 days from 8 Feb 2027). That hook is real-data only; in mock data mode there is no page
//                           result, so the box falls back to the app's own store result and says so.
// The result is computed only while the box is open (nothing runs just because this is mounted).
import { useContext, useEffect, useMemo, useState } from 'react';
import { useResult } from '../../engine/hooks';
import { dataMode } from '../../engine/data/source';
import type { ScenarioResult } from '../../engine/types';
import { LumenContext, SLIP_MAX } from '../orbit/lumenState';
import type { Site } from '../orbit/orbitModel';
import { useEngineResult } from '../pages/engineBindings';
import { getBaseUtc, longDate } from '../orbit/windowStart';
import { go } from '../pages/nav';
import { AskBox } from './AskBox';
import type { AskPorts, AskSite } from './commands';

/** The live slip state only accepts 0 … SLIP_MAX days (no earlier-than-on-time landing in the Slip explorer). */
const SLIP_RANGE = { min: 0, max: SLIP_MAX } as const;
const windowLabel = (): string => `30 days from ${longDate(getBaseUtc())}`;

type Source = 'page' | 'store';

/** Real mode: the page's own result. Mounted only while the box is open (subscribing/evaluating costs CPU). */
function PageResultBridge({ site, mast, onResult }: { site: Site; mast: number; onResult: (r: ScenarioResult | null, s: Source) => void }) {
  const r = useEngineResult(site, mast); // identical call to Stand here's → identical numbers
  useEffect(() => onResult(r, 'page'), [r, onResult]);
  return null;
}

/** Mock mode only: there is no page result, so use the app's own store result (and say so). */
function StoreResultBridge({ onResult }: { onResult: (r: ScenarioResult | null, s: Source) => void }) {
  const r = useResult();
  useEffect(() => onResult(r, 'store'), [r, onResult]);
  return null;
}

export function AskLumen() {
  const lumen = useContext(LumenContext);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ result: ScenarioResult | null; source: Source }>({ result: null, source: 'page' });
  const onResult = useMemo(() => (result: ScenarioResult | null, source: Source) => setState((prev) => (prev.result === result && prev.source === source ? prev : { result, source })), []);

  const sites = useMemo<AskSite[]>(() => (lumen?.allSites ?? []).map((s) => ({ id: s.id, name: s.name, short: s.short })), [lumen?.allSites]);
  const setSlip = lumen?.setSlip;
  const ports = useMemo<AskPorts>(() => ({ go, selectSite: (id) => lumen?.selectSite(id), ...(setSlip ? { setSlip } : {}) }), [lumen, setSlip]);

  if (!lumen) return null;
  const real = dataMode() === 'real';
  const note =
    state.source === 'page'
      ? `These are the same numbers as “Numbers for this window” on Stand here: ${lumen.site.name}, ${lumen.mast} m array, ${windowLabel()}.`
      : 'These numbers come from the app’s own default scenario in mock-data mode — not from the site and array height you are looking at.';
  return (
    <>
      {open && (real ? <PageResultBridge site={lumen.site} mast={lumen.mast} onResult={onResult} /> : <StoreResultBridge onResult={onResult} />)}
      <AskBox ports={ports} sites={sites} canSlip={Boolean(setSlip)} slipRange={SLIP_RANGE} result={state.result} resultNote={note} light={lumen.light} onOpenChange={setOpen} />
    </>
  );
}
