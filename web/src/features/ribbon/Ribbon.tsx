// Owner: Ebin
// SKYLINE Ribbon panel (PLAN_FINAL §8.3, guide §3.2): Panorama fills the panel; the Horizon Lens sits in the
// right ~30% as a collapsible overlay (full width in presenter density becomes a hover-summoned overlay —
// Phase 3 refinement); transport (scrub + play) runs along the bottom, shared by both views.
import { useState } from 'react';
import { useCopy } from '../../state/copy';
import { RibbonPanorama } from './RibbonPanorama';
import { RibbonLens } from './RibbonLens';
import { RibbonTransport } from './RibbonTransport';
import { COACH, coachAnchor } from '../shared/coachAnchors';
import { EarthTwinToggle } from './EarthTwinOverlay';

export function Ribbon() {
  const [lensOpen, setLensOpen] = useState(true);
  const [twin, setTwin] = useState(false);
  const title = useCopy('ribbon.title');

  return (
    <div className="ribbon" {...coachAnchor(COACH.ribbon)} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="ribbon__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-text-muted)' }}>
          {title}
        </span>
        <span style={{ marginLeft: 'auto', marginRight: 'var(--sp-3)' }}>
          <EarthTwinToggle on={twin} onChange={setTwin} />
        </span>
        <button type="button" aria-pressed={lensOpen} onClick={() => setLensOpen((v) => !v)}>
          Lens {lensOpen ? '▸' : '◂'}
        </button>
      </div>
      <div className="ribbon__body" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <RibbonPanorama showTwin={twin} />
        </div>
        {lensOpen && (
          <div style={{ width: '30%', minWidth: 160, borderLeft: '1px solid var(--c-hairline)' }}>
            <RibbonLens />
          </div>
        )}
      </div>
      <RibbonTransport />
    </div>
  );
}
