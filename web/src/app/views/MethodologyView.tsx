// Owner: Abhinav
// Methodology & Validation — reading view; the only view whose main container scrolls (internally).
// Content (features/methodology/MethodologySections) lands after CP2 (guide §7).
import { Slot } from '../layout/Slot';

export function MethodologyView() {
  return (
    <div className="methodology">
      <Slot id="methodology" />
    </div>
  );
}
