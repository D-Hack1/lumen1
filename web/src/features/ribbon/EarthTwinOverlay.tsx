// Owner: Ebin
// Earth Twin toggle (Educator only). The dashed terrestrial Sun path itself is drawn by the Panorama through
// `earthTwinDraw.ts`; this is the human-rate switch that turns it on. Hidden in Planner (guide: Educator, Tier 1).
import { Chip } from '../../ui/Chip';
import { useVisualCopy } from '../shared/visualCopy';

export interface EarthTwinToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
}

export function EarthTwinToggle({ on, onChange }: EarthTwinToggleProps) {
  const vc = useVisualCopy();
  if (vc.persona !== 'educator') return null;
  return (
    <Chip selected={on} onChange={onChange} title={vc.t('twin.label')}>
      {vc.t('twin.toggle')}
    </Chip>
  );
}
